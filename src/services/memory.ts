// ─────────────────────────────────────────────────────────────
// Remus — Persistent Memory System
// Remembers facts, preferences, and patterns across sessions
// BEATS: Claude Code (stateless) & Cursor (no memory)
// ─────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface MemoryEntry {
  id: string;
  type: 'fact' | 'preference' | 'pattern' | 'context' | 'correction';
  content: string;
  source: string;
  confidence: number; // 0-1
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  tags: string[];
}

export interface MemoryStore {
  version: number;
  entries: MemoryEntry[];
  metadata: {
    totalAccesses: number;
    lastPruned: number;
  };
}

/**
 * Persistent Memory — remembers important context across sessions.
 * 
 * Unlike Claude Code (completely stateless) and Cursor (forgets everything),
 * Remus builds a knowledge base about the user and their projects:
 * - Coding preferences (style, patterns, conventions)
 * - Project context (architecture decisions, tech stack)
 * - Past corrections (learns from its mistakes)
 * - User-taught facts (custom instructions that persist)
 */
export class Memory {
  private store: MemoryStore;
  private filePath: string;
  private maxEntries: number;
  private dirty = false;

  constructor(scope: 'global' | 'project' = 'global', cwd?: string) {
    this.maxEntries = 1000;

    if (scope === 'global') {
      const dir = join(homedir(), '.remus', 'memory');
      mkdirSync(dir, { recursive: true });
      this.filePath = join(dir, 'global.json');
    } else {
      const dir = join(cwd ?? process.cwd(), '.remus', 'memory');
      mkdirSync(dir, { recursive: true });
      this.filePath = join(dir, 'project.json');
    }

    this.store = this.load();
  }

  private load(): MemoryStore {
    if (existsSync(this.filePath)) {
      try {
        return JSON.parse(readFileSync(this.filePath, 'utf-8'));
      } catch {
        // Corrupted file, start fresh
      }
    }
    return {
      version: 1,
      entries: [],
      metadata: { totalAccesses: 0, lastPruned: Date.now() },
    };
  }

  private save(): void {
    if (!this.dirty) return;
    try {
      writeFileSync(this.filePath, JSON.stringify(this.store, null, 2), 'utf-8');
      this.dirty = false;
    } catch {
      // Silent fail — memory is best-effort
    }
  }

  /**
   * Add a new memory entry.
   */
  remember(
    content: string,
    type: MemoryEntry['type'] = 'fact',
    tags: string[] = [],
    confidence = 0.8,
    source = 'user',
  ): MemoryEntry {
    // Check for duplicates
    const existing = this.store.entries.find(e => 
      e.content.toLowerCase() === content.toLowerCase() && e.type === type
    );
    if (existing) {
      existing.confidence = Math.min(1, existing.confidence + 0.1);
      existing.lastAccessedAt = Date.now();
      existing.accessCount++;
      this.dirty = true;
      this.save();
      return existing;
    }

    const entry: MemoryEntry = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      content,
      source,
      confidence,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 0,
      tags,
    };

    this.store.entries.push(entry);
    this.dirty = true;

    // Prune if over limit
    if (this.store.entries.length > this.maxEntries) {
      this.prune();
    }

    this.save();
    return entry;
  }

  /**
   * Recall memories relevant to a query.
   */
  recall(query: string, limit = 10, minConfidence = 0.3): MemoryEntry[] {
    const queryTokens = new Set(query.toLowerCase().split(/\s+/));

    return this.store.entries
      .filter(e => e.confidence >= minConfidence)
      .map(entry => {
        const entryTokens = new Set(entry.content.toLowerCase().split(/\s+/));
        const tagTokens = new Set(entry.tags.map(t => t.toLowerCase()));
        
        // Score based on token overlap + tag match
        let score = 0;
        for (const token of queryTokens) {
          if (entryTokens.has(token)) score += 1;
          if (tagTokens.has(token)) score += 2;
        }
        // Boost by confidence and recency
        score *= entry.confidence;
        score *= 1 + (1 / (1 + (Date.now() - entry.lastAccessedAt) / (86400000 * 7))); // Decay over 7 days

        return { entry, score };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(r => {
        r.entry.lastAccessedAt = Date.now();
        r.entry.accessCount++;
        this.store.metadata.totalAccesses++;
        this.dirty = true;
        return r.entry;
      });
  }

  /**
   * Forget a specific memory.
   */
  forget(id: string): boolean {
    const idx = this.store.entries.findIndex(e => e.id === id);
    if (idx === -1) return false;
    this.store.entries.splice(idx, 1);
    this.dirty = true;
    this.save();
    return true;
  }

  /**
   * Get all memories, optionally filtered by type.
   */
  list(type?: MemoryEntry['type']): MemoryEntry[] {
    let entries = this.store.entries;
    if (type) {
      entries = entries.filter(e => e.type === type);
    }
    return entries.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
  }

  /**
   * Build a context string from relevant memories for the system prompt.
   */
  buildContext(query: string, maxTokens = 500): string {
    const relevant = this.recall(query, 20);
    if (relevant.length === 0) return '';

    const sections: string[] = ['# Remus Memory (from past sessions)'];
    let tokenEstimate = 10;

    for (const entry of relevant) {
      const line = `- [${entry.type}] ${entry.content}`;
      const lineTokens = Math.ceil(line.length / 4);
      if (tokenEstimate + lineTokens > maxTokens) break;
      sections.push(line);
      tokenEstimate += lineTokens;
    }

    return sections.join('\n');
  }

  /**
   * Auto-extract memories from a conversation turn.
   * Called after each assistant response to learn patterns.
   */
  autoExtract(userQuery: string, assistantResponse: string): void {
    // Extract corrections: "Actually, I should have..." / "You're right, let me..."
    if (/actually|correction|i was wrong|mistake|let me fix/i.test(assistantResponse)) {
      const correction = assistantResponse.split('\n')[0]?.slice(0, 200);
      if (correction) {
        this.remember(correction, 'correction', ['auto-extracted'], 0.6, 'auto');
      }
    }

    // Extract explicit preferences: "I prefer..." / "Always use..." / "Never..."
    const prefPatterns = [
      /(?:i (?:prefer|like|want|always use|never))\s+(.{10,100})/gi,
      /(?:always|never)\s+(.{10,80})/gi,
    ];
    for (const pattern of prefPatterns) {
      const matches = userQuery.matchAll(pattern);
      for (const match of matches) {
        if (match[1]) {
          this.remember(match[1].trim(), 'preference', ['auto-extracted'], 0.7, 'auto');
        }
      }
    }

    this.save();
  }

  /**
   * Prune low-value memories to stay under limit.
   */
  private prune(): void {
    // Score each entry
    const scored = this.store.entries.map(e => ({
      entry: e,
      value: e.confidence * (1 + e.accessCount) * (1 / (1 + (Date.now() - e.lastAccessedAt) / 86400000)),
    }));

    // Keep top entries
    scored.sort((a, b) => b.value - a.value);
    this.store.entries = scored.slice(0, this.maxEntries).map(s => s.entry);
    this.store.metadata.lastPruned = Date.now();
    this.dirty = true;
  }

  /**
   * Get stats about the memory store.
   */
  getStats(): {
    total: number;
    byType: Record<string, number>;
    totalAccesses: number;
    oldestDays: number;
  } {
    const byType: Record<string, number> = {};
    let oldest = Date.now();

    for (const entry of this.store.entries) {
      byType[entry.type] = (byType[entry.type] ?? 0) + 1;
      if (entry.createdAt < oldest) oldest = entry.createdAt;
    }

    return {
      total: this.store.entries.length,
      byType,
      totalAccesses: this.store.metadata.totalAccesses,
      oldestDays: Math.floor((Date.now() - oldest) / 86400000),
    };
  }

  /**
   * Flush any pending writes.
   */
  flush(): void {
    this.save();
  }
}
