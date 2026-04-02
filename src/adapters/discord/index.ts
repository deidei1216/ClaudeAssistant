import { Client, Events, GatewayIntentBits, type TextChannel, type NewsChannel, type DMChannel, type ThreadChannel, type VoiceChannel } from 'discord.js';
import type { AdapterConfig, ChannelAdapter, MessageResult } from '../../core/adapter';
import type { AgentMessage, AgentResponse, ChannelControlInput } from '../../core/types';
import { downloadInboundAttachment } from '../../core/attachments';
import { fromDiscordMessage, toDiscordChunks } from './message-formatter';
import { fromDiscordReaction, fromDiscordReply } from './control-input-mapper';

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
  private callback?: (message: AgentMessage) => void;
  private controlCallback?: (input: ChannelControlInput) => void;
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

      if (message.reference?.messageId && this.controlCallback) {
        this.log('info', 'Discord reply received for control processing', {
          channelId: message.channelId,
          threadId: message.channel?.isThread?.() ? message.channelId : undefined,
          replyToMessageId: message.reference.messageId,
          authorId: message.author.id,
          content: message.content
        });
        this.controlCallback(
          fromDiscordReply({
            id: message.id,
            channelId: message.channelId,
            threadId: message.channel?.isThread?.() ? message.channelId : undefined,
            userId: message.author.id,
            username: message.author.username,
            content: message.content,
            replyTo: message.reference.messageId,
            createdAt: message.createdAt
          })
        );
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

        this.callback(agentMessage);
      }
    });

    this.client.on(Events.MessageReactionAdd, (reaction, user) => {
      if (user.bot || !this.controlCallback) {
        return;
      }

      const input = fromDiscordReaction({
        emoji: { name: reaction.emoji.name },
        messageId: reaction.message.id,
        channelId: reaction.message.channelId,
        threadId: reaction.message.channel.isThread?.() ? reaction.message.channelId : undefined,
        userId: user.id,
        username: user.username ?? undefined,
        createdAt: new Date()
      });

      if (input) {
        this.log('info', 'Discord reaction received for control processing', {
          channelId: reaction.message.channelId,
          threadId: reaction.message.channel.isThread?.() ? reaction.message.channelId : undefined,
          messageId: reaction.message.id,
          userId: user.id,
          emoji: reaction.emoji.name
        });
        this.controlCallback(input);
      }
    });
  }

  async connect(): Promise<void> {
    if (!this.config?.token) {
      throw new Error('Discord token is required.');
    }
    await this.client.login(this.config.token);
  }

  async disconnect(): Promise<void> {
    this.client.destroy();
  }

  onMessage(callback: (message: AgentMessage) => void): void {
    this.callback = callback;
  }

  onControlInput(callback: (input: ChannelControlInput) => void): void {
    this.controlCallback = callback;
  }

  async createThread(channelId: string, title: string): Promise<MessageResult & { channelId: string }> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !('threads' in channel)) {
      return { channelId, messageId: '', success: false, error: `Channel ${channelId} cannot create threads.` };
    }

    const thread = await channel.threads.create({ name: title, autoArchiveDuration: 1440 });
    return { channelId: thread.id, messageId: '', success: true };
  }

  async upsertControlMessage(channelId: string, response: AgentResponse, messageId?: string): Promise<MessageResult> {
    if (messageId) {
      return this.edit(messageId, response);
    }

    return this.send(channelId, response);
  }

  async edit(messageId: string, response: AgentResponse): Promise<MessageResult> {
    // Note: This requires fetching the message from a channel, which requires channelId.
    // For now, return a not-implemented error as this needs more context.
    return { messageId, success: false, error: 'Edit requires channel context.' };
  }

  async send(channelId: string, response: AgentResponse): Promise<MessageResult> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      return { messageId: '', success: false, error: `Channel ${channelId} is not text-based.` };
    }

    const sendableChannel = channel as SendableChannel;
    const maxLength = this.config?.messageLimits?.maxLength ?? 2000;
    const chunks = toDiscordChunks(response.content, maxLength);
    const files = response.attachments?.flatMap((attachment) => (attachment.localPath ? [attachment.localPath] : [])) ?? [];
    let lastMessageId = '';

    for (const [index, chunk] of chunks.entries()) {
      const isFinalChunk = index === chunks.length - 1;
      const payload = isFinalChunk && files.length > 0 ? { content: chunk, files } : chunk;
      const sent = await sendableChannel.send(payload);
      lastMessageId = sent.id;
    }

    return { messageId: lastMessageId, success: true };
  }

  async typing(channelId: string): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      return;
    }

    if ('sendTyping' in channel && typeof channel.sendTyping === 'function') {
      await channel.sendTyping();
    }
  }

  private log(level: 'info' | 'warn' | 'error', message: string, data: Record<string, unknown>): void {
    const method = this.logger[level];
    method?.call(this.logger, data, message);
  }
}
