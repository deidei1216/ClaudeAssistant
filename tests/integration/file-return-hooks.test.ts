import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveArtifacts } from '../../skills/file-return/scripts/resolve-artifacts';
import { packageArtifacts } from '../../skills/file-return/scripts/package-artifacts';

describe('file return skill scripts', () => {
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

  it('packages multiple related artifacts into a single zip deliverable', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-package-'));
    const result = await packageArtifacts({
      cwd: workingDirectory,
      files: ['exports/one.html', 'exports/two.html'],
      outputName: 'exports/site-bundle.zip'
    });

    expect(result).toEqual({
      outputPath: 'exports/site-bundle.zip'
    });
    expect(readFileSync(join(workingDirectory, 'exports', 'site-bundle.zip'), 'utf8')).toContain('exports/one.html');
  });
});
