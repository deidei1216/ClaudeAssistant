import { describe, expect, it, vi } from 'vitest';
import { CommandHandler } from '../../commands';
import { buildBuiltInCommands } from '../../commands/help';
import { AgentMessage, SessionProfile } from '../../core/types';

describe('CommandHandler', () => {
  // Helper to create a default session
  const createSession = (overrides?: Partial<SessionProfile>): SessionProfile => ({
    id: 'session-1',
    channelId: 'channel-1',
    channelType: 'discord',
    model: 'sonnet',
    workingDirectory: '.',
    permissionMode: 'auto',
    createdAt: new Date('2026-03-30T00:00:00.000Z'),
    lastActiveAt: new Date('2026-03-30T00:00:00.000Z'),
    status: 'active',
    messageCount: 1,
    ...overrides
  });

  // Helper to create a message
  const createMessage = (content: string): AgentMessage => ({
    id: 'msg-1',
    channelId: 'channel-1',
    channelType: 'discord',
    userId: 'user-1',
    content,
    timestamp: new Date('2026-03-30T00:00:00.000Z')
  });

  describe('/model command', () => {
    it('updates a session when /model is invoked', async () => {
      const session = createSession();
      const message = createMessage('/model opus');
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

    it('returns error when model name is missing', async () => {
      const session = createSession();
      const message = createMessage('/model');
      const orchestrator = {
        updateSessionConfig: vi.fn(),
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

      expect(orchestrator.updateSessionConfig).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.message).toContain('Usage:');
    });
  });

  describe('/cd command', () => {
    it('updates working directory with relative path', async () => {
      const session = createSession();
      const message = createMessage('/cd src');
      const orchestrator = {
        updateSessionConfig: vi.fn().mockReturnValue({ ...session, workingDirectory: '/project/src' }),
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

      expect(orchestrator.updateSessionConfig).toHaveBeenCalledWith('session-1', {
        workingDirectory: expect.any(String)
      });
      expect(result.success).toBe(true);
      expect(result.message).toContain('Working directory updated');
    });

    it('updates working directory with absolute path', async () => {
      const session = createSession();
      const message = createMessage('/cd /tmp/test');
      const orchestrator = {
        updateSessionConfig: vi.fn().mockReturnValue({ ...session, workingDirectory: '/tmp/test' }),
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

      expect(orchestrator.updateSessionConfig).toHaveBeenCalledWith('session-1', {
        workingDirectory: '/tmp/test'
      });
      expect(result.success).toBe(true);
    });

    it('returns error when path is missing', async () => {
      const session = createSession();
      const message = createMessage('/cd');
      const orchestrator = {
        updateSessionConfig: vi.fn(),
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

      expect(orchestrator.updateSessionConfig).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.message).toContain('Usage:');
    });
  });

  describe('/profile command', () => {
    it('loads a profile and updates session config', async () => {
      const session = createSession();
      const message = createMessage('/profile dev');
      const orchestrator = {
        updateSessionConfig: vi.fn().mockReturnValue({ ...session, profile: 'dev' }),
        loadProfile: vi.fn().mockReturnValue({
          name: 'dev',
          description: 'Development profile',
          model: 'haiku',
          permissionMode: 'ask'
        }),
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

      expect(orchestrator.loadProfile).toHaveBeenCalledWith('dev');
      expect(orchestrator.updateSessionConfig).toHaveBeenCalledWith('session-1', {
        model: 'haiku',
        permissionMode: 'ask',
        profile: 'dev'
      });
      expect(result.success).toBe(true);
      expect(result.message).toContain('Profile dev loaded');
    });

    it('returns error when profile name is missing', async () => {
      const session = createSession();
      const message = createMessage('/profile');
      const orchestrator = {
        updateSessionConfig: vi.fn(),
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

      expect(orchestrator.loadProfile).not.toHaveBeenCalled();
      expect(orchestrator.updateSessionConfig).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.message).toContain('Usage:');
    });
  });

  describe('/status command', () => {
    it('returns session status information', async () => {
      const session = createSession({ model: 'opus', workingDirectory: '/project', messageCount: 5 });
      const message = createMessage('/status');
      const orchestrator = {
        updateSessionConfig: vi.fn(),
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

      expect(orchestrator.getSession).toHaveBeenCalledWith('session-1');
      expect(result.success).toBe(true);
      expect(result.message).toContain('session-1');
      expect(result.message).toContain('model=opus');
      expect(result.message).toContain('cwd=/project');
      expect(result.message).toContain('messages=5');
    });

    it('returns error when session not found', async () => {
      const session = createSession();
      const message = createMessage('/status');
      const orchestrator = {
        updateSessionConfig: vi.fn(),
        loadProfile: vi.fn(),
        listSessions: vi.fn(),
        getSession: vi.fn().mockReturnValue(null)
      };
      const handler = new CommandHandler();

      buildBuiltInCommands(handler);
      const result = await handler.executeFromMessage(message, {
        session,
        message,
        orchestrator
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Session not found');
    });
  });

  describe('/help command', () => {
    it('returns list of available commands', async () => {
      const session = createSession();
      const message = createMessage('/help');
      const orchestrator = {
        updateSessionConfig: vi.fn(),
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

      expect(result.success).toBe(true);
      expect(result.message).toContain('/model');
      expect(result.message).toContain('/cd');
      expect(result.message).toContain('/profile');
      expect(result.message).toContain('/status');
      expect(result.message).toContain('/help');
    });
  });

  describe('/new command', () => {
    it('archives the current session and creates a replacement session', async () => {
      const session = createSession();
      const message = createMessage('/new');
      const orchestrator = {
        updateSessionConfig: vi.fn(),
        loadProfile: vi.fn(),
        listSessions: vi.fn(),
        getSession: vi.fn().mockReturnValue(session),
        archiveSession: vi.fn(),
        getOrCreateSession: vi.fn().mockReturnValue({
          ...session,
          id: 'session-2',
          messageCount: 0
        })
      };
      const handler = new CommandHandler();

      buildBuiltInCommands(handler);
      const result = await handler.executeFromMessage(message, {
        session,
        message,
        orchestrator
      });

      expect(orchestrator.archiveSession).toHaveBeenCalledWith('session-1');
      expect(orchestrator.getOrCreateSession).toHaveBeenCalledWith('channel-1', 'discord');
      expect(result.success).toBe(true);
      expect(result.message).toContain('new=session-2');
    });
  });

  describe('CommandHandler.register()', () => {
    it('registers a command', async () => {
      const handler = new CommandHandler();
      const customCommand = {
        name: 'custom',
        description: 'A custom command',
        usage: '/custom',
        handler: vi.fn().mockResolvedValue({ success: true, message: 'Custom executed' })
      };

      handler.register(customCommand);
      const result = await handler.execute('custom', [], {
        session: createSession(),
        message: createMessage('/custom'),
        orchestrator: {
          updateSessionConfig: vi.fn(),
          loadProfile: vi.fn(),
          getSession: vi.fn()
        }
      });

      expect(customCommand.handler).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('registers command with aliases', async () => {
      const handler = new CommandHandler();
      const customCommand = {
        name: 'custom',
        description: 'A custom command',
        usage: '/custom',
        aliases: ['c', 'cust'],
        handler: vi.fn().mockResolvedValue({ success: true, message: 'Custom executed' })
      };

      handler.register(customCommand);

      // Test main name
      const result1 = await handler.execute('custom', [], {
        session: createSession(),
        message: createMessage('/custom'),
        orchestrator: {
          updateSessionConfig: vi.fn(),
          loadProfile: vi.fn(),
          getSession: vi.fn()
        }
      });
      expect(result1.success).toBe(true);

      // Test alias 'c'
      const result2 = await handler.execute('c', [], {
        session: createSession(),
        message: createMessage('/c'),
        orchestrator: {
          updateSessionConfig: vi.fn(),
          loadProfile: vi.fn(),
          getSession: vi.fn()
        }
      });
      expect(result2.success).toBe(true);

      // Test alias 'cust'
      const result3 = await handler.execute('cust', [], {
        session: createSession(),
        message: createMessage('/cust'),
        orchestrator: {
          updateSessionConfig: vi.fn(),
          loadProfile: vi.fn(),
          getSession: vi.fn()
        }
      });
      expect(result3.success).toBe(true);
    });
  });

  describe('CommandHandler.list()', () => {
    it('returns list of registered commands sorted by name', () => {
      const handler = new CommandHandler();
      const commandA = {
        name: 'zebra',
        description: 'Z command',
        usage: '/zebra',
        handler: vi.fn()
      };
      const commandB = {
        name: 'alpha',
        description: 'A command',
        usage: '/alpha',
        handler: vi.fn()
      };
      const commandC = {
        name: 'middle',
        description: 'M command',
        usage: '/middle',
        handler: vi.fn()
      };

      handler.register(commandA);
      handler.register(commandB);
      handler.register(commandC);

      const list = handler.list();

      expect(list).toHaveLength(3);
      expect(list[0].name).toBe('alpha');
      expect(list[1].name).toBe('middle');
      expect(list[2].name).toBe('zebra');
    });

    it('returns unique commands (aliases not duplicated)', () => {
      const handler = new CommandHandler();
      const command = {
        name: 'test',
        description: 'Test command',
        usage: '/test',
        aliases: ['t', 'tst'],
        handler: vi.fn()
      };

      handler.register(command);
      const list = handler.list();

      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('test');
    });
  });

  describe('parseCommand edge cases', () => {
    it('handles empty string', async () => {
      const session = createSession();
      const message = createMessage('');
      const orchestrator = {
        updateSessionConfig: vi.fn(),
        loadProfile: vi.fn(),
        listSessions: vi.fn(),
        getSession: vi.fn()
      };
      const handler = new CommandHandler();

      buildBuiltInCommands(handler);
      const result = await handler.executeFromMessage(message, {
        session,
        message,
        orchestrator
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Not a command message');
    });

    it('handles message without / prefix', async () => {
      const session = createSession();
      const message = createMessage('hello world');
      const orchestrator = {
        updateSessionConfig: vi.fn(),
        loadProfile: vi.fn(),
        listSessions: vi.fn(),
        getSession: vi.fn()
      };
      const handler = new CommandHandler();

      buildBuiltInCommands(handler);
      const result = await handler.executeFromMessage(message, {
        session,
        message,
        orchestrator
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Not a command message');
    });

    it('handles command with no args', async () => {
      const session = createSession();
      const message = createMessage('/status');
      const orchestrator = {
        updateSessionConfig: vi.fn(),
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

      expect(result.success).toBe(true);
    });

    it('handles command with multiple args', async () => {
      const session = createSession();
      const message = createMessage('/cd path with spaces');
      const orchestrator = {
        updateSessionConfig: vi.fn().mockReturnValue({ ...session, workingDirectory: '/path with spaces' }),
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

      expect(result.success).toBe(true);
      // cd command joins args with spaces
      expect(orchestrator.updateSessionConfig).toHaveBeenCalledWith('session-1', {
        workingDirectory: expect.stringContaining('path with spaces')
      });
    });

    it('handles slash only', async () => {
      const session = createSession();
      const message = createMessage('/');
      const orchestrator = {
        updateSessionConfig: vi.fn(),
        loadProfile: vi.fn(),
        listSessions: vi.fn(),
        getSession: vi.fn()
      };
      const handler = new CommandHandler();

      buildBuiltInCommands(handler);
      const result = await handler.executeFromMessage(message, {
        session,
        message,
        orchestrator
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Not a command message');
    });
  });

  describe('Unknown command handling', () => {
    it('returns error for unknown command', async () => {
      const session = createSession();
      const message = createMessage('/unknown');
      const orchestrator = {
        updateSessionConfig: vi.fn(),
        loadProfile: vi.fn(),
        listSessions: vi.fn(),
        getSession: vi.fn()
      };
      const handler = new CommandHandler();

      buildBuiltInCommands(handler);
      const result = await handler.executeFromMessage(message, {
        session,
        message,
        orchestrator
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown command');
      expect(result.message).toContain('unknown');
    });

    it('returns error for unknown command via execute method', async () => {
      const handler = new CommandHandler();
      const orchestrator = {
        updateSessionConfig: vi.fn(),
        loadProfile: vi.fn(),
        getSession: vi.fn()
      };

      const result = await handler.execute('nonexistent', [], {
        session: createSession(),
        message: createMessage('/nonexistent'),
        orchestrator
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown command');
    });
  });
});
