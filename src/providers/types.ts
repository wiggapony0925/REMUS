// ─────────────────────────────────────────────────────────────
// Remus — LLM Provider Interface
// Pluggable backend: Ollama, OpenAI, OpenRouter, Anthropic, etc.
// ─────────────────────────────────────────────────────────────

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  name?: string;
}

export interface ContentBlock {
  type: 'text' | 'image_url' | 'tool_use' | 'tool_result';
  text?: string;
  image_url?: { url: string };
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'done' | 'error' | 'usage';
  text?: string;
  toolCall?: Partial<ToolCall>;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface CompletionRequest {
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  model?: string;
}

export interface CompletionResponse {
  message: Message;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  model: string;
}

export interface LLMProvider {
  name: string;
  /** Perform a chat completion (non-streaming) */
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  /** Perform a streaming chat completion */
  stream(request: CompletionRequest): AsyncGenerator<StreamChunk>;
  /** List available models */
  listModels(): Promise<string[]>;
  /** Test connectivity */
  ping(): Promise<boolean>;
}
