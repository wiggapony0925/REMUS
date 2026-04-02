// ─────────────────────────────────────────────────────────────
// Remus — Diff Display Service
// Beautiful colored diffs for terminal output
// ─────────────────────────────────────────────────────────────

import chalk from 'chalk';

export interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'header' | 'separator';
  content: string;
  oldLine?: number;
  newLine?: number;
}

/**
 * Generate a unified diff between two strings.
 */
export function generateDiff(oldText: string, newText: string, filename?: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const diff: DiffLine[] = [];

  if (filename) {
    diff.push({ type: 'header', content: `--- a/${filename}` });
    diff.push({ type: 'header', content: `+++ b/${filename}` });
  }

  // Simple LCS-based diff
  const lcs = computeLCS(oldLines, newLines);
  let oldIdx = 0;
  let newIdx = 0;
  let oldLineNum = 1;
  let newLineNum = 1;

  for (const [oi, ni] of lcs) {
    // Lines removed (before common line)
    while (oldIdx < oi) {
      diff.push({ type: 'remove', content: oldLines[oldIdx], oldLine: oldLineNum++ });
      oldIdx++;
    }
    // Lines added (before common line)
    while (newIdx < ni) {
      diff.push({ type: 'add', content: newLines[newIdx], newLine: newLineNum++ });
      newIdx++;
    }
    // Common line
    diff.push({ type: 'context', content: oldLines[oldIdx], oldLine: oldLineNum++, newLine: newLineNum++ });
    oldIdx++;
    newIdx++;
  }

  // Remaining removed lines
  while (oldIdx < oldLines.length) {
    diff.push({ type: 'remove', content: oldLines[oldIdx], oldLine: oldLineNum++ });
    oldIdx++;
  }
  // Remaining added lines
  while (newIdx < newLines.length) {
    diff.push({ type: 'add', content: newLines[newIdx], newLine: newLineNum++ });
    newIdx++;
  }

  return diff;
}

/**
 * Format a diff for terminal display with colors.
 */
export function formatDiff(diffLines: DiffLine[], contextLines = 3): string {
  // Filter to show only changed regions with context
  const output: string[] = [];
  const changeIndices = new Set<number>();

  // Find indices of changed lines
  diffLines.forEach((line, i) => {
    if (line.type === 'add' || line.type === 'remove') {
      changeIndices.add(i);
      // Add context around changes
      for (let c = Math.max(0, i - contextLines); c <= Math.min(diffLines.length - 1, i + contextLines); c++) {
        changeIndices.add(c);
      }
    }
    if (line.type === 'header') {
      changeIndices.add(i);
    }
  });

  let lastShown = -2;

  for (let i = 0; i < diffLines.length; i++) {
    if (!changeIndices.has(i)) continue;

    const line = diffLines[i];

    // Separator between non-contiguous sections
    if (i > lastShown + 1 && lastShown >= 0) {
      output.push(chalk.gray('  ───'));
    }

    switch (line.type) {
      case 'header':
        output.push(chalk.bold(line.content));
        break;
      case 'add':
        output.push(chalk.green(`+ ${line.content}`));
        break;
      case 'remove':
        output.push(chalk.red(`- ${line.content}`));
        break;
      case 'context':
        output.push(chalk.gray(`  ${line.content}`));
        break;
      case 'separator':
        output.push(chalk.gray('  ───'));
        break;
    }

    lastShown = i;
  }

  return output.join('\n');
}

/**
 * Generate a compact inline diff for short changes.
 */
export function formatInlineDiff(oldText: string, newText: string): string {
  if (oldText === newText) return chalk.gray('(no change)');

  const lines: string[] = [];

  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // Simple: show removed then added
  if (oldLines.length <= 5 && newLines.length <= 5) {
    for (const l of oldLines) {
      lines.push(chalk.red(`- ${l}`));
    }
    for (const l of newLines) {
      lines.push(chalk.green(`+ ${l}`));
    }
  } else {
    lines.push(chalk.red(`- ${oldLines.length} lines removed`));
    lines.push(chalk.green(`+ ${newLines.length} lines added`));
  }

  return lines.join('\n');
}

/**
 * Get a short summary of changes: "3 additions, 2 deletions"
 */
export function diffStats(diffLines: DiffLine[]): { additions: number; deletions: number; summary: string } {
  let additions = 0;
  let deletions = 0;

  for (const line of diffLines) {
    if (line.type === 'add') additions++;
    if (line.type === 'remove') deletions++;
  }

  const parts: string[] = [];
  if (additions > 0) parts.push(chalk.green(`+${additions}`));
  if (deletions > 0) parts.push(chalk.red(`-${deletions}`));

  return {
    additions,
    deletions,
    summary: parts.join(', ') || 'no changes',
  };
}

// ─── LCS Algorithm ───

function computeLCS(a: string[], b: string[]): Array<[number, number]> {
  const m = a.length;
  const n = b.length;

  // For very large files, use a simpler/faster approach
  if (m * n > 1_000_000) {
    return simpleLCS(a, b);
  }

  // Standard DP LCS
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack
  const result: Array<[number, number]> = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return result;
}

/**
 * Simpler LCS for large files: match only exact same lines in sequence.
 */
function simpleLCS(a: string[], b: string[]): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  const bIndex = new Map<string, number[]>();

  // Index b lines
  for (let j = 0; j < b.length; j++) {
    const key = b[j];
    if (!bIndex.has(key)) bIndex.set(key, []);
    bIndex.get(key)!.push(j);
  }

  let lastJ = -1;
  for (let i = 0; i < a.length; i++) {
    const candidates = bIndex.get(a[i]);
    if (!candidates) continue;

    // Find first candidate after lastJ
    for (const j of candidates) {
      if (j > lastJ) {
        result.push([i, j]);
        lastJ = j;
        break;
      }
    }
  }

  return result;
}
