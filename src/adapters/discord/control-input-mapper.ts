import type { ChannelControlInput } from '../../core/types';

export function fromDiscordReaction(input: {
  emoji: { name: string | null };
  messageId: string;
  channelId: string;
  threadId?: string;
  userId: string;
  username?: string;
  createdAt: Date;
}): ChannelControlInput | null {
  const signal =
    input.emoji.name === '👍'
      ? 'approve'
      : input.emoji.name === '👎'
        ? 'reject'
        : input.emoji.name === '👀'
          ? 'hold'
          : null;

  if (!signal) {
    return null;
  }

  return {
    channelType: 'discord',
    channelId: input.channelId,
    messageId: input.messageId,
    threadId: input.threadId,
    signal,
    userId: input.userId,
    username: input.username,
    interactionType: 'reaction',
    rawValue: input.emoji.name ?? '',
    timestamp: input.createdAt
  };
}

export function fromDiscordReply(input: {
  id: string;
  channelId: string;
  threadId?: string;
  userId: string;
  username?: string;
  content: string;
  replyTo: string;
  createdAt: Date;
}): ChannelControlInput {
  const signal = /但|先|不要|改成/.test(input.content) ? 'adjust' : 'resume';
  return {
    channelType: 'discord',
    channelId: input.channelId,
    messageId: input.replyTo,
    threadId: input.threadId,
    signal,
    comment: input.content,
    userId: input.userId,
    username: input.username,
    interactionType: 'reply',
    rawValue: input.content,
    timestamp: input.createdAt
  };
}