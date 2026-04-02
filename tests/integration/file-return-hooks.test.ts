import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFileReturnStopHook } from '../../skills/file-return/file-return-stop';
import { resolveArtifacts } from '../../skills/file-return/lib/resolve-artifacts';
import { packageArtifacts } from '../../skills/file-return/lib/package-artifacts';

describe('file return skill scripts', () => {
  function writeTranscript(workingDirectory: string, records: unknown[]): string {
    const transcriptPath = join(workingDirectory, 'transcript.jsonl');
    writeFileSync(transcriptPath, records.map((record) => JSON.stringify(record)).join('\n'));
    return transcriptPath;
  }

  it('keeps the file-return skill contract in the skill files and out of CLAUDE.md', () => {
    const claudeMd = readFileSync(join(process.cwd(), 'CLAUDE.md'), 'utf8');
    const skillMd = readFileSync(join(process.cwd(), 'skills', 'file-return', 'SKILL.md'), 'utf8');
    const openaiYaml = readFileSync(join(process.cwd(), 'skills', 'file-return', 'agents', 'openai.yaml'), 'utf8');

    expect(claudeMd).not.toContain('### File Return Protocol');
    expect(skillMd).toContain('---\nname: file-return\n');
    expect(skillMd).toContain('description: Use when');
    expect(skillMd).toContain('## Runtime Entry');
    expect(skillMd).toContain('file-return-stop.ts');
    expect(openaiYaml).toContain('display_name:');
    expect(openaiYaml).toContain('short_description:');
    expect(openaiYaml).toContain('default_prompt:');
  });

  it('registers the Stop hook from the file-return skill entrypoint', async () => {
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
    expect(settings.hooks?.Stop?.[0]?.hooks?.[0]?.command).toContain('skills/file-return/file-return-stop.ts');
  });

  it('executes the file-return skill entrypoint via tsx and returns JSON on stdout', async () => {
    const scriptPath = join(process.cwd(), 'skills', 'file-return', 'file-return-stop.ts');
    const result = spawnSync(
      'npx',
      [
        'tsx',
        scriptPath
      ],
      {
        input: JSON.stringify({
          cwd: process.cwd(),
          hook_event_name: 'Stop',
          stop_hook_active: true,
          last_assistant_message: '已经准备好了。'
        }),
        encoding: 'utf8'
      }
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('{}');
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
    mkdirSync(join(workingDirectory, 'exports'), { recursive: true });
    writeFileSync(join(workingDirectory, 'exports', 'one.html'), '<html>one</html>');
    writeFileSync(join(workingDirectory, 'exports', 'two.html'), '<html>two</html>');
    const result = await packageArtifacts({
      cwd: workingDirectory,
      files: ['exports/one.html', 'exports/two.html'],
      outputName: 'exports/site-bundle.zip'
    });

    expect(result).toEqual({
      outputPath: 'exports/site-bundle.zip'
    });

    const archivePath = join(workingDirectory, 'exports', 'site-bundle.zip');
    const integrity = spawnSync('unzip', ['-t', archivePath], { encoding: 'utf8' });
    const listing = spawnSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' });

    expect(integrity.status).toBe(0);
    expect(listing.status).toBe(0);
    expect(listing.stdout.trim().split('\n')).toEqual(['exports/one.html', 'exports/two.html']);
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

  it('ignores stale claude_outbound deliveries remembered in recent-files memory', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-stop-hook-'));
    mkdirSync(join(workingDirectory, '.claude-gateway', 'memory'), { recursive: true });
    writeFileSync(join(workingDirectory, 'old-delivery.zip'), 'zip bytes');
    writeFileSync(
      join(workingDirectory, '.claude-gateway', 'memory', 'recent-files.json'),
      JSON.stringify({
        recentFiles: [
          {
            id: 'claude_outbound:old-delivery.zip',
            displayName: 'old-delivery.zip',
            relativePath: 'old-delivery.zip',
            absolutePath: join(workingDirectory, 'old-delivery.zip'),
            source: 'claude_outbound',
            mediaType: 'application/zip',
            lastSeenAt: '2026-04-01T00:00:00.000Z',
            summary: 'old outbound bundle'
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
      last_assistant_message: '这轮没有生成新的文件。'
    });

    expect(result).toEqual({});
  });

  it('discovers a newly generated file from transcript tool results when recent-files only remembers inbound attachments', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-stop-hook-'));
    mkdirSync(join(workingDirectory, '.claude-gateway', 'memory'), { recursive: true });
    writeFileSync(join(workingDirectory, 'cropped-image.png'), 'png bytes');
    writeFileSync(
      join(workingDirectory, '.claude-gateway', 'memory', 'recent-files.json'),
      JSON.stringify({
        recentFiles: [
          {
            id: 'discord_inbound:att-1',
            displayName: 'image.png',
            relativePath: '.claude-gateway/inbox/channel-1/image.png',
            absolutePath: join(workingDirectory, '.claude-gateway', 'inbox', 'channel-1', 'image.png'),
            source: 'discord_inbound',
            mediaType: 'image/png',
            lastSeenAt: '2026-04-02T00:00:00.000Z',
            summary: 'inbound image'
          }
        ]
      })
    );
    const transcriptPath = writeTranscript(workingDirectory, [
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              tool_use_id: 'toolu_functions.Bash:1',
              type: 'tool_result',
              content: '图片尺寸: 152x191\n已保存到 cropped-image.png',
              is_error: false
            }
          ]
        }
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '裁剪完成！' }]
        }
      }
    ]);

    const result = await runFileReturnStopHook({
      session_id: 'session-1',
      transcript_path: transcriptPath,
      cwd: workingDirectory,
      permission_mode: 'auto',
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: '裁剪完成！'
    });

    expect(result).toEqual({
      decision: 'block',
      reason: expect.stringContaining('[[file:cropped-image.png]]')
    });
  });

  it('ignores older previous-turn tool results when the latest turn produced no file', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-stop-hook-'));
    mkdirSync(join(workingDirectory, '.claude-gateway', 'memory'), { recursive: true });
    writeFileSync(join(workingDirectory, 'older-turn.png'), 'png bytes');
    writeFileSync(
      join(workingDirectory, '.claude-gateway', 'memory', 'recent-files.json'),
      JSON.stringify({
        recentFiles: [
          {
            id: 'discord_inbound:att-1',
            displayName: 'image.png',
            relativePath: '.claude-gateway/inbox/channel-1/image.png',
            absolutePath: join(workingDirectory, '.claude-gateway', 'inbox', 'channel-1', 'image.png'),
            source: 'discord_inbound',
            mediaType: 'image/png',
            lastSeenAt: '2026-04-02T00:00:00.000Z',
            summary: 'inbound image'
          }
        ]
      })
    );
    const transcriptPath = writeTranscript(workingDirectory, [
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              tool_use_id: 'toolu_functions.Bash:1',
              type: 'tool_result',
              content: '已保存到 older-turn.png',
              is_error: false
            }
          ]
        }
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '上一轮已完成。' }]
        }
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              tool_use_id: 'toolu_functions.Bash:2',
              type: 'tool_result',
              content: '本轮只做了分析，没有生成文件。',
              is_error: false
            }
          ]
        }
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '这轮没有新文件。' }]
        }
      }
    ]);

    const result = await runFileReturnStopHook({
      session_id: 'session-1',
      transcript_path: transcriptPath,
      cwd: workingDirectory,
      permission_mode: 'auto',
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: '这轮没有新文件。'
    });

    expect(result).toEqual({});
  });

  it('ignores plain user text mentions of existing file paths', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-stop-hook-'));
    mkdirSync(join(workingDirectory, '.claude-gateway', 'memory'), { recursive: true });
    writeFileSync(join(workingDirectory, 'mentioned-only.png'), 'png bytes');
    writeFileSync(
      join(workingDirectory, '.claude-gateway', 'memory', 'recent-files.json'),
      JSON.stringify({
        recentFiles: [
          {
            id: 'discord_inbound:att-1',
            displayName: 'image.png',
            relativePath: '.claude-gateway/inbox/channel-1/image.png',
            absolutePath: join(workingDirectory, '.claude-gateway', 'inbox', 'channel-1', 'image.png'),
            source: 'discord_inbound',
            mediaType: 'image/png',
            lastSeenAt: '2026-04-02T00:00:00.000Z',
            summary: 'inbound image'
          }
        ]
      })
    );
    const transcriptPath = writeTranscript(workingDirectory, [
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: '请注意文件 mentioned-only.png 已经存在。' }]
        }
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '我只是提到它，没有生成它。' }]
        }
      }
    ]);

    const result = await runFileReturnStopHook({
      session_id: 'session-1',
      transcript_path: transcriptPath,
      cwd: workingDirectory,
      permission_mode: 'auto',
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: '我只是提到它，没有生成它。'
    });

    expect(result).toEqual({});
  });

  it('discovers a zip artifact from the latest tool result when recent-files memory is not enough', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-stop-hook-'));
    mkdirSync(join(workingDirectory, '.claude-gateway', 'memory'), { recursive: true });
    writeFileSync(join(workingDirectory, 'bundle.zip'), 'zip bytes');
    writeFileSync(
      join(workingDirectory, '.claude-gateway', 'memory', 'recent-files.json'),
      JSON.stringify({
        recentFiles: [
          {
            id: 'discord_inbound:att-1',
            displayName: 'image.png',
            relativePath: '.claude-gateway/inbox/channel-1/image.png',
            absolutePath: join(workingDirectory, '.claude-gateway', 'inbox', 'channel-1', 'image.png'),
            source: 'discord_inbound',
            mediaType: 'image/png',
            lastSeenAt: '2026-04-02T00:00:00.000Z',
            summary: 'inbound image'
          }
        ]
      })
    );
    const transcriptPath = writeTranscript(workingDirectory, [
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              tool_use_id: 'toolu_functions.Bash:3',
              type: 'tool_result',
              content: '打包完成，输出文件: bundle.zip',
              is_error: false
            }
          ]
        }
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '压缩包已经准备好了。' }]
        }
      }
    ]);

    const result = await runFileReturnStopHook({
      session_id: 'session-1',
      transcript_path: transcriptPath,
      cwd: workingDirectory,
      permission_mode: 'auto',
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: '压缩包已经准备好了。'
    });

    expect(result).toEqual({
      decision: 'block',
      reason: expect.stringContaining('[[file:bundle.zip]]')
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
