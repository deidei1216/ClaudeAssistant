import { Client, Events, GatewayIntentBits, type TextChannel, type NewsChannel, type DMChannel, type ThreadChannel, type VoiceChannel } from 'discord.js';
import type { AdapterConfig, ChannelAdapter, MessageResult } from '../../core/adapter';
import type { AgentMessage, AgentResponse } from '../../core/types';
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
  private callback?: (message: AgentMessage) => void;
  private config?: DiscordAdapterConfig;

  constructor(
    private readonly client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
    })
  ) {}

  async initialize(config: DiscordAdapterConfig): Promise<void> {
    this.config = config;

    this.client.on(Events.MessageCreate, (message) => {
      if (message.author.bot || !this.callback) {
        return;
      }

      this.callback(
        fromDiscordMessage({
          id: message.id,
          channelId: message.channelId,
          author: { id: message.author.id, bot: message.author.bot },
          content: message.content,
          createdAt: message.createdAt
        })
      );
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

  async send(channelId: string, response: AgentResponse): Promise<MessageResult> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      return { messageId: '', success: false, error: `Channel ${channelId} is not text-based.` };
    }

    const sendableChannel = channel as SendableChannel;
    const maxLength = this.config?.messageLimits?.maxLength ?? 2000;
    const chunks = toDiscordChunks(response.content, maxLength);
    let lastMessageId = '';

    for (const chunk of chunks) {
      const sent = await sendableChannel.send(chunk);
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
}
