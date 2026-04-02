// ─────────────────────────────────────────────────────────────
// Remus — Session Management
// Save/restore conversations to disk
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { randomUUID } from 'crypto';
import type { ConversationTurn, SessionStats } from './queryEngine.js';

export interface Session {
  id: string;
  name: string;
  cwd: string;
  model: string;
  provider: string;
  history: ConversationTurn[];
  stats: SessionStats;
  createdAt: number;
  updatedAt: number;
}

const SESSIONS_DIR = join(
  process.env.HOME ?? process.env.USERPROFILE ?? '/tmp',
  '.remus',
  'sessions'
);

function ensureSessionsDir(): void {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

/**
 * Save a session to disk.
 */
export function saveSession(session: Session): void {
  ensureSessionsDir();
  const filePath = join(SESSIONS_DIR, `${session.id}.json`);
  writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
}

/**
 * Load a session from disk by ID.
 */
export function loadSession(sessionId: string): Session | null {
  const filePath = join(SESSIONS_DIR, `${sessionId}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const data = readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as Session;
  } catch {
    return null;
  }
}

/**
 * List all saved sessions, most recent first.
 */
export function listSessions(): Array<{ id: string; name: string; cwd: string; updatedAt: number; model: string }> {
  ensureSessionsDir();
  const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
  const sessions: Array<{ id: string; name: string; cwd: string; updatedAt: number; model: string; mtime: number }> = [];

  for (const file of files) {
    const filePath = join(SESSIONS_DIR, file);
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8')) as Session;
      const stat = statSync(filePath);
      sessions.push({
        id: data.id,
        name: data.name,
        cwd: data.cwd,
        updatedAt: data.updatedAt,
        model: data.model,
        mtime: stat.mtimeMs,
      });
    } catch { /* skip corrupt sessions */ }
  }

  return sessions.sort((a, b) => b.mtime - a.mtime).map(({ mtime, ...rest }) => rest);
}

/**
 * Create a new session.
 */
export function createSession(opts: {
  cwd: string;
  model: string;
  provider: string;
  name?: string;
}): Session {
  const id = randomUUID().slice(0, 8);
  return {
    id,
    name: opts.name ?? `session-${id}`,
    cwd: opts.cwd,
    model: opts.model,
    provider: opts.provider,
    history: [],
    stats: {
      turns: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      toolCalls: 0,
      startTime: Date.now(),
      errors: 0,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Get the most recent session for a given cwd.
 */
export function getMostRecentSession(cwd: string): Session | null {
  const sessions = listSessions().filter(s => s.cwd === cwd);
  if (sessions.length === 0) return null;
  return loadSession(sessions[0]!.id);
}

/**
 * Generate a session name from the first user message.
 */
export function generateSessionName(firstMessage: string): string {
  const words = firstMessage.split(/\s+/).slice(0, 6).join(' ');
  return words.length > 50 ? words.slice(0, 47) + '...' : words;
}
