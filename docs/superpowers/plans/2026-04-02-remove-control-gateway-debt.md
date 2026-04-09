# Remove Control Gateway Debt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the abandoned control-signal gateway design and its related code paths, keep only code that still serves the plugin-oriented direction, and leave the repository in a passing, lower-debt state.

**Architecture:** Treat the control-signal gateway work as abandoned scope. Delete the runtime modules, scripts, tests, docs, and configuration that only exist for that path. Preserve the code that still supports sessions, file return, attachments, and agent/profile definitions. Repair the remaining session behavior after the deletion so the surviving runtime remains internally consistent.

**Tech Stack:** TypeScript, Node.js, Vitest, tsx

---

## File Map

- Delete: `core/control-store.ts`
- Delete: `core/control-router.ts`
- Delete: `core/control-sync.ts`
- Delete: `scripts/control/upsert-run.ts`
- Delete: `scripts/control/request-control.ts`
- Delete: `scripts/control/poll-resolved-request.ts`
- Delete: `tests/core/control-store.test.ts`
- Delete: `tests/core/control-router.test.ts`
- Delete: `tests/core/control-sync.test.ts`
- Delete: `docs/superpowers/plans/2026-03-31-control-signal-gateway.md`
- Delete: `docs/superpowers/specs/2026-03-31-control-signal-gateway-design.md`
- Modify: `index.ts`
- Modify: `core/types.ts`
- Modify: `core/adapter.ts`
- Modify: `adapters/discord/index.ts`
- Modify: `tests/adapters/discord/index.test.ts`
- Modify: `tests/core/gateway.test.ts`
- Modify: `config/gateway-config.ts`
- Modify: `settings.json`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `core/session-store.ts`
- Modify: `core/orchestrator.ts`
- Modify: `tests/core/orchestrator.test.ts`

## Retention Rules

- Keep code that supports current plugin-relevant behavior: sessions, recent files, file-return hooks, attachments, worker execution, agents, hooks, and skills.
- Remove code whose only purpose is control-state persistence, control projection, control inputs, or operator approval loops.
- If a type or method only exists to support removed control modules, delete it instead of leaving dead compatibility shims.

### Task 1: Write failing tests for the surviving session behavior

**Files:**
- Modify: `tests/core/orchestrator.test.ts`
- Modify: `tests/core/gateway.test.ts`
- Modify: `tests/adapters/discord/index.test.ts`

- [ ] **Step 1: Write the failing session replacement assertion**

```ts
it('returns the replacement session for the channel after a corrupt session reset', async () => {
  const first = orchestrator.getOrCreateSession('channel-1', 'discord');
  store.save({
    ...first,
    messageCount: 1
  });

  vi.mocked(executor.execute)
    .mockRejectedValueOnce(new Error('Unexpected token \'\', "\\u0001Bud1"... is not valid JSON'))
    .mockResolvedValueOnce({ content: 'recovered response' });

  await orchestrator.execute(first.id, {
    id: 'msg-2',
    channelId: 'channel-1',
    channelType: 'discord',
    userId: 'user-1',
    content: 'hello again',
    timestamp: clock()
  });

  const replacement = orchestrator.getSessionByChannel('channel-1', 'discord');

  expect(replacement).not.toBeNull();
  expect(replacement?.status).toBe('active');
  expect(replacement?.id).toBe(vi.mocked(executor.execute).mock.calls[1][0].id);
});
```

- [ ] **Step 2: Run the focused session test and verify the current failure**

Run: `npx vitest run tests/core/orchestrator.test.ts`

Expected: FAIL in the corrupt-session recovery case because the channel lookup can still resolve to the archived session.

- [ ] **Step 3: Freeze non-control gateway coverage before deletion**

```ts
it('routes ordinary gateway traffic without requiring control dependencies', async () => {
  const adapter = createAdapterDouble();
  const gateway = createGateway({ adapters: [adapter] });

  await gateway.start();

  expect(adapter.onMessage).toHaveBeenCalledTimes(1);
  expect(adapter.onControlInput).toBeUndefined();
});
```

```ts
it('initializes discord adapter without control-only callbacks', async () => {
  const adapter = new DiscordAdapter(mockClient as never, mockLogger as never);

  expect(typeof adapter.onMessage).toBe('function');
  expect('onControlInput' in adapter).toBe(false);
});
```

- [ ] **Step 4: Run those focused tests to verify they fail once the assertions are added**

Run: `npx vitest run tests/core/gateway.test.ts tests/adapters/discord/index.test.ts`

Expected: FAIL until the tests and runtime contracts are updated to remove control-specific expectations.

### Task 2: Remove runtime control modules and all references to them

**Files:**
- Delete: `core/control-store.ts`
- Delete: `core/control-router.ts`
- Delete: `core/control-sync.ts`
- Modify: `index.ts`
- Modify: `core/types.ts`
- Modify: `core/adapter.ts`
- Modify: `adapters/discord/index.ts`

- [ ] **Step 1: Delete the abandoned control runtime files**

```bash
rm core/control-store.ts
rm core/control-router.ts
rm core/control-sync.ts
```

- [ ] **Step 2: Remove control bootstrapping from the application entrypoint**

`index.ts`

```ts
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DiscordAdapter } from './adapters';
import { CommandHandler } from './commands';
import { buildBuiltInCommands } from './commands/help';
import { loadGatewayConfig } from './config/gateway-config';
import { AgentGateway } from './core/gateway';
import { SessionOrchestrator } from './core/orchestrator';
import { ProfileManager } from './core/profile-manager';
import { SessionStore } from './core/session-store';
import { ClaudeCodeWorker } from './core/worker';
import { createLogger } from './utils/logger';

async function main(): Promise<void> {
  const config = loadGatewayConfig('settings.json');
  const logger = createLogger(config.logging.level);
  const discordFile = JSON.parse(readFileSync(join('config', 'adapters', 'discord.json'), 'utf8'));
  const discordConfig = {
    ...discordFile,
    token: process.env.DISCORD_BOT_TOKEN ?? discordFile.token
  };
  const adapter = new DiscordAdapter(undefined, logger);

  await adapter.initialize(discordConfig);

  const orchestrator = new SessionOrchestrator({
    sessionStore: new SessionStore('sessions'),
    profileManager: new ProfileManager('agents'),
    executor: new ClaudeCodeWorker(),
    defaults: config.defaults
  });
  const commandHandler = new CommandHandler();

  buildBuiltInCommands(commandHandler);

  const gateway = new AgentGateway({
    adapters: [adapter],
    commandHandler,
    orchestrator,
    logger
  });

  await gateway.start();
  logger.info({}, 'Claude Assistant plugin runtime started.');

  const shutdown = async () => {
    logger.info({}, 'Shutting down...');
    await gateway.stop();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 3: Remove control-only types and adapter surface area**

`core/adapter.ts`

```ts
export interface ChannelAdapter {
  readonly type: string;
  initialize?(config: AdapterConfig): Promise<void>;
  onMessage(handler: (message: AgentMessage) => Promise<void>): void;
  sendMessage(channelId: string, content: string, options?: SendMessageOptions): Promise<SendMessageResult>;
  setTyping?(channelId: string, typing: boolean): Promise<void>;
  stop?(): Promise<void>;
}
```

`core/types.ts`

```ts
export interface SessionProfile {
  id: string;
  channelId: string;
  channelType: string;
  model: string;
  workingDirectory: string;
  permissionMode: string;
  profile?: string;
  createdAt: Date;
  lastActiveAt: Date;
  status: 'active' | 'archived';
  messageCount: number;
  recentFiles?: RecentFileRecord[];
}
```

Delete the `AgentRun*`, `ControlRequest*`, `ControlSignal*`, `ChannelProjection`, and `ChannelControlInput` declarations entirely.

- [ ] **Step 4: Update the Discord adapter to match the reduced contract**

Remove any `onControlInput`, thread projection, or control-message code paths, leaving only message ingest, attachment download, typing, and outbound send behavior.

- [ ] **Step 5: Run the focused runtime tests**

Run: `npx vitest run tests/core/gateway.test.ts tests/adapters/discord/index.test.ts`

Expected: PASS

### Task 3: Remove control scripts, tests, and config that no longer belong

**Files:**
- Delete: `scripts/control/upsert-run.ts`
- Delete: `scripts/control/request-control.ts`
- Delete: `scripts/control/poll-resolved-request.ts`
- Delete: `tests/core/control-store.test.ts`
- Delete: `tests/core/control-router.test.ts`
- Delete: `tests/core/control-sync.test.ts`
- Modify: `package.json`
- Modify: `config/gateway-config.ts`
- Modify: `settings.json`

- [ ] **Step 1: Delete abandoned control scripts and their tests**

```bash
rm scripts/control/upsert-run.ts
rm scripts/control/request-control.ts
rm scripts/control/poll-resolved-request.ts
rm tests/core/control-store.test.ts
rm tests/core/control-router.test.ts
rm tests/core/control-sync.test.ts
```

- [ ] **Step 2: Remove control scripts from package metadata**

`package.json`

```json
{
  "scripts": {
    "dev": "tsx watch index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest watch",
    "test:e2e:file-return": "tsx scripts/e2e/file-return-stop-hook.ts"
  }
}
```

- [ ] **Step 3: Remove the control block from config parsing and defaults**

`settings.json`

```json
{
  "defaults": {
    "model": "sonnet",
    "permissionMode": "auto",
    "workingDirectory": "."
  },
  "limits": {
    "maxConcurrentSessions": 10,
    "sessionTimeout": 3600000,
    "maxTriggersPerSession": 50
  },
  "enabledAdapters": [
    "discord"
  ],
  "logging": {
    "level": "info",
    "file": "logs/gateway.log"
  }
}
```

`config/gateway-config.ts`

```ts
const gatewayConfigSchema = z.object({
  name: z.string(),
  version: z.string(),
  defaults: z.object({
    model: z.string().default('sonnet'),
    permissionMode: permissionModeSchema.default('auto'),
    workingDirectory: z.string().default('.')
  }).default({
    model: 'sonnet',
    permissionMode: 'auto',
    workingDirectory: '.'
  }),
  limits: z.object({
    maxConcurrentSessions: z.number().int().positive().default(10),
    sessionTimeout: z.number().int().positive().default(3_600_000),
    maxTriggersPerSession: z.number().int().positive().default(50)
  }).default({
    maxConcurrentSessions: 10,
    sessionTimeout: 3_600_000,
    maxTriggersPerSession: 50
  }),
  enabledAdapters: z.array(z.string()).min(1),
  logging: z.object({
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
    file: z.string().default('logs/gateway.log')
  }).default({
    level: 'info',
    file: 'logs/gateway.log'
  })
});
```

- [ ] **Step 4: Run the remaining config and package-adjacent tests**

Run: `npx vitest run tests/config/gateway-config.test.ts`

Expected: PASS

### Task 4: Remove abandoned docs and rewrite surviving docs to the new truth

**Files:**
- Delete: `docs/superpowers/plans/2026-03-31-control-signal-gateway.md`
- Delete: `docs/superpowers/specs/2026-03-31-control-signal-gateway-design.md`
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Delete the abandoned control-gateway design documents**

```bash
rm docs/superpowers/plans/2026-03-31-control-signal-gateway.md
rm docs/superpowers/specs/2026-03-31-control-signal-gateway-design.md
```

- [ ] **Step 2: Rewrite surviving docs so they no longer promise control-signal behavior**

`README.md`

```md
# Claude Assistant Plugin

This repository contains Claude Assistant plugin components, including skills, agents, hooks, session management, attachment handling, and the local runtime used for development and testing.

## Setup

```bash
npm install
cp .env.example .env
```

## Current Runtime Scope

- Discord-backed local runtime for development
- Session persistence under `sessions/`
- Agent/profile loading from `agents/`
- File-return skill under `skills/file-return/`
- Hook configuration under `.claude/` and `hooks/`

## Commands

- `npm run dev`
- `npm run build`
- `npm test`
- `npm run test:e2e:file-return`
```

`CLAUDE.md`

Remove references to the control layer and describe only the surviving architecture.

- [ ] **Step 3: Run a dead-reference search to confirm the removed design no longer leaks**

Run: `rg -n "control-store|control-router|control-sync|control:|waiting_control|ControlSignal|ControlRequest|ChannelProjection" .`

Expected: no matches in live runtime/config/docs files outside unrelated historical notes you deliberately chose to keep.

### Task 5: Implement the minimal session-store fix and run full verification

**Files:**
- Modify: `core/session-store.ts`
- Modify: `core/orchestrator.ts`
- Modify: `tests/core/orchestrator.test.ts`

- [ ] **Step 1: Make channel lookup return only active sessions**

`core/session-store.ts`

```ts
  loadByChannel(channelType: string, channelId: string): SessionProfile | null {
    return (
      this.list().find(
        (session) =>
          session.channelType === channelType &&
          session.channelId === channelId &&
          session.status !== 'archived'
      ) ?? null
    );
  }
```

- [ ] **Step 2: Ensure replacement sessions are saved as active and old sessions stay archived**

`core/orchestrator.ts`

```ts
      this.archiveSession(session.id);

      const replacementSession: SessionProfile = {
        ...session,
        id: randomUUID(),
        status: 'active',
        messageCount: 0,
        lastActiveAt: this.clock()
      };
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`

Expected: PASS

- [ ] **Step 4: Run the build**

Run: `npm run build`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index.ts core adapters tests package.json settings.json README.md CLAUDE.md docs/superpowers/specs/2026-04-02-plugin-component-convergence-design.md docs/superpowers/plans/2026-04-02-remove-control-gateway-debt.md
git rm core/control-store.ts core/control-router.ts core/control-sync.ts scripts/control/upsert-run.ts scripts/control/request-control.ts scripts/control/poll-resolved-request.ts tests/core/control-store.test.ts tests/core/control-router.test.ts tests/core/control-sync.test.ts docs/superpowers/plans/2026-03-31-control-signal-gateway.md docs/superpowers/specs/2026-03-31-control-signal-gateway-design.md
git commit -m "refactor: remove abandoned control gateway debt"
```
