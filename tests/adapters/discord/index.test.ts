import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscordAdapter } from '../../../src/adapters/discord';

describe('DiscordAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it('sends long text in chunks and uploads outbound files on the final message', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ id: 'message-1' })
      .mockResolvedValueOnce({ id: 'message-2' });
    const fetch = vi.fn().mockResolvedValue({
      isTextBased: () => true,
      send
    });
    const client = {
      on: vi.fn(),
      login: vi.fn(),
      destroy: vi.fn(),
      channels: { fetch }
    };
    const adapter = new DiscordAdapter(client as never);

    await adapter.initialize({
      enabled: true,
      token: 'test-token',
      messageLimits: { maxLength: 5 }
    });

    const result = await adapter.send('channel-1', {
      content: 'helloworld',
      attachments: [
        {
          id: 'attachment-1',
          name: 'report.txt',
          type: 'text/plain',
          size: 12,
          url: 'file:///tmp/report.txt',
          localPath: '/tmp/report.txt'
        }
      ]
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, 'hello');
    expect(send).toHaveBeenNthCalledWith(2, {
      content: 'world',
      files: ['/tmp/report.txt']
    });
    expect(result).toEqual({ messageId: 'message-2', success: true });
  });

  it('sends a Discord message with files when the response has no text', async () => {
    const send = vi.fn().mockResolvedValue({ id: 'message-file-only' });
    const fetch = vi.fn().mockResolvedValue({
      isTextBased: () => true,
      send
    });
    const client = {
      on: vi.fn(),
      login: vi.fn(),
      destroy: vi.fn(),
      channels: { fetch }
    };
    const adapter = new DiscordAdapter(client as never);

    await adapter.initialize({ enabled: true, token: 'test-token' });

    const result = await adapter.send('channel-1', {
      content: '',
      attachments: [
        {
          id: 'attachment-2',
          name: 'image.png',
          type: 'image/png',
          size: 128,
          url: 'file:///tmp/image.png',
          localPath: '/tmp/image.png'
        }
      ]
    });

    expect(send).toHaveBeenCalledWith({
      content: '',
      files: ['/tmp/image.png']
    });
    expect(result).toEqual({ messageId: 'message-file-only', success: true });
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

  it('downloads inbound attachments before forwarding a normal message', async () => {
    const handlers = new Map<string, (...args: any[]) => void>();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(Buffer.from('discord attachment payload'))
      })
    );
    const client = {
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        handlers.set(event, handler);
      }),
      login: vi.fn(),
      destroy: vi.fn(),
      channels: { fetch: vi.fn() }
    };
    const adapter = new DiscordAdapter(client as never);
    const onMessage = vi.fn();

    await adapter.initialize({ enabled: true, token: 'token' });
    adapter.onMessage(onMessage);

    const messageCreate = handlers.get('messageCreate');

    await messageCreate?.({
      id: 'message-1',
      channelId: 'channel-1',
      channel: {
        isThread: () => false
      },
      author: {
        id: 'user-1',
        bot: false,
        username: 'deidei'
      },
      content: 'see attachment',
      attachments: [
        {
          id: 'att-1',
          name: '../contracts/..\\invoice:final?.pdf',
          contentType: 'application/pdf',
          size: 24,
          url: 'https://cdn.discordapp.com/attachments/att-1'
        }
      ],
      createdAt: new Date('2026-04-01T00:00:00.000Z')
    });

    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'message-1',
        attachments: [
          expect.objectContaining({
            id: 'att-1',
            name: '../contracts/..\\invoice:final?.pdf',
            localPath: expect.stringContaining(
              '.claude-gateway/inbox/channel-1/att-1-invoice_final_.pdf'
            )
          })
        ]
      })
    );
  });

  it('forwards the message and logs an error when an attachment download fails', async () => {
    const handlers = new Map<string, (...args: any[]) => void>();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502
      })
    );
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
    const onMessage = vi.fn();

    await adapter.initialize({ enabled: true, token: 'token' });
    adapter.onMessage(onMessage);

    const messageCreate = handlers.get('messageCreate');

    await expect(
      messageCreate?.({
        id: 'message-2',
        channelId: 'channel-2',
        channel: {
          isThread: () => false
        },
        author: {
          id: 'user-2',
          bot: false,
          username: 'deidei'
        },
        content: 'keep going',
        attachments: [
          {
            id: 'att-2',
            name: 'debug.log',
            contentType: 'text/plain',
            size: 12,
            url: 'https://cdn.discordapp.com/attachments/att-2'
          }
        ],
        createdAt: new Date('2026-04-01T00:00:00.000Z')
      })
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'channel-2',
        messageId: 'message-2',
        attachmentId: 'att-2'
      }),
      'Discord attachment download failed'
    );
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'message-2',
        attachments: [
          expect.objectContaining({
            id: 'att-2',
            name: 'debug.log'
          })
        ]
      })
    );
    expect(onMessage.mock.calls[0]?.[0]?.attachments?.[0]).not.toHaveProperty('localPath');
  });
});
