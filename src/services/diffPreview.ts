// ─────────────────────────────────────────────────────────────
// Remus — Diff Preview Mode
// Show beautiful red/green inline diffs before applying edits.
// User approves or rejects every change. Full transparency.
// ─────────────────────────────────────────────────────────────

import chalk from 'chalk';

export interface DiffChange {
  type: 'add' | 'remove' | 'context';
  lineNumber: number;
  content: string;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  changes: DiffChange[];
}

export interface FileDiff {
  filePath: string;
  operation: 'edit' | 'create' | 'delete';
  hunks: DiffHunk[];
  stats: { additions: number; deletions: number };
}

/**
 * Generate a unified diff between two strings.
 */
export function generateDiff(
  filePath: string,
  oldContent: string,
  newContent: string,
): FileDiff {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const hunks = computeHunks(oldLines, newLines);

  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const change of hunk.changes) {
      if (change.type === 'add') additions++;
      if (change.type === 'remove') deletions++;
    }
  }

  const operation = oldContent === '' ? 'create' : newContent === '' ? 'delete' : 'edit';

  return { filePath, operation, hunks, stats: { additions, deletions } };
}

/**
 * Compute diff hunks using a simple LCS-based approach.
 */
function computeHunks(oldLines: string[], newLines: string[]): DiffHunk[] {
  const lcs = longestCommonSubsequence(oldLines, newLines);
  const changes: DiffChange[] = [];

  let oi = 0;
  let ni = 0;
  let li = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    if (li < lcs.length && oi < oldLines.length && ni < newLines.length && oldLines[oi] === lcs[li] && newLines[ni] === lcs[li]) {
      changes.push({ type: 'context', lineNumber: ni + 1, content: newLines[ni]! });
      oi++;
      ni++;
      li++;
    } else if (oi < oldLines.length && (li >= lcs.length || oldLines[oi] !== lcs[li])) {
      changes.push({ type: 'remove', lineNumber: oi + 1, content: oldLines[oi]! });
      oi++;
    } else if (ni < newLines.length) {
      changes.push({ type: 'add', lineNumber: ni + 1, content: newLines[ni]! });
      ni++;
    }
  }

  // Group changes into hunks (with 3 lines of context around each change)
  return groupIntoHunks(changes);
}

/**
 * Simplified LCS for line-level diffing.
 */
function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;

  // Use space-efficient approach for large files
  if (m > 500 || n > 500) {
    return fastApproxLCS(a, b);
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Backtrack
  const result: string[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]!);
      i--;
      j--;
    } else if (dp[i - 1]![j]! > dp[i]![j - 1]!) {
      i--;
    } else {
      j--;
    }
  }

  return result;
}

/**
 * Fast approximate LCS for large files.
 * Uses a hash-based approach to find common lines efficiently.
 */
function fastApproxLCS(a: string[], b: string[]): string[] {
  const bIndex = new Map<string, number[]>();
  for (let i = 0; i < b.length; i++) {
    const key = b[i]!;
    if (!bIndex.has(key)) bIndex.set(key, []);
    bIndex.get(key)!.push(i);
  }

  const result: string[] = [];
  let lastJ = -1;

  for (let i = 0; i < a.length; i++) {
    const positions = bIndex.get(a[i]!);
    if (positions) {
      // Find the smallest j > lastJ
      const nextJ = positions.find(j => j > lastJ);
      if (nextJ !== undefined) {
        result.push(a[i]!);
        lastJ = nextJ;
      }
    }
  }

  return result;
}

/**
 * Group changes into hunks with context lines.
 */
function groupIntoHunks(changes: DiffChange[]): DiffHunk[] {
  const CONTEXT = 3;
  const hunks: DiffHunk[] = [];

  // Find ranges of actual changes (add/remove)
  const changeIndices: number[] = [];
  for (let i = 0; i < changes.length; i++) {
    if (changes[i]!.type !== 'context') changeIndices.push(i);
  }

  if (changeIndices.length === 0) return [];

  // Group nearby changes into hunks
  let hunkStart = changeIndices[0]!;
  let hunkEnd = changeIndices[0]!;

  for (let i = 1; i < changeIndices.length; i++) {
    if (changeIndices[i]! - hunkEnd <= CONTEXT * 2 + 1) {
      // Close enough to merge
      hunkEnd = changeIndices[i]!;
    } else {
      // Emit current hunk
      hunks.push(buildHunk(changes, hunkStart, hunkEnd, CONTEXT));
      hunkStart = changeIndices[i]!;
      hunkEnd = changeIndices[i]!;
    }
  }
  // Emit final hunk
  hunks.push(buildHunk(changes, hunkStart, hunkEnd, CONTEXT));

  return hunks;
}

function buildHunk(changes: DiffChange[], start: number, end: number, context: number): DiffHunk {
  const from = Math.max(0, start - context);
  const to = Math.min(changes.length - 1, end + context);

  const hunkChanges = changes.slice(from, to + 1);

  let oldStart = 1, newStart = 1;
  let oldCount = 0, newCount = 0;

  // Calculate line numbers
  for (let i = 0; i < from; i++) {
    if (changes[i]!.type !== 'add') oldStart++;
    if (changes[i]!.type !== 'remove') newStart++;
  }

  for (const c of hunkChanges) {
    if (c.type !== 'add') oldCount++;
    if (c.type !== 'remove') newCount++;
  }

  return { oldStart, oldCount, newStart, newCount, changes: hunkChanges };
}

/**
 * Format a diff for terminal display with colors.
 */
export function formatDiff(diff: FileDiff): string {
  const lines: string[] = [];

  // Header
  const opLabel = diff.operation === 'create' ? chalk.green('NEW') :
                  diff.operation === 'delete' ? chalk.red('DELETE') :
                  chalk.yellow('MODIFIED');

  lines.push(chalk.hex('#FF6B35').bold('┌─ Diff Preview'));
  lines.push(chalk.hex('#FF8C42')(`│ ${opLabel} ${chalk.white.bold(diff.filePath)}`));
  lines.push(chalk.hex('#FF8C42')(`│ ${chalk.green(`+${diff.stats.additions}`)} ${chalk.red(`-${diff.stats.deletions}`)}`));
  lines.push(chalk.dim('│'));

  for (const hunk of diff.hunks) {
    // Hunk header
    lines.push(chalk.cyan(`│ @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`));

    for (const change of hunk.changes) {
      const content = change.content;
      switch (change.type) {
        case 'add':
          lines.push(chalk.green(`│ + ${content}`));
          break;
        case 'remove':
          lines.push(chalk.red(`│ - ${content}`));
          break;
        case 'context':
          lines.push(chalk.gray(`│   ${content}`));
          break;
      }
    }

    lines.push(chalk.dim('│'));
  }

  lines.push(chalk.hex('#FF6B35').bold('└─'));

  return lines.join('\n');
}

/**
 * Format a compact diff summary (for the status bar or brief output).
 */
export function formatDiffCompact(diff: FileDiff): string {
  const op = diff.operation === 'create' ? chalk.green('C') :
             diff.operation === 'delete' ? chalk.red('D') : chalk.yellow('M');
  return `${op} ${diff.filePath} (${chalk.green(`+${diff.stats.additions}`)} ${chalk.red(`-${diff.stats.deletions}`)})`;
}

/**
 * Generate diff for an edit_file operation (search & replace).
 */
export function generateEditDiff(
  filePath: string,
  fileContent: string,
  oldString: string,
  newString: string,
): FileDiff | null {
  const idx = fileContent.indexOf(oldString);
  if (idx === -1) return null;

  const newContent = fileContent.slice(0, idx) + newString + fileContent.slice(idx + oldString.length);
  return generateDiff(filePath, fileContent, newContent);
}

/**
 * Generate diff for a write_file operation (new file).
 */
export function generateWriteDiff(filePath: string, content: string): FileDiff {
  return generateDiff(filePath, '', content);
}
