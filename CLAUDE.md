# CLAUDE.md

This repository is a plugin-oriented ClaudeAssistant workspace. The current truth is a local Discord runtime for development, one session per channel, and supporting directories for agents, skills, hooks, tests, and build output.

## Commands

```bash
npm run dev       # watch index.ts with tsx
npm run build     # compile TypeScript to dist/
npm start         # run the compiled build
npm test          # run the Vitest suite
npm run test:watch
```

## Architecture

Root-level layout:

```text
index.ts
adapters/
commands/
core/
skills/
hooks/
agents/
sessions/
tests/
```

Key responsibilities:

- `index.ts` starts the local Discord runtime.
- `core/orchestrator.ts` manages session lifecycle and recovery.
- `core/session-store.ts` persists session state.
- `core/worker.ts` drives `claude` CLI execution.
- `core/adapter.ts` defines the adapter surface.
- `adapters/discord/` handles Discord-specific transport and formatting.
- `commands/` contains built-in session commands.
- `skills/file-return/` contains the file-return skill and helper scripts.

## Configuration

Use these current files only:

- `settings.json` for defaults, limits, enabled adapters, and logging.
- `config/adapters/discord.json` for Discord adapter settings.
- `.env.example` as the environment template.
- `hooks/hooks.json` for shipped hook configuration.

Session data lives under `sessions/<sessionId>/` and includes `session.json`, `workspace/`, `uploads/`, and session memory files.

## File Delivery Contract

- `sessions/<sessionId>/uploads/` stores user-provided source files and should be treated as read-only input.
- `sessions/<sessionId>/workspace/` is Claude's working area for scratch files, edits, and intermediate artifacts.
- `sessions/<sessionId>/workspace/.deliveries/` is the only valid delivery boundary.
- Hooks and gateway code must only return content that was explicitly published into `workspace/.deliveries/`.

## Built-In Commands

- `/model <name>` switches the model for the current session.
- `/cd <path>` changes the Claude working directory for the current session.
- `/profile <name>` loads an agent definition from `agents/`.
- `/status` prints the current session state.
- `/help` lists the built-in commands.

## Testing

Tests live under `tests/` and mirror the root layout. Run a single file with:

```bash
npx vitest run tests/core/orchestrator.test.ts
```

## Environment

Required runtime prerequisites:

- Node.js 18.18+
- `claude` CLI installed and authenticated
- Discord bot token in `DISCORD_BOT_TOKEN`
