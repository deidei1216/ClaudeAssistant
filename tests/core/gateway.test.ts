import { describe, expect, it, vi } from 'vitest';
import { AgentGateway } from '../../src/core/gateway';
import { ChannelAdapter } from '../../src/core/adapter';
import { AgentMessage, SessionProfile } from '../../src/core/types';
import { CommandHandler } from '../../src/commands';
import { CommandContext } from '../../src/commands/types';

describe('AgentGateway', () => {
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
  const createMessage = (content: string, overrides?: Partial<AgentMessage>): AgentMessage => ({
    id: 'msg-1',
    channelId: 'channel-1',
    channelType: 'discord',
    userId: 'user-1',
    content,
    timestamp: new Date('2026-03-30T00:00:00.000Z'),
    ...overrides
  });

  it('routes slash commands to the command handler and normal messages to the orchestrator', async () => {
    const adapter: ChannelAdapter = {
      type: 'discord',
      name: 'Discord',
      onMessage: vi.fn(),
      send: vi.fn().mockResolvedValue({ messageId: '1', success: true }),
      initialize: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn()
    };
    const commandHandler = {
      executeFromMessage: vi.fn().mockResolvedValue({ success: true, message: 'Model updated to opus.' })
    };
    const orchestrator = {
      getOrCreateSession: vi.fn().mockReturnValue({ id: 'session-1' }),
      execute: vi.fn().mockResolvedValue({ content: 'Claude response' })
    };
    const gateway = new AgentGateway({
      adapters: [adapter],
      commandHandler: commandHandler as unknown as CommandHandler,
      orchestrator: orchestrator as unknown as {
        getOrCreateSession: (channelId: string, channelType: string) => { id: string };
        execute: (sessionId: string, message: AgentMessage) => Promise<{ content: string }>;
      },
      logger: { info: vi.fn(), error: vi.fn() }
    });

    await gateway.handleMessage(adapter, createMessage('/help'));

    await gateway.handleMessage(adapter, createMessage('hello', { id: 'msg-2' }));

    expect(commandHandler.executeFromMessage).toHaveBeenCalledTimes(1);
    expect(orchestrator.execute).toHaveBeenCalledTimes(1);
    expect(adapter.send).toHaveBeenCalledTimes(2);
  });

  it('sends command response to the adapter', async () => {
    const adapter: ChannelAdapter = {
      type: 'discord',
      name: 'Discord',
      onMessage: vi.fn(),
      send: vi.fn().mockResolvedValue({ messageId: '1', success: true }),
      initialize: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn()
    };
    const commandHandler = {
      executeFromMessage: vi.fn().mockResolvedValue({ success: true, message: 'Model updated to opus.' })
    };
    const orchestrator = {
      getOrCreateSession: vi.fn().mockReturnValue(createSession()),
      execute: vi.fn().mockResolvedValue({ content: 'Claude response' })
    };
    const gateway = new AgentGateway({
      adapters: [adapter],
      commandHandler: commandHandler as unknown as CommandHandler,
      orchestrator: orchestrator as unknown as {
        getOrCreateSession: (channelId: string, channelType: string) => SessionProfile;
        execute: (sessionId: string, message: AgentMessage) => Promise<{ content: string }>;
      },
      logger: { info: vi.fn(), error: vi.fn() }
    });

    const message = createMessage('/model opus');
    await gateway.handleMessage(adapter, message);

    expect(adapter.send).toHaveBeenCalledWith('channel-1', {
      content: 'Model updated to opus.',
      replyTo: 'msg-1'
    });
  });

  it('sends orchestrator response to the adapter for non-command messages', async () => {
    const adapter: ChannelAdapter = {
      type: 'discord',
      name: 'Discord',
      onMessage: vi.fn(),
      send: vi.fn().mockResolvedValue({ messageId: '1', success: true }),
      initialize: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn()
    };
    const commandHandler = {
      executeFromMessage: vi.fn()
    };
    const orchestrator = {
      getOrCreateSession: vi.fn().mockReturnValue(createSession()),
      execute: vi.fn().mockResolvedValue({ content: 'Claude response', replyTo: 'msg-1' })
    };
    const gateway = new AgentGateway({
      adapters: [adapter],
      commandHandler: commandHandler as unknown as CommandHandler,
      orchestrator: orchestrator as unknown as {
        getOrCreateSession: (channelId: string, channelType: string) => SessionProfile;
        execute: (sessionId: string, message: AgentMessage) => Promise<{ content: string; replyTo?: string }>;
      },
      logger: { info: vi.fn(), error: vi.fn() }
    });

    const message = createMessage('hello world');
    await gateway.handleMessage(adapter, message);

    expect(orchestrator.execute).toHaveBeenCalledWith('session-1', message);
    expect(adapter.send).toHaveBeenCalledWith('channel-1', {
      content: 'Claude response',
      replyTo: 'msg-1'
    });
  });

  it('creates or retrieves session for each message', async () => {
    const adapter: ChannelAdapter = {
      type: 'discord',
      name: 'Discord',
      onMessage: vi.fn(),
      send: vi.fn().mockResolvedValue({ messageId: '1', success: true }),
      initialize: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn()
    };
    const commandHandler = {
      executeFromMessage: vi.fn().mockResolvedValue({ success: true, message: 'Done.' })
    };
    const session = createSession();
    const orchestrator = {
      getOrCreateSession: vi.fn().mockReturnValue(session),
      execute: vi.fn().mockResolvedValue({ content: 'Response' })
    };
    const gateway = new AgentGateway({
      adapters: [adapter],
      commandHandler: commandHandler as unknown as CommandHandler,
      orchestrator: orchestrator as unknown as {
        getOrCreateSession: (channelId: string, channelType: string) => SessionProfile;
        execute: (sessionId: string, message: AgentMessage) => Promise<{ content: string }>;
      },
      logger: { info: vi.fn(), error: vi.fn() }
    });

    await gateway.handleMessage(adapter, createMessage('/status'));

    expect(orchestrator.getOrCreateSession).toHaveBeenCalledWith('channel-1', 'discord');
  });

  it('starts all adapters on start', async () => {
    const adapter1: ChannelAdapter = {
      type: 'discord',
      name: 'Discord',
      onMessage: vi.fn(),
      send: vi.fn().mockResolvedValue({ messageId: '1', success: true }),
      initialize: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn()
    };
    const adapter2: ChannelAdapter = {
      type: 'slack',
      name: 'Slack',
      onMessage: vi.fn(),
      send: vi.fn().mockResolvedValue({ messageId: '2', success: true }),
      initialize: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn()
    };
    const commandHandler = {
      executeFromMessage: vi.fn()
    };
    const orchestrator = {
      getOrCreateSession: vi.fn(),
      execute: vi.fn()
    };
    const gateway = new AgentGateway({
      adapters: [adapter1, adapter2],
      commandHandler: commandHandler as unknown as CommandHandler,
      orchestrator: orchestrator as unknown as {
        getOrCreateSession: (channelId: string, channelType: string) => SessionProfile;
        execute: (sessionId: string, message: AgentMessage) => Promise<{ content: string }>;
      },
      logger: { info: vi.fn(), error: vi.fn() }
    });

    await gateway.start();

    expect(adapter1.connect).toHaveBeenCalled();
    expect(adapter2.connect).toHaveBeenCalled();
    expect(adapter1.onMessage).toHaveBeenCalled();
    expect(adapter2.onMessage).toHaveBeenCalled();
  });

  it('stops all adapters on stop', async () => {
    const adapter1: ChannelAdapter = {
      type: 'discord',
      name: 'Discord',
      onMessage: vi.fn(),
      send: vi.fn().mockResolvedValue({ messageId: '1', success: true }),
      initialize: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn()
    };
    const adapter2: ChannelAdapter = {
      type: 'slack',
      name: 'Slack',
      onMessage: vi.fn(),
      send: vi.fn().mockResolvedValue({ messageId: '2', success: true }),
      initialize: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn()
    };
    const commandHandler = {
      executeFromMessage: vi.fn()
    };
    const orchestrator = {
      getOrCreateSession: vi.fn(),
      execute: vi.fn()
    };
    const gateway = new AgentGateway({
      adapters: [adapter1, adapter2],
      commandHandler: commandHandler as unknown as CommandHandler,
      orchestrator: orchestrator as unknown as {
        getOrCreateSession: (channelId: string, channelType: string) => SessionProfile;
        execute: (sessionId: string, message: AgentMessage) => Promise<{ content: string }>;
      },
      logger: { info: vi.fn(), error: vi.fn() }
    });

    await gateway.stop();

    expect(adapter1.disconnect).toHaveBeenCalled();
    expect(adapter2.disconnect).toHaveBeenCalled();
  });
});