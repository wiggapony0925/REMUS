// ─────────────────────────────────────────────────────────────
// Remus — Grep Tool
// Content search using ripgrep or native fallback
// ─────────────────────────────────────────────────────────────

import { execSync } from 'child_process';
import { resolve, relative } from 'path';
import { BaseTool, type ToolInput, type ToolResult, type ToolContext } from './types.js';

// Check if ripgrep is available
let hasRipgrep: boolean | null = null;
function checkRipgrep(): boolean {
  if (hasRipgrep !== null) return hasRipgrep;
  try {
    execSync('which rg', { stdio: 'ignore' });
    hasRipgrep = true;
  } catch {
    hasRipgrep = false;
  }
  return hasRipgrep;
}

export class GrepTool extends BaseTool {
  name = 'grep';
  description = 'Search file contents using regex patterns. Built on ripgrep for speed.';
  isReadOnly = true;

  prompt = `Search file contents with regex patterns.

Usage:
- ALWAYS use this tool for content search, never bash grep/rg
- Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
- Filter files with the glob parameter (e.g., "*.ts", "*.{js,jsx}")
- Default output_mode is "files_with_matches" (just filenames, sorted by recency)
- Use "content" mode to see matching lines with context
- Use -A, -B, -C for context lines around matches
- Case-insensitive search with -i: true`;

  inputSchema = {
    type: 'object' as const,
    properties: {
      pattern: {
        type: 'string',
        description: 'Regex pattern to search for',
      },
      path: {
        type: 'string',
        description: 'Directory or file to search in. Defaults to cwd.',
      },
      glob: {
        type: 'string',
        description: 'Glob pattern to filter files (e.g., "*.ts", "*.{js,jsx}")',
      },
      output_mode: {
        type: 'string',
        enum: ['content', 'files_with_matches', 'count'],
        description: 'Output mode. Default: files_with_matches.',
      },
      context: {
        type: 'number',
        description: 'Lines of context around each match (like rg -C)',
      },
      case_insensitive: {
        type: 'boolean',
        description: 'Case-insensitive search. Default: false.',
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of results to return. Default: 250.',
      },
    },
    required: ['pattern'],
    additionalProperties: false,
  };

  async call(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const pattern = input.pattern as string;
    const searchPath = resolve(context.cwd, (input.path as string) ?? '.');
    const glob = input.glob as string | undefined;
    const outputMode = (input.output_mode as string) ?? 'files_with_matches';
    const contextLines = input.context as number | undefined;
    const caseInsensitive = (input.case_insensitive as boolean) ?? false;
    const maxResults = (input.max_results as number) ?? 250;

    if (checkRipgrep()) {
      return this.searchWithRipgrep(
        pattern, searchPath, context.cwd, glob, outputMode,
        contextLines, caseInsensitive, maxResults
      );
    } else {
      return this.searchWithGrep(
        pattern, searchPath, context.cwd, glob, outputMode,
        contextLines, caseInsensitive, maxResults
      );
    }
  }

  private searchWithRipgrep(
    pattern: string,
    searchPath: string,
    cwd: string,
    glob: string | undefined,
    outputMode: string,
    contextLines: number | undefined,
    caseInsensitive: boolean,
    maxResults: number,
  ): ToolResult {
    const args: string[] = [
      '--hidden',
      '--glob', '!.git',
      '--glob', '!.svn',
      '--glob', '!node_modules',
      '--max-columns', '500',
      '--max-columns-preview',
    ];

    if (caseInsensitive) args.push('-i');
    if (glob) args.push('--glob', glob);
    if (contextLines !== undefined) args.push('-C', String(contextLines));

    switch (outputMode) {
      case 'files_with_matches':
        args.push('-l');
        break;
      case 'count':
        args.push('-c');
        break;
      default:
        args.push('-n'); // line numbers
        break;
    }

    // Handle patterns starting with -
    if (pattern.startsWith('-')) {
      args.push('-e', pattern);
    } else {
      args.push(pattern);
    }

    args.push(searchPath);

    try {
      const output = execSync(`rg ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`, {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf-8',
        timeout: 30000,
      });

      const lines = output.trim().split('\n').filter(Boolean);
      const truncated = lines.length > maxResults;
      const results = lines.slice(0, maxResults);

      // Relativize paths
      const formatted = results.map(line =>
        line.replace(searchPath, relative(cwd, searchPath) || '.')
      );

      const meta = truncated
        ? `\n\n[${lines.length} total results, showing first ${maxResults}]`
        : `\n\n[${results.length} result${results.length !== 1 ? 's' : ''}]`;

      return {
        output: formatted.join('\n') + meta,
        metadata: {
          totalResults: lines.length,
          shown: results.length,
          truncated,
        },
      };
    } catch (err: any) {
      if (err.status === 1) {
        return { output: 'No matches found.' };
      }
      if (err.status === 2) {
        return {
          output: `Grep error: ${err.stderr || err.message}`,
          isError: true,
          error: err.message,
        };
      }
      return {
        output: `Search error: ${err.message}`,
        isError: true,
        error: err.message,
      };
    }
  }

  private searchWithGrep(
    pattern: string,
    searchPath: string,
    cwd: string,
    glob: string | undefined,
    outputMode: string,
    contextLines: number | undefined,
    caseInsensitive: boolean,
    maxResults: number,
  ): ToolResult {
    // Fallback to native grep
    const args: string[] = ['-r', '-n', '--include=*'];

    if (caseInsensitive) args.push('-i');
    if (contextLines !== undefined) args.push(`-C${contextLines}`);
    if (glob) args.push(`--include=${glob}`);
    if (outputMode === 'files_with_matches') args.push('-l');
    if (outputMode === 'count') args.push('-c');

    args.push(pattern, searchPath);

    try {
      const output = execSync(`grep ${args.map(a => JSON.stringify(a)).join(' ')}`, {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf-8',
        timeout: 30000,
      });

      const lines = output.trim().split('\n').filter(Boolean).slice(0, maxResults);
      return {
        output: lines.join('\n') + `\n\n[${lines.length} result${lines.length !== 1 ? 's' : ''}]`,
      };
    } catch (err: any) {
      if (err.status === 1) {
        return { output: 'No matches found.' };
      }
      return {
        output: `Search error: ${err.message}`,
        isError: true,
        error: err.message,
      };
    }
  }
}
