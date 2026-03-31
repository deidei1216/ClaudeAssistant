import { describe, expect, it } from 'vitest';
import { fromDiscordReaction, fromDiscordReply } from '../../../src/adapters/discord/control-input-mapper';

describe('Discord control input mapper', () => {
  describe('fromDiscordReaction', () => {
    it('maps thumbs up emoji to approve signal', () => {
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

    it('maps thumbs down emoji to reject signal', () => {
      const input = fromDiscordReaction({
        emoji: { name: '👎' },
        messageId: 'message-1',
        channelId: 'channel-1',
        threadId: 'thread-1',
        userId: 'user-1',
        username: 'alice',
        createdAt: new Date('2026-03-31T02:00:00.000Z')
      });

      expect(input).toMatchObject({
        signal: 'reject',
        interactionType: 'reaction',
        rawValue: '👎'
      });
    });

    it('maps eyes emoji to hold signal', () => {
      const input = fromDiscordReaction({
        emoji: { name: '👀' },
        messageId: 'message-1',
        channelId: 'channel-1',
        threadId: 'thread-1',
        userId: 'user-1',
        username: 'alice',
        createdAt: new Date('2026-03-31T02:00:00.000Z')
      });

      expect(input).toMatchObject({
        signal: 'hold',
        interactionType: 'reaction',
        rawValue: '👀'
      });
    });

    it('returns null for unknown emoji', () => {
      const input = fromDiscordReaction({
        emoji: { name: '🎉' },
        messageId: 'message-1',
        channelId: 'channel-1',
        threadId: 'thread-1',
        userId: 'user-1',
        username: 'alice',
        createdAt: new Date('2026-03-31T02:00:00.000Z')
      });

      expect(input).toBeNull();
    });

    it('returns null for null emoji name', () => {
      const input = fromDiscordReaction({
        emoji: { name: null },
        messageId: 'message-1',
        channelId: 'channel-1',
        threadId: 'thread-1',
        userId: 'user-1',
        username: 'alice',
        createdAt: new Date('2026-03-31T02:00:00.000Z')
      });

      expect(input).toBeNull();
    });
  });

  describe('fromDiscordReply', () => {
    it('maps reply text to adjust signal when instructions are included', () => {
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

    it('maps reply text to resume signal when no adjustment keywords', () => {
      const input = fromDiscordReply({
        id: 'reply-2',
        channelId: 'channel-1',
        threadId: 'thread-1',
        userId: 'user-2',
        username: 'bob',
        content: '继续执行',
        replyTo: 'message-3',
        createdAt: new Date('2026-03-31T02:02:00.000Z')
      });

      expect(input).toMatchObject({
        messageId: 'message-3',
        signal: 'resume',
        comment: '继续执行'
      });
    });
  });
});
