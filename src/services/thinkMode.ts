// ─────────────────────────────────────────────────────────────
// Remus — Think Mode (Chain of Thought)
// Explicit planning and reasoning before execution
// BEATS: Claude Code (no think mode) & Cursor (no think mode)
// ─────────────────────────────────────────────────────────────

import type { LLMProvider, Message } from '../providers/types.js';

export interface ThinkResult {
  plan: string;
  steps: string[];
  risks: string[];
  estimatedComplexity: 'trivial' | 'simple' | 'moderate' | 'complex' | 'massive';
  estimatedToolCalls: number;
  thinkingTime: number; // ms
}

const THINK_PROMPT = `You are in THINK MODE. Before doing anything, analyze this task and create a detailed plan.

Respond with EXACTLY this JSON format (no other text):
{
  "plan": "One paragraph summary of the overall approach",
  "steps": ["Step 1: ...", "Step 2: ...", ...],
  "risks": ["Risk 1: ...", "Risk 2: ..."],
  "estimatedComplexity": "trivial|simple|moderate|complex|massive",
  "estimatedToolCalls": <number>
}

Think about:
1. What files need to be read/modified?
2. What's the safest order of operations?
3. What could go wrong?
4. Are there any edge cases?
5. What tests should be run after?

User's request:
`;

/**
 * Think Mode — makes the LLM plan before executing.
 * 
 * This is a coding superpower. Instead of jumping straight into
 * tool calls, Remus analyzes the task, creates a plan, estimates
 * complexity, and identifies risks BEFORE touching any files.
 * 
 * Neither Claude Code nor Cursor have anything like this.
 */
export async function think(
  provider: LLMProvider,
  model: string,
  query: string,
  context?: string,
): Promise<ThinkResult> {
  const start = Date.now();

  const messages: Message[] = [
    { role: 'system', content: THINK_PROMPT },
  ];

  if (context) {
    messages.push({ role: 'user', content: `Context:\n${context}\n\nTask: ${query}` });
  } else {
    messages.push({ role: 'user', content: query });
  }

  const response = await provider.complete({
    messages,
    temperature: 0.3, // Low temp for reliable JSON
    maxTokens: 2048,
    model,
  });

  const text = typeof response.message.content === 'string' 
    ? response.message.content 
    : '';

  const thinkingTime = Date.now() - start;

  // Parse the JSON response
  try {
    // Extract JSON from possible markdown code blocks
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      plan: parsed.plan ?? 'No plan generated',
      steps: Array.isArray(parsed.steps) ? parsed.steps : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
      estimatedComplexity: parsed.estimatedComplexity ?? 'moderate',
      estimatedToolCalls: parsed.estimatedToolCalls ?? 0,
      thinkingTime,
    };
  } catch {
    // Fallback: use the raw text as the plan
    return {
      plan: text.slice(0, 500),
      steps: text.split('\n').filter(l => /^\d+[\.\)]/.test(l.trim())).slice(0, 10),
      risks: [],
      estimatedComplexity: 'moderate',
      estimatedToolCalls: 0,
      thinkingTime,
    };
  }
}

/**
 * Auto-Fix Pipeline — detect errors, plan fixes, execute, verify.
 * 
 * /autofix runs this pipeline:
 * 1. Detect errors (lint, typecheck, test failures)
 * 2. Think about fixes
 * 3. Apply fixes
 * 4. Verify (re-run checks)
 * 5. Report results
 */
export interface AutoFixResult {
  errorsFound: number;
  errorsFixed: number;
  filesModified: string[];
  verificationPassed: boolean;
  report: string;
  durationMs: number;
}

export const AUTOFIX_DETECT_PROMPT = `Analyze the following error output and identify each distinct error.
For each error, provide:
1. The file path and line number
2. The error message
3. A suggested fix

Respond as JSON:
{
  "errors": [
    {
      "file": "path/to/file.ts",
      "line": 42,
      "message": "Type 'string' is not assignable to type 'number'",
      "suggestedFix": "Change the type annotation to string"
    }
  ]
}`;

export const AUTOFIX_APPLY_PROMPT = `You are in AUTO-FIX mode. Apply the minimum changes needed to fix each error.
Be surgical — change only what's necessary. Do NOT refactor or restructure.
VERIFY: After each fix, mentally check that it doesn't introduce new errors.`;

/**
 * Task Queue — batch multiple tasks and run them sequentially.
 * 
 * /task add "Fix the auth bug"
 * /task add "Add unit tests for UserService"
 * /task add "Update the README"
 * /task run
 * 
 * Remus will execute all tasks in order, tracking progress.
 */
export interface TaskItem {
  id: number;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export class TaskQueue {
  private tasks: TaskItem[] = [];
  private nextId = 1;
  private isRunning = false;

  add(description: string): TaskItem {
    const task: TaskItem = {
      id: this.nextId++,
      description,
      status: 'pending',
    };
    this.tasks.push(task);
    return task;
  }

  remove(id: number): boolean {
    const idx = this.tasks.findIndex(t => t.id === id);
    if (idx === -1) return false;
    if (this.tasks[idx]!.status === 'running') return false;
    this.tasks.splice(idx, 1);
    return true;
  }

  list(): TaskItem[] {
    return [...this.tasks];
  }

  getNext(): TaskItem | null {
    return this.tasks.find(t => t.status === 'pending') ?? null;
  }

  markRunning(id: number): void {
    const task = this.tasks.find(t => t.id === id);
    if (task) {
      task.status = 'running';
      task.startedAt = Date.now();
    }
  }

  markCompleted(id: number, result: string): void {
    const task = this.tasks.find(t => t.id === id);
    if (task) {
      task.status = 'completed';
      task.result = result;
      task.completedAt = Date.now();
    }
  }

  markFailed(id: number, error: string): void {
    const task = this.tasks.find(t => t.id === id);
    if (task) {
      task.status = 'failed';
      task.error = error;
      task.completedAt = Date.now();
    }
  }

  clear(): void {
    this.tasks = [];
    this.nextId = 1;
  }

  getProgress(): { total: number; completed: number; failed: number; pending: number } {
    return {
      total: this.tasks.length,
      completed: this.tasks.filter(t => t.status === 'completed').length,
      failed: this.tasks.filter(t => t.status === 'failed').length,
      pending: this.tasks.filter(t => t.status === 'pending').length,
    };
  }

  setRunning(running: boolean): void {
    this.isRunning = running;
  }

  getIsRunning(): boolean {
    return this.isRunning;
  }
}
