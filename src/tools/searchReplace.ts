// ─────────────────────────────────────────────────────────────
// Remus — Multi-File Search & Replace Tool
// Replace patterns across the entire codebase in one call
// BEATS: Claude Code (one file at a time) & Cursor (manual)
// ─────────────────────────────────────────────────────────────

import { BaseTool } from './types.js';
import type { ToolInput, ToolResult, ToolContext } from './types.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, relative } from 'path';
import { execSync } from 'child_process';

export class SearchReplaceTool extends BaseTool {
  name = 'search_replace';
  description = 'Search and replace a pattern across multiple files in the codebase. Supports regex.';
  prompt = `Use this tool to perform search-and-replace operations across multiple files at once.
This is much faster than editing files one by one.
ALWAYS preview changes first by setting dry_run to true.
Supports regex patterns for powerful transformations.`;

  inputSchema = {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The search pattern (string or regex)',
      },
      replacement: {
        type: 'string',
        description: 'The replacement string. Use $1, $2 etc for regex capture groups.',
      },
      file_pattern: {
        type: 'string',
        description: 'Glob pattern for files to search in (e.g., "**/*.ts", "src/**/*.py")',
      },
      is_regex: {
        type: 'boolean',
        description: 'Whether the pattern is a regex (default: false)',
      },
      dry_run: {
        type: 'boolean',
        description: 'If true, preview changes without writing (default: true)',
      },
      case_sensitive: {
        type: 'boolean',
        description: 'Whether the search is case-sensitive (default: true)',
      },
    },
    required: ['pattern', 'replacement', 'file_pattern'],
  };

  isReadOnly = false;

  async call(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const pattern = input.pattern as string;
    const replacement = input.replacement as string;
    const filePattern = input.file_pattern as string;
    const isRegex = (input.is_regex as boolean) ?? false;
    const dryRun = (input.dry_run as boolean) ?? true;
    const caseSensitive = (input.case_sensitive as boolean) ?? true;

    try {
      // Find matching files using glob
      let files: string[];
      try {
        const result = execSync(
          `find . -path './.git' -prune -o -path './node_modules' -prune -o -name '${filePattern.replace(/\*\*\//g, '').replace(/\*/g, '*')}' -print`,
          { cwd: context.cwd, encoding: 'utf-8', timeout: 10000 }
        );
        files = result.trim().split('\n').filter(f => f && !f.includes('.git') && !f.includes('node_modules'));
      } catch {
        // Fallback to simpler approach
        const result = execSync(
          `grep -rl ${caseSensitive ? '' : '-i'} "${pattern.replace(/"/g, '\\"')}" --include="${filePattern}" . 2>/dev/null || true`,
          { cwd: context.cwd, encoding: 'utf-8', timeout: 15000 }
        );
        files = result.trim().split('\n').filter(Boolean);
      }

      if (files.length === 0) {
        return { output: `No files matching "${filePattern}" contain the pattern "${pattern}"` };
      }

      const changes: Array<{ file: string; count: number; previews: string[] }> = [];
      let totalReplacements = 0;

      const regex = isRegex
        ? new RegExp(pattern, `g${caseSensitive ? '' : 'i'}m`)
        : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), `g${caseSensitive ? '' : 'i'}`);

      for (const file of files.slice(0, 100)) { // Limit to 100 files
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

        const newContent = content.replace(regex, replacement);
        const count = matches.length;
        totalReplacements += count;

        // Generate preview (first 3 changes per file)
        const previews: string[] = [];
        const lines = content.split('\n');
        let previewCount = 0;
        for (let i = 0; i < lines.length && previewCount < 3; i++) {
          if (regex.test(lines[i]!)) {
            regex.lastIndex = 0; // Reset regex state
            previews.push(`  L${i + 1}: ${lines[i]!.trim().slice(0, 80)} → ${lines[i]!.replace(regex, replacement).trim().slice(0, 80)}`);
            previewCount++;
          }
        }

        changes.push({ file: relative(context.cwd, fullPath), count, previews });

        if (!dryRun) {
          writeFileSync(fullPath, newContent, 'utf-8');
        }
      }

      if (changes.length === 0) {
        return { output: `Pattern "${pattern}" not found in any matching files.` };
      }

      const mode = dryRun ? '(DRY RUN — no changes written)' : '(APPLIED)';
      const summary = [
        `Search & Replace ${mode}`,
        `Pattern: ${pattern} → ${replacement}`,
        `Files affected: ${changes.length}`,
        `Total replacements: ${totalReplacements}`,
        '',
        ...changes.map(c => [
          `${c.file} (${c.count} replacement${c.count > 1 ? 's' : ''})`,
          ...c.previews,
        ].join('\n')),
      ].join('\n');

      return { output: summary };
    } catch (err) {
      return { output: `Search & replace error: ${(err as Error).message}`, isError: true, error: (err as Error).message };
    }
  }
}
