// ─────────────────────────────────────────────────────────────
// Remus — Cost Tracker
// Real-time cost tracking with per-model pricing
// ─────────────────────────────────────────────────────────────

export interface TokenPricing {
  inputPer1M: number;   // USD per 1M input tokens
  outputPer1M: number;  // USD per 1M output tokens
}

export interface CostEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  timestamp: number;
}

// OpenAI pricing (as of Jan 2025)
const OPENAI_PRICING: Record<string, TokenPricing> = {
  'gpt-4o':             { inputPer1M: 2.50,  outputPer1M: 10.00 },
  'gpt-4o-mini':        { inputPer1M: 0.15,  outputPer1M: 0.60 },
  'gpt-4o-2024-11-20':  { inputPer1M: 2.50,  outputPer1M: 10.00 },
  'gpt-4-turbo':        { inputPer1M: 10.00, outputPer1M: 30.00 },
  'gpt-4':              { inputPer1M: 30.00, outputPer1M: 60.00 },
  'gpt-3.5-turbo':      { inputPer1M: 0.50,  outputPer1M: 1.50 },
  'o1':                 { inputPer1M: 15.00, outputPer1M: 60.00 },
  'o1-mini':            { inputPer1M: 3.00,  outputPer1M: 12.00 },
  'o1-pro':             { inputPer1M: 150.00,outputPer1M: 600.00 },
  'o3':                 { inputPer1M: 10.00, outputPer1M: 40.00 },
  'o3-mini':            { inputPer1M: 1.10,  outputPer1M: 4.40 },
  'o4-mini':            { inputPer1M: 1.10,  outputPer1M: 4.40 },
  'gpt-4.1':            { inputPer1M: 2.00,  outputPer1M: 8.00 },
  'gpt-4.1-mini':       { inputPer1M: 0.40,  outputPer1M: 1.60 },
  'gpt-4.1-nano':       { inputPer1M: 0.10,  outputPer1M: 0.40 },
};

// Anthropic pricing
const ANTHROPIC_PRICING: Record<string, TokenPricing> = {
  'claude-sonnet-4-20250514': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-3-5-sonnet-20241022': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-3-5-haiku-20241022': { inputPer1M: 0.80, outputPer1M: 4.00 },
  'claude-3-opus-20240229': { inputPer1M: 15.00, outputPer1M: 75.00 },
  'claude-opus-4-20250514': { inputPer1M: 15.00, outputPer1M: 75.00 },
};

// OpenRouter typical prices
const OPENROUTER_PRICING: Record<string, TokenPricing> = {
  'anthropic/claude-sonnet-4': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'openai/gpt-4o': { inputPer1M: 2.50, outputPer1M: 10.00 },
  'google/gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10.00 },
  'meta-llama/llama-3.3-70b-instruct': { inputPer1M: 0.40, outputPer1M: 0.40 },
};

const ALL_PRICING: Record<string, TokenPricing> = {
  ...OPENAI_PRICING,
  ...ANTHROPIC_PRICING,
  ...OPENROUTER_PRICING,
};

export class CostTracker {
  private entries: CostEntry[] = [];
  private _totalCost = 0;
  private _totalInputTokens = 0;
  private _totalOutputTokens = 0;

  /**
   * Record token usage and compute cost.
   */
  record(model: string, inputTokens: number, outputTokens: number): CostEntry {
    const pricing = this.getPricing(model);
    const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
    const totalCost = inputCost + outputCost;

    const entry: CostEntry = {
      model,
      inputTokens,
      outputTokens,
      inputCost,
      outputCost,
      totalCost,
      timestamp: Date.now(),
    };

    this.entries.push(entry);
    this._totalCost += totalCost;
    this._totalInputTokens += inputTokens;
    this._totalOutputTokens += outputTokens;

    return entry;
  }

  /**
   * Get pricing for a model. Falls back to a reasonable default.
   */
  getPricing(model: string): TokenPricing {
    // Exact match
    if (ALL_PRICING[model]) return ALL_PRICING[model];

    // Fuzzy match: check if model starts with a known key
    for (const [key, pricing] of Object.entries(ALL_PRICING)) {
      if (model.startsWith(key) || model.includes(key)) return pricing;
    }

    // Default: assume mid-range pricing
    return { inputPer1M: 2.50, outputPer1M: 10.00 };
  }

  get totalCost(): number {
    return this._totalCost;
  }

  get totalInputTokens(): number {
    return this._totalInputTokens;
  }

  get totalOutputTokens(): number {
    return this._totalOutputTokens;
  }

  get totalTokens(): number {
    return this._totalInputTokens + this._totalOutputTokens;
  }

  /**
   * Get a formatted cost summary.
   */
  getSummary(): string {
    const lines: string[] = [];
    lines.push(`Session Cost Summary`);
    lines.push(`─────────────────────────`);
    lines.push(`  Input tokens:  ${this._totalInputTokens.toLocaleString()}`);
    lines.push(`  Output tokens: ${this._totalOutputTokens.toLocaleString()}`);
    lines.push(`  Total tokens:  ${this.totalTokens.toLocaleString()}`);
    lines.push(``);
    lines.push(`  Input cost:    $${this.getInputCost().toFixed(4)}`);
    lines.push(`  Output cost:   $${this.getOutputCost().toFixed(4)}`);
    lines.push(`  Total cost:    $${this._totalCost.toFixed(4)}`);

    if (this.entries.length > 0) {
      lines.push(``);
      lines.push(`  Requests:      ${this.entries.length}`);
      lines.push(`  Avg cost/req:  $${(this._totalCost / this.entries.length).toFixed(4)}`);
    }

    return lines.join('\n');
  }

  /**
   * Get short cost string for status bar.
   */
  getShortCost(): string {
    if (this._totalCost < 0.001) return '$0.00';
    if (this._totalCost < 0.01) return `$${this._totalCost.toFixed(4)}`;
    if (this._totalCost < 1) return `$${this._totalCost.toFixed(3)}`;
    return `$${this._totalCost.toFixed(2)}`;
  }

  getInputCost(): number {
    return this.entries.reduce((sum, e) => sum + e.inputCost, 0);
  }

  getOutputCost(): number {
    return this.entries.reduce((sum, e) => sum + e.outputCost, 0);
  }

  getEntries(): CostEntry[] {
    return [...this.entries];
  }

  reset(): void {
    this.entries = [];
    this._totalCost = 0;
    this._totalInputTokens = 0;
    this._totalOutputTokens = 0;
  }
}

// Singleton for global cost tracking
let _globalTracker: CostTracker | null = null;
export function getGlobalCostTracker(): CostTracker {
  if (!_globalTracker) _globalTracker = new CostTracker();
  return _globalTracker;
}
