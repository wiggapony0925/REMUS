// ─────────────────────────────────────────────────────────────
// Remus — Git Diff Tool
// Show git diffs with rich output
// ─────────────────────────────────────────────────────────────

import { execSync } from 'child_process';
import { BaseTool, type ToolInput, type ToolResult, type ToolContext } from './types.js';

export class GitDiffTool extends BaseTool {
  name = 'git_diff';
  description = 'Show git diffs for working tree changes, staged changes, or between commits.';
  isReadOnly = true;

  prompt = `Shows git diffs. Use this to review changes before committing or to understand what was modified.

Usage:
- No args: shows unstaged changes (working tree vs index)
- staged: true → shows staged changes (index vs HEAD)
- target: "HEAD~1" → diff between HEAD~1 and HEAD
- file_path: "src/main.ts" → diff only that file`;

  inputSchema = {
    type: 'object' as const,
    properties: {
      staged: {
        type: 'boolean',
        description: 'Show staged (cached) changes instead of unstaged',
      },
      target: {
        type: 'string',
        description: 'Git ref to diff against (e.g., HEAD~1, main, commit-hash)',
      },
      file_path: {
        type: 'string',
        description: 'Only show diff for this file path',
      },
      stat_only: {
        type: 'boolean',
        description: 'Show only file-level summary (stat), not full diff',
      },
    },
    required: [],
    additionalProperties: false,
  };

  async call(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const staged = input.staged as boolean | undefined;
    const target = input.target as string | undefined;
    const filePath = input.file_path as string | undefined;
    const statOnly = input.stat_only as boolean | undefined;

    try {
      const args: string[] = ['git', 'diff'];

      if (staged) args.push('--cached');
      if (target) args.push(target);
      if (statOnly) args.push('--stat');
      else args.push('--no-color');
      if (filePath) args.push('--', filePath);

      const output = execSync(args.join(' '), {
        cwd: context.cwd,
        encoding: 'utf-8',
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      }).trim();

      if (!output) {
        return {
          output: staged ? 'No staged changes.' : 'No changes in working tree.',
        };
      }

      // Truncate very large diffs
      if (output.length > 50000) {
        return {
          output: output.slice(0, 50000) + '\n\n[diff truncated — too large]',
          metadata: { truncated: true },
        };
      }

      return { output };
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('not a git repository')) {
        return { output: 'Not a git repository.', isError: true, error: 'NOT_GIT' };
      }
      return { output: `Git diff error: ${msg}`, isError: true, error: msg };
    }
  }
}
