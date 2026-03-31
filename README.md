# ClaudeAssistant Agent Gateway

This service connects Discord channels to Claude Code CLI while keeping one session per channel.

## Prerequisites

- Node.js 18.18 or newer
- `claude` CLI installed and authenticated
- A Discord bot token with message-content intent enabled

## Setup

```bash
npm install
cp .env.example .env
```

Update `config/gateway.json` and `config/adapters/discord.json` if you need different defaults.

## Commands

- `/model <name>` switches the model for the current channel session.
- `/cd <path>` changes the Claude working directory for the current channel session.
- `/profile <name>` loads a JSON profile from `profiles/`.
- `/status` prints the current session state.
- `/help` lists the built-in commands.

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

## Control Layer

The gateway now keeps a second state path for subagent display and operator control.

- Normal chat messages still route into Claude sessions.
- Control requests are stored under `data/control/`.
- Discord threads can display subagent progress and pending approval prompts.
- Claude-side hooks/skills can use:
  - `npm run control:upsert-run -- --base-dir data/control ...`
  - `npm run control:request -- --base-dir data/control ...`
  - `npm run control:poll -- --base-dir data/control ...`
- Control semantics are channel-agnostic: adapters normalize reactions, replies, buttons, or commands into the same control signal names.
- Discord is the first implementation, but other adapters can emit the same `approve`, `reject`, `hold`, `adjust`, and `resume` meanings.