# ClaudeAssistant

ClaudeAssistant is a plugin-oriented repository with local chat runtimes for development. It keeps one session per channel and includes the pieces that still matter today: sessions, agents, skills, hooks, file-return support, tests, and build tooling.

## Prerequisites

- Node.js 18.18 or newer
- `claude` CLI installed and authenticated
- A Discord bot token with message-content intent enabled for Discord
- A Weixin iLink bot token and bot user id if you enable the Weixin adapter

## Setup

```bash
npm install
cp .env.example .env
```

Set `DISCORD_BOT_TOKEN` in `.env`, then adjust `settings.json` and the adapter files under `config/adapters/` if you need different local defaults.

## What Lives Where

- `index.ts` starts the local adapter runtime.
- `core/` contains session orchestration, storage, attachments, recent-file tracking, and worker integration.
- `adapters/discord/` holds the Discord adapter and message formatting.
- `adapters/weixin/` holds the Weixin adapter, QR login flow, and message mapping.
- `commands/` contains the built-in channel commands.
- `agents/` stores reusable agent definitions.
- `skills/file-return/` contains the file-return skill and helper scripts.
- `hooks/hooks.json` is the hook configuration shipped with the repo.
- `sessions/<sessionId>/` stores session JSON, workspace state, uploads, and session memory.

## Built-In Commands

- `/new` starts a fresh session for the current channel.
- `/model <name>` switches the model for the current session.
- `/cd <path>` changes the Claude working directory for the current session.
- `/profile <name>` loads an agent definition from `agents/`.
- `/status` prints the current session state.
- `/help` lists the built-in commands.

## Adapters

- `discord`: configured in `config/adapters/discord.json`
- `weixin`: configured in `config/adapters/weixin.json`

To enable Weixin:

```bash
npm run weixin:login
```

This opens the official Weixin QR login flow, saves the bound account into `data/adapters/weixin-auth.json`, and adds `weixin` to `settings.json`.

## Run

```bash
npm run dev
```

## Test

```bash
npm test
```

## Build

```bash
npm run build
```
