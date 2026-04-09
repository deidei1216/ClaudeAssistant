import { Client, Events, GatewayIntentBits, type TextChannel, type NewsChannel, type DMChannel, type ThreadChannel, type VoiceChannel } from 'discord.js';
import type { AdapterConfig, ChannelAdapter, SendMessageOptions, SendMessageResult } from '../../core/adapter';
import type { AgentMessage } from '../../core/types';
import { downloadInboundAttachment } from '../../core/attachments';
import { fromDiscordMessage, toDiscordChunks } from './message-formatter';

type SendableChannel = TextChannel | NewsChannel | DMChannel | ThreadChannel | VoiceChannel;

interface DiscordAdapterConfig extends AdapterConfig {
  token: string;
  messageLimits?: {
    maxLength?: number;
  };
}

export class DiscordAdapter implements ChannelAdapter {
  readonly name = 'Discord';
  readonly type = 'discord';
  private callback?: (message: AgentMessage) => Promise<void>;
  private config?: DiscordAdapterConfig;

  constructor(
    private readonly client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
    }),
    private readonly logger: {
      info?: (data: unknown, message: string) => void;
      warn?: (data: unknown, message: string) => void;
      error?: (data: unknown, message: string) => void;
    } = {}
  ) {}

  async initialize(config: DiscordAdapterConfig): Promise<void> {
    this.config = config;

    this.client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot) {
        return;
      }

      if (this.callback) {
        const agentMessage = fromDiscordMessage({
          id: message.id,
          channelId: message.channelId,
          author: { id: message.author.id, bot: message.author.bot },
          content: message.content,
          createdAt: message.createdAt,
          attachments: [...message.attachments.values()].map((attachment) => ({
            id: attachment.id,
            name: attachment.name,
            contentType: attachment.contentType,
            size: attachment.size,
            url: attachment.url
          }))
        });

        if (agentMessage.attachments?.length) {
          agentMessage.attachments = await Promise.all(
            agentMessage.attachments.map(async (attachment) => {
              try {
                return {
                  ...attachment,
                  localPath: await downloadInboundAttachment(process.cwd(), message.channelId, attachment)
                };
              } catch (error) {
                this.log('error', 'Discord attachment download failed', {
                  channelId: message.channelId,
                  messageId: message.id,
                  attachmentId: attachment.id,
                  attachmentUrl: attachment.url,
                  error: error instanceof Error ? error.message : String(error)
                });
                return attachment;
              }
            })
          );
        }

        await this.callback(agentMessage);
      }
    });

    if (!config.token) {
      throw new Error('Discord token is required.');
    }

    await this.client.login(config.token);
  }

  onMessage(callback: (message: AgentMessage) => Promise<void>): void {
    this.callback = callback;
  }

  async sendMessage(channelId: string, content: string, options?: SendMessageOptions): Promise<SendMessageResult> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      return { messageId: '', success: false, error: `Channel ${channelId} is not text-based.` };
    }

    const sendableChannel = channel as SendableChannel;
    const maxLength = this.config?.messageLimits?.maxLength ?? 2000;
    const chunks = toDiscordChunks(content, maxLength);
    const files = options?.attachments?.flatMap((attachment) => (attachment.localPath ? [attachment.localPath] : [])) ?? [];
    let lastMessageId = '';

    for (const [index, chunk] of chunks.entries()) {
      const isFinalChunk = index === chunks.length - 1;
      const payload =
        isFinalChunk && (files.length > 0 || options?.replyTo)
          ? {
              content: chunk,
              ...(files.length > 0 ? { files } : {}),
              ...(options?.replyTo
                ? {
                    reply: {
                      messageReference: options.replyTo
                    }
                  }
                : {})
            }
          : chunk;
      const sent = await sendableChannel.send(payload);
      lastMessageId = sent.id;
    }

    return { messageId: lastMessageId, success: true };
  }

  async setTyping(channelId: string, typing: boolean): Promise<void> {
    if (!typing) {
      return;
    }

    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      return;
    }

    if ('sendTyping' in channel && typeof channel.sendTyping === 'function') {
      await channel.sendTyping();
    }
  }

  async stop(): Promise<void> {
    this.client.destroy();
  }

  private log(level: 'info' | 'warn' | 'error', message: string, data: Record<string, unknown>): void {
    const method = this.logger[level];
    method?.call(this.logger, data, message);
  }
}
