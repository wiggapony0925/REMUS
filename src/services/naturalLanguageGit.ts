// ─────────────────────────────────────────────────────────────
// Remus — Natural Language Git
// Full git operations via plain English. No more memorizing
// git commands. Just say what you want.
// ─────────────────────────────────────────────────────────────

import { execSync } from 'child_process';
import chalk from 'chalk';

export interface GitIntentResult {
  /** The original natural language input */
  input: string;
  /** Detected intent */
  intent: GitIntent;
  /** Git commands to execute */
  commands: string[];
  /** Human-readable explanation */
  explanation: string;
  /** Whether this is destructive */
  destructive: boolean;
  /** Confidence (0-1) */
  confidence: number;
}

export type GitIntent =
  | 'status' | 'log' | 'diff' | 'show'
  | 'commit' | 'add' | 'push' | 'pull'
  | 'branch-create' | 'branch-switch' | 'branch-delete' | 'branch-list'
  | 'merge' | 'rebase'
  | 'stash' | 'stash-pop'
  | 'reset' | 'revert'
  | 'cherry-pick'
  | 'tag' | 'tag-list'
  | 'remote' | 'clone'
  | 'blame'
  | 'unknown';

interface IntentPattern {
  patterns: RegExp[];
  intent: GitIntent;
  destructive: boolean;
  buildCommand: (match: RegExpMatchArray | null, input: string) => string[];
  explanation: (input: string) => string;
}

const INTENT_PATTERNS: IntentPattern[] = [
  // ─── Status & Info ───
  {
    patterns: [
      /what.*(changed|modified|status|uncommitted)/i,
      /show\s+(me\s+)?status/i,
      /git\s+status/i,
      /what.*(dirty|clean)/i,
    ],
    intent: 'status',
    destructive: false,
    buildCommand: () => ['git status --short', 'git diff --stat'],
    explanation: () => 'Show working directory status and changes summary',
  },
  {
    patterns: [
      /show\s+(me\s+)?(the\s+)?(recent\s+|last\s+)?commits/i,
      /what.*(commit|history|log)/i,
      /show\s+(me\s+)?(commit\s+)?history/i,
      /git\s+log/i,
      /last\s+(\d+)\s+commits/i,
    ],
    intent: 'log',
    destructive: false,
    buildCommand: (match, input) => {
      const countMatch = input.match(/last\s+(\d+)/i) ?? input.match(/(\d+)\s+commits/i);
      const count = countMatch ? parseInt(countMatch[1]!, 10) : 10;
      return [`git log --oneline -${Math.min(count, 50)}`];
    },
    explanation: (input) => {
      const countMatch = input.match(/last\s+(\d+)/i) ?? input.match(/(\d+)\s+commits/i);
      const count = countMatch ? parseInt(countMatch[1]!, 10) : 10;
      return `Show last ${count} commits`;
    },
  },
  {
    patterns: [
      /what.*(changed|different)\s+(yesterday|today|this week|last week)/i,
      /show.*(changes|diff)\s+(from|since|in)\s+(yesterday|today|this week|last week)/i,
    ],
    intent: 'diff',
    destructive: false,
    buildCommand: (match, input) => {
      const timeMatch = input.match(/(yesterday|today|this week|last week)/i);
      const since = timeMatch?.[1]?.toLowerCase();
      const dateArg = since === 'yesterday' ? '--since="yesterday"' :
                      since === 'today' ? '--since="today"' :
                      since === 'this week' ? '--since="1 week ago"' :
                      since === 'last week' ? '--since="2 weeks ago" --until="1 week ago"' :
                      '--since="yesterday"';
      return [`git log --oneline ${dateArg}`, `git diff --stat HEAD~5`];
    },
    explanation: (input) => {
      const timeMatch = input.match(/(yesterday|today|this week|last week)/i);
      return `Show changes from ${timeMatch?.[1] ?? 'recently'}`;
    },
  },
  {
    patterns: [
      /show\s+(me\s+)?(the\s+)?diff/i,
      /what.*diff/i,
      /compare\s+(\w+)\s+(and|with|to|vs)\s+(\w+)/i,
    ],
    intent: 'diff',
    destructive: false,
    buildCommand: (match, input) => {
      const compareMatch = input.match(/compare\s+(\S+)\s+(?:and|with|to|vs)\s+(\S+)/i);
      if (compareMatch) {
        return [`git diff ${compareMatch[1]} ${compareMatch[2]}`];
      }
      return ['git diff'];
    },
    explanation: () => 'Show current diff',
  },

  // ─── Commit Workflow ───
  {
    patterns: [
      /commit\s+(everything|all|changes|files)/i,
      /save\s+(my\s+)?(work|changes|progress)/i,
      /commit\s+with\s+message\s*[:"]?\s*(.+)/i,
      /commit\s*[:"](.+)/i,
    ],
    intent: 'commit',
    destructive: false,
    buildCommand: (match, input) => {
      const msgMatch = input.match(/(?:message|commit)\s*[:"]\s*(.+?)["']?\s*$/i)
                    ?? input.match(/commit\s+(?:everything|all|changes)\s+(?:as|with)\s+"?(.+?)"?\s*$/i);
      const msg = msgMatch?.[1] ?? 'Update';
      return ['git add -A', `git commit -m "${msg.replace(/"/g, '\\"')}"`];
    },
    explanation: (input) => {
      const msgMatch = input.match(/(?:message|commit)\s*[:"]\s*(.+?)["']?\s*$/i);
      return `Stage all changes and commit${msgMatch ? ` with: "${msgMatch[1]}"` : ''}`;
    },
  },
  {
    patterns: [
      /push\s+(it|changes|commits|everything|to\s+\w+)/i,
      /push\s+to\s+(\w+)/i,
      /git\s+push/i,
      /upload\s+(my\s+)?(changes|code|commits)/i,
    ],
    intent: 'push',
    destructive: false,
    buildCommand: (match, input) => {
      const remoteMatch = input.match(/push\s+to\s+(\w+)/i);
      const remote = remoteMatch?.[1] ?? 'origin';
      return [`git push ${remote}`];
    },
    explanation: (input) => {
      const remoteMatch = input.match(/push\s+to\s+(\w+)/i);
      return `Push commits to ${remoteMatch?.[1] ?? 'origin'}`;
    },
  },
  {
    patterns: [
      /pull\s+(latest|changes|updates)/i,
      /update\s+(from|my)\s+(remote|origin|upstream)/i,
      /git\s+pull/i,
      /sync\s+(with\s+)?(remote|origin|upstream)/i,
    ],
    intent: 'pull',
    destructive: false,
    buildCommand: (match, input) => {
      const remoteMatch = input.match(/(?:from|with)\s+(\w+)/i);
      const remote = remoteMatch?.[1] ?? 'origin';
      return [`git pull ${remote}`];
    },
    explanation: () => 'Pull latest changes from remote',
  },

  // ─── Branch Operations ───
  {
    patterns: [
      /create\s+(a\s+)?(?:new\s+)?branch\s+(?:called\s+|named\s+)?(\S+)/i,
      /new\s+branch\s+(\S+)/i,
      /branch\s+off\s+(?:as|into)\s+(\S+)/i,
    ],
    intent: 'branch-create',
    destructive: false,
    buildCommand: (match, input) => {
      const nameMatch = input.match(/branch\s+(?:called\s+|named\s+)?(\S+)/i)
                     ?? input.match(/branch\s+off\s+(?:as|into)\s+(\S+)/i);
      const name = nameMatch?.[1] ?? 'new-branch';
      return [`git checkout -b ${name}`];
    },
    explanation: (input) => {
      const nameMatch = input.match(/branch\s+(?:called\s+|named\s+)?(\S+)/i);
      return `Create and switch to new branch: ${nameMatch?.[1] ?? 'new-branch'}`;
    },
  },
  {
    patterns: [
      /switch\s+to\s+(?:branch\s+)?(\S+)/i,
      /checkout\s+(\S+)/i,
      /go\s+to\s+(?:branch\s+)?(\S+)/i,
      /change\s+(?:to\s+)?branch\s+(\S+)/i,
    ],
    intent: 'branch-switch',
    destructive: false,
    buildCommand: (match, input) => {
      const nameMatch = input.match(/(?:switch|checkout|go)\s+(?:to\s+)?(?:branch\s+)?(\S+)/i);
      const name = nameMatch?.[1] ?? 'main';
      return [`git checkout ${name}`];
    },
    explanation: (input) => {
      const nameMatch = input.match(/(?:switch|checkout|go)\s+(?:to\s+)?(?:branch\s+)?(\S+)/i);
      return `Switch to branch: ${nameMatch?.[1] ?? 'main'}`;
    },
  },
  {
    patterns: [
      /(?:delete|remove)\s+branch\s+(\S+)/i,
      /branch\s+(?:delete|remove)\s+(\S+)/i,
    ],
    intent: 'branch-delete',
    destructive: true,
    buildCommand: (match, input) => {
      const nameMatch = input.match(/branch\s+(\S+)/i);
      const name = nameMatch?.[1] ?? '';
      return name ? [`git branch -d ${name}`] : [];
    },
    explanation: (input) => {
      const nameMatch = input.match(/branch\s+(\S+)/i);
      return `Delete branch: ${nameMatch?.[1] ?? '(no branch specified)'}`;
    },
  },
  {
    patterns: [
      /list\s+(all\s+)?branches/i,
      /show\s+(me\s+)?(all\s+)?branches/i,
      /what\s+branches/i,
    ],
    intent: 'branch-list',
    destructive: false,
    buildCommand: () => ['git branch -a'],
    explanation: () => 'List all branches (local and remote)',
  },

  // ─── Merge & Rebase ───
  {
    patterns: [
      /merge\s+(\S+)/i,
      /merge\s+(\S+)\s+into\s+(\S+)/i,
    ],
    intent: 'merge',
    destructive: false,
    buildCommand: (match, input) => {
      const mergeMatch = input.match(/merge\s+(\S+)\s+into\s+(\S+)/i);
      if (mergeMatch) {
        return [`git checkout ${mergeMatch[2]}`, `git merge ${mergeMatch[1]}`];
      }
      const branchMatch = input.match(/merge\s+(\S+)/i);
      return branchMatch ? [`git merge ${branchMatch[1]}`] : [];
    },
    explanation: (input) => {
      const mergeMatch = input.match(/merge\s+(\S+)\s+into\s+(\S+)/i);
      if (mergeMatch) return `Merge ${mergeMatch[1]} into ${mergeMatch[2]}`;
      const branchMatch = input.match(/merge\s+(\S+)/i);
      return `Merge ${branchMatch?.[1] ?? 'branch'} into current branch`;
    },
  },

  // ─── Undo / Reset ───
  {
    patterns: [
      /undo\s+(the\s+)?last\s+(\d+\s+)?commits?/i,
      /reset\s+(the\s+)?last\s+(\d+\s+)?commits?/i,
      /go\s+back\s+(\d+)\s+commits?/i,
    ],
    intent: 'reset',
    destructive: true,
    buildCommand: (match, input) => {
      const countMatch = input.match(/(\d+)\s+commits?/i);
      const count = countMatch ? parseInt(countMatch[1]!, 10) : 1;
      return [`git reset --soft HEAD~${count}`];
    },
    explanation: (input) => {
      const countMatch = input.match(/(\d+)\s+commits?/i);
      const count = countMatch ? parseInt(countMatch[1]!, 10) : 1;
      return `Soft reset last ${count} commit(s) — keeps changes staged`;
    },
  },

  // ─── Stash ───
  {
    patterns: [
      /stash\s+(my\s+)?(changes|work|progress)/i,
      /save\s+(my\s+)?changes\s+(for\s+)?later/i,
      /git\s+stash/i,
    ],
    intent: 'stash',
    destructive: false,
    buildCommand: (match, input) => {
      const msgMatch = input.match(/stash\s+(?:as|with|message)\s+"?(.+?)"?\s*$/i);
      return msgMatch ? [`git stash push -m "${msgMatch[1]}"`] : ['git stash'];
    },
    explanation: () => 'Stash current changes for later',
  },
  {
    patterns: [
      /(?:restore|pop|apply)\s+(my\s+)?stash/i,
      /get\s+(my\s+)?stash\s+back/i,
      /unstash/i,
    ],
    intent: 'stash-pop',
    destructive: false,
    buildCommand: () => ['git stash pop'],
    explanation: () => 'Restore most recently stashed changes',
  },

  // ─── Blame ───
  {
    patterns: [
      /who\s+(wrote|changed|touched|modified|edited)\s+(\S+)/i,
      /blame\s+(\S+)/i,
      /show\s+blame\s+(?:for\s+)?(\S+)/i,
    ],
    intent: 'blame',
    destructive: false,
    buildCommand: (match, input) => {
      const fileMatch = input.match(/(?:wrote|changed|touched|modified|edited|blame)\s+(\S+)/i);
      return fileMatch ? [`git blame ${fileMatch[1]}`] : [];
    },
    explanation: (input) => {
      const fileMatch = input.match(/(\S+\.[\w]+)/);
      return `Show who last modified each line of ${fileMatch?.[1] ?? 'the file'}`;
    },
  },
];

/**
 * Parse natural language into a git intent.
 */
export function parseGitIntent(input: string): GitIntentResult {
  const normalized = input.trim().toLowerCase();

  for (const pattern of INTENT_PATTERNS) {
    for (const regex of pattern.patterns) {
      const match = normalized.match(regex);
      if (match) {
        return {
          input,
          intent: pattern.intent,
          commands: pattern.buildCommand(match, input),
          explanation: pattern.explanation(input),
          destructive: pattern.destructive,
          confidence: 0.85,
        };
      }
    }
  }

  // Unknown intent
  return {
    input,
    intent: 'unknown',
    commands: [],
    explanation: 'Could not understand git intent. Try being more specific.',
    destructive: false,
    confidence: 0,
  };
}

/**
 * Execute a git intent result.
 */
export function executeGitIntent(result: GitIntentResult, cwd: string): GitExecutionResult {
  if (result.commands.length === 0) {
    return { success: false, output: 'No commands to execute.', results: [] };
  }

  const results: CommandResult[] = [];
  let allSuccess = true;

  for (const cmd of result.commands) {
    try {
      const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 30_000 }).trim();
      results.push({ command: cmd, output, success: true });
    } catch (err) {
      const errMsg = (err as any).stderr ?? (err as any).stdout ?? (err as Error).message;
      results.push({ command: cmd, output: errMsg, success: false });
      allSuccess = false;
      break; // Stop on first error
    }
  }

  return {
    success: allSuccess,
    output: results.map(r => r.output).join('\n'),
    results,
  };
}

interface CommandResult {
  command: string;
  output: string;
  success: boolean;
}

interface GitExecutionResult {
  success: boolean;
  output: string;
  results: CommandResult[];
}

/**
 * Format git intent for preview.
 */
export function formatGitPreview(result: GitIntentResult): string {
  const lines: string[] = [];

  lines.push(chalk.hex('#FF6B35').bold('⬡ Natural Language Git'));
  lines.push(chalk.dim('─'.repeat(50)));

  // Intent
  lines.push(`${chalk.bold('Intent:')} ${chalk.hex('#FF8C42')(result.intent)}`);
  lines.push(`${chalk.bold('Explanation:')} ${result.explanation}`);
  lines.push(`${chalk.bold('Confidence:')} ${(result.confidence * 100).toFixed(0)}%`);

  if (result.destructive) {
    lines.push(chalk.red.bold('\n⚠ DESTRUCTIVE OPERATION — requires confirmation'));
  }

  // Commands
  lines.push(chalk.hex('#FF8C42').bold('\nCommands:'));
  for (const cmd of result.commands) {
    lines.push(`  ${chalk.cyan('$')} ${chalk.white(cmd)}`);
  }

  return lines.join('\n');
}

/**
 * Format execution result.
 */
export function formatGitResult(result: GitExecutionResult): string {
  const lines: string[] = [];

  for (const r of result.results) {
    const icon = r.success ? chalk.green('✓') : chalk.red('✗');
    lines.push(`${icon} ${chalk.dim('$')} ${chalk.cyan(r.command)}`);
    if (r.output) {
      lines.push(r.output);
    }
  }

  return lines.join('\n');
}
