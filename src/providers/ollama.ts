// ─────────────────────────────────────────────────────────────
// Remus — Ollama Provider (native API, not OpenAI compat)
// For direct Ollama integration with tool calling support
// ─────────────────────────────────────────────────────────────

import type {
  LLMProvider,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  Message,
  ToolCall,
} from './types.js';

interface OllamaConfig {
  baseUrl?: string;
  model: string;
}

export class OllamaProvider implements LLMProvider {
  name = 'ollama';
  private baseUrl: string;
  private model: string;

  constructor(config: OllamaConfig) {
    this.baseUrl = (config.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '');
    this.model = config.model;
  }

  private convertMessages(messages: Message[]): unknown[] {
    return messages.map((msg) => {
      if (msg.role === 'system') {
        return { role: 'system', content: typeof msg.content === 'string' ? msg.content : '' };
      }
      if (msg.role === 'tool') {
        return {
          role: 'tool',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        };
      }
      if (msg.role === 'assistant' && msg.tool_calls) {
        return {
          role: 'assistant',
          content: typeof msg.content === 'string' ? msg.content : '',
          tool_calls: msg.tool_calls.map(tc => ({
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        };
      }
      return {
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : msg.content.map(b => b.text ?? '').join(''),
      };
    });
  }

  private convertTools(tools?: import('./types.js').ToolDefinition[]): unknown[] | undefined {
    if (!tools || tools.length === 0) return undefined;
    return tools.map((t) => ({
      type: 'function',
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      },
    }));
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const body = {
      model: request.model ?? this.model,
      messages: this.convertMessages(request.messages),
      tools: this.convertTools(request.tools),
      stream: false,
      options: {
        temperature: request.temperature ?? 0.7,
        num_predict: request.maxTokens ?? 8192,
      },
    };

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama API error (${res.status}): ${errText}`);
    }

    const data = await res.json() as any;
    const toolCalls: ToolCall[] = [];

    if (data.message?.tool_calls) {
      for (let i = 0; i < data.message.tool_calls.length; i++) {
        const tc = data.message.tool_calls[i];
        toolCalls.push({
          id: `call_${Date.now()}_${i}`,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments: typeof tc.function.arguments === 'string'
              ? tc.function.arguments
              : JSON.stringify(tc.function.arguments),
          },
        });
      }
    }

    const message: Message = {
      role: 'assistant',
      content: data.message?.content ?? '',
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };

    return {
      message,
      usage: {
        inputTokens: data.prompt_eval_count ?? 0,
        outputTokens: data.eval_count ?? 0,
        totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      },
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      model: data.model ?? this.model,
    };
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk> {
    const body = {
      model: request.model ?? this.model,
      messages: this.convertMessages(request.messages),
      tools: this.convertTools(request.tools),
      stream: true,
      options: {
        temperature: request.temperature ?? 0.7,
        num_predict: request.maxTokens ?? 8192,
      },
    };

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      yield { type: 'error', error: `Ollama API error (${res.status}): ${errText}` };
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line);

            if (chunk.message?.content) {
              yield { type: 'text', text: chunk.message.content };
            }

            if (chunk.message?.tool_calls) {
              for (let i = 0; i < chunk.message.tool_calls.length; i++) {
                const tc = chunk.message.tool_calls[i];
                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: `call_${Date.now()}_${i}`,
                    type: 'function',
                    function: {
                      name: tc.function.name,
                      arguments: typeof tc.function.arguments === 'string'
                        ? tc.function.arguments
                        : JSON.stringify(tc.function.arguments),
                    },
                  },
                };
              }
            }

            if (chunk.done) {
              if (chunk.prompt_eval_count || chunk.eval_count) {
                yield {
                  type: 'usage',
                  usage: {
                    inputTokens: chunk.prompt_eval_count ?? 0,
                    outputTokens: chunk.eval_count ?? 0,
                    totalTokens: (chunk.prompt_eval_count ?? 0) + (chunk.eval_count ?? 0),
                  },
                };
              }
              yield { type: 'done' };
              return;
            }
          } catch {
            // Skip unparseable chunk
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: 'done' };
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (!res.ok) return [this.model];
      const data = await res.json() as any;
      return (data.models ?? []).map((m: any) => m.name);
    } catch {
      return [this.model];
    }
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      return res.ok;
    } catch {
      return false;
    }
  }
}
