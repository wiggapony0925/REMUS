// ─────────────────────────────────────────────────────────────
// Remus — Git Status Tool
// Show repository status with rich output
// ─────────────────────────────────────────────────────────────

import { execSync } from 'child_process';
import { BaseTool, type ToolInput, type ToolResult, type ToolContext } from './types.js';

export class GitStatusTool extends BaseTool {
  name = 'git_status';
  description = 'Show the current git status: branch, modified/staged/untracked files.';
  isReadOnly = true;

  prompt = `Shows a comprehensive git status including:
- Current branch name
- Tracking info (ahead/behind remote)
- Staged changes
- Unstaged changes
- Untracked files

Use this before committing to see what will be included.`;

  inputSchema = {
    type: 'object' as const,
    properties: {
      verbose: {
        type: 'boolean',
        description: 'Show verbose output including file diffs',
      },
    },
    required: [],
    additionalProperties: false,
  };

  async call(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    try {
      // Get branch and tracking info
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: context.cwd, encoding: 'utf-8', timeout: 5000,
      }).trim();

      let tracking = '';
      try {
        tracking = execSync(`git rev-list --left-right --count ${branch}...@{u}`, {
          cwd: context.cwd, encoding: 'utf-8', timeout: 5000,
        }).trim();
      } catch {
        // No upstream
      }

      // Get porcelain status
      const status = execSync('git status --porcelain=v2 --branch', {
        cwd: context.cwd, encoding: 'utf-8', timeout: 10000,
        maxBuffer: 512 * 1024,
      }).trim();

      // Also get human-readable status
      const humanStatus = execSync('git status --short', {
        cwd: context.cwd, encoding: 'utf-8', timeout: 10000,
        maxBuffer: 512 * 1024,
      }).trim();

      const parts: string[] = [];
      parts.push(`Branch: ${branch}`);

      if (tracking) {
        const [ahead, behind] = tracking.split('\t').map(Number);
        if (ahead > 0) parts.push(`Ahead of remote: ${ahead} commit(s)`);
        if (behind > 0) parts.push(`Behind remote: ${behind} commit(s)`);
      }

      if (humanStatus) {
        parts.push('');
        parts.push(humanStatus);
      } else {
        parts.push('');
        parts.push('Working tree clean — nothing to commit.');
      }

      return { output: parts.join('\n') };
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('not a git repository')) {
        return { output: 'Not a git repository.', isError: true, error: 'NOT_GIT' };
      }
      return { output: `Git status error: ${msg}`, isError: true, error: msg };
    }
  }
}
