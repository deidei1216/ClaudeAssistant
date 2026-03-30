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
        void this.handleMessage(adapter, message);
      });
      await adapter.connect();
    }
  }

  async stop(): Promise<void> {
    await Promise.all(this.options.adapters.map((adapter) => adapter.disconnect()));
  }

  async handleMessage(adapter: ChannelAdapter, message: AgentMessage): Promise<void> {
    const session = this.options.orchestrator.getOrCreateSession(message.channelId, message.channelType);

    if (message.content.startsWith('/')) {
      const context: CommandContext = {
        session,
        message,
        orchestrator: this.options.orchestrator
      };
      const result = await this.options.commandHandler.executeFromMessage(message, context);
      await adapter.send(message.channelId, { content: result.message ?? 'Done.', replyTo: message.id });
      return;
    }

    const response = await this.options.orchestrator.execute(session.id, message);
    await adapter.send(message.channelId, response);
  }
}