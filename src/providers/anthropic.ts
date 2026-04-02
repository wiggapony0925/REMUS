// ─────────────────────────────────────────────────────────────
// Remus — Anthropic Direct Provider
// Uses the Anthropic Messages API directly (no SDK dependency)
// ─────────────────────────────────────────────────────────────

import type {
  LLMProvider,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  Message,
  ToolCall,
} from './types.js';

interface AnthropicConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(config: AnthropicConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'claude-sonnet-4-20250514';
    this.baseUrl = (config.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
  }

  private buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
    };
  }

  /**
   * Convert our generic message format to Anthropic's Messages API format.
   * Anthropic uses a separate `system` param, so we extract system messages.
   */
  private convertMessages(messages: Message[]): {
    system: string;
    messages: unknown[];
  } {
    let system = '';
    const converted: unknown[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        system += (typeof msg.content === 'string' ? msg.content : '') + '\n';
        continue;
      }

      if (msg.role === 'assistant' && msg.tool_calls) {
        // Convert tool_calls to Anthropic's content block format
        const content: unknown[] = [];
        if (typeof msg.content === 'string' && msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          let input: unknown;
          try {
            input = JSON.parse(tc.function.arguments);
          } catch {
            input = { raw: tc.function.arguments };
          }
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
        converted.push({ role: 'assistant', content });
        continue;
      }

      if (msg.role === 'tool') {
        converted.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.tool_call_id,
              content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            },
          ],
        });
        continue;
      }

      converted.push({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : msg.content,
      });
    }

    return { system: system.trim(), messages: converted };
  }

  private convertTools(tools?: import('./types.js').ToolDefinition[]): unknown[] | undefined {
    if (!tools || tools.length === 0) return undefined;
    return tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const { system, messages } = this.convertMessages(request.messages);
    const body: Record<string, unknown> = {
      model: request.model ?? this.model,
      messages,
      max_tokens: request.maxTokens ?? 8192,
      temperature: request.temperature ?? 0.7,
    };
    if (system) body.system = system;
    const tools = this.convertTools(request.tools);
    if (tools) body.tools = tools;

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as any;

    // Parse Anthropic's response format
    let textContent = '';
    const toolCalls: ToolCall[] = [];

    for (const block of data.content ?? []) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        });
      }
    }

    const message: Message = {
      role: 'assistant',
      content: textContent,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };

    return {
      message,
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
        totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      },
      finishReason: data.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
      model: data.model ?? this.model,
    };
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk> {
    const { system, messages } = this.convertMessages(request.messages);
    const body: Record<string, unknown> = {
      model: request.model ?? this.model,
      messages,
      max_tokens: request.maxTokens ?? 8192,
      temperature: request.temperature ?? 0.7,
      stream: true,
    };
    if (system) body.system = system;
    const tools = this.convertTools(request.tools);
    if (tools) body.tools = tools;

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      yield { type: 'error', error: `Anthropic API error (${res.status}): ${errText}` };
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let currentToolId = '';
    let currentToolName = '';
    let currentToolArgs = '';
    let inToolUse = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const payload = trimmed.slice(6);

          try {
            const event = JSON.parse(payload);

            switch (event.type) {
              case 'content_block_start':
                if (event.content_block?.type === 'tool_use') {
                  inToolUse = true;
                  currentToolId = event.content_block.id;
                  currentToolName = event.content_block.name;
                  currentToolArgs = '';
                }
                break;

              case 'content_block_delta':
                if (event.delta?.type === 'text_delta') {
                  yield { type: 'text', text: event.delta.text };
                } else if (event.delta?.type === 'input_json_delta') {
                  currentToolArgs += event.delta.partial_json ?? '';
                }
                break;

              case 'content_block_stop':
                if (inToolUse) {
                  yield {
                    type: 'tool_call',
                    toolCall: {
                      id: currentToolId,
                      type: 'function',
                      function: {
                        name: currentToolName,
                        arguments: currentToolArgs,
                      },
                    },
                  };
                  inToolUse = false;
                }
                break;

              case 'message_delta':
                if (event.usage) {
                  yield {
                    type: 'usage',
                    usage: {
                      inputTokens: 0,
                      outputTokens: event.usage.output_tokens ?? 0,
                      totalTokens: event.usage.output_tokens ?? 0,
                    },
                  };
                }
                break;

              case 'message_stop':
                yield { type: 'done' };
                return;
            }
          } catch {
            // Skip unparseable events
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: 'done' };
  }

  async listModels(): Promise<string[]> {
    return [
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'claude-haiku-3-5-20241022',
    ];
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
