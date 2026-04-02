# File Return Skill

Use this skill when validated native Claude Code hook wiring decides artifact-return processing should run.

Responsibilities:

- inspect `.claude-gateway/memory/recent-files.json`
- resolve the likely deliverable for the current task
- choose direct return versus packaging
- prepare a bridge-ready output path for the gateway handoff

Implementation files live with this skill:

- `scripts/resolve-artifacts.ts`
- `scripts/package-artifacts.ts`
