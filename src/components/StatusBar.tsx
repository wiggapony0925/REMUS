// ─────────────────────────────────────────────────────────────
// Remus — Status Bar Component v2
// Premium minimal terminal status display
// ─────────────────────────────────────────────────────────────

import React from 'react';
import { Text, Box } from 'ink';
import type { SessionStats } from '../services/queryEngine.js';

interface StatusBarProps {
  model: string;
  provider: string;
  stats: SessionStats;
  cwd: string;
  isStreaming?: boolean;
  cost?: string;
}

export function StatusBar({ model, provider, stats, cwd, isStreaming, cost }: StatusBarProps): React.ReactElement {
  const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(0);
  const tokens = stats.totalInputTokens + stats.totalOutputTokens;
  const tokenStr = tokens > 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);

  // Shorten cwd
  const home = process.env.HOME ?? '';
  const shortCwd = home && cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;

  // ── Styled segments ──
  const dot = isStreaming ? '●' : '◈';
  const dotColor = isStreaming ? '#FBBF24' : '#FF6B35';
  const borderColor = isStreaming ? '#FBBF24' : '#444444';

  // Build right-side stats as segments
  const segments: Array<{ label: string; value: string; color: string; valueColor: string }> = [
    { label: '', value: model, color: '', valueColor: '#FF8C42' },
    { label: '', value: provider, color: '', valueColor: '#67E8F9' },
    { label: 'tok', value: tokenStr, color: '#666666', valueColor: '#FFFFFF' },
  ];
  if (cost && cost !== '$0.00') {
    segments.push({ label: '', value: cost, color: '', valueColor: '#FBBF24' });
  }
  if (stats.toolCalls > 0) {
    segments.push({ label: 'tools', value: String(stats.toolCalls), color: '#666666', valueColor: '#4ADE80' });
  }
  segments.push({ label: 's', value: elapsed, color: '#666666', valueColor: '#999999' });

  return (
    <Box borderStyle="single" borderColor={borderColor} paddingX={1} justifyContent="space-between" marginTop={0}>
      {/* Left: branding + cwd */}
      <Text>
        <Text color={dotColor} bold>{dot} </Text>
        <Text color="#FFFFFF" bold>Remus</Text>
        <Text color="#444444"> │ </Text>
        <Text color="#777777">{shortCwd}</Text>
      </Text>

      {/* Right: stats segments */}
      <Text>
        {segments.map((seg, i) => (
          <React.Fragment key={i}>
            {i > 0 && <Text color="#444444"> · </Text>}
            <Text color={seg.valueColor} bold={i === 0}>{seg.value}</Text>
            {seg.label && <Text color={seg.color}> {seg.label}</Text>}
          </React.Fragment>
        ))}
      </Text>
    </Box>
  );
}
