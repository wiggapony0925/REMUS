// ─────────────────────────────────────────────────────────────
// Remus — Undo System
// Automatic file backups before every edit/write operation
// ─────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, basename, dirname, relative } from 'path';
import { homedir } from 'os';

export interface UndoEntry {
  id: string;
  filePath: string;
  previousContent: string;
  newContent: string;
  operation: 'edit' | 'write' | 'create';
  timestamp: number;
  toolName: string;
  description: string;
}

const MAX_UNDO_ENTRIES = 200;
const UNDO_DIR = join(homedir(), '.remus', 'undo');

export class UndoManager {
  private stack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];

  constructor() {
    mkdirSync(UNDO_DIR, { recursive: true });
  }

  /**
   * Snapshot a file before modifying it.
   * Returns the undo entry ID.
   */
  snapshot(
    filePath: string,
    newContent: string,
    operation: 'edit' | 'write' | 'create',
    toolName: string,
    description: string,
  ): string {
    const id = `undo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const previousContent = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';

    const entry: UndoEntry = {
      id,
      filePath,
      previousContent,
      newContent,
      operation,
      timestamp: Date.now(),
      toolName,
      description,
    };

    this.stack.push(entry);
    this.redoStack = []; // Clear redo on new action

    // Persist to disk for crash recovery
    this.persistEntry(entry);

    // Trim old entries
    while (this.stack.length > MAX_UNDO_ENTRIES) {
      const old = this.stack.shift();
      if (old) this.removePersistedEntry(old.id);
    }

    return id;
  }

  /**
   * Undo the last file change.
   * Returns the undone entry, or null if nothing to undo.
   */
  undo(): UndoEntry | null {
    const entry = this.stack.pop();
    if (!entry) return null;

    try {
      if (entry.operation === 'create' && entry.previousContent === '') {
        // File was created — delete it
        if (existsSync(entry.filePath)) {
          unlinkSync(entry.filePath);
        }
      } else {
        // Restore previous content
        mkdirSync(dirname(entry.filePath), { recursive: true });
        writeFileSync(entry.filePath, entry.previousContent, 'utf-8');
      }

      this.redoStack.push(entry);
      this.removePersistedEntry(entry.id);
      return entry;
    } catch (err) {
      // Push it back if undo failed
      this.stack.push(entry);
      throw err;
    }
  }

  /**
   * Redo the last undone change.
   */
  redo(): UndoEntry | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;

    try {
      mkdirSync(dirname(entry.filePath), { recursive: true });
      writeFileSync(entry.filePath, entry.newContent, 'utf-8');
      this.stack.push(entry);
      this.persistEntry(entry);
      return entry;
    } catch (err) {
      this.redoStack.push(entry);
      throw err;
    }
  }

  /**
   * Get the undo stack (most recent last).
   */
  getStack(): UndoEntry[] {
    return [...this.stack];
  }

  /**
   * Get a summary of recent undo-able actions.
   */
  getSummary(count = 5): string {
    if (this.stack.length === 0) return 'No undo history.';

    const recent = this.stack.slice(-count).reverse();
    const lines = recent.map((e, i) => {
      const relPath = e.filePath;
      const ago = this.timeAgo(e.timestamp);
      return `  ${i + 1}. [${e.operation}] ${relPath} — ${e.description} (${ago})`;
    });

    return `Undo history (${this.stack.length} total):\n${lines.join('\n')}`;
  }

  /**
   * Number of entries in the undo stack.
   */
  get size(): number {
    return this.stack.length;
  }

  get canUndo(): boolean {
    return this.stack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // ─── Private Helpers ───

  private persistEntry(entry: UndoEntry): void {
    try {
      const file = join(UNDO_DIR, `${entry.id}.json`);
      writeFileSync(file, JSON.stringify({
        ...entry,
        // Don't persist contents to disk (could be large)
        previousContent: entry.previousContent.length > 50000 ? '[truncated]' : entry.previousContent,
        newContent: entry.newContent.length > 50000 ? '[truncated]' : entry.newContent,
      }), 'utf-8');
    } catch {
      // Non-critical
    }
  }

  private removePersistedEntry(id: string): void {
    try {
      const file = join(UNDO_DIR, `${id}.json`);
      if (existsSync(file)) unlinkSync(file);
    } catch {
      // Non-critical
    }
  }

  private timeAgo(ts: number): string {
    const seconds = Math.floor((Date.now() - ts) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  }

  /**
   * Cleanup: remove old persisted undo files (older than 24h)
   */
  static cleanup(): void {
    try {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const files = readdirSync(UNDO_DIR).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const full = join(UNDO_DIR, file);
        const stat = statSync(full);
        if (stat.mtimeMs < cutoff) {
          unlinkSync(full);
        }
      }
    } catch {
      // Non-critical
    }
  }
}
