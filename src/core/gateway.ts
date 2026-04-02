import { copyFileSync, existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { ChannelAdapter } from './adapter';
import { createRecentFileRecord, writeRecentFilesMemory } from './recent-files';
import { AgentMessage, Attachment, ChannelControlInput, RecentFileRecord, RecentFileSource, SessionProfile } from './types';
import { SessionOrchestrator } from './orchestrator';
import { CommandHandler } from '../commands';
import { CommandContext } from '../commands/types';
import { sanitizeAttachmentName } from './attachments';

interface GatewayOptions {
  adapters: ChannelAdapter[];
  commandHandler: CommandHandler;
  orchestrator: SessionOrchestrator & {
    registerRecentFiles?: SessionOrchestrator['registerRecentFiles'];
  };
  controlStore?: {
    findProjectionByThreadId: (channelType: string, threadId: string) => unknown;
  };
  controlRouter?: {
    resolve: (input: ChannelControlInput) => unknown;
  };
  controlSync?: {
    start: () => void;
    stop: () => void;
  };
  logger: {
    info: (data: unknown, message: string) => void;
    error: (data: unknown, message: string) => void;
  };
}

export class AgentGateway {
  private static readonly TYPING_INTERVAL_MS = 8000;
  private readonly channelQueues = new Map<string, Promise<void>>();

  constructor(private readonly options: GatewayOptions) {}

  async start(): Promise<void> {
    for (const adapter of this.options.adapters) {
      adapter.onMessage((message) => {
        void this.processIncomingMessage(adapter, message);
      });
      adapter.onControlInput?.((input) => {
        this.options.controlRouter?.resolve(input);
      });
      await adapter.connect();
    }
    this.options.controlSync?.start();
  }

  async stop(): Promise<void> {
    this.options.controlSync?.stop();
    await Promise.all(this.options.adapters.map((adapter) => adapter.disconnect()));
  }

  async handleMessage(adapter: ChannelAdapter, message: AgentMessage): Promise<void> {
    const channelKey = `${message.channelType}:${message.channelId}`;
    const previous = this.channelQueues.get(channelKey) ?? Promise.resolve();

    const current = previous
      .catch(() => undefined)
      .then(async () => {
        await this.handleMessageNow(adapter, message);
      });

    this.channelQueues.set(channelKey, current);

    try {
      await current;
    } finally {
      if (this.channelQueues.get(channelKey) === current) {
        this.channelQueues.delete(channelKey);
      }
    }
  }

  private async handleMessageNow(adapter: ChannelAdapter, message: AgentMessage): Promise<void> {
    if (this.options.controlStore?.findProjectionByThreadId(message.channelType, message.channelId)) {
      await adapter.send(message.channelId, {
        content:
          'This thread is reserved for control updates. Reply to a control message instead of sending a new conversation message.',
        replyTo: message.id
      });
      return;
    }

    this.options.logger.info({ channelId: message.channelId, content: message.content.substring(0, 100) }, 'Message received');
    const session = this.options.orchestrator.getOrCreateSession(message.channelId, message.channelType);
    const normalizedMessage = this.normalizeMessageAttachments(message, session.workingDirectory);
    const inboundRecentFiles = this.toRecentFiles(
      session.workingDirectory,
      normalizedMessage.attachments ?? [],
      'discord_inbound',
      message.timestamp
    );

    if (inboundRecentFiles.length > 0) {
      const updatedSession = this.options.orchestrator.registerRecentFiles?.(session.id, inboundRecentFiles);
      this.mirrorRecentFilesMemory(session.workingDirectory, updatedSession);
    }

    if (normalizedMessage.content.startsWith('/')) {
      this.options.logger.info({ channelId: normalizedMessage.channelId, content: normalizedMessage.content }, 'Executing command');
      const context: CommandContext = {
        session,
        message: normalizedMessage,
        orchestrator: this.options.orchestrator
      };
      const result = await this.options.commandHandler.executeFromMessage(normalizedMessage, context);
      await adapter.send(normalizedMessage.channelId, { content: result.message ?? 'Done.', replyTo: normalizedMessage.id });
      return;
    }

    this.options.logger.info({ channelId: normalizedMessage.channelId, sessionId: session.id }, 'Sending message to Claude');
    const stopTyping = await this.startTyping(adapter, normalizedMessage.channelId);

    try {
      const response = await this.options.orchestrator.execute(session.id, normalizedMessage);
      if (response.metadata?.recentFileCandidates?.length) {
        const updatedSession = this.options.orchestrator.registerRecentFiles?.(session.id, response.metadata.recentFileCandidates);
        this.mirrorRecentFilesMemory(session.workingDirectory, updatedSession);
      }

      const sendResult = await adapter.send(normalizedMessage.channelId, response);

      if (sendResult.success && response.attachments?.length) {
        const outboundRecentFiles = this.toRecentFiles(
          session.workingDirectory,
          response.attachments,
          'claude_outbound',
          new Date()
        );

        if (outboundRecentFiles.length > 0) {
          const updatedSession = this.options.orchestrator.registerRecentFiles?.(session.id, outboundRecentFiles);
          this.mirrorRecentFilesMemory(session.workingDirectory, updatedSession);
        }
      }
    } finally {
      stopTyping();
    }
  }

  private async processIncomingMessage(adapter: ChannelAdapter, message: AgentMessage): Promise<void> {
    try {
      await this.handleMessage(adapter, message);
    } catch (error) {
      this.options.logger.error(this.serializeError(message.channelId, error), 'Message handling failed');

      try {
        await adapter.send(message.channelId, {
          content: `Request failed: ${error instanceof Error ? error.message : String(error)}`,
          replyTo: message.id
        });
      } catch (sendError) {
        this.options.logger.error(this.serializeError(message.channelId, sendError), 'Failed to send error message');
      }
    }
  }

  private async startTyping(adapter: ChannelAdapter, channelId: string): Promise<() => void> {
    if (!adapter.typing) {
      return () => undefined;
    }

    await adapter.typing(channelId);

    const timer = setInterval(() => {
      void adapter.typing?.(channelId).catch((error) => {
        this.options.logger.error(this.serializeError(channelId, error), 'Typing indicator failed');
      });
    }, AgentGateway.TYPING_INTERVAL_MS);

    timer.unref?.();

    return () => {
      clearInterval(timer);
    };
  }

  private serializeError(channelId: string, error: unknown): Record<string, unknown> {
    if (!(error instanceof Error)) {
      return {
        channelId,
        error: String(error)
      };
    }

    const withDetails = error as Error & {
      details?: Record<string, unknown>;
      stdout?: string;
      stderr?: string;
      exitCode?: number;
    };

    return {
      channelId,
      error: error.message,
      stack: error.stack,
      ...withDetails.details,
      stdout: withDetails.stdout,
      stderr: withDetails.stderr,
      exitCode: withDetails.exitCode
    };
  }

  private normalizeMessageAttachments(message: AgentMessage, workingDirectory: string): AgentMessage {
    if (!message.attachments?.length) {
      return message;
    }

    return {
      ...message,
      attachments: message.attachments.map((attachment) => {
        if (!attachment.localPath || !existsSync(attachment.localPath) || this.isInsideDirectory(workingDirectory, attachment.localPath)) {
          return attachment;
        }

        const targetPath = join(
          workingDirectory,
          '.claude-gateway',
          'inbox',
          sanitizeAttachmentName(message.channelId),
          `${sanitizeAttachmentName(attachment.id)}-${sanitizeAttachmentName(attachment.name)}`
        );

        mkdirSync(join(workingDirectory, '.claude-gateway', 'inbox', sanitizeAttachmentName(message.channelId)), { recursive: true });
        copyFileSync(attachment.localPath, targetPath);

        return {
          ...attachment,
          localPath: targetPath
        };
      })
    };
  }

  private isInsideDirectory(directory: string, candidatePath: string): boolean {
    const absoluteDirectory = resolve(directory);
    const resolvedDirectory = realpathSync(absoluteDirectory);
    const absoluteCandidatePath = resolve(candidatePath);
    const resolvedCandidatePath =
      existsSync(absoluteCandidatePath) || this.pathHasSymlink(absoluteCandidatePath)
        ? realpathSync(absoluteCandidatePath)
        : absoluteCandidatePath;

    return (
      resolvedCandidatePath === resolvedDirectory ||
      resolvedCandidatePath.startsWith(`${resolvedDirectory}${sep}`)
    );
  }

  private pathHasSymlink(candidatePath: string): boolean {
    let currentPath = resolve(candidatePath);

    while (currentPath.length > 1 && currentPath !== '.') {
      if (existsSync(currentPath) && lstatSync(currentPath).isSymbolicLink()) {
        return true;
      }

      const parentPath = resolve(currentPath, '..');
      if (parentPath === currentPath) {
        break;
      }
      currentPath = parentPath;
    }

    return false;
  }

  private mirrorRecentFilesMemory(workingDirectory: string, session?: Pick<SessionProfile, 'recentFiles'>): void {
    if (!session?.recentFiles) {
      return;
    }

    try {
      writeRecentFilesMemory(workingDirectory, session.recentFiles);
    } catch (error) {
      this.options.logger.error(
        {
          workingDirectory,
          error: error instanceof Error ? error.message : String(error)
        },
        'Failed to mirror recent files memory'
      );
    }
  }

  private toRecentFiles(
    workingDirectory: string,
    attachments: Attachment[],
    source: RecentFileSource,
    seenAt: Date
  ): RecentFileRecord[] {
    return attachments
      .filter((attachment) => attachment.localPath && existsSync(attachment.localPath) && this.isInsideDirectory(workingDirectory, attachment.localPath))
      .map((attachment) =>
        createRecentFileRecord({
          id: `${source}:${attachment.id}`,
          workingDirectory,
          absolutePath: attachment.localPath!,
          displayName: attachment.name,
          source,
          mediaType: attachment.type,
          lastSeenAt: seenAt
        })
      );
  }
}
