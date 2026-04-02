// ─────────────────────────────────────────────────────────────
// Remus — Tool System Types
// Every tool implements this interface
// ─────────────────────────────────────────────────────────────

import type { ToolDefinition } from '../providers/types.js';

export interface ToolInput {
  [key: string]: unknown;
}

export interface ToolResult {
  output: string;
  error?: string;
  isError?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ToolContext {
  cwd: string;
  abortSignal?: AbortSignal;
  /** Files the assistant has already read this session */
  readFiles: Map<string, { content: string; mtime: number }>;
  /** Callback for streaming progress */
  onProgress?: (text: string) => void;
}

export interface Tool {
  /** Unique name used in LLM tool calls */
  name: string;
  /** Short description for the LLM */
  description: string;
  /** Detailed instructions for the LLM on how to use this tool */
  prompt: string;
  /** JSON schema for the tool's input parameters */
  inputSchema: Record<string, unknown>;
  /** Whether this tool only reads (doesn't modify) the filesystem */
  isReadOnly: boolean;

  /** Execute the tool */
  call(input: ToolInput, context: ToolContext): Promise<ToolResult>;

  /** Convert to LLM tool definition format */
  toDefinition(): ToolDefinition;
}

/**
 * Base class for tools with common functionality
 */
export abstract class BaseTool implements Tool {
  abstract name: string;
  abstract description: string;
  abstract prompt: string;
  abstract inputSchema: Record<string, unknown>;
  isReadOnly = false;

  abstract call(input: ToolInput, context: ToolContext): Promise<ToolResult>;

  toDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description + '\n\n' + this.prompt,
        parameters: this.inputSchema,
      },
    };
  }
}
