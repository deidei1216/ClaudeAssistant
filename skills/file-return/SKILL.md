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

## Default Contract

- Inspect the current task context and recent file memory before choosing a delivery shape
- Prefer direct return for one clear artifact
- Prefer packaging when the deliverable is a related set of files
- Skip return when there is no new deliverable

## Extension Points

- Add or refine artifact discovery rules under `skills/file-return/lib/`
- Update packaging behavior when a new deliverable shape needs bundling
- Keep sharing metadata in sync with the skill contract

## Files

- `skills/file-return/file-return-stop.ts`
- `skills/file-return/lib/contracts.ts`
- `skills/file-return/lib/discover-transcript-artifact.ts`
- `skills/file-return/lib/gateway-contract.ts`
- `skills/file-return/lib/package-artifacts.ts`
- `skills/file-return/lib/resolve-artifacts.ts`
