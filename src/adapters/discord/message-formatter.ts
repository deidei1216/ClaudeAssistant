import type { AgentMessage } from '../../core/types';

interface DiscordAttachmentLike {
  id: string;
  name: string;
  contentType?: string | null;
  size?: number | null;
  url: string;
}

interface DiscordMessageLike {
  id: string;
  channelId: string;
  author: { id: string; bot: boolean };
  content: string;
  createdAt: Date;
  attachments?: DiscordAttachmentLike[];
}

function normalizeAttachmentSize(size?: number | null): number {
  return typeof size === 'number' && Number.isFinite(size) && size >= 0 ? size : 0;
}

export function fromDiscordMessage(message: DiscordMessageLike): AgentMessage {
  const attachments = message.attachments?.length
    ? message.attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        type: attachment.contentType ?? 'application/octet-stream',
        size: normalizeAttachmentSize(attachment.size),
        url: attachment.url
      }))
    : undefined;

  return {
    id: message.id,
    channelId: message.channelId,
    channelType: 'discord',
    userId: message.author.id,
    content: message.content,
    attachments,
    timestamp: message.createdAt
  };
}

export function toDiscordChunks(content: string, maxLength: number): string[] {
  if (!Number.isFinite(maxLength) || maxLength <= 0) {
    return [content];
  }

  if (content.length <= maxLength) {
    return [content];
  }

  const chunks: string[] = [];
  for (let index = 0; index < content.length; index += maxLength) {
    chunks.push(content.slice(index, index + maxLength));
  }
  return chunks;
}
