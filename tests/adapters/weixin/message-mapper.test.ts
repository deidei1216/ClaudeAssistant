import { describe, expect, it } from 'vitest';
import {
  buildWeixinChannelId,
  parseWeixinText,
  toAgentMessage
} from '../../../adapters/weixin/message-mapper';

describe('Weixin message mapper', () => {
  it('maps text and media markers into a single agent message payload', () => {
    const message = toAgentMessage('acct-1', {
      message_id: 42,
      from_user_id: 'user-1@im.wechat',
      to_user_id: 'bot-1@im.wechat',
      create_time_ms: Date.parse('2026-04-09T12:00:00.000Z'),
      context_token: 'ctx-1',
      message_type: 1,
      item_list: [
        { type: 1, text_item: { text: '你好' } },
        { type: 4 }
      ]
    });

    expect(message).toEqual({
      id: '42',
      channelId: 'acct-1:user-1@im.wechat',
      channelType: 'weixin',
      userId: 'user-1@im.wechat',
      content: '你好\n[Weixin file]',
      metadata: expect.objectContaining({
        accountId: 'acct-1',
        contextToken: 'ctx-1',
        toUserId: 'bot-1@im.wechat'
      }),
      timestamp: new Date('2026-04-09T12:00:00.000Z')
    });
  });

  it('skips bot-authored messages', () => {
    expect(
      toAgentMessage('acct-1', {
        from_user_id: 'bot-1@im.wechat',
        message_type: 2,
        item_list: [{ type: 1, text_item: { text: 'ignored' } }]
      })
    ).toBeNull();
  });

  it('keeps channel ids deterministic', () => {
    expect(buildWeixinChannelId('acct-1', 'user-1@im.wechat')).toBe('acct-1:user-1@im.wechat');
    expect(parseWeixinText([{ type: 1, text_item: { text: 'A' } }, { type: 2 }])).toBe('A\n[Weixin image]');
  });
});
