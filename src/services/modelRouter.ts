// ─────────────────────────────────────────────────────────────
// Remus — Smart Model Router
// Automatically routes queries to fast or smart models
// BEATS: Claude Code (single model) & Cursor (manual switching)
// ─────────────────────────────────────────────────────────────

import type { LLMProvider, CompletionRequest, CompletionResponse, StreamChunk } from '../providers/types.js';

export interface ModelRouterConfig {
  smartProvider: LLMProvider;
  fastProvider: LLMProvider;
  smartModel: string;
  fastModel: string;
  /** Threshold in estimated tokens — below this, use fast model */
  complexityThreshold?: number;
  /** Always use smart model for tool calls */
  smartForToolCalls?: boolean;
  /** Track routing decisions */
  onRoute?: (decision: RouteDecision) => void;
}

export interface RouteDecision {
  query: string;
  model: 'smart' | 'fast';
  reason: string;
  latencyMs?: number;
}

// Patterns that indicate complex tasks needing the smart model
const COMPLEX_PATTERNS = [
  /refactor/i,
  /architect/i,
  /design.*system/i,
  /implement.*from.*scratch/i,
  /debug.*complex/i,
  /fix.*bug/i,
  /security.*review/i,
  /performance.*optim/i,
  /write.*test/i,
  /create.*(?:class|module|service|component|api)/i,
  /build.*(?:feature|system|pipeline|framework)/i,
  /migrate/i,
  /upgrade/i,
  /explain.*(?:how|why|what)/i,
  /review.*(?:code|pr|pull)/i,
  /multiple.*files/i,
  /entire.*(?:codebase|project)/i,
];

// Patterns that indicate simple tasks suitable for the fast model
const SIMPLE_PATTERNS = [
  /^(?:what|where|which|how|show|list|find|search)\s/i,
  /^(?:read|cat|grep|look at|open)\s/i,
  /format/i,
  /rename\s+(?:a|the|this)\s+(?:variable|function|class)/i,
  /add\s+(?:a|an)\s+(?:import|comment|log)/i,
  /fix\s+(?:typo|indent|spacing|whitespace)/i,
  /^(?:yes|no|ok|sure|thanks|done)\b/i,
  /summarize/i,
  /^git\s/i,
  /^run\s/i,
];

/**
 * Analyzes a query and decides which model to use.
 */
export function classifyComplexity(query: string): { model: 'smart' | 'fast'; reason: string } {
  const trimmed = query.trim();
  
  // Very short queries → fast
  if (trimmed.length < 20) {
    return { model: 'fast', reason: 'short query' };
  }

  // Check for complex patterns first (higher priority)
  for (const pattern of COMPLEX_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { model: 'smart', reason: `complex pattern: ${pattern.source}` };
    }
  }

  // Check for simple patterns
  for (const pattern of SIMPLE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { model: 'fast', reason: `simple pattern: ${pattern.source}` };
    }
  }

  // Multiple sentences or long queries → smart
  const sentences = trimmed.split(/[.!?]+/).filter(s => s.trim().length > 10);
  if (sentences.length >= 3) {
    return { model: 'smart', reason: 'multi-sentence query' };
  }

  // Code blocks in query → smart
  if (trimmed.includes('```') || trimmed.includes('function ') || trimmed.includes('class ')) {
    return { model: 'smart', reason: 'contains code' };
  }

  // Default to smart (safer — better results)
  return { model: 'smart', reason: 'default' };
}

/**
 * Smart Model Router — wraps two providers and auto-routes queries.
 * Uses the fast model for simple tasks and the smart model for complex ones.
 * This is a MASSIVE speed improvement since fast models respond 3-5x faster.
 */
export class ModelRouter implements LLMProvider {
  name = 'remus-router';
  private config: ModelRouterConfig;
  private routeHistory: RouteDecision[] = [];
  private currentMode: 'auto' | 'smart' | 'fast' = 'auto';

  constructor(config: ModelRouterConfig) {
    this.config = config;
    this.name = `router(${config.smartModel}/${config.fastModel})`;
  }

  /** Force a specific routing mode */
  setMode(mode: 'auto' | 'smart' | 'fast'): void {
    this.currentMode = mode;
  }

  getMode(): 'auto' | 'smart' | 'fast' {
    return this.currentMode;
  }

  /** Get routing statistics */
  getStats(): { smart: number; fast: number; history: RouteDecision[] } {
    const smart = this.routeHistory.filter(r => r.model === 'smart').length;
    const fast = this.routeHistory.filter(r => r.model === 'fast').length;
    return { smart, fast, history: [...this.routeHistory] };
  }

  private route(request: CompletionRequest): { provider: LLMProvider; model: string; decision: RouteDecision } {
    // Extract the last user message for classification
    const lastUserMsg = [...request.messages].reverse().find(m => m.role === 'user');
    const query = typeof lastUserMsg?.content === 'string' 
      ? lastUserMsg.content 
      : lastUserMsg?.content?.map(b => b.text).filter(Boolean).join(' ') ?? '';

    let model: 'smart' | 'fast';
    let reason: string;

    if (this.currentMode !== 'auto') {
      model = this.currentMode;
      reason = `forced mode: ${this.currentMode}`;
    } else if (request.tools && request.tools.length > 0 && this.config.smartForToolCalls) {
      model = 'smart';
      reason = 'tool calls require smart model';
    } else {
      const classification = classifyComplexity(query);
      model = classification.model;
      reason = classification.reason;
    }

    const decision: RouteDecision = { query: query.slice(0, 100), model, reason };
    this.routeHistory.push(decision);
    this.config.onRoute?.(decision);

    if (model === 'fast') {
      return { provider: this.config.fastProvider, model: this.config.fastModel, decision };
    }
    return { provider: this.config.smartProvider, model: this.config.smartModel, decision };
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const start = Date.now();
    const { provider, model, decision } = this.route(request);
    const result = await provider.complete({ ...request, model });
    decision.latencyMs = Date.now() - start;
    return result;
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk> {
    const start = Date.now();
    const { provider, model, decision } = this.route(request);
    const gen = provider.stream({ ...request, model });
    for await (const chunk of gen) {
      yield chunk;
    }
    decision.latencyMs = Date.now() - start;
  }

  async listModels(): Promise<string[]> {
    const [smartModels, fastModels] = await Promise.all([
      this.config.smartProvider.listModels(),
      this.config.fastProvider.listModels(),
    ]);
    return [...new Set([...smartModels, ...fastModels])];
  }

  async ping(): Promise<boolean> {
    const [smart, fast] = await Promise.all([
      this.config.smartProvider.ping(),
      this.config.fastProvider.ping(),
    ]);
    return smart || fast;
  }
}
