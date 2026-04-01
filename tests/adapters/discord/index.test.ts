import { describe, expect, it, vi } from 'vitest';
import { DiscordAdapter } from '../../../src/adapters/discord';

describe('DiscordAdapter', () => {
  it('triggers the Discord typing indicator for text channels', async () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const fetch = vi.fn().mockResolvedValue({
      isTextBased: () => true,
      sendTyping
    });
    const client = {
      on: vi.fn(),
      login: vi.fn(),
      destroy: vi.fn(),
      channels: { fetch }
    };
    const adapter = new DiscordAdapter(client as never);

    await adapter.initialize({ enabled: true, token: 'test-token' });
    await adapter.typing?.('channel-1');

    expect(fetch).toHaveBeenCalledWith('channel-1');
    expect(sendTyping).toHaveBeenCalled();
  });
});

describe('DiscordAdapter control support', () => {
  it('registers reaction and reply listeners during initialize', async () => {
    const on = vi.fn();
    const adapter = new DiscordAdapter({
      on,
      login: vi.fn(),
      destroy: vi.fn(),
      channels: { fetch: vi.fn() }
    } as never);

    await adapter.initialize({ enabled: true, token: 'token' });

    expect(on).toHaveBeenCalled();
  });

  it('logs reply metadata before dispatching control input', async () => {
    const handlers = new Map<string, (...args: any[]) => void>();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    const client = {
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        handlers.set(event, handler);
      }),
      login: vi.fn(),
      destroy: vi.fn(),
      channels: { fetch: vi.fn() }
    };
    const adapter = new DiscordAdapter(client as never, logger as never);
    const controlCallback = vi.fn();

    await adapter.initialize({ enabled: true, token: 'token' });
    adapter.onControlInput(controlCallback);

    const messageCreate = handlers.get('messageCreate');
    messageCreate?.({
      id: 'reply-1',
      channelId: 'thread-1',
      channel: {
        isThread: () => true
      },
      author: {
        id: 'user-1',
        bot: false,
        username: 'deidei'
      },
      content: '继续执行',
      reference: {
        messageId: 'control-message-1'
      },
      createdAt: new Date('2026-04-01T00:00:00.000Z')
    });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'thread-1',
        replyToMessageId: 'control-message-1',
        authorId: 'user-1',
        content: '继续执行'
      }),
      'Discord reply received for control processing'
    );
    expect(controlCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'control-message-1',
        signal: 'resume'
      })
    );
  });

  it('preserves logger binding when logging reply metadata', async () => {
    const handlers = new Map<string, (...args: any[]) => void>();
    const logger = {
      marker: 'discord-adapter-logger',
      info(this: { marker: string }, data: unknown, message: string) {
        if (this.marker !== 'discord-adapter-logger') {
          throw new Error('logger binding lost');
        }
        expect(message).toBe('Discord reply received for control processing');
        expect(data).toEqual(
          expect.objectContaining({
            channelId: 'thread-1',
            replyToMessageId: 'control-message-1'
          })
        );
      }
    };
    const client = {
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        handlers.set(event, handler);
      }),
      login: vi.fn(),
      destroy: vi.fn(),
      channels: { fetch: vi.fn() }
    };
    const adapter = new DiscordAdapter(client as never, logger as never);

    await adapter.initialize({ enabled: true, token: 'token' });
    adapter.onControlInput(vi.fn());

    const messageCreate = handlers.get('messageCreate');

    expect(() =>
      messageCreate?.({
        id: 'reply-1',
        channelId: 'thread-1',
        channel: { isThread: () => true },
        author: {
          id: 'user-1',
          bot: false,
          username: 'deidei'
        },
        content: '继续执行',
        reference: {
          messageId: 'control-message-1'
        },
        createdAt: new Date('2026-04-01T00:00:00.000Z')
      })
    ).not.toThrow();
  });
});
