import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeCodeWorker } from '../../src/core/worker';
import { AgentMessage, SessionProfile } from '../../src/core/types';

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

    expect(runner).toHaveBeenCalledWith(
        'claude',
      [
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
        'Stay concise.',
        'Summarize the latest commit.'
      ],
      { cwd: '/tmp/project' }
    );
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

    expect(runner).toHaveBeenCalledWith(
        'claude',
      [
        '--print',
        '--output-format',
        'json',
        '--session-id',
        'minimal-session-id',
        '--model',
        'sonnet',
        '--permission-mode',
        'default',
        'Hello'
      ],
      { cwd: '/home/user/project' }
    );
    expect(response.content).toBe('response');
    expect(response.replyTo).toBe('msg-2');
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
    expect(prompt).toContain(
      'If you want Discord to receive a local file, include [[file:relative/path/from-working-directory]] on its own line in your final answer.'
    );
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
    const artifactPath = join(workingDirectory, 'artifacts', 'report.txt');
    mkdirSync(join(workingDirectory, 'artifacts'), { recursive: true });
    writeFileSync(artifactPath, 'report contents');

    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Here is the report.\n[[file:artifacts/report.txt]]\nThanks!',
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
        result: 'Mention [[file:artifacts/report.txt]] inline, but do not attach it.',
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
    expect(response.content).toBe('Mention [[file:artifacts/report.txt]] inline, but do not attach it.');
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
        result: 'Use this example:\n```txt\n[[file:artifacts/report.txt]]\n```\nOutside the example.',
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
    expect(response.content).toBe('Use this example:\n```txt\n[[file:artifacts/report.txt]]\n```\nOutside the example.');
  });

  it('keeps unsafe outbound file markers out of attachments and adds a visible error note', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'claude-worker-'));
    tempDirectories.push(workingDirectory);

    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'I could not attach that file.\n[[file:../../secret.txt]]',
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
    expect(response.content).toContain('Could not attach ../../secret.txt');
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
    expect(runner).toHaveBeenNthCalledWith(
      1,
      'claude',
      ['--print', '--output-format', 'json', '--session-id', 'reused-session', '--model', 'sonnet', '--permission-mode', 'auto', 'hello'],
      { cwd: '/tmp' }
    );
    expect(runner).toHaveBeenNthCalledWith(
      2,
      'claude',
      ['--print', '--output-format', 'json', '--resume', 'reused-session', '--model', 'sonnet', '--permission-mode', 'auto', 'hello'],
      { cwd: '/tmp' }
    );
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
