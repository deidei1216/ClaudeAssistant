import { ChannelAdapter } from './adapter';
import { AgentMessage, ChannelControlInput } from './types';
import { SessionOrchestrator } from './orchestrator';
import { CommandHandler } from '../commands';
import { CommandContext } from '../commands/types';

interface GatewayOptions {
  adapters: ChannelAdapter[];
  commandHandler: CommandHandler;
  orchestrator: SessionOrchestrator;
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
    info: (message: string, data?: unknown) => void;
    error: (message: string, data?: unknown) => void;
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

    if (message.content.startsWith('/')) {
      this.options.logger.info({ channelId: message.channelId, content: message.content }, 'Executing command');
      const context: CommandContext = {
        session,
        message,
        orchestrator: this.options.orchestrator
      };
      const result = await this.options.commandHandler.executeFromMessage(message, context);
      await adapter.send(message.channelId, { content: result.message ?? 'Done.', replyTo: message.id });
      return;
    }

    this.options.logger.info({ channelId: message.channelId, sessionId: session.id }, 'Sending message to Claude');
    const stopTyping = await this.startTyping(adapter, message.channelId);

    try {
      const response = await this.options.orchestrator.execute(session.id, message);
      await adapter.send(message.channelId, response);
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
}
