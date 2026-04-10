import type { AgentMessage } from '../../core/types';

export interface WeixinTextItem {
  text?: string;
}

export interface WeixinCdnMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  full_url?: string;
}

export interface WeixinImageItem {
  media?: WeixinCdnMedia;
  aeskey?: string;
}

export interface WeixinMessageItem {
  type?: number;
  text_item?: WeixinTextItem;
  image_item?: WeixinImageItem;
}

export interface WeixinInboundMessage {
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  create_time_ms?: number;
  session_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: WeixinMessageItem[];
  context_token?: string;
}

export function buildWeixinChannelId(accountId: string, peerUserId: string): string {
  return `${accountId}:${peerUserId}`;
}

export function parseWeixinText(
  items: WeixinMessageItem[] = [],
  options?: { omitMediaTypes?: number[] }
): string {
  const lines: string[] = [];
  const omittedTypes = new Set(options?.omitMediaTypes ?? []);

  for (const item of items) {
    if (item.type && omittedTypes.has(item.type)) {
      continue;
    }

    switch (item.type) {
      case 1:
        if (item.text_item?.text?.trim()) {
          lines.push(item.text_item.text);
        }
        break;
      case 2:
        lines.push('[Weixin image]');
        break;
      case 3:
        lines.push('[Weixin voice message]');
        break;
      case 4:
        lines.push('[Weixin file]');
        break;
      case 5:
        lines.push('[Weixin video]');
        break;
      default:
        break;
    }
  }

  return lines.join('\n').trim();
}

export function toAgentMessage(
  accountId: string,
  message: WeixinInboundMessage,
  options?: { omitMediaTypes?: number[]; allowEmptyContent?: boolean }
): AgentMessage | null {
  if (!message.from_user_id || message.message_type === 2) {
    return null;
  }

  const content = parseWeixinText(message.item_list, { omitMediaTypes: options?.omitMediaTypes });
  if (!content && !options?.allowEmptyContent) {
    return null;
  }

  const channelId = buildWeixinChannelId(accountId, message.from_user_id);

  return {
    id: String(message.message_id ?? `${accountId}-${message.create_time_ms ?? Date.now()}`),
    channelId,
    channelType: 'weixin',
    userId: message.from_user_id,
    content,
    metadata: {
      accountId,
      fromUserId: message.from_user_id,
      toUserId: message.to_user_id,
      contextToken: message.context_token,
      sessionId: message.session_id,
      rawMessageType: message.message_type,
      rawMessageState: message.message_state
    },
    timestamp: new Date(message.create_time_ms ?? Date.now())
  };
}
