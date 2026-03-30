import { describe, expect, it, vi } from 'vitest';
import { CommandHandler } from '../../src/commands';
import { buildBuiltInCommands } from '../../src/commands/built-in/help';
import { AgentMessage, SessionProfile } from '../../src/core/types';

describe('CommandHandler', () => {
  it('updates a session when /model is invoked', async () => {
    const session: SessionProfile = {
      id: 'session-1',
      channelId: 'channel-1',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory: '.',
      permissionMode: 'auto',
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
      content: '/model opus',
      timestamp: new Date('2026-03-30T00:00:00.000Z')
    };
    const orchestrator = {
      updateSessionConfig: vi.fn().mockReturnValue({ ...session, model: 'opus' }),
      loadProfile: vi.fn(),
      listSessions: vi.fn(),
      getSession: vi.fn().mockReturnValue(session)
    };
    const handler = new CommandHandler();

    buildBuiltInCommands(handler);
    const result = await handler.executeFromMessage(message, {
      session,
      message,
      orchestrator
    });

    expect(orchestrator.updateSessionConfig).toHaveBeenCalledWith('session-1', { model: 'opus' });
    expect(result.success).toBe(true);
    expect(result.message).toContain('opus');
  });
});