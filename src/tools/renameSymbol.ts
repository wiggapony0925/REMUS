// ─────────────────────────────────────────────────────────────
// Remus — Symbol Rename Tool  
// Rename variables, functions, classes across the entire codebase
// BEATS: Claude Code (manual grep+edit) & Cursor (IDE-only)
// ─────────────────────────────────────────────────────────────

import { BaseTool } from './types.js';
import type { ToolInput, ToolResult, ToolContext } from './types.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, relative } from 'path';
import { execSync } from 'child_process';

export class RenameSymbolTool extends BaseTool {
  name = 'rename_symbol';
  description = 'Rename a variable, function, class, or other symbol across the entire codebase. Smart enough to respect word boundaries.';
  prompt = `Use this tool to rename a symbol (function, variable, class, type, etc.) across all files.
This does a SMART rename — it respects word boundaries so renaming 'user' won't change 'users' or 'superuser'.
Always use this instead of manual search-and-replace for code symbols.`;

  inputSchema = {
    type: 'object',
    properties: {
      old_name: {
        type: 'string',
        description: 'The current name of the symbol to rename',
      },
      new_name: {
        type: 'string',
        description: 'The new name for the symbol',
      },
      file_pattern: {
        type: 'string',
        description: 'Glob pattern for files to search in (e.g., "*.ts", "*.py"). Default: common code files',
      },
      dry_run: {
        type: 'boolean',
        description: 'If true, preview changes without writing (default: true)',
      },
    },
    required: ['old_name', 'new_name'],
  };

  isReadOnly = false;

  async call(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const oldName = input.old_name as string;
    const newName = input.new_name as string;
    const filePattern = (input.file_pattern as string) ?? '*.{ts,tsx,js,jsx,py,go,rs,java,c,cpp,h,hpp,cs,rb,swift,kt}';
    const dryRun = (input.dry_run as boolean) ?? true;

    if (!oldName || !newName) {
      return { output: 'Both old_name and new_name are required', isError: true, error: 'MISSING_ARGS' };
    }

    if (oldName === newName) {
      return { output: 'Old name and new name are the same — nothing to do.' };
    }

    try {
      // Find files containing the old name (word boundary match)
      let files: string[];
      try {
        const result = execSync(
          `grep -rlw "${oldName.replace(/"/g, '\\"')}" --include="${filePattern}" . 2>/dev/null || true`,
          { cwd: context.cwd, encoding: 'utf-8', timeout: 15000 }
        );
        files = result.trim().split('\n').filter(f => f && !f.includes('.git') && !f.includes('node_modules'));
      } catch {
        return { output: `No files found containing "${oldName}"` };
      }

      if (files.length === 0) {
        return { output: `Symbol "${oldName}" not found in any ${filePattern} files.` };
      }

      // Word-boundary regex for the symbol
      const regex = new RegExp(`\\b${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');

      const changes: Array<{ file: string; count: number; lines: string[] }> = [];
      let totalReplacements = 0;

      for (const file of files.slice(0, 200)) {
        const fullPath = resolve(context.cwd, file);
        if (!existsSync(fullPath)) continue;

        let content: string;
        try {
          content = readFileSync(fullPath, 'utf-8');
        } catch {
          continue;
        }

        const matches = content.match(regex);
        if (!matches || matches.length === 0) continue;

        const newContent = content.replace(regex, newName);
        const count = matches.length;
        totalReplacements += count;

        // Show changed lines
        const oldLines = content.split('\n');
        const changedLines: string[] = [];
        for (let i = 0; i < oldLines.length && changedLines.length < 5; i++) {
          if (regex.test(oldLines[i]!)) {
            regex.lastIndex = 0;
            changedLines.push(`  L${i + 1}: ${oldLines[i]!.trim().slice(0, 100)}`);
          }
        }

        changes.push({ file: relative(context.cwd, fullPath), count, lines: changedLines });

        if (!dryRun) {
          writeFileSync(fullPath, newContent, 'utf-8');
        }
      }

      if (changes.length === 0) {
        return { output: `Symbol "${oldName}" not found (with word boundaries) in any matching files.` };
      }

      const mode = dryRun ? '(DRY RUN — no changes written)' : '(APPLIED)';
      const summary = [
        `Symbol Rename ${mode}`,
        `${oldName} → ${newName}`,
        `Files affected: ${changes.length}`,
        `Total replacements: ${totalReplacements}`,
        '',
        ...changes.map(c => [
          `${c.file} (${c.count}x)`,
          ...c.lines,
        ].join('\n')),
      ].join('\n');

      return { output: summary };
    } catch (err) {
      return { output: `Rename error: ${(err as Error).message}`, isError: true, error: (err as Error).message };
    }
  }
}
