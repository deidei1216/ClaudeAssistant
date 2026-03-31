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
});
