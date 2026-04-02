// ─────────────────────────────────────────────────────────────
// Remus — OpenAI-Compatible Provider
// Works with: OpenAI, Ollama, LM Studio, OpenRouter, vLLM,
//             text-generation-webui, LocalAI, Together, etc.
// ─────────────────────────────────────────────────────────────

import type {
  LLMProvider,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  Message,
  ToolDefinition,
} from './types.js';
import { withRetry } from '../services/retryHandler.js';

interface OpenAIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  name?: string;
  onRetry?: (attempt: number, delay: number, error: Error) => void;
}

export class OpenAIProvider implements LLMProvider {
  name: string;
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private onRetry: (attempt: number, delay: number, error: Error) => void;

  constructor(config: OpenAIConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.name = config.name ?? 'openai-compatible';
    this.onRetry = config.onRetry ?? (() => {});
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private convertMessages(messages: Message[]): unknown[] {
    return messages.map((msg) => {
      if (msg.role === 'tool') {
        return {
          role: 'tool',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          tool_call_id: msg.tool_call_id,
        };
      }
      if (msg.tool_calls) {
        return {
          role: 'assistant',
          content: typeof msg.content === 'string' ? msg.content || null : null,
          tool_calls: msg.tool_calls,
        };
      }
      return {
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : msg.content.map(b => {
          if (b.type === 'text') return { type: 'text', text: b.text };
          if (b.type === 'image_url') return { type: 'image_url', image_url: b.image_url };
          return { type: 'text', text: JSON.stringify(b) };
        }),
      };
    });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    return withRetry(async () => {
      const body = {
        model: request.model ?? this.model,
        messages: this.convertMessages(request.messages),
        tools: request.tools && request.tools.length > 0 ? request.tools : undefined,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? 8192,
        stream: false,
      };

      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`LLM API error (${res.status}): ${errText}`);
      }

      const data = await res.json() as any;
      const choice = data.choices?.[0];
      if (!choice) throw new Error('No completion choice returned');

      const message: Message = {
        role: 'assistant',
        content: choice.message.content ?? '',
        tool_calls: choice.message.tool_calls,
      };

      return {
        message,
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? 0,
          outputTokens: data.usage?.completion_tokens ?? 0,
          totalTokens: data.usage?.total_tokens ?? 0,
        },
        finishReason: choice.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop',
        model: data.model ?? this.model,
      };
    }, { onRetry: this.onRetry });
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk> {
    const body = {
      model: request.model ?? this.model,
      messages: this.convertMessages(request.messages),
      tools: request.tools && request.tools.length > 0 ? request.tools : undefined,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 8192,
      stream: true,
      stream_options: { include_usage: true },  // Get token counts in stream
    };

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      yield { type: 'error', error: `LLM API error (${res.status}): ${errText}` };
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    const toolCallAccumulators: Map<number, { id: string; name: string; args: string }> = new Map();

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
            // Emit any accumulated tool calls
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
                if (tc.id) acc.id = tc.id;
                if (tc.function?.name) acc.name = tc.function.name;
                if (tc.function?.arguments) acc.args += tc.function.arguments;
              }
            }

            if (chunk.usage) {
              yield {
                type: 'usage',
                usage: {
                  inputTokens: chunk.usage.prompt_tokens ?? 0,
                  outputTokens: chunk.usage.completion_tokens ?? 0,
                  totalTokens: chunk.usage.total_tokens ?? 0,
                },
              };
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Emit remaining tool calls
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
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.buildHeaders(),
      });
      if (!res.ok) return [this.model];
      const data = await res.json() as any;
      return (data.data ?? []).map((m: any) => m.id);
    } catch {
      return [this.model];
    }
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.buildHeaders(),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
