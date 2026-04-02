import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentGateway } from '../../src/core/gateway';
import { ChannelAdapter } from '../../src/core/adapter';
import { AgentMessage, SessionProfile } from '../../src/core/types';
import { CommandHandler } from '../../src/commands';
import { ChannelControlInput } from '../../src/core/types';

describe('AgentGateway', () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    while (tempDirectories.length > 0) {
      const directory = tempDirectories.pop();
      if (directory) {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });

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

  it('copies inbound attachments into the session working directory before executing Claude', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'gateway-source-'));
    const workingDirectory = mkdtempSync(join(tmpdir(), 'gateway-session-'));
    tempDirectories.push(sourceRoot, workingDirectory);
    mkdirSync(join(sourceRoot, '.claude-gateway', 'inbox', 'channel-1'), { recursive: true });
    const sourcePath = join(sourceRoot, '.claude-gateway', 'inbox', 'channel-1', 'att-1-report.txt');
    writeFileSync(sourcePath, 'attachment payload');

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
    const session = createSession({ workingDirectory });
    const orchestrator = {
      getOrCreateSession: vi.fn().mockReturnValue(session),
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

    await gateway.handleMessage(
      adapter,
      createMessage('review this file', {
        attachments: [
          {
            id: 'att-1',
            name: 'report.txt',
            type: 'text/plain',
            size: 18,
            url: 'https://cdn.discordapp.com/attachments/att-1',
            localPath: sourcePath
          }
        ]
      })
    );

    const forwardedMessage = orchestrator.execute.mock.calls[0]?.[1] as AgentMessage | undefined;
    const forwardedAttachment = forwardedMessage?.attachments?.[0];

    expect(forwardedAttachment?.localPath).toEqual(
      expect.stringContaining(`${workingDirectory}/.claude-gateway/inbox/channel-1/att-1-report.txt`)
    );
    expect(readFileSync(forwardedAttachment?.localPath ?? '', 'utf8')).toBe('attachment payload');
    expect(adapter.send).toHaveBeenCalledWith('channel-1', {
      content: 'Claude response',
      replyTo: 'msg-1'
    });
  });

  it('registers normalized inbound attachments in session recent files and mirrors workspace memory', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'gateway-session-'));
    tempDirectories.push(workingDirectory);
    const sourcePath = join(workingDirectory, '.claude-gateway', 'inbox', 'channel-1', 'att-1-budget.xlsx');
    mkdirSync(join(workingDirectory, '.claude-gateway', 'inbox', 'channel-1'), { recursive: true });
    writeFileSync(sourcePath, 'budget bytes');
    const recentFile = {
      id: 'discord_inbound:att-1',
      displayName: 'budget.xlsx',
      relativePath: '.claude-gateway/inbox/channel-1/att-1-budget.xlsx',
      absolutePath: sourcePath,
      source: 'discord_inbound' as const,
      mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      lastSeenAt: new Date('2026-03-30T00:00:00.000Z'),
      summary: 'inbound excel'
    };

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
    const session = createSession({ workingDirectory, recentFiles: [] });
    const updatedSession = createSession({ workingDirectory, recentFiles: [recentFile] });
    const orchestrator = {
      getOrCreateSession: vi.fn().mockReturnValue(session),
      execute: vi.fn().mockResolvedValue({ content: 'Claude response', replyTo: 'msg-1' }),
      registerRecentFiles: vi.fn().mockReturnValue(updatedSession)
    };
    const gateway = new AgentGateway({
      adapters: [adapter],
      commandHandler: commandHandler as unknown as CommandHandler,
      orchestrator: orchestrator as never,
      logger: { info: vi.fn(), error: vi.fn() }
    });

    await gateway.handleMessage(
      adapter,
      createMessage('edit this workbook', {
        attachments: [
          {
            id: 'att-1',
            name: 'budget.xlsx',
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            size: 12,
            url: 'https://cdn.discordapp.com/attachments/att-1',
            localPath: sourcePath
          }
        ]
      })
    );

    expect(orchestrator.registerRecentFiles).toHaveBeenCalledWith(
      'session-1',
      [
        recentFile
      ]
    );

    expect(
      JSON.parse(readFileSync(join(workingDirectory, '.claude-gateway', 'memory', 'recent-files.json'), 'utf8'))
    ).toEqual({
      recentFiles: [
        expect.objectContaining({
          source: 'discord_inbound',
          relativePath: '.claude-gateway/inbox/channel-1/att-1-budget.xlsx',
          summary: 'inbound excel'
        })
      ]
    });
  });

  it('defensively copies symlinked attachment paths that escape the working directory', async () => {
    const outsideRoot = mkdtempSync(join(tmpdir(), 'gateway-outside-'));
    const workingDirectory = mkdtempSync(join(tmpdir(), 'gateway-session-'));
    tempDirectories.push(outsideRoot, workingDirectory);
    mkdirSync(join(outsideRoot, 'attachments'), { recursive: true });
    mkdirSync(join(workingDirectory, 'linked'), { recursive: true });
    const outsidePath = join(outsideRoot, 'attachments', 'att-2-report.txt');
    const symlinkPath = join(workingDirectory, 'linked', 'att-2-report.txt');
    writeFileSync(outsidePath, 'symlink attachment payload');
    symlinkSync(outsidePath, symlinkPath);

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
    const session = createSession({ workingDirectory });
    const orchestrator = {
      getOrCreateSession: vi.fn().mockReturnValue(session),
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

    await gateway.handleMessage(
      adapter,
      createMessage('review the symlinked file', {
        attachments: [
          {
            id: 'att-2',
            name: 'report.txt',
            type: 'text/plain',
            size: 26,
            url: 'https://cdn.discordapp.com/attachments/att-2',
            localPath: symlinkPath
          }
        ]
      })
    );

    const forwardedMessage = orchestrator.execute.mock.calls[0]?.[1] as AgentMessage | undefined;
    const forwardedAttachment = forwardedMessage?.attachments?.[0];

    expect(forwardedAttachment?.localPath).toEqual(
      expect.stringContaining(`${workingDirectory}/.claude-gateway/inbox/channel-1/att-2-report.txt`)
    );
    expect(forwardedAttachment?.localPath).not.toBe(symlinkPath);
    expect(readFileSync(forwardedAttachment?.localPath ?? '', 'utf8')).toBe('symlink attachment payload');
  });

  it('registers worker artifact candidates before sending the response and refreshes memory', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'gateway-worker-'));
    tempDirectories.push(workingDirectory);
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
    const session = createSession({ workingDirectory, recentFiles: [] });
    const updatedSession = createSession({
      workingDirectory,
      recentFiles: [
        {
          id: 'workspace:outputs/report.html',
          displayName: 'report.html',
          relativePath: 'outputs/report.html',
          absolutePath: join(workingDirectory, 'outputs/report.html'),
          source: 'workspace_detected',
          mediaType: 'text/html',
          lastSeenAt: new Date('2026-04-01T00:00:00.000Z'),
          summary: 'generated html'
        }
      ]
    });
    const orchestrator = {
      getOrCreateSession: vi.fn().mockReturnValue(session),
      execute: vi.fn().mockResolvedValue({
        content: 'Saved report to outputs/report.html',
        replyTo: 'msg-1',
        metadata: {
          recentFileCandidates: [
            {
              id: 'workspace:outputs/report.html',
              displayName: 'report.html',
              relativePath: 'outputs/report.html',
              absolutePath: join(workingDirectory, 'outputs/report.html'),
              source: 'workspace_detected',
              mediaType: 'text/html',
              lastSeenAt: new Date('2026-04-01T00:00:00.000Z'),
              summary: 'generated html'
            }
          ]
        }
      }),
      registerRecentFiles: vi.fn().mockReturnValue(updatedSession)
    };
    const gateway = new AgentGateway({
      adapters: [adapter],
      commandHandler: commandHandler as unknown as CommandHandler,
      orchestrator: orchestrator as never,
      logger: { info: vi.fn(), error: vi.fn() }
    });

    await gateway.handleMessage(adapter, createMessage('make an html report'));

    expect(orchestrator.registerRecentFiles).toHaveBeenCalledWith(
      'session-1',
      [
        expect.objectContaining({
          source: 'workspace_detected',
          relativePath: 'outputs/report.html'
        })
      ]
    );

    expect(
      JSON.parse(readFileSync(join(workingDirectory, '.claude-gateway', 'memory', 'recent-files.json'), 'utf8'))
    ).toEqual({
      recentFiles: [
        expect.objectContaining({
          source: 'workspace_detected',
          relativePath: 'outputs/report.html'
        })
      ]
    });
  });

  it('refreshes recent file memory after a successful outbound send', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'gateway-outbound-'));
    tempDirectories.push(workingDirectory);
    mkdirSync(join(workingDirectory, 'exports'), { recursive: true });
    const outboundPath = join(workingDirectory, 'exports', 'report.html');
    writeFileSync(outboundPath, '<html>report</html>');

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
    const session = createSession({ workingDirectory, recentFiles: [] });
    const updatedSession = createSession({
      workingDirectory,
      recentFiles: [
        {
          id: 'claude_outbound:exports/report.html',
          displayName: 'report.html',
          relativePath: 'exports/report.html',
          absolutePath: outboundPath,
          source: 'claude_outbound',
          mediaType: 'text/html',
          lastSeenAt: new Date('2026-04-01T00:00:00.000Z'),
          summary: 'last sent html'
        }
      ]
    });
    const orchestrator = {
      getOrCreateSession: vi.fn().mockReturnValue(session),
      execute: vi.fn().mockResolvedValue({
        content: 'Here is the report.',
        replyTo: 'msg-1',
        attachments: [
          {
            id: 'outbound:exports/report.html',
            name: 'report.html',
            type: 'text/html',
            size: 19,
            url: outboundPath,
            localPath: outboundPath
          }
        ]
      }),
      registerRecentFiles: vi.fn().mockReturnValue(updatedSession)
    };
    const gateway = new AgentGateway({
      adapters: [adapter],
      commandHandler: commandHandler as unknown as CommandHandler,
      orchestrator: orchestrator as never,
      logger: { info: vi.fn(), error: vi.fn() }
    });

    await gateway.handleMessage(adapter, createMessage('make an html report'));

    expect(orchestrator.registerRecentFiles).toHaveBeenCalledWith(
      'session-1',
      [
        expect.objectContaining({
          source: 'claude_outbound',
          relativePath: 'exports/report.html',
          summary: 'last sent html'
        })
      ]
    );

    expect(
      JSON.parse(readFileSync(join(workingDirectory, '.claude-gateway', 'memory', 'recent-files.json'), 'utf8'))
    ).toEqual({
      recentFiles: [
        expect.objectContaining({
          source: 'claude_outbound',
          relativePath: 'exports/report.html',
          summary: 'last sent html'
        })
      ]
    });
  });

  it('uploads explicit bridge handoff attachments without owning the delivery policy', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'gateway-bridge-outbound-'));
    tempDirectories.push(workingDirectory);
    mkdirSync(join(workingDirectory, 'exports'), { recursive: true });
    const outboundPath = join(workingDirectory, 'exports', 'site-bundle.zip');
    writeFileSync(outboundPath, 'zip bytes');

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
    const session = createSession({ workingDirectory, recentFiles: [] });
    const updatedSession = createSession({
      workingDirectory,
      recentFiles: [
        {
          id: 'claude_outbound:exports/site-bundle.zip',
          displayName: 'site-bundle.zip',
          relativePath: 'exports/site-bundle.zip',
          absolutePath: outboundPath,
          source: 'claude_outbound',
          mediaType: 'application/zip',
          lastSeenAt: new Date('2026-04-02T00:00:00.000Z'),
          summary: 'last sent file'
        }
      ]
    });
    const orchestrator = {
      getOrCreateSession: vi.fn().mockReturnValue(session),
      execute: vi.fn().mockResolvedValue({
        content: '已处理完成。',
        replyTo: 'msg-1',
        attachments: [
          {
            id: 'outbound:exports/site-bundle.zip',
            name: 'site-bundle.zip',
            type: 'application/zip',
            size: 9,
            url: outboundPath,
            localPath: outboundPath
          }
        ]
      }),
      registerRecentFiles: vi.fn().mockReturnValue(updatedSession)
    };
    const gateway = new AgentGateway({
      adapters: [adapter],
      commandHandler: commandHandler as unknown as CommandHandler,
      orchestrator: orchestrator as never,
      logger: { info: vi.fn(), error: vi.fn() }
    });

    await gateway.handleMessage(adapter, createMessage('发给我'));

    expect(adapter.send).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            name: 'site-bundle.zip',
            localPath: outboundPath
          })
        ]
      })
    );
  });

  it('keeps handling messages when mirroring recent-files memory fails', async () => {
    const recentFilesModule = await import('../../src/core/recent-files');
    const writeRecentFilesMemorySpy = vi
      .spyOn(recentFilesModule, 'writeRecentFilesMemory')
      .mockImplementation(() => {
        throw new Error('disk full');
      });

    const workingDirectory = mkdtempSync(join(tmpdir(), 'gateway-memory-failure-'));
    tempDirectories.push(workingDirectory);
    mkdirSync(join(workingDirectory, '.claude-gateway', 'inbox', 'channel-1'), { recursive: true });
    const sourcePath = join(workingDirectory, '.claude-gateway', 'inbox', 'channel-1', 'att-1-budget.xlsx');
    writeFileSync(sourcePath, 'budget bytes');

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
    const session = createSession({ workingDirectory, recentFiles: [] });
    const logger = {
      info: vi.fn(),
      error: vi.fn()
    };
    const updatedSession = createSession({
      workingDirectory,
      recentFiles: [
        {
          id: 'discord_inbound:att-1',
          displayName: 'budget.xlsx',
          relativePath: '.claude-gateway/inbox/channel-1/att-1-budget.xlsx',
          absolutePath: sourcePath,
          source: 'discord_inbound',
          mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          lastSeenAt: new Date('2026-04-01T00:00:00.000Z'),
          summary: 'inbound excel'
        }
      ]
    });
    const orchestrator = {
      getOrCreateSession: vi.fn().mockReturnValue(session),
      execute: vi.fn().mockResolvedValue({ content: 'Claude response', replyTo: 'msg-1' }),
      registerRecentFiles: vi.fn().mockReturnValue(updatedSession)
    };
    const gateway = new AgentGateway({
      adapters: [adapter],
      commandHandler: commandHandler as unknown as CommandHandler,
      orchestrator: orchestrator as never,
      logger
    });

    await gateway.handleMessage(
      adapter,
      createMessage('edit this workbook', {
        attachments: [
          {
            id: 'att-1',
            name: 'budget.xlsx',
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            size: 12,
            url: 'https://cdn.discordapp.com/attachments/att-1',
            localPath: sourcePath
          }
        ]
      })
    );

    expect(orchestrator.execute).toHaveBeenCalled();
    expect(adapter.send).toHaveBeenCalledWith('channel-1', {
      content: 'Claude response',
      replyTo: 'msg-1'
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        workingDirectory,
        error: 'disk full'
      }),
      'Failed to mirror recent files memory'
    );

    writeRecentFilesMemorySpy.mockRestore();
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

  it('serializes messages for the same channel session', async () => {
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

    let resolveFirst!: (value: { content: string; replyTo?: string }) => void;
    const execute = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ content: string; replyTo?: string }>((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce({ content: 'second response', replyTo: 'msg-2' });

    const orchestrator = {
      getOrCreateSession: vi.fn().mockReturnValue(createSession()),
      execute
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

    const first = gateway.handleMessage(adapter, createMessage('first', { id: 'msg-1' }));
    await Promise.resolve();
    await Promise.resolve();
    const second = gateway.handleMessage(adapter, createMessage('second', { id: 'msg-2' }));
    await Promise.resolve();
    await Promise.resolve();

    expect(execute).toHaveBeenCalledTimes(1);

    resolveFirst({ content: 'first response', replyTo: 'msg-1' });
    await first;
    await second;

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenNthCalledWith(1, 'session-1', expect.objectContaining({ id: 'msg-1' }));
    expect(execute).toHaveBeenNthCalledWith(2, 'session-1', expect.objectContaining({ id: 'msg-2' }));
  });

  it('keeps Discord typing active while waiting for a Claude response', async () => {
    vi.useFakeTimers();

    const adapter: ChannelAdapter = {
      type: 'discord',
      name: 'Discord',
      onMessage: vi.fn(),
      send: vi.fn().mockResolvedValue({ messageId: '1', success: true }),
      typing: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn()
    };
    const commandHandler = {
      executeFromMessage: vi.fn()
    };

    let resolveResponse!: (value: { content: string; replyTo?: string }) => void;
    const execute = vi.fn().mockImplementation(
      () =>
        new Promise<{ content: string; replyTo?: string }>((resolve) => {
          resolveResponse = resolve;
        })
    );
    const orchestrator = {
      getOrCreateSession: vi.fn().mockReturnValue(createSession()),
      execute
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

    const pending = gateway.handleMessage(adapter, createMessage('hello world'));
    await Promise.resolve();
    await Promise.resolve();
    expect(adapter.typing).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(8000);
    expect(adapter.typing).toHaveBeenCalledTimes(2);

    resolveResponse({ content: 'Claude response', replyTo: 'msg-1' });
    await pending;
    await vi.advanceTimersByTimeAsync(8000);

    expect(adapter.typing).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('logs the full error payload and sends a fallback message when handling fails', async () => {
    const onMessage = vi.fn();
    const adapter: ChannelAdapter = {
      type: 'discord',
      name: 'Discord',
      onMessage,
      send: vi.fn().mockResolvedValue({ messageId: '1', success: true }),
      initialize: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn()
    };
    const commandHandler = {
      executeFromMessage: vi.fn()
    };
    const failure = Object.assign(new Error('claude failed'), {
      stdout: 'partial output',
      stderr: 'permission denied',
      exitCode: 1
    });
    const orchestrator = {
      getOrCreateSession: vi.fn().mockReturnValue(createSession()),
      execute: vi.fn().mockRejectedValue(failure)
    };
    const logger = { info: vi.fn(), error: vi.fn() };
    const gateway = new AgentGateway({
      adapters: [adapter],
      commandHandler: commandHandler as unknown as CommandHandler,
      orchestrator: orchestrator as unknown as {
        getOrCreateSession: (channelId: string, channelType: string) => SessionProfile;
        execute: (sessionId: string, message: AgentMessage) => Promise<{ content: string }>;
      },
      logger
    });

    await gateway.start();
    const callback = onMessage.mock.calls[0]?.[0] as ((message: AgentMessage) => void) | undefined;
    const message = createMessage('hello world');

    callback?.(message);
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'channel-1',
        error: 'claude failed',
        stack: expect.any(String),
        stdout: 'partial output',
        stderr: 'permission denied',
        exitCode: 1
      }),
      'Message handling failed'
    );
    expect(adapter.send).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({
        content: expect.stringContaining('claude failed'),
        replyTo: 'msg-1'
      })
    );
  });

  it('registers control callbacks and routes a control input through the control router', async () => {
    const onControlInput = vi.fn();
    const adapter: ChannelAdapter = {
      type: 'discord',
      name: 'Discord',
      onMessage: vi.fn(),
      onControlInput,
      send: vi.fn().mockResolvedValue({ messageId: '1', success: true }),
      initialize: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn()
    };
    const controlRouter = { resolve: vi.fn().mockReturnValue(null) };
    const controlSync = { start: vi.fn(), stop: vi.fn() };
    const commandHandler = {
      executeFromMessage: vi.fn()
    };
    const orchestrator = {
      getOrCreateSession: vi.fn(),
      execute: vi.fn()
    };
    const gateway = new AgentGateway({
      adapters: [adapter],
      commandHandler: commandHandler as unknown as CommandHandler,
      orchestrator: orchestrator as unknown as {
        getOrCreateSession: (channelId: string, channelType: string) => SessionProfile;
        execute: (sessionId: string, message: AgentMessage) => Promise<{ content: string }>;
      },
      controlRouter: controlRouter as { resolve: (input: ChannelControlInput) => unknown },
      controlSync: controlSync as { start: () => void; stop: () => void },
      logger: { info: vi.fn(), error: vi.fn() }
    });

    await gateway.start();

    expect(adapter.onControlInput).toHaveBeenCalledTimes(1);
    expect(controlSync.start).toHaveBeenCalled();

    // Simulate control input callback being invoked
    const controlCallback = onControlInput.mock.calls[0]?.[0] as ((input: ChannelControlInput) => void) | undefined;
    const input: ChannelControlInput = {
      channelType: 'discord',
      channelId: 'channel-1',
      messageId: 'msg-1',
      signal: 'approve',
      userId: 'user-1',
      interactionType: 'reaction',
      rawValue: '👍',
      timestamp: new Date('2026-03-31T01:30:00.000Z')
    };
    controlCallback?.(input);

    expect(controlRouter.resolve).toHaveBeenCalledWith(input);

    await gateway.stop();
    expect(controlSync.stop).toHaveBeenCalled();
  });

  it('keeps normal chat routing intact while also accepting control input', async () => {
    const onControlInput = vi.fn();
    const adapter: ChannelAdapter = {
      type: 'discord',
      name: 'Discord',
      onMessage: vi.fn(),
      onControlInput,
      send: vi.fn().mockResolvedValue({ messageId: '1', success: true }),
      initialize: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn()
    };
    const controlRouter = { resolve: vi.fn().mockReturnValue(null) };
    const controlSync = { start: vi.fn(), stop: vi.fn() };
    const commandHandler = {
      executeFromMessage: vi.fn().mockResolvedValue({ success: true, message: 'Done.' })
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
      controlRouter: controlRouter as { resolve: (input: ChannelControlInput) => unknown },
      controlSync: controlSync as { start: () => void; stop: () => void },
      logger: { info: vi.fn(), error: vi.fn() }
    });

    await gateway.handleMessage(adapter, createMessage('normal chat'));

    expect(orchestrator.execute).toHaveBeenCalledTimes(1);
    expect(orchestrator.execute).toHaveBeenCalledWith('session-1', expect.objectContaining({ content: 'normal chat' }));
    expect(controlRouter.resolve).not.toHaveBeenCalled();
  });

  it('does not route plain messages from control projection threads into Claude sessions', async () => {
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
      getOrCreateSession: vi.fn().mockReturnValue(createSession({ id: 'thread-session', channelId: 'thread-1' })),
      execute: vi.fn().mockResolvedValue({ content: 'Claude response' })
    };
    const gateway = new AgentGateway({
      adapters: [adapter],
      commandHandler: commandHandler as unknown as CommandHandler,
      orchestrator: orchestrator as unknown as {
        getOrCreateSession: (channelId: string, channelType: string) => SessionProfile;
        execute: (sessionId: string, message: AgentMessage) => Promise<{ content: string }>;
      },
      controlStore: {
        findProjectionByThreadId: vi.fn().mockReturnValue({
          runId: 'run-1',
          channelType: 'discord',
          channelId: 'channel-1',
          threadId: 'thread-1',
          title: 'Architect Agent',
          updatedAt: new Date('2026-03-31T13:00:00.000Z')
        })
      } as {
        findProjectionByThreadId: (channelType: string, threadId: string) => unknown;
      },
      logger: { info: vi.fn(), error: vi.fn() }
    });

    await gateway.handleMessage(
      adapter,
      createMessage('继续', {
        id: 'msg-thread-1',
        channelId: 'thread-1'
      })
    );

    expect(orchestrator.getOrCreateSession).not.toHaveBeenCalled();
    expect(orchestrator.execute).not.toHaveBeenCalled();
    expect(adapter.send).toHaveBeenCalledWith('thread-1', {
      content: 'This thread is reserved for control updates. Reply to a control message instead of sending a new conversation message.',
      replyTo: 'msg-thread-1'
    });
  });
});
