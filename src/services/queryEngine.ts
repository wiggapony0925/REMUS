// ─────────────────────────────────────────────────────────────
// Remus — Query Engine (v2)
// The core agent loop: prompt → LLM → tools → repeat
// With: cost tracking, undo, context compaction, retry
// ─────────────────────────────────────────────────────────────

import type { LLMProvider, Message, ToolCall, ToolDefinition } from '../providers/types.js';
import type { Tool, ToolResult, ToolContext } from '../tools/types.js';
import { buildSystemPrompt } from '../constants/prompts.js';
import { getToolDefinitions, findTool } from '../tools/index.js';
import { CostTracker } from './costTracker.js';
import { UndoManager } from './undo.js';
import { estimateMessageTokens, needsCompaction, compactMessages, trimToolOutputs } from './contextCompactor.js';
import chalk from 'chalk';

export interface QueryEngineConfig {
  provider: LLMProvider;
  tools: Tool[];
  cwd: string;
  model: string;
  maxTurns?: number;
  temperature?: number;
  maxTokens?: number;
  maxContextTokens?: number;
  verbose?: boolean;
  customInstructions?: string;
  enableUndo?: boolean;
  enableCostTracking?: boolean;
  autoCompact?: boolean;
  onText?: (text: string) => void;
  onToolCall?: (name: string, input: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: ToolResult) => void;
  onTurnComplete?: (turn: number) => void;
  onError?: (error: Error) => void;
  onCostUpdate?: (cost: string) => void;
  onRetry?: (attempt: number, delay: number, error: Error) => void;
}

export interface ConversationTurn {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: Array<{ name: string; result: ToolResult; callId: string }>;
  usage?: { inputTokens: number; outputTokens: number };
  timestamp: number;
}

export interface SessionStats {
  turns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  toolCalls: number;
  startTime: number;
  errors: number;
}

export class QueryEngine {
  private provider: LLMProvider;
  private tools: Tool[];
  private toolDefs: ToolDefinition[];
  private cwd: string;
  private model: string;
  private maxTurns: number;
  private temperature: number;
  private maxTokens: number;
  private maxContextTokens: number;
  private verbose: boolean;
  private messages: Message[] = [];
  private toolContext: ToolContext;
  private history: ConversationTurn[] = [];
  private abortController = new AbortController();

  // New features
  readonly costTracker: CostTracker;
  readonly undoManager: UndoManager;
  private enableUndo: boolean;
  private enableCostTracking: boolean;
  private autoCompact: boolean;

  // Callbacks
  private onText: (text: string) => void;
  private onToolCall: (name: string, input: Record<string, unknown>) => void;
  private onToolResult: (name: string, result: ToolResult) => void;
  private onTurnComplete: (turn: number) => void;
  private onError: (error: Error) => void;
  private onCostUpdate: (cost: string) => void;
  private onRetry: (attempt: number, delay: number, error: Error) => void;

  stats: SessionStats = {
    turns: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    toolCalls: 0,
    startTime: Date.now(),
    errors: 0,
  };

  constructor(config: QueryEngineConfig) {
    this.provider = config.provider;
    this.tools = config.tools;
    this.toolDefs = getToolDefinitions(config.tools);
    this.cwd = config.cwd;
    this.model = config.model;
    this.maxTurns = config.maxTurns ?? 50;
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens ?? 8192;
    this.maxContextTokens = config.maxContextTokens ?? 100_000;
    this.verbose = config.verbose ?? false;
    this.onText = config.onText ?? (() => {});
    this.onToolCall = config.onToolCall ?? (() => {});
    this.onToolResult = config.onToolResult ?? (() => {});
    this.onTurnComplete = config.onTurnComplete ?? (() => {});
    this.onError = config.onError ?? (() => {});
    this.onCostUpdate = config.onCostUpdate ?? (() => {});
    this.onRetry = config.onRetry ?? (() => {});

    // Features
    this.enableUndo = config.enableUndo ?? true;
    this.enableCostTracking = config.enableCostTracking ?? true;
    this.autoCompact = config.autoCompact ?? false;
    this.costTracker = new CostTracker();
    this.undoManager = new UndoManager();

    this.toolContext = {
      cwd: this.cwd,
      readFiles: new Map(),
      abortSignal: this.abortController.signal,
    };

    // Build system prompt
    const systemPrompt = buildSystemPrompt({
      cwd: this.cwd,
      model: this.model,
      providerName: this.provider.name,
      tools: this.tools.map(t => t.name),
      customInstructions: config.customInstructions,
    });

    this.messages = [
      { role: 'system', content: systemPrompt },
    ];
  }

  /**
   * Submit a user message and run the full agent loop.
   * Returns the final assistant response text.
   */
  async submit(userMessage: string): Promise<string> {
    // Add user message
    this.messages.push({ role: 'user', content: userMessage });
    this.history.push({
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    });

    // Auto-compact if context is getting large
    if (this.autoCompact && needsCompaction(this.messages, { maxContextTokens: this.maxContextTokens })) {
      try {
        if (this.verbose) {
          console.error(chalk.dim('  [auto-compacting context...]'));
        }
        this.messages = await compactMessages(this.messages, this.provider, this.model, {
          maxContextTokens: this.maxContextTokens,
          preserveRecent: 10,
        });
      } catch (err) {
        if (this.verbose) {
          console.error(chalk.dim(`  [compaction failed: ${(err as Error).message}]`));
        }
        // Fallback: trim tool outputs
        this.messages = trimToolOutputs(this.messages);
      }
    }

    let finalText = '';
    let turn = 0;

    while (turn < this.maxTurns) {
      turn++;
      this.stats.turns++;

      if (this.verbose) {
        const estTokens = estimateMessageTokens(this.messages);
        console.error(chalk.dim(`  [turn ${turn}/${this.maxTurns}] (~${estTokens.toLocaleString()} ctx tokens)`));
      }

      try {
        // Stream the response
        let responseText = '';
        const toolCalls: ToolCall[] = [];
        let inputTokens = 0;
        let outputTokens = 0;

        const stream = this.provider.stream({
          messages: this.messages,
          tools: this.toolDefs,
          temperature: this.temperature,
          maxTokens: this.maxTokens,
          model: this.model,
        });

        for await (const chunk of stream) {
          switch (chunk.type) {
            case 'text':
              responseText += chunk.text ?? '';
              this.onText(chunk.text ?? '');
              break;
            case 'tool_call':
              if (chunk.toolCall) {
                toolCalls.push(chunk.toolCall as ToolCall);
              }
              break;
            case 'usage':
              inputTokens = chunk.usage?.inputTokens ?? 0;
              outputTokens = chunk.usage?.outputTokens ?? 0;
              this.stats.totalInputTokens += inputTokens;
              this.stats.totalOutputTokens += outputTokens;
              break;
            case 'error':
              this.onError(new Error(chunk.error));
              this.stats.errors++;
              break;
          }
        }

        // Add assistant message
        const assistantMsg: Message = {
          role: 'assistant',
          content: responseText,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        };
        this.messages.push(assistantMsg);

        // Track cost
        if (this.enableCostTracking && (inputTokens > 0 || outputTokens > 0)) {
          this.costTracker.record(this.model, inputTokens, outputTokens);
          this.onCostUpdate(this.costTracker.getShortCost());
        }

        this.history.push({
          role: 'assistant',
          content: responseText,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          usage: { inputTokens, outputTokens },
          timestamp: Date.now(),
        });

        // If no tool calls, we're done
        if (toolCalls.length === 0) {
          finalText = responseText;
          this.onTurnComplete(turn);
          break;
        }

        // Execute tool calls
        const toolResults = await this.executeToolCalls(toolCalls);

        // Add tool results as messages
        for (const tr of toolResults) {
          this.messages.push({
            role: 'tool',
            content: tr.result.output,
            tool_call_id: tr.callId,
            name: tr.name,
          });
        }

        this.history.push({
          role: 'tool',
          content: toolResults.map(tr => `[${tr.name}] ${tr.result.output}`).join('\n\n'),
          toolResults,
          timestamp: Date.now(),
        });

        this.onTurnComplete(turn);

        // Continue the loop — the LLM will process tool results and decide next action

      } catch (err) {
        this.stats.errors++;
        const error = err as Error;
        this.onError(error);

        // Smart retry logic
        const msg = error.message.toLowerCase();
        const isRetryable = msg.includes('429') || msg.includes('500') || msg.includes('502') ||
          msg.includes('503') || msg.includes('rate limit') || msg.includes('overloaded') ||
          msg.includes('timeout') || msg.includes('econnreset') || msg.includes('insufficient_quota');

        if (isRetryable && turn < this.maxTurns) {
          const delay = Math.min(1000 * Math.pow(2, Math.min(turn - 1, 5)), 60000);
          this.onRetry(turn, delay, error);
          if (this.verbose) {
            console.error(chalk.yellow(`  [retrying in ${(delay / 1000).toFixed(0)}s — ${error.message.slice(0, 80)}]`));
          }
          await new Promise(r => setTimeout(r, delay));
          turn--; // Don't count this as a turn
          this.stats.turns--;
          continue;
        }

        finalText = `Error: ${error.message}`;
        break;
      }
    }

    if (turn >= this.maxTurns) {
      finalText += '\n\n[Reached maximum turns limit]';
    }

    return finalText;
  }

  /**
   * Execute one or more tool calls in parallel.
   */
  private async executeToolCalls(
    toolCalls: ToolCall[]
  ): Promise<Array<{ name: string; result: ToolResult; callId: string }>> {
    const results: Array<{ name: string; result: ToolResult; callId: string }> = [];

    // Group into read-only (parallelizable) and write (sequential) tools
    const readOnlyCalls: Array<{ tc: ToolCall; tool: Tool }> = [];
    const writeCalls: Array<{ tc: ToolCall; tool: Tool }> = [];

    for (const tc of toolCalls) {
      const tool = findTool(this.tools, tc.function.name);
      if (!tool) {
        results.push({
          name: tc.function.name,
          callId: tc.id,
          result: {
            output: `Unknown tool: ${tc.function.name}. Available tools: ${this.tools.map(t => t.name).join(', ')}`,
            isError: true,
            error: 'UNKNOWN_TOOL',
          },
        });
        continue;
      }

      if (tool.isReadOnly) {
        readOnlyCalls.push({ tc, tool });
      } else {
        writeCalls.push({ tc, tool });
      }
    }

    // Execute read-only tools in parallel
    if (readOnlyCalls.length > 0) {
      const parallelResults = await Promise.all(
        readOnlyCalls.map(({ tc, tool }) => this.executeSingleTool(tc, tool))
      );
      results.push(...parallelResults);
    }

    // Execute write tools sequentially
    for (const { tc, tool } of writeCalls) {
      const result = await this.executeSingleTool(tc, tool);
      results.push(result);
    }

    return results;
  }

  private async executeSingleTool(
    tc: ToolCall,
    tool: Tool
  ): Promise<{ name: string; result: ToolResult; callId: string }> {
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(tc.function.arguments);
    } catch {
      return {
        name: tc.function.name,
        callId: tc.id,
        result: {
          output: `Invalid tool arguments: ${tc.function.arguments}`,
          isError: true,
          error: 'INVALID_ARGS',
        },
      };
    }

    this.onToolCall(tc.function.name, input);
    this.stats.toolCalls++;

    try {
      // Undo: snapshot file before write operations
      if (this.enableUndo && !tool.isReadOnly) {
        const filePath = (input.file_path ?? input.path) as string | undefined;
        if (filePath) {
          const { resolve } = await import('path');
          const fullPath = resolve(this.cwd, filePath);
          // We'll snapshot when we have the new content (post-call)
          // For now, create a pre-snapshot
          const { existsSync, readFileSync } = await import('fs');
          if (existsSync(fullPath)) {
            const oldContent = readFileSync(fullPath, 'utf-8');
            // Store for post-call comparison
            (input as any).__preContent = oldContent;
            (input as any).__fullPath = fullPath;
          }
        }
      }

      const result = await tool.call(input, this.toolContext);

      // Undo: record the change after successful write
      if (this.enableUndo && !tool.isReadOnly && !result.isError) {
        const fullPath = (input as any).__fullPath as string | undefined;
        if (fullPath) {
          const { existsSync, readFileSync } = await import('fs');
          if (existsSync(fullPath)) {
            const newContent = readFileSync(fullPath, 'utf-8');
            const preContent = (input as any).__preContent ?? '';
            if (newContent !== preContent) {
              const description = result.output.split('\n')[0].slice(0, 100);
              this.undoManager.snapshot(fullPath, newContent, 'edit', tc.function.name, description);
            }
          }
        }
      }

      this.onToolResult(tc.function.name, result);
      return { name: tc.function.name, callId: tc.id, result };
    } catch (err) {
      const result: ToolResult = {
        output: `Tool execution error: ${(err as Error).message}`,
        isError: true,
        error: (err as Error).message,
      };
      this.onToolResult(tc.function.name, result);
      return { name: tc.function.name, callId: tc.id, result };
    }
  }

  /**
   * Reset the conversation (keep system prompt).
   */
  reset(): void {
    this.messages = [this.messages[0]!]; // Keep system prompt
    this.history = [];
    this.toolContext.readFiles.clear();
    this.costTracker.reset();
    this.stats = {
      turns: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      toolCalls: 0,
      startTime: Date.now(),
      errors: 0,
    };
  }

  /**
   * Manually compact the conversation context.
   * Returns the number of tokens saved.
   */
  async compact(): Promise<number> {
    const beforeTokens = estimateMessageTokens(this.messages);
    this.messages = await compactMessages(this.messages, this.provider, this.model, {
      maxContextTokens: this.maxContextTokens,
      preserveRecent: 10,
    });
    const afterTokens = estimateMessageTokens(this.messages);
    return beforeTokens - afterTokens;
  }

  /**
   * Get estimated context token count.
   */
  getContextTokens(): number {
    return estimateMessageTokens(this.messages);
  }

  /**
   * Abort any in-progress requests.
   */
  abort(): void {
    this.abortController.abort();
    this.abortController = new AbortController();
    this.toolContext.abortSignal = this.abortController.signal;
  }

  getHistory(): ConversationTurn[] {
    return [...this.history];
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  setCwd(cwd: string): void {
    this.cwd = cwd;
    this.toolContext.cwd = cwd;
  }
}
