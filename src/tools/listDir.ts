// ─────────────────────────────────────────────────────────────
// Remus — List Directory Tool
// ls wrapper with better output
// ─────────────────────────────────────────────────────────────

import { readdirSync, statSync } from 'fs';
import { resolve, relative, join } from 'path';
import { BaseTool, type ToolInput, type ToolResult, type ToolContext } from './types.js';

export class ListDirTool extends BaseTool {
  name = 'list_dir';
  description = 'List the contents of a directory. Shows files and subdirectories.';
  isReadOnly = true;

  prompt = `List directory contents.

Usage:
- Returns files and directories with type indicators (/ suffix for directories)
- Sorted: directories first, then files
- Skips hidden files by default (use show_hidden: true to include)
- Defaults to current working directory`;

  inputSchema = {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path to the directory. Defaults to cwd.',
      },
      show_hidden: {
        type: 'boolean',
        description: 'Include hidden files/dirs (starting with .). Default: false.',
      },
    },
    required: [],
    additionalProperties: false,
  };

  async call(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const dirPath = resolve(context.cwd, (input.path as string) ?? '.');
    const showHidden = (input.show_hidden as boolean) ?? false;

    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      const filtered = showHidden
        ? entries
        : entries.filter(e => !e.name.startsWith('.'));

      const dirs: string[] = [];
      const files: string[] = [];

      for (const entry of filtered) {
        if (entry.isDirectory()) {
          dirs.push(entry.name + '/');
        } else if (entry.isFile() || entry.isSymbolicLink()) {
          // Get size for files
          try {
            const stat = statSync(join(dirPath, entry.name));
            const size = stat.size;
            const sizeStr = size < 1024 ? `${size}B`
              : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)}K`
              : `${(size / 1024 / 1024).toFixed(1)}M`;
            files.push(`${entry.name} (${sizeStr})`);
          } catch {
            files.push(entry.name);
          }
        }
      }

      dirs.sort();
      files.sort();

      const relPath = relative(context.cwd, dirPath) || '.';
      const allEntries = [...dirs, ...files];

      if (allEntries.length === 0) {
        return { output: `Directory "${relPath}" is empty.` };
      }

      return {
        output: `${relPath}/  (${dirs.length} dirs, ${files.length} files)\n${'─'.repeat(40)}\n${allEntries.join('\n')}`,
        metadata: {
          path: relPath,
          dirs: dirs.length,
          files: files.length,
        },
      };
    } catch (err) {
      return {
        output: `Error listing directory: ${(err as Error).message}`,
        isError: true,
        error: (err as Error).message,
      };
    }
  }
}
