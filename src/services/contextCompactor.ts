// ─────────────────────────────────────────────────────────────
// Remus — Context Auto-Compactor
// Summarize old messages to stay within context windows
// ─────────────────────────────────────────────────────────────

import type { Message, LLMProvider } from '../providers/types.js';

export interface CompactionConfig {
  /** Max tokens before triggering compaction (estimated) */
  maxContextTokens: number;
  /** Number of recent messages to always preserve */
  preserveRecent: number;
  /** Whether to auto-compact or ask the user */
  autoCompact: boolean;
}

const DEFAULT_CONFIG: CompactionConfig = {
  maxContextTokens: 100_000,
  preserveRecent: 10,
  autoCompact: false,
};

/**
 * Rough token estimation: ~4 chars per token for English text.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate total tokens in a message array.
 */
export function estimateMessageTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      total += estimateTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.text) total += estimateTokens(block.text);
        if (block.content) total += estimateTokens(block.content);
      }
    }
    // Tool calls
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += estimateTokens(tc.function.name + tc.function.arguments);
      }
    }
    total += 4; // Message overhead
  }
  return total;
}

/**
 * Check if compaction is needed.
 */
export function needsCompaction(messages: Message[], config?: Partial<CompactionConfig>): boolean {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const totalTokens = estimateMessageTokens(messages);
  return totalTokens > cfg.maxContextTokens;
}

/**
 * Compact messages by summarizing older ones.
 * Keeps the system prompt (messages[0]) and recent messages intact.
 * Summarizes everything in between into a single summary message.
 */
export async function compactMessages(
  messages: Message[],
  provider: LLMProvider,
  model: string,
  config?: Partial<CompactionConfig>,
): Promise<Message[]> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (messages.length <= cfg.preserveRecent + 1) {
    return messages; // Nothing to compact
  }

  const systemPrompt = messages[0]; // Always preserve
  const oldMessages = messages.slice(1, -cfg.preserveRecent);
  const recentMessages = messages.slice(-cfg.preserveRecent);

  if (oldMessages.length === 0) return messages;

  // Build a summary of old messages
  const summaryText = buildSummaryInput(oldMessages);

  try {
    const summaryResponse = await provider.complete({
      messages: [
        {
          role: 'system',
          content: `You are a context summarizer. Summarize the following conversation history into a concise but complete summary that preserves:
1. All important decisions made
2. All files that were read, edited, or created (with paths)
3. All key findings from tool calls
4. The current state of the task
5. Any errors encountered and how they were resolved

Be thorough but concise. Use bullet points. Include file paths and code snippets where relevant.`,
        },
        {
          role: 'user',
          content: summaryText,
        },
      ],
      temperature: 0.3,
      maxTokens: 4096,
      model,
    });

    const summary = typeof summaryResponse.message.content === 'string'
      ? summaryResponse.message.content
      : '';

    // Replace old messages with a compact summary
    const summaryMessage: Message = {
      role: 'user',
      content: `[CONTEXT SUMMARY — The following is a summary of our earlier conversation]\n\n${summary}\n\n[END SUMMARY — The conversation continues below]`,
    };

    return [systemPrompt, summaryMessage, ...recentMessages];
  } catch {
    // If summarization fails, do a simple truncation
    return [systemPrompt, ...recentMessages];
  }
}

/**
 * Build text representation of messages for summarization.
 */
function buildSummaryInput(messages: Message[]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    const role = msg.role.toUpperCase();
    let content = '';

    if (typeof msg.content === 'string') {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content.map(b => b.text ?? b.content ?? '').join('\n');
    }

    if (msg.tool_calls) {
      const calls = msg.tool_calls.map(tc => `  → ${tc.function.name}(${tc.function.arguments.slice(0, 200)})`);
      content += '\n' + calls.join('\n');
    }

    // Truncate very long tool outputs
    if (content.length > 2000 && msg.role === 'tool') {
      content = content.slice(0, 1500) + '\n[...truncated...]';
    }

    parts.push(`[${role}${msg.name ? ` (${msg.name})` : ''}]\n${content}`);
  }

  return parts.join('\n\n');
}

/**
 * Perform a lightweight compaction: just trim tool outputs.
 * Less aggressive than full summarization.
 */
export function trimToolOutputs(messages: Message[], maxToolOutputLength = 500): Message[] {
  return messages.map(msg => {
    if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > maxToolOutputLength) {
      return {
        ...msg,
        content: msg.content.slice(0, maxToolOutputLength) + '\n[...output trimmed...]',
      };
    }
    return msg;
  });
}
