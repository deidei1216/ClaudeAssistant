import { describe, expect, it, vi } from 'vitest';
import { ClaudeCodeWorker } from '../../src/core/worker';
import { AgentMessage, SessionProfile } from '../../src/core/types';

describe('ClaudeCodeWorker', () => {
  it('maps a session into the correct claude CLI invocation', async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: 'done',
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
      stdout: 'response',
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
