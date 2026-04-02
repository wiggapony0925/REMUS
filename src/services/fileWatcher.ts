// ─────────────────────────────────────────────────────────────
// Remus — Live File Watcher
// Monitors project files in real-time. Auto-detects errors
// on save and offers instant fixes. Like a copilot that reacts.
// ─────────────────────────────────────────────────────────────

import { watch, type FSWatcher, existsSync, statSync, readFileSync } from 'fs';
import { join, extname, relative, basename } from 'path';
import { readdirSync } from 'fs';
import { execSync } from 'child_process';
import chalk from 'chalk';

export interface WatcherConfig {
  /** Root directory to watch */
  cwd: string;
  /** File extensions to watch (default: common code extensions) */
  extensions?: string[];
  /** Directories to ignore */
  ignoreDirs?: string[];
  /** Debounce delay in ms */
  debounceMs?: number;
  /** Run error detection on change */
  autoDetectErrors?: boolean;
  /** Max directory depth */
  maxDepth?: number;
}

export interface FileChangeEvent {
  type: 'change' | 'rename' | 'create' | 'delete';
  filePath: string;
  relativePath: string;
  timestamp: number;
}

export interface WatcherAlert {
  type: 'error' | 'warning' | 'info';
  filePath: string;
  message: string;
  line?: number;
  column?: number;
  fixSuggestion?: string;
}

export type WatcherCallback = (event: FileChangeEvent, alerts: WatcherAlert[]) => void;

const DEFAULT_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h',
  '.css', '.scss', '.less', '.html', '.vue', '.svelte',
  '.json', '.yaml', '.yml', '.toml',
  '.md', '.mdx',
];

const DEFAULT_IGNORE_DIRS = [
  'node_modules', '.git', 'dist', 'build', 'out', '.next',
  '__pycache__', '.venv', 'venv', 'target', '.cache',
  'coverage', '.turbo', '.nuxt',
];

export class FileWatcher {
  private watchers: FSWatcher[] = [];
  private callbacks: WatcherCallback[] = [];
  private config: Required<WatcherConfig>;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private isRunning = false;
  private changeCount = 0;
  private alertCount = 0;
  private lastErrors = new Map<string, string>();

  constructor(config: WatcherConfig) {
    this.config = {
      cwd: config.cwd,
      extensions: config.extensions ?? DEFAULT_EXTENSIONS,
      ignoreDirs: config.ignoreDirs ?? DEFAULT_IGNORE_DIRS,
      debounceMs: config.debounceMs ?? 500,
      autoDetectErrors: config.autoDetectErrors ?? true,
      maxDepth: config.maxDepth ?? 5,
    };
  }

  /**
   * Start watching for file changes.
   */
  start(callback: WatcherCallback): void {
    if (this.isRunning) return;

    this.callbacks.push(callback);
    this.isRunning = true;

    // Recursively watch directories
    this.watchDirectory(this.config.cwd, 0);
  }

  /**
   * Stop all watchers.
   */
  stop(): void {
    for (const watcher of this.watchers) {
      try { watcher.close(); } catch { /* ignore */ }
    }
    this.watchers = [];
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.isRunning = false;
  }

  /**
   * Get watcher statistics.
   */
  getStats(): { isRunning: boolean; changes: number; alerts: number; watchedDirs: number } {
    return {
      isRunning: this.isRunning,
      changes: this.changeCount,
      alerts: this.alertCount,
      watchedDirs: this.watchers.length,
    };
  }

  /**
   * Manually trigger error detection for a file.
   */
  detectErrors(filePath: string): WatcherAlert[] {
    const ext = extname(filePath);
    const alerts: WatcherAlert[] = [];

    // TypeScript/JavaScript: try tsc
    if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
      alerts.push(...this.detectTSErrors(filePath));
    }

    // Python: try basic syntax check
    if (ext === '.py') {
      alerts.push(...this.detectPythonErrors(filePath));
    }

    // JSON: validate syntax
    if (ext === '.json') {
      alerts.push(...this.detectJSONErrors(filePath));
    }

    // Generic: check for common issues
    alerts.push(...this.detectGenericIssues(filePath));

    return alerts;
  }

  // ─── Private ───

  private watchDirectory(dir: string, depth: number): void {
    if (depth > this.config.maxDepth) return;

    const dirName = basename(dir);
    if (this.config.ignoreDirs.includes(dirName)) return;

    try {
      const watcher = watch(dir, { recursive: false }, (eventType, filename) => {
        if (!filename) return;
        const fullPath = join(dir, filename);
        const ext = extname(filename);

        // Filter by extension
        if (!this.config.extensions.includes(ext)) return;

        // Debounce
        const existing = this.debounceTimers.get(fullPath);
        if (existing) clearTimeout(existing);

        this.debounceTimers.set(fullPath, setTimeout(() => {
          this.debounceTimers.delete(fullPath);
          this.handleFileChange(fullPath, eventType);
        }, this.config.debounceMs));
      });

      this.watchers.push(watcher);

      // Watch subdirectories
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !this.config.ignoreDirs.includes(entry.name)) {
          this.watchDirectory(join(dir, entry.name), depth + 1);
        }
      }
    } catch {
      // Can't watch this directory, skip it
    }
  }

  private handleFileChange(filePath: string, eventType: string): void {
    this.changeCount++;

    const event: FileChangeEvent = {
      type: this.inferChangeType(filePath, eventType),
      filePath,
      relativePath: relative(this.config.cwd, filePath),
      timestamp: Date.now(),
    };

    // Run error detection
    let alerts: WatcherAlert[] = [];
    if (this.config.autoDetectErrors && existsSync(filePath)) {
      alerts = this.detectErrors(filePath);
      this.alertCount += alerts.length;
    }

    // Notify callbacks
    for (const cb of this.callbacks) {
      try {
        cb(event, alerts);
      } catch {
        // Don't let callback errors break the watcher
      }
    }
  }

  private inferChangeType(filePath: string, fsEventType: string): FileChangeEvent['type'] {
    if (fsEventType === 'rename') {
      return existsSync(filePath) ? 'create' : 'delete';
    }
    return 'change';
  }

  private detectTSErrors(filePath: string): WatcherAlert[] {
    const alerts: WatcherAlert[] = [];
    try {
      // Quick check: try to find tsconfig
      const hasTsconfig = existsSync(join(this.config.cwd, 'tsconfig.json'));
      if (!hasTsconfig) return alerts;

      const output = execSync(
        `npx tsc --noEmit --pretty false "${filePath}" 2>&1`,
        { cwd: this.config.cwd, encoding: 'utf-8', timeout: 10_000 },
      );

      // Parse tsc output
      const errorRegex = /(.+)\((\d+),(\d+)\):\s+(error|warning)\s+TS\d+:\s+(.+)/g;
      let match;
      while ((match = errorRegex.exec(output)) !== null) {
        alerts.push({
          type: match[4] === 'error' ? 'error' : 'warning',
          filePath: match[1]!,
          line: parseInt(match[2]!, 10),
          column: parseInt(match[3]!, 10),
          message: match[5]!,
        });
      }
    } catch (err) {
      // tsc returns non-zero on errors, which execSync throws
      const output = (err as any).stdout ?? (err as any).stderr ?? '';
      if (typeof output === 'string') {
        const errorRegex = /(.+)\((\d+),(\d+)\):\s+(error|warning)\s+TS\d+:\s+(.+)/g;
        let match;
        while ((match = errorRegex.exec(output)) !== null) {
          alerts.push({
            type: match[4] === 'error' ? 'error' : 'warning',
            filePath: match[1]!,
            line: parseInt(match[2]!, 10),
            column: parseInt(match[3]!, 10),
            message: match[5]!,
          });
        }
      }
    }
    return alerts;
  }

  private detectPythonErrors(filePath: string): WatcherAlert[] {
    const alerts: WatcherAlert[] = [];
    try {
      execSync(`python3 -c "import ast; ast.parse(open('${filePath}').read())" 2>&1`, {
        encoding: 'utf-8',
        timeout: 5000,
      });
    } catch (err) {
      const output = (err as any).stderr ?? '';
      if (typeof output === 'string' && output.includes('SyntaxError')) {
        const lineMatch = output.match(/line (\d+)/);
        alerts.push({
          type: 'error',
          filePath,
          line: lineMatch ? parseInt(lineMatch[1]!, 10) : undefined,
          message: 'Python syntax error: ' + output.split('\n').pop()?.trim(),
        });
      }
    }
    return alerts;
  }

  private detectJSONErrors(filePath: string): WatcherAlert[] {
    const alerts: WatcherAlert[] = [];
    try {
      const content = readFileSync(filePath, 'utf-8');
      JSON.parse(content);
    } catch (err) {
      const message = (err as Error).message;
      const posMatch = message.match(/position (\d+)/);
      alerts.push({
        type: 'error',
        filePath,
        message: `Invalid JSON: ${message}`,
      });
    }
    return alerts;
  }

  private detectGenericIssues(filePath: string): WatcherAlert[] {
    const alerts: WatcherAlert[] = [];
    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      // Check for common issues
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;

        // Console.log left in code (warning)
        if (/console\.(log|debug|warn)\(/.test(line) && !filePath.includes('test') && !filePath.includes('spec')) {
          // Only flag if the file isn't a test
          // Actually, don't flag this — it's too noisy
        }

        // Very long lines (>300 chars, likely minified or problematic)
        if (line.length > 300 && !filePath.endsWith('.json') && !filePath.endsWith('.lock')) {
          alerts.push({
            type: 'warning',
            filePath,
            line: i + 1,
            message: `Very long line (${line.length} chars) — may be minified or needs wrapping`,
          });
          break; // Only flag once per file
        }

        // Merge conflict markers
        if (/^[<>=]{7}/.test(line)) {
          alerts.push({
            type: 'error',
            filePath,
            line: i + 1,
            message: 'Unresolved merge conflict marker detected',
          });
        }
      }
    } catch {
      // Can't read the file
    }
    return alerts;
  }
}

/**
 * Format alerts for display.
 */
export function formatAlerts(alerts: WatcherAlert[]): string {
  if (alerts.length === 0) return '';

  const lines: string[] = [];
  lines.push(chalk.hex('#FF6B35').bold('⬡ File Watcher Alerts'));

  for (const alert of alerts) {
    const icon = alert.type === 'error' ? chalk.red('✗') :
                 alert.type === 'warning' ? chalk.yellow('⚠') :
                 chalk.blue('ℹ');

    const location = alert.line
      ? chalk.dim(`:${alert.line}${alert.column ? `:${alert.column}` : ''}`)
      : '';

    lines.push(`  ${icon} ${chalk.white(alert.filePath)}${location}`);
    lines.push(`    ${alert.message}`);
    if (alert.fixSuggestion) {
      lines.push(`    ${chalk.green('Fix:')} ${alert.fixSuggestion}`);
    }
  }

  return lines.join('\n');
}
