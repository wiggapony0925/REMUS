# Contributing to Remus

Thanks for your interest in contributing to **Remus** by JfmCapitalGroup.

## Getting Started

```bash
git clone https://github.com/wiggapony0925/REMUS.git
cd REMUS
npm install
npm run dev
```

## Development

| Command | Description |
|---------|-------------|
| `npm run dev` | Run in dev mode with tsx |
| `npm run build` | Compile TypeScript to dist/ |
| `npm start` | Run compiled build |

## Project Structure

```
src/
├── main.tsx          — Entry point, CLI, Ink REPL
├── providers/        — LLM backends (OpenAI, Anthropic, Ollama)
├── tools/            — 13 agent tools (bash, file ops, git, etc.)
├── services/         — Query engine, sessions, undo, cost tracking
├── components/       — Ink UI components (Markdown, StatusBar)
└── constants/        — System prompt
```

## Adding a New Tool

1. Create `src/tools/yourTool.ts` extending `BaseTool`
2. Implement `name`, `description`, `inputSchema`, and `call()`
3. Register it in `src/tools/index.ts`

## Adding a New Provider

1. Create `src/providers/yourProvider.ts` implementing `LLMProvider`
2. Register in `src/providers/index.ts`

## Guidelines

- TypeScript strict mode — no `any` unless necessary
- Keep tools self-contained and stateless
- Follow existing patterns and naming conventions
- Test your changes: `npx tsc --noEmit`

## License

MIT — JfmCapitalGroup
