// ─────────────────────────────────────────────────────────────
// Remus — Configuration System
// Persistent user preferences via .remusrc
// ─────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface RemusConfig {
  // Provider settings
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;

  // Model routing
  smartModel?: string;      // For complex tasks
  fastModel?: string;       // For simple tasks (summaries, compaction)

  // Behavior
  temperature?: number;
  maxTokens?: number;
  maxTurns?: number;

  // Context
  maxContextTokens?: number;
  autoCompact?: boolean;

  // Cost
  showCost?: boolean;
  costWarningThreshold?: number;  // Warn when session cost exceeds this

  // Tools
  allowBash?: boolean;
  bashTimeout?: number;         // ms
  allowWebFetch?: boolean;

  // UI
  theme?: 'default' | 'minimal' | 'verbose';
  showToolCalls?: boolean;
  showTokenCount?: boolean;
  showDiffs?: boolean;

  // Undo
  enableUndo?: boolean;
  maxUndoEntries?: number;

  // Custom instructions (appended to system prompt)
  customInstructions?: string;
}

const DEFAULT_CONFIG: RemusConfig = {
  temperature: 0.7,
  maxTokens: 8192,
  maxTurns: 50,
  maxContextTokens: 100_000,
  autoCompact: false,
  showCost: true,
  costWarningThreshold: 1.00,
  allowBash: true,
  bashTimeout: 120_000,
  allowWebFetch: true,
  theme: 'default',
  showToolCalls: true,
  showTokenCount: true,
  showDiffs: true,
  enableUndo: true,
  maxUndoEntries: 200,
};

const CONFIG_FILES = [
  '.remusrc',
  '.remusrc.json',
  'remus.config.json',
];

/**
 * Load configuration from multiple sources (cascading):
 * 1. Built-in defaults
 * 2. ~/.remusrc (global)
 * 3. ./.remusrc (project-level)
 * 4. Environment variables
 * 5. CLI arguments (not handled here)
 */
export function loadConfig(cwd?: string): RemusConfig {
  let config = { ...DEFAULT_CONFIG };

  // Global config
  const homeDir = homedir();
  config = mergeConfigFromDir(config, homeDir);

  // Project-level config
  if (cwd) {
    config = mergeConfigFromDir(config, cwd);
  }

  // Environment variable overrides
  config = mergeEnvVars(config);

  return config;
}

/**
 * Save config to global ~/.remusrc
 */
export function saveGlobalConfig(config: Partial<RemusConfig>): void {
  const homeDir = homedir();
  const configDir = join(homeDir);
  const configPath = join(configDir, '.remusrc');

  const existing = loadConfigFromFile(configPath) ?? {};
  const merged = { ...existing, ...config };

  writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf-8');
}

/**
 * Save config to project-level .remusrc
 */
export function saveProjectConfig(cwd: string, config: Partial<RemusConfig>): void {
  const configPath = join(cwd, '.remusrc');

  const existing = loadConfigFromFile(configPath) ?? {};
  const merged = { ...existing, ...config };

  writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf-8');
}

/**
 * Get the global config path
 */
export function getGlobalConfigPath(): string {
  return join(homedir(), '.remusrc');
}

// ─── Internal Helpers ───

function mergeConfigFromDir(config: RemusConfig, dir: string): RemusConfig {
  for (const filename of CONFIG_FILES) {
    const filePath = join(dir, filename);
    const fileConfig = loadConfigFromFile(filePath);
    if (fileConfig) {
      config = { ...config, ...fileConfig };
    }
  }
  return config;
}

function loadConfigFromFile(filePath: string): Partial<RemusConfig> | null {
  if (!existsSync(filePath)) return null;

  try {
    const content = readFileSync(filePath, 'utf-8').trim();
    if (!content) return null;

    // Support JSON format
    if (content.startsWith('{')) {
      return JSON.parse(content) as Partial<RemusConfig>;
    }

    // Support simple key=value format
    const config: Record<string, unknown> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;

      const key = trimmed.slice(0, eqIdx).trim();
      let value: unknown = trimmed.slice(eqIdx + 1).trim();

      // Parse value types
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (!isNaN(Number(value)) && value !== '') value = Number(value);
      // Strip quotes
      else if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }

      config[key] = value;
    }

    return config as Partial<RemusConfig>;
  } catch {
    return null;
  }
}

function mergeEnvVars(config: RemusConfig): RemusConfig {
  const env = process.env;

  if (env.REMUS_PROVIDER) config.provider = env.REMUS_PROVIDER;
  if (env.REMUS_MODEL) config.model = env.REMUS_MODEL;
  if (env.REMUS_BASE_URL) config.baseUrl = env.REMUS_BASE_URL;
  if (env.REMUS_API_KEY) config.apiKey = env.REMUS_API_KEY;
  if (env.REMUS_TEMPERATURE) config.temperature = parseFloat(env.REMUS_TEMPERATURE);
  if (env.REMUS_MAX_TOKENS) config.maxTokens = parseInt(env.REMUS_MAX_TOKENS, 10);
  if (env.REMUS_MAX_TURNS) config.maxTurns = parseInt(env.REMUS_MAX_TURNS, 10);
  if (env.REMUS_SMART_MODEL) config.smartModel = env.REMUS_SMART_MODEL;
  if (env.REMUS_FAST_MODEL) config.fastModel = env.REMUS_FAST_MODEL;

  return config;
}
