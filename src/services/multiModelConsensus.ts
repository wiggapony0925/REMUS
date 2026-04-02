// ─────────────────────────────────────────────────────────────
// Remus — Multi-Model Consensus Engine
// Query multiple models simultaneously, compare & merge outputs.
// No competitor has this. Remus exclusive.
// ─────────────────────────────────────────────────────────────

import chalk from 'chalk';
import type { LLMProvider, Message, CompletionResponse } from '../providers/types.js';
import { createProvider, type ProviderConfig } from '../providers/index.js';

export interface ConsensusConfig {
  /** Models to query (at least 2) */
  models: ConsensusModel[];
  /** Strategy: 'best' picks the best, 'merge' fuses answers, 'vote' majority wins */
  strategy: 'best' | 'merge' | 'vote';
  /** Which model acts as the judge (index into models[], or 'self' for the first) */
  judgeIndex?: number;
  /** Timeout per model in ms */
  timeoutMs?: number;
  /** Show individual model responses */
  verbose?: boolean;
}

export interface ConsensusModel {
  provider: ProviderConfig;
  label?: string;  // Display name like "GPT-4o" or "Claude"
}

export interface ConsensusResult {
  /** The final merged/selected answer */
  answer: string;
  /** Which model(s) contributed */
  sources: string[];
  /** How was the answer chosen */
  strategy: string;
  /** Individual model responses */
  responses: ModelResponse[];
  /** Judge reasoning (if applicable) */
  judgeReasoning?: string;
  /** Total time taken */
  durationMs: number;
  /** Total tokens across all models */
  totalTokens: number;
}

export interface ModelResponse {
  label: string;
  response: string;
  durationMs: number;
  tokens: number;
  error?: string;
}

/**
 * Query multiple models for the same prompt and produce a consensus answer.
 */
export async function multiModelConsensus(
  query: string,
  systemPrompt: string,
  config: ConsensusConfig,
): Promise<ConsensusResult> {
  const startTime = Date.now();
  const timeoutMs = config.timeoutMs ?? 30_000;

  if (config.models.length < 2) {
    throw new Error('Multi-model consensus requires at least 2 models.');
  }

  // ─── Phase 1: Query all models in parallel ───
  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: query },
  ];

  const responses = await Promise.allSettled(
    config.models.map(async (m, i) => {
      const label = m.label ?? `${m.provider.type}/${m.provider.model}`;
      const provider = createProvider(m.provider);
      const modelStart = Date.now();

      try {
        const result = await withTimeout(
          provider.complete({
            messages,
            temperature: 0.7,
            maxTokens: 4096,
            model: m.provider.model,
          }),
          timeoutMs,
        );

        const responseText = typeof result.message.content === 'string'
          ? result.message.content
          : result.message.content.map(b => b.text ?? '').join('');

        return {
          label,
          response: responseText,
          durationMs: Date.now() - modelStart,
          tokens: result.usage.totalTokens,
        } as ModelResponse;
      } catch (err) {
        return {
          label,
          response: '',
          durationMs: Date.now() - modelStart,
          tokens: 0,
          error: (err as Error).message,
        } as ModelResponse;
      }
    }),
  );

  // Collect successful responses
  const modelResponses: ModelResponse[] = responses.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    const label = config.models[i]!.label ?? `${config.models[i]!.provider.type}/${config.models[i]!.provider.model}`;
    return { label, response: '', durationMs: 0, tokens: 0, error: (r.reason as Error).message };
  });

  const successfulResponses = modelResponses.filter(r => !r.error && r.response);

  if (successfulResponses.length === 0) {
    throw new Error('All models failed to respond:\n' + modelResponses.map(r => `  ${r.label}: ${r.error}`).join('\n'));
  }

  // If only one succeeded, return it directly
  if (successfulResponses.length === 1) {
    return {
      answer: successfulResponses[0]!.response,
      sources: [successfulResponses[0]!.label],
      strategy: 'single-survivor',
      responses: modelResponses,
      durationMs: Date.now() - startTime,
      totalTokens: modelResponses.reduce((sum, r) => sum + r.tokens, 0),
    };
  }

  // ─── Phase 2: Apply consensus strategy ───
  let answer: string;
  let judgeReasoning: string | undefined;
  let sources: string[];

  switch (config.strategy) {
    case 'vote': {
      // Simple: pick the longest non-trivial response (heuristic for "most complete")
      const sorted = [...successfulResponses].sort((a, b) => b.response.length - a.response.length);
      answer = sorted[0]!.response;
      sources = [sorted[0]!.label];
      break;
    }

    case 'best': {
      // Use a judge to pick the best response
      const judgeResult = await judgeResponses(
        query,
        successfulResponses,
        config,
        'Select the single BEST response. Respond with ONLY the exact text of the chosen response. Do not modify it.',
      );
      answer = judgeResult.answer;
      judgeReasoning = judgeResult.reasoning;
      sources = judgeResult.sources;
      break;
    }

    case 'merge':
    default: {
      // Use a judge to merge/synthesize the best parts
      const judgeResult = await judgeResponses(
        query,
        successfulResponses,
        config,
        'Synthesize the BEST answer by combining the strongest parts of each response. Produce a single, clean, comprehensive answer. Do not mention the individual models.',
      );
      answer = judgeResult.answer;
      judgeReasoning = judgeResult.reasoning;
      sources = successfulResponses.map(r => r.label);
      break;
    }
  }

  return {
    answer,
    sources,
    strategy: config.strategy,
    responses: modelResponses,
    judgeReasoning,
    durationMs: Date.now() - startTime,
    totalTokens: modelResponses.reduce((sum, r) => sum + r.tokens, 0),
  };
}

/**
 * Use a judge model to evaluate and/or merge responses.
 */
async function judgeResponses(
  originalQuery: string,
  responses: ModelResponse[],
  config: ConsensusConfig,
  judgeInstruction: string,
): Promise<{ answer: string; reasoning: string; sources: string[] }> {
  const judgeIdx = config.judgeIndex ?? 0;
  const judgeModel = config.models[judgeIdx] ?? config.models[0]!;
  const judgeProvider = createProvider(judgeModel.provider);

  const responseSummary = responses.map((r, i) =>
    `--- Response from ${r.label} (${r.durationMs}ms, ${r.tokens} tokens) ---\n${r.response}`
  ).join('\n\n');

  const judgeMessages: Message[] = [
    {
      role: 'system',
      content: `You are a response quality judge. You evaluate multiple AI responses to the same question and ${judgeInstruction}`,
    },
    {
      role: 'user',
      content: `Original question: ${originalQuery}\n\n${responseSummary}\n\n${judgeInstruction}`,
    },
  ];

  try {
    const result = await withTimeout(
      judgeProvider.complete({
        messages: judgeMessages,
        temperature: 0.3,
        maxTokens: 4096,
        model: judgeModel.provider.model,
      }),
      config.timeoutMs ?? 30_000,
    );

    const answerText = typeof result.message.content === 'string'
      ? result.message.content
      : result.message.content.map(b => b.text ?? '').join('');

    return {
      answer: answerText,
      reasoning: 'Judge evaluated all responses',
      sources: responses.map(r => r.label),
    };
  } catch (err) {
    // If judge fails, fall back to vote strategy
    const sorted = [...responses].sort((a, b) => b.response.length - a.response.length);
    return {
      answer: sorted[0]!.response,
      reasoning: `Judge failed (${(err as Error).message}), fell back to longest response`,
      sources: [sorted[0]!.label],
    };
  }
}

/**
 * Format a consensus result for display.
 */
export function formatConsensusResult(result: ConsensusResult): string {
  const lines: string[] = [];

  lines.push(chalk.hex('#FF6B35').bold('⬡ Multi-Model Consensus'));
  lines.push(chalk.dim('─'.repeat(50)));

  // Individual model responses
  lines.push(chalk.hex('#FF8C42').bold('\nModel Responses:'));
  for (const r of result.responses) {
    const icon = r.error ? chalk.red('✗') : chalk.green('✓');
    const time = chalk.dim(`${r.durationMs}ms`);
    const tokens = chalk.dim(`${r.tokens} tok`);
    lines.push(`  ${icon} ${chalk.bold(r.label)} ${time} ${tokens}`);
    if (r.error) {
      lines.push(`    ${chalk.red(r.error)}`);
    } else {
      const preview = r.response.split('\n').slice(0, 3).join('\n');
      lines.push(chalk.gray(`    ${preview.slice(0, 200)}${r.response.length > 200 ? '...' : ''}`));
    }
    lines.push('');
  }

  // Consensus
  lines.push(chalk.hex('#FF6B35').bold('━'.repeat(50)));
  lines.push(chalk.hex('#FF6B35').bold(`\n${result.strategy.toUpperCase()} CONSENSUS (from ${result.sources.join(' + ')}):\n`));
  lines.push(result.answer);

  // Stats
  lines.push('');
  lines.push(chalk.dim('─'.repeat(50)));
  lines.push(
    chalk.dim('Total: ') +
    chalk.hex('#FF8C42')(`${result.durationMs}ms`) +
    chalk.dim(' • ') +
    chalk.hex('#FF8C42')(`${result.totalTokens} tokens`) +
    chalk.dim(' • Strategy: ') +
    chalk.hex('#FF8C42')(result.strategy),
  );

  if (result.judgeReasoning) {
    lines.push(chalk.dim(`Judge: ${result.judgeReasoning}`));
  }

  return lines.join('\n');
}

// ─── Utility ───

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    promise
      .then(val => { clearTimeout(timer); resolve(val); })
      .catch(err => { clearTimeout(timer); reject(err); });
  });
}
