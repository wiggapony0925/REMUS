<div align="center">

```
██████╗  ███████╗███╗   ███╗██╗   ██╗███████╗
██╔══██╗ ██╔════╝████╗ ████║██║   ██║██╔════╝
██████╔╝ █████╗  ██╔████╔██║██║   ██║███████╗
██╔══██╗ ██╔══╝  ██║╚██╔╝██║██║   ██║╚════██║
██║  ██║ ███████╗██║ ╚═╝ ██║╚██████╔╝███████║
╚═╝  ╚═╝ ╚══════╝╚═╝     ╚═╝ ╚═════╝ ╚══════╝
      v 2 . 2   —   A U T O N O M O U S
```

### *by JfmCapitalGroup*

**The most advanced AI coding assistant that lives in your terminal.**

[![License: MIT](https://img.shields.io/badge/License-MIT-FF6B35.svg?style=for-the-badge)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-FF8C42.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-≥18-FFB875.svg?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/Ink_+_React-18-FFA559.svg?style=for-the-badge&logo=react&logoColor=white)](https://github.com/vadimdemedes/ink)
[![Tools](https://img.shields.io/badge/Agent_Tools-19-FF6B35.svg?style=for-the-badge)](https://github.com/wiggapony0925/REMUS)

<br/>

[**Getting Started**](#-getting-started) · [**Features**](#-features) · [**Providers**](#-pluggable-llm-backends) · [**Tools**](#-19-built-in-tools) · [**Intelligence**](#-intelligence-deep-dive) · [**Plugins**](#-plugin-architecture) · [**Config**](#%EF%B8%8F-configuration) · [**Contributing**](CONTRIBUTING.md)

</div>

---

<br/>

## ⚡ What is Remus?

Remus is the **most feature-rich, zero-telemetry AI coding assistant** that runs entirely in your terminal. It connects to **any LLM provider** — OpenAI, Anthropic, Ollama (free & local), OpenRouter, LM Studio, or any OpenAI-compatible API — and is **future-proofed** for the upcoming **Remus model** by JfmCapitalGroup.

It doesn't just autocomplete code. It **thinks**, **remembers**, **learns**, **plans**, and **self-heals**. Remus v2.2 features an intelligent model router, response caching, persistent cross-session memory, a full plugin architecture, think-before-act planning, auto-fix pipelines, task queuing, real-time performance metrics, a **Model Enhancement Layer**, and now **6 features no competitor has**: multi-model consensus, autonomous agent mode, diff preview, live file watching, natural language git, and one-command test generation — with **19 agent tools** and **26+ slash commands**.

> **No vendor lock-in. No tracking. No subscriptions. Complete ownership. Bring your own API key and watch it become 10x more effective.**

<br/>

## 🚀 Getting Started

```bash
# Clone
git clone https://github.com/wiggapony0925/REMUS.git
cd REMUS

# Install
npm install

# Run (pick your provider)
```

### With OpenAI
```bash
OPENAI_API_KEY=sk-... npx tsx src/main.tsx
```

### With Ollama (free, local, private)
```bash
ollama pull qwen2.5-coder:14b && ollama serve
npx tsx src/main.tsx
```

### With Anthropic
```bash
ANTHROPIC_API_KEY=sk-ant-... npx tsx src/main.tsx
```

### With OpenRouter (hundreds of models)
```bash
OPENROUTER_API_KEY=sk-or-... REMUS_MODEL=anthropic/claude-sonnet-4 npx tsx src/main.tsx
```

### Non-Interactive Mode
```bash
# Single prompt
npx tsx src/main.tsx -p "explain this codebase"

# Pipe input
echo "fix the bug in main.ts" | npx tsx src/main.tsx

# Specific model
npx tsx src/main.tsx -p "write tests" --model gpt-4o --provider openai
```

<br/>

## ✨ Features

### Core Agent

| Feature | Description |
|---------|-------------|
| 🔧 **19 Agent Tools** | Bash, file ops, grep, glob, git, web fetch, project index, search-replace, symbol rename, tree, health check, notify |
| 🔌 **Any LLM Backend** | Ollama, OpenAI, Anthropic, OpenRouter, LM Studio, custom APIs — plus future Remus model support |
| 🎨 **Beautiful TUI** | Ink + React terminal UI with markdown rendering, syntax highlighting, and streaming |
| ↩️ **Undo / Redo** | Automatic file backups before every edit — instant rollback |
| 💰 **Cost Tracking** | Real-time per-model pricing in the status bar |
| 🔄 **Smart Retry** | Exponential backoff with jitter for API rate limits |

### v2 Intelligence Systems

| Feature | Description |
|---------|-------------|
| 🧠 **Persistent Memory** | Remembers facts, preferences, patterns, and corrections across sessions. Auto-learns from conversations. |
| 🗺️ **Smart Model Router** | Auto-routes queries to fast models (simple tasks) or smart models (complex tasks) for optimal speed & cost |
| ⚡ **Response Cache** | Exact + fuzzy matching cache with LRU eviction. Instant responses for repeated queries. Tracks tokens & cost saved. |
| 🤔 **Think Mode** | Plan-before-execute: decomposes tasks into steps, identifies risks, estimates complexity before running |
| 📋 **Task Queue** | Queue up multiple tasks and execute them in batch — hands-free coding |
| 🩺 **Auto-Fix Pipeline** | One command to detect and fix all errors in your project (typecheck, lint, tests) |
| 📊 **Performance Metrics** | Real-time latency, throughput, p50/p95/p99 percentiles, speed ratings |
| 🧩 **Plugin Architecture** | Extend Remus with custom tools, providers, commands, and hooks via `~/.remus/plugins/` |
| 🧠 **Context Compaction** | LLM-powered conversation summarization to stay within token limits |
| 💾 **Session Persistence** | Save, resume, and list past sessions |
| 📋 **Project Memory** | Drop a `REMUS.md` in your repo for auto-loaded instructions |
| ⚙️ **Config Cascade** | `.remusrc` (project) → `~/.remusrc` (global) → env vars → CLI args |

<br/>

## 🔌 Pluggable LLM Backends

| Provider | Setup | Default Model |
|----------|-------|---------------|
| **Ollama** | Just works (localhost) | `qwen2.5-coder:14b` |
| **OpenAI** | `OPENAI_API_KEY` | `gpt-4o` (smart) / `gpt-4o-mini` (fast) |
| **Anthropic** | `ANTHROPIC_API_KEY` | `claude-sonnet-4` |
| **OpenRouter** | `OPENROUTER_API_KEY` | `anthropic/claude-sonnet-4` |
| **LM Studio** | `REMUS_PROVIDER=lmstudio` | Your loaded model |
| **Remus** ⬡ | `REMUS_MODEL_KEY` | Coming soon — `remus-1`, `remus-1-ultra`, `remus-1-code` |
| **Custom** | `REMUS_PROVIDER=custom REMUS_BASE_URL=...` | Any OpenAI-compatible API |

> **Smart Model Router**: When using OpenAI, Remus automatically routes simple queries to `gpt-4o-mini` (fast, cheap) and complex queries to `gpt-4o` (powerful). Configure with `fastModel` and `smartModel` in `.remusrc`.

<br/>

## 🛠 19 Built-in Tools

### Core File Operations
| Tool | What it does |
|------|-------------|
| `bash` | Execute shell commands with output capture |
| `read_file` | Read files with line ranges |
| `edit_file` | Precise search-and-replace editing |
| `write_file` | Create or overwrite files |
| `grep` | Fast content search (ripgrep) |
| `glob` | File pattern matching and discovery |
| `list_dir` | Explore directory structure |
| `web_fetch` | Pull content from URLs |

### Git Operations
| Tool | What it does |
|------|-------------|
| `git_diff` | View uncommitted changes |
| `git_status` | Check repo status |
| `git_commit` | Stage and commit changes |
| `git_log` | View commit history |

### Codebase Intelligence
| Tool | What it does |
|------|-------------|
| `project_index` | Full codebase overview with tree and stats |
| `search_replace` | Multi-file search & replace with regex and dry-run |
| `rename_symbol` | Word-boundary-aware symbol rename across codebase |

### Utility
| Tool | What it does |
|------|-------------|
| `notify` | Styled progress notifications |
| `tree` | Visual directory tree with file sizes |
| `check_health` | Run typecheck, lint, test, and dependency audit |

<br/>

## 💬 Interactive Commands

### Chat
```
/help          — Show all commands with categories
/clear         — Clear conversation & reset memory context
/model <name>  — Switch model on the fly
/exit          — Save session and exit
```

### Intelligence
```
/think <task>  — Plan before executing (decompose into steps, identify risks)
/autofix       — Auto-detect and fix all project errors
/memory        — View stored memories and stats
/remember <x>  — Teach Remus a fact to remember across sessions
/compact       — Compress context (save tokens)
```

### Task Management
```
/task add <x>  — Queue a task for later execution
/task list     — View all tasks and progress
/task run      — Execute all pending tasks in batch
/task clear    — Clear the task queue
```

### History & Undo
```
/undo          — Undo last file change
/redo          — Redo last undone change
/sessions      — List saved sessions
/save          — Save current session
```

### Metrics
```
/speed         — Real-time performance metrics (latency, throughput, percentiles)
/cache         — Cache statistics (hit rate, tokens saved, cost savings)
/cost          — Detailed cost breakdown by model
```

### System
```
/plugins       — List loaded plugins
/health        — Run full project health check
```

<br/>

## 🧩 Plugin Architecture

Extend Remus with plugins — add custom tools, providers, slash commands, and hook into the query lifecycle.

### Creating a Plugin

Create a file in `~/.remus/plugins/` or `.remus/plugins/`:

```typescript
// ~/.remus/plugins/my-plugin.ts
export default {
  name: 'my-plugin',
  version: '1.0.0',
  description: 'My custom Remus plugin',

  // Add custom tools
  tools: [{
    name: 'my_tool',
    description: 'Does something cool',
    parameters: { type: 'object', properties: {} },
    execute: async (params) => ({ result: 'done!' }),
  }],

  // Add slash commands
  commands: {
    'my-cmd': async (args, engine) => 'Command output',
  },

  // Hook into queries
  beforeQuery: async (query) => {
    return query; // transform queries
  },

  afterResponse: async (response) => {
    return response; // transform responses
  },

  // Inject into system prompt
  systemPromptAddition: 'Additional context for the AI.',
};
```

<br/>

## 🧠 Intelligence Deep Dive

### Smart Model Router
Analyzes query complexity using pattern matching:
- **Fast model** for: simple questions, explanations, formatting, quick edits
- **Smart model** for: multi-file refactors, architecture design, debugging, security reviews
- Maintains routing statistics accessible via API

### Persistent Memory
Stores five types of memories across sessions:
- **Facts** — taught by user or auto-extracted
- **Preferences** — preferred coding style, patterns
- **Patterns** — learned recurring behaviors
- **Context** — project-specific context
- **Corrections** — learned from mistakes

Memories use relevance scoring (token overlap + temporal decay) and auto-prune at 1000 entries.

### Response Cache
- **Exact matching** for identical queries
- **Fuzzy matching** (Jaccard similarity, 0.85 threshold) for similar queries
- LRU eviction, TTL-based expiry, max 500 entries
- Auto-invalidates after file changes
- Tracks tokens saved and cost savings

### Think Mode
Before executing complex tasks:
1. Analyzes the task description
2. Breaks it into numbered steps
3. Identifies potential risks
4. Estimates complexity and tool calls
5. Returns a plan for review before execution

### Model Enhancement Layer (v2.1)
The core differentiator — a 4-stage middleware pipeline that makes **any** external model drastically more effective:

**1. Context Engine** (`contextEngine.ts`)
- Auto-indexes the project: detects language, framework, package manager, test runner, build tool
- Extracts query signals (error-related? refactor? new feature? test?) and pulls relevant files
- Injects git diff context, TypeScript error context, dependency info
- Budget-aware: fits within token limits (12K default, 8 files max)
- File relevance scoring: keyword match in path (0.4) + filename (0.6) + config/test boosts

**2. Adaptive Prompting** (`adaptivePrompting.ts`)
- Model profiles for 15+ models: GPT-4o, GPT-4o-mini, GPT-4 Turbo, o1, o3-mini, Claude Sonnet/Opus/Haiku, Qwen, Llama, DeepSeek, Mistral, Gemini Pro/Flash
- Task classification: code-gen, debug, refactor, explain, test, review, architecture, devops
- Complexity estimation: simple / moderate / complex
- Per-model optimizations: prompt style (structured/conversational/minimal/chain-of-thought), parallel tools, context window management
- Weakness compensation: hallucination guard, verbose guard, JSON fencing, tool calling shims, refusal bypass
- Optimal temperature & max tokens calculated per model + task type

**3. Quality Pipeline** (`qualityPipeline.ts`)
- Post-response validation: empty check, truncation detection, refusal detection
- Code block analysis: bracket matching, unterminated strings, mixed indentation (Python), balanced fences
- Tool call validation: missing paths, no-op edits, dangerous bash commands, TODO placeholders
- Output sanitization: leaked system prompts, API key detection
- Consistency checks: references to files not in session
- Returns quality score (0-100) with auto-fixable flag

**4. Self-Correction Loop**
- When quality check fails + is auto-fixable, the model is asked to fix its own output
- Correction prompt includes specific fix instructions from the pipeline
- Max correction depth prevents infinite loops
- Result: models catch their own mistakes without user intervention

> **Example:** A tiny Ollama model running locally gets the same smart context injection, project-aware prompting, and self-correction as GPT-4o. Remus makes every model punch above its weight.

### Multi-Model Consensus (v2.2)
Query 2+ models simultaneously and get a merged, best-of-all answer:
- Sends the same prompt to multiple providers in parallel
- Three strategies: `best` (judge picks winner), `merge` (synthesize best parts), `vote` (longest/most complete)
- Uses a judge model to evaluate and merge responses
- Shows per-model response times, token counts, and a final consensus
- `/consensus <question>` in the REPL

### Autonomous Agent Mode (v2.2)
Give Remus a goal and walk away:
- `/agent add authentication to this app`
- Plans using Think Mode (step breakdown, risk analysis)
- Executes steps sequentially, feeding context forward
- Reports progress in real-time (step-start, step-complete, step-failed)
- Configurable: max steps, stop-on-error, verbose mode
- Generates a final report with completion stats

### Diff Preview Mode (v2.2)
See every change before it happens:
- `/diff` toggles diff preview mode
- Generates beautiful red/green inline terminal diffs
- Line-level LCS-based diffing with context windows
- Shows hunk headers, additions, deletions, stats
- Works for edits, new files, and deletions

### Live File Watcher (v2.2)
Remus watches your files and reacts instantly:
- `/watch` starts monitoring; `/watch stop` to stop
- Auto-detects TypeScript errors, Python syntax errors, JSON parse errors
- Detects merge conflict markers, extremely long lines
- Shows alerts with file, line, column, and fix suggestions
- Debounced to avoid alert storms

### Natural Language Git (v2.2)
Forget git commands. Just speak English:
- `/git show me what changed yesterday`
- `/git commit everything with message "feat: add auth"`
- `/git create branch called feature/login`
- `/git undo last 2 commits`
- `/git who wrote src/main.tsx`
- Supports: status, log, diff, commit, push, pull, branch CRUD, merge, stash, reset, blame
- Safety: destructive operations use safe defaults (--soft reset)

### Test Generation (v2.2)
One command to generate a full test suite:
- `/test src/utils/parser.ts`
- Auto-detects framework: Jest, Vitest, Mocha, Pytest, Go test, Cargo test
- Analyzes exports, functions, classes
- Generates comprehensive tests with edge cases, error cases, mocks
- Respects project conventions and naming patterns
- Writes test file to disk immediately

<br/>

## ⚙️ Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `REMUS_PROVIDER` | `ollama` · `openai` · `anthropic` · `openrouter` · `lmstudio` · `remus` · `custom` |
| `REMUS_MODEL` | Model name or ID |
| `REMUS_BASE_URL` | Custom API endpoint |
| `REMUS_API_KEY` | API key for custom providers |
| `REMUS_MODEL_KEY` | API key for future Remus model |
| `REMUS_MODEL_URL` | Endpoint for Remus model |
| `OPENAI_API_KEY` | Auto-selects OpenAI |
| `ANTHROPIC_API_KEY` | Auto-selects Anthropic |
| `OPENROUTER_API_KEY` | Auto-selects OpenRouter |
| `REMUS_DEBUG` | Show stack traces |

### Config Files

Create `.remusrc` in your project or `~/.remusrc` globally:

```json
{
  "provider": "openai",
  "model": "gpt-4o",
  "fastModel": "gpt-4o-mini",
  "smartModel": "gpt-4o",
  "temperature": 0.7,
  "showCost": true,
  "enableUndo": true,
  "enableCache": true,
  "enableMemory": true,
  "enablePerformanceTracking": true,
  "maxTurns": 50,
  "customInstructions": "Prefer functional patterns."
}
```

### Project Memory

Create `REMUS.md` in your project root:

```markdown
# Project Instructions
- TypeScript + ESM modules
- Run tests with: npm test
- Follow existing code style
```

<br/>

## 🏗 Architecture

```
src/
├── main.tsx                → Entry point · CLI args · Ink REPL · 20+ slash commands
├── providers/
│   ├── types.ts            → LLMProvider interface
│   ├── openai.ts           → OpenAI-compatible (streaming SSE)
│   ├── anthropic.ts        → Anthropic Messages API
│   ├── ollama.ts           → Ollama native API
│   ├── remus.ts            → Future Remus model (JfmCapitalGroup)
│   └── index.ts            → Auto-detection, factory, model router config
├── tools/
│   ├── types.ts            → BaseTool interface
│   ├── bash.ts             → Shell execution
│   ├── readFile.ts         → File reading
│   ├── editFile.ts         → Search & replace editing
│   ├── writeFile.ts        → File creation
│   ├── grep.ts             → Content search
│   ├── glob.ts             → Pattern matching
│   ├── webFetch.ts         → URL fetching
│   ├── listDir.ts          → Directory listing
│   ├── gitDiff.ts          → Git diff
│   ├── gitStatus.ts        → Git status
│   ├── gitCommit.ts        → Git commit
│   ├── gitLog.ts           → Git log
│   ├── projectIndex.ts     → Codebase indexer
│   ├── searchReplace.ts    → Multi-file search & replace
│   ├── renameSymbol.ts     → Symbol rename across codebase
│   ├── advanced.ts         → Notify, Tree, CheckHealth tools
│   └── index.ts            → Tool registry (19 tools)
├── services/
│   ├── queryEngine.ts      → Core agent loop (v4: cache, memory, perf, enhancement)
│   ├── modelEnhancer.ts    → ★ Model enhancement middleware orchestrator
│   ├── contextEngine.ts    → ★ Smart context injection (project profiling, file ranking)
│   ├── adaptivePrompting.ts → ★ Per-model optimization (15+ model profiles)
│   ├── qualityPipeline.ts  → ★ Response validation + self-correction loop
│   ├── multiModelConsensus.ts → ★ Query 2+ models & merge outputs
│   ├── autonomousAgent.ts  → ★ Full autopilot agent (plan → execute → report)
│   ├── diffPreview.ts      → ★ Inline red/green terminal diffs
│   ├── fileWatcher.ts      → ★ Live file monitoring + error detection
│   ├── naturalLanguageGit.ts → ★ Git via plain English
│   ├── testGenerator.ts    → ★ One-command test suite generation
│   ├── modelRouter.ts      → Smart fast/smart model routing
│   ├── responseCache.ts    → Exact + fuzzy response cache
│   ├── memory.ts           → Persistent cross-session memory
│   ├── performanceTracker.ts → Latency, throughput, speed metrics
│   ├── thinkMode.ts        → Think-before-act + task queue
│   ├── pluginManager.ts    → Extensible plugin architecture
│   ├── sessions.ts         → Session persistence
│   ├── undo.ts             → Undo/redo system
│   ├── costTracker.ts      → Real-time cost tracking
│   ├── retryHandler.ts     → Smart retry with backoff
│   ├── contextCompactor.ts → Token-aware summarization
│   └── config.ts           → Cascading config system
├── components/
│   ├── Markdown.tsx        → Terminal markdown renderer
│   └── StatusBar.tsx       → Session info bar
└── constants/
    └── prompts.ts          → System prompt builder
```

<br/>

## 🆚 Why Remus?

| | Claude Code | Cursor | GitHub Copilot | **Remus v2** |
|---|---|---|---|---|
| **Provider** | Anthropic only | OpenAI only | OpenAI only | **Any LLM** |
| **Telemetry** | Yes | Yes | Yes | **None** |
| **Cost** | Subscription | Subscription | Subscription | **Free with Ollama** |
| **Runtime** | Cloud | Cloud | Cloud | **Your machine** |
| **Ownership** | Vendor | Vendor | Vendor | **You** |
| **Open Source** | No | No | No | **MIT** |
| **Terminal Native** | Yes | No | No | **Yes** |
| **Undo System** | No | No | No | **Yes** |
| **Think Mode** | No | No | No | **Yes** |
| **Memory** | No | No | No | **Cross-session** |
| **Response Cache** | No | No | No | **Fuzzy + exact** |
| **Task Queue** | No | No | No | **Batch execution** |
| **Plugin System** | No | Extensions | Extensions | **Full hooks API** |
| **Auto-Fix** | No | No | No | **One command** |
| **Model Router** | No | No | No | **Smart routing** |
| **Perf Metrics** | No | No | No | **Real-time** |
| **Context Engine** | No | No | No | **Auto-inject relevant files** |
| **Adaptive Prompts** | No | No | No | **Per-model optimization** |
| **Self-Correction** | No | No | No | **Auto quality pipeline** |
| **Multi-Model** | No | No | No | **Consensus from 2+ models** |
| **Autonomous Agent** | No | No | No | **Full autopilot mode** |
| **Diff Preview** | No | No | No | **Red/green inline diffs** |
| **File Watcher** | No | No | No | **Auto-detect on save** |
| **NL Git** | No | No | No | **Git via plain English** |
| **Test Gen** | No | No | No | **One-command test suites** |
| **Agent Tools** | Limited | Limited | Limited | **19 tools** |

<br/>

## 📈 Performance

Remus v2 is designed for speed:

- **Response Cache** eliminates redundant API calls (typical hit rates: 15-30%)
- **Smart Router** sends simple queries to fast models (3-5x cheaper, 2x faster)
- **Streaming** for instant visual feedback
- **Context Compaction** keeps conversations lean and fast
- **Performance Dashboard** shows real-time latency percentiles
- **Model Enhancement** — smart context injection means models get exactly the right files, reducing hallucination and wasted tokens
- **Adaptive Temperature** — auto-tuned per model + task type for optimal output quality
- **Self-Correction** — quality pipeline catches model mistakes and auto-corrects before the user sees them

<br/>

## 🗺️ Roadmap

- [ ] **Remus Model** — JfmCapitalGroup's own LLM (remus-1-flash, remus-1, remus-1-ultra, remus-1-code)
- [ ] **Multi-agent orchestration** — Parallel sub-agents for complex refactors
- [ ] **Visual diff viewer** — Inline terminal diffs with syntax highlighting
- [ ] **Voice mode** — Hands-free coding via speech-to-text
- [ ] **Remote filesystem** — SSH into remote servers for editing
- [ ] **Team sharing** — Share sessions, memories, and plugins across teams
- [ ] **IDE extensions** — VS Code, JetBrains, Neovim integrations

<br/>

---

<div align="center">

**Built with ❤️ by [JfmCapitalGroup](https://github.com/wiggapony0925)**

**37 source files · 19 agent tools · 18 intelligent services · 26+ slash commands · 15+ model profiles · Infinite potential**

MIT License · [Report Bug](https://github.com/wiggapony0925/REMUS/issues) · [Request Feature](https://github.com/wiggapony0925/REMUS/issues)

</div>
