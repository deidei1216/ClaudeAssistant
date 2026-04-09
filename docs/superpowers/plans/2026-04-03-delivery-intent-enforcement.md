# Delivery Intent Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the explicit delivery workflow reliable by teaching Claude the exact publish commands and blocking silent `.deliveries/` misuse before a plain-text response escapes.

**Architecture:** Keep the existing `.deliveries/manifest.json` handoff model, but tighten the intent contract at two layers. Session `CLAUDE.md` becomes an executable protocol with exact publish/package commands, and the Stop hook detects orphaned files under `.deliveries/` when no publish state exists so it can fail closed with actionable guidance.

**Tech Stack:** TypeScript, Node.js fs/path APIs, Vitest, Claude CLI Stop hooks

---

### Task 1: Strengthen The Session Delivery Contract

**Files:**
- Modify: `core/session-claude-md.ts`
- Test: `tests/core/session-store.test.ts`

- [ ] **Step 1: Write the failing contract assertions**

```ts
it('exposes executable publish instructions in the session delivery contract', () => {
  const contract = buildSessionClaudeMd();

  expect(contract).toContain('Do not write files into workspace/.deliveries/ manually.');
  expect(contract).toContain('npx tsx scripts/delivery/publish-file.ts <source> [displayName]');
  expect(contract).toContain('npx tsx scripts/delivery/publish-dir.ts <sourceDir> [name]');
  expect(contract).toContain('npx tsx scripts/delivery/package-delivery.ts <sourcePath> [outputName]');
  expect(contract).toContain('Copying a file into workspace/.deliveries/ without updating the manifest does not count as publishing.');
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- tests/core/session-store.test.ts`
Expected: FAIL because the current session contract is principle-only and does not contain the exact publish/package commands or the no-manual-copy warning.

- [ ] **Step 3: Update the generated session contract text**

```ts
export function buildSessionClaudeMd(): string {
  return `# Session Contract

## File Delivery Contract

uploads/ is a read-only source directory for user-provided files.
workspace/ is your free-form work area.
Only content published into workspace/.deliveries/ is allowed to be returned to the user.
Do not write files into workspace/.deliveries/ manually.
Copying a file into workspace/.deliveries/ without updating the manifest does not count as publishing.
If a task should return one file, run: npx tsx scripts/delivery/publish-file.ts <source> [displayName]
If a task should return a directory, run: npx tsx scripts/delivery/publish-dir.ts <sourceDir> [name]
If a task should return multiple related files as an archive, run: npx tsx scripts/delivery/package-delivery.ts <sourcePath> [outputName]
If a task should return files, call the publish or package script before your final answer.
Do not return files directly from uploads/, the session root, or arbitrary workspace paths.
`;
}
```

- [ ] **Step 4: Re-run the session contract test**

Run: `npm test -- tests/core/session-store.test.ts`
Expected: PASS

### Task 2: Fail Closed On Orphaned `.deliveries` Files

**Files:**
- Modify: `skills/file-return/file-return-stop.ts`
- Modify: `skills/file-return/lib/resolve-artifacts.ts`
- Test: `tests/integration/file-return-hooks.test.ts`

- [ ] **Step 1: Write the failing hook regression**

```ts
it('blocks when deliveries contains files but no published delivery state exists', async () => {
  const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-stop-hook-'));
  mkdirSync(join(workingDirectory, '.deliveries'), { recursive: true });
  writeFileSync(join(workingDirectory, '.deliveries', 'avatar_cropped.png'), 'png bytes');

  const result = await runFileReturnStopHook({
    session_id: 'session-1',
    cwd: workingDirectory,
    hook_event_name: 'Stop',
    stop_hook_active: false,
    last_assistant_message: '已经裁剪好了。'
  });

  expect(result).toEqual({
    decision: 'block',
    reason: expect.stringContaining('Do not write files into workspace/.deliveries/ manually.')
  });
});
```

- [ ] **Step 2: Run the focused hook suite to verify it fails**

Run: `npm test -- tests/integration/file-return-hooks.test.ts`
Expected: FAIL because the current hook returns `{}` when manifest state is empty even if `.deliveries/` already contains files.

- [ ] **Step 3: Implement orphaned-delivery detection and hook guidance**

```ts
const resolved = await resolveArtifacts({ cwd: input.cwd });
if (resolved.mode === 'orphaned_delivery') {
  return {
    decision: 'block',
    reason:
      'Files exist in workspace/.deliveries/ but no published delivery intent was recorded. ' +
      'Do not write files into workspace/.deliveries/ manually. ' +
      'If this turn should return a file, use publish-file/publish-dir/package-delivery before stopping.'
  };
}
```

```ts
if (!manifest.primary && deliveriesContainsUserFiles(input.cwd)) {
  return { mode: 'orphaned_delivery', files: [] };
}
```

- [ ] **Step 4: Re-run the hook suite**

Run: `npm test -- tests/integration/file-return-hooks.test.ts`
Expected: PASS

- [ ] **Step 5: Run the end-to-end verification for this slice**

Run: `npm test -- tests/core/session-store.test.ts tests/integration/file-return-hooks.test.ts tests/e2e/file-return-stop-hook-script.test.ts`
Expected: PASS

