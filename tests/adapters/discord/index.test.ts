import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscordAdapter } from '../../../adapters/discord';

describe('DiscordAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('triggers the Discord typing indicator for text channels', async () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const login = vi.fn().mockResolvedValue('logged-in');
    const fetch = vi.fn().mockResolvedValue({
      isTextBased: () => true,
      sendTyping
    });
    const client = {
      on: vi.fn(),
      login,
      destroy: vi.fn(),
      channels: { fetch }
    };
    const adapter = new DiscordAdapter(client as never);

    await adapter.initialize({ enabled: true, token: 'test-token' });
    await adapter.setTyping?.('channel-1', true);

    expect(login).toHaveBeenCalledWith('test-token');
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

    const result = await adapter.sendMessage('channel-1', 'helloworld', {
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

    const result = await adapter.sendMessage('channel-1', '', {
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

  it('maps replyTo into the outbound Discord payload', async () => {
    const send = vi.fn().mockResolvedValue({ id: 'message-reply' });
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

    const result = await adapter.sendMessage('channel-1', 'reply body', {
      replyTo: 'source-message-1'
    });

    expect(send).toHaveBeenCalledWith({
      content: 'reply body',
      reply: {
        messageReference: 'source-message-1'
      }
    });
    expect(result).toEqual({ messageId: 'message-reply', success: true });
  });
  it('initializes without exposing control-only callbacks', async () => {
    const adapter = new DiscordAdapter({
      on: vi.fn(),
      login: vi.fn(),
      destroy: vi.fn(),
      channels: { fetch: vi.fn() }
    } as never);

    await adapter.initialize({ enabled: true, token: 'token' });

    expect(adapter.type).toBe('discord');
    expect(typeof adapter.onMessage).toBe('function');
    expect(typeof adapter.sendMessage).toBe('function');
    expect(typeof adapter.setTyping).toBe('function');
    expect(typeof adapter.stop).toBe('function');
    expect('onControlInput' in adapter).toBe(false);
  });

  it('stops by destroying the Discord client', async () => {
    const destroy = vi.fn();
    const adapter = new DiscordAdapter({
      on: vi.fn(),
      login: vi.fn(),
      destroy,
      channels: { fetch: vi.fn() }
    } as never);

    await adapter.stop?.();

    expect(destroy).toHaveBeenCalledTimes(1);
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
    const onMessage = vi.fn().mockResolvedValue(undefined);

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
    const onMessage = vi.fn().mockResolvedValue(undefined);

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
