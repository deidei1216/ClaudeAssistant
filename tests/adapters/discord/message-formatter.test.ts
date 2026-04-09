import { describe, expect, it } from 'vitest';
import { fromDiscordMessage, toDiscordChunks } from '../../../adapters/discord/message-formatter';

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

  it('maps Discord attachments into gateway attachments', () => {
    const result = fromDiscordMessage({
      id: 'msg-2',
      channelId: 'channel-1',
      author: { id: 'user-1', bot: false },
      content: 'here is a file',
      createdAt: new Date('2026-03-30T00:00:00.000Z'),
      attachments: [
        {
          id: 'att-1',
          name: 'report.pdf',
          contentType: 'application/pdf',
          size: 1234,
          url: 'https://example.com/report.pdf'
        },
        {
          id: 'att-2',
          name: 'notes.txt',
          url: 'https://example.com/notes.txt'
        }
      ]
    });

    expect(result.attachments).toEqual([
      {
        id: 'att-1',
        name: 'report.pdf',
        type: 'application/pdf',
        size: 1234,
        url: 'https://example.com/report.pdf'
      },
      {
        id: 'att-2',
        name: 'notes.txt',
        type: 'application/octet-stream',
        size: 0,
        url: 'https://example.com/notes.txt'
      }
    ]);
  });

  it('normalizes malformed attachment sizes to zero', () => {
    const result = fromDiscordMessage({
      id: 'msg-3',
      channelId: 'channel-1',
      author: { id: 'user-1', bot: false },
      content: 'bad sizes',
      createdAt: new Date('2026-03-30T00:00:00.000Z'),
      attachments: [
        { id: 'att-1', name: 'bad-a.bin', size: Number.NaN, url: 'https://example.com/a' },
        { id: 'att-2', name: 'bad-b.bin', size: Number.POSITIVE_INFINITY, url: 'https://example.com/b' },
        { id: 'att-3', name: 'bad-c.bin', size: -42, url: 'https://example.com/c' }
      ]
    });

    expect(result.attachments).toEqual([
      {
        id: 'att-1',
        name: 'bad-a.bin',
        type: 'application/octet-stream',
        size: 0,
        url: 'https://example.com/a'
      },
      {
        id: 'att-2',
        name: 'bad-b.bin',
        type: 'application/octet-stream',
        size: 0,
        url: 'https://example.com/b'
      },
      {
        id: 'att-3',
        name: 'bad-c.bin',
        type: 'application/octet-stream',
        size: 0,
        url: 'https://example.com/c'
      }
    ]);
  });

  it('splits long responses into Discord-sized chunks', () => {
    const chunks = toDiscordChunks('a'.repeat(4500), 2000);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(2000);
  });

  it.each([0, -1])('falls back safely when maxLength is non-positive (%s)', (maxLength) => {
    expect(toDiscordChunks('hello', maxLength)).toEqual(['hello']);
  });

  it('falls back safely when maxLength is NaN', () => {
    expect(toDiscordChunks('hello', Number.NaN)).toEqual(['hello']);
  });
});
