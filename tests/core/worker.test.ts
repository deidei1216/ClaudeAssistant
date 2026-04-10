import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeCodeWorker } from '../../core/worker';
import { AgentMessage, SessionProfile } from '../../core/types';

describe('ClaudeCodeWorker', () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    while (tempDirectories.length > 0) {
      const directory = tempDirectories.pop();
      if (directory) {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it('maps a session into the correct claude CLI invocation', async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'done',
        session_id: '9e0ef8e2-f9d7-4fb9-a261-4d35bc8b23eb'
      }),
      stderr: '',
      exitCode: 0
    });
    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: '9e0ef8e2-f9d7-4fb9-a261-4d35bc8b23eb',
      channelId: 'channel-1',
      channelType: 'discord',
      model: 'opus',
      workingDirectory: '/tmp/project',
      settingsPath: '.claude/settings.local.json',
      customSystemPrompt: 'Stay concise.',
      permissionMode: 'plan',
      allowedTools: ['Read', 'Edit'],
      deniedTools: ['Bash(rm:*)'],
      createdAt: new Date('2026-03-30T00:00:00.000Z'),
      lastActiveAt: new Date('2026-03-30T00:00:00.000Z'),
      status: 'active',
      messageCount: 1
    };
    const message: AgentMessage = {
      id: 'msg-1',
      channelId: 'channel-1',
      channelType: 'discord',
      userId: 'user-1',
      content: 'Summarize the latest commit.',
      timestamp: new Date('2026-03-30T00:00:00.000Z')
    };

    const response = await worker.execute(session, message);

    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0]?.[0]).toBe('claude');
    expect(runner.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([
        '--print',
        '--output-format',
        'json',
        '--resume',
        '9e0ef8e2-f9d7-4fb9-a261-4d35bc8b23eb',
        '--model',
        'opus',
        '--permission-mode',
        'plan',
        '--settings',
        '.claude/settings.local.json',
        '--allowedTools',
        'Read',
        'Edit',
        '--disallowedTools',
        'Bash(rm:*)',
        '--append-system-prompt',
        'Stay concise.'
      ])
    );
    expect(runner.mock.calls[0]?.[1]?.at(-1)).toContain('Summarize the latest commit.');
    expect(runner.mock.calls[0]?.[2]).toEqual({ cwd: '/tmp/project' });
    expect(response.content).toBe('done');
  });

  it('works with minimal session config (no optional fields)', async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'response',
        session_id: 'minimal-session-id'
      }),
      stderr: '',
      exitCode: 0
    });
    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: 'minimal-session-id',
      channelId: 'channel-2',
      channelType: 'slack',
      model: 'sonnet',
      workingDirectory: '/home/user/project',
      permissionMode: 'default',
      createdAt: new Date('2026-03-30T00:00:00.000Z'),
      lastActiveAt: new Date('2026-03-30T00:00:00.000Z'),
      status: 'active',
      messageCount: 0
    };
    const message: AgentMessage = {
      id: 'msg-2',
      channelId: 'channel-2',
      channelType: 'slack',
      userId: 'user-2',
      content: 'Hello',
      timestamp: new Date('2026-03-30T00:00:00.000Z')
    };

    const response = await worker.execute(session, message);

    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0]?.[0]).toBe('claude');
    expect(runner.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([
        '--print',
        '--output-format',
        'json',
        '--session-id',
        'minimal-session-id',
        '--model',
        'sonnet',
        '--permission-mode',
        'default'
      ])
    );
    expect(runner.mock.calls[0]?.[1]?.at(-1)).toContain('Hello');
    expect(runner.mock.calls[0]?.[2]).toEqual({ cwd: '/home/user/project' });
    expect(response.content).toBe('response');
    expect(response.replyTo).toBe('msg-2');
  });

  it('passes through a minimal prompt when the turn has no attachments', async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'done',
        session_id: 'worker-session'
      }),
      stderr: '',
      exitCode: 0
    });
    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: 'worker-session',
      channelId: 'channel-1',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory: '/tmp/project',
      permissionMode: 'auto',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      lastActiveAt: new Date('2026-04-01T00:00:00.000Z'),
      status: 'active',
      messageCount: 0,
    };

    const message: AgentMessage = {
      id: 'msg-1',
      channelId: 'channel-1',
      channelType: 'discord',
      userId: 'user-1',
      content: '帮我做一个 html 报告',
      timestamp: new Date('2026-04-01T00:00:00.000Z')
    };

    await worker.execute(session, message);

    const prompt = runner.mock.calls[0]?.[1]?.at(-1);

    expect(prompt).toBe(message.content);
    expect(prompt).not.toContain('Recent files in this session:');
  });

  it('keeps the prompt minimal even when session memory exists', async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'done',
        session_id: 'worker-session'
      }),
      stderr: '',
      exitCode: 0
    });
    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: 'worker-session',
      channelId: 'channel-1',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory: '/tmp/project',
      permissionMode: 'auto',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      lastActiveAt: new Date('2026-04-01T00:00:00.000Z'),
      status: 'active',
      messageCount: 0,
      recentFiles: [
        {
          id: 'file-1',
          displayName: 'report.html',
          relativePath: 'outputs/report.html',
          absolutePath: '/tmp/project/outputs/report.html',
          source: 'claude_outbound',
          mediaType: 'text/html',
          lastSeenAt: new Date('2026-04-01T00:00:00.000Z'),
          summary: 'last sent html'
        }
      ]
    };

    const message: AgentMessage = {
      id: 'msg-2',
      channelId: 'channel-1',
      channelType: 'discord',
      userId: 'user-1',
      content: '把刚才那个再发一遍',
      timestamp: new Date('2026-04-01T00:01:00.000Z')
    };

    await worker.execute(session, message);

    const prompt = runner.mock.calls[0]?.[1]?.at(-1);

    expect(prompt).toBe(message.content);
    expect(prompt).not.toContain('Recent files in this session:');
    expect(prompt).not.toContain('last sent html');
  });

  it('adds an attachment manifest to the prompt when attachments are present', async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'attachment-aware response',
        session_id: 'attachment-session'
      }),
      stderr: '',
      exitCode: 0
    });
    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: 'attachment-session',
      channelId: 'channel-attachments',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory: '/home/user/project',
      permissionMode: 'auto',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      status: 'active',
      messageCount: 0
    };
    const message: AgentMessage = {
      id: 'msg-attachments',
      channelId: 'channel-attachments',
      channelType: 'discord',
      userId: 'user-attachments',
      content: 'Review the attached mockup.',
      attachments: [
        {
          id: 'att-1',
          name: 'mockup.png',
          type: 'image/png',
          size: 1234,
          url: 'https://cdn.discordapp.com/attachments/att-1',
          localPath: '/home/user/project/assets/mockup.png'
        }
      ],
      timestamp: new Date()
    };

    await worker.execute(session, message);

    const prompt = runner.mock.calls[0]?.[1]?.at(-1);

    expect(prompt).toContain('Review the attached mockup.');
    expect(prompt).toContain('Attached files:');
    expect(prompt).toContain('mockup.png');
    expect(prompt).toContain('image/png');
    expect(prompt).toContain('1234 bytes');
    expect(prompt).toContain('assets/mockup.png');
    expect(prompt).not.toContain('Hidden file-return instructions:');
  });

  it('falls back to a safe attachment location when localPath escapes the working directory', async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'attachment-aware response',
        session_id: 'attachment-session'
      }),
      stderr: '',
      exitCode: 0
    });
    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: 'attachment-session',
      channelId: 'channel-attachments',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory: '/home/user/project',
      permissionMode: 'auto',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      status: 'active',
      messageCount: 0
    };
    const message: AgentMessage = {
      id: 'msg-attachments-outside',
      channelId: 'channel-attachments',
      channelType: 'discord',
      userId: 'user-attachments',
      content: 'Review the attached mockup.',
      attachments: [
        {
          id: 'att-2',
          name: 'mockup.png',
          type: 'image/png',
          size: 1234,
          url: 'https://cdn.discordapp.com/attachments/att-2',
          localPath: '/home/user/other-project/assets/mockup.png'
        }
      ],
      timestamp: new Date()
    };

    await worker.execute(session, message);

    const prompt = runner.mock.calls[0]?.[1]?.at(-1);

    expect(prompt).toContain('Attached files:');
    expect(prompt).toContain('https://cdn.discordapp.com/attachments/att-2');
    expect(prompt).not.toContain('../');
  });

  it('treats files in the sibling uploads directory as local session attachments', async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'attachment-aware response',
        session_id: 'attachment-session'
      }),
      stderr: '',
      exitCode: 0
    });
    const sessionRoot = mkdtempSync(join(tmpdir(), 'attachment-session-'));
    tempDirectories.push(sessionRoot);
    const workingDirectory = join(sessionRoot, 'workspace');
    const uploadsDirectory = join(sessionRoot, 'uploads');
    mkdirSync(workingDirectory, { recursive: true });
    mkdirSync(uploadsDirectory, { recursive: true });
    const localUploadPath = join(uploadsDirectory, 'mockup.png');
    writeFileSync(localUploadPath, 'png-bytes');

    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: 'attachment-session',
      channelId: 'channel-attachments',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory,
      permissionMode: 'auto',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      status: 'active',
      messageCount: 0
    };
    const message: AgentMessage = {
      id: 'msg-attachments-uploads',
      channelId: 'channel-attachments',
      channelType: 'discord',
      userId: 'user-attachments',
      content: 'Review the uploaded mockup.',
      attachments: [
        {
          id: 'att-3',
          name: 'mockup.png',
          type: 'image/png',
          size: 1234,
          url: 'https://cdn.discordapp.com/attachments/att-3',
          localPath: localUploadPath
        }
      ],
      timestamp: new Date()
    };

    await worker.execute(session, message);

    const prompt = runner.mock.calls[0]?.[1]?.at(-1);

    expect(prompt).toContain('Attached files:');
    expect(prompt).toContain('uploads/mockup.png');
    expect(prompt).not.toContain('https://cdn.discordapp.com/attachments/att-3');
  });

  it('parses structured Claude JSON output and returns the result field', async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'structured response',
        session_id: 'test-session'
      }),
      stderr: '',
      exitCode: 0
    });
    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: 'test-session',
      channelId: 'channel-json',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory: '/tmp',
      permissionMode: 'auto',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      status: 'active',
      messageCount: 0
    };
    const message: AgentMessage = {
      id: 'msg-json',
      channelId: 'channel-json',
      channelType: 'discord',
      userId: 'user-json',
      content: 'hello',
      timestamp: new Date()
    };

    const response = await worker.execute(session, message);

    expect(response.content).toBe('structured response');
  });

  it('creates outbound attachments from valid file markers and strips them from the response', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'claude-worker-'));
    tempDirectories.push(workingDirectory);
    const artifactPath = join(workingDirectory, '.deliveries', 'artifacts', 'report.txt');
    mkdirSync(join(workingDirectory, '.deliveries', 'artifacts'), { recursive: true });
    writeFileSync(artifactPath, 'report contents');

    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Here is the report.\n[[file:.deliveries/artifacts/report.txt]]\nThanks!',
        session_id: 'attachment-session'
      }),
      stderr: '',
      exitCode: 0
    });
    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: 'attachment-session',
      channelId: 'channel-outbound',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory,
      permissionMode: 'auto',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      status: 'active',
      messageCount: 0
    };
    const message: AgentMessage = {
      id: 'msg-outbound',
      channelId: 'channel-outbound',
      channelType: 'discord',
      userId: 'user-outbound',
      content: 'Send me the generated report.',
      timestamp: new Date()
    };

    const response = await worker.execute(session, message);

    expect(response.content).toBe('Here is the report.\n\nThanks!');
    expect(response.replyTo).toBe('msg-outbound');
    expect(response.attachments).toEqual([
      expect.objectContaining({
        name: 'report.txt',
        localPath: artifactPath
      })
    ]);
  });

  it('creates outbound attachments when Claude emits workspace-prefixed file markers', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'claude-worker-'));
    tempDirectories.push(workingDirectory);
    const artifactPath = join(workingDirectory, '.deliveries', 'singer_cropped.png');
    mkdirSync(join(workingDirectory, '.deliveries'), { recursive: true });
    writeFileSync(artifactPath, 'png bytes');

    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: '已裁剪完成。\n[[file:workspace/.deliveries/singer_cropped.png]]',
        session_id: 'attachment-session'
      }),
      stderr: '',
      exitCode: 0
    });
    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: 'attachment-session',
      channelId: 'channel-outbound',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory,
      permissionMode: 'auto',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      status: 'active',
      messageCount: 0
    };
    const message: AgentMessage = {
      id: 'msg-outbound-workspace-prefix',
      channelId: 'channel-outbound',
      channelType: 'discord',
      userId: 'user-outbound',
      content: '发给我裁剪后的图片',
      timestamp: new Date()
    };

    const response = await worker.execute(session, message);

    expect(response.content).toBe('已裁剪完成。');
    expect(response.attachments).toEqual([
      expect.objectContaining({
        name: 'singer_cropped.png',
        localPath: artifactPath
      })
    ]);
  });

  it('creates multiple outbound attachments when Claude emits multiple file markers', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'claude-worker-'));
    tempDirectories.push(workingDirectory);
    mkdirSync(join(workingDirectory, '.deliveries'), { recursive: true });
    const leftPath = join(workingDirectory, '.deliveries', 'crop_左上.png');
    const rightPath = join(workingDirectory, '.deliveries', 'crop_右上.png');
    writeFileSync(leftPath, 'left bytes');
    writeFileSync(rightPath, 'right bytes');

    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: '已裁剪完成。\n[[file:.deliveries/crop_左上.png]]\n[[file:.deliveries/crop_右上.png]]',
        session_id: 'attachment-session'
      }),
      stderr: '',
      exitCode: 0
    });
    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: 'attachment-session',
      channelId: 'channel-outbound',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory,
      permissionMode: 'auto',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      status: 'active',
      messageCount: 0
    };

    const response = await worker.execute(session, {
      id: 'msg-outbound-multi',
      channelId: 'channel-outbound',
      channelType: 'discord',
      userId: 'user-outbound',
      content: '把两张裁剪图都发给我',
      timestamp: new Date()
    });

    expect(response.content).toBe('已裁剪完成。');
    expect(response.attachments).toEqual([
      expect.objectContaining({
        name: 'crop_左上.png',
        localPath: leftPath
      }),
      expect.objectContaining({
        name: 'crop_右上.png',
        localPath: rightPath
      })
    ]);
  });

  it('does not return deprecated recent file candidate metadata for arbitrary referenced workspace artifacts', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'worker-artifacts-'));
    tempDirectories.push(workingDirectory);
    const artifactPath = join(workingDirectory, 'outputs', 'report.html');

    const runner = vi.fn().mockImplementation(async () => {
      mkdirSync(join(workingDirectory, 'outputs'), { recursive: true });
      writeFileSync(artifactPath, '<html>report</html>');

      return {
        stdout: JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Saved the report to outputs/report.html',
          session_id: 'artifact-session'
        }),
        stderr: '',
        exitCode: 0
      };
    });

    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: 'artifact-session',
      channelId: 'channel-1',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory,
      permissionMode: 'auto',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      lastActiveAt: new Date('2026-04-01T00:00:00.000Z'),
      status: 'active',
      messageCount: 0,
      recentFiles: []
    };

    const response = await worker.execute(session, {
      id: 'msg-1',
      channelId: 'channel-1',
      channelType: 'discord',
      userId: 'user-1',
      content: '做一个 html 报告',
      timestamp: new Date('2026-04-01T00:00:00.000Z')
    });

    expect('metadata' in response).toBe(false);
  });

  it('does not return deprecated recent file candidate metadata for doc and ppt content mentions', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'worker-artifacts-'));
    tempDirectories.push(workingDirectory);
    const docPath = join(workingDirectory, 'outputs', 'summary.doc');
    const pptPath = join(workingDirectory, 'outputs', 'slides.ppt');

    const runner = vi.fn().mockImplementation(async () => {
      mkdirSync(join(workingDirectory, 'outputs'), { recursive: true });
      writeFileSync(docPath, 'doc bytes');
      writeFileSync(pptPath, 'ppt bytes');

      return {
        stdout: JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Created outputs/summary.doc and outputs/slides.ppt',
          session_id: 'artifact-session'
        }),
        stderr: '',
        exitCode: 0
      };
    });

    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: 'artifact-session',
      channelId: 'channel-1',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory,
      permissionMode: 'auto',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      lastActiveAt: new Date('2026-04-01T00:00:00.000Z'),
      status: 'active',
      messageCount: 0,
      recentFiles: []
    };

    const response = await worker.execute(session, {
      id: 'msg-doc-ppt',
      channelId: 'channel-1',
      channelType: 'discord',
      userId: 'user-1',
      content: 'create a word doc and slide deck',
      timestamp: new Date('2026-04-01T00:00:00.000Z')
    });

    expect('metadata' in response).toBe(false);
  });

  it('does not return deprecated recent file candidate metadata for json and txt content mentions', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'worker-artifacts-'));
    tempDirectories.push(workingDirectory);
    const jsonPath = join(workingDirectory, 'outputs', 'report.json');
    const textPath = join(workingDirectory, 'outputs', 'notes.txt');

    const runner = vi.fn().mockImplementation(async () => {
      mkdirSync(join(workingDirectory, 'outputs'), { recursive: true });
      writeFileSync(jsonPath, '{"ok":true}');
      writeFileSync(textPath, 'notes');

      return {
        stdout: JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Created outputs/report.json and outputs/notes.txt',
          session_id: 'artifact-session'
        }),
        stderr: '',
        exitCode: 0
      };
    });

    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: 'artifact-session',
      channelId: 'channel-1',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory,
      permissionMode: 'auto',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      lastActiveAt: new Date('2026-04-01T00:00:00.000Z'),
      status: 'active',
      messageCount: 0,
      recentFiles: []
    };

    const response = await worker.execute(session, {
      id: 'msg-json-txt',
      channelId: 'channel-1',
      channelType: 'discord',
      userId: 'user-1',
      content: 'create a json report and text notes',
      timestamp: new Date('2026-04-01T00:00:00.000Z')
    });

    expect('metadata' in response).toBe(false);
  });

  it('does not remember changed files that are not referenced in Claude output', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'worker-artifacts-'));
    tempDirectories.push(workingDirectory);
    const artifactPath = join(workingDirectory, 'outputs', 'report.html');

    const runner = vi.fn().mockImplementation(async () => {
      mkdirSync(join(workingDirectory, 'outputs'), { recursive: true });
      writeFileSync(artifactPath, '<html>report</html>');

      return {
        stdout: JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Finished the analysis.',
          session_id: 'artifact-session'
        }),
        stderr: '',
        exitCode: 0
      };
    });

    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: 'artifact-session',
      channelId: 'channel-1',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory,
      permissionMode: 'auto',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      lastActiveAt: new Date('2026-04-01T00:00:00.000Z'),
      status: 'active',
      messageCount: 0,
      recentFiles: []
    };

    const response = await worker.execute(session, {
      id: 'msg-1',
      channelId: 'channel-1',
      channelType: 'discord',
      userId: 'user-1',
      content: '做一个 html 报告',
      timestamp: new Date('2026-04-01T00:00:00.000Z')
    });

    expect('metadata' in response).toBe(false);
  });

  it('does not treat inline file markers in prose as outbound attachments', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'claude-worker-'));
    tempDirectories.push(workingDirectory);
    const artifactPath = join(workingDirectory, 'artifacts', 'report.txt');
    mkdirSync(join(workingDirectory, 'artifacts'), { recursive: true });
    writeFileSync(artifactPath, 'report contents');

    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Mention [[file:.deliveries/artifacts/report.txt]] inline, but do not attach it.',
        session_id: 'attachment-session'
      }),
      stderr: '',
      exitCode: 0
    });
    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: 'attachment-session',
      channelId: 'channel-outbound',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory,
      permissionMode: 'auto',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      status: 'active',
      messageCount: 0
    };
    const message: AgentMessage = {
      id: 'msg-inline-marker',
      channelId: 'channel-outbound',
      channelType: 'discord',
      userId: 'user-outbound',
      content: 'Explain how outbound files work.',
      timestamp: new Date()
    };

    const response = await worker.execute(session, message);

    expect(response.attachments).toBeUndefined();
    expect(response.content).toBe('Mention [[file:.deliveries/artifacts/report.txt]] inline, but do not attach it.');
  });

  it('does not treat standalone file markers inside fenced code blocks as outbound attachments', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'claude-worker-'));
    tempDirectories.push(workingDirectory);
    const artifactPath = join(workingDirectory, 'artifacts', 'report.txt');
    mkdirSync(join(workingDirectory, 'artifacts'), { recursive: true });
    writeFileSync(artifactPath, 'report contents');

    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Use this example:\n```txt\n[[file:.deliveries/artifacts/report.txt]]\n```\nOutside the example.',
        session_id: 'attachment-session'
      }),
      stderr: '',
      exitCode: 0
    });
    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: 'attachment-session',
      channelId: 'channel-outbound',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory,
      permissionMode: 'auto',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      status: 'active',
      messageCount: 0
    };
    const message: AgentMessage = {
      id: 'msg-fenced-marker',
      channelId: 'channel-outbound',
      channelType: 'discord',
      userId: 'user-outbound',
      content: 'Explain how outbound files work.',
      timestamp: new Date()
    };

    const response = await worker.execute(session, message);

    expect(response.attachments).toBeUndefined();
    expect(response.content).toBe('Use this example:\n```txt\n[[file:.deliveries/artifacts/report.txt]]\n```\nOutside the example.');
  });

  it('keeps unpublished outbound file markers out of attachments and adds a visible error note', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'claude-worker-'));
    tempDirectories.push(workingDirectory);

    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'I could not attach that file.\n[[file:exports/report.txt]]',
        session_id: 'attachment-session'
      }),
      stderr: '',
      exitCode: 0
    });
    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: 'attachment-session',
      channelId: 'channel-outbound',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory,
      permissionMode: 'auto',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      status: 'active',
      messageCount: 0
    };
    const message: AgentMessage = {
      id: 'msg-outbound-error',
      channelId: 'channel-outbound',
      channelType: 'discord',
      userId: 'user-outbound',
      content: 'Send me the generated report.',
      timestamp: new Date()
    };

    const response = await worker.execute(session, message);

    expect(response.attachments).toBeUndefined();
    expect(response.replyTo).toBe('msg-outbound-error');
    expect(response.content).toContain('I could not attach that file.');
    expect(response.content).toContain('Could not attach exports/report.txt: Path is outside the published deliveries boundary.');
  });

  it('rejects symlinked outbound markers under deliveries when they resolve outside the published boundary', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'claude-worker-'));
    const outsideDirectory = mkdtempSync(join(tmpdir(), 'claude-worker-outside-'));
    tempDirectories.push(workingDirectory, outsideDirectory);
    mkdirSync(join(workingDirectory, '.deliveries'), { recursive: true });
    symlinkSync(outsideDirectory, join(workingDirectory, '.deliveries', 'linked'));
    writeFileSync(join(outsideDirectory, 'report.txt'), 'report bytes');

    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'I could not attach that file.\n[[file:.deliveries/linked/report.txt]]',
        session_id: 'attachment-session'
      }),
      stderr: '',
      exitCode: 0
    });
    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: 'attachment-session',
      channelId: 'channel-outbound',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory,
      permissionMode: 'auto',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      status: 'active',
      messageCount: 0
    };

    const response = await worker.execute(session, {
      id: 'msg-outbound-symlink-error',
      channelId: 'channel-outbound',
      channelType: 'discord',
      userId: 'user-outbound',
      content: 'Send me the generated report.',
      timestamp: new Date()
    });

    expect(response.attachments).toBeUndefined();
    expect(response.content).toContain('Could not attach .deliveries/linked/report.txt: Path is outside the published deliveries boundary.');
  });

  it('does not invoke file-return scripts when Claude does not emit a marker', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'claude-worker-hook-'));
    tempDirectories.push(workingDirectory);
    mkdirSync(join(workingDirectory, '.claude-gateway', 'outbox'), { recursive: true });
    mkdirSync(join(workingDirectory, '.claude-gateway', 'memory'), { recursive: true });
    const artifactPath = join(workingDirectory, '.claude-gateway', 'outbox', 'cropped-image.png');
    writeFileSync(artifactPath, 'png bytes');
    writeFileSync(
      join(workingDirectory, '.claude-gateway', 'memory', 'recent-files.json'),
      JSON.stringify({
        recentFiles: [
          {
            id: 'claude_outbound:.deliveries/cropped-image.png',
            displayName: 'cropped-image.png',
            relativePath: '.deliveries/cropped-image.png',
            absolutePath: join(workingDirectory, '.deliveries', 'cropped-image.png'),
            source: 'claude_outbound',
            mediaType: 'image/png',
            lastSeenAt: '2026-04-02T00:00:00.000Z',
            summary: 'last sent image'
          }
        ]
      })
    );

    const runner = vi.fn().mockImplementation(async (command: string) => {
      if (command !== 'claude') {
        throw new Error(`Unexpected command: ${command}`);
      }

      return {
        stdout: JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: '已经裁剪好了。',
          session_id: 'attachment-session'
        }),
        stderr: '',
        exitCode: 0
      };
    });
    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: 'attachment-session',
      channelId: 'channel-outbound',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory,
      permissionMode: 'auto',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      status: 'active',
      messageCount: 0
    };
    const message: AgentMessage = {
      id: 'msg-hook-attachment',
      channelId: 'channel-outbound',
      channelType: 'discord',
      userId: 'user-outbound',
      content: '把图片直接发给我',
      timestamp: new Date()
    };

    const response = await worker.execute(session, message);

    expect(response.content).toBe('已经裁剪好了。');
    expect(response.attachments).toBeUndefined();
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0]?.[0]).toBe('claude');
  });

  it('throws a helpful error when Claude returns invalid JSON output', async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: '\u0001Bud1 not json',
      stderr: '',
      exitCode: 0
    });
    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: 'test-session',
      channelId: 'channel-bad-json',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory: '/tmp',
      permissionMode: 'auto',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      status: 'active',
      messageCount: 0
    };
    const message: AgentMessage = {
      id: 'msg-bad-json',
      channelId: 'channel-bad-json',
      channelType: 'discord',
      userId: 'user-bad-json',
      content: 'hello',
      timestamp: new Date()
    };

    await expect(worker.execute(session, message)).rejects.toThrow('Claude returned invalid JSON output');
  });

  it('throws a helpful error when Claude returns JSON with a non-string result', async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: { text: 'not a string' },
        session_id: 'test-session'
      }),
      stderr: '',
      exitCode: 0
    });
    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: 'test-session',
      channelId: 'channel-bad-result',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory: '/tmp',
      permissionMode: 'auto',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      status: 'active',
      messageCount: 0
    };
    const message: AgentMessage = {
      id: 'msg-bad-result',
      channelId: 'channel-bad-result',
      channelType: 'discord',
      userId: 'user-bad-result',
      content: 'hello',
      timestamp: new Date()
    };

    await expect(worker.execute(session, message)).rejects.toThrow('Claude returned an invalid result payload');
  });

  it('throws a helpful error when Claude returns JSON without a result field', async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: 'test-session'
      }),
      stderr: '',
      exitCode: 0
    });
    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: 'test-session',
      channelId: 'channel-missing-result',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory: '/tmp',
      permissionMode: 'auto',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      status: 'active',
      messageCount: 0
    };
    const message: AgentMessage = {
      id: 'msg-missing-result',
      channelId: 'channel-missing-result',
      channelType: 'discord',
      userId: 'user-missing-result',
      content: 'hello',
      timestamp: new Date()
    };

    await expect(worker.execute(session, message)).rejects.toThrow('Claude returned an invalid result payload');
  });

  it('retries with resume when a new session id already exists in Claude', async () => {
    const runner = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: '',
        stderr: 'Error: Session ID reused-session is already in use.\n',
        exitCode: 1
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'recovered via resume',
          session_id: 'reused-session'
        }),
        stderr: '',
        exitCode: 0
      });
    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: 'reused-session',
      channelId: 'channel-resume-fallback',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory: '/tmp',
      permissionMode: 'auto',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      status: 'active',
      messageCount: 0
    };
    const message: AgentMessage = {
      id: 'msg-resume-fallback',
      channelId: 'channel-resume-fallback',
      channelType: 'discord',
      userId: 'user-resume-fallback',
      content: 'hello',
      timestamp: new Date()
    };

    const response = await worker.execute(session, message);

    expect(response.content).toBe('recovered via resume');
    expect(runner.mock.calls[0]?.[0]).toBe('claude');
    expect(runner.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([
        '--print',
        '--output-format',
        'json',
        '--session-id',
        'reused-session',
        '--model',
        'sonnet',
        '--permission-mode',
        'auto'
      ])
    );
    expect(runner.mock.calls[0]?.[1]?.at(-1)).toContain('hello');
    expect(runner.mock.calls[0]?.[2]).toEqual({ cwd: '/tmp' });
    expect(runner.mock.calls[1]?.[0]).toBe('claude');
    expect(runner.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining([
        '--print',
        '--output-format',
        'json',
        '--resume',
        'reused-session',
        '--model',
        'sonnet',
        '--permission-mode',
        'auto'
      ])
    );
    expect(runner.mock.calls[1]?.[1]?.at(-1)).toContain('hello');
    expect(runner.mock.calls[1]?.[2]).toEqual({ cwd: '/tmp' });
  });

  it('throws error when claude CLI fails with stderr', async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: '',
      stderr: 'Error: something went wrong',
      exitCode: 1
    });
    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: 'test-session',
      channelId: 'channel-3',
      channelType: 'discord',
      model: 'opus',
      workingDirectory: '/tmp',
      permissionMode: 'default',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      status: 'active',
      messageCount: 0
    };
    const message: AgentMessage = {
      id: 'msg-3',
      channelId: 'channel-3',
      channelType: 'discord',
      userId: 'user-3',
      content: 'test',
      timestamp: new Date()
    };

    await expect(worker.execute(session, message)).rejects.toThrow('Error: something went wrong');
  });

  it('throws error when claude CLI fails without stderr', async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 2
    });
    const worker = new ClaudeCodeWorker(runner);
    const session: SessionProfile = {
      id: 'test-session',
      channelId: 'channel-4',
      channelType: 'discord',
      model: 'opus',
      workingDirectory: '/tmp',
      permissionMode: 'default',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      status: 'active',
      messageCount: 0
    };
    const message: AgentMessage = {
      id: 'msg-4',
      channelId: 'channel-4',
      channelType: 'discord',
      userId: 'user-4',
      content: 'test',
      timestamp: new Date()
    };

    await expect(worker.execute(session, message)).rejects.toThrow('claude exited with status 2');
  });
});
