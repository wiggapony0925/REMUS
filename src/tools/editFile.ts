// ─────────────────────────────────────────────────────────────
// Remus — File Edit Tool
// Precise search-and-replace editing
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { resolve, dirname, relative } from 'path';
import { BaseTool, type ToolInput, type ToolResult, type ToolContext } from './types.js';

export class FileEditTool extends BaseTool {
  name = 'edit_file';
  description = 'Edit a file by replacing exact string matches. Requires the file to have been read first.';
  isReadOnly = false;

  prompt = `Performs exact string replacements in files.

Usage:
- You MUST read the file first before editing
- old_string must exactly match text in the file (including whitespace/indentation)
- The edit will FAIL if old_string is not found or matches multiple locations
- Use replace_all: true to replace ALL occurrences
- To create a new file, use old_string: "" with the file not existing
- ALWAYS prefer editing over writing entire files — it only sends the diff
- Preserve exact indentation from the file`;

  inputSchema = {
    type: 'object' as const,
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute path to the file to edit',
      },
      old_string: {
        type: 'string',
        description: 'The exact text to find and replace. Use empty string to create a new file.',
      },
      new_string: {
        type: 'string',
        description: 'The replacement text',
      },
      replace_all: {
        type: 'boolean',
        description: 'Replace all occurrences (default: false)',
      },
    },
    required: ['file_path', 'old_string', 'new_string'],
    additionalProperties: false,
  };

  async call(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const rawPath = input.file_path as string;
    const oldString = input.old_string as string;
    const newString = input.new_string as string;
    const replaceAll = (input.replace_all as boolean) ?? false;

    const filePath = resolve(context.cwd, rawPath);
    const relPath = relative(context.cwd, filePath);

    // Validation: old !== new
    if (oldString === newString) {
      return {
        output: 'old_string and new_string are identical — no change needed.',
        isError: true,
        error: 'IDENTICAL_STRINGS',
      };
    }

    // Creating a new file
    if (oldString === '' && !existsSync(filePath)) {
      try {
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, newString, 'utf-8');
        context.readFiles.set(filePath, {
          content: newString,
          mtime: statSync(filePath).mtimeMs,
        });

        const lineCount = newString.split('\n').length;
        return {
          output: `Created new file: ${relPath} (${lineCount} lines)`,
          metadata: {
            type: 'create',
            filePath: relPath,
            linesAdded: lineCount,
          },
        };
      } catch (err) {
        return {
          output: `Failed to create file: ${(err as Error).message}`,
          isError: true,
          error: (err as Error).message,
        };
      }
    }

    // File must exist for edits
    if (!existsSync(filePath)) {
      return {
        output: `File not found: ${filePath}\nTo create a new file, set old_string to an empty string.`,
        isError: true,
        error: 'ENOENT',
      };
    }

    // Must have been read first
    if (!context.readFiles.has(filePath)) {
      return {
        output: `You must read the file before editing it. Use read_file first.`,
        isError: true,
        error: 'NOT_READ',
      };
    }

    try {
      const content = readFileSync(filePath, 'utf-8');

      // Check staleness
      const stat = statSync(filePath);
      const cached = context.readFiles.get(filePath);
      if (cached && Math.abs(cached.mtime - stat.mtimeMs) > 100) {
        // File was modified externally — re-read
        context.readFiles.set(filePath, { content, mtime: stat.mtimeMs });
      }

      // Count occurrences
      const count = content.split(oldString).length - 1;

      if (count === 0) {
        // Try to help debug: check for similar strings
        const trimmedOld = oldString.trim();
        const lines = content.split('\n');
        const fuzzyMatches = lines
          .map((line, i) => ({ line: line.trim(), num: i + 1 }))
          .filter(({ line }) => line.includes(trimmedOld.split('\n')[0]?.trim() ?? ''))
          .slice(0, 3);

        let hint = '';
        if (fuzzyMatches.length > 0) {
          hint = '\n\nDid you mean one of these lines?\n' +
            fuzzyMatches.map(m => `  Line ${m.num}: ${m.line}`).join('\n');
        }

        return {
          output: `old_string not found in ${relPath}.${hint}\n\nMake sure the string matches exactly, including whitespace and indentation.`,
          isError: true,
          error: 'NOT_FOUND',
        };
      }

      if (count > 1 && !replaceAll) {
        return {
          output: `Found ${count} occurrences of old_string in ${relPath}. Use replace_all: true to replace all, or provide more context to make old_string unique.`,
          isError: true,
          error: 'MULTIPLE_MATCHES',
        };
      }

      // Perform replacement
      let newContent: string;
      if (replaceAll) {
        newContent = content.split(oldString).join(newString);
      } else {
        const idx = content.indexOf(oldString);
        newContent = content.slice(0, idx) + newString + content.slice(idx + oldString.length);
      }

      writeFileSync(filePath, newContent, 'utf-8');
      const newStat = statSync(filePath);
      context.readFiles.set(filePath, { content: newContent, mtime: newStat.mtimeMs });

      // Compute basic diff stats
      const oldLines = oldString.split('\n').length;
      const newLines = newString.split('\n').length;
      const replacements = replaceAll ? count : 1;

      return {
        output: `Edited ${relPath}: replaced ${replacements} occurrence${replacements > 1 ? 's' : ''} (${oldLines} lines → ${newLines} lines)`,
        metadata: {
          type: 'edit',
          filePath: relPath,
          replacements,
          linesRemoved: oldLines * replacements,
          linesAdded: newLines * replacements,
        },
      };
    } catch (err) {
      return {
        output: `Error editing file: ${(err as Error).message}`,
        isError: true,
        error: (err as Error).message,
      };
    }
  }
}
