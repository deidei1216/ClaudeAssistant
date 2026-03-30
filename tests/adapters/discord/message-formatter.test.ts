import { describe, expect, it } from 'vitest';
import { fromDiscordMessage, toDiscordChunks } from '../../../src/adapters/discord/message-formatter';

describe('discord message formatter', () => {
  it('converts a Discord message into the gateway message shape', () => {
    const result = fromDiscordMessage({
      id: 'msg-1',
      channelId: 'channel-1',
      author: { id: 'user-1', bot: false },
      content: 'hello gateway',
      createdAt: new Date('2026-03-30T00:00:00.000Z')
    });

    expect(result.channelType).toBe('discord');
    expect(result.userId).toBe('user-1');
    expect(result.content).toBe('hello gateway');
  });

  it('splits long responses into Discord-sized chunks', () => {
    const chunks = toDiscordChunks('a'.repeat(4500), 2000);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(2000);
  });
});