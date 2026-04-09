import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { materializeRuntimeClaudeSettings } from '../../config/runtime-claude-settings';

describe('materializeRuntimeClaudeSettings', () => {
  it('writes a runtime settings file with CLAUDE_PROJECT_DIR expanded to the absolute project root', () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), 'runtime-claude-settings-'));
    const projectRoot = join(rootDirectory, 'project');
    const claudeDirectory = join(projectRoot, '.claude');
    mkdirSync(claudeDirectory, { recursive: true });
    const sourcePath = join(claudeDirectory, 'settings.json');
    const outputPath = join(rootDirectory, 'runtime-settings.json');

    writeFileSync(
      sourcePath,
      JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: 'command',
                  command: 'npx tsx "$CLAUDE_PROJECT_DIR"/skills/file-return/file-return-stop.ts'
                }
              ]
            }
          ]
        }
      })
    );

    materializeRuntimeClaudeSettings({
      sourcePath,
      outputPath,
      projectRoot
    });

    const parsed = JSON.parse(readFileSync(outputPath, 'utf8')) as {
      hooks?: {
        Stop?: Array<{
          hooks?: Array<{
            command?: string;
          }>;
        }>;
      };
    };

    expect(parsed.hooks?.Stop?.[0]?.hooks?.[0]?.command).toBe(
      `npx tsx "${projectRoot}"/skills/file-return/file-return-stop.ts`
    );
  });
});
