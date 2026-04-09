import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

interface MaterializeRuntimeClaudeSettingsInput {
  sourcePath: string;
  outputPath: string;
  projectRoot: string;
}

export function materializeRuntimeClaudeSettings(
  input: MaterializeRuntimeClaudeSettingsInput
): void {
  const parsed = JSON.parse(readFileSync(input.sourcePath, 'utf8')) as unknown;
  const rewritten = rewriteProjectDirPlaceholders(parsed, input.projectRoot);

  mkdirSync(dirname(input.outputPath), { recursive: true });
  writeFileSync(input.outputPath, `${JSON.stringify(rewritten, null, 2)}\n`);
}

function rewriteProjectDirPlaceholders(value: unknown, projectRoot: string): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/\$CLAUDE_PROJECT_DIR\b/g, projectRoot)
      .replace(/\$\{CLAUDE_PROJECT_DIR\}/g, projectRoot);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => rewriteProjectDirPlaceholders(entry, projectRoot));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, rewriteProjectDirPlaceholders(entry, projectRoot)])
    );
  }

  return value;
}
