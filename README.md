<div align="center">

```
██████╗  ███████╗███╗   ███╗██╗   ██╗███████╗
██╔══██╗ ██╔════╝████╗ ████║██║   ██║██╔════╝
██████╔╝ █████╗  ██╔████╔██║██║   ██║███████╗
██╔══██╗ ██╔══╝  ██║╚██╔╝██║██║   ██║╚════██║
██║  ██║ ███████╗██║ ╚═╝ ██║╚██████╔╝███████║
╚═╝  ╚═╝ ╚══════╝╚═╝     ╚═╝ ╚═════╝ ╚══════╝
```

### *by JfmCapitalGroup*

**An elite AI coding assistant that lives in your terminal.**

[![License: MIT](https://img.shields.io/badge/License-MIT-FF6B35.svg?style=for-the-badge)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-FF8C42.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-≥18-FFB875.svg?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/Ink_+_React-18-FFA559.svg?style=for-the-badge&logo=react&logoColor=white)](https://github.com/vadimdemedes/ink)

<br/>

[**Getting Started**](#-getting-started) · [**Features**](#-features) · [**Providers**](#-pluggable-llm-backends) · [**Tools**](#-13-built-in-tools) · [**Config**](#%EF%B8%8F-configuration) · [**Contributing**](CONTRIBUTING.md)

</div>

---

<br/>

## ⚡ What is Remus?

Remus is a **fully self-owned, zero-telemetry AI coding assistant** that runs entirely in your terminal. It connects to **any LLM provider** — OpenAI, Anthropic, Ollama (free & local), OpenRouter, LM Studio, or any OpenAI-compatible API.

Think of it as your own private coding agent: it reads your files, writes code, runs commands, searches your codebase, manages git, tracks costs, and undoes mistakes — all from a beautiful terminal UI.

> **No vendor lock-in. No tracking. Complete ownership. Your code stays yours.**

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

| Feature | Description |
|---------|-------------|
| 🔧 **13 Agent Tools** | Bash, file read/write/edit, grep, glob, git ops, web fetch, project indexer |
| 🔌 **Any LLM Backend** | Ollama, OpenAI, Anthropic, OpenRouter, LM Studio, custom APIs |
| 🎨 **Beautiful TUI** | Ink + React terminal UI with markdown rendering and streaming |
| ↩️ **Undo / Redo** | Automatic file backups before every edit — instant rollback |
| 💰 **Cost Tracking** | Real-time per-model pricing in the status bar |
| 🧠 **Context Compaction** | LLM-powered conversation summarization to stay within token limits |
| 💾 **Session Persistence** | Save, resume, and list past sessions |
| 📋 **Project Memory** | Drop a `REMUS.md` in your repo for auto-loaded instructions |
| ⚙️ **Config Cascade** | `.remusrc` (project) → `~/.remusrc` (global) → env vars → CLI args |
| 🔄 **Smart Retry** | Exponential backoff with jitter for API rate limits |

<br/>

## 🔌 Pluggable LLM Backends

| Provider | Setup | Default Model |
|----------|-------|---------------|
| **Ollama** | Just works (localhost) | `qwen2.5-coder:14b` |
| **OpenAI** | `OPENAI_API_KEY` | `gpt-4o` |
| **Anthropic** | `ANTHROPIC_API_KEY` | `claude-sonnet-4` |
| **OpenRouter** | `OPENROUTER_API_KEY` | `anthropic/claude-sonnet-4` |
| **LM Studio** | `REMUS_PROVIDER=lmstudio` | Your loaded model |
| **Custom** | `REMUS_PROVIDER=custom REMUS_BASE_URL=...` | Any OpenAI-compatible API |

<br/>

## 🛠 13 Built-in Tools

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
| `git_diff` | View uncommitted changes |
| `git_status` | Check repo status |
| `git_commit` | Stage and commit changes |
| `git_log` | View commit history |
| `project_index` | Full codebase overview |

<br/>

## 💬 Interactive Commands

```
/help         — Show all commands
/clear        — Clear conversation
/model <name> — Switch model on the fly
/compact      — Compress context (save tokens)
/undo         — Undo last file change
/redo         — Redo last undone change
/cost         — Detailed cost breakdown
/sessions     — List saved sessions
/save         — Save current session
/exit         — Save and exit
```

<br/>

## ⚙️ Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `REMUS_PROVIDER` | `ollama` · `openai` · `anthropic` · `openrouter` · `lmstudio` · `custom` |
| `REMUS_MODEL` | Model name or ID |
| `REMUS_BASE_URL` | Custom API endpoint |
| `REMUS_API_KEY` | API key for custom providers |
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
  "temperature": 0.7,
  "showCost": true,
  "enableUndo": true,
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
├── main.tsx              → Entry point · CLI args · Ink REPL
├── providers/
│   ├── types.ts          → LLMProvider interface
│   ├── openai.ts         → OpenAI-compatible (streaming SSE)
│   ├── anthropic.ts      → Anthropic Messages API
│   ├── ollama.ts         → Ollama native API
│   └── index.ts          → Auto-detection & factory
├── tools/
│   ├── types.ts          → BaseTool interface
│   ├── bash.ts           → Shell execution
│   ├── readFile.ts       → File reading
│   ├── editFile.ts       → Search & replace
│   ├── writeFile.ts      → File creation
│   ├── grep.ts           → Content search
│   ├── glob.ts           → Pattern matching
│   ├── webFetch.ts       → URL fetching
│   ├── listDir.ts        → Directory listing
│   ├── gitDiff.ts        → Git diff
│   ├── gitStatus.ts      → Git status
│   ├── gitCommit.ts      → Git commit
│   ├── gitLog.ts         → Git log
│   ├── projectIndex.ts   → Codebase indexer
│   └── index.ts          → Tool registry (13 tools)
├── services/
│   ├── queryEngine.ts    → Core agent loop
│   ├── sessions.ts       → Session persistence
│   ├── undo.ts           → Undo/redo system
│   ├── costTracker.ts    → Real-time cost tracking
│   ├── retryHandler.ts   → Smart retry with backoff
│   ├── contextCompactor.ts → Token-aware summarization
│   └── config.ts         → Cascading config system
├── components/
│   ├── Markdown.tsx      → Terminal markdown renderer
│   └── StatusBar.tsx     → Session info bar
└── constants/
    └── prompts.ts        → System prompt builder
```

<br/>

## 🆚 Why Remus?

| | Claude Code | Cursor | Remus |
|---|---|---|---|
| **Provider** | Anthropic only | OpenAI only | Any LLM |
| **Telemetry** | Yes | Yes | **None** |
| **Cost** | Subscription | Subscription | **Free with Ollama** |
| **Runtime** | Cloud | Cloud | **Your machine** |
| **Ownership** | Vendor | Vendor | **You** |
| **Open Source** | No | No | **MIT** |
| **Terminal Native** | Yes | No | **Yes** |
| **Undo System** | No | No | **Yes** |

<br/>

---

<div align="center">

**Built with ❤️ by [JfmCapitalGroup](https://github.com/wiggapony0925)**

MIT License · [Report Bug](https://github.com/wiggapony0925/REMUS/issues) · [Request Feature](https://github.com/wiggapony0925/REMUS/issues)

</div>
