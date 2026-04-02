// ─────────────────────────────────────────────────────────────
// Remus — Glob Tool
// Fast file finding by pattern
// ─────────────────────────────────────────────────────────────

import { execSync } from 'child_process';
import { resolve, relative } from 'path';
import { BaseTool, type ToolInput, type ToolResult, type ToolContext } from './types.js';

export class GlobTool extends BaseTool {
  name = 'glob';
  description = 'Find files by glob pattern. Fast file discovery for any codebase size.';
  isReadOnly = true;

  prompt = `Find files matching glob patterns.

Usage:
- Use this for finding files by name, NOT bash find/ls
- Supports standard glob patterns: "**/*.ts", "src/**/*.{js,jsx}", "*.json"
- Results sorted by modification time (most recent first)
- Returns up to 100 matches by default
- Use this before editing to verify file paths`;

  inputSchema = {
    type: 'object' as const,
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern to match (e.g., "**/*.ts", "src/**/*.json")',
      },
      path: {
        type: 'string',
        description: 'Directory to search in. Defaults to cwd.',
      },
    },
    required: ['pattern'],
    additionalProperties: false,
  };

  async call(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const pattern = input.pattern as string;
    const searchPath = resolve(context.cwd, (input.path as string) ?? '.');
    const maxResults = 100;

    try {
      // Use find + glob matching or fd if available
      let files: string[];

      try {
        // Try fd first (faster, respects .gitignore)
        const output = execSync(
          `fd --type f --glob '${pattern.replace(/'/g, "'\\''")}' '${searchPath.replace(/'/g, "'\\''")}'`,
          {
            encoding: 'utf-8',
            maxBuffer: 5 * 1024 * 1024,
            timeout: 15000,
          }
        );
        files = output.trim().split('\n').filter(Boolean);
      } catch {
        // Fallback to find with basic pattern support
        // Convert glob to find-compatible pattern
        const findPattern = pattern.replace(/\*\*/g, '').replace(/\*/g, '*');
        const output = execSync(
          `find '${searchPath.replace(/'/g, "'\\''")}' -type f -name '${findPattern.replace(/'/g, "'\\''")}'` +
          ` -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null | head -${maxResults * 2}`,
          {
            encoding: 'utf-8',
            maxBuffer: 5 * 1024 * 1024,
            timeout: 15000,
          }
        );
        files = output.trim().split('\n').filter(Boolean);
      }

      // Sort by mtime (most recent first) — use stat
      const filesWithMtime = files.slice(0, maxResults * 2).map(f => {
        try {
          const stat = require('fs').statSync(f);
          return { path: f, mtime: stat.mtimeMs };
        } catch {
          return { path: f, mtime: 0 };
        }
      });

      filesWithMtime.sort((a, b) => b.mtime - a.mtime);

      const truncated = filesWithMtime.length > maxResults;
      const results = filesWithMtime.slice(0, maxResults);
      const relPaths = results.map(f => relative(context.cwd, f.path));

      if (relPaths.length === 0) {
        return { output: `No files matching "${pattern}" found in ${relative(context.cwd, searchPath) || '.'}` };
      }

      const header = truncated
        ? `[${relPaths.length} of ${filesWithMtime.length} matches shown]`
        : `[${relPaths.length} file${relPaths.length !== 1 ? 's' : ''}]`;

      return {
        output: relPaths.join('\n') + '\n\n' + header,
        metadata: {
          numFiles: relPaths.length,
          truncated,
          filenames: relPaths,
        },
      };
    } catch (err) {
      return {
        output: `Error searching for files: ${(err as Error).message}`,
        isError: true,
        error: (err as Error).message,
      };
    }
  }
}
