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
  });

  const engineRef = useRef<QueryEngine | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const remusConfigRef = useRef<RemusConfig>(loadConfig(process.cwd()));
  const providerConfigRef = useRef<ProviderConfig>(resolveProviderConfig(opts, remusConfigRef.current));

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
          setState({ messages: [], isStreaming: false, streamingText: '', error: null, cost: '$0.00', contextTokens: 0 });
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
                `  ${chalk.hex('#FF8C42')('/help')}         ${chalk.gray('─ Show this help')}`,
                `  ${chalk.hex('#FF8C42')('/clear')}        ${chalk.gray('─ Clear conversation')}`,
                `  ${chalk.hex('#FF8C42')('/model <name>')} ${chalk.gray('─ Switch model')}`,
                `  ${chalk.hex('#FF8C42')('/compact')}      ${chalk.gray('─ Compress context (save tokens)')}`,
                `  ${chalk.hex('#FF8C42')('/undo')}         ${chalk.gray('─ Undo last file change')}`,
                `  ${chalk.hex('#FF8C42')('/redo')}         ${chalk.gray('─ Redo last undone change')}`,
                `  ${chalk.hex('#FF8C42')('/cost')}         ${chalk.gray('─ Detailed cost breakdown')}`,
                `  ${chalk.hex('#FF8C42')('/sessions')}     ${chalk.gray('─ List saved sessions')}`,
                `  ${chalk.hex('#FF8C42')('/save')}         ${chalk.gray('─ Save current session')}`,
                `  ${chalk.hex('#FF8C42')('/exit')}         ${chalk.gray('─ Save and exit')}`,
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

        default:
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
          <Box key={i} flexDirection="column" marginBottom={0}>
            {msg.role === 'user' ? (
              <Box>
                <Text color="#FF6B35" bold>{'❯ '}</Text>
                <Text color="white" bold>{msg.content}</Text>
              </Box>
            ) : msg.role === 'assistant' ? (
              <Box flexDirection="column" marginLeft={2}>
                <Box marginBottom={0}>
                  <Text color="#FF8C42" bold>{'⬡ Remus '}</Text>
                </Box>
                <Box marginLeft={2}>
                  <Markdown text={msg.content} />
                </Box>
              </Box>
            ) : msg.role === 'tool-call' ? (
              <Box marginLeft={4}>
                <Text>{msg.content}</Text>
              </Box>
            ) : msg.role === 'tool-result' ? (
              <Box marginLeft={4}>
                <Text>{msg.content}</Text>
              </Box>
            ) : msg.role === 'tool-error' ? (
              <Box marginLeft={4}>
                <Text>{msg.content}</Text>
              </Box>
            ) : (
              <Box marginLeft={2}>
                <Text color="gray">{msg.content}</Text>
              </Box>
            )}
          </Box>
        ))}

        {/* Streaming response */}
        {state.isStreaming && state.streamingText && (
          <Box flexDirection="column" marginLeft={2}>
            <Box marginBottom={0}>
              <Text color="#FF8C42" bold>{'⬡ Remus '}</Text>
              <Text color="yellow">●</Text>
            </Box>
            <Box marginLeft={2}>
              <Markdown text={state.streamingText} />
            </Box>
          </Box>
        )}

        {state.isStreaming && !state.streamingText && (
          <Box marginLeft={2}>
            <Text color="yellow">{'⬡ '}</Text>
            <Text color="gray" italic>Thinking...</Text>
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
        <Box paddingX={1} marginTop={0}>
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
  const hr = chalk.dim('─'.repeat(Math.min(w - 2, 72)));

  const logo = [
    chalk.hex('#FF6B35').bold('  ██████╗  ███████╗███╗   ███╗██╗   ██╗███████╗'),
    chalk.hex('#FF6B35').bold('  ██╔══██╗ ██╔════╝████╗ ████║██║   ██║██╔════╝'),
    chalk.hex('#FF8C42').bold('  ██████╔╝ █████╗  ██╔████╔██║██║   ██║███████╗'),
    chalk.hex('#FFA559').bold('  ██╔══██╗ ██╔══╝  ██║╚██╔╝██║██║   ██║╚════██║'),
    chalk.hex('#FFB875').bold('  ██║  ██║ ███████╗██║ ╚═╝ ██║╚██████╔╝███████║'),
    chalk.hex('#FFB875').bold('  ╚═╝  ╚═╝ ╚══════╝╚═╝     ╚═╝ ╚═════╝ ╚══════╝'),
  ];

  console.log('');
  for (const line of logo) console.log(line);
  console.log(chalk.dim.italic('                        by JfmCapitalGroup'));
  console.log('');
  console.log(hr);
  console.log(
    chalk.hex('#FF8C42')('  ⬡ ') + chalk.white.bold('Model  ') + chalk.gray(config.model) + 
    chalk.dim(' via ') + chalk.cyan(config.type)
  );
  console.log(
    chalk.hex('#FF8C42')('  ⬡ ') + chalk.white.bold('CWD    ') + chalk.gray(
      (process.env.HOME && process.cwd().startsWith(process.env.HOME))
        ? '~' + process.cwd().slice(process.env.HOME.length)
        : process.cwd()
    )
  );
  console.log(hr);
  console.log(
    chalk.gray('  Type a message to begin. ') +
    chalk.dim('/help') + chalk.gray(' for commands, ') +
    chalk.dim('Ctrl+C') + chalk.gray(' to exit.')
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

  process.stdout.write(chalk.hex('#FF8C42')('  ⬡ Connecting... '));
  const ok = await provider.ping();
  if (!ok) {
    console.log(chalk.red('failed'));
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
  console.log(chalk.green('connected'));

  printBanner(providerConfig);

  // Launch Ink app
  const { waitUntilExit } = render(<App opts={opts} />);
  await waitUntilExit();

  console.log(chalk.hex('#FF6B35')('\n  ⬡ Session saved. Goodbye!\n'));
}

main().catch((err) => {
  console.error(chalk.red(`Fatal error: ${err.message}`));
  if (process.env.REMUS_DEBUG) {
    console.error(err.stack);
  }
  process.exit(1);
});
