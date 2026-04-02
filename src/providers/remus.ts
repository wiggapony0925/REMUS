// ─────────────────────────────────────────────────────────────
// Remus — Remus Model Provider (Future)
// Stub for the future Remus LLM — ready to plug in when built
// This demonstrates the flexibility of the provider system
// ─────────────────────────────────────────────────────────────

import type {
  LLMProvider,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  Message,
} from './types.js';

interface RemusModelConfig {
  /** API endpoint for the Remus model service */
  baseUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** Model variant (e.g., 'remus-1', 'remus-1-fast', 'remus-1-ultra') */
  model: string;
  /** Organization ID */
  orgId?: string;
  /** Callback for telemetry */
  onMetrics?: (metrics: RemusMetrics) => void;
}

export interface RemusMetrics {
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
  cached: boolean;
  timestamp: number;
}

/**
 * Remus Model Provider — the future home model for Remus CLI.
 * 
 * When JfmCapitalGroup builds the Remus model, this provider will
 * connect to it natively. For now, it validates the architecture
 * and falls through to show users what's coming.
 * 
 * Planned Remus model tiers:
 * - remus-1-flash:    Fast, cheap, for simple tasks  (8B params)
 * - remus-1:          Standard, balanced              (70B params)  
 * - remus-1-ultra:    Maximum intelligence            (405B+ params)
 * - remus-1-code:     Code-specialized fine-tune      (70B params)
 * 
 * API format: OpenAI-compatible with Remus extensions
 * - Remus-native tool calling with parallel execution
 * - Built-in code understanding (AST-aware, not just text)
 * - Streaming with real-time token counting
 * - Session persistence (model remembers past interactions)
 * 
 * Users can still use ANY model in the meantime — this is additive.
 */
export class RemusModelProvider implements LLMProvider {
  name = 'remus';
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private orgId?: string;
  private onMetrics?: (metrics: RemusMetrics) => void;
  private isAvailable = false;

  // Model catalog
  static readonly MODELS = {
    'remus-1-flash': { contextWindow: 32_768, description: 'Fast & efficient' },
    'remus-1': { contextWindow: 131_072, description: 'Standard balanced' },
    'remus-1-ultra': { contextWindow: 200_000, description: 'Maximum intelligence' },
    'remus-1-code': { contextWindow: 131_072, description: 'Code-specialized' },
  } as const;

  constructor(config: RemusModelConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.orgId = config.orgId;
    this.onMetrics = config.onMetrics;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'X-Remus-Version': '1.0',
    };
    if (this.orgId) {
      headers['X-Remus-Org'] = this.orgId;
    }
    return headers;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const start = Date.now();

    const body = {
      model: request.model ?? this.model,
      messages: request.messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      })),
      tools: request.tools,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 8192,
      stream: false,
      // Remus-native extensions
      remus_extensions: {
        code_aware: true,  // Enable AST-aware processing
        parallel_tools: true,  // Enable native parallel tool execution
      },
    };

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Remus API error (${res.status}): ${errText}`);
    }

    const data = await res.json() as any;
    const choice = data.choices?.[0];
    if (!choice) throw new Error('No completion choice returned');

    const latencyMs = Date.now() - start;
    const metrics: RemusMetrics = {
      latencyMs,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      model: data.model ?? this.model,
      cached: data.remus_cached ?? false,
      timestamp: Date.now(),
    };
    this.onMetrics?.(metrics);

    return {
      message: {
        role: 'assistant',
        content: choice.message.content ?? '',
        tool_calls: choice.message.tool_calls,
      },
      usage: {
        inputTokens: metrics.inputTokens,
        outputTokens: metrics.outputTokens,
        totalTokens: metrics.inputTokens + metrics.outputTokens,
      },
      finishReason: choice.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop',
      model: data.model ?? this.model,
    };
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk> {
    const start = Date.now();

    const body = {
      model: request.model ?? this.model,
      messages: request.messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      })),
      tools: request.tools,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 8192,
      stream: true,
      stream_options: { include_usage: true },
      remus_extensions: {
        code_aware: true,
        parallel_tools: true,
      },
    };

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      yield { type: 'error', error: `Remus API error (${res.status}): ${errText}` };
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    const toolCallAccumulators = new Map<number, { id: string; name: string; args: string }>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const payload = trimmed.slice(6);
          if (payload === '[DONE]') {
            for (const [, tc] of toolCallAccumulators) {
              yield {
                type: 'tool_call',
                toolCall: {
                  id: tc.id,
                  type: 'function',
                  function: { name: tc.name, arguments: tc.args },
                },
              };
            }
            yield { type: 'done' };
            return;
          }

          try {
            const chunk = JSON.parse(payload);
            const delta = chunk.choices?.[0]?.delta;

            // Usage info (Remus includes this in stream)
            if (chunk.usage) {
              const latencyMs = Date.now() - start;
              this.onMetrics?.({
                latencyMs,
                inputTokens: chunk.usage.prompt_tokens ?? 0,
                outputTokens: chunk.usage.completion_tokens ?? 0,
                model: this.model,
                cached: chunk.remus_cached ?? false,
                timestamp: Date.now(),
              });
              yield {
                type: 'usage',
                usage: {
                  inputTokens: chunk.usage.prompt_tokens ?? 0,
                  outputTokens: chunk.usage.completion_tokens ?? 0,
                  totalTokens: chunk.usage.total_tokens ?? 0,
                },
              };
            }

            if (!delta) continue;

            if (delta.content) {
              yield { type: 'text', text: delta.content };
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCallAccumulators.has(idx)) {
                  toolCallAccumulators.set(idx, {
                    id: tc.id ?? `call_${idx}`,
                    name: tc.function?.name ?? '',
                    args: '',
                  });
                }
                const acc = toolCallAccumulators.get(idx)!;
                if (tc.function?.name) acc.name = tc.function.name;
                if (tc.function?.arguments) acc.args += tc.function.arguments;
              }
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.buildHeaders(),
      });
      if (!res.ok) return Object.keys(RemusModelProvider.MODELS);
      const data = await res.json() as any;
      return data.data?.map((m: any) => m.id) ?? Object.keys(RemusModelProvider.MODELS);
    } catch {
      return Object.keys(RemusModelProvider.MODELS);
    }
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      this.isAvailable = res.ok;
      return res.ok;
    } catch {
      this.isAvailable = false;
      return false;
    }
  }

  getAvailability(): boolean {
    return this.isAvailable;
  }
}
