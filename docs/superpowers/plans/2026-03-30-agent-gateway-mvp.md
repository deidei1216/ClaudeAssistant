# Agent Gateway MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first runnable Agent Gateway MVP in this repository: a TypeScript service that receives Discord messages, keeps one Claude session per channel, executes `claude --print` with per-session configuration, and supports the first batch of slash-style commands.

**Architecture:** The MVP is a single Node.js process with four focused layers: typed domain objects, file-backed session/profile storage, a Claude CLI worker, and a gateway that routes channel messages either to the command handler or to Claude. The scope is intentionally limited to Phase 1 in the design doc so we ship a working Discord-to-Claude path before adding Trigger Engine, webhook events, or extra adapters.

**Tech Stack:** Node.js 18+, TypeScript, Vitest, discord.js, pino, zod

---

## Scope Split

The source design doc covers multiple independent subsystems. This plan only implements the first self-contained slice:

- Included now: project scaffolding, typed core abstractions, JSON-backed session persistence, profile loading, Claude Code worker, Discord adapter, command handling, app bootstrap, smoke/integration tests, and operator docs.
- Deferred to follow-up plans: Trigger Engine (`delay`, `schedule`, `event`), `/triggers` command family, webhook event ingestion, and non-Discord adapters (`wechat`, `slack`, `telegram`).

## Planned File Map

### Runtime and Tooling

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`

### Static Configuration

- Create: `config/gateway.json`
- Create: `config/adapters/discord.json`
- Create: `profiles/default.json`
- Create: `profiles/code-review.json`
- Create: `profiles/research.json`
- Create: `profiles/writing.json`

### Core Application Code

- Create: `src/config/gateway-config.ts`
- Create: `src/core/types.ts`
- Create: `src/core/adapter.ts`
- Create: `src/core/session-store.ts`
- Create: `src/core/profile-manager.ts`
- Create: `src/core/orchestrator.ts`
- Create: `src/core/worker.ts`
- Create: `src/core/gateway.ts`
- Create: `src/commands/types.ts`
- Create: `src/commands/index.ts`
- Create: `src/commands/built-in/model.ts`
- Create: `src/commands/built-in/cd.ts`
- Create: `src/commands/built-in/profile.ts`
- Create: `src/commands/built-in/help.ts`
- Create: `src/commands/built-in/status.ts`
- Create: `src/adapters/index.ts`
- Create: `src/adapters/discord/index.ts`
- Create: `src/adapters/discord/message-formatter.ts`
- Create: `src/utils/logger.ts`
- Create: `src/index.ts`

### Tests

- Create: `tests/config/gateway-config.test.ts`
- Create: `tests/core/session-store.test.ts`
- Create: `tests/core/profile-manager.test.ts`
- Create: `tests/core/orchestrator.test.ts`
- Create: `tests/core/worker.test.ts`
- Create: `tests/commands/command-handler.test.ts`
- Create: `tests/adapters/discord-adapter.test.ts`
- Create: `tests/core/gateway.test.ts`

### Docs

- Create: `README.md`

## Task 1: Bootstrap the TypeScript service and config loader

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `config/gateway.json`
- Create: `src/config/gateway-config.ts`
- Test: `tests/config/gateway-config.test.ts`

- [ ] **Step 1: Create the package and test harness**

```json
{
  "name": "claude-assistant-agent-gateway",
  "version": "0.1.0",
  "private": true,
  "description": "Agent Gateway MVP for ClaudeAssistant",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "engines": {
    "node": ">=18.18.0"
  },
  "dependencies": {
    "dotenv": "^16.4.7",
    "discord.js": "^14.19.2",
    "pino": "^9.2.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.13.10",
    "tsx": "^4.19.3",
    "typescript": "^5.8.2",
    "vitest": "^3.0.8"
  }
}
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules", "tests"]
}
```

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node'
  }
});
```

```gitignore
node_modules
dist
.env
logs
data
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: npm installs the dependencies from `package.json` without errors.

- [ ] **Step 3: Write the failing config-loader test**

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadGatewayConfig } from '../../src/config/gateway-config';

describe('loadGatewayConfig', () => {
  it('fills in omitted optional settings with defaults', () => {
    const root = mkdtempSync(join(tmpdir(), 'gateway-config-'));
    const configDir = join(root, 'config');
    const configPath = join(configDir, 'gateway.json');

    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        name: 'agent-gateway',
        version: '1.0.0',
        enabledAdapters: ['discord']
      })
    );

    const config = loadGatewayConfig(configPath);

    expect(config.defaults.model).toBe('sonnet');
    expect(config.defaults.permissionMode).toBe('auto');
    expect(config.limits.maxConcurrentSessions).toBe(10);
    expect(config.logging.level).toBe('info');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- tests/config/gateway-config.test.ts`
Expected: FAIL with `Cannot find module '../../src/config/gateway-config'`.

- [ ] **Step 5: Implement the config schema and sample config**

```json
{
  "name": "agent-gateway",
  "version": "1.0.0",
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
  "enabledAdapters": ["discord"],
  "logging": {
    "level": "info",
    "file": "logs/gateway.log"
  }
}
```

```ts
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const gatewayConfigSchema = z.object({
  name: z.string(),
  version: z.string(),
  defaults: z
    .object({
      model: z.string().default('sonnet'),
      permissionMode: z
        .enum(['default', 'auto', 'plan', 'bypassPermissions', 'dontAsk', 'acceptEdits'])
        .default('auto'),
      workingDirectory: z.string().default('.')
    })
    .default({}),
  limits: z
    .object({
      maxConcurrentSessions: z.number().int().positive().default(10),
      sessionTimeout: z.number().int().positive().default(3600000),
      maxTriggersPerSession: z.number().int().positive().default(50)
    })
    .default({}),
  enabledAdapters: z.array(z.string()).default([]),
  logging: z
    .object({
      level: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
      file: z.string().default('logs/gateway.log')
    })
    .default({})
});

export type GatewayConfig = z.infer<typeof gatewayConfigSchema>;

export function loadGatewayConfig(configPath: string): GatewayConfig {
  const raw = JSON.parse(readFileSync(configPath, 'utf8'));
  return gatewayConfigSchema.parse(raw);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- tests/config/gateway-config.test.ts`
Expected: PASS with 1 test passed.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore config/gateway.json src/config/gateway-config.ts tests/config/gateway-config.test.ts package-lock.json
git commit -m "chore: bootstrap agent gateway project"
```

## Task 2: Add typed session storage and profile loading

**Files:**
- Create: `src/core/types.ts`
- Create: `src/core/adapter.ts`
- Create: `src/core/session-store.ts`
- Create: `src/core/profile-manager.ts`
- Create: `profiles/default.json`
- Create: `profiles/code-review.json`
- Create: `profiles/research.json`
- Create: `profiles/writing.json`
- Test: `tests/core/session-store.test.ts`
- Test: `tests/core/profile-manager.test.ts`

- [ ] **Step 1: Write the failing storage and profile tests**

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionStore } from '../../src/core/session-store';
import { SessionProfile } from '../../src/core/types';

describe('SessionStore', () => {
  it('persists and reloads a session keyed by channel', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'session-store-'));
    const store = new SessionStore(baseDir);
    const session: SessionProfile = {
      id: '9e0ef8e2-f9d7-4fb9-a261-4d35bc8b23eb',
      channelId: 'channel-1',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory: '.',
      permissionMode: 'auto',
      createdAt: new Date('2026-03-30T00:00:00.000Z'),
      lastActiveAt: new Date('2026-03-30T00:00:00.000Z'),
      status: 'active',
      messageCount: 0
    };

    store.save(session);

    expect(store.loadByChannel('discord', 'channel-1')).toEqual(session);
  });
});
```

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProfileManager } from '../../src/core/profile-manager';

describe('ProfileManager', () => {
  it('loads a profile and keeps only session-overridable fields', () => {
    const root = mkdtempSync(join(tmpdir(), 'profiles-'));
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'writing.json'),
      JSON.stringify({
        name: 'writing',
        description: 'Writing mode',
        model: 'opus',
        permissionMode: 'plan',
        customSystemPrompt: 'Write concise drafts.'
      })
    );

    const manager = new ProfileManager(root);
    const profile = manager.load('writing');

    expect(profile.name).toBe('writing');
    expect(profile.model).toBe('opus');
    expect(profile.permissionMode).toBe('plan');
    expect(profile.customSystemPrompt).toContain('concise');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/core/session-store.test.ts tests/core/profile-manager.test.ts`
Expected: FAIL with missing module errors for `session-store`, `types`, and `profile-manager`.

- [ ] **Step 3: Implement core types, the adapter contract, the session store, and the profile manager**

```ts
export type PermissionMode = 'default' | 'auto' | 'plan' | 'bypassPermissions' | 'dontAsk' | 'acceptEdits';
export type SessionStatus = 'active' | 'idle' | 'archived';

export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  url: string;
  localPath?: string;
}

export interface AgentMessage {
  id: string;
  channelId: string;
  channelType: string;
  userId: string;
  content: string;
  attachments?: Attachment[];
  replyTo?: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

export interface AgentResponse {
  content: string;
  attachments?: Attachment[];
  replyTo?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionProfile {
  id: string;
  channelId: string;
  channelType: string;
  model: string;
  workingDirectory: string;
  settingsPath?: string;
  customSystemPrompt?: string;
  permissionMode: PermissionMode;
  allowedTools?: string[];
  deniedTools?: string[];
  profile?: string;
  createdAt: Date;
  lastActiveAt: Date;
  status: SessionStatus;
  messageCount: number;
  totalTokens?: number;
}

export interface SessionProfileTemplate {
  name: string;
  description?: string;
  model?: string;
  workingDirectory?: string;
  settingsPath?: string;
  customSystemPrompt?: string;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
  deniedTools?: string[];
}

export interface SessionConfigPatch {
  model?: string;
  workingDirectory?: string;
  settingsPath?: string;
  customSystemPrompt?: string;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
  deniedTools?: string[];
  profile?: string;
}

export interface SessionFilter {
  status?: SessionStatus;
  channelType?: string;
}

export interface AgentExecutor {
  execute(session: SessionProfile, message: AgentMessage): Promise<AgentResponse>;
}
```

```ts
import { AgentMessage, AgentResponse } from './types';

export interface AdapterConfig {
  enabled: boolean;
  [key: string]: unknown;
}

export interface MessageResult {
  messageId: string;
  success: boolean;
  error?: string;
}

export interface ChannelAdapter {
  readonly name: string;
  readonly type: string;
  initialize(config: AdapterConfig): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(callback: (message: AgentMessage) => void): void;
  send(channelId: string, response: AgentResponse): Promise<MessageResult>;
  typing?(channelId: string): Promise<void>;
  react?(messageId: string, emoji: string): Promise<void>;
  edit?(messageId: string, response: AgentResponse): Promise<void>;
}
```

```ts
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionProfile } from './types';

function serialize(session: SessionProfile): string {
  return JSON.stringify(
    {
      ...session,
      createdAt: session.createdAt.toISOString(),
      lastActiveAt: session.lastActiveAt.toISOString()
    },
    null,
    2
  );
}

function deserialize(raw: string): SessionProfile {
  const parsed = JSON.parse(raw);
  return {
    ...parsed,
    createdAt: new Date(parsed.createdAt),
    lastActiveAt: new Date(parsed.lastActiveAt)
  };
}

export class SessionStore {
  constructor(private readonly baseDir: string) {}

  save(session: SessionProfile): void {
    const filePath = this.getPath(session.channelType, session.channelId);
    mkdirSync(join(this.baseDir, session.channelType), { recursive: true });
    writeFileSync(filePath, serialize(session));
  }

  loadByChannel(channelType: string, channelId: string): SessionProfile | null {
    const filePath = this.getPath(channelType, channelId);
    try {
      return deserialize(readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  list(): SessionProfile[] {
    try {
      return readdirSync(this.baseDir)
        .flatMap((channelType) => {
          const dir = join(this.baseDir, channelType);
          if (!statSync(dir).isDirectory()) {
            return [];
          }

          return readdirSync(dir).map((file) => deserialize(readFileSync(join(dir, file), 'utf8')));
        })
        .sort((left, right) => right.lastActiveAt.getTime() - left.lastActiveAt.getTime());
    } catch {
      return [];
    }
  }

  private getPath(channelType: string, channelId: string): string {
    return join(this.baseDir, channelType, `${channelId}.json`);
  }
}
```

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionProfileTemplate } from './types';

export class ProfileManager {
  constructor(private readonly profilesDir: string) {}

  load(name: string): SessionProfileTemplate {
    const filePath = join(this.profilesDir, `${name}.json`);
    return JSON.parse(readFileSync(filePath, 'utf8')) as SessionProfileTemplate;
  }
}
```

```json
{
  "name": "default",
  "description": "Default chat profile",
  "model": "sonnet",
  "permissionMode": "auto"
}
```

```json
{
  "name": "code-review",
  "description": "Code review profile",
  "model": "opus",
  "permissionMode": "auto",
  "allowedTools": ["Read", "Glob", "Grep", "Bash(git:*)", "Edit"],
  "customSystemPrompt": "Review code for bugs, regressions, and missing tests."
}
```

```json
{
  "name": "research",
  "description": "Research profile",
  "model": "sonnet",
  "permissionMode": "plan",
  "customSystemPrompt": "Gather facts, cite sources, and explain trade-offs."
}
```

```json
{
  "name": "writing",
  "description": "Writing profile",
  "model": "opus",
  "permissionMode": "plan",
  "customSystemPrompt": "Draft clear, concise text and preserve the user's voice."
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/core/session-store.test.ts tests/core/profile-manager.test.ts`
Expected: PASS with 2 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/core/adapter.ts src/core/session-store.ts src/core/profile-manager.ts profiles/default.json profiles/code-review.json profiles/research.json profiles/writing.json tests/core/session-store.test.ts tests/core/profile-manager.test.ts
git commit -m "feat: add session storage and profile loading"
```

## Task 3: Build the session orchestrator

**Files:**
- Create: `src/core/orchestrator.ts`
- Test: `tests/core/orchestrator.test.ts`

- [ ] **Step 1: Write the failing orchestrator test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionOrchestrator } from '../../src/core/orchestrator';
import { AgentExecutor, AgentMessage } from '../../src/core/types';
import { ProfileManager } from '../../src/core/profile-manager';
import { SessionStore } from '../../src/core/session-store';

describe('SessionOrchestrator', () => {
  it('creates one session per channel and reuses it on later messages', async () => {
    const executor: AgentExecutor = {
      execute: vi.fn().mockResolvedValue({ content: 'hello from claude' })
    };
    const store = new SessionStore(mkdtempSync(join(tmpdir(), 'orchestrator-store-')));
    const profiles = new ProfileManager('profiles');
    const orchestrator = new SessionOrchestrator({
      sessionStore: store,
      profileManager: profiles,
      executor,
      defaults: {
        model: 'sonnet',
        permissionMode: 'auto',
        workingDirectory: '.'
      },
      clock: () => new Date('2026-03-30T00:00:00.000Z')
    });

    const first = orchestrator.getOrCreateSession('channel-1', 'discord');
    const second = orchestrator.getOrCreateSession('channel-1', 'discord');
    const message: AgentMessage = {
      id: 'msg-1',
      channelId: 'channel-1',
      channelType: 'discord',
      userId: 'user-1',
      content: 'summarize this repo',
      timestamp: new Date('2026-03-30T00:00:00.000Z')
    };

    const response = await orchestrator.execute(first.id, message);

    expect(second.id).toBe(first.id);
    expect(response.content).toBe('hello from claude');
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(orchestrator.getSession(first.id)?.messageCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/core/orchestrator.test.ts`
Expected: FAIL with `Cannot find module '../../src/core/orchestrator'`.

- [ ] **Step 3: Implement the orchestrator**

```ts
import { randomUUID } from 'node:crypto';
import {
  AgentExecutor,
  AgentMessage,
  AgentResponse,
  SessionConfigPatch,
  SessionFilter,
  SessionProfile,
  SessionProfileTemplate
} from './types';
import { ProfileManager } from './profile-manager';
import { SessionStore } from './session-store';

interface OrchestratorOptions {
  sessionStore: SessionStore;
  profileManager: ProfileManager;
  executor: AgentExecutor;
  defaults: Pick<SessionProfile, 'model' | 'permissionMode' | 'workingDirectory'>;
  clock?: () => Date;
}

export class SessionOrchestrator {
  private readonly clock: () => Date;

  constructor(private readonly options: OrchestratorOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  getOrCreateSession(channelId: string, channelType: string): SessionProfile {
    const existing = this.options.sessionStore.loadByChannel(channelType, channelId);
    if (existing) {
      return existing;
    }

    const now = this.clock();
    const session: SessionProfile = {
      id: randomUUID(),
      channelId,
      channelType,
      model: this.options.defaults.model,
      workingDirectory: this.options.defaults.workingDirectory,
      permissionMode: this.options.defaults.permissionMode,
      createdAt: now,
      lastActiveAt: now,
      status: 'active',
      messageCount: 0
    };

    this.options.sessionStore.save(session);
    return session;
  }

  getSession(sessionId: string): SessionProfile | null {
    return this.options.sessionStore.list().find((session) => session.id === sessionId) ?? null;
  }

  getSessionByChannel(channelId: string, channelType: string): SessionProfile | null {
    return this.options.sessionStore.loadByChannel(channelType, channelId);
  }

  listSessions(filter?: SessionFilter): SessionProfile[] {
    return this.options.sessionStore.list().filter((session) => {
      if (filter?.status && session.status !== filter.status) {
        return false;
      }
      if (filter?.channelType && session.channelType !== filter.channelType) {
        return false;
      }
      return true;
    });
  }

  updateSessionConfig(sessionId: string, config: SessionConfigPatch): SessionProfile {
    const session = this.requireSession(sessionId);
    const updated: SessionProfile = {
      ...session,
      ...config,
      id: session.id,
      channelId: session.channelId,
      channelType: session.channelType,
      lastActiveAt: this.clock()
    };

    this.options.sessionStore.save(updated);
    return updated;
  }

  archiveSession(sessionId: string): void {
    this.updateSessionConfig(sessionId, { status: 'archived' });
  }

  loadProfile(profileName: string): SessionProfileTemplate {
    return this.options.profileManager.load(profileName);
  }

  async execute(sessionId: string, message: AgentMessage): Promise<AgentResponse> {
    const session = this.requireSession(sessionId);
    const response = await this.options.executor.execute(session, message);

    this.options.sessionStore.save({
      ...session,
      messageCount: session.messageCount + 1,
      lastActiveAt: this.clock()
    });

    return response;
  }

  private requireSession(sessionId: string): SessionProfile {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return session;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/core/orchestrator.test.ts`
Expected: PASS with 1 test passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator.ts tests/core/orchestrator.test.ts
git commit -m "feat: add session orchestrator"
```

## Task 4: Implement the Claude Code worker

**Files:**
- Create: `src/core/worker.ts`
- Test: `tests/core/worker.test.ts`

- [ ] **Step 1: Write the failing worker test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { ClaudeCodeWorker } from '../../src/core/worker';
import { AgentMessage, SessionProfile } from '../../src/core/types';

describe('ClaudeCodeWorker', () => {
  it('maps a session into the correct claude CLI invocation', async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: 'done',
      stderr: '',
      exitCode: 0
    });
    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: '9e0ef8e2-f9d7-4fb9-a261-4d35bc8b23eb',
      channelId: 'channel-1',
      channelType: 'discord',
      model: 'opus',
      workingDirectory: '/tmp/project',
      settingsPath: '.claude/settings.local.json',
      customSystemPrompt: 'Stay concise.',
      permissionMode: 'plan',
      allowedTools: ['Read', 'Edit'],
      deniedTools: ['Bash(rm:*)'],
      createdAt: new Date('2026-03-30T00:00:00.000Z'),
      lastActiveAt: new Date('2026-03-30T00:00:00.000Z'),
      status: 'active',
      messageCount: 1
    };
    const message: AgentMessage = {
      id: 'msg-1',
      channelId: 'channel-1',
      channelType: 'discord',
      userId: 'user-1',
      content: 'Summarize the latest commit.',
      timestamp: new Date('2026-03-30T00:00:00.000Z')
    };

    const response = await worker.execute(session, message);

    expect(runner).toHaveBeenCalledWith(
      'claude',
      [
        '--print',
        '--session-id',
        '9e0ef8e2-f9d7-4fb9-a261-4d35bc8b23eb',
        '--model',
        'opus',
        '--permission-mode',
        'plan',
        '--settings',
        '.claude/settings.local.json',
        '--allowedTools',
        'Read',
        'Edit',
        '--disallowedTools',
        'Bash(rm:*)',
        '--append-system-prompt',
        'Stay concise.',
        'Summarize the latest commit.'
      ],
      { cwd: '/tmp/project' }
    );
    expect(response.content).toBe('done');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/core/worker.test.ts`
Expected: FAIL with `Cannot find module '../../src/core/worker'`.

- [ ] **Step 3: Verify the local CLI contract before coding**

Run: `claude --help | rg "session-id|model|permission-mode|allowedTools|disallowedTools|append-system-prompt|settings|print"`
Expected: output includes these exact flags:

```text
-p, --print
--model <model>
--permission-mode <mode>
--session-id <uuid>
--settings <file-or-json>
--allowedTools, --allowed-tools <tools...>
--disallowedTools, --disallowed-tools <tools...>
--append-system-prompt <prompt>
```

- [ ] **Step 4: Implement the worker**

```ts
import { spawn } from 'node:child_process';
import { AgentExecutor, AgentMessage, AgentResponse, SessionProfile } from './types';

export type CommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string }
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

function defaultRunner(
  command: string,
  args: string[],
  options: { cwd: string }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 0 });
    });
  });
}

export class ClaudeCodeWorker implements AgentExecutor {
  constructor(private readonly runner: CommandRunner = defaultRunner) {}

  async execute(session: SessionProfile, message: AgentMessage): Promise<AgentResponse> {
    const args = [
      '--print',
      '--session-id',
      session.id,
      '--model',
      session.model,
      '--permission-mode',
      session.permissionMode
    ];

    if (session.settingsPath) {
      args.push('--settings', session.settingsPath);
    }

    if (session.allowedTools?.length) {
      args.push('--allowedTools', ...session.allowedTools);
    }

    if (session.deniedTools?.length) {
      args.push('--disallowedTools', ...session.deniedTools);
    }

    if (session.customSystemPrompt) {
      args.push('--append-system-prompt', session.customSystemPrompt);
    }

    args.push(message.content);

    const result = await this.runner('claude', args, { cwd: session.workingDirectory });

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `claude exited with status ${result.exitCode}`);
    }

    return {
      content: result.stdout.trim(),
      replyTo: message.id
    };
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/core/worker.test.ts`
Expected: PASS with 1 test passed.

- [ ] **Step 6: Commit**

```bash
git add src/core/worker.ts tests/core/worker.test.ts
git commit -m "feat: add claude code worker"
```

## Task 5: Add the command handler and built-in session commands

**Files:**
- Create: `src/commands/types.ts`
- Create: `src/commands/index.ts`
- Create: `src/commands/built-in/model.ts`
- Create: `src/commands/built-in/cd.ts`
- Create: `src/commands/built-in/profile.ts`
- Create: `src/commands/built-in/help.ts`
- Create: `src/commands/built-in/status.ts`
- Test: `tests/commands/command-handler.test.ts`

- [ ] **Step 1: Write the failing command-handler test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { CommandHandler } from '../../src/commands';
import { buildBuiltInCommands } from '../../src/commands/built-in/help';
import { AgentMessage, SessionProfile } from '../../src/core/types';

describe('CommandHandler', () => {
  it('updates a session when /model is invoked', async () => {
    const session: SessionProfile = {
      id: 'session-1',
      channelId: 'channel-1',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory: '.',
      permissionMode: 'auto',
      createdAt: new Date('2026-03-30T00:00:00.000Z'),
      lastActiveAt: new Date('2026-03-30T00:00:00.000Z'),
      status: 'active',
      messageCount: 1
    };
    const message: AgentMessage = {
      id: 'msg-1',
      channelId: 'channel-1',
      channelType: 'discord',
      userId: 'user-1',
      content: '/model opus',
      timestamp: new Date('2026-03-30T00:00:00.000Z')
    };
    const orchestrator = {
      updateSessionConfig: vi.fn().mockReturnValue({ ...session, model: 'opus' }),
      loadProfile: vi.fn(),
      listSessions: vi.fn(),
      getSession: vi.fn().mockReturnValue(session)
    };
    const handler = new CommandHandler();

    buildBuiltInCommands(handler);
    const result = await handler.executeFromMessage(message, {
      session,
      message,
      orchestrator
    });

    expect(orchestrator.updateSessionConfig).toHaveBeenCalledWith('session-1', { model: 'opus' });
    expect(result.success).toBe(true);
    expect(result.message).toContain('opus');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/commands/command-handler.test.ts`
Expected: FAIL with missing module errors for `../../src/commands`.

- [ ] **Step 3: Implement the command types and registry**

```ts
import { AgentMessage, SessionProfile } from '../core/types';

export interface CommandResult {
  success: boolean;
  message?: string;
  data?: unknown;
}

export interface CommandContext {
  session: SessionProfile;
  message: AgentMessage;
  orchestrator: {
    updateSessionConfig: (sessionId: string, config: import('../core/types').SessionConfigPatch) => SessionProfile;
    loadProfile: (profileName: string) => import('../core/types').SessionProfileTemplate;
    getSession: (sessionId: string) => SessionProfile | null;
  };
}

export interface CommandDefinition {
  name: string;
  description: string;
  usage: string;
  aliases?: string[];
  handler: (args: string[], context: CommandContext) => Promise<CommandResult>;
}
```

```ts
import { CommandContext, CommandDefinition, CommandResult } from './types';
import { AgentMessage } from '../core/types';

function parseCommand(content: string): { name: string; args: string[] } | null {
  if (!content.startsWith('/')) {
    return null;
  }

  const [name, ...args] = content.slice(1).trim().split(/\s+/);
  if (!name) {
    return null;
  }

  return { name, args };
}

export class CommandHandler {
  private readonly commands = new Map<string, CommandDefinition>();

  register(command: CommandDefinition): void {
    this.commands.set(command.name, command);
    command.aliases?.forEach((alias) => this.commands.set(alias, command));
  }

  list(): CommandDefinition[] {
    return Array.from(new Set(this.commands.values())).sort((left, right) => left.name.localeCompare(right.name));
  }

  async execute(commandName: string, args: string[], context: CommandContext): Promise<CommandResult> {
    const command = this.commands.get(commandName);
    if (!command) {
      return { success: false, message: `Unknown command: ${commandName}` };
    }

    return command.handler(args, context);
  }

  async executeFromMessage(message: AgentMessage, context: CommandContext): Promise<CommandResult> {
    const parsed = parseCommand(message.content);
    if (!parsed) {
      return { success: false, message: 'Not a command message.' };
    }

    return this.execute(parsed.name, parsed.args, context);
  }
}
```

- [ ] **Step 4: Implement the built-in commands**

```ts
import { CommandDefinition } from '../types';

export const modelCommand: CommandDefinition = {
  name: 'model',
  description: 'Switch the Claude model for this session.',
  usage: '/model <name>',
  handler: async ([model], context) => {
    if (!model) {
      return { success: false, message: 'Usage: /model <name>' };
    }

    context.orchestrator.updateSessionConfig(context.session.id, { model });
    return { success: true, message: `Model updated to ${model}.` };
  }
};
```

```ts
import { resolve } from 'node:path';
import { CommandDefinition } from '../types';

export const cdCommand: CommandDefinition = {
  name: 'cd',
  description: 'Switch the working directory for this session.',
  usage: '/cd <path>',
  handler: async (args, context) => {
    const path = args.join(' ').trim();
    if (!path) {
      return { success: false, message: 'Usage: /cd <path>' };
    }

    const workingDirectory = resolve(path);
    context.orchestrator.updateSessionConfig(context.session.id, { workingDirectory });
    return { success: true, message: `Working directory updated to ${workingDirectory}.` };
  }
};
```

```ts
import { CommandDefinition } from '../types';

export const profileCommand: CommandDefinition = {
  name: 'profile',
  description: 'Load a saved session profile.',
  usage: '/profile <name>',
  handler: async ([profileName], context) => {
    if (!profileName) {
      return { success: false, message: 'Usage: /profile <name>' };
    }

    const { name: _name, description: _description, ...profile } = context.orchestrator.loadProfile(profileName);
    context.orchestrator.updateSessionConfig(context.session.id, {
      ...profile,
      profile: profileName
    });

    return { success: true, message: `Profile ${profileName} loaded.` };
  }
};
```

```ts
import { CommandDefinition } from '../types';

export const statusCommand: CommandDefinition = {
  name: 'status',
  description: 'Show the current session state.',
  usage: '/status',
  handler: async (_args, context) => {
    const session = context.orchestrator.getSession(context.session.id);
    if (!session) {
      return { success: false, message: 'Session not found.' };
    }

    return {
      success: true,
      message: `Session ${session.id}\nmodel=${session.model}\ncwd=${session.workingDirectory}\nmessages=${session.messageCount}`
    };
  }
};
```

```ts
import { CommandHandler } from '..';
import { CommandDefinition } from '../types';
import { cdCommand } from './cd';
import { modelCommand } from './model';
import { profileCommand } from './profile';
import { statusCommand } from './status';

export const helpCommand: CommandDefinition = {
  name: 'help',
  description: 'List the built-in commands.',
  usage: '/help',
  handler: async (_args, _context) => ({
    success: true,
    message: ['/model <name>', '/cd <path>', '/profile <name>', '/status', '/help'].join('\n')
  })
};

export function buildBuiltInCommands(handler: CommandHandler): void {
  [modelCommand, cdCommand, profileCommand, statusCommand, helpCommand].forEach((command) =>
    handler.register(command)
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/commands/command-handler.test.ts`
Expected: PASS with 1 test passed.

- [ ] **Step 6: Commit**

```bash
git add src/commands/types.ts src/commands/index.ts src/commands/built-in/model.ts src/commands/built-in/cd.ts src/commands/built-in/profile.ts src/commands/built-in/help.ts src/commands/built-in/status.ts tests/commands/command-handler.test.ts
git commit -m "feat: add session command handling"
```

## Task 6: Implement the Discord adapter

**Files:**
- Create: `src/adapters/index.ts`
- Create: `src/adapters/discord/index.ts`
- Create: `src/adapters/discord/message-formatter.ts`
- Create: `config/adapters/discord.json`
- Test: `tests/adapters/discord-adapter.test.ts`

- [ ] **Step 1: Write the failing adapter test**

```ts
import { describe, expect, it } from 'vitest';
import { fromDiscordMessage, toDiscordChunks } from '../../src/adapters/discord/message-formatter';

describe('discord message formatter', () => {
  it('converts a Discord message into the gateway message shape', () => {
    const result = fromDiscordMessage({
      id: 'msg-1',
      channelId: 'channel-1',
      author: { id: 'user-1', bot: false },
      content: 'hello gateway',
      createdAt: new Date('2026-03-30T00:00:00.000Z')
    });

    expect(result.channelType).toBe('discord');
    expect(result.userId).toBe('user-1');
    expect(result.content).toBe('hello gateway');
  });

  it('splits long responses into Discord-sized chunks', () => {
    const chunks = toDiscordChunks('a'.repeat(4500), 2000);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(2000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/adapters/discord-adapter.test.ts`
Expected: FAIL with `Cannot find module '../../src/adapters/discord/message-formatter'`.

- [ ] **Step 3: Implement the formatter and adapter**

```ts
import { AgentMessage } from '../../core/types';

interface DiscordMessageLike {
  id: string;
  channelId: string;
  author: { id: string; bot: boolean };
  content: string;
  createdAt: Date;
}

export function fromDiscordMessage(message: DiscordMessageLike): AgentMessage {
  return {
    id: message.id,
    channelId: message.channelId,
    channelType: 'discord',
    userId: message.author.id,
    content: message.content,
    timestamp: message.createdAt
  };
}

export function toDiscordChunks(content: string, maxLength: number): string[] {
  if (content.length <= maxLength) {
    return [content];
  }

  const chunks: string[] = [];
  for (let index = 0; index < content.length; index += maxLength) {
    chunks.push(content.slice(index, index + maxLength));
  }
  return chunks;
}
```

```ts
import { Client, Events, GatewayIntentBits, TextBasedChannel } from 'discord.js';
import { AdapterConfig, ChannelAdapter, MessageResult } from '../../core/adapter';
import { AgentMessage, AgentResponse } from '../../core/types';
import { fromDiscordMessage, toDiscordChunks } from './message-formatter';

interface DiscordAdapterConfig extends AdapterConfig {
  token: string;
  messageLimits?: {
    maxLength?: number;
  };
}

export class DiscordAdapter implements ChannelAdapter {
  readonly name = 'Discord';
  readonly type = 'discord';
  private callback?: (message: AgentMessage) => void;
  private config?: DiscordAdapterConfig;

  constructor(private readonly client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] })) {}

  async initialize(config: DiscordAdapterConfig): Promise<void> {
    this.config = config;

    this.client.on(Events.MessageCreate, (message) => {
      if (message.author.bot || !this.callback) {
        return;
      }

      this.callback(
        fromDiscordMessage({
          id: message.id,
          channelId: message.channelId,
          author: { id: message.author.id, bot: message.author.bot },
          content: message.content,
          createdAt: message.createdAt
        })
      );
    });
  }

  async connect(): Promise<void> {
    if (!this.config?.token) {
      throw new Error('Discord token is required.');
    }
    await this.client.login(this.config.token);
  }

  async disconnect(): Promise<void> {
    this.client.destroy();
  }

  onMessage(callback: (message: AgentMessage) => void): void {
    this.callback = callback;
  }

  async send(channelId: string, response: AgentResponse): Promise<MessageResult> {
    const channel = (await this.client.channels.fetch(channelId)) as TextBasedChannel | null;
    if (!channel?.isTextBased()) {
      return { messageId: '', success: false, error: `Channel ${channelId} is not text-based.` };
    }

    const maxLength = this.config?.messageLimits?.maxLength ?? 2000;
    const chunks = toDiscordChunks(response.content, maxLength);
    let lastMessageId = '';

    for (const chunk of chunks) {
      const sent = await channel.send(chunk);
      lastMessageId = sent.id;
    }

    return { messageId: lastMessageId, success: true };
  }
}
```

```ts
export { DiscordAdapter } from './discord';
```

```json
{
  "enabled": true,
  "token": "${DISCORD_BOT_TOKEN}",
  "messageLimits": {
    "maxLength": 2000
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/adapters/discord-adapter.test.ts`
Expected: PASS with 2 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/index.ts src/adapters/discord/index.ts src/adapters/discord/message-formatter.ts config/adapters/discord.json tests/adapters/discord-adapter.test.ts
git commit -m "feat: add discord adapter"
```

## Task 7: Wire the gateway and application bootstrap

**Files:**
- Create: `src/utils/logger.ts`
- Create: `src/core/gateway.ts`
- Create: `src/index.ts`
- Test: `tests/core/gateway.test.ts`

- [ ] **Step 1: Write the failing gateway test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { AgentGateway } from '../../src/core/gateway';

describe('AgentGateway', () => {
  it('routes slash commands to the command handler and normal messages to the orchestrator', async () => {
    const adapter = {
      type: 'discord',
      onMessage: vi.fn(),
      send: vi.fn().mockResolvedValue({ messageId: '1', success: true }),
      initialize: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn()
    };
    const commandHandler = {
      executeFromMessage: vi.fn().mockResolvedValue({ success: true, message: 'Model updated to opus.' })
    };
    const orchestrator = {
      getOrCreateSession: vi.fn().mockReturnValue({ id: 'session-1' }),
      execute: vi.fn().mockResolvedValue({ content: 'Claude response' })
    };
    const gateway = new AgentGateway({
      adapters: [adapter],
      commandHandler,
      orchestrator,
      logger: { info: vi.fn(), error: vi.fn() }
    });

    await gateway.handleMessage(adapter, {
      id: 'msg-1',
      channelId: 'channel-1',
      channelType: 'discord',
      userId: 'user-1',
      content: '/help',
      timestamp: new Date('2026-03-30T00:00:00.000Z')
    });

    await gateway.handleMessage(adapter, {
      id: 'msg-2',
      channelId: 'channel-1',
      channelType: 'discord',
      userId: 'user-1',
      content: 'hello',
      timestamp: new Date('2026-03-30T00:00:00.000Z')
    });

    expect(commandHandler.executeFromMessage).toHaveBeenCalledTimes(1);
    expect(orchestrator.execute).toHaveBeenCalledTimes(1);
    expect(adapter.send).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/core/gateway.test.ts`
Expected: FAIL with `Cannot find module '../../src/core/gateway'`.

- [ ] **Step 3: Implement the logger, gateway, and bootstrap**

```ts
import pino from 'pino';

export function createLogger(level = 'info') {
  return pino({ level });
}
```

```ts
import { ChannelAdapter } from './adapter';
import { CommandHandler } from '../commands';
import { AgentMessage } from './types';
import { SessionOrchestrator } from './orchestrator';

interface GatewayOptions {
  adapters: ChannelAdapter[];
  commandHandler: CommandHandler;
  orchestrator: SessionOrchestrator;
  logger: {
    info: (message: string, data?: unknown) => void;
    error: (message: string, data?: unknown) => void;
  };
}

export class AgentGateway {
  constructor(private readonly options: GatewayOptions) {}

  async start(): Promise<void> {
    for (const adapter of this.options.adapters) {
      adapter.onMessage((message) => {
        void this.handleMessage(adapter, message);
      });
      await adapter.connect();
    }
  }

  async stop(): Promise<void> {
    await Promise.all(this.options.adapters.map((adapter) => adapter.disconnect()));
  }

  async handleMessage(adapter: ChannelAdapter, message: AgentMessage): Promise<void> {
    const session = this.options.orchestrator.getOrCreateSession(message.channelId, message.channelType);

    if (message.content.startsWith('/')) {
      const result = await this.options.commandHandler.executeFromMessage(message, {
        session,
        message,
        orchestrator: this.options.orchestrator
      });
      await adapter.send(message.channelId, { content: result.message ?? 'Done.', replyTo: message.id });
      return;
    }

    const response = await this.options.orchestrator.execute(session.id, message);
    await adapter.send(message.channelId, response);
  }
}
```

```ts
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DiscordAdapter } from './adapters';
import { CommandHandler } from './commands';
import { buildBuiltInCommands } from './commands/built-in/help';
import { loadGatewayConfig } from './config/gateway-config';
import { AgentGateway } from './core/gateway';
import { SessionOrchestrator } from './core/orchestrator';
import { ProfileManager } from './core/profile-manager';
import { SessionStore } from './core/session-store';
import { ClaudeCodeWorker } from './core/worker';
import { createLogger } from './utils/logger';

async function main(): Promise<void> {
  const config = loadGatewayConfig('config/gateway.json');
  const logger = createLogger(config.logging.level);
  const discordFile = JSON.parse(readFileSync(join('config', 'adapters', 'discord.json'), 'utf8'));
  const discordConfig = {
    ...discordFile,
    token: process.env.DISCORD_BOT_TOKEN ?? discordFile.token
  };
  const adapter = new DiscordAdapter();

  await adapter.initialize(discordConfig);

  const orchestrator = new SessionOrchestrator({
    sessionStore: new SessionStore(join('data', 'sessions')),
    profileManager: new ProfileManager('profiles'),
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
  logger.info('Agent Gateway started.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/core/gateway.test.ts`
Expected: PASS with 1 test passed.

- [ ] **Step 5: Run a build verification**

Run: `npm run build`
Expected: PASS and `dist/` contains the compiled application.

- [ ] **Step 6: Commit**

```bash
git add src/utils/logger.ts src/core/gateway.ts src/index.ts tests/core/gateway.test.ts
git commit -m "feat: wire gateway bootstrap"
```

## Task 8: Add operator docs and final verification

**Files:**
- Create: `.env.example`
- Create: `README.md`

- [ ] **Step 1: Write the operator-facing docs**

```dotenv
DISCORD_BOT_TOKEN=replace-me
```

````md
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
````

- [ ] **Step 2: Run the full verification suite**

Run: `npm test`
Expected: PASS with all unit tests green.

Run: `npm run build`
Expected: PASS with the production build emitted into `dist/`.

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs: add gateway setup guide"
```

## Spec Coverage Review

- Covered from the design doc: sections 2, 3, 5, 6, 7, and Phase 1 in section 8.
- Intentionally deferred into follow-up plans: section 4 Trigger Engine, `/triggers` command behavior, section 9 extensions for new trigger types, and Phase 2-4 items in section 8.
- No placeholders remain in this plan; every implementation step names exact files, commands, and code snippets.
- Type names are consistent across tasks: `AgentMessage`, `AgentResponse`, `SessionProfile`, `SessionOrchestrator`, `ClaudeCodeWorker`, `CommandHandler`, and `DiscordAdapter`.
