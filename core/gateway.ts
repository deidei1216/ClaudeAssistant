import { copyFileSync, existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { ChannelAdapter, SendMessageOptions } from './adapter';
import { createRecentFileRecord, writeRecentFilesMemory } from './recent-files';
import { isWithinPublishedDeliveriesBoundary } from './delivery-paths';
import { AgentMessage, Attachment, RecentFileRecord, RecentFileSource, SessionProfile } from './types';
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
  aggregation?: {
    quietWindowMs?: number;
    maxWindowMs?: number;
  };
  logger: {
    info: (data: unknown, message: string) => void;
    error: (data: unknown, message: string) => void;
  };
}

interface PendingInboundTurn {
  adapter: ChannelAdapter;
  turnKey: string;
  channelKey: string;
  messages: AgentMessage[];
  quietTimer: NodeJS.Timeout;
  maxTimer: NodeJS.Timeout;
  startedAtMs: number;
  lastBufferedAtMs: number;
  completion: Promise<void>;
  resolveCompletion: () => void;
  rejectCompletion: (error?: unknown) => void;
}

export class AgentGateway {
  private static readonly TYPING_INTERVAL_MS = 8000;
  private static readonly DEFAULT_QUIET_WINDOW_MS = 5000;
  private static readonly DEFAULT_MAX_WINDOW_MS = 30000;
  private readonly channelQueues = new Map<string, Promise<void>>();
  private readonly pendingInboundTurns = new Map<string, PendingInboundTurn>();
  private readonly quietWindowMs: number;
  private readonly maxWindowMs: number;

  constructor(private readonly options: GatewayOptions) {
    this.quietWindowMs = options.aggregation?.quietWindowMs ?? AgentGateway.DEFAULT_QUIET_WINDOW_MS;
    this.maxWindowMs = options.aggregation?.maxWindowMs ?? AgentGateway.DEFAULT_MAX_WINDOW_MS;
  }

  async start(): Promise<void> {
    for (const adapter of this.options.adapters) {
      adapter.onMessage(async (message) => {
        await this.receiveIncomingMessage(adapter, message);
      });
    }
  }

  async stop(): Promise<void> {
    await Promise.all([...this.pendingInboundTurns.keys()].map((turnKey) => this.flushPendingInboundTurn(turnKey, 'shutdown')));
    await Promise.all(this.options.adapters.map((adapter) => adapter.stop?.()));
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
    this.options.logger.info({ channelId: message.channelId, content: message.content.substring(0, 100) }, 'Message received');
    const session = this.options.orchestrator.getOrCreateSession(message.channelId, message.channelType);
    const normalizedMessage = this.normalizeMessageAttachments(message, session.workingDirectory);
    const inboundRecentFiles = this.toRecentFiles(
      session.workingDirectory,
      normalizedMessage.attachments ?? [],
      this.getInboundRecentFileSource(message.channelType),
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
      await adapter.sendMessage(normalizedMessage.channelId, result.message ?? 'Done.', {
        replyTo: normalizedMessage.id
      });
      return;
    }

    this.options.logger.info({ channelId: normalizedMessage.channelId, sessionId: session.id }, 'Sending message to Claude');
    const stopTyping = await this.startTyping(adapter, normalizedMessage.channelId);

    try {
      const response = await this.options.orchestrator.execute(session.id, normalizedMessage);
      const outboundAttachments = this.filterPublishedAttachments(session.workingDirectory, response.attachments);
      const sendResult = await adapter.sendMessage(
        normalizedMessage.channelId,
        response.content,
        this.toSendMessageOptions({
          attachments: outboundAttachments,
          replyTo: response.replyTo
        })
      );

      if (sendResult.success && outboundAttachments?.length) {
        const outboundRecentFiles = this.toRecentFiles(
          session.workingDirectory,
          outboundAttachments,
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
        await adapter.sendMessage(
          message.channelId,
          `Request failed: ${error instanceof Error ? error.message : String(error)}`,
          { replyTo: message.id }
        );
      } catch (sendError) {
        this.options.logger.error(this.serializeError(message.channelId, sendError), 'Failed to send error message');
      }
    }
  }

  private async receiveIncomingMessage(adapter: ChannelAdapter, message: AgentMessage): Promise<void> {
    const channelKey = this.toChannelKey(message);
    const turnKey = this.toTurnKey(message);
    const receivedAtMs = Date.now();

    this.options.logger.info(
      this.toInboundLogData(message, {
        channelKey,
        turnKey,
        receivedAt: new Date(receivedAtMs).toISOString(),
        quietWindowMs: this.quietWindowMs,
        maxWindowMs: this.maxWindowMs
      }),
      'Inbound message arrived'
    );

    if (this.shouldBypassInboundCoalescing(message)) {
      await this.flushPendingTurnsForChannel(channelKey, 'command_bypass');
      await this.processIncomingMessage(adapter, message);
      return;
    }

    const turn = this.pendingInboundTurns.get(turnKey) ?? this.createPendingInboundTurn(adapter, turnKey, channelKey);
    turn.messages.push(message);
    turn.lastBufferedAtMs = receivedAtMs;
    clearTimeout(turn.quietTimer);
    turn.quietTimer = this.scheduleTurnFlush(turnKey, this.quietWindowMs, 'quiet_window');

    this.options.logger.info(
      this.toInboundLogData(message, {
        channelKey,
        turnKey,
        bufferedCount: turn.messages.length,
        bufferedMessageIds: turn.messages.map((candidate) => candidate.id),
        quietWindowMs: this.quietWindowMs,
        maxWindowMs: this.maxWindowMs
      }),
      'Inbound turn buffered'
    );

    await turn.completion;
  }

  private createPendingInboundTurn(adapter: ChannelAdapter, turnKey: string, channelKey: string): PendingInboundTurn {
    const now = Date.now();
    let resolveCompletion: () => void = () => undefined;
    let rejectCompletion: (error?: unknown) => void = () => undefined;
    const completion = new Promise<void>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    const turn: PendingInboundTurn = {
      adapter,
      turnKey,
      channelKey,
      messages: [],
      quietTimer: this.scheduleTurnFlush(turnKey, this.quietWindowMs, 'quiet_window'),
      maxTimer: this.scheduleTurnFlush(turnKey, this.maxWindowMs, 'max_window'),
      startedAtMs: now,
      lastBufferedAtMs: now,
      completion,
      resolveCompletion,
      rejectCompletion
    };
    this.pendingInboundTurns.set(turnKey, turn);
    return turn;
  }

  private scheduleTurnFlush(turnKey: string, delayMs: number, reason: 'quiet_window' | 'max_window'): NodeJS.Timeout {
    const timer = setTimeout(() => {
      void this.flushPendingInboundTurn(turnKey, reason);
    }, delayMs);
    timer.unref?.();
    return timer;
  }

  private async flushPendingTurnsForChannel(
    channelKey: string,
    reason: 'command_bypass' | 'shutdown'
  ): Promise<void> {
    const turnKeys = [...this.pendingInboundTurns.values()]
      .filter((turn) => turn.channelKey === channelKey)
      .map((turn) => turn.turnKey);

    await Promise.all(turnKeys.map((turnKey) => this.flushPendingInboundTurn(turnKey, reason)));
  }

  private async flushPendingInboundTurn(
    turnKey: string,
    reason: 'quiet_window' | 'max_window' | 'command_bypass' | 'shutdown'
  ): Promise<void> {
    const turn = this.pendingInboundTurns.get(turnKey);
    if (!turn) {
      return;
    }

    this.pendingInboundTurns.delete(turnKey);
    clearTimeout(turn.quietTimer);
    clearTimeout(turn.maxTimer);

    if (turn.messages.length === 0) {
      turn.resolveCompletion();
      return;
    }

    try {
      const mergedMessage = this.mergeInboundMessages(turn.messages);
      this.options.logger.info(
        this.toInboundLogData(mergedMessage, {
          channelKey: turn.channelKey,
          turnKey,
          flushReason: reason,
          bufferedForMs: Date.now() - turn.startedAtMs,
          quietForMs: Date.now() - turn.lastBufferedAtMs,
          rawMessageIds: turn.messages.map((message) => message.id),
          rawMessageTimestamps: turn.messages.map((message) => message.timestamp.toISOString()),
          rawAttachmentCounts: turn.messages.map((message) => message.attachments?.length ?? 0),
          mergedAttachmentCount: mergedMessage.attachments?.length ?? 0,
          mergedContentPreview: mergedMessage.content.substring(0, 100)
        }),
        'Inbound turn flushed'
      );
      await this.processIncomingMessage(turn.adapter, mergedMessage);
      turn.resolveCompletion();
    } catch (error) {
      turn.rejectCompletion(error);
    }
  }

  private mergeInboundMessages(messages: AgentMessage[]): AgentMessage {
    const ordered = [...messages].sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
    const lastMessage = ordered[ordered.length - 1] ?? messages[0];
    const contentParts = ordered
      .map((message) => message.content.trim())
      .filter((content) => content.length > 0);
    const attachments = ordered.flatMap((message) => message.attachments ?? []);

    return {
      ...lastMessage,
      content: contentParts.join('\n\n').trim(),
      attachments: attachments.length > 0 ? attachments : undefined,
      metadata: {
        ...(lastMessage.metadata ?? {}),
        coalescedMessageIds: ordered.map((message) => message.id),
        coalescedCount: ordered.length
      }
    };
  }

  private shouldBypassInboundCoalescing(message: AgentMessage): boolean {
    return message.content.trim().startsWith('/');
  }

  private toChannelKey(message: Pick<AgentMessage, 'channelType' | 'channelId'>): string {
    return `${message.channelType}:${message.channelId}`;
  }

  private toTurnKey(message: Pick<AgentMessage, 'channelType' | 'channelId' | 'userId'>): string {
    return `${this.toChannelKey(message)}:${message.userId}`;
  }

  private toInboundLogData(
    message: Pick<AgentMessage, 'id' | 'channelId' | 'channelType' | 'userId' | 'content' | 'attachments' | 'timestamp'>,
    extras: Record<string, unknown> = {}
  ): Record<string, unknown> {
    return {
      channelId: message.channelId,
      channelType: message.channelType,
      messageId: message.id,
      userId: message.userId,
      contentPreview: message.content.substring(0, 100),
      attachmentCount: message.attachments?.length ?? 0,
      messageTimestamp: message.timestamp.toISOString(),
      ...extras
    };
  }

  private async startTyping(adapter: ChannelAdapter, channelId: string): Promise<() => void> {
    if (!adapter.setTyping) {
      return () => undefined;
    }

    await adapter.setTyping(channelId, true);

    const timer = setInterval(() => {
      void adapter.setTyping?.(channelId, true).catch((error) => {
        this.options.logger.error(this.serializeError(channelId, error), 'Typing indicator failed');
      });
    }, AgentGateway.TYPING_INTERVAL_MS);

    timer.unref?.();

    return () => {
      clearInterval(timer);
      void adapter.setTyping?.(channelId, false).catch((error) => {
        this.options.logger.error(this.serializeError(channelId, error), 'Typing indicator failed');
      });
    };
  }

  private toSendMessageOptions(response: {
    attachments?: Attachment[];
    replyTo?: string;
  }): SendMessageOptions | undefined {
    if (!response.attachments?.length && !response.replyTo) {
      return undefined;
    }

    return {
      attachments: response.attachments,
      replyTo: response.replyTo
    };
  }

  private filterPublishedAttachments(workingDirectory: string, attachments?: Attachment[]): Attachment[] | undefined {
    if (!attachments?.length) {
      return undefined;
    }

    const publishedAttachments = attachments.filter((attachment) => (
      attachment.localPath &&
      existsSync(attachment.localPath) &&
        isWithinPublishedDeliveriesBoundary(workingDirectory, attachment.localPath)
    ));

    return publishedAttachments.length > 0 ? publishedAttachments : undefined;
  }

  private getInboundRecentFileSource(channelType: string): RecentFileSource {
    switch (channelType) {
      case 'discord':
        return 'discord_inbound';
      default:
        return 'discord_inbound';
    }
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

        const sessionDir = resolve(workingDirectory, '..');
        const targetPath = join(
          sessionDir,
          'uploads',
          `${sanitizeAttachmentName(attachment.id)}-${sanitizeAttachmentName(attachment.name)}`
        );

        mkdirSync(join(sessionDir, 'uploads'), { recursive: true });
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
    const sessionDir = resolve(workingDirectory, '..');
    const uploadsDir = join(sessionDir, 'uploads');
    
    return attachments
      .filter((attachment) => {
        if (!attachment.localPath || !existsSync(attachment.localPath)) {
          return false;
        }

        if (source === 'claude_outbound') {
          return isWithinPublishedDeliveriesBoundary(workingDirectory, attachment.localPath);
        }

        return this.isInsideDirectory(workingDirectory, attachment.localPath) ||
               this.isInsideDirectory(uploadsDir, attachment.localPath);
      })
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
