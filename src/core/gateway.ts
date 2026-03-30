import { ChannelAdapter } from './adapter';
import { AgentMessage } from './types';
import { SessionOrchestrator } from './orchestrator';
import { CommandHandler } from '../commands';
import { CommandContext } from '../commands/types';

interface GatewayOptions {
  adapters: ChannelAdapter[];
  commandHandler: CommandHandler;
  orchestrator: SessionOrchestrator;
  logger: {
    info: (message: string, data?: unknown) => void;
    error: (message: string, data?: unknown) => void;
  };
}

export class AgentGateway {
  constructor(private readonly options: GatewayOptions) {}

  async start(): Promise<void> {
    for (const adapter of this.options.adapters) {
      adapter.onMessage((message) => {
        this.handleMessage(adapter, message).catch((error) => {
          this.options.logger.error('Message handling failed', {
            channelId: message.channelId,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      });
      await adapter.connect();
    }
  }

  async stop(): Promise<void> {
    await Promise.all(this.options.adapters.map((adapter) => adapter.disconnect()));
  }

  async handleMessage(adapter: ChannelAdapter, message: AgentMessage): Promise<void> {
    this.options.logger.info('Message received', { channelId: message.channelId, content: message.content.substring(0, 100) });
    const session = this.options.orchestrator.getOrCreateSession(message.channelId, message.channelType);

    if (message.content.startsWith('/')) {
      this.options.logger.info('Executing command', { channelId: message.channelId, content: message.content });
      const context: CommandContext = {
        session,
        message,
        orchestrator: this.options.orchestrator
      };
      const result = await this.options.commandHandler.executeFromMessage(message, context);
      await adapter.send(message.channelId, { content: result.message ?? 'Done.', replyTo: message.id });
      return;
    }

    this.options.logger.info('Sending message to Claude', { channelId: message.channelId, sessionId: session.id });
    const response = await this.options.orchestrator.execute(session.id, message);
    await adapter.send(message.channelId, response);
  }
}