// ─────────────────────────────────────────────────────────────
// Remus — Git Log Tool
// View commit history with flexible formatting
// ─────────────────────────────────────────────────────────────

import { execSync } from 'child_process';
import { BaseTool, type ToolInput, type ToolResult, type ToolContext } from './types.js';

export class GitLogTool extends BaseTool {
  name = 'git_log';
  description = 'Show git commit history with optional filtering.';
  isReadOnly = true;

  prompt = `Shows git commit history.

Usage:
- count: number of commits to show (default: 15)
- oneline: compact one-line format (default: true)
- file_path: only show commits touching this file
- author: filter by author name/email
- since: show commits since date (e.g., "1 week ago", "2024-01-01")
- grep: filter by commit message pattern`;

  inputSchema = {
    type: 'object' as const,
    properties: {
      count: {
        type: 'number',
        description: 'Number of commits to show (default: 15)',
      },
      oneline: {
        type: 'boolean',
        description: 'Compact one-line format (default: true)',
      },
      file_path: {
        type: 'string',
        description: 'Show only commits affecting this file',
      },
      author: {
        type: 'string',
        description: 'Filter by author name or email',
      },
      since: {
        type: 'string',
        description: 'Show commits since date (e.g., "1 week ago")',
      },
      grep: {
        type: 'string',
        description: 'Filter by commit message pattern',
      },
    },
    required: [],
    additionalProperties: false,
  };

  async call(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const count = (input.count as number) ?? 15;
    const oneline = (input.oneline as boolean) ?? true;
    const filePath = input.file_path as string | undefined;
    const author = input.author as string | undefined;
    const since = input.since as string | undefined;
    const grep = input.grep as string | undefined;

    try {
      const args: string[] = ['git', 'log'];

      args.push(`-${Math.min(count, 100)}`);

      if (oneline) {
        args.push('--oneline', '--decorate');
      } else {
        args.push('--format=format:%h %s%n  Author: %an <%ae>%n  Date:   %ai%n');
      }

      if (author) args.push(`--author=${author}`);
      if (since) args.push(`--since="${since}"`);
      if (grep) args.push(`--grep="${grep}"`);
      if (filePath) args.push('--', filePath);

      const output = execSync(args.join(' '), {
        cwd: context.cwd,
        encoding: 'utf-8',
        timeout: 10000,
        maxBuffer: 512 * 1024,
      }).trim();

      if (!output) {
        return { output: 'No commits found matching the criteria.' };
      }

      return { output };
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('not a git repository')) {
        return { output: 'Not a git repository.', isError: true, error: 'NOT_GIT' };
      }
      return { output: `Git log error: ${msg}`, isError: true, error: msg };
    }
  }
}
