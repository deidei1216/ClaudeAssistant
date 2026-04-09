---
name: file-return
description: Use when generated artifacts need the file-return contract to decide direct return, packaging, or skip.
---

# File Return Skill

## Overview

Use this skill as the contract for deciding how generated files should leave the workspace. Keep the focus on the return decision, not on prompt policy or runtime internals.

## When to Use

- A task produces files that may need to be returned to the user
- The result might be better as a direct file, a packaged bundle, or no return at all
- A hook, agent, or helper needs the shared file-return contract

## Runtime Entry

The runtime hook entrypoint is `skills/file-return/file-return-stop.ts`. It wires the skill contract into the Stop hook without redefining the policy in `CLAUDE.md`.
The Stop hook reads only manifest state. If the manifest primary is a directory, the hook packages that published entry into an archive before asking for a `[[file:...]]` marker.

## Publish Contract

- Work freely inside `workspace/`, but publish only the final delivery artifacts into `workspace/.deliveries/`.
- Treat `.deliveries/manifest.json` as the explicit handoff boundary for delivery state.
- Publish one file with `npx tsx scripts/delivery/publish-file.ts <source> [displayName]`.
- Publish one directory with `npx tsx scripts/delivery/publish-dir.ts <sourceDir> [name]`.
- Package a published delivery entry with `npx tsx scripts/delivery/package-delivery.ts <sourcePath> [outputName]`.
- Use `--primary` or `--no-primary` on the publish scripts when the manifest should or should not update the primary artifact.
- Keep scripts deterministic: they should copy or package the named source and update the manifest, not guess from the workspace.

## Extension Points

- Add or refine manifest helpers under `skills/file-return/lib/`
- Update packaging behavior when a new deliverable shape needs bundling
- Keep sharing metadata in sync with the explicit publish contract

## Files

- `skills/file-return/file-return-stop.ts`
- `skills/file-return/lib/contracts.ts`
- `skills/file-return/lib/delivery-manifest.ts`
- `skills/file-return/lib/package-artifacts.ts`
- `skills/file-return/lib/resolve-artifacts.ts`
- `scripts/delivery/publish-file.ts`
- `scripts/delivery/publish-dir.ts`
- `scripts/delivery/package-delivery.ts`
