import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFileReturnStopHook } from '../../src/hooks/file-return-stop';
import { resolveArtifacts } from '../../skills/file-return/scripts/resolve-artifacts';
import { packageArtifacts } from '../../skills/file-return/scripts/package-artifacts';

describe('file return skill scripts', () => {
  it('registers a native Stop hook in project settings', async () => {
    const settings = JSON.parse(readFileSync(join(process.cwd(), '.claude', 'settings.json'), 'utf8')) as {
      hooks?: {
        Stop?: Array<{
          hooks?: Array<{
            type?: string;
            command?: string;
          }>;
        }>;
      };
    };

    expect(settings.hooks?.Stop?.[0]?.hooks?.[0]).toEqual(
      expect.objectContaining({
        type: 'command'
      })
    );
    expect(settings.hooks?.Stop?.[0]?.hooks?.[0]?.command).toContain('src/hooks/file-return-stop.ts');
  });

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

  it('blocks stop once and asks Claude to emit a bridge marker for a direct deliverable', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-stop-hook-'));
    mkdirSync(join(workingDirectory, '.claude-gateway', 'memory'), { recursive: true });
    writeFileSync(
      join(workingDirectory, '.claude-gateway', 'memory', 'recent-files.json'),
      JSON.stringify({
        recentFiles: [
          {
            id: 'workspace:.claude-gateway/outbox/cropped-image.png',
            displayName: 'cropped-image.png',
            relativePath: '.claude-gateway/outbox/cropped-image.png',
            absolutePath: join(workingDirectory, '.claude-gateway', 'outbox', 'cropped-image.png'),
            source: 'workspace_detected',
            mediaType: 'image/png',
            lastSeenAt: '2026-04-02T00:00:00.000Z',
            summary: 'generated image'
          }
        ]
      })
    );

    const result = await runFileReturnStopHook({
      session_id: 'session-1',
      transcript_path: join(workingDirectory, '.claude', 'transcript.jsonl'),
      cwd: workingDirectory,
      permission_mode: 'auto',
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: '已经裁剪好了。'
    });

    expect(result).toEqual({
      decision: 'block',
      reason: expect.stringContaining('[[file:.claude-gateway/outbox/cropped-image.png]]')
    });
  });

  it('allows stop when Claude already emitted a bridge marker or the stop hook is already active', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-stop-hook-'));
    mkdirSync(join(workingDirectory, '.claude-gateway', 'memory'), { recursive: true });
    writeFileSync(
      join(workingDirectory, '.claude-gateway', 'memory', 'recent-files.json'),
      JSON.stringify({
        recentFiles: [
          {
            id: 'workspace:.claude-gateway/outbox/cropped-image.png',
            displayName: 'cropped-image.png',
            relativePath: '.claude-gateway/outbox/cropped-image.png',
            absolutePath: join(workingDirectory, '.claude-gateway', 'outbox', 'cropped-image.png'),
            source: 'workspace_detected',
            mediaType: 'image/png',
            lastSeenAt: '2026-04-02T00:00:00.000Z',
            summary: 'generated image'
          }
        ]
      })
    );

    const withMarker = await runFileReturnStopHook({
      session_id: 'session-1',
      transcript_path: join(workingDirectory, '.claude', 'transcript.jsonl'),
      cwd: workingDirectory,
      permission_mode: 'auto',
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: '已经裁剪好了。\n[[file:.claude-gateway/outbox/cropped-image.png]]'
    });
    const alreadyActive = await runFileReturnStopHook({
      session_id: 'session-1',
      transcript_path: join(workingDirectory, '.claude', 'transcript.jsonl'),
      cwd: workingDirectory,
      permission_mode: 'auto',
      hook_event_name: 'Stop',
      stop_hook_active: true,
      last_assistant_message: '已经裁剪好了。'
    });

    expect(withMarker).toEqual({});
    expect(alreadyActive).toEqual({});
  });
});
