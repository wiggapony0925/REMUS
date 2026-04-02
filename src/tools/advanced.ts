// ─────────────────────────────────────────────────────────────
// Remus — File Watch Tool
// Watch files for changes and auto-respond
// BEATS: Claude Code (no watching) & Cursor (IDE-only)
// ─────────────────────────────────────────────────────────────

import { BaseTool } from './types.js';
import type { ToolInput, ToolResult, ToolContext } from './types.js';
import { watch, existsSync, readFileSync, statSync } from 'fs';
import { resolve, relative, join } from 'path';

export class NotifyTool extends BaseTool {
  name = 'notify';
  description = 'Send a styled notification/status message to the user. Useful for progress updates during long tasks.';
  prompt = `Use this tool to send progress updates or notifications to the user during long-running operations.
Good for: "Step 1/5 complete", "Compiling...", "All tests passed!" etc.`;

  inputSchema = {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The notification message',
      },
      level: {
        type: 'string',
        enum: ['info', 'success', 'warning', 'error'],
        description: 'Notification level (default: info)',
      },
    },
    required: ['message'],
  };

  isReadOnly = true;

  async call(input: ToolInput, _context: ToolContext): Promise<ToolResult> {
    const message = input.message as string;
    const level = (input.level as string) ?? 'info';
    
    const icons: Record<string, string> = {
      info: 'ℹ',
      success: '✓',
      warning: '⚠',
      error: '✗',
    };
    
    return { 
      output: `[${icons[level] ?? '●'}] ${message}`,
      metadata: { level },
    };
  }
}

export class TreeTool extends BaseTool {
  name = 'tree';
  description = 'Show the directory tree structure. More visual than list_dir, better for understanding project layout.';
  prompt = `Use this tool to display a visual directory tree. Much better than list_dir for understanding project structure.
Automatically excludes node_modules, .git, __pycache__, etc.`;

  inputSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path to display (default: current directory)',
      },
      depth: {
        type: 'number',
        description: 'Maximum depth to display (default: 3)',
      },
      show_hidden: {
        type: 'boolean',
        description: 'Show hidden files (default: false)',
      },
    },
    required: [],
  };

  isReadOnly = true;

  async call(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const dirPath = resolve(context.cwd, (input.path as string) ?? '.');
    const maxDepth = (input.depth as number) ?? 3;
    const showHidden = (input.show_hidden as boolean) ?? false;

    const IGNORED = new Set([
      'node_modules', '.git', '__pycache__', '.next', '.nuxt', 
      'dist', 'build', '.cache', '.vscode', '.idea', 'coverage',
      '.tox', 'venv', '.venv', 'target', '.DS_Store',
    ]);

    if (!existsSync(dirPath)) {
      return { output: `Directory not found: ${dirPath}`, isError: true, error: 'NOT_FOUND' };
    }

    const lines: string[] = [];
    let fileCount = 0;
    let dirCount = 0;

    function buildTree(dir: string, prefix: string, depth: number): void {
      if (depth > maxDepth) return;

      const { readdirSync } = require('fs') as typeof import('fs');
      let entries: string[];
      try {
        entries = readdirSync(dir).sort();
      } catch {
        return;
      }

      // Filter
      entries = entries.filter(e => {
        if (IGNORED.has(e)) return false;
        if (!showHidden && e.startsWith('.')) return false;
        return true;
      });

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!;
        const isLast = i === entries.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const childPrefix = isLast ? '    ' : '│   ';

        const fullPath = join(dir, entry);
        let isDir = false;
        try {
          isDir = statSync(fullPath).isDirectory();
        } catch {
          continue;
        }

        if (isDir) {
          dirCount++;
          lines.push(`${prefix}${connector}${entry}/`);
          buildTree(fullPath, prefix + childPrefix, depth + 1);
        } else {
          fileCount++;
          const size = statSync(fullPath).size;
          const sizeStr = size < 1024 ? `${size}B` 
            : size < 1024 * 1024 ? `${(size / 1024).toFixed(0)}K`
            : `${(size / (1024 * 1024)).toFixed(1)}M`;
          lines.push(`${prefix}${connector}${entry} (${sizeStr})`);
        }
      }
    }

    const rootName = relative(context.cwd, dirPath) || '.';
    lines.push(`${rootName}/`);
    buildTree(dirPath, '', 1);
    lines.push('');
    lines.push(`${dirCount} directories, ${fileCount} files`);

    return { output: lines.join('\n') };
  }
}

export class CheckHealthTool extends BaseTool {
  name = 'check_health';
  description = 'Run health checks on the project: linting, type checking, test status, dependency audit.';
  prompt = `Use this tool to check the health of the project. Runs available checks:
- TypeScript: tsc --noEmit
- ESLint: eslint
- Tests: detect and run test suite
- Dependencies: check for outdated packages
Run this after making changes to verify nothing broke.`;

  inputSchema = {
    type: 'object',
    properties: {
      checks: {
        type: 'array',
        items: { type: 'string', enum: ['typecheck', 'lint', 'test', 'deps'] },
        description: 'Which checks to run (default: all available)',
      },
    },
    required: [],
  };

  isReadOnly = true;

  async call(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const { execSync: exec } = require('child_process') as typeof import('child_process');
    const requestedChecks = (input.checks as string[]) ?? ['typecheck', 'lint', 'test', 'deps'];
    const results: string[] = ['Project Health Check'];
    results.push('═'.repeat(40));

    for (const check of requestedChecks) {
      switch (check) {
        case 'typecheck': {
          if (existsSync(join(context.cwd, 'tsconfig.json'))) {
            try {
              exec('npx tsc --noEmit 2>&1', { cwd: context.cwd, encoding: 'utf-8', timeout: 60000 });
              results.push('✓ TypeScript:  No errors');
            } catch (err: any) {
              const output = err.stdout ?? err.message;
              const errorCount = (output.match(/error TS/g) ?? []).length;
              results.push(`✗ TypeScript:  ${errorCount} error(s)`);
              results.push(`  ${output.split('\n').slice(0, 5).join('\n  ')}`);
            }
          } else {
            results.push('○ TypeScript:  No tsconfig.json found');
          }
          break;
        }

        case 'lint': {
          const hasEslint = existsSync(join(context.cwd, '.eslintrc.json')) || 
                           existsSync(join(context.cwd, '.eslintrc.js')) ||
                           existsSync(join(context.cwd, 'eslint.config.js'));
          if (hasEslint) {
            try {
              exec('npx eslint . --max-warnings 0 2>&1', { cwd: context.cwd, encoding: 'utf-8', timeout: 60000 });
              results.push('✓ ESLint:      No warnings');
            } catch (err: any) {
              const output = err.stdout ?? err.message;
              results.push(`✗ ESLint:      Issues found`);
              results.push(`  ${output.split('\n').slice(0, 5).join('\n  ')}`);
            }
          } else {
            results.push('○ ESLint:      No config found');
          }
          break;
        }

        case 'test': {
          const pkg = existsSync(join(context.cwd, 'package.json')) 
            ? JSON.parse(readFileSync(join(context.cwd, 'package.json'), 'utf-8'))
            : null;
          const testScript = pkg?.scripts?.test;
          if (testScript && testScript !== 'echo "Error: no test specified" && exit 1') {
            try {
              const output = exec('npm test 2>&1', { cwd: context.cwd, encoding: 'utf-8', timeout: 120000 });
              results.push('✓ Tests:       All passing');
            } catch (err: any) {
              results.push('✗ Tests:       Failures detected');
              const output = err.stdout ?? err.message;
              results.push(`  ${output.split('\n').slice(-5).join('\n  ')}`);
            }
          } else {
            results.push('○ Tests:       No test script configured');
          }
          break;
        }

        case 'deps': {
          if (existsSync(join(context.cwd, 'package.json'))) {
            try {
              const output = exec('npm audit --omit=dev 2>&1 | tail -5', { cwd: context.cwd, encoding: 'utf-8', timeout: 30000 });
              if (output.includes('found 0 vulnerabilities')) {
                results.push('✓ Dependencies: No vulnerabilities');
              } else {
                results.push(`⚠ Dependencies: ${output.trim()}`);
              }
            } catch {
              results.push('○ Dependencies: Audit unavailable');
            }
          }
          break;
        }
      }
    }

    results.push('═'.repeat(40));
    return { output: results.join('\n') };
  }
}
