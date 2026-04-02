// ─────────────────────────────────────────────────────────────
// Remus — Response Cache
// Instant responses for repeated/similar queries
// BEATS: Claude Code (no caching) & Cursor (no caching)
// ─────────────────────────────────────────────────────────────

import { createHash } from 'crypto';

export interface CacheEntry {
  key: string;
  response: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  timestamp: number;
  hitCount: number;
  ttlMs: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  entries: number;
  savedTokens: number;
  savedCost: number;
  hitRate: string;
}

export interface ResponseCacheConfig {
  /** Max entries in cache */
  maxEntries?: number;
  /** Default TTL in ms (default: 5 min) */
  defaultTtlMs?: number;
  /** Max TTL in ms (default: 30 min) */
  maxTtlMs?: number;
  /** Enable semantic similarity matching (fuzzy) */
  fuzzyMatch?: boolean;
  /** Similarity threshold for fuzzy matching (0-1, default: 0.85) */
  similarityThreshold?: number;
}

/**
 * High-speed response cache with exact and fuzzy matching.
 * Dramatically speeds up repeated queries — something neither
 * Claude Code nor Cursor implements.
 */
export class ResponseCache {
  private cache = new Map<string, CacheEntry>();
  private maxEntries: number;
  private defaultTtlMs: number;
  private maxTtlMs: number;
  private fuzzyMatch: boolean;
  private similarityThreshold: number;

  // Stats
  private hits = 0;
  private misses = 0;
  private savedTokens = 0;

  constructor(config: ResponseCacheConfig = {}) {
    this.maxEntries = config.maxEntries ?? 500;
    this.defaultTtlMs = config.defaultTtlMs ?? 5 * 60 * 1000;
    this.maxTtlMs = config.maxTtlMs ?? 30 * 60 * 1000;
    this.fuzzyMatch = config.fuzzyMatch ?? true;
    this.similarityThreshold = config.similarityThreshold ?? 0.85;
  }

  /**
   * Generate a cache key from a query + context.
   */
  private generateKey(query: string, context?: string): string {
    const normalized = query.trim().toLowerCase().replace(/\s+/g, ' ');
    const input = context ? `${normalized}::${context}` : normalized;
    return createHash('sha256').update(input).digest('hex').slice(0, 16);
  }

  /**
   * Simple token-based similarity for fuzzy matching.
   * Uses Jaccard similarity on word tokens.
   */
  private similarity(a: string, b: string): number {
    const tokensA = new Set(a.trim().toLowerCase().split(/\s+/));
    const tokensB = new Set(b.trim().toLowerCase().split(/\s+/));
    const intersection = new Set([...tokensA].filter(t => tokensB.has(t)));
    const union = new Set([...tokensA, ...tokensB]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  /**
   * Look up a cached response. Returns null on miss.
   */
  get(query: string, context?: string): CacheEntry | null {
    const key = this.generateKey(query, context);
    
    // Exact match
    const exact = this.cache.get(key);
    if (exact) {
      if (Date.now() - exact.timestamp > exact.ttlMs) {
        this.cache.delete(key);
      } else {
        this.hits++;
        exact.hitCount++;
        this.savedTokens += exact.inputTokens + exact.outputTokens;
        return exact;
      }
    }

    // Fuzzy match
    if (this.fuzzyMatch) {
      const queryNorm = query.trim().toLowerCase();
      let bestMatch: CacheEntry | null = null;
      let bestSim = 0;

      for (const entry of this.cache.values()) {
        if (Date.now() - entry.timestamp > entry.ttlMs) continue;
        
        const keyNorm = entry.key;
        const sim = this.similarity(queryNorm, keyNorm);
        if (sim > bestSim && sim >= this.similarityThreshold) {
          bestSim = sim;
          bestMatch = entry;
        }
      }

      if (bestMatch) {
        this.hits++;
        bestMatch.hitCount++;
        this.savedTokens += bestMatch.inputTokens + bestMatch.outputTokens;
        return bestMatch;
      }
    }

    this.misses++;
    return null;
  }

  /**
   * Store a response in the cache.
   */
  set(
    query: string,
    response: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    context?: string,
    ttlMs?: number,
  ): void {
    // Don't cache very short or error responses
    if (response.length < 10 || response.startsWith('Error:')) return;

    // Evict expired entries
    this.evictExpired();

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxEntries) {
      this.evictOldest();
    }

    const key = this.generateKey(query, context);
    this.cache.set(key, {
      key: query.trim().toLowerCase(),
      response,
      model,
      inputTokens,
      outputTokens,
      timestamp: Date.now(),
      hitCount: 0,
      ttlMs: Math.min(ttlMs ?? this.defaultTtlMs, this.maxTtlMs),
    });
  }

  /**
   * Invalidate cache entries matching a pattern (e.g., after file changes).
   */
  invalidate(pattern?: RegExp): number {
    if (!pattern) {
      const count = this.cache.size;
      this.cache.clear();
      return count;
    }

    let count = 0;
    for (const [hash, entry] of this.cache) {
      if (pattern.test(entry.key)) {
        this.cache.delete(hash);
        count++;
      }
    }
    return count;
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.cache.size,
      savedTokens: this.savedTokens,
      savedCost: this.savedTokens * 0.000003, // Rough estimate
      hitRate: total === 0 ? '0%' : `${((this.hits / total) * 100).toFixed(1)}%`,
    };
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > entry.ttlMs) {
        this.cache.delete(key);
      }
    }
  }

  private evictOldest(): void {
    // LRU: remove entries with lowest hitCount, oldest first
    const entries = [...this.cache.entries()]
      .sort((a, b) => a[1].hitCount - b[1].hitCount || a[1].timestamp - b[1].timestamp);
    
    const toRemove = Math.max(1, Math.floor(this.maxEntries * 0.1));
    for (let i = 0; i < toRemove && i < entries.length; i++) {
      this.cache.delete(entries[i]![0]);
    }
  }

  reset(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.savedTokens = 0;
  }
}
