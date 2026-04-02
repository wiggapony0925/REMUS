// ─────────────────────────────────────────────────────────────
// Remus — Speed Metrics & Performance Tracker
// Real-time latency, throughput, and performance analysis
// BEATS: Claude Code (no metrics) & Cursor (no metrics)
// ─────────────────────────────────────────────────────────────

export interface LatencyRecord {
  operation: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

export interface ThroughputRecord {
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  tokensPerSecond: number;
}

export interface PerformanceSnapshot {
  // Latency
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;

  // Throughput
  avgTokensPerSecond: number;
  peakTokensPerSecond: number;
  totalTokensGenerated: number;

  // Operations
  totalOperations: number;
  operationBreakdown: Record<string, { count: number; avgMs: number }>;

  // Speed rating
  speedRating: 'blazing' | 'fast' | 'normal' | 'slow' | 'crawling';
  speedScore: number; // 0-100
}

/**
 * Performance Tracker — real-time speed metrics for everything Remus does.
 * 
 * Tracks:
 * - LLM response latency (time to first token, total time)
 * - Token throughput (tokens/sec)
 * - Tool execution time
 * - End-to-end query time
 * 
 * Neither Claude Code nor Cursor give users any insight into
 * performance. Remus shows you exactly how fast everything is.
 */
export class PerformanceTracker {
  private latencies: LatencyRecord[] = [];
  private throughputs: ThroughputRecord[] = [];
  private activeTimers = new Map<string, number>();
  private maxRecords = 1000;

  /**
   * Start timing an operation. Returns a stop function.
   */
  startTimer(operation: string, metadata?: Record<string, unknown>): () => number {
    const start = performance.now();
    const id = `${operation}_${start}`;
    this.activeTimers.set(id, start);

    return () => {
      const end = performance.now();
      const durationMs = Math.round(end - start);
      this.activeTimers.delete(id);

      this.latencies.push({
        operation,
        startTime: start,
        endTime: end,
        durationMs,
        metadata,
      });

      // Trim if over limit
      if (this.latencies.length > this.maxRecords) {
        this.latencies = this.latencies.slice(-this.maxRecords);
      }

      return durationMs;
    };
  }

  /**
   * Record a throughput measurement.
   */
  recordThroughput(inputTokens: number, outputTokens: number, durationMs: number): void {
    const totalTokens = inputTokens + outputTokens;
    const tokensPerSecond = durationMs > 0 ? (outputTokens / durationMs) * 1000 : 0;

    this.throughputs.push({
      timestamp: Date.now(),
      inputTokens,
      outputTokens,
      durationMs,
      tokensPerSecond,
    });

    if (this.throughputs.length > this.maxRecords) {
      this.throughputs = this.throughputs.slice(-this.maxRecords);
    }
  }

  /**
   * Record a tool execution.
   */
  recordToolExecution(toolName: string, durationMs: number, success: boolean): void {
    this.latencies.push({
      operation: `tool:${toolName}`,
      startTime: Date.now() - durationMs,
      endTime: Date.now(),
      durationMs,
      metadata: { success },
    });
  }

  /**
   * Get the current performance snapshot.
   */
  getSnapshot(windowMs?: number): PerformanceSnapshot {
    const now = Date.now();
    const cutoff = windowMs ? now - windowMs : 0;

    const filteredLatencies = this.latencies.filter(l => 
      l.startTime >= cutoff || !windowMs
    );
    const filteredThroughputs = this.throughputs.filter(t =>
      t.timestamp >= cutoff || !windowMs
    );

    // Calculate latency percentiles
    const durations = filteredLatencies.map(l => l.durationMs).sort((a, b) => a - b);
    const p = (pct: number) => {
      if (durations.length === 0) return 0;
      const idx = Math.ceil((pct / 100) * durations.length) - 1;
      return durations[Math.max(0, idx)]!;
    };

    const avgLatency = durations.length > 0 
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    // Calculate throughput
    const tokensPerSec = filteredThroughputs.map(t => t.tokensPerSecond);
    const avgTps = tokensPerSec.length > 0
      ? Math.round(tokensPerSec.reduce((a, b) => a + b, 0) / tokensPerSec.length)
      : 0;
    const peakTps = Math.max(0, ...tokensPerSec);
    const totalTokens = filteredThroughputs.reduce((a, t) => a + t.outputTokens, 0);

    // Operation breakdown
    const breakdown: Record<string, { count: number; totalMs: number }> = {};
    for (const l of filteredLatencies) {
      if (!breakdown[l.operation]) {
        breakdown[l.operation] = { count: 0, totalMs: 0 };
      }
      breakdown[l.operation]!.count++;
      breakdown[l.operation]!.totalMs += l.durationMs;
    }
    const operationBreakdown: Record<string, { count: number; avgMs: number }> = {};
    for (const [op, data] of Object.entries(breakdown)) {
      operationBreakdown[op] = {
        count: data.count,
        avgMs: Math.round(data.totalMs / data.count),
      };
    }

    // Speed rating
    let speedScore = 50; // baseline
    if (avgTps > 80) speedScore += 20;
    else if (avgTps > 50) speedScore += 10;
    else if (avgTps < 10) speedScore -= 20;
    else if (avgTps < 25) speedScore -= 10;

    if (avgLatency < 500) speedScore += 15;
    else if (avgLatency < 1000) speedScore += 5;
    else if (avgLatency > 5000) speedScore -= 15;
    else if (avgLatency > 3000) speedScore -= 10;

    speedScore = Math.max(0, Math.min(100, speedScore));

    let speedRating: PerformanceSnapshot['speedRating'];
    if (speedScore >= 80) speedRating = 'blazing';
    else if (speedScore >= 60) speedRating = 'fast';
    else if (speedScore >= 40) speedRating = 'normal';
    else if (speedScore >= 20) speedRating = 'slow';
    else speedRating = 'crawling';

    return {
      avgLatencyMs: avgLatency,
      p50LatencyMs: p(50),
      p95LatencyMs: p(95),
      p99LatencyMs: p(99),
      minLatencyMs: durations[0] ?? 0,
      maxLatencyMs: durations[durations.length - 1] ?? 0,
      avgTokensPerSecond: avgTps,
      peakTokensPerSecond: Math.round(peakTps),
      totalTokensGenerated: totalTokens,
      totalOperations: filteredLatencies.length,
      operationBreakdown,
      speedRating,
      speedScore,
    };
  }

  /**
   * Get a formatted performance report.
   */
  getReport(): string {
    const snap = this.getSnapshot();
    const lines = [
      `Speed Rating: ${snap.speedRating.toUpperCase()} (${snap.speedScore}/100)`,
      '',
      'Latency:',
      `  Average:  ${snap.avgLatencyMs}ms`,
      `  P50:      ${snap.p50LatencyMs}ms`,
      `  P95:      ${snap.p95LatencyMs}ms`,
      `  P99:      ${snap.p99LatencyMs}ms`,
      `  Min/Max:  ${snap.minLatencyMs}ms / ${snap.maxLatencyMs}ms`,
      '',
      'Throughput:',
      `  Average:  ${snap.avgTokensPerSecond} tok/s`,
      `  Peak:     ${snap.peakTokensPerSecond} tok/s`,
      `  Total:    ${snap.totalTokensGenerated.toLocaleString()} tokens`,
      '',
      'Operations:',
      `  Total:    ${snap.totalOperations}`,
    ];

    if (Object.keys(snap.operationBreakdown).length > 0) {
      lines.push('  Breakdown:');
      for (const [op, data] of Object.entries(snap.operationBreakdown)) {
        lines.push(`    ${op}: ${data.count}x, avg ${data.avgMs}ms`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get a compact one-line speed indicator.
   */
  getSpeedIndicator(): string {
    const snap = this.getSnapshot(60000); // Last minute
    const icons: Record<string, string> = {
      blazing: '🔥',
      fast: '⚡',
      normal: '●',
      slow: '◐',
      crawling: '○',
    };
    return `${icons[snap.speedRating]} ${snap.avgTokensPerSecond} tok/s`;
  }

  reset(): void {
    this.latencies = [];
    this.throughputs = [];
    this.activeTimers.clear();
  }
}
