// ─────────────────────────────────────────────────────────────
// Remus — Plugin System
// Extensible architecture: load custom tools, providers, hooks
// BEATS: Claude Code (zero extensibility) & Cursor (extensions only)
// ─────────────────────────────────────────────────────────────

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import type { Tool } from '../tools/types.js';
import type { LLMProvider } from '../providers/types.js';

export interface RemusPlugin {
  /** Unique plugin identifier */
  name: string;
  /** Semver version */
  version: string;
  /** Short description */
  description: string;
  /** Author name */
  author?: string;

  /** Custom tools to register */
  tools?: Tool[];
  /** Custom provider factory */
  providerFactory?: (config: Record<string, unknown>) => LLMProvider;
  /** Hook: called before each query */
  beforeQuery?: (query: string) => string | Promise<string>;
  /** Hook: called after each response */
  afterResponse?: (response: string) => string | Promise<string>;
  /** Hook: called before tool execution */
  beforeToolCall?: (toolName: string, input: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>;
  /** Hook: called after tool execution */
  afterToolCall?: (toolName: string, result: string) => string | Promise<string>;
  /** Hook: called on session start */
  onSessionStart?: () => void | Promise<void>;
  /** Hook: called on session end */
  onSessionEnd?: () => void | Promise<void>;
  /** Custom slash commands */
  commands?: Record<string, PluginCommand>;
  /** System prompt additions */
  systemPromptAddition?: string;
  /** Initialization function */
  init?: () => void | Promise<void>;
  /** Cleanup function */
  destroy?: () => void | Promise<void>;
}

export interface PluginCommand {
  description: string;
  usage?: string;
  handler: (args: string[]) => string | Promise<string>;
}

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  main: string;
  author?: string;
  dependencies?: Record<string, string>;
}

/**
 * Plugin Manager — discovers, loads, and manages Remus plugins.
 * 
 * Plugins can be loaded from:
 * - ~/.remus/plugins/       (global plugins)
 * - ./.remus/plugins/       (project-local plugins)
 * - remus.config.json plugins array
 * 
 * This is a MASSIVE differentiator. Neither Claude Code nor Cursor
 * allow users to extend the tool system at runtime.
 */
export class PluginManager {
  private plugins: Map<string, RemusPlugin> = new Map();
  private loadOrder: string[] = [];
  
  constructor() {}

  /**
   * Discover and load plugins from standard directories.
   */
  async discover(cwd?: string): Promise<string[]> {
    const discovered: string[] = [];
    const dirs = [
      join(process.env.HOME ?? '~', '.remus', 'plugins'),
    ];

    if (cwd) {
      dirs.push(join(cwd, '.remus', 'plugins'));
    }

    for (const dir of dirs) {
      if (!existsSync(dir)) continue;

      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const manifestPath = join(dir, entry.name, 'manifest.json');
        if (existsSync(manifestPath)) {
          discovered.push(join(dir, entry.name));
        }
      }
    }

    return discovered;
  }

  /**
   * Load a plugin from a directory.
   */
  async load(pluginDir: string): Promise<RemusPlugin | null> {
    const manifestPath = join(pluginDir, 'manifest.json');
    if (!existsSync(manifestPath)) {
      return null;
    }

    try {
      const manifest: PluginManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      const mainPath = resolve(pluginDir, manifest.main);

      if (!existsSync(mainPath)) {
        console.error(`Plugin ${manifest.name}: main file not found: ${mainPath}`);
        return null;
      }

      // Dynamic import of the plugin module
      const mod = await import(mainPath);
      const plugin: RemusPlugin = mod.default ?? mod;

      // Override with manifest info
      plugin.name = manifest.name;
      plugin.version = manifest.version;
      plugin.description = manifest.description;
      plugin.author = manifest.author;

      // Initialize
      if (plugin.init) {
        await plugin.init();
      }

      this.plugins.set(plugin.name, plugin);
      this.loadOrder.push(plugin.name);

      return plugin;
    } catch (err) {
      console.error(`Failed to load plugin from ${pluginDir}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Register a plugin directly (for built-in plugins).
   */
  register(plugin: RemusPlugin): void {
    this.plugins.set(plugin.name, plugin);
    this.loadOrder.push(plugin.name);
  }

  /**
   * Get all registered tools from all plugins.
   */
  getAllTools(): Tool[] {
    const tools: Tool[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.tools) {
        tools.push(...plugin.tools);
      }
    }
    return tools;
  }

  /**
   * Get all custom commands from all plugins.
   */
  getAllCommands(): Map<string, { plugin: string; command: PluginCommand }> {
    const commands = new Map<string, { plugin: string; command: PluginCommand }>();
    for (const [name, plugin] of this.plugins) {
      if (plugin.commands) {
        for (const [cmdName, cmd] of Object.entries(plugin.commands)) {
          commands.set(cmdName, { plugin: name, command: cmd });
        }
      }
    }
    return commands;
  }

  /**
   * Get all system prompt additions.
   */
  getSystemPromptAdditions(): string {
    const additions: string[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.systemPromptAddition) {
        additions.push(`\n# Plugin: ${plugin.name}\n${plugin.systemPromptAddition}`);
      }
    }
    return additions.join('\n');
  }

  /**
   * Run beforeQuery hooks through all plugins.
   */
  async runBeforeQuery(query: string): Promise<string> {
    let result = query;
    for (const name of this.loadOrder) {
      const plugin = this.plugins.get(name);
      if (plugin?.beforeQuery) {
        result = await plugin.beforeQuery(result);
      }
    }
    return result;
  }

  /**
   * Run afterResponse hooks through all plugins.
   */
  async runAfterResponse(response: string): Promise<string> {
    let result = response;
    for (const name of this.loadOrder) {
      const plugin = this.plugins.get(name);
      if (plugin?.afterResponse) {
        result = await plugin.afterResponse(result);
      }
    }
    return result;
  }

  /**
   * Run session start hooks.
   */
  async runSessionStart(): Promise<void> {
    for (const name of this.loadOrder) {
      const plugin = this.plugins.get(name);
      if (plugin?.onSessionStart) {
        await plugin.onSessionStart();
      }
    }
  }

  /**
   * Run session end hooks.
   */
  async runSessionEnd(): Promise<void> {
    for (const name of this.loadOrder) {
      const plugin = this.plugins.get(name);
      if (plugin?.onSessionEnd) {
        await plugin.onSessionEnd();
      }
    }
  }

  /**
   * Get list of loaded plugins.
   */
  list(): Array<{ name: string; version: string; description: string; tools: number; commands: number }> {
    return [...this.plugins.values()].map(p => ({
      name: p.name,
      version: p.version,
      description: p.description,
      tools: p.tools?.length ?? 0,
      commands: Object.keys(p.commands ?? {}).length,
    }));
  }

  /**
   * Unload a plugin.
   */
  async unload(name: string): Promise<boolean> {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    if (plugin.destroy) {
      await plugin.destroy();
    }

    this.plugins.delete(name);
    this.loadOrder = this.loadOrder.filter(n => n !== name);
    return true;
  }

  /**
   * Unload all plugins.
   */
  async unloadAll(): Promise<void> {
    for (const name of [...this.loadOrder].reverse()) {
      await this.unload(name);
    }
  }
}
