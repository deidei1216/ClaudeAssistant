# Explicit Delivery Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace implicit artifact guessing with an explicit publish-and-return flow so Discord file delivery only sends content that Claude has deliberately published.

**Architecture:** Keep `uploads/` as read-only source input, keep `workspace/` as Claude's free-form work area, and introduce `workspace/.deliveries/` plus a manifest as the only delivery boundary. Session scaffolding and `CLAUDE.md` teach the rule, scripts update delivery state deterministically, the Stop hook consumes manifest state, and the gateway only sends published artifacts.

**Tech Stack:** TypeScript, Node.js fs/path APIs, Vitest, Claude CLI Stop hooks, Discord gateway adapter

---

## File Structure

Planned units and responsibilities:

- Create: `core/delivery-paths.ts`
  - Canonical helpers for `.deliveries/` paths, manifest path, and delivery boundary checks.
- Create: `core/session-claude-md.ts`
  - Builds the session-level `CLAUDE.md` content that explains source/workspace/publish rules.
- Create: `scripts/delivery/publish-file.ts`
  - Deterministically publish a single file into `.deliveries/` and update manifest.
- Create: `scripts/delivery/publish-dir.ts`
  - Deterministically publish a directory into `.deliveries/` and update manifest.
- Create: `scripts/delivery/package-delivery.ts`
  - Package a published directory into an archive and update manifest.
- Create: `skills/file-return/lib/delivery-manifest.ts`
  - Read/write/validate the delivery manifest for hooks and scripts.
- Modify: `core/orchestrator.ts`
  - Ensure session scaffold includes `.deliveries/` and session-level `CLAUDE.md`.
- Modify: `core/session-store.ts`
  - Ensure persisted sessions maintain the new scaffold shape.
- Modify: `core/attachments.ts`
  - Restrict outbound attachments to published delivery paths.
- Modify: `core/gateway.ts`
  - Stop relying on outbound recent-files for artifact discovery and only mirror published attachments.
- Modify: `core/recent-files.ts`
  - Narrow file memory to inbound inputs and published outbound artifacts.
- Modify: `core/worker.ts`
  - Remove workspace-wide artifact detection and stop treating arbitrary referenced files as delivery candidates.
- Modify: `skills/file-return/file-return-stop.ts`
  - Resolve handoff exclusively from `.deliveries/manifest.json`.
- Modify: `skills/file-return/lib/resolve-artifacts.ts`
  - Re-scope to manifest-driven selection or delete if no longer needed.
- Modify: `skills/file-return/SKILL.md`
  - Explain the explicit publish contract and script usage.
- Modify: `CLAUDE.md`
  - Add repo-level explanation of the delivery boundary model.
- Modify: `tests/core/orchestrator.test.ts`
  - Cover session scaffold and `CLAUDE.md` generation.
- Modify: `tests/core/session-store.test.ts`
  - Cover persisted scaffold directories and manifest-safe paths.
- Modify: `tests/core/attachments.test.ts`
  - Cover "only published artifacts can be attached".
- Modify: `tests/core/gateway.test.ts`
  - Cover published outbound files and rejection of unpublished files.
- Modify: `tests/core/recent-files.test.ts`
  - Cover narrowed memory semantics.
- Modify: `tests/core/worker.test.ts`
  - Remove tests that assert workspace scanning and add tests that assert no implicit artifact memory.
- Modify: `tests/integration/file-return-hooks.test.ts`
  - Rewrite around manifest-driven delivery, deleting transcript/session-root fallback cases.
- Modify: `tests/e2e/file-return-stop-hook-script.test.ts`
  - Exercise the publish -> hook -> marker path.

### Task 1: Establish The Delivery Boundary Contract

**Files:**
- Create: `core/delivery-paths.ts`
- Create: `core/session-claude-md.ts`
- Modify: `core/orchestrator.ts`
- Modify: `core/session-store.ts`
- Modify: `CLAUDE.md`
- Test: `tests/core/orchestrator.test.ts`
- Test: `tests/core/session-store.test.ts`

- [ ] **Step 1: Write the failing scaffold tests**

```ts
it('creates a .deliveries scaffold and session CLAUDE contract for new sessions', () => {
  const session = orchestrator.getOrCreateSession('channel-1', 'discord');

  expect(existsSync(join(baseDir, session.id, 'workspace', '.deliveries'))).toBe(true);
  expect(existsSync(join(baseDir, session.id, 'workspace', '.deliveries', 'manifest.json'))).toBe(true);

  const sessionClaudeMd = readFileSync(join(baseDir, session.id, 'CLAUDE.md'), 'utf8');
  expect(sessionClaudeMd).toContain('uploads/ is a read-only source directory');
  expect(sessionClaudeMd).toContain('workspace/.deliveries/ is the only delivery boundary');
  expect(sessionClaudeMd).toContain('publish a file or directory before returning it');
});

it('creates session delivery scaffold when saving a session directly', () => {
  store.save({
    ...sessionFixture,
    workingDirectory: join(baseDir, sessionFixture.id, 'workspace')
  });

  expect(existsSync(join(baseDir, sessionFixture.id, 'workspace', '.deliveries'))).toBe(true);
  expect(existsSync(join(baseDir, sessionFixture.id, 'workspace', '.deliveries', 'manifest.json'))).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/core/orchestrator.test.ts tests/core/session-store.test.ts`

Expected: FAIL with missing `.deliveries` scaffold and missing `CLAUDE.md` contract assertions.

- [ ] **Step 3: Add canonical delivery path helpers**

```ts
// core/delivery-paths.ts
import { join, relative, resolve, sep } from 'node:path';

export function resolveSessionRoot(workingDirectory: string): string {
  return resolve(workingDirectory, '..');
}

export function resolveDeliveriesRoot(workingDirectory: string): string {
  return join(resolve(workingDirectory), '.deliveries');
}

export function resolveDeliveryManifestPath(workingDirectory: string): string {
  return join(resolveDeliveriesRoot(workingDirectory), 'manifest.json');
}

export function isInsideDeliveriesRoot(workingDirectory: string, candidatePath: string): boolean {
  const deliveriesRoot = resolveDeliveriesRoot(workingDirectory);
  const absoluteCandidatePath = resolve(candidatePath);
  return absoluteCandidatePath === deliveriesRoot || absoluteCandidatePath.startsWith(`${deliveriesRoot}${sep}`);
}

export function toDeliveryRelativePath(workingDirectory: string, absolutePath: string): string {
  return relative(resolve(workingDirectory), resolve(absolutePath)).replace(/\\/g, '/');
}
```

- [ ] **Step 4: Generate the session `CLAUDE.md` contract**

```ts
// core/session-claude-md.ts
export function buildSessionClaudeMd(): string {
  return [
    '# Session Workspace Contract',
    '',
    '- `uploads/` is a read-only source directory for user-provided files.',
    '- `workspace/` is your free-form work area.',
    '- Only content published into `workspace/.deliveries/` is allowed to be returned to the user.',
    '- If a task should return a file or directory, call the publish script first.',
    '- If a task should return multiple files, publish a directory or package it before returning.',
    '- Do not return files directly from `uploads/`, the session root, or arbitrary workspace paths.'
  ].join('\\n');
}
```

- [ ] **Step 5: Wire the new scaffold into orchestrator and session store**

```ts
// core/orchestrator.ts (inside ensureSessionScaffold)
mkdirSync(join(sessionDir, 'workspace', '.deliveries'), { recursive: true });

const manifestPath = join(sessionDir, 'workspace', '.deliveries', 'manifest.json');
if (!existsSync(manifestPath)) {
  writeFileSync(manifestPath, JSON.stringify({ version: 1, entries: [], primary: null }, null, 2));
}

if (!existsSync(claudeMdPath)) {
  writeFileSync(claudeMdPath, buildSessionClaudeMd());
}
```

```ts
// core/session-store.ts (inside save)
mkdirSync(join(session.workingDirectory, '.deliveries'), { recursive: true });
```

- [ ] **Step 6: Update repo-level `CLAUDE.md` to describe the model**

```md
## File Delivery Contract

- `sessions/<sessionId>/uploads/` stores user-provided source files.
- `sessions/<sessionId>/workspace/` is Claude's working area.
- `sessions/<sessionId>/workspace/.deliveries/` is the only valid delivery boundary.
- Hooks and gateway code must only return content that has been explicitly published into `.deliveries/`.
```

- [ ] **Step 7: Run tests to verify the scaffold passes**

Run: `npm test -- tests/core/orchestrator.test.ts tests/core/session-store.test.ts`

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add CLAUDE.md core/delivery-paths.ts core/session-claude-md.ts core/orchestrator.ts core/session-store.ts tests/core/orchestrator.test.ts tests/core/session-store.test.ts
git commit -m "feat: add explicit delivery session scaffold"
```

### Task 2: Add Explicit Publish Scripts And Manifest Support

**Files:**
- Create: `skills/file-return/lib/delivery-manifest.ts`
- Create: `scripts/delivery/publish-file.ts`
- Create: `scripts/delivery/publish-dir.ts`
- Create: `scripts/delivery/package-delivery.ts`
- Modify: `skills/file-return/SKILL.md`
- Test: `tests/integration/file-return-hooks.test.ts`
- Test: `tests/e2e/file-return-stop-hook-script.test.ts`

- [ ] **Step 1: Write the failing manifest and publish tests**

```ts
it('publishes a single file into workspace/.deliveries and marks it primary', async () => {
  writeFileSync(join(workspaceDir, 'result.png'), 'png bytes');

  await publishFile({
    cwd: workspaceDir,
    source: 'result.png',
    displayName: 'avatar.png',
    primary: true
  });

  expect(existsSync(join(workspaceDir, '.deliveries', 'avatar.png'))).toBe(true);
  expect(readManifest(workspaceDir)).toEqual({
    version: 1,
    primary: 'avatar.png',
    entries: [
      { kind: 'file', path: 'avatar.png', sourcePath: 'result.png', packaged: false }
    ]
  });
});

it('publishes a directory as a delivery entry without scanning the workspace', async () => {
  mkdirSync(join(workspaceDir, 'exports'), { recursive: true });
  writeFileSync(join(workspaceDir, 'exports', 'one.html'), '<html>one</html>');

  await publishDir({
    cwd: workspaceDir,
    source: 'exports',
    name: 'site'
  });

  expect(existsSync(join(workspaceDir, '.deliveries', 'site', 'one.html'))).toBe(true);
  expect(readManifest(workspaceDir).entries[0]).toEqual(
    expect.objectContaining({ kind: 'directory', path: 'site', sourcePath: 'exports' })
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/integration/file-return-hooks.test.ts tests/e2e/file-return-stop-hook-script.test.ts`

Expected: FAIL with missing manifest helpers and missing publish scripts.

- [ ] **Step 3: Implement manifest helpers**

```ts
// skills/file-return/lib/delivery-manifest.ts
export interface DeliveryManifestEntry {
  kind: 'file' | 'directory' | 'archive';
  path: string;
  sourcePath: string;
  packaged: boolean;
}

export interface DeliveryManifest {
  version: 1;
  primary: string | null;
  entries: DeliveryManifestEntry[];
}

export function readDeliveryManifest(workingDirectory: string): DeliveryManifest {
  const manifestPath = resolveDeliveryManifestPath(workingDirectory);
  if (!existsSync(manifestPath)) {
    return { version: 1, primary: null, entries: [] };
  }
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as DeliveryManifest;
}

export function writeDeliveryManifest(workingDirectory: string, manifest: DeliveryManifest): void {
  mkdirSync(resolveDeliveriesRoot(workingDirectory), { recursive: true });
  writeFileSync(resolveDeliveryManifestPath(workingDirectory), JSON.stringify(manifest, null, 2));
}
```

- [ ] **Step 4: Implement the publish scripts**

```ts
// scripts/delivery/publish-file.ts
const absoluteSource = resolve(cwd, source);
const targetPath = join(resolveDeliveriesRoot(cwd), displayName ?? basename(absoluteSource));
copyFileSync(absoluteSource, targetPath);

const manifest = readDeliveryManifest(cwd);
manifest.entries = [
  ...manifest.entries.filter((entry) => entry.path !== basename(targetPath)),
  { kind: 'file', path: basename(targetPath), sourcePath: source, packaged: false }
];
if (primary) manifest.primary = basename(targetPath);
writeDeliveryManifest(cwd, manifest);
```

```ts
// scripts/delivery/publish-dir.ts
cpSync(resolve(cwd, source), join(resolveDeliveriesRoot(cwd), name), { recursive: true });
manifest.entries = [
  ...manifest.entries.filter((entry) => entry.path !== name),
  { kind: 'directory', path: name, sourcePath: source, packaged: false }
];
```

```ts
// scripts/delivery/package-delivery.ts
const archivePath = join(resolveDeliveriesRoot(cwd), outputName);
await packageArtifacts({
  cwd: resolveDeliveriesRoot(cwd),
  files: [sourcePath],
  outputName
});
manifest.entries = [
  ...manifest.entries.filter((entry) => entry.path !== outputName),
  { kind: 'archive', path: outputName, sourcePath, packaged: true }
];
manifest.primary = outputName;
```

- [ ] **Step 5: Update the skill contract**

```md
## Publish Rule

- Work freely inside `workspace/`.
- When a task should return a file, call `scripts/delivery/publish-file.ts`.
- When a task should return a folder of outputs, call `scripts/delivery/publish-dir.ts`.
- When a folder should be returned as one artifact, call `scripts/delivery/package-delivery.ts`.
- The Stop hook only looks at `workspace/.deliveries/manifest.json`.
```

- [ ] **Step 6: Run tests to verify publish behavior passes**

Run: `npm test -- tests/integration/file-return-hooks.test.ts tests/e2e/file-return-stop-hook-script.test.ts`

Expected: PASS for manifest reads and publish flows

- [ ] **Step 7: Commit**

```bash
git add skills/file-return/SKILL.md skills/file-return/lib/delivery-manifest.ts scripts/delivery/publish-file.ts scripts/delivery/publish-dir.ts scripts/delivery/package-delivery.ts tests/integration/file-return-hooks.test.ts tests/e2e/file-return-stop-hook-script.test.ts
git commit -m "feat: add explicit delivery publish scripts"
```

### Task 3: Make The Stop Hook Manifest-Driven

**Files:**
- Modify: `skills/file-return/file-return-stop.ts`
- Modify: `skills/file-return/lib/resolve-artifacts.ts`
- Delete or stop using: `skills/file-return/lib/discover-transcript-artifact.ts`
- Delete or stop using: `skills/file-return/lib/gateway-contract.ts`
- Test: `tests/integration/file-return-hooks.test.ts`
- Test: `tests/e2e/file-return-stop-hook-script.test.ts`

- [ ] **Step 1: Write the failing hook tests for manifest-only delivery**

```ts
it('blocks stop and points Claude at the primary published artifact', async () => {
  writeDeliveryManifest(workspaceDir, {
    version: 1,
    primary: 'avatar.png',
    entries: [{ kind: 'file', path: 'avatar.png', sourcePath: 'result.png', packaged: false }]
  });
  writeFileSync(join(workspaceDir, '.deliveries', 'avatar.png'), 'png bytes');

  const result = await runFileReturnStopHook({
    cwd: workspaceDir,
    transcript_path: join(workspaceDir, 'transcript.jsonl'),
    hook_event_name: 'Stop',
    stop_hook_active: false,
    last_assistant_message: '裁剪好了。'
  });

  expect(result).toEqual({
    decision: 'block',
    reason: expect.stringContaining('[[file:.deliveries/avatar.png]]')
  });
});

it('does not guess artifacts from transcript text when manifest is empty', async () => {
  const result = await runFileReturnStopHook({
    cwd: workspaceDir,
    transcript_path: transcriptPathWithGeneratedFileMentions,
    hook_event_name: 'Stop',
    stop_hook_active: false,
    last_assistant_message: '裁剪好了。'
  });

  expect(result).toEqual({});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/integration/file-return-hooks.test.ts tests/e2e/file-return-stop-hook-script.test.ts`

Expected: FAIL because the hook still uses recent-files and transcript guessing.

- [ ] **Step 3: Replace implicit artifact resolution with manifest reads**

```ts
// skills/file-return/file-return-stop.ts
const manifest = readDeliveryManifest(input.cwd);
if (!manifest.primary) {
  return {};
}

const primaryEntry = manifest.entries.find((entry) => entry.path === manifest.primary);
if (!primaryEntry) {
  return {};
}

return {
  decision: 'block',
  reason: `If this turn should deliver the prepared artifact, add [[file:.deliveries/${primaryEntry.path}]] on its own line in your final answer before stopping.`
};
```

- [ ] **Step 4: Collapse or delete now-obsolete resolution helpers**

```ts
// skills/file-return/lib/resolve-artifacts.ts
export function resolvePrimaryDeliveryPath(workingDirectory: string): string | null {
  const manifest = readDeliveryManifest(workingDirectory);
  return manifest.primary ? `.deliveries/${manifest.primary}` : null;
}
```

Delete usage of transcript parsing and recent-files path guessing from the Stop hook path. Remove dead helpers once tests are green.

- [ ] **Step 5: Run hook tests to verify manifest-driven behavior**

Run: `npm test -- tests/integration/file-return-hooks.test.ts tests/e2e/file-return-stop-hook-script.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add skills/file-return/file-return-stop.ts skills/file-return/lib/resolve-artifacts.ts tests/integration/file-return-hooks.test.ts tests/e2e/file-return-stop-hook-script.test.ts
git commit -m "refactor: drive file return hook from published deliveries"
```

### Task 4: Restrict Gateway And Attachments To Published Outputs

**Files:**
- Modify: `core/attachments.ts`
- Modify: `core/gateway.ts`
- Modify: `core/recent-files.ts`
- Modify: `core/worker.ts`
- Modify: `core/types.ts`
- Test: `tests/core/attachments.test.ts`
- Test: `tests/core/gateway.test.ts`
- Test: `tests/core/recent-files.test.ts`
- Test: `tests/core/worker.test.ts`

- [ ] **Step 1: Write the failing boundary-enforcement tests**

```ts
it('rejects outbound markers that reference unpublished workspace files', () => {
  writeFileSync(join(workspaceDir, 'draft.png'), 'png bytes');

  expect(resolveOutboundAttachment(workspaceDir, 'draft.png')).toEqual({
    ok: false,
    reason: 'Path is outside the published deliveries boundary'
  });
});

it('accepts outbound markers that reference workspace/.deliveries files', () => {
  mkdirSync(join(workspaceDir, '.deliveries'), { recursive: true });
  writeFileSync(join(workspaceDir, '.deliveries', 'avatar.png'), 'png bytes');

  expect(resolveOutboundAttachment(workspaceDir, '.deliveries/avatar.png')).toEqual({
    ok: true,
    relativePath: '.deliveries/avatar.png',
    absolutePath: join(workspaceDir, '.deliveries', 'avatar.png')
  });
});

it('does not record workspace_detected outputs from arbitrary content mentions', async () => {
  const response = await worker.execute(session, {
    ...message,
    content: '请看 result.png'
  });

  expect(response.metadata?.recentFileCandidates).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/core/attachments.test.ts tests/core/gateway.test.ts tests/core/recent-files.test.ts tests/core/worker.test.ts`

Expected: FAIL because outbound resolution still accepts arbitrary paths and worker still scans workspace outputs.

- [ ] **Step 3: Restrict outbound attachment resolution**

```ts
// core/attachments.ts
const deliveriesRoot = resolveDeliveriesRoot(workingDirectory);
const absolutePath = resolve(deliveriesRoot, relativePath.replace(/^\.deliveries\//, ''));

if (!isInsideDeliveriesRoot(workingDirectory, absolutePath)) {
  return { ok: false, reason: 'Path is outside the published deliveries boundary' };
}

return {
  ok: true,
  relativePath: toDeliveryRelativePath(workingDirectory, absolutePath),
  absolutePath
};
```

- [ ] **Step 4: Remove workspace scanning from worker and narrow recent-file semantics**

```ts
// core/worker.ts
return {
  content,
  attachments: attachments.length > 0 ? attachments : undefined,
  replyTo
};
```

```ts
// core/recent-files.ts
if (
  input.source === 'workspace_detected' &&
  !isInsideDeliveriesRoot(workingDirectory, absolutePath)
) {
  throw new Error(`Recent file is outside the deliveries boundary: ${absolutePath}`);
}
```

Only keep recent-file memory for:

- inbound source files
- successfully sent published artifacts

- [ ] **Step 5: Mirror only published outbound files in the gateway**

```ts
// core/gateway.ts
if (sendResult.success && response.attachments?.length) {
  const outboundRecentFiles = this.toRecentFiles(
    session.workingDirectory,
    response.attachments,
    'claude_outbound',
    new Date()
  );
  // No workspace-detected fallback registration here.
}
```

- [ ] **Step 6: Run core boundary tests to verify they pass**

Run: `npm test -- tests/core/attachments.test.ts tests/core/gateway.test.ts tests/core/recent-files.test.ts tests/core/worker.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add core/attachments.ts core/gateway.ts core/recent-files.ts core/types.ts core/worker.ts tests/core/attachments.test.ts tests/core/gateway.test.ts tests/core/recent-files.test.ts tests/core/worker.test.ts
git commit -m "refactor: enforce explicit delivery boundary"
```

### Task 5: Remove Legacy Guessing Paths And Verify End-To-End

**Files:**
- Modify: `skills/file-return/lib/gateway-contract.ts`
- Delete or empty: `skills/file-return/lib/discover-transcript-artifact.ts`
- Modify: `tests/integration/file-return-hooks.test.ts`
- Modify: `tests/e2e/file-return-stop-hook-script.test.ts`
- Modify: `docs/superpowers/specs/2026-04-03-explicit-delivery-boundary-design.md`

- [ ] **Step 1: Write the failing regression cleanup tests**

```ts
it('ignores transcript-only file mentions when nothing was published', async () => {
  writeFileSync(join(workspaceDir, 'result.png'), 'png bytes');
  writeTranscript(workspaceDir, [{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '已保存到 result.png' }] } }]);

  const result = await runFileReturnStopHook({
    cwd: workspaceDir,
    transcript_path: transcriptPath,
    hook_event_name: 'Stop',
    stop_hook_active: false,
    last_assistant_message: '已完成。'
  });

  expect(result).toEqual({});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/integration/file-return-hooks.test.ts tests/e2e/file-return-stop-hook-script.test.ts`

Expected: FAIL until all transcript and fallback paths are removed.

- [ ] **Step 3: Delete or neuter legacy guessing helpers**

```ts
// skills/file-return/lib/gateway-contract.ts
export function loadRecentFileCandidates(): never[] {
  return [];
}
```

Then remove all remaining imports/usages tied to transcript guessing, session-root fallbacks, uploads fallbacks, and workspace-wide candidate inference.

- [ ] **Step 4: Update the design doc with implementation status notes**

```md
## Implementation Notes

- The implementation now treats `.deliveries/manifest.json` as the only hook-facing artifact source.
- Transcript guessing and session-root fallback logic have been removed.
- Gateway attachment delivery is restricted to explicitly published artifacts.
```

- [ ] **Step 5: Run the full verification suite**

Run: `npm test -- tests/core/orchestrator.test.ts tests/core/session-store.test.ts tests/core/attachments.test.ts tests/core/gateway.test.ts tests/core/recent-files.test.ts tests/core/worker.test.ts tests/integration/file-return-hooks.test.ts tests/e2e/file-return-stop-hook-script.test.ts`

Expected: PASS

Run: `npm run test:e2e:file-return -- --attempts 1`

Expected:

```json
{
  "ok": true
}
```

Run: `npm run build`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-04-03-explicit-delivery-boundary-design.md skills/file-return/lib/gateway-contract.ts skills/file-return/lib/discover-transcript-artifact.ts tests/integration/file-return-hooks.test.ts tests/e2e/file-return-stop-hook-script.test.ts
git commit -m "chore: remove legacy file return guessing paths"
```

## Self-Review

### Spec Coverage

- Delivery boundary and core concepts map to Task 1 and Task 4.
- Session `CLAUDE.md` as the main behavior contract maps to Task 1.
- Publish scripts and explicit delivery state map to Task 2.
- Hook responsibility reduction maps to Task 3.
- Gateway-only safety enforcement maps to Task 4.
- Removal of transcript/session-root fallback logic maps to Task 5.

No spec section is intentionally left without an implementation task.

### Placeholder Scan

- No `TODO`, `TBD`, or "implement later" placeholders remain.
- Each task includes specific files, commands, and code blocks.
- Cleanup tasks explicitly name the old helpers to remove or neutralize.

### Type Consistency

- Delivery state is consistently described as `workspace/.deliveries/manifest.json`.
- The only delivery boundary referenced is `.deliveries/`.
- Publish entry kinds are consistently `file`, `directory`, and `archive`.

