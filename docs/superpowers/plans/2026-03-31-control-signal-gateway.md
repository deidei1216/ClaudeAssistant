# Control Signal Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a channel-agnostic control-signal layer that lets the gateway display subagent progress and accept approval/resume actions without turning normal chat history into control noise.

**Architecture:** Add a JSON-backed control state layer beside the existing session store, then let adapters translate channel interactions into normalized control inputs that the gateway resolves into `ControlSignal` records. Keep Claude-side behavior in local scripts and hooks/skills, while the gateway only persists state, projects updates, and relays operator input.

**Tech Stack:** TypeScript, Node.js, discord.js, zod, Vitest, tsx

---

## File Structure

- Modify: `src/config/gateway-config.ts`
  Add `control` configuration (`enabled`, `baseDir`, `syncIntervalMs`) so the gateway can find persisted control state and poll for updates.

- Modify: `config/gateway.json`
  Turn on the control layer in local development with explicit defaults.

- Modify: `src/core/types.ts`
  Add the control-domain types: `AgentRun`, `ControlRequest`, `ControlSignal`, `ChannelProjection`, `ChannelControlInput`, and their enums/unions.

- Create: `src/core/control-store.ts`
  Persist runs, requests, signals, and projections to JSON using the same style as `SessionStore`.

- Create: `src/core/control-router.ts`
  Resolve a pending request from a control input, create a normalized `ControlSignal`, and update request/run state idempotently.

- Create: `src/core/control-sync.ts`
  Poll control storage and project pending request / run status updates into adapters that support control projection.

- Modify: `src/core/adapter.ts`
  Extend the adapter contract with optional control capabilities: `onControlInput`, `createThread`, and `upsertControlMessage`.

- Modify: `src/core/gateway.ts`
  Register control callbacks, start/stop the control sync loop, and route adapter control inputs through `ControlRouter`.

- Modify: `src/index.ts`
  Instantiate `ControlStore`, `ControlRouter`, and `ControlSync`, then pass them into `AgentGateway`.

- Create: `src/adapters/discord/control-input-mapper.ts`
  Convert Discord reactions and replies into normalized `ChannelControlInput` values.

- Modify: `src/adapters/discord/index.ts`
  Listen for reactions and reply messages, create threads for child runs, and upsert control status messages.

- Modify: `tests/config/gateway-config.test.ts`
  Cover the new control config defaults.

- Create: `tests/core/control-store.test.ts`
  Verify JSON persistence and pending-request lookup by source message.

- Create: `tests/core/control-router.test.ts`
  Verify request resolution, duplicate-signal handling, and run status updates.

- Create: `tests/core/control-sync.test.ts`
  Verify projection sync behavior, thread fallback, and no-op behavior for adapters without control support.

- Modify: `tests/core/gateway.test.ts`
  Cover callback registration and control-input routing alongside ordinary message routing.

- Create: `tests/adapters/discord/control-input-mapper.test.ts`
  Keep reaction/reply normalization deterministic without needing live Discord API calls.

- Modify: `tests/adapters/discord/index.test.ts`
  Cover thread creation and control callback wiring.

- Modify: `package.json`
  Add `control:*` convenience scripts for Claude-side local tooling.

- Create: `scripts/control/upsert-run.ts`
  Write/update a run record from Claude hook payloads.

- Create: `scripts/control/request-control.ts`
  Create a pending `ControlRequest` and move the run into `waiting_control`.

- Create: `scripts/control/poll-resolved-request.ts`
  Poll for the newest resolved signal for a request and return a machine-readable result to hooks/skills.

- Modify: `README.md`
  Document the control layer, local scripts, and Discord thread/reaction behavior.

### Task 1: Add Control Types, Config, and JSON Persistence

**Files:**
- Create: `src/core/control-store.ts`
- Modify: `src/core/types.ts`
- Modify: `src/config/gateway-config.ts`
- Modify: `config/gateway.json`
- Test: `tests/core/control-store.test.ts`
- Test: `tests/config/gateway-config.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ControlStore } from '../../src/core/control-store';
import { AgentRun, ChannelProjection, ControlRequest, ControlSignal } from '../../src/core/types';

describe('ControlStore', () => {
  it('persists runs, requests, signals, and projections', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'control-store-'));
    const store = new ControlStore(baseDir);
    const run: AgentRun = {
      id: 'run-1',
      sessionId: 'session-1',
      title: 'Architect subagent',
      status: 'running',
      createdAt: new Date('2026-03-31T00:00:00.000Z'),
      updatedAt: new Date('2026-03-31T00:00:00.000Z')
    };
    const request: ControlRequest = {
      id: 'request-1',
      runId: 'run-1',
      kind: 'approval',
      status: 'pending',
      summary: 'Approve the architecture plan',
      requestedAt: new Date('2026-03-31T00:01:00.000Z'),
      sourceMessage: {
        channelType: 'discord',
        channelId: 'channel-1',
        messageId: 'message-1',
        threadId: 'thread-1'
      }
    };
    const signal: ControlSignal = {
      id: 'signal-1',
      requestId: 'request-1',
      runId: 'run-1',
      signal: 'approve',
      actor: {
        channelType: 'discord',
        userId: 'user-1'
      },
      source: {
        channelType: 'discord',
        channelId: 'channel-1',
        messageId: 'message-1',
        threadId: 'thread-1',
        interactionType: 'reaction',
        rawValue: '👍'
      },
      createdAt: new Date('2026-03-31T00:02:00.000Z')
    };
    const projection: ChannelProjection = {
      runId: 'run-1',
      channelType: 'discord',
      channelId: 'channel-1',
      threadId: 'thread-1',
      rootMessageId: 'root-1',
      lastStatusMessageId: 'message-1',
      title: 'Architect subagent',
      updatedAt: new Date('2026-03-31T00:03:00.000Z')
    };

    store.saveRun(run);
    store.saveRequest(request);
    store.saveSignal(signal);
    store.saveProjection(projection);

    expect(store.getRun('run-1')?.title).toBe('Architect subagent');
    expect(store.findPendingRequestBySourceMessage('discord', 'message-1')?.id).toBe('request-1');
    expect(store.getLatestSignalForRequest('request-1')?.signal).toBe('approve');
    expect(store.getProjection('discord', 'run-1')?.threadId).toBe('thread-1');
  });
});
```

```ts
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { loadGatewayConfig } from '../../src/config/gateway-config';

describe('loadGatewayConfig', () => {
  test('applies control defaults for omitted configuration fields', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'gateway-config-'));
    const configDir = join(tempDir, 'config');
    const configPath = join(configDir, 'gateway.json');

    try {
      await mkdir(configDir, { recursive: true });
      await writeFile(
        configPath,
        JSON.stringify(
          {
            name: 'Agent Gateway',
            version: '1.0.0',
            enabledAdapters: ['discord']
          },
          null,
          2
        ),
        'utf8'
      );

      const config = loadGatewayConfig(configPath);

      expect(config.control.enabled).toBe(true);
      expect(config.control.baseDir).toBe('data/control');
      expect(config.control.syncIntervalMs).toBe(2000);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/control-store.test.ts tests/config/gateway-config.test.ts`

Expected: FAIL with errors such as `Cannot find module '../../src/core/control-store'` and `Property 'control' does not exist on type 'GatewayConfig'`.

- [ ] **Step 3: Write the minimal implementation**

`src/core/types.ts`

```ts
export type AgentRunStatus = 'running' | 'waiting_control' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type ControlRequestKind = 'approval' | 'decision' | 'input';
export type ControlRequestStatus = 'pending' | 'resolved' | 'expired' | 'cancelled';
export type ControlSignalName = 'approve' | 'reject' | 'hold' | 'adjust' | 'resume';
export type ChannelControlInputKind = 'reaction' | 'reply' | 'command' | 'button';

export interface SourceMessageRef {
  channelType: string;
  channelId: string;
  messageId: string;
  threadId?: string;
}

export interface AgentRun {
  id: string;
  parentRunId?: string;
  sessionId: string;
  role?: string;
  title: string;
  status: AgentRunStatus;
  channelBinding?: {
    channelType: string;
    channelId: string;
    threadId?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface ControlRequest {
  id: string;
  runId: string;
  kind: ControlRequestKind;
  status: ControlRequestStatus;
  summary: string;
  details?: string;
  requestedAt: Date;
  resolvedAt?: Date;
  sourceMessage?: SourceMessageRef;
}

export interface ControlSignal {
  id: string;
  requestId: string;
  runId: string;
  signal: ControlSignalName;
  comment?: string;
  actor: {
    channelType: string;
    userId: string;
    username?: string;
  };
  source: {
    channelType: string;
    channelId: string;
    messageId: string;
    threadId?: string;
    interactionType: ChannelControlInputKind;
    rawValue: string;
  };
  createdAt: Date;
}

export interface ChannelProjection {
  runId: string;
  channelType: string;
  channelId: string;
  threadId?: string;
  rootMessageId?: string;
  lastStatusMessageId?: string;
  title: string;
  updatedAt: Date;
}

export interface ChannelControlInput {
  channelType: string;
  channelId: string;
  messageId: string;
  threadId?: string;
  signal: ControlSignalName;
  comment?: string;
  userId: string;
  username?: string;
  interactionType: ChannelControlInputKind;
  rawValue: string;
  timestamp: Date;
}
```

`src/core/control-store.ts`

```ts
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentRun, ChannelProjection, ControlRequest, ControlSignal } from './types';

function serializeDateRecord<T extends Record<string, unknown>>(value: T): string {
  return JSON.stringify(
    value,
    (_key, current) => (current instanceof Date ? current.toISOString() : current),
    2
  );
}

function deserializeRun(raw: string): AgentRun {
  const parsed = JSON.parse(raw);
  return { ...parsed, createdAt: new Date(parsed.createdAt), updatedAt: new Date(parsed.updatedAt) };
}

function deserializeRequest(raw: string): ControlRequest {
  const parsed = JSON.parse(raw);
  return {
    ...parsed,
    requestedAt: new Date(parsed.requestedAt),
    resolvedAt: parsed.resolvedAt ? new Date(parsed.resolvedAt) : undefined
  };
}

function deserializeSignal(raw: string): ControlSignal {
  const parsed = JSON.parse(raw);
  return {
    ...parsed,
    createdAt: new Date(parsed.createdAt)
  };
}

function deserializeProjection(raw: string): ChannelProjection {
  const parsed = JSON.parse(raw);
  return {
    ...parsed,
    updatedAt: new Date(parsed.updatedAt)
  };
}

export class ControlStore {
  constructor(private readonly baseDir: string) {}

  saveRun(run: AgentRun): void {
    this.write('runs', run.id, serializeDateRecord(run));
  }

  getRun(runId: string): AgentRun | null {
    return this.read('runs', runId, deserializeRun);
  }

  saveRequest(request: ControlRequest): void {
    this.write('requests', request.id, serializeDateRecord(request));
  }

  getRequest(requestId: string): ControlRequest | null {
    return this.read('requests', requestId, deserializeRequest);
  }

  listRequests(): ControlRequest[] {
    return this.list('requests', deserializeRequest);
  }

  findPendingRequestBySourceMessage(channelType: string, messageId: string): ControlRequest | null {
    return (
      this.listRequests().find(
        (request) =>
          request.status === 'pending' &&
          request.sourceMessage?.channelType === channelType &&
          request.sourceMessage?.messageId === messageId
      ) ?? null
    );
  }

  saveSignal(signal: ControlSignal): void {
    this.write('signals', signal.id, serializeDateRecord(signal));
  }

  saveProjection(projection: ChannelProjection): void {
    this.write('projections', `${projection.channelType}-${projection.runId}`, serializeDateRecord(projection));
  }

  getProjection(channelType: string, runId: string): ChannelProjection | null {
    return this.read('projections', `${channelType}-${runId}`, deserializeProjection);
  }

  private write(group: string, id: string, content: string): void {
    const dir = join(this.baseDir, group);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}.json`), content);
  }

  private read<T>(group: string, id: string, deserialize: (raw: string) => T): T | null {
    try {
      return deserialize(readFileSync(join(this.baseDir, group, `${id}.json`), 'utf8'));
    } catch {
      return null;
    }
  }

  private list<T>(group: string, deserialize: (raw: string) => T): T[] {
    try {
      return readdirSync(join(this.baseDir, group)).map((file) =>
        deserialize(readFileSync(join(this.baseDir, group, file), 'utf8'))
      );
    } catch {
      return [];
    }
  }
}
```

`src/config/gateway-config.ts`

```ts
  control: z
    .object({
      enabled: z.boolean().default(true),
      baseDir: z.string().default('data/control'),
      syncIntervalMs: z.number().int().positive().default(2000)
    })
    .default({
      enabled: true,
      baseDir: 'data/control',
      syncIntervalMs: 2000
    }),
```

`config/gateway.json`

```json
  "control": {
    "enabled": true,
    "baseDir": "data/control",
    "syncIntervalMs": 2000
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/control-store.test.ts tests/config/gateway-config.test.ts`

Expected: PASS with 2 test files green.

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/core/control-store.ts src/config/gateway-config.ts config/gateway.json tests/core/control-store.test.ts tests/config/gateway-config.test.ts
git commit -m "feat: add control state types and persistence"
```

### Task 2: Add Control Resolution Logic

**Files:**
- Create: `src/core/control-router.ts`
- Modify: `src/core/control-store.ts`
- Test: `tests/core/control-router.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ControlStore } from '../../src/core/control-store';
import { ControlRouter } from '../../src/core/control-router';

describe('ControlRouter', () => {
  it('resolves a pending request into a saved control signal and resumes the run', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'control-router-'));
    const store = new ControlStore(baseDir);
    const router = new ControlRouter(store, () => new Date('2026-03-31T01:00:00.000Z'));

    store.saveRun({
      id: 'run-1',
      sessionId: 'session-1',
      title: 'Architect subagent',
      status: 'waiting_control',
      createdAt: new Date('2026-03-31T00:55:00.000Z'),
      updatedAt: new Date('2026-03-31T00:55:00.000Z')
    });
    store.saveRequest({
      id: 'request-1',
      runId: 'run-1',
      kind: 'approval',
      status: 'pending',
      summary: 'Approve the architecture plan',
      requestedAt: new Date('2026-03-31T00:59:00.000Z'),
      sourceMessage: {
        channelType: 'discord',
        channelId: 'channel-1',
        messageId: 'message-1'
      }
    });

    const result = router.resolve({
      channelType: 'discord',
      channelId: 'channel-1',
      messageId: 'message-1',
      signal: 'approve',
      userId: 'user-1',
      interactionType: 'reaction',
      rawValue: '👍',
      timestamp: new Date('2026-03-31T01:00:00.000Z')
    });

    expect(result?.signal.signal).toBe('approve');
    expect(result?.request.status).toBe('resolved');
    expect(result?.run.status).toBe('running');
  });

  it('marks hold signals as paused and keeps duplicate reactions idempotent', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'control-router-'));
    const store = new ControlStore(baseDir);
    const router = new ControlRouter(store, () => new Date('2026-03-31T01:10:00.000Z'));

    store.saveRun({
      id: 'run-2',
      sessionId: 'session-2',
      title: 'Tester subagent',
      status: 'waiting_control',
      createdAt: new Date('2026-03-31T01:05:00.000Z'),
      updatedAt: new Date('2026-03-31T01:05:00.000Z')
    });
    store.saveRequest({
      id: 'request-2',
      runId: 'run-2',
      kind: 'approval',
      status: 'pending',
      summary: 'Pause and wait',
      requestedAt: new Date('2026-03-31T01:09:00.000Z'),
      sourceMessage: {
        channelType: 'discord',
        channelId: 'channel-1',
        messageId: 'message-2'
      }
    });

    const first = router.resolve({
      channelType: 'discord',
      channelId: 'channel-1',
      messageId: 'message-2',
      signal: 'hold',
      userId: 'user-2',
      interactionType: 'reaction',
      rawValue: '👀',
      timestamp: new Date('2026-03-31T01:10:00.000Z')
    });
    const second = router.resolve({
      channelType: 'discord',
      channelId: 'channel-1',
      messageId: 'message-2',
      signal: 'hold',
      userId: 'user-2',
      interactionType: 'reaction',
      rawValue: '👀',
      timestamp: new Date('2026-03-31T01:11:00.000Z')
    });

    expect(first?.run.status).toBe('paused');
    expect(second).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/control-router.test.ts`

Expected: FAIL with `Cannot find module '../../src/core/control-router'`.

- [ ] **Step 3: Write the minimal implementation**

`src/core/control-store.ts`

```ts
  listSignalsForRequest(requestId: string): ControlSignal[] {
    return this.list('signals', (raw) => {
      const parsed = JSON.parse(raw);
      return {
        ...parsed,
        createdAt: new Date(parsed.createdAt)
      } as ControlSignal;
    }).filter((signal) => signal.requestId === requestId);
  }

  getLatestSignalForRequest(requestId: string): ControlSignal | null {
    return this.listSignalsForRequest(requestId).sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
    )[0] ?? null;
  }
```

`src/core/control-router.ts`

```ts
import { randomUUID } from 'node:crypto';
import { ControlStore } from './control-store';
import { AgentRun, ChannelControlInput, ControlRequest, ControlSignal } from './types';

export interface ControlResolution {
  run: AgentRun;
  request: ControlRequest;
  signal: ControlSignal;
}

export class ControlRouter {
  constructor(
    private readonly store: ControlStore,
    private readonly clock: () => Date = () => new Date()
  ) {}

  resolve(input: ChannelControlInput): ControlResolution | null {
    const request = this.store.findPendingRequestBySourceMessage(input.channelType, input.messageId);
    if (!request) {
      return null;
    }

    if (this.store.listSignalsForRequest(request.id).some((signal) => signal.actor.userId === input.userId)) {
      return null;
    }

    const run = this.store.getRun(request.runId);
    if (!run) {
      return null;
    }

    const signal: ControlSignal = {
      id: randomUUID(),
      requestId: request.id,
      runId: request.runId,
      signal: input.signal,
      comment: input.comment,
      actor: {
        channelType: input.channelType,
        userId: input.userId,
        username: input.username
      },
      source: {
        channelType: input.channelType,
        channelId: input.channelId,
        messageId: input.messageId,
        threadId: input.threadId,
        interactionType: input.interactionType,
        rawValue: input.rawValue
      },
      createdAt: this.clock()
    };

    const nextRun: AgentRun = {
      ...run,
      status:
        input.signal === 'reject'
          ? 'cancelled'
          : input.signal === 'hold'
            ? 'paused'
            : 'running',
      updatedAt: this.clock()
    };

    const nextRequest: ControlRequest = {
      ...request,
      status: 'resolved',
      resolvedAt: this.clock()
    };

    this.store.saveSignal(signal);
    this.store.saveRun(nextRun);
    this.store.saveRequest(nextRequest);

    return { run: nextRun, request: nextRequest, signal };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/control-router.test.ts`

Expected: PASS with `ControlRouter` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/core/control-store.ts src/core/control-router.ts tests/core/control-router.test.ts
git commit -m "feat: resolve control requests into normalized signals"
```

### Task 3: Add Projection Sync and Gateway Control Routing

**Files:**
- Create: `src/core/control-sync.ts`
- Modify: `src/core/adapter.ts`
- Modify: `src/core/gateway.ts`
- Modify: `src/index.ts`
- Test: `tests/core/control-sync.test.ts`
- Test: `tests/core/gateway.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ControlSync } from '../../src/core/control-sync';
import { ControlStore } from '../../src/core/control-store';

describe('ControlSync', () => {
  it('creates a thread once and upserts the pending control message for adapters with control support', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'control-sync-'));
    const store = new ControlStore(baseDir);
    const adapter = {
      type: 'discord',
      name: 'Discord',
      createThread: vi.fn().mockResolvedValue({ channelId: 'thread-1', messageId: 'root-1', success: true }),
      upsertControlMessage: vi.fn().mockResolvedValue({ messageId: 'status-1', success: true })
    };

    store.saveRun({
      id: 'run-1',
      sessionId: 'session-1',
      title: 'Architect subagent',
      status: 'waiting_control',
      channelBinding: {
        channelType: 'discord',
        channelId: 'channel-1'
      },
      createdAt: new Date('2026-03-31T01:30:00.000Z'),
      updatedAt: new Date('2026-03-31T01:30:00.000Z')
    });
    store.saveRequest({
      id: 'request-1',
      runId: 'run-1',
      kind: 'approval',
      status: 'pending',
      summary: 'Approve the plan',
      requestedAt: new Date('2026-03-31T01:31:00.000Z')
    });

    const sync = new ControlSync({ adapters: [adapter as never], controlStore: store, logger: console });
    await sync.syncOnce();

    expect(adapter.createThread).toHaveBeenCalled();
    expect(adapter.upsertControlMessage).toHaveBeenCalled();
    expect(store.getProjection('discord', 'run-1')?.threadId).toBe('thread-1');
  });
});
```

```ts
import { describe, expect, it, vi } from 'vitest';
import { AgentGateway } from '../../src/core/gateway';

describe('AgentGateway control routing', () => {
  it('registers control callbacks and routes a control input through the control router', async () => {
    const adapter = {
      type: 'discord',
      name: 'Discord',
      onMessage: vi.fn(),
      onControlInput: vi.fn(),
      send: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      initialize: vi.fn()
    };

    const controlRouter = { resolve: vi.fn().mockReturnValue(null) };
    const gateway = new AgentGateway({
      adapters: [adapter as never],
      commandHandler: {} as never,
      orchestrator: {} as never,
      controlRouter: controlRouter as never,
      controlSync: { start: vi.fn(), stop: vi.fn() } as never,
      logger: { info: vi.fn(), error: vi.fn() }
    });

    await gateway.start();

    expect(adapter.onControlInput).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/control-sync.test.ts tests/core/gateway.test.ts`

Expected: FAIL with missing `ControlSync` and `onControlInput`/`controlRouter` gateway wiring errors.

- [ ] **Step 3: Write the minimal implementation**

`src/core/adapter.ts`

```ts
import { AgentResponse, ChannelControlInput } from './types';

export interface ChannelAdapter {
  readonly name: string;
  readonly type: string;
  initialize(config: AdapterConfig): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(callback: (message: AgentMessage) => void): void;
  onControlInput?(callback: (input: ChannelControlInput) => void): void;
  send(channelId: string, response: AgentResponse): Promise<MessageResult>;
  createThread?(
    channelId: string,
    title: string
  ): Promise<MessageResult & { channelId: string }>;
  upsertControlMessage?(
    channelId: string,
    response: AgentResponse,
    messageId?: string
  ): Promise<MessageResult>;
  typing?(channelId: string): Promise<void>;
  react?(messageId: string, emoji: string): Promise<void>;
  edit?(messageId: string, response: AgentResponse): Promise<void>;
}
```

`src/core/control-sync.ts`

```ts
import { ChannelAdapter } from './adapter';
import { ControlStore } from './control-store';
import { AgentResponse, ChannelProjection, ControlRequest } from './types';

interface ControlSyncOptions {
  adapters: ChannelAdapter[];
  controlStore: ControlStore;
  logger: {
    info: (message: string, data?: unknown) => void;
    error: (message: string, data?: unknown) => void;
  };
  intervalMs?: number;
}

export class ControlSync {
  private timer?: NodeJS.Timeout;

  constructor(private readonly options: ControlSyncOptions) {}

  start(): void {
    this.timer = setInterval(() => void this.syncOnce(), this.options.intervalMs ?? 2000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async syncOnce(): Promise<void> {
    for (const adapter of this.options.adapters) {
      if (!adapter.upsertControlMessage) {
        continue;
      }

      const pending = this.options.controlStore.listRequests().filter((request) => request.status === 'pending');
      for (const request of pending) {
        const run = this.options.controlStore.getRun(request.runId);
        if (!run?.channelBinding || run.channelBinding.channelType !== adapter.type) {
          continue;
        }

        const existingProjection = this.options.controlStore.getProjection(adapter.type, run.id);
        const projection =
          existingProjection ??
          (await this.createProjection(adapter, run.channelBinding.channelId, run.title, run.id));
        const response: AgentResponse = {
          content: `Waiting for control: ${request.summary}`
        };
        const result = await adapter.upsertControlMessage(projection.threadId ?? projection.channelId, response, projection.lastStatusMessageId);

        this.options.controlStore.saveProjection({
          ...projection,
          lastStatusMessageId: result.messageId,
          updatedAt: new Date()
        });
        this.options.controlStore.saveRequest({
          ...request,
          sourceMessage: {
            channelType: adapter.type,
            channelId: projection.channelId,
            threadId: projection.threadId,
            messageId: result.messageId
          }
        });
      }
    }
  }

  private async createProjection(
    adapter: ChannelAdapter,
    channelId: string,
    title: string,
    runId: string
  ): Promise<ChannelProjection> {
    if (adapter.createThread) {
      const created = await adapter.createThread(channelId, title);
      return {
        runId,
        channelType: adapter.type,
        channelId,
        threadId: created.channelId,
        rootMessageId: created.messageId,
        title,
        updatedAt: new Date()
      };
    }

    return {
      runId,
      channelType: adapter.type,
      channelId,
      title,
      updatedAt: new Date()
    };
  }
}
```

`src/core/gateway.ts`

```ts
interface GatewayOptions {
  adapters: ChannelAdapter[];
  commandHandler: CommandHandler;
  orchestrator: SessionOrchestrator;
  controlRouter?: {
    resolve: (input: ChannelControlInput) => unknown;
  };
  controlSync?: {
    start: () => void;
    stop: () => void;
  };
  logger: {
    info: (message: string, data?: unknown) => void;
    error: (message: string, data?: unknown) => void;
  };
}

  async start(): Promise<void> {
    for (const adapter of this.options.adapters) {
      adapter.onMessage((message) => {
        void this.processIncomingMessage(adapter, message);
      });
      adapter.onControlInput?.((input) => {
        this.options.controlRouter?.resolve(input);
      });
      await adapter.connect();
    }
    this.options.controlSync?.start();
  }

  async stop(): Promise<void> {
    this.options.controlSync?.stop();
    await Promise.all(this.options.adapters.map((adapter) => adapter.disconnect()));
  }
```

`src/index.ts`

```ts
  const controlStore = new ControlStore(config.control.baseDir);
  const controlRouter = new ControlRouter(controlStore);
  const controlSync = new ControlSync({
    adapters: [adapter],
    controlStore,
    logger,
    intervalMs: config.control.syncIntervalMs
  });

  const gateway = new AgentGateway({
    adapters: [adapter],
    commandHandler,
    orchestrator,
    controlRouter,
    controlSync,
    logger
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/control-sync.test.ts tests/core/gateway.test.ts`

Expected: PASS with new control-routing coverage green.

- [ ] **Step 5: Commit**

```bash
git add src/core/adapter.ts src/core/control-sync.ts src/core/gateway.ts src/index.ts tests/core/control-sync.test.ts tests/core/gateway.test.ts
git commit -m "feat: route and project control state through the gateway"
```

### Task 4: Add Discord Thread Projection and Control Input Mapping

**Files:**
- Create: `src/adapters/discord/control-input-mapper.ts`
- Modify: `src/adapters/discord/index.ts`
- Test: `tests/adapters/discord/control-input-mapper.test.ts`
- Test: `tests/adapters/discord/index.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { fromDiscordReaction, fromDiscordReply } from '../../../src/adapters/discord/control-input-mapper';

describe('Discord control input mapper', () => {
  it('maps reactions to normalized control input signals', () => {
    const input = fromDiscordReaction({
      emoji: { name: '👍' },
      messageId: 'message-1',
      channelId: 'channel-1',
      threadId: 'thread-1',
      userId: 'user-1',
      username: 'alice',
      createdAt: new Date('2026-03-31T02:00:00.000Z')
    });

    expect(input).toMatchObject({
      signal: 'approve',
      interactionType: 'reaction',
      rawValue: '👍'
    });
  });

  it('maps reply text to an adjust signal when instructions are included', () => {
    const input = fromDiscordReply({
      id: 'reply-1',
      channelId: 'channel-1',
      threadId: 'thread-1',
      userId: 'user-2',
      username: 'bob',
      content: '继续，但先补测试',
      replyTo: 'message-2',
      createdAt: new Date('2026-03-31T02:01:00.000Z')
    });

    expect(input).toMatchObject({
      messageId: 'message-2',
      signal: 'adjust',
      comment: '继续，但先补测试'
    });
  });
});
```

```ts
import { describe, expect, it, vi } from 'vitest';
import { DiscordAdapter } from '../../../src/adapters/discord';

describe('DiscordAdapter control support', () => {
  it('registers reaction and reply listeners during initialize', async () => {
    const on = vi.fn();
    const adapter = new DiscordAdapter({
      on,
      login: vi.fn(),
      destroy: vi.fn(),
      channels: { fetch: vi.fn() }
    } as never);

    await adapter.initialize({ enabled: true, token: 'token' });

    expect(on).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/adapters/discord/control-input-mapper.test.ts tests/adapters/discord/index.test.ts`

Expected: FAIL with missing mapper module and missing Discord control support methods.

- [ ] **Step 3: Write the minimal implementation**

`src/adapters/discord/control-input-mapper.ts`

```ts
import { ChannelControlInput } from '../../core/types';

export function fromDiscordReaction(input: {
  emoji: { name: string | null };
  messageId: string;
  channelId: string;
  threadId?: string;
  userId: string;
  username?: string;
  createdAt: Date;
}): ChannelControlInput | null {
  const signal =
    input.emoji.name === '👍'
      ? 'approve'
      : input.emoji.name === '👎'
        ? 'reject'
        : input.emoji.name === '👀'
          ? 'hold'
          : null;

  if (!signal) {
    return null;
  }

  return {
    channelType: 'discord',
    channelId: input.channelId,
    messageId: input.messageId,
    threadId: input.threadId,
    signal,
    userId: input.userId,
    username: input.username,
    interactionType: 'reaction',
    rawValue: input.emoji.name ?? '',
    timestamp: input.createdAt
  };
}

export function fromDiscordReply(input: {
  id: string;
  channelId: string;
  threadId?: string;
  userId: string;
  username?: string;
  content: string;
  replyTo: string;
  createdAt: Date;
}): ChannelControlInput {
  const signal = /但|先|不要|改成/.test(input.content) ? 'adjust' : 'resume';
  return {
    channelType: 'discord',
    channelId: input.channelId,
    messageId: input.replyTo,
    threadId: input.threadId,
    signal,
    comment: input.content,
    userId: input.userId,
    username: input.username,
    interactionType: 'reply',
    rawValue: input.content,
    timestamp: input.createdAt
  };
}
```

`src/adapters/discord/index.ts`

```ts
import { Events } from 'discord.js';
import { fromDiscordReaction, fromDiscordReply } from './control-input-mapper';

  private controlCallback?: (input: ChannelControlInput) => void;

  async initialize(config: DiscordAdapterConfig): Promise<void> {
    this.config = config;

    this.client.on(Events.MessageCreate, (message) => {
      if (message.author.bot) {
        return;
      }

      if (message.reference?.messageId && this.controlCallback) {
        this.controlCallback(
          fromDiscordReply({
            id: message.id,
            channelId: message.channelId,
            threadId: message.channel?.isThread?.() ? message.channelId : undefined,
            userId: message.author.id,
            username: message.author.username,
            content: message.content,
            replyTo: message.reference.messageId,
            createdAt: message.createdAt
          })
        );
        return;
      }

      if (this.callback) {
        this.callback(
          fromDiscordMessage({
            id: message.id,
            channelId: message.channelId,
            author: { id: message.author.id, bot: message.author.bot },
            content: message.content,
            createdAt: message.createdAt
          })
        );
      }
    });

    this.client.on(Events.MessageReactionAdd, (reaction, user) => {
      if (user.bot || !this.controlCallback) {
        return;
      }

      const input = fromDiscordReaction({
        emoji: { name: reaction.emoji.name },
        messageId: reaction.message.id,
        channelId: reaction.message.channelId,
        threadId: reaction.message.channel.isThread() ? reaction.message.channelId : undefined,
        userId: user.id,
        username: 'discord-user',
        createdAt: new Date()
      });

      if (input) {
        this.controlCallback(input);
      }
    });
  }

  onControlInput(callback: (input: ChannelControlInput) => void): void {
    this.controlCallback = callback;
  }

  async createThread(channelId: string, title: string): Promise<MessageResult & { channelId: string }> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !('threads' in channel)) {
      return { channelId, messageId: '', success: false, error: `Channel ${channelId} cannot create threads.` };
    }

    const thread = await channel.threads.create({ name: title, autoArchiveDuration: 1440 });
    return { channelId: thread.id, messageId: '', success: true };
  }

  async upsertControlMessage(channelId: string, response: AgentResponse, messageId?: string): Promise<MessageResult> {
    if (messageId && this.edit) {
      await this.edit(messageId, response);
      return { messageId, success: true };
    }

    return this.send(channelId, response);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/adapters/discord/control-input-mapper.test.ts tests/adapters/discord/index.test.ts`

Expected: PASS with mapper and adapter coverage green.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/discord/control-input-mapper.ts src/adapters/discord/index.ts tests/adapters/discord/control-input-mapper.test.ts tests/adapters/discord/index.test.ts
git commit -m "feat: map discord reactions and replies into control input"
```

### Task 5: Add Claude-Side Bridge Scripts and Local Tooling

**Files:**
- Create: `scripts/control/upsert-run.ts`
- Create: `scripts/control/request-control.ts`
- Create: `scripts/control/poll-resolved-request.ts`
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Write the failing smoke tests as executable commands**

Create a scratch directory and plan to run these commands after implementation:

```bash
npx tsx scripts/control/upsert-run.ts --base-dir /tmp/control-demo --run-id run-1 --session-id session-1 --title "Architect" --status running
npx tsx scripts/control/request-control.ts --base-dir /tmp/control-demo --request-id request-1 --run-id run-1 --summary "Approve the plan"
npx tsx scripts/control/poll-resolved-request.ts --base-dir /tmp/control-demo --request-id request-1 --timeout-ms 10
```

Expected before implementation: each command fails with `Cannot find module`.

- [ ] **Step 2: Run the commands to verify they fail**

Run:

```bash
npx tsx scripts/control/upsert-run.ts --base-dir /tmp/control-demo --run-id run-1 --session-id session-1 --title "Architect" --status running
```

Expected: FAIL with `Cannot find module './upsert-run.ts'`.

- [ ] **Step 3: Write the minimal implementation**

`scripts/control/upsert-run.ts`

```ts
import { ControlStore } from '../../src/core/control-store';

const args = new Map(
  process.argv.slice(2).reduce<string[][]>((entries, value, index, list) => {
    if (value.startsWith('--')) {
      entries.push([value.slice(2), list[index + 1]]);
    }
    return entries;
  }, [])
);

const store = new ControlStore(args.get('base-dir') ?? 'data/control');
const now = new Date();

store.saveRun({
  id: args.get('run-id') ?? '',
  sessionId: args.get('session-id') ?? '',
  title: args.get('title') ?? '',
  status: (args.get('status') as 'running' | 'waiting_control' | 'paused' | 'completed' | 'failed' | 'cancelled') ?? 'running',
  createdAt: now,
  updatedAt: now
});

console.log(JSON.stringify({ ok: true, runId: args.get('run-id') }, null, 2));
```

`scripts/control/request-control.ts`

```ts
import { ControlStore } from '../../src/core/control-store';

const args = new Map(
  process.argv.slice(2).reduce<string[][]>((entries, value, index, list) => {
    if (value.startsWith('--')) {
      entries.push([value.slice(2), list[index + 1]]);
    }
    return entries;
  }, [])
);

const store = new ControlStore(args.get('base-dir') ?? 'data/control');
const now = new Date();
const run = store.getRun(args.get('run-id') ?? '');

if (!run) {
  throw new Error(`Unknown run: ${args.get('run-id')}`);
}

store.saveRun({ ...run, status: 'waiting_control', updatedAt: now });
store.saveRequest({
  id: args.get('request-id') ?? '',
  runId: run.id,
  kind: 'approval',
  status: 'pending',
  summary: args.get('summary') ?? '',
  requestedAt: now
});

console.log(JSON.stringify({ ok: true, requestId: args.get('request-id') }, null, 2));
```

`scripts/control/poll-resolved-request.ts`

```ts
import { ControlStore } from '../../src/core/control-store';

const args = new Map(
  process.argv.slice(2).reduce<string[][]>((entries, value, index, list) => {
    if (value.startsWith('--')) {
      entries.push([value.slice(2), list[index + 1]]);
    }
    return entries;
  }, [])
);

const store = new ControlStore(args.get('base-dir') ?? 'data/control');
const timeoutMs = Number(args.get('timeout-ms') ?? '30000');
const requestId = args.get('request-id') ?? '';
const start = Date.now();

async function main(): Promise<void> {
  while (Date.now() - start < timeoutMs) {
    const request = store.getRequest(requestId);
    if (request?.status === 'resolved') {
      const signal = store.getLatestSignalForRequest(requestId);
      console.log(JSON.stringify({ ok: true, requestId, signal: signal?.signal, comment: signal?.comment }, null, 2));
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  console.log(JSON.stringify({ ok: false, requestId, reason: 'timeout' }, null, 2));
  process.exitCode = 1;
}

void main();
```

`package.json`

```json
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest watch",
    "control:upsert-run": "tsx scripts/control/upsert-run.ts",
    "control:request": "tsx scripts/control/request-control.ts",
    "control:poll": "tsx scripts/control/poll-resolved-request.ts"
  },
```

`README.md`

```md
## Control Layer

The gateway now keeps a second state path for subagent display and operator control.

- Normal chat messages still route into Claude sessions.
- Control requests are stored under `data/control/`.
- Discord threads can display subagent progress and pending approval prompts.
- Claude-side hooks/skills can use:
  - `npm run control:upsert-run -- --base-dir data/control ...`
  - `npm run control:request -- --base-dir data/control ...`
  - `npm run control:poll -- --base-dir data/control ...`
```

- [ ] **Step 4: Run the smoke commands to verify they pass**

Run:

```bash
npx tsx scripts/control/upsert-run.ts --base-dir /tmp/control-demo --run-id run-1 --session-id session-1 --title "Architect" --status running
npx tsx scripts/control/request-control.ts --base-dir /tmp/control-demo --request-id request-1 --run-id run-1 --summary "Approve the plan"
npx tsx scripts/control/poll-resolved-request.ts --base-dir /tmp/control-demo --request-id request-1 --timeout-ms 10
```

Expected:

- first command prints `{"ok":true,"runId":"run-1"}`
- second command prints `{"ok":true,"requestId":"request-1"}`
- third command exits non-zero with `{"ok":false,"requestId":"request-1","reason":"timeout"}`

- [ ] **Step 5: Commit**

```bash
git add scripts/control/upsert-run.ts scripts/control/request-control.ts scripts/control/poll-resolved-request.ts package.json README.md
git commit -m "feat: add local control bridge scripts"
```

### Task 6: Run Full Verification and Document Cross-Flow Behavior

**Files:**
- Modify: `tests/core/gateway.test.ts`
- Modify: `tests/adapters/discord/index.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Add regression tests for mixed chat and control traffic**

```ts
it('keeps normal chat routing intact while also accepting control input', async () => {
  const adapter = {
    type: 'discord',
    name: 'Discord',
    onMessage: vi.fn(),
    onControlInput: vi.fn(),
    send: vi.fn().mockResolvedValue({ messageId: '1', success: true }),
    connect: vi.fn(),
    disconnect: vi.fn(),
    initialize: vi.fn()
  };
  const orchestrator = {
    getOrCreateSession: vi.fn().mockReturnValue({ id: 'session-1' }),
    execute: vi.fn().mockResolvedValue({ content: 'Claude response' })
  };
  const controlRouter = { resolve: vi.fn().mockReturnValue(null) };

  const gateway = new AgentGateway({
    adapters: [adapter as never],
    commandHandler: { executeFromMessage: vi.fn().mockResolvedValue({ success: true, message: 'Done.' }) } as never,
    orchestrator: orchestrator as never,
    controlRouter: controlRouter as never,
    controlSync: { start: vi.fn(), stop: vi.fn() } as never,
    logger: { info: vi.fn(), error: vi.fn() }
  });

  await gateway.handleMessage(
    adapter as never,
    {
      id: 'msg-1',
      channelId: 'channel-1',
      channelType: 'discord',
      userId: 'user-1',
      content: 'normal chat',
      timestamp: new Date('2026-03-31T03:00:00.000Z')
    }
  );

  expect(orchestrator.execute).toHaveBeenCalledTimes(1);
  expect(controlRouter.resolve).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the targeted regression suite**

Run: `npx vitest run tests/core/control-store.test.ts tests/core/control-router.test.ts tests/core/control-sync.test.ts tests/core/gateway.test.ts tests/adapters/discord/control-input-mapper.test.ts tests/adapters/discord/index.test.ts`

Expected: all six files PASS.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`

Expected: PASS across the full repository with no regressions in session, command, worker, or adapter tests.

- [ ] **Step 4: Update README language for channel-agnostic control semantics**

```md
- Control semantics are channel-agnostic: adapters normalize reactions, replies, buttons, or commands into the same control signal names.
- Discord is the first implementation, but other adapters can emit the same `approve`, `reject`, `hold`, `adjust`, and `resume` meanings.
```

- [ ] **Step 5: Commit**

```bash
git add tests/core/gateway.test.ts tests/adapters/discord/index.test.ts README.md
git commit -m "test: verify mixed chat and control flows"
```
