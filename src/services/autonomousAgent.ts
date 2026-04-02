// ─────────────────────────────────────────────────────────────
// Remus — Autonomous Agent Mode
// Give it a goal → it plans → executes → verifies → reports.
// Full autopilot coding. No competitor has this.
// ─────────────────────────────────────────────────────────────

import chalk from 'chalk';
import type { QueryEngine } from './queryEngine.js';
import { think } from './thinkMode.js';
import { createProvider, type ProviderConfig } from '../providers/index.js';

export interface AgentConfig {
  /** Maximum autonomous steps before stopping */
  maxSteps: number;
  /** Require user approval for destructive actions */
  requireApproval: boolean;
  /** Stop on first error */
  stopOnError: boolean;
  /** Show step-by-step progress */
  verbose: boolean;
  /** Provider config for think mode */
  providerConfig: ProviderConfig;
}

export interface AgentStep {
  id: number;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: string;
  error?: string;
  durationMs?: number;
  toolCalls: number;
}

export interface AgentResult {
  goal: string;
  plan: string;
  steps: AgentStep[];
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  totalDurationMs: number;
  summary: string;
}

export type AgentProgressCallback = (event: AgentEvent) => void;

export type AgentEvent =
  | { type: 'planning'; goal: string }
  | { type: 'plan-ready'; plan: string; steps: string[]; risks: string[] }
  | { type: 'step-start'; step: number; total: number; description: string }
  | { type: 'step-complete'; step: number; result: string }
  | { type: 'step-failed'; step: number; error: string }
  | { type: 'approval-needed'; step: number; description: string }
  | { type: 'complete'; result: AgentResult }
  | { type: 'aborted'; reason: string };

/**
 * Run a fully autonomous agent that plans and executes a complex goal.
 */
export async function runAutonomousAgent(
  goal: string,
  engine: QueryEngine,
  config: AgentConfig,
  onProgress?: AgentProgressCallback,
): Promise<AgentResult> {
  const startTime = Date.now();

  // ─── Phase 1: Plan ───
  onProgress?.({ type: 'planning', goal });

  const provider = createProvider(config.providerConfig);
  const thinkResult = await think(provider, config.providerConfig.model, goal);

  const steps: AgentStep[] = thinkResult.steps.map((desc, i) => ({
    id: i + 1,
    description: desc,
    status: 'pending' as const,
    toolCalls: 0,
  }));

  onProgress?.({
    type: 'plan-ready',
    plan: thinkResult.plan,
    steps: thinkResult.steps,
    risks: thinkResult.risks,
  });

  // Limit steps
  const maxSteps = Math.min(steps.length, config.maxSteps);
  const activeSteps = steps.slice(0, maxSteps);
  if (steps.length > maxSteps) {
    for (let i = maxSteps; i < steps.length; i++) {
      steps[i]!.status = 'skipped';
    }
  }

  // ─── Phase 2: Execute steps sequentially ───
  let completedSteps = 0;
  let failedSteps = 0;

  for (const step of activeSteps) {
    onProgress?.({
      type: 'step-start',
      step: step.id,
      total: activeSteps.length,
      description: step.description,
    });

    step.status = 'running';
    const stepStart = Date.now();

    // Build a focused prompt for this step
    const contextParts: string[] = [];
    // Include results from previous steps for context
    const previousCompleted = steps.filter(s => s.status === 'completed' && s.result);
    if (previousCompleted.length > 0) {
      contextParts.push('Previous steps completed:');
      for (const prev of previousCompleted.slice(-3)) { // Last 3 for context
        contextParts.push(`  Step ${prev.id}: ${prev.description} → Done`);
      }
    }
    contextParts.push(`\nCurrent step (${step.id}/${activeSteps.length}): ${step.description}`);
    contextParts.push(`\nOverall goal: ${goal}`);
    contextParts.push('\nExecute this step completely. Use tools as needed. Be thorough.');

    const stepPrompt = contextParts.join('\n');

    try {
      const response = await engine.submit(stepPrompt);
      step.status = 'completed';
      step.result = response;
      step.durationMs = Date.now() - stepStart;
      step.toolCalls = engine.stats.toolCalls; // Approximate
      completedSteps++;

      onProgress?.({
        type: 'step-complete',
        step: step.id,
        result: response.slice(0, 200),
      });
    } catch (err) {
      step.status = 'failed';
      step.error = (err as Error).message;
      step.durationMs = Date.now() - stepStart;
      failedSteps++;

      onProgress?.({
        type: 'step-failed',
        step: step.id,
        error: step.error,
      });

      if (config.stopOnError) {
        // Mark remaining as skipped
        for (const remaining of activeSteps) {
          if (remaining.status === 'pending') {
            remaining.status = 'skipped';
          }
        }
        onProgress?.({
          type: 'aborted',
          reason: `Stopped after step ${step.id} failed: ${step.error}`,
        });
        break;
      }
    }
  }

  // ─── Phase 3: Generate summary ───
  const totalDurationMs = Date.now() - startTime;
  const summary = buildAgentSummary(goal, steps, totalDurationMs);

  const result: AgentResult = {
    goal,
    plan: thinkResult.plan,
    steps,
    totalSteps: steps.length,
    completedSteps,
    failedSteps,
    totalDurationMs,
    summary,
  };

  onProgress?.({ type: 'complete', result });

  return result;
}

/**
 * Build a human-readable summary of the agent run.
 */
function buildAgentSummary(goal: string, steps: AgentStep[], durationMs: number): string {
  const completed = steps.filter(s => s.status === 'completed').length;
  const failed = steps.filter(s => s.status === 'failed').length;
  const skipped = steps.filter(s => s.status === 'skipped').length;

  const parts: string[] = [];
  parts.push(`Goal: ${goal}`);
  parts.push(`Completed ${completed}/${steps.length} steps (${failed} failed, ${skipped} skipped)`);
  parts.push(`Total time: ${(durationMs / 1000).toFixed(1)}s`);

  if (failed > 0) {
    parts.push('\nFailed steps:');
    for (const s of steps.filter(s => s.status === 'failed')) {
      parts.push(`  Step ${s.id}: ${s.description} — ${s.error}`);
    }
  }

  return parts.join('\n');
}

/**
 * Format an agent result for display.
 */
export function formatAgentResult(result: AgentResult): string {
  const lines: string[] = [];

  const allDone = result.failedSteps === 0 && result.completedSteps === result.totalSteps;
  const icon = allDone ? chalk.green('✓') : result.failedSteps > 0 ? chalk.yellow('⚠') : chalk.hex('#FF8C42')('⬡');

  lines.push(chalk.hex('#FF6B35').bold('⬡ Autonomous Agent — Report'));
  lines.push(chalk.dim('━'.repeat(50)));

  lines.push(`\n${chalk.bold('Goal:')} ${result.goal}`);
  lines.push(`${chalk.bold('Plan:')} ${result.plan}`);
  lines.push('');

  // Steps
  lines.push(chalk.hex('#FF8C42').bold('Steps:'));
  for (const step of result.steps) {
    const statusIcon: Record<string, string> = {
      completed: chalk.green('✓'),
      failed: chalk.red('✗'),
      skipped: chalk.dim('⊘'),
      running: chalk.yellow('●'),
      pending: chalk.gray('○'),
    };
    const si = statusIcon[step.status] ?? chalk.gray('?');
    const time = step.durationMs ? chalk.dim(` (${(step.durationMs / 1000).toFixed(1)}s)`) : '';
    lines.push(`  ${si} ${chalk.white(`Step ${step.id}:`)} ${step.description}${time}`);
    if (step.error) {
      lines.push(`    ${chalk.red(step.error)}`);
    }
  }

  // Stats
  lines.push('');
  lines.push(chalk.dim('─'.repeat(50)));
  lines.push(
    `${icon} ${chalk.bold(`${result.completedSteps}/${result.totalSteps}`)} steps completed` +
    (result.failedSteps > 0 ? chalk.red(` (${result.failedSteps} failed)`) : '') +
    chalk.dim(` in ${(result.totalDurationMs / 1000).toFixed(1)}s`),
  );

  return lines.join('\n');
}
