// ─────────────────────────────────────────────────────────────
// Remus — Main Entry Point
// The full terminal UI, CLI argument parsing, and REPL loop
// ─────────────────────────────────────────────────────────────

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { render, Text, Box, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { Command, Option } from 'commander';
import chalk from 'chalk';

import { createProvider, autoDetectProvider, type ProviderConfig } from './providers/index.js';
import { createToolPool } from './tools/index.js';
import { QueryEngine } from './services/queryEngine.js';
import { Markdown } from './components/Markdown.js';
import { StatusBar } from './components/StatusBar.js';
import { loadConfig, type RemusConfig } from './services/config.js';
import { UndoManager } from './services/undo.js';
import { think, TaskQueue } from './services/thinkMode.js';
import { PluginManager } from './services/pluginManager.js';
import { multiModelConsensus, formatConsensusResult, type ConsensusConfig, type ConsensusModel } from './services/multiModelConsensus.js';
import { runAutonomousAgent, formatAgentResult, type AgentConfig } from './services/autonomousAgent.js';
import { generateDiff, generateEditDiff, formatDiff, type FileDiff } from './services/diffPreview.js';
import { FileWatcher, formatAlerts, type WatcherAlert } from './services/fileWatcher.js';
import { parseGitIntent, executeGitIntent, formatGitPreview, formatGitResult } from './services/naturalLanguageGit.js';
import { generateTests, formatTestGenResult } from './services/testGenerator.js';
import {
  createSession,
  saveSession,
  loadSession,
  listSessions,
  generateSessionName,
  type Session,
} from './services/sessions.js';

// ─── CLI Argument Parsing ───

interface CLIOptions {
  print?: string;
  model?: string;
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  resume?: string;
  verbose?: boolean;
  maxTurns?: number;
  temperature?: number;
  instructions?: string;
}

function parseArgs(): CLIOptions {
  const program = new Command();

  program
    .name('remus')
    .description('Remus — by JfmCapitalGroup. Your AI coding assistant.')
    .version('1.0.0')
    .option('-p, --print <prompt>', 'Non-interactive: run a single prompt and print the response')
    .option('-m, --model <model>', 'Model to use (default: auto-detected)')
    .option('--provider <type>', 'LLM provider: ollama, openai, anthropic, openrouter, lmstudio, custom')
    .option('--base-url <url>', 'Base URL for the LLM API')
    .option('--api-key <key>', 'API key for the LLM provider')
    .option('-r, --resume [id]', 'Resume a previous session (optionally by ID)')
    .option('-v, --verbose', 'Show debug information')
    .option('--max-turns <n>', 'Maximum agent loop turns (default: 50)', parseInt as any)
    .option('--temperature <t>', 'Sampling temperature (default: 0.7)', parseFloat as any)
    .option('-i, --instructions <text>', 'Additional custom instructions for the system prompt')
    .parse(process.argv);

  return program.opts() as CLIOptions;
}

// ─── Non-Interactive (Headless) Mode ───

async function runHeadless(prompt: string, opts: CLIOptions): Promise<void> {
  const remusConfig = loadConfig(process.cwd());
  const providerConfig = resolveProviderConfig(opts, remusConfig);
  const provider = createProvider(providerConfig);
  const tools = createToolPool();
  const cwd = process.cwd();

  // Test connectivity
  const ok = await provider.ping();
  if (!ok) {
    console.error(chalk.red(`Cannot reach ${providerConfig.type} at ${providerConfig.baseUrl ?? 'default URL'}`));
    console.error(chalk.yellow('Check that your LLM server is running and the URL/key are correct.'));
    process.exit(1);
  }

  const engine = new QueryEngine({
    provider,
    tools,
    cwd,
    model: providerConfig.model,
    maxTurns: opts.maxTurns ?? remusConfig.maxTurns,
    temperature: opts.temperature ?? remusConfig.temperature,
    maxTokens: remusConfig.maxTokens,
    maxContextTokens: remusConfig.maxContextTokens,
    verbose: opts.verbose,
    customInstructions: opts.instructions ?? remusConfig.customInstructions,
    enableUndo: remusConfig.enableUndo,
    enableCostTracking: remusConfig.showCost,
    autoCompact: remusConfig.autoCompact,
    onText: (text) => process.stdout.write(text),
    onToolCall: (name, input) => {
      if (opts.verbose) {
        console.error(chalk.dim(`  → ${name}(${JSON.stringify(input).slice(0, 100)})`));
      }
    },
    onToolResult: (name, result) => {
      if (opts.verbose) {
        const preview = result.output.slice(0, 200).replace(/\n/g, '\\n');
        console.error(chalk.dim(`  ← ${name}: ${preview}`));
      }
    },
    onError: (err) => {
      console.error(chalk.red(`Error: ${err.message}`));
    },
    onRetry: (attempt, delay, err) => {
      console.error(chalk.yellow(`Retrying (attempt ${attempt}, ${(delay / 1000).toFixed(0)}s)... ${err.message.slice(0, 60)}`));
    },
  });

  await engine.submit(prompt);
  console.log(); // Final newline
}

// ─── Interactive REPL (Ink UI) ───

interface AppState {
  messages: Array<{ role: string; content: string; timestamp: number }>;
  isStreaming: boolean;
  streamingText: string;
  error: string | null;
  cost: string;
  contextTokens: number;
  speedIndicator: string;
}

function App({ opts }: { opts: CLIOptions }) {
  const { exit } = useApp();
  const [input, setInput] = useState('');
  const [state, setState] = useState<AppState>({
    messages: [],
    isStreaming: false,
    streamingText: '',
    error: null,
    cost: '$0.00',
    contextTokens: 0,
    speedIndicator: '',
  });

  const engineRef = useRef<QueryEngine | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const remusConfigRef = useRef<RemusConfig>(loadConfig(process.cwd()));
  const providerConfigRef = useRef<ProviderConfig>(resolveProviderConfig(opts, remusConfigRef.current));
  const taskQueueRef = useRef<TaskQueue>(new TaskQueue());
  const pluginManagerRef = useRef<PluginManager>(new PluginManager());
  const fileWatcherRef = useRef<FileWatcher | null>(null);
  const diffPreviewEnabledRef = useRef<boolean>(false);

  // Initialize engine
  useEffect(() => {
    const remusConfig = remusConfigRef.current;
    const providerConfig = providerConfigRef.current;
    const provider = createProvider(providerConfig);
    const tools = createToolPool();
    const cwd = process.cwd();

    const engine = new QueryEngine({
      provider,
      tools,
      cwd,
      model: providerConfig.model,
      maxTurns: opts.maxTurns ?? remusConfig.maxTurns,
      temperature: opts.temperature ?? remusConfig.temperature,
      maxTokens: remusConfig.maxTokens,
      maxContextTokens: remusConfig.maxContextTokens,
      verbose: opts.verbose,
      customInstructions: opts.instructions ?? remusConfig.customInstructions,
      enableUndo: remusConfig.enableUndo,
      enableCostTracking: remusConfig.showCost,
      autoCompact: remusConfig.autoCompact,
      onText: (text) => {
        setState(prev => ({
          ...prev,
          streamingText: prev.streamingText + text,
        }));
      },
      onToolCall: (name, input) => {
        setState(prev => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              role: 'tool-call',
              content: `${chalk.yellow('⚡')} ${chalk.bold(name)}${opts.verbose ? ` ${chalk.dim(JSON.stringify(input).slice(0, 120))}` : ''}`,
              timestamp: Date.now(),
            },
          ],
        }));
      },
      onToolResult: (name, result) => {
        if (result.isError) {
          setState(prev => ({
            ...prev,
            messages: [
              ...prev.messages,
              {
                role: 'tool-error',
                content: `${chalk.red('✗')} ${name}: ${result.output.slice(0, 200)}`,
                timestamp: Date.now(),
              },
            ],
          }));
        } else {
          const preview = result.output.split('\n').slice(0, 3).join('\n');
          setState(prev => ({
            ...prev,
            messages: [
              ...prev.messages,
              {
                role: 'tool-result',
                content: `${chalk.green('✓')} ${name}${opts.verbose ? `\n${chalk.dim(preview)}` : ''}`,
                timestamp: Date.now(),
              },
            ],
          }));
        }
      },
      onError: (err) => {
        setState(prev => ({ ...prev, error: err.message }));
      },
      onCostUpdate: (cost) => {
        setState(prev => ({ ...prev, cost }));
      },
      onRetry: (attempt, delay, err) => {
        setState(prev => ({
          ...prev,
          messages: [...prev.messages, {
            role: 'system',
            content: chalk.yellow(`⟳ Retrying (attempt ${attempt}, ${(delay / 1000).toFixed(0)}s delay)... ${err.message.slice(0, 60)}`),
            timestamp: Date.now(),
          }],
        }));
      },
      onSpeedUpdate: (indicator) => {
        setState(prev => ({ ...prev, speedIndicator: indicator }));
      },
    });

    engineRef.current = engine;

    // Create or resume session
    let session: Session;
    if (opts.resume) {
      const existing = typeof opts.resume === 'string' && opts.resume !== 'true'
        ? loadSession(opts.resume)
        : null;
      if (existing) {
        session = existing;
        setState(prev => ({
          ...prev,
          messages: existing.history.map(h => ({
            role: h.role,
            content: h.content,
            timestamp: h.timestamp,
          })),
        }));
      } else {
        // List recent sessions
        const recent = listSessions().slice(0, 10);
        if (recent.length > 0) {
          setState(prev => ({
            ...prev,
            messages: [{
              role: 'system',
              content: `Recent sessions:\n${recent.map((s, i) => 
                `  ${i + 1}. ${s.name} (${s.model}, ${new Date(s.updatedAt).toLocaleDateString()})`
              ).join('\n')}`,
              timestamp: Date.now(),
            }],
          }));
        }
        session = createSession({ cwd, model: providerConfig.model, provider: providerConfig.type });
      }
    } else {
      session = createSession({ cwd, model: providerConfig.model, provider: providerConfig.type });
    }
    sessionRef.current = session;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle submit
  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    // Slash commands
    if (trimmed.startsWith('/')) {
      const [cmd, ...args] = trimmed.slice(1).split(/\s+/);

      switch (cmd) {
        case 'exit':
        case 'quit':
        case 'q':
          if (sessionRef.current) {
            sessionRef.current.updatedAt = Date.now();
            saveSession(sessionRef.current);
          }
          exit();
          return;

        case 'clear':
          engineRef.current?.reset();
          setState({ messages: [], isStreaming: false, streamingText: '', error: null, cost: '$0.00', contextTokens: 0, speedIndicator: '' });
          setInput('');
          return;

        case 'help':
          setState(prev => ({
            ...prev,
            messages: [...prev.messages, {
              role: 'system',
              content: [
                '',
                chalk.hex('#FF6B35').bold('  ⬡ Remus Commands'),
                chalk.dim('  ────────────────────────────────────'),
                '',
                chalk.hex('#FF8C42').bold('  Chat'),
                `  ${chalk.hex('#FF8C42')('/clear')}        ${chalk.gray('─ Clear conversation')}`,
                `  ${chalk.hex('#FF8C42')('/model <name>')} ${chalk.gray('─ Switch model')}`,
                `  ${chalk.hex('#FF8C42')('/compact')}      ${chalk.gray('─ Compress context (save tokens)')}`,
                '',
                chalk.hex('#FF8C42').bold('  Intelligence'),
                `  ${chalk.hex('#FFB875')('/think <task>')} ${chalk.gray('─ Plan before executing')}`,
                `  ${chalk.hex('#FFB875')('/autofix')}      ${chalk.gray('─ Auto-detect & fix errors')}`,
                `  ${chalk.hex('#FFB875')('/memory')}       ${chalk.gray('─ View persistent memories')}`,
                `  ${chalk.hex('#FFB875')('/remember <x>')} ${chalk.gray('─ Teach Remus a fact')}`,
                '',
                chalk.hex('#FF8C42').bold('  Tasks'),
                `  ${chalk.hex('#FFD700')('/task add <t>')} ${chalk.gray('─ Queue a task')}`,
                `  ${chalk.hex('#FFD700')('/task list')}    ${chalk.gray('─ Show task queue')}`,
                `  ${chalk.hex('#FFD700')('/task run')}     ${chalk.gray('─ Execute all queued tasks')}`,
                `  ${chalk.hex('#FFD700')('/task clear')}   ${chalk.gray('─ Clear task queue')}`,
                '',
                chalk.hex('#FF8C42').bold('  History & Undo'),
                `  ${chalk.hex('#00CED1')('/undo')}         ${chalk.gray('─ Undo last file change')}`,
                `  ${chalk.hex('#00CED1')('/redo')}         ${chalk.gray('─ Redo last undone change')}`,
                `  ${chalk.hex('#00CED1')('/sessions')}     ${chalk.gray('─ List saved sessions')}`,
                `  ${chalk.hex('#00CED1')('/save')}         ${chalk.gray('─ Save current session')}`,
                '',
                chalk.hex('#FF8C42').bold('  Metrics'),
                `  ${chalk.hex('#00FF88')('/cost')}         ${chalk.gray('─ Detailed cost breakdown')}`,
                `  ${chalk.hex('#00FF88')('/speed')}        ${chalk.gray('─ Performance metrics')}`,
                `  ${chalk.hex('#00FF88')('/cache')}        ${chalk.gray('─ Cache hit statistics')}`,
                '',
                chalk.hex('#FF8C42').bold('  System'),
                `  ${chalk.hex('#B0B0B0')('/plugins')}      ${chalk.gray('─ List loaded plugins')}`,
                `  ${chalk.hex('#B0B0B0')('/health')}       ${chalk.gray('─ Project health check')}`,
                `  ${chalk.hex('#B0B0B0')('/exit')}         ${chalk.gray('─ Save and exit')}`,
                '',
                chalk.hex('#FF6B35').bold('  Advanced'),
                `  ${chalk.hex('#FF6B35')('/consensus <q>')} ${chalk.gray('─ Query multiple models & merge')}`,
                `  ${chalk.hex('#FF6B35')('/agent <goal>')}  ${chalk.gray('─ Autonomous multi-step agent')}`,
                `  ${chalk.hex('#FF6B35')('/test <file>')}   ${chalk.gray('─ Generate test suite for file')}`,
                `  ${chalk.hex('#FF6B35')('/git <english>')} ${chalk.gray('─ Git via natural language')}`,
                `  ${chalk.hex('#FF6B35')('/watch')}         ${chalk.gray('─ Live file watcher (auto-fix)')}`,
                `  ${chalk.hex('#FF6B35')('/diff')}          ${chalk.gray('─ Toggle diff preview mode')}`,
                '',
                chalk.hex('#FF6B35').bold('  ⌨ Keyboard'),
                chalk.dim('  ────────────────────────────────────'),
                `  ${chalk.hex('#FF8C42')('Ctrl+C')}        ${chalk.gray('─ Cancel / Exit')}`,
                `  ${chalk.hex('#FF8C42')('Enter')}         ${chalk.gray('─ Send message')}`,
                '',
              ].join('\n'),
              timestamp: Date.now(),
            }],
          }));
          setInput('');
          return;

        case 'cost':
        case 'stats': {
          const stats = engineRef.current?.stats;
          const costTracker = engineRef.current?.costTracker;
          const ctxTokens = engineRef.current?.getContextTokens() ?? 0;
          if (stats) {
            const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(0);
            const costSummary = costTracker ? costTracker.getSummary() : '';
            setState(prev => ({
              ...prev,
              messages: [...prev.messages, {
                role: 'system',
                content: [
                  chalk.bold('Session Stats:'),
                  `  Turns:          ${stats.turns}`,
                  `  Tool calls:     ${stats.toolCalls}`,
                  `  Input tokens:   ${stats.totalInputTokens.toLocaleString()}`,
                  `  Output tokens:  ${stats.totalOutputTokens.toLocaleString()}`,
                  `  Context tokens: ~${ctxTokens.toLocaleString()} (estimated)`,
                  `  Errors:         ${stats.errors}`,
                  `  Duration:       ${elapsed}s`,
                  '',
                  costSummary,
                ].join('\n'),
                timestamp: Date.now(),
              }],
            }));
          }
          setInput('');
          return;
        }

        case 'model': {
          const newModel = args.join(' ');
          if (newModel) {
            providerConfigRef.current = { ...providerConfigRef.current, model: newModel };
            setState(prev => ({
              ...prev,
              messages: [...prev.messages, {
                role: 'system',
                content: `Model switched to: ${newModel}`,
                timestamp: Date.now(),
              }],
            }));
          } else {
            setState(prev => ({
              ...prev,
              messages: [...prev.messages, {
                role: 'system',
                content: `Current model: ${providerConfigRef.current.model}\nUsage: /model <model-name>`,
                timestamp: Date.now(),
              }],
            }));
          }
          setInput('');
          return;
        }

        case 'sessions': {
          const sessions = listSessions().slice(0, 15);
          setState(prev => ({
            ...prev,
            messages: [...prev.messages, {
              role: 'system',
              content: sessions.length === 0
                ? 'No saved sessions.'
                : chalk.bold('Saved Sessions:\n') + sessions.map((s, i) =>
                    `  ${i + 1}. [${s.id}] ${s.name} — ${s.model} (${new Date(s.updatedAt).toLocaleDateString()})`
                  ).join('\n'),
              timestamp: Date.now(),
            }],
          }));
          setInput('');
          return;
        }

        case 'save': {
          if (sessionRef.current && engineRef.current) {
            sessionRef.current.history = engineRef.current.getHistory();
            sessionRef.current.stats = engineRef.current.stats;
            sessionRef.current.updatedAt = Date.now();
            saveSession(sessionRef.current);
            setState(prev => ({
              ...prev,
              messages: [...prev.messages, {
                role: 'system',
                content: `Session saved: ${sessionRef.current!.id}`,
                timestamp: Date.now(),
              }],
            }));
          }
          setInput('');
          return;
        }

        case 'undo': {
          const undoManager = engineRef.current?.undoManager;
          if (!undoManager?.canUndo) {
            setState(prev => ({
              ...prev,
              messages: [...prev.messages, {
                role: 'system',
                content: 'Nothing to undo.',
                timestamp: Date.now(),
              }],
            }));
          } else {
            try {
              const entry = undoManager.undo();
              if (entry) {
                setState(prev => ({
                  ...prev,
                  messages: [...prev.messages, {
                    role: 'system',
                    content: `${chalk.green('✓')} Undone: [${entry.operation}] ${entry.filePath}\n  ${entry.description}`,
                    timestamp: Date.now(),
                  }],
                }));
              }
            } catch (err) {
              setState(prev => ({
                ...prev,
                messages: [...prev.messages, {
                  role: 'system',
                  content: chalk.red(`Undo failed: ${(err as Error).message}`),
                  timestamp: Date.now(),
                }],
              }));
            }
          }
          setInput('');
          return;
        }

        case 'redo': {
          const undoManager = engineRef.current?.undoManager;
          if (!undoManager?.canRedo) {
            setState(prev => ({
              ...prev,
              messages: [...prev.messages, {
                role: 'system',
                content: 'Nothing to redo.',
                timestamp: Date.now(),
              }],
            }));
          } else {
            try {
              const entry = undoManager.redo();
              if (entry) {
                setState(prev => ({
                  ...prev,
                  messages: [...prev.messages, {
                    role: 'system',
                    content: `${chalk.green('✓')} Redone: [${entry.operation}] ${entry.filePath}`,
                    timestamp: Date.now(),
                  }],
                }));
              }
            } catch (err) {
              setState(prev => ({
                ...prev,
                messages: [...prev.messages, {
                  role: 'system',
                  content: chalk.red(`Redo failed: ${(err as Error).message}`),
                  timestamp: Date.now(),
                }],
              }));
            }
          }
          setInput('');
          return;
        }

        case 'compact': {
          if (!engineRef.current) { setInput(''); return; }
          setState(prev => ({
            ...prev,
            messages: [...prev.messages, {
              role: 'system',
              content: chalk.gray('Compacting context...'),
              timestamp: Date.now(),
            }],
          }));
          try {
            const saved = await engineRef.current.compact();
            const newTokens = engineRef.current.getContextTokens();
            setState(prev => ({
              ...prev,
              messages: [...prev.messages, {
                role: 'system',
                content: `${chalk.green('✓')} Compacted: saved ~${saved.toLocaleString()} tokens. Context is now ~${newTokens.toLocaleString()} tokens.`,
                timestamp: Date.now(),
              }],
            }));
          } catch (err) {
            setState(prev => ({
              ...prev,
              messages: [...prev.messages, {
                role: 'system',
                content: chalk.red(`Compaction failed: ${(err as Error).message}`),
                timestamp: Date.now(),
              }],
            }));
          }
          setInput('');
          return;
        }

        // ─── NEW v2 COMMANDS ───

        case 'think': {
          const taskDesc = args.join(' ');
          if (!taskDesc) {
            setState(prev => ({
              ...prev,
              messages: [...prev.messages, {
                role: 'system',
                content: 'Usage: /think <task description>\nRemus will analyze and plan before executing.',
                timestamp: Date.now(),
              }],
            }));
            setInput('');
            return;
          }
          setState(prev => ({
            ...prev,
            messages: [...prev.messages, {
              role: 'system',
              content: chalk.hex('#FFB875')('⬡ Thinking...'),
              timestamp: Date.now(),
            }],
          }));
          try {
            const providerConfig = providerConfigRef.current;
            const provider = createProvider(providerConfig);
            const result = await think(provider, providerConfig.model, taskDesc);
            const planMsg = [
              chalk.hex('#FF6B35').bold('⬡ Remus Think Mode'),
              chalk.dim('─'.repeat(40)),
              '',
              chalk.white.bold('Plan: ') + result.plan,
              '',
              chalk.hex('#FF8C42').bold('Steps:'),
              ...result.steps.map((s, i) => `  ${chalk.hex('#FFB875')(`${i + 1}.`)} ${s}`),
              '',
              result.risks.length > 0 ? chalk.yellow.bold('Risks:') : '',
              ...result.risks.map(r => `  ${chalk.yellow('⚠')} ${r}`),
              '',
              `${chalk.dim('Complexity:')} ${chalk.hex('#FF8C42')(result.estimatedComplexity)}  ${chalk.dim('Est. tool calls:')} ${chalk.hex('#FF8C42')(String(result.estimatedToolCalls))}  ${chalk.dim('Think time:')} ${chalk.hex('#FF8C42')(`${result.thinkingTime}ms`)}`,
              '',
              chalk.gray('Send "go" to execute this plan, or modify as needed.'),
            ].filter(Boolean).join('\n');

            setState(prev => ({
              ...prev,
              messages: [...prev.messages, {
                role: 'system',
                content: planMsg,
                timestamp: Date.now(),
              }],
            }));
          } catch (err) {
            setState(prev => ({
              ...prev,
              messages: [...prev.messages, {
                role: 'system',
                content: chalk.red(`Think mode error: ${(err as Error).message}`),
                timestamp: Date.now(),
              }],
            }));
          }
          setInput('');
          return;
        }

        case 'autofix': {
          if (!engineRef.current) { setInput(''); return; }
          setState(prev => ({
            ...prev,
            isStreaming: true,
            streamingText: '',
            messages: [...prev.messages, {
              role: 'system',
              content: chalk.hex('#FF6B35')('⬡ Auto-Fix Pipeline starting...'),
              timestamp: Date.now(),
            }],
          }));

          try {
            const response = await engineRef.current.submit(
              'Run a health check on this project. Look for TypeScript errors (tsc --noEmit), lint issues, and any obvious bugs. Fix ALL errors you find. After fixing, verify the fixes work by re-running the checks. Report what you fixed.'
            );
            setState(prev => ({
              ...prev,
              isStreaming: false,
              messages: [...prev.messages, {
                role: 'assistant',
                content: prev.streamingText || response,
                timestamp: Date.now(),
              }],
              streamingText: '',
            }));
          } catch (err) {
            setState(prev => ({
              ...prev,
              isStreaming: false,
              error: (err as Error).message,
              streamingText: '',
            }));
          }
          setInput('');
          return;
        }

        case 'memory': {
          const memory = engineRef.current?.memory;
          if (!memory) { setInput(''); return; }
          const stats = memory.getStats();
          const entries = memory.list().slice(0, 15);
          const memoryMsg = [
            chalk.hex('#FF6B35').bold('⬡ Remus Memory'),
            chalk.dim('─'.repeat(40)),
            `  Total memories: ${chalk.hex('#FF8C42')(String(stats.total))}`,
            `  Total accesses: ${chalk.hex('#FF8C42')(String(stats.totalAccesses))}`,
            `  Types: ${Object.entries(stats.byType).map(([t, c]) => `${t}(${c})`).join(', ')}`,
            '',
            entries.length > 0 ? chalk.hex('#FF8C42').bold('Recent:') : chalk.gray('No memories yet.'),
            ...entries.map(e => `  ${chalk.dim(`[${e.type}]`)} ${e.content.slice(0, 80)} ${chalk.dim(`(${e.accessCount} hits)`)}`),
          ].join('\n');
          setState(prev => ({
            ...prev,
            messages: [...prev.messages, {
              role: 'system',
              content: memoryMsg,
              timestamp: Date.now(),
            }],
          }));
          setInput('');
          return;
        }

        case 'remember': {
          const fact = args.join(' ');
          if (!fact) {
            setState(prev => ({
              ...prev,
              messages: [...prev.messages, {
                role: 'system',
                content: 'Usage: /remember <fact>\nTeach Remus something to remember across sessions.',
                timestamp: Date.now(),
              }],
            }));
            setInput('');
            return;
          }
          const memory = engineRef.current?.memory;
          if (memory) {
            memory.remember(fact, 'fact', ['user-taught'], 1.0, 'user');
            setState(prev => ({
              ...prev,
              messages: [...prev.messages, {
                role: 'system',
                content: `${chalk.green('✓')} Remembered: "${fact}"`,
                timestamp: Date.now(),
              }],
            }));
          }
          setInput('');
          return;
        }

        case 'task': {
          const subCmd = args[0];
          const taskArgs = args.slice(1).join(' ');
          const taskQueue = taskQueueRef.current;

          switch (subCmd) {
            case 'add': {
              if (!taskArgs) {
                setState(prev => ({
                  ...prev,
                  messages: [...prev.messages, {
                    role: 'system',
                    content: 'Usage: /task add <description>',
                    timestamp: Date.now(),
                  }],
                }));
                break;
              }
              const task = taskQueue.add(taskArgs);
              setState(prev => ({
                ...prev,
                messages: [...prev.messages, {
                  role: 'system',
                  content: `${chalk.green('✓')} Task #${task.id} added: "${taskArgs}"`,
                  timestamp: Date.now(),
                }],
              }));
              break;
            }
            case 'list': {
              const tasks = taskQueue.list();
              const progress = taskQueue.getProgress();
              const statusIcons: Record<string, string> = {
                pending: chalk.gray('○'),
                running: chalk.yellow('●'),
                completed: chalk.green('✓'),
                failed: chalk.red('✗'),
                skipped: chalk.dim('⊘'),
              };
              const listMsg = tasks.length === 0
                ? 'No tasks in queue. Use /task add <description>'
                : [
                    chalk.hex('#FF6B35').bold('⬡ Task Queue') + chalk.dim(` (${progress.completed}/${progress.total} done)`),
                    ...tasks.map(t => `  ${statusIcons[t.status]} #${t.id}: ${t.description}${t.error ? chalk.red(` — ${t.error}`) : ''}`),
                  ].join('\n');
              setState(prev => ({
                ...prev,
                messages: [...prev.messages, {
                  role: 'system',
                  content: listMsg,
                  timestamp: Date.now(),
                }],
              }));
              break;
            }
            case 'run': {
              if (!engineRef.current) break;
              const tasks = taskQueue.list().filter(t => t.status === 'pending');
              if (tasks.length === 0) {
                setState(prev => ({
                  ...prev,
                  messages: [...prev.messages, {
                    role: 'system',
                    content: 'No pending tasks. Use /task add <description> first.',
                    timestamp: Date.now(),
                  }],
                }));
                break;
              }
              setState(prev => ({
                ...prev,
                isStreaming: true,
                streamingText: '',
                messages: [...prev.messages, {
                  role: 'system',
                  content: chalk.hex('#FF6B35')(`⬡ Running ${tasks.length} task(s)...`),
                  timestamp: Date.now(),
                }],
              }));
              taskQueue.setRunning(true);
              for (const task of tasks) {
                taskQueue.markRunning(task.id);
                try {
                  const response = await engineRef.current.submit(task.description);
                  taskQueue.markCompleted(task.id, response.slice(0, 200));
                  setState(prev => ({
                    ...prev,
                    messages: [...prev.messages, {
                      role: 'system',
                      content: `${chalk.green('✓')} Task #${task.id} completed`,
                      timestamp: Date.now(),
                    }, {
                      role: 'assistant',
                      content: prev.streamingText || response,
                      timestamp: Date.now(),
                    }],
                    streamingText: '',
                  }));
                } catch (err) {
                  taskQueue.markFailed(task.id, (err as Error).message);
                  setState(prev => ({
                    ...prev,
                    messages: [...prev.messages, {
                      role: 'system',
                      content: `${chalk.red('✗')} Task #${task.id} failed: ${(err as Error).message}`,
                      timestamp: Date.now(),
                    }],
                  }));
                }
              }
              taskQueue.setRunning(false);
              setState(prev => ({ ...prev, isStreaming: false }));
              break;
            }
            case 'clear':
              taskQueue.clear();
              setState(prev => ({
                ...prev,
                messages: [...prev.messages, {
                  role: 'system',
                  content: `${chalk.green('✓')} Task queue cleared.`,
                  timestamp: Date.now(),
                }],
              }));
              break;
            default:
              setState(prev => ({
                ...prev,
                messages: [...prev.messages, {
                  role: 'system',
                  content: 'Usage: /task [add|list|run|clear] <description>',
                  timestamp: Date.now(),
                }],
              }));
          }
          setInput('');
          return;
        }

        case 'speed':
        case 'perf': {
          const perf = engineRef.current?.perf;
          if (!perf) { setInput(''); return; }
          const report = perf.getReport();
          setState(prev => ({
            ...prev,
            messages: [...prev.messages, {
              role: 'system',
              content: chalk.hex('#FF6B35').bold('⬡ Performance Metrics\n') + report,
              timestamp: Date.now(),
            }],
          }));
          setInput('');
          return;
        }

        case 'cache': {
          const cache = engineRef.current?.cache;
          if (!cache) { setInput(''); return; }
          const stats = cache.getStats();
          const cacheMsg = [
            chalk.hex('#FF6B35').bold('⬡ Cache Statistics'),
            chalk.dim('─'.repeat(40)),
            `  Entries:      ${chalk.hex('#FF8C42')(String(stats.entries))}`,
            `  Hits:         ${chalk.green(String(stats.hits))}`,
            `  Misses:       ${chalk.gray(String(stats.misses))}`,
            `  Hit Rate:     ${chalk.hex('#FF8C42')(stats.hitRate)}`,
            `  Tokens Saved: ${chalk.green(stats.savedTokens.toLocaleString())}`,
            `  Est. Savings: ${chalk.green(`$${stats.savedCost.toFixed(4)}`)}`,
          ].join('\n');
          setState(prev => ({
            ...prev,
            messages: [...prev.messages, {
              role: 'system',
              content: cacheMsg,
              timestamp: Date.now(),
            }],
          }));
          setInput('');
          return;
        }

        case 'plugins': {
          const plugins = pluginManagerRef.current.list();
          const pluginMsg = plugins.length === 0
            ? [
                chalk.hex('#FF6B35').bold('⬡ Plugins'),
                chalk.gray('  No plugins loaded.'),
                chalk.dim('  Add plugins to ~/.remus/plugins/ or .remus/plugins/'),
              ].join('\n')
            : [
                chalk.hex('#FF6B35').bold(`⬡ Plugins (${plugins.length})`),
                ...plugins.map(p => `  ${chalk.hex('#FF8C42')(p.name)} v${p.version} — ${p.description} (${p.tools} tools, ${p.commands} commands)`),
              ].join('\n');
          setState(prev => ({
            ...prev,
            messages: [...prev.messages, {
              role: 'system',
              content: pluginMsg,
              timestamp: Date.now(),
            }],
          }));
          setInput('');
          return;
        }

        case 'health': {
          if (!engineRef.current) { setInput(''); return; }
          setState(prev => ({
            ...prev,
            isStreaming: true,
            streamingText: '',
            messages: [...prev.messages, {
              role: 'system',
              content: chalk.hex('#FF6B35')('⬡ Running health checks...'),
              timestamp: Date.now(),
            }],
          }));
          try {
            const response = await engineRef.current.submit(
              'Use the check_health tool to run all available project health checks (typecheck, lint, test, deps). Report the results clearly.'
            );
            setState(prev => ({
              ...prev,
              isStreaming: false,
              messages: [...prev.messages, {
                role: 'assistant',
                content: prev.streamingText || response,
                timestamp: Date.now(),
              }],
              streamingText: '',
            }));
          } catch (err) {
            setState(prev => ({
              ...prev,
              isStreaming: false,
              error: (err as Error).message,
              streamingText: '',
            }));
          }
          setInput('');
          return;
        }

        // ─── NEW v2.1 COMMANDS ───

        case 'consensus': {
          const query = args.join(' ');
          if (!query) {
            setState(prev => ({
              ...prev,
              messages: [...prev.messages, {
                role: 'system',
                content: [
                  'Usage: /consensus <question>',
                  'Query multiple models and get a merged answer.',
                  '',
                  'Requires at least 2 providers configured:',
                  '  OPENAI_API_KEY + ANTHROPIC_API_KEY, or',
                  '  Multiple models via REMUS_PROVIDER',
                ].join('\n'),
                timestamp: Date.now(),
              }],
            }));
            setInput('');
            return;
          }

          setState(prev => ({
            ...prev,
            isStreaming: true,
            messages: [...prev.messages, {
              role: 'system',
              content: chalk.hex('#FF6B35')('⬡ Multi-Model Consensus — querying models...'),
              timestamp: Date.now(),
            }],
          }));

          try {
            // Build model list from available providers
            const consensusModels: ConsensusModel[] = [];
            const pc = providerConfigRef.current;

            // Primary model
            consensusModels.push({ provider: pc, label: `${pc.type}/${pc.model}` });

            // Try to find a second model
            if (pc.fastModel && pc.fastModel !== pc.model) {
              consensusModels.push({
                provider: { ...pc, model: pc.fastModel },
                label: `${pc.type}/${pc.fastModel}`,
              });
            } else if (pc.smartModel && pc.smartModel !== pc.model) {
              consensusModels.push({
                provider: { ...pc, model: pc.smartModel },
                label: `${pc.type}/${pc.smartModel}`,
              });
            } else {
              // Use same provider with different temperature as fallback
              consensusModels.push({
                provider: { ...pc },
                label: `${pc.type}/${pc.model} (alt)`,
              });
            }

            const result = await multiModelConsensus(query, 'You are a helpful assistant.', {
              models: consensusModels,
              strategy: 'merge',
              timeoutMs: 30_000,
            });

            setState(prev => ({
              ...prev,
              isStreaming: false,
              messages: [...prev.messages, {
                role: 'system',
                content: formatConsensusResult(result),
                timestamp: Date.now(),
              }],
              streamingText: '',
            }));
          } catch (err) {
            setState(prev => ({
              ...prev,
              isStreaming: false,
              error: `Consensus failed: ${(err as Error).message}`,
              streamingText: '',
            }));
          }
          setInput('');
          return;
        }

        case 'agent': {
          const goal = args.join(' ');
          if (!goal) {
            setState(prev => ({
              ...prev,
              messages: [...prev.messages, {
                role: 'system',
                content: [
                  'Usage: /agent <goal>',
                  'Remus plans and executes autonomously.',
                  '',
                  'Examples:',
                  '  /agent add authentication to this app',
                  '  /agent refactor the database layer to use connection pooling',
                  '  /agent set up CI/CD with GitHub Actions',
                ].join('\n'),
                timestamp: Date.now(),
              }],
            }));
            setInput('');
            return;
          }

          if (!engineRef.current) { setInput(''); return; }

          setState(prev => ({
            ...prev,
            isStreaming: true,
            streamingText: '',
            messages: [...prev.messages, {
              role: 'system',
              content: chalk.hex('#FF6B35')('⬡ Autonomous Agent — planning...'),
              timestamp: Date.now(),
            }],
          }));

          try {
            const agentConfig: AgentConfig = {
              maxSteps: 10,
              requireApproval: false,
              stopOnError: false,
              verbose: true,
              providerConfig: providerConfigRef.current,
            };

            const result = await runAutonomousAgent(
              goal,
              engineRef.current,
              agentConfig,
              (event) => {
                if (event.type === 'plan-ready') {
                  setState(prev => ({
                    ...prev,
                    messages: [...prev.messages, {
                      role: 'system',
                      content: [
                        chalk.hex('#FF6B35').bold('⬡ Agent Plan:'),
                        chalk.white(event.plan),
                        '',
                        chalk.hex('#FF8C42').bold('Steps:'),
                        ...event.steps.map((s, i) => `  ${chalk.hex('#FFB875')(`${i + 1}.`)} ${s}`),
                        event.risks.length > 0 ? `\n${chalk.yellow('Risks:')}\n${event.risks.map(r => `  ⚠ ${r}`).join('\n')}` : '',
                        '',
                        chalk.hex('#FF6B35')('Executing...'),
                      ].filter(Boolean).join('\n'),
                      timestamp: Date.now(),
                    }],
                  }));
                } else if (event.type === 'step-start') {
                  setState(prev => ({
                    ...prev,
                    messages: [...prev.messages, {
                      role: 'system',
                      content: chalk.hex('#FFB875')(`  ● Step ${event.step}/${event.total}: ${event.description}`),
                      timestamp: Date.now(),
                    }],
                  }));
                } else if (event.type === 'step-complete') {
                  setState(prev => ({
                    ...prev,
                    messages: [...prev.messages, {
                      role: 'system',
                      content: chalk.green(`  ✓ Step ${event.step} done`),
                      timestamp: Date.now(),
                    }],
                  }));
                } else if (event.type === 'step-failed') {
                  setState(prev => ({
                    ...prev,
                    messages: [...prev.messages, {
                      role: 'system',
                      content: chalk.red(`  ✗ Step ${event.step} failed: ${event.error}`),
                      timestamp: Date.now(),
                    }],
                  }));
                }
              },
            );

            setState(prev => ({
              ...prev,
              isStreaming: false,
              messages: [...prev.messages, {
                role: 'system',
                content: formatAgentResult(result),
                timestamp: Date.now(),
              }],
              streamingText: '',
            }));
          } catch (err) {
            setState(prev => ({
              ...prev,
              isStreaming: false,
              error: `Agent failed: ${(err as Error).message}`,
              streamingText: '',
            }));
          }
          setInput('');
          return;
        }

        case 'diff': {
          // Toggle diff preview mode
          diffPreviewEnabledRef.current = !diffPreviewEnabledRef.current;
          setState(prev => ({
            ...prev,
            messages: [...prev.messages, {
              role: 'system',
              content: diffPreviewEnabledRef.current
                ? `${chalk.green('✓')} Diff preview mode ${chalk.green('enabled')} — edits will show diffs before applying`
                : `${chalk.yellow('○')} Diff preview mode ${chalk.yellow('disabled')} — edits apply directly`,
              timestamp: Date.now(),
            }],
          }));
          setInput('');
          return;
        }

        case 'watch': {
          const subCmd = args[0];

          if (subCmd === 'stop') {
            if (fileWatcherRef.current) {
              fileWatcherRef.current.stop();
              const stats = fileWatcherRef.current.getStats();
              fileWatcherRef.current = null;
              setState(prev => ({
                ...prev,
                messages: [...prev.messages, {
                  role: 'system',
                  content: `${chalk.yellow('○')} File watcher stopped (tracked ${stats.changes} changes, ${stats.alerts} alerts)`,
                  timestamp: Date.now(),
                }],
              }));
            } else {
              setState(prev => ({
                ...prev,
                messages: [...prev.messages, {
                  role: 'system',
                  content: 'File watcher is not running.',
                  timestamp: Date.now(),
                }],
              }));
            }
            setInput('');
            return;
          }

          if (subCmd === 'status') {
            const stats = fileWatcherRef.current?.getStats();
            setState(prev => ({
              ...prev,
              messages: [...prev.messages, {
                role: 'system',
                content: stats
                  ? [
                      chalk.hex('#FF6B35').bold('⬡ File Watcher'),
                      `  Status: ${stats.isRunning ? chalk.green('running') : chalk.gray('stopped')}`,
                      `  Watching: ${chalk.hex('#FF8C42')(String(stats.watchedDirs))} directories`,
                      `  Changes detected: ${chalk.hex('#FF8C42')(String(stats.changes))}`,
                      `  Alerts raised: ${chalk.hex('#FF8C42')(String(stats.alerts))}`,
                    ].join('\n')
                  : 'File watcher is not running. Use /watch to start.',
                timestamp: Date.now(),
              }],
            }));
            setInput('');
            return;
          }

          // Start watching
          if (fileWatcherRef.current) {
            setState(prev => ({
              ...prev,
              messages: [...prev.messages, {
                role: 'system',
                content: 'File watcher is already running. Use /watch stop to stop it.',
                timestamp: Date.now(),
              }],
            }));
            setInput('');
            return;
          }

          const watcher = new FileWatcher({ cwd: process.cwd() });
          fileWatcherRef.current = watcher;

          watcher.start((event, alerts) => {
            const parts: string[] = [];
            const icon = event.type === 'create' ? chalk.green('⊕') :
                         event.type === 'delete' ? chalk.red('⊖') :
                         chalk.yellow('⟳');
            parts.push(`${icon} ${chalk.dim('[watch]')} ${event.relativePath}`);

            if (alerts.length > 0) {
              parts.push(formatAlerts(alerts));

              // Offer to fix errors
              const errorAlerts = alerts.filter(a => a.type === 'error');
              if (errorAlerts.length > 0) {
                parts.push(chalk.hex('#FFB875')(`\n  💡 ${errorAlerts.length} error(s) detected. Send "fix it" or use /autofix`));
              }
            }

            setState(prev => ({
              ...prev,
              messages: [...prev.messages, {
                role: 'system',
                content: parts.join('\n'),
                timestamp: Date.now(),
              }],
            }));
          });

          setState(prev => ({
            ...prev,
            messages: [...prev.messages, {
              role: 'system',
              content: `${chalk.green('✓')} File watcher ${chalk.green('started')} — monitoring for changes.\n  Use /watch status for info, /watch stop to stop.`,
              timestamp: Date.now(),
            }],
          }));
          setInput('');
          return;
        }

        case 'git': {
          const gitInput = args.join(' ');
          if (!gitInput) {
            setState(prev => ({
              ...prev,
              messages: [...prev.messages, {
                role: 'system',
                content: [
                  'Usage: /git <natural language>',
                  '',
                  'Examples:',
                  '  /git show me what changed',
                  '  /git commit everything with message "feat: add auth"',
                  '  /git create branch called feature/login',
                  '  /git switch to main',
                  '  /git undo last 2 commits',
                  '  /git show me what changed yesterday',
                  '  /git push to origin',
                  '  /git stash my changes',
                  '  /git who wrote src/main.tsx',
                ].join('\n'),
                timestamp: Date.now(),
              }],
            }));
            setInput('');
            return;
          }

          const intent = parseGitIntent(gitInput);

          if (intent.intent === 'unknown') {
            setState(prev => ({
              ...prev,
              messages: [...prev.messages, {
                role: 'system',
                content: chalk.yellow(`Couldn't understand: "${gitInput}"\nTry: /git show status, /git commit all, /git create branch <name>`),
                timestamp: Date.now(),
              }],
            }));
            setInput('');
            return;
          }

          // Show preview
          setState(prev => ({
            ...prev,
            messages: [...prev.messages, {
              role: 'system',
              content: formatGitPreview(intent),
              timestamp: Date.now(),
            }],
          }));

          // Execute (destructive commands would need approval in production)
          if (intent.destructive) {
            setState(prev => ({
              ...prev,
              messages: [...prev.messages, {
                role: 'system',
                content: chalk.yellow('⚠ This is a destructive operation. Executing with safe defaults (--soft for reset)...'),
                timestamp: Date.now(),
              }],
            }));
          }

          const result = executeGitIntent(intent, process.cwd());
          setState(prev => ({
            ...prev,
            messages: [...prev.messages, {
              role: 'system',
              content: formatGitResult(result),
              timestamp: Date.now(),
            }],
          }));
          setInput('');
          return;
        }

        case 'test': {
          const filePath = args[0];
          if (!filePath) {
            setState(prev => ({
              ...prev,
              messages: [...prev.messages, {
                role: 'system',
                content: [
                  'Usage: /test <file>',
                  'Generate a full test suite for any source file.',
                  '',
                  'Examples:',
                  '  /test src/utils/parser.ts',
                  '  /test lib/auth.py',
                  '  /test pkg/handler.go',
                ].join('\n'),
                timestamp: Date.now(),
              }],
            }));
            setInput('');
            return;
          }

          setState(prev => ({
            ...prev,
            isStreaming: true,
            messages: [...prev.messages, {
              role: 'system',
              content: chalk.hex('#FF6B35')(`⬡ Generating tests for ${filePath}...`),
              timestamp: Date.now(),
            }],
          }));

          try {
            const pc = providerConfigRef.current;
            const provider = createProvider(pc);
            const result = await generateTests(filePath, {
              provider,
              model: pc.model,
              cwd: process.cwd(),
            });

            setState(prev => ({
              ...prev,
              isStreaming: false,
              messages: [...prev.messages, {
                role: 'system',
                content: formatTestGenResult(result),
                timestamp: Date.now(),
              }],
              streamingText: '',
            }));
          } catch (err) {
            setState(prev => ({
              ...prev,
              isStreaming: false,
              error: `Test generation failed: ${(err as Error).message}`,
              streamingText: '',
            }));
          }
          setInput('');
          return;
        }

        default:
          // Check plugin commands
          const pluginCmd = pluginManagerRef.current.getAllCommands().get(cmd!);
          if (pluginCmd) {
            try {
              const result = await pluginCmd.command.handler(args);
              setState(prev => ({
                ...prev,
                messages: [...prev.messages, {
                  role: 'system',
                  content: result,
                  timestamp: Date.now(),
                }],
              }));
            } catch (err) {
              setState(prev => ({
                ...prev,
                messages: [...prev.messages, {
                  role: 'system',
                  content: chalk.red(`Plugin command error: ${(err as Error).message}`),
                  timestamp: Date.now(),
                }],
              }));
            }
            setInput('');
            return;
          }

          setState(prev => ({
            ...prev,
            messages: [...prev.messages, {
              role: 'system',
              content: `Unknown command: /${cmd}. Type /help for available commands.`,
              timestamp: Date.now(),
            }],
          }));
          setInput('');
          return;
      }
    }

    // Regular message — send to LLM
    setInput('');
    setState(prev => ({
      ...prev,
      isStreaming: true,
      streamingText: '',
      error: null,
      messages: [...prev.messages, {
        role: 'user',
        content: trimmed,
        timestamp: Date.now(),
      }],
    }));

    // Update session name from first message
    if (sessionRef.current && sessionRef.current.history.length === 0) {
      sessionRef.current.name = generateSessionName(trimmed);
    }

    try {
      const response = await engineRef.current!.submit(trimmed);

      setState(prev => ({
        ...prev,
        isStreaming: false,
        messages: [...prev.messages, {
          role: 'assistant',
          content: prev.streamingText || response,
          timestamp: Date.now(),
        }],
        streamingText: '',
      }));

      // Auto-save
      if (sessionRef.current && engineRef.current) {
        sessionRef.current.history = engineRef.current.getHistory();
        sessionRef.current.stats = engineRef.current.stats;
        sessionRef.current.updatedAt = Date.now();
        saveSession(sessionRef.current);
      }
    } catch (err) {
      setState(prev => ({
        ...prev,
        isStreaming: false,
        error: (err as Error).message,
        streamingText: '',
      }));
    }
  }, [exit, opts.verbose]);

  // Handle Ctrl+C
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (state.isStreaming) {
        engineRef.current?.abort();
        setState(prev => ({ ...prev, isStreaming: false, streamingText: '' }));
      } else {
        if (sessionRef.current && engineRef.current) {
          sessionRef.current.history = engineRef.current.getHistory();
          sessionRef.current.stats = engineRef.current.stats;
          sessionRef.current.updatedAt = Date.now();
          saveSession(sessionRef.current);
        }
        exit();
      }
    }
  });

  const providerConfig = providerConfigRef.current;

  return (
    <Box flexDirection="column" padding={0}>
      {/* Messages */}
      <Box flexDirection="column" paddingX={1}>
        {state.messages.map((msg, i) => (
          <Box key={i} flexDirection="column" marginBottom={1}>
            {msg.role === 'user' ? (
              <Box flexDirection="column">
                <Box>
                  <Text color="#FF6B35" bold>{'❯ '}</Text>
                  <Text color="#FFFFFF" bold>{msg.content}</Text>
                </Box>
                <Box>
                  <Text color="#333333">{'  ' + '─'.repeat(Math.min(60, (msg.content?.length ?? 0) + 2))}</Text>
                </Box>
              </Box>
            ) : msg.role === 'assistant' ? (
              <Box flexDirection="column">
                <Box marginBottom={0}>
                  <Text color="#FF8C42" bold>{'◈ '}</Text>
                  <Text color="#FF8C42" bold>Remus</Text>
                </Box>
                <Box marginLeft={2} borderStyle="single" borderLeft borderTop={false} borderBottom={false} borderRight={false} borderColor="#333333" paddingLeft={1}>
                  <Markdown text={msg.content} />
                </Box>
              </Box>
            ) : msg.role === 'tool-call' ? (
              <Box marginLeft={3}>
                <Text color="#FBBF24">{'⚡ '}</Text>
                <Text color="#FBBF24">{msg.content}</Text>
              </Box>
            ) : msg.role === 'tool-result' ? (
              <Box marginLeft={3}>
                <Text color="#4ADE80">{'✓ '}</Text>
                <Text color="#4ADE80">{msg.content}</Text>
              </Box>
            ) : msg.role === 'tool-error' ? (
              <Box marginLeft={3}>
                <Text color="#F87171">{'✗ '}</Text>
                <Text color="#F87171">{msg.content}</Text>
              </Box>
            ) : (
              <Box marginLeft={2}>
                <Text color="#666666">{msg.content}</Text>
              </Box>
            )}
          </Box>
        ))}

        {/* Streaming response */}
        {state.isStreaming && state.streamingText && (
          <Box flexDirection="column" marginBottom={1}>
            <Box marginBottom={0}>
              <Text color="#FBBF24" bold>{'◈ '}</Text>
              <Text color="#FF8C42" bold>Remus</Text>
              <Text color="#FBBF24">{' ●'}</Text>
            </Box>
            <Box marginLeft={2} borderStyle="single" borderLeft borderTop={false} borderBottom={false} borderRight={false} borderColor="#FBBF24" paddingLeft={1}>
              <Markdown text={state.streamingText} />
            </Box>
          </Box>
        )}

        {state.isStreaming && !state.streamingText && (
          <Box marginLeft={2}>
            <Text color="#FBBF24">{'◈ '}</Text>
            <Text color="#777777" italic>Thinking...</Text>
          </Box>
        )}

        {/* Error */}
        {state.error && (
          <Box marginLeft={2}>
            <Text color="red" bold>{'✗ '}</Text>
            <Text color="red">{state.error}</Text>
          </Box>
        )}
      </Box>

      {/* Input */}
      {!state.isStreaming && (
        <Box paddingX={1} marginTop={1}>
          <Text color="#FF6B35" bold>{'❯ '}</Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            placeholder="Ask anything... (/help for commands)"
          />
        </Box>
      )}

      {/* Status Bar */}
      <StatusBar
        model={providerConfig.model}
        provider={providerConfig.type}
        stats={engineRef.current?.stats ?? {
          turns: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          toolCalls: 0,
          startTime: Date.now(),
          errors: 0,
        }}
        cwd={process.cwd()}
        isStreaming={state.isStreaming}
        cost={state.cost}
      />
    </Box>
  );
}

// ─── Provider Resolution ───

function resolveProviderConfig(opts: CLIOptions, remusConfig?: RemusConfig): ProviderConfig {
  if (opts.provider) {
    return {
      type: opts.provider as any,
      baseUrl: opts.baseUrl ?? remusConfig?.baseUrl,
      apiKey: opts.apiKey ?? remusConfig?.apiKey,
      model: opts.model ?? remusConfig?.model ?? 'default',
    };
  }

  // Check remusConfig for provider settings
  if (remusConfig?.provider) {
    return {
      type: remusConfig.provider as any,
      baseUrl: opts.baseUrl ?? remusConfig.baseUrl,
      apiKey: opts.apiKey ?? remusConfig.apiKey,
      model: opts.model ?? remusConfig.model ?? 'default',
    };
  }

  const auto = autoDetectProvider();
  if (opts.model) auto.model = opts.model;
  if (opts.baseUrl) auto.baseUrl = opts.baseUrl;
  if (opts.apiKey) auto.apiKey = opts.apiKey;
  return auto;
}

// ─── Banner ───

function printBanner(config: ProviderConfig): void {
  const w = process.stdout.columns || 80;
  const maxW = Math.min(w - 2, 68);

  // ── Gradient helpers ──
  const g1 = chalk.hex('#FF6B35');
  const g2 = chalk.hex('#FF8C42');
  const g3 = chalk.hex('#FFA559');
  const g4 = chalk.hex('#FFB875');
  const g5 = chalk.hex('#FFCF9F');
  const dim = chalk.hex('#555555');
  const accent = chalk.hex('#FF8C42');
  const white = chalk.white;

  // ── Sleek thin-line logo ──
  const logo = [
    g1.bold('  ╦═╗ ╔═╗ ╔╦╗ ╦ ╦ ╔═╗'),
    g2.bold('  ╠╦╝ ║╣  ║║║ ║ ║ ╚═╗'),
    g3.bold('  ╩╚═ ╚═╝ ╩ ╩ ╚═╝ ╚═╝'),
  ];

  // ── Box drawing ──
  const topBorder    = dim('  ┌' + '─'.repeat(maxW) + '┐');
  const bottomBorder = dim('  └' + '─'.repeat(maxW) + '┘');
  const midRule      = dim('  ├' + '─'.repeat(maxW) + '┤');
  const pad = (s: string, rawLen: number) => s + ' '.repeat(Math.max(0, maxW - rawLen));

  const boxLine = (left: string, leftRaw: number, right?: string, rightRaw?: number) => {
    if (right && rightRaw !== undefined) {
      const gap = Math.max(1, maxW - leftRaw - rightRaw);
      return dim('  │ ') + left + ' '.repeat(gap) + right + dim(' │');
    }
    return dim('  │ ') + pad(left, leftRaw + 1) + dim(' │');
  };

  // ── CWD shortening ──
  const home = process.env.HOME ?? '';
  const cwd = home && process.cwd().startsWith(home) 
    ? '~' + process.cwd().slice(home.length)
    : process.cwd();

  // ── Render ──
  console.log('');
  for (const line of logo) console.log(line);
  console.log(g5.dim.italic('                  by JfmCapitalGroup'));
  console.log('');
  console.log(topBorder);
  
  // Model row
  console.log(boxLine(
    accent('◈ ') + white.bold('Model  ') + chalk.cyan.bold(config.model) + dim(' via ') + chalk.gray(config.type),
    8 + config.model.length + 5 + config.type.length,
    g4('v2.2'),
    4,
  ));

  // CWD row
  console.log(boxLine(
    accent('◈ ') + white.bold('Dir    ') + chalk.gray(cwd),
    10 + cwd.length,
  ));

  console.log(midRule);

  // Feature indicators
  const features = [
    g1('■'), g2('■'), g3('■'), g4('■'),
  ].join(' ');
  const featureLabel = ' Consensus · Agent · Diff · Git';
  console.log(boxLine(
    features + chalk.gray(featureLabel),
    4 * 2 + featureLabel.length,
  ));

  console.log(bottomBorder);

  console.log('');
  console.log(
    dim('  ') + chalk.gray('Ready. ') +
    chalk.white('/help') + chalk.gray(' for commands · ') +
    chalk.white('Ctrl+C') + chalk.gray(' to exit')
  );
  console.log('');
}

// ─── Main ───

async function main(): Promise<void> {
  const opts = parseArgs();
  const remusConfig = loadConfig(process.cwd());

  // Non-interactive mode
  if (opts.print) {
    await runHeadless(opts.print, opts);
    return;
  }

  // Also handle piped input
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const input = Buffer.concat(chunks).toString('utf-8').trim();
    if (input) {
      await runHeadless(input, opts);
      return;
    }
  }

  // Interactive mode: check provider connectivity
  const providerConfig = resolveProviderConfig(opts, remusConfig);
  const provider = createProvider(providerConfig);

  process.stdout.write(chalk.hex('#555555')('  ◈ ') + chalk.gray('Connecting... '));
  const ok = await provider.ping();
  if (!ok) {
    console.log(chalk.red('✗ failed'));
    console.error('');
    console.error(chalk.red(`Cannot reach ${providerConfig.type} at ${providerConfig.baseUrl ?? 'default URL'}`));
    console.error('');

    if (providerConfig.type === 'ollama') {
      console.error(chalk.yellow('To fix this:'));
      console.error(`  1. Install Ollama: ${chalk.cyan('https://ollama.ai')}`);
      console.error(`  2. Start it: ${chalk.cyan('ollama serve')}`);
      console.error(`  3. Pull a model: ${chalk.cyan(`ollama pull ${providerConfig.model}`)}`);
    } else {
      console.error(chalk.yellow('Check that:'));
      console.error(`  1. The API server is running`);
      console.error(`  2. The URL is correct: ${chalk.cyan(providerConfig.baseUrl ?? 'default')}`);
      console.error(`  3. The API key is valid`);
    }
    console.error('');
    console.error(chalk.gray('Environment variables:'));
    console.error(chalk.gray('  REMUS_PROVIDER, REMUS_MODEL, REMUS_BASE_URL, REMUS_API_KEY'));
    console.error(chalk.gray('  OPENAI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY'));
    process.exit(1);
  }
  console.log(chalk.hex('#4ADE80')('✓ connected'));

  printBanner(providerConfig);

  // Launch Ink app
  const { waitUntilExit } = render(<App opts={opts} />);
  await waitUntilExit();

  console.log(chalk.hex('#555555')('\n  ◈ ') + chalk.gray('Session saved. Goodbye.\n'));
}

main().catch((err) => {
  console.error(chalk.red(`Fatal error: ${err.message}`));
  if (process.env.REMUS_DEBUG) {
    console.error(err.stack);
  }
  process.exit(1);
});
