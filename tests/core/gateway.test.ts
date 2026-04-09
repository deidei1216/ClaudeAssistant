import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentGateway } from '../../core/gateway';
import { ChannelAdapter } from '../../core/adapter';
import { AgentMessage, SessionProfile } from '../../core/types';
import { SessionOrchestrator } from '../../core/orchestrator';
import { CommandHandler } from '../../commands';

type GatewayOrchestrator = {
  getOrCreateSession: SessionOrchestrator['getOrCreateSession'];
  execute: SessionOrchestrator['execute'];
  registerRecentFiles?: SessionOrchestrator['registerRecentFiles'];
};

type AdapterDouble = ChannelAdapter & {
  onMessage: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  initialize?: ReturnType<typeof vi.fn>;
  setTyping?: ReturnType<typeof vi.fn>;
  stop?: ReturnType<typeof vi.fn>;
};

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

  const createAdapter = (overrides?: Partial<AdapterDouble>): AdapterDouble => ({
    type: 'discord',
    onMessage: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue({ messageId: '1', success: true }),
    initialize: vi.fn(),
    stop: vi.fn(),
    ...overrides
  });

  it('routes slash commands to the command handler and normal messages to the orchestrator', async () => {
    const adapter = createAdapter();
    const commandHandler = {
      executeFromMessage: vi.fn().mockResolvedValue({ success: true, message: 'Model updated to opus.' })
    };
    const orchestrator = {
      getOrCreateSession: vi.fn().mockReturnValue({ id: 'session-1', workingDirectory: '.' }),
      execute: vi.fn().mockResolvedValue({ content: 'Claude response' })
    };
    const gateway = new AgentGateway({
      adapters: [adapter],
      commandHandler: commandHandler as unknown as CommandHandler,
      orchestrator: orchestrator as GatewayOrchestrator,
      logger: { info: vi.fn(), error: vi.fn() }
    });

    await gateway.handleMessage(adapter, createMessage('/help'));

    await gateway.handleMessage(adapter, createMessage('hello', { id: 'msg-2' }));

    expect(commandHandler.executeFromMessage).toHaveBeenCalledTimes(1);
    expect(orchestrator.execute).toHaveBeenCalledTimes(1);
    expect(adapter.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('routes ordinary gateway traffic without requiring control dependencies', async () => {
    const adapter = createAdapter();
    const gateway = new AgentGateway({
      adapters: [adapter],
      commandHandler: { executeFromMessage: vi.fn() } as unknown as CommandHandler,
      orchestrator: {
        getOrCreateSession: vi.fn(),
        execute: vi.fn()
      } as unknown as GatewayOrchestrator,
      logger: { info: vi.fn(), error: vi.fn() }
    });

    await gateway.start();

    expect(adapter.onMessage).toHaveBeenCalledTimes(1);
    expect(adapter.type).toBe('discord');
    expect(typeof adapter.sendMessage).toBe('function');
    expect('onControlInput' in adapter).toBe(false);
  });

  it('sends command response to the adapter', async () => {
    const adapter = createAdapter();
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
      orchestrator: orchestrator as GatewayOrchestrator,
      logger: { info: vi.fn(), error: vi.fn() }
    });

    const message = createMessage('/model opus');
    await gateway.handleMessage(adapter, message);

    expect(adapter.sendMessage).toHaveBeenCalledWith('channel-1', 'Model updated to opus.', {
      replyTo: 'msg-1'
    });
  });

  it('sends orchestrator response to the adapter for non-command messages', async () => {
    const adapter = createAdapter();
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
      orchestrator: orchestrator as GatewayOrchestrator,
      logger: { info: vi.fn(), error: vi.fn() }
    });

    const message = createMessage('hello world');
    await gateway.handleMessage(adapter, message);

    expect(orchestrator.execute).toHaveBeenCalledWith('session-1', message);
    expect(adapter.sendMessage).toHaveBeenCalledWith('channel-1', 'Claude response', {
      replyTo: 'msg-1'
    });
  });

  it('copies inbound attachments into the session uploads directory before executing Claude', async () => {
    const sessionRoot = mkdtempSync(join(tmpdir(), 'gateway-session-'));
    const workingDirectory = join(sessionRoot, 'workspace');
    mkdirSync(workingDirectory, { recursive: true });
    tempDirectories.push(sessionRoot);
    
    const sourceDir = mkdtempSync(join(tmpdir(), 'gateway-source-'));
    tempDirectories.push(sourceDir);
    const sourcePath = join(sourceDir, 'att-1-report.txt');
    writeFileSync(sourcePath, 'attachment payload');

    const adapter = createAdapter();
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
      orchestrator: orchestrator as GatewayOrchestrator,
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
      expect.stringContaining(`${sessionRoot}/uploads/att-1-report.txt`)
    );
    expect(readFileSync(forwardedAttachment?.localPath ?? '', 'utf8')).toBe('attachment payload');
    expect(adapter.sendMessage).toHaveBeenCalledWith('channel-1', 'Claude response', {
      replyTo: 'msg-1'
    });
  });

  it('registers normalized inbound attachments in session recent files and mirrors workspace memory', async () => {
    const sessionRoot = mkdtempSync(join(tmpdir(), 'gateway-session-'));
    const workingDirectory = join(sessionRoot, 'workspace');
    mkdirSync(workingDirectory, { recursive: true });
    tempDirectories.push(sessionRoot);

    const sourcePath = join(sessionRoot, 'uploads', 'att-1-budget.xlsx');
    mkdirSync(join(sessionRoot, 'uploads'), { recursive: true });
    writeFileSync(sourcePath, 'budget bytes');
    const recentFile = {
      id: 'discord_inbound:att-1',
      displayName: 'budget.xlsx',
      relativePath: 'uploads/att-1-budget.xlsx',
      absolutePath: sourcePath,
      source: 'discord_inbound' as const,
      mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      lastSeenAt: new Date('2026-03-30T00:00:00.000Z'),
      summary: 'inbound excel'
    };

    const adapter = createAdapter();
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
      orchestrator: orchestrator as GatewayOrchestrator,
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
        expect.objectContaining({
          id: 'discord_inbound:att-1',
          absolutePath: sourcePath
        })
      ]
    );

    expect(
      JSON.parse(readFileSync(join(workingDirectory, '.claude-gateway', 'memory', 'recent-files.json'), 'utf8'))
    ).toEqual({
      recentFiles: [
        expect.objectContaining({
          source: 'discord_inbound',
          absolutePath: sourcePath,
          summary: 'inbound excel'
        })
      ]
    });
  });

  it('defensively copies symlinked attachment paths that escape the working directory', async () => {
    const outsideRoot = mkdtempSync(join(tmpdir(), 'gateway-outside-'));
    const sessionRoot = mkdtempSync(join(tmpdir(), 'gateway-session-'));
    const workingDirectory = join(sessionRoot, 'workspace');
    mkdirSync(workingDirectory, { recursive: true });
    tempDirectories.push(outsideRoot, sessionRoot);

    mkdirSync(join(outsideRoot, 'attachments'), { recursive: true });
    mkdirSync(join(workingDirectory, 'linked'), { recursive: true });
    const outsidePath = join(outsideRoot, 'attachments', 'att-2-report.txt');
    const symlinkPath = join(workingDirectory, 'linked', 'att-2-report.txt');
    writeFileSync(outsidePath, 'symlink attachment payload');
    symlinkSync(outsidePath, symlinkPath);

    const adapter = createAdapter();
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
      orchestrator: orchestrator as GatewayOrchestrator,
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
      expect.stringContaining(`${sessionRoot}/uploads/att-2-report.txt`)
    );
    expect(forwardedAttachment?.localPath).not.toBe(symlinkPath);
    expect(readFileSync(forwardedAttachment?.localPath ?? '', 'utf8')).toBe('symlink attachment payload');
  });

  it('does not register arbitrary worker artifact candidates from deprecated response metadata', async () => {
    const sessionRoot = mkdtempSync(join(tmpdir(), 'gateway-worker-'));
    const workingDirectory = join(sessionRoot, 'workspace');
    mkdirSync(workingDirectory, { recursive: true });
    tempDirectories.push(sessionRoot);
    
    const adapter = createAdapter();
    const commandHandler = {
      executeFromMessage: vi.fn()
    };
    const session = createSession({ workingDirectory, recentFiles: [] });
    const updatedSession = createSession({
      workingDirectory,
      recentFiles: [
        {
          id: 'discord_inbound:att-1',
          displayName: 'report.html',
          relativePath: 'uploads/att-1-report.html',
          absolutePath: join(sessionRoot, 'uploads', 'att-1-report.html'),
          source: 'discord_inbound',
          mediaType: 'text/html',
          lastSeenAt: new Date('2026-04-01T00:00:00.000Z'),
          summary: 'inbound html'
        }
      ]
    });
    const orchestrator = {
      getOrCreateSession: vi.fn().mockReturnValue(session),
      execute: vi.fn().mockResolvedValue({
        content: 'Saved report to outputs/report.html',
        replyTo: 'msg-1'
      }),
      registerRecentFiles: vi.fn().mockReturnValue(updatedSession)
    };
    const gateway = new AgentGateway({
      adapters: [adapter],
      commandHandler: commandHandler as unknown as CommandHandler,
      orchestrator: orchestrator as GatewayOrchestrator,
      logger: { info: vi.fn(), error: vi.fn() }
    });

    await gateway.handleMessage(adapter, createMessage('make an html report'));

    expect(orchestrator.registerRecentFiles).not.toHaveBeenCalledWith(
      'session-1',
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: 'outputs/report.html'
        })
      ])
    );

    expect(() =>
      readFileSync(join(workingDirectory, '.claude-gateway', 'memory', 'recent-files.json'), 'utf8')
    ).toThrow();
  });

  it('refreshes recent file memory after a successful published outbound send', async () => {
    const sessionRoot = mkdtempSync(join(tmpdir(), 'gateway-outbound-'));
    const workingDirectory = join(sessionRoot, 'workspace');
    mkdirSync(workingDirectory, { recursive: true });
    tempDirectories.push(sessionRoot);
    
    mkdirSync(join(workingDirectory, '.deliveries', 'exports'), { recursive: true });
    const outboundPath = join(workingDirectory, '.deliveries', 'exports', 'report.html');
    writeFileSync(outboundPath, '<html>report</html>');

    const adapter = createAdapter();
    const commandHandler = {
      executeFromMessage: vi.fn()
    };
    const session = createSession({ workingDirectory, recentFiles: [] });
    const updatedSession = createSession({
      workingDirectory,
      recentFiles: [
        {
          id: 'claude_outbound:outbound:.deliveries/exports/report.html',
          displayName: 'report.html',
          relativePath: '.deliveries/exports/report.html',
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
            id: 'outbound:.deliveries/exports/report.html',
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
      orchestrator: orchestrator as GatewayOrchestrator,
      logger: { info: vi.fn(), error: vi.fn() }
    });

    await gateway.handleMessage(adapter, createMessage('make an html report'));

    expect(orchestrator.registerRecentFiles).toHaveBeenCalledWith(
      'session-1',
      [
        expect.objectContaining({
          source: 'claude_outbound',
          relativePath: '.deliveries/exports/report.html',
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
          relativePath: '.deliveries/exports/report.html',
          summary: 'last sent html'
        })
      ]
    });
  });

  it('does not mirror unpublished outbound attachments into recent files memory', async () => {
    const sessionRoot = mkdtempSync(join(tmpdir(), 'gateway-unpublished-outbound-'));
    const workingDirectory = join(sessionRoot, 'workspace');
    mkdirSync(join(workingDirectory, 'exports'), { recursive: true });
    tempDirectories.push(sessionRoot);

    const outboundPath = join(workingDirectory, 'exports', 'report.html');
    writeFileSync(outboundPath, '<html>report</html>');

    const adapter = createAdapter();
    const commandHandler = {
      executeFromMessage: vi.fn()
    };
    const session = createSession({ workingDirectory, recentFiles: [] });
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
      registerRecentFiles: vi.fn().mockReturnValue(session)
    };
    const gateway = new AgentGateway({
      adapters: [adapter],
      commandHandler: commandHandler as unknown as CommandHandler,
      orchestrator: orchestrator as GatewayOrchestrator,
      logger: { info: vi.fn(), error: vi.fn() }
    });

    await gateway.handleMessage(adapter, createMessage('make an html report'));

    expect(orchestrator.registerRecentFiles).not.toHaveBeenCalledWith(
      'session-1',
      expect.arrayContaining([
        expect.objectContaining({
          absolutePath: outboundPath
        })
      ])
    );

    expect(adapter.sendMessage).toHaveBeenCalledWith(
      'channel-1',
      'Here is the report.',
      {
        replyTo: 'msg-1'
      }
    );
  });

  it('does not forward symlink-escaped outbound attachments even when they are lexically inside deliveries', async () => {
    const sessionRoot = mkdtempSync(join(tmpdir(), 'gateway-symlink-outbound-'));
    const workingDirectory = join(sessionRoot, 'workspace');
    const outsideDirectory = mkdtempSync(join(tmpdir(), 'gateway-symlink-outside-'));
    tempDirectories.push(sessionRoot, outsideDirectory);
    mkdirSync(join(workingDirectory, '.deliveries'), { recursive: true });
    symlinkSync(outsideDirectory, join(workingDirectory, '.deliveries', 'linked'));

    const escapedPath = join(workingDirectory, '.deliveries', 'linked', 'report.html');
    writeFileSync(join(outsideDirectory, 'report.html'), '<html>report</html>');

    const adapter = createAdapter();
    const session = createSession({ workingDirectory, recentFiles: [] });
    const orchestrator = {
      getOrCreateSession: vi.fn().mockReturnValue(session),
      execute: vi.fn().mockResolvedValue({
        content: 'Here is the report.',
        replyTo: 'msg-1',
        attachments: [
          {
            id: 'outbound:.deliveries/linked/report.html',
            name: 'report.html',
            type: 'text/html',
            size: 19,
            url: escapedPath,
            localPath: escapedPath
          }
        ]
      }),
      registerRecentFiles: vi.fn().mockReturnValue(session)
    };
    const gateway = new AgentGateway({
      adapters: [adapter],
      commandHandler: { executeFromMessage: vi.fn() } as unknown as CommandHandler,
      orchestrator: orchestrator as GatewayOrchestrator,
      logger: { info: vi.fn(), error: vi.fn() }
    });

    await gateway.handleMessage(adapter, createMessage('send the report'));

    expect(adapter.sendMessage).toHaveBeenCalledWith(
      'channel-1',
      'Here is the report.',
      {
        replyTo: 'msg-1'
      }
    );
    expect(orchestrator.registerRecentFiles).not.toHaveBeenCalled();
  });

  it('filters unpublished outbound attachments before sending them to the adapter', async () => {
    const sessionRoot = mkdtempSync(join(tmpdir(), 'gateway-bridge-outbound-'));
    const workingDirectory = join(sessionRoot, 'workspace');
    mkdirSync(workingDirectory, { recursive: true });
    tempDirectories.push(sessionRoot);
    
    mkdirSync(join(workingDirectory, 'exports'), { recursive: true });
    const outboundPath = join(workingDirectory, 'exports', 'site-bundle.zip');
    writeFileSync(outboundPath, 'zip bytes');

    const adapter = createAdapter();
    const commandHandler = {
      executeFromMessage: vi.fn()
    };
    const session = createSession({ workingDirectory, recentFiles: [] });
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
      registerRecentFiles: vi.fn().mockReturnValue(session)
    };
    const gateway = new AgentGateway({
      adapters: [adapter],
      commandHandler: commandHandler as unknown as CommandHandler,
      orchestrator: orchestrator as GatewayOrchestrator,
      logger: { info: vi.fn(), error: vi.fn() }
    });

    await gateway.handleMessage(adapter, createMessage('发给我'));

    expect(adapter.sendMessage).toHaveBeenCalledWith(
      'channel-1',
      '已处理完成。',
      {
        replyTo: 'msg-1'
      }
    );
    expect(orchestrator.registerRecentFiles).not.toHaveBeenCalled();
  });

  it('keeps handling messages when mirroring recent-files memory fails', async () => {
    const recentFilesModule = await import('../../core/recent-files');
    const writeRecentFilesMemorySpy = vi
      .spyOn(recentFilesModule, 'writeRecentFilesMemory')
      .mockImplementation(() => {
        throw new Error('disk full');
      });

    const sessionRoot = mkdtempSync(join(tmpdir(), 'gateway-memory-failure-'));
    const workingDirectory = join(sessionRoot, 'workspace');
    mkdirSync(workingDirectory, { recursive: true });
    tempDirectories.push(sessionRoot);
    
    mkdirSync(join(sessionRoot, 'uploads'), { recursive: true });
    const sourcePath = join(sessionRoot, 'uploads', 'att-1-budget.xlsx');
    writeFileSync(sourcePath, 'budget bytes');

    const adapter = createAdapter();
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
          relativePath: 'uploads/att-1-budget.xlsx',
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
    expect(adapter.sendMessage).toHaveBeenCalledWith('channel-1', 'Claude response', {
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
    const adapter = createAdapter();
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
      orchestrator: orchestrator as GatewayOrchestrator,
      logger: { info: vi.fn(), error: vi.fn() }
    });

    await gateway.handleMessage(adapter, createMessage('/status'));

    expect(orchestrator.getOrCreateSession).toHaveBeenCalledWith('channel-1', 'discord');
  });

  it('registers message handlers for all adapters on start', async () => {
    const adapter1 = createAdapter();
    const adapter2 = createAdapter({
      type: 'slack',
      sendMessage: vi.fn().mockResolvedValue({ messageId: '2', success: true })
    });
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
      orchestrator: orchestrator as GatewayOrchestrator,
      logger: { info: vi.fn(), error: vi.fn() }
    });

    await gateway.start();

    expect(adapter1.onMessage).toHaveBeenCalledTimes(1);
    expect(adapter2.onMessage).toHaveBeenCalledTimes(1);
  });

  it('stops all adapters that expose stop', async () => {
    const adapter1 = createAdapter();
    const adapter2 = createAdapter({
      type: 'slack',
      sendMessage: vi.fn().mockResolvedValue({ messageId: '2', success: true })
    });
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
      orchestrator: orchestrator as GatewayOrchestrator,
      logger: { info: vi.fn(), error: vi.fn() }
    });

    await gateway.stop();

    expect(adapter1.stop).toHaveBeenCalled();
    expect(adapter2.stop).toHaveBeenCalled();
  });

  it('serializes messages for the same channel session', async () => {
    const adapter = createAdapter();
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
      orchestrator: orchestrator as GatewayOrchestrator,
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

    const adapter = createAdapter({
      setTyping: vi.fn().mockResolvedValue(undefined)
    });
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
      orchestrator: orchestrator as GatewayOrchestrator,
      logger: { info: vi.fn(), error: vi.fn() }
    });

    const pending = gateway.handleMessage(adapter, createMessage('hello world'));
    await Promise.resolve();
    await Promise.resolve();
    expect(adapter.setTyping).toHaveBeenNthCalledWith(1, 'channel-1', true);

    await vi.advanceTimersByTimeAsync(8000);
    expect(adapter.setTyping).toHaveBeenNthCalledWith(2, 'channel-1', true);

    resolveResponse({ content: 'Claude response', replyTo: 'msg-1' });
    await pending;
    await vi.advanceTimersByTimeAsync(8000);

    expect(adapter.setTyping).toHaveBeenCalledTimes(3);
    expect(adapter.setTyping).toHaveBeenLastCalledWith('channel-1', false);
    vi.useRealTimers();
  });

  it('logs the full error payload and sends a fallback message when handling fails', async () => {
    const onMessage = vi.fn();
    const adapter = createAdapter({ onMessage });
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
      orchestrator: orchestrator as GatewayOrchestrator,
      logger
    });

    await gateway.start();
    const callback = onMessage.mock.calls[0]?.[0] as ((message: AgentMessage) => Promise<void>) | undefined;
    const message = createMessage('hello world');

    await callback?.(message);
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
    expect(adapter.sendMessage).toHaveBeenCalledWith(
      'channel-1',
      expect.stringContaining('claude failed'),
      expect.objectContaining({
        replyTo: 'msg-1'
      })
    );
  });

});
