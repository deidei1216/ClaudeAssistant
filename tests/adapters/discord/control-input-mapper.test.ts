import { describe, expect, it } from 'vitest';
import { fromDiscordReaction, fromDiscordReply } from '../../../src/adapters/discord/control-input-mapper';

describe('Discord control input mapper', () => {
  it('maps reactions to normalized control input signals', () => {
    const input = fromDiscordReaction({
      emoji: { name: '👍' },
      messageId: 'message-1',
      channelId: 'channel-1',
      threadId: 'thread-1',
      userId: 'user-1',
      username: 'alice',
      createdAt: new Date('2026-03-31T02:00:00.000Z')
    });

    expect(input).toMatchObject({
      signal: 'approve',
      interactionType: 'reaction',
      rawValue: '👍'
    });
  });

  it('maps reply text to an adjust signal when instructions are included', () => {
    const input = fromDiscordReply({
      id: 'reply-1',
      channelId: 'channel-1',
      threadId: 'thread-1',
      userId: 'user-2',
      username: 'bob',
      content: '继续,但先补测试',
      replyTo: 'message-2',
      createdAt: new Date('2026-03-31T02:01:00.000Z')
    });

    expect(input).toMatchObject({
      messageId: 'message-2',
      signal: 'adjust',
      comment: '继续,但先补测试'
    });
  });
});