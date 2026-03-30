import type { AgentMessage } from '../../core/types';

interface DiscordMessageLike {
  id: string;
  channelId: string;
  author: { id: string; bot: boolean };
  content: string;
  createdAt: Date;
}

export function fromDiscordMessage(message: DiscordMessageLike): AgentMessage {
  return {
    id: message.id,
    channelId: message.channelId,
    channelType: 'discord',
    userId: message.author.id,
    content: message.content,
    timestamp: message.createdAt
  };
}

export function toDiscordChunks(content: string, maxLength: number): string[] {
  if (content.length <= maxLength) {
    return [content];
  }

  const chunks: string[] = [];
  for (let index = 0; index < content.length; index += maxLength) {
    chunks.push(content.slice(index, index + maxLength));
  }
  return chunks;
}