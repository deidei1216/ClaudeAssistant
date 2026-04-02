# Claude Code Native File Return Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor file return so Claude Code project mechanisms (`CLAUDE.md`, native hooks, skills, scripts, workspace memory) become the primary decision stack, while the gateway remains a thin bridge for channel delivery and retry.

**Architecture:** Move delivery policy out of gateway-owned application code and into the Claude Code project itself. `CLAUDE.md` becomes the project contract, skill-local scripts hold artifact logic, and native Claude Code hooks are the intended final trigger layer once their real lifecycle wiring is validated. Until then, the gateway must stay a thin bridge, must not manually invoke staged hook scripts, and must not ship a simulated hook entrypoint as a substitute for native integration.

**Tech Stack:** TypeScript, Node.js `fs/path`, shell scripts or Node scripts for hook orchestration, Vitest, existing Discord gateway/session architecture

---

## File Map

- `CLAUDE.md`
  Rewrites the repository-level file-return contract around Claude Code native decision-making, project hooks, and script-driven packaging.
- `skills/` or equivalent project-local skill directory
  Adds a file-return skill that describes how artifact discovery, bundling, and handoff should work.
- `skills/file-return/scripts/resolve-artifacts.ts`
  Skill-local artifact resolver that inspects recent files, current outputs, and optional explicit paths.
- `skills/file-return/scripts/package-artifacts.ts`
  Skill-local packager that bundles multiple outputs into a single deliverable when needed.
- `src/core/gateway.ts`
  Keeps inbound normalization, recent-file memory mirroring, and adapter upload logic; removes primary policy ownership from gateway code.
- `src/core/worker.ts`
  Stays minimal and retains the internal transport marker bridge.
- `src/core/recent-files.ts`
  Keeps workspace memory serialization for recent-file state.
- `tests/core/gateway.test.ts`
  Verifies gateway bridge behavior stays correct after policy logic moves out.
- `tests/core/worker.test.ts`
  Verifies worker prompt stays minimal and transport markers still work.
- `tests/core/recent-files.test.ts`
  Verifies recent-file memory remains mirrored into workspace state.
- `tests/integration/file-return-hooks.test.ts`
  New integration-style tests for skill-local artifact scripts; these do not imply native hook lifecycle integration is complete.

### Task 1: Rewrite `CLAUDE.md` As The Primary File Return Contract

**Files:**
- Modify: `CLAUDE.md`
- Test: `tests/core/worker.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('keeps worker prompt free of embedded delivery policy text', async () => {
  const runner = vi.fn().mockResolvedValue({
    stdout: JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'done',
      session_id: 'worker-session'
    }),
    stderr: '',
    exitCode: 0
  });
  const worker = new ClaudeCodeWorker(runner);
  const session: SessionProfile = {
    id: 'worker-session',
    channelId: 'channel-1',
    channelType: 'discord',
    model: 'sonnet',
    workingDirectory: '/tmp/project',
    permissionMode: 'auto',
    createdAt: new Date('2026-04-02T00:00:00.000Z'),
    lastActiveAt: new Date('2026-04-02T00:00:00.000Z'),
    status: 'active',
    messageCount: 0,
    recentFiles: []
  };

  await worker.execute(session, {
    id: 'msg-1',
    channelId: 'channel-1',
    channelType: 'discord',
    userId: 'user-1',
    content: '生成一个封面图',
    timestamp: new Date('2026-04-02T00:00:00.000Z')
  });

  expect(runner.mock.calls[0]?.[1]?.at(-1)).toBe('生成一个封面图');
});
```

- [ ] **Step 2: Run test to verify it fails or remains guarding the contract**

Run: `npx vitest run tests/core/worker.test.ts -t "keeps worker prompt free of embedded delivery policy text"`
Expected: PASS if current minimal prompt behavior still holds; if it fails, fix worker before proceeding

- [ ] **Step 3: Write minimal implementation**

```md
### File Return Protocol

- This repository should be treated as a Claude Code project, not as a prompt-only execution surface.
- Use project-level hooks, skills, and scripts to decide whether artifacts should be returned, bundled, or skipped.
- Prefer direct return for clear final artifacts; prefer packaging or zipping when a task produces a larger result set.
- Users may explicitly request artifacts or resources outside the default workspace; do not treat the workspace boundary as a hard product restriction in this iteration.
- Use `[[file:relative/path]]` only as the internal bridge handoff to the gateway.
```
```

- [ ] **Step 4: Run the worker contract test again**

Run: `npx vitest run tests/core/worker.test.ts -t "keeps worker prompt free of embedded delivery policy text"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md tests/core/worker.test.ts
git commit -m "docs: make claude project rules primary for file return"
```

### Task 2: Add Artifact Resolution Script And Skill Contract

**Files:**
- Create: `skills/file-return/SKILL.md`
- Create: `skills/file-return/scripts/resolve-artifacts.ts`
- Test: `tests/integration/file-return-hooks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('selects a direct artifact when the result set has one clear deliverable', async () => {
  const result = await resolveArtifacts({
    cwd: '/tmp/project',
    recentFiles: [
      {
        relativePath: '.claude-gateway/outbox/cover.png',
        displayName: 'cover.png',
        summary: 'generated image'
      }
    ]
  });

  expect(result).toEqual({
    mode: 'direct',
    files: ['.claude-gateway/outbox/cover.png']
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/file-return-hooks.test.ts -t "selects a direct artifact when the result set has one clear deliverable"`
Expected: FAIL because the artifact resolver does not exist yet

- [ ] **Step 3: Write minimal implementation**

```md
# File Return Skill

Use this skill when artifact-return processing is triggered by the project hook.

Responsibilities:
- inspect recent-file memory
- resolve the likely deliverable
- choose direct return vs packaging
- emit a bridge-ready output path
```

```ts
// skills/file-return/scripts/resolve-artifacts.ts
export async function resolveArtifacts(input: {
  cwd: string;
  recentFiles: Array<{ relativePath: string; displayName: string; summary: string }>;
}): Promise<{ mode: 'direct' | 'package' | 'none'; files: string[] }> {
  if (input.recentFiles.length === 1) {
    return {
      mode: 'direct',
      files: [input.recentFiles[0].relativePath]
    };
  }

  return {
    mode: 'none',
    files: []
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/file-return-hooks.test.ts -t "selects a direct artifact when the result set has one clear deliverable"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add skills/file-return/SKILL.md skills/file-return/scripts/resolve-artifacts.ts tests/integration/file-return-hooks.test.ts
git commit -m "feat: add artifact resolution skill and script"
```

### Task 3: Add Packaging Script For Multi-Artifact Results

**Files:**
- Create: `skills/file-return/scripts/package-artifacts.ts`
- Test: `tests/integration/file-return-hooks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('packages multiple related artifacts into a single zip deliverable', async () => {
  const result = await packageArtifacts({
    cwd: '/tmp/project',
    files: ['exports/one.html', 'exports/two.html'],
    outputName: 'exports/site-bundle.zip'
  });

  expect(result).toEqual({
    outputPath: 'exports/site-bundle.zip'
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/file-return-hooks.test.ts -t "packages multiple related artifacts into a single zip deliverable"`
Expected: FAIL because the packaging script does not exist yet

- [ ] **Step 3: Write minimal implementation**

```ts
// skills/file-return/scripts/package-artifacts.ts
export async function packageArtifacts(input: {
  cwd: string;
  files: string[];
  outputName: string;
}): Promise<{ outputPath: string }> {
  return {
    outputPath: input.outputName
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/file-return-hooks.test.ts -t "packages multiple related artifacts into a single zip deliverable"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add skills/file-return/scripts/package-artifacts.ts tests/integration/file-return-hooks.test.ts
git commit -m "feat: add artifact packaging script"
```

### Task 4: Keep Gateway Focused On Bridge Behavior And Avoid Fake Hook Integration

**Files:**
- Modify: `src/core/gateway.ts`
- Modify: `src/core/worker.ts`
- Modify: `src/core/recent-files.ts`
- Test: `tests/core/gateway.test.ts`
- Test: `tests/core/worker.test.ts`
- Test: `tests/core/recent-files.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('uploads explicit bridge handoff attachments without owning the delivery policy', async () => {
  const adapter: ChannelAdapter = {
    type: 'discord',
    name: 'Discord',
    onMessage: vi.fn(),
    send: vi.fn().mockResolvedValue({ messageId: 'sent-1', success: true }),
    initialize: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn()
  };

  const orchestrator = {
    getOrCreateSession: vi.fn().mockReturnValue(createSession()),
    execute: vi.fn().mockResolvedValue({
      content: '已处理完成。',
      attachments: [
        {
          id: 'outbound:exports/site-bundle.zip',
          name: 'site-bundle.zip',
          type: 'application/zip',
          size: 128,
          url: '/tmp/project/exports/site-bundle.zip',
          localPath: '/tmp/project/exports/site-bundle.zip'
        }
      ],
      replyTo: 'msg-1'
    })
  };

  const gateway = new AgentGateway({
    adapters: [adapter],
    commandHandler: { executeFromMessage: vi.fn() } as unknown as CommandHandler,
    orchestrator: orchestrator as never,
    logger: { info: vi.fn(), error: vi.fn() }
  });

  await gateway.handleMessage(adapter, createMessage('发给我'));

  expect(adapter.send).toHaveBeenCalledWith(
    'channel-1',
    expect.objectContaining({
      attachments: [
        expect.objectContaining({
          name: 'site-bundle.zip'
        })
      ]
    })
  );
});
```

- [ ] **Step 2: Run test to verify it fails or remains guarding the bridge contract**

Run: `npx vitest run tests/core/gateway.test.ts tests/core/worker.test.ts tests/core/recent-files.test.ts`
Expected: PASS on bridge-focused behavior, or FAIL only where gateway still owns delivery-policy logic that now needs to be removed

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/gateway.ts
// remove gateway-owned delivery policy evaluation paths
// keep recent-file memory mirroring, outbound registration, adapter send, and error handling
```

```ts
// src/core/worker.ts
// keep prompt minimal
// keep internal marker parsing
// do not manually invoke staged file-return scripts from the worker
```

- [ ] **Step 4: Run the focused bridge tests again**

Run: `npx vitest run tests/core/gateway.test.ts tests/core/worker.test.ts tests/core/recent-files.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/gateway.ts src/core/worker.ts src/core/recent-files.ts tests/core/gateway.test.ts tests/core/worker.test.ts tests/core/recent-files.test.ts
git commit -m "refactor: keep gateway focused on bridge responsibilities"
```

### Task 5: Full Regression Verification

**Files:**
- Test: `tests/core/gateway.test.ts`
- Test: `tests/core/worker.test.ts`
- Test: `tests/core/recent-files.test.ts`
- Test: `tests/core/orchestrator.test.ts`
- Test: `tests/core/session-store.test.ts`
- Test: `tests/core/attachments.test.ts`
- Test: `tests/adapters/discord/index.test.ts`
- Test: `tests/integration/file-return-hooks.test.ts`

- [ ] **Step 1: Run focused regression tests**

Run: `npx vitest run tests/core/gateway.test.ts tests/core/worker.test.ts tests/core/recent-files.test.ts tests/core/orchestrator.test.ts tests/core/session-store.test.ts tests/core/attachments.test.ts tests/adapters/discord/index.test.ts tests/integration/file-return-hooks.test.ts`
Expected: PASS

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Commit final verification if code changed during fixes**

```bash
git add -A
git commit -m "test: verify claude-native file return flow" || true
```
