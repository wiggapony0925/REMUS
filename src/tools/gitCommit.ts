// ─────────────────────────────────────────────────────────────
// Remus — Git Commit Tool
// Stage and commit changes
// ─────────────────────────────────────────────────────────────

import { execSync } from 'child_process';
import { BaseTool, type ToolInput, type ToolResult, type ToolContext } from './types.js';

export class GitCommitTool extends BaseTool {
  name = 'git_commit';
  description = 'Stage files and create a git commit with a message.';
  isReadOnly = false;

  prompt = `Creates a git commit.

Usage:
- message is required — write a clear conventional commit message
- files: list of file paths to stage (default: all modified files)
- all: true → stage all changes (git add -A) before committing
- If no files and no all flag, only already-staged files are committed

Commit message format (conventional commits):
  feat: add user authentication
  fix: resolve null pointer in parser
  refactor: extract common validation logic
  docs: update API documentation
  test: add unit tests for auth module`;

  inputSchema = {
    type: 'object' as const,
    properties: {
      message: {
        type: 'string',
        description: 'Commit message (required)',
      },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files to stage before committing',
      },
      all: {
        type: 'boolean',
        description: 'Stage all changes before committing (git add -A)',
      },
    },
    required: ['message'],
    additionalProperties: false,
  };

  async call(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const message = input.message as string;
    const files = input.files as string[] | undefined;
    const all = input.all as boolean | undefined;

    if (!message?.trim()) {
      return { output: 'Commit message is required.', isError: true, error: 'EMPTY_MESSAGE' };
    }

    try {
      // Stage files
      if (all) {
        execSync('git add -A', { cwd: context.cwd, encoding: 'utf-8', timeout: 10000 });
      } else if (files && files.length > 0) {
        for (const file of files) {
          execSync(`git add -- "${file}"`, { cwd: context.cwd, encoding: 'utf-8', timeout: 5000 });
        }
      }

      // Check if there's anything staged
      const staged = execSync('git diff --cached --name-only', {
        cwd: context.cwd, encoding: 'utf-8', timeout: 5000,
      }).trim();

      if (!staged) {
        return {
          output: 'Nothing staged for commit. Use files or all:true to stage changes first.',
          isError: true,
          error: 'NOTHING_STAGED',
        };
      }

      // Commit
      const escapedMessage = message.replace(/"/g, '\\"');
      const result = execSync(`git commit -m "${escapedMessage}"`, {
        cwd: context.cwd, encoding: 'utf-8', timeout: 30000,
      }).trim();

      // Get the short hash
      const hash = execSync('git rev-parse --short HEAD', {
        cwd: context.cwd, encoding: 'utf-8', timeout: 5000,
      }).trim();

      const stagedFiles = staged.split('\n').filter(Boolean);
      return {
        output: `Committed ${hash}: ${message}\n\nFiles (${stagedFiles.length}):\n${stagedFiles.map(f => `  ${f}`).join('\n')}`,
        metadata: {
          hash,
          filesCommitted: stagedFiles.length,
        },
      };
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('not a git repository')) {
        return { output: 'Not a git repository.', isError: true, error: 'NOT_GIT' };
      }
      return { output: `Git commit error: ${msg}`, isError: true, error: msg };
    }
  }
}
