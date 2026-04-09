import { AgentMessage, Attachment } from './types';

export interface AdapterConfig {
  enabled: boolean;
  [key: string]: unknown;
}

export interface SendMessageOptions {
  attachments?: Attachment[];
  replyTo?: string;
}

export interface SendMessageResult {
  messageId: string;
  success: boolean;
  error?: string;
}

export interface ChannelAdapter {
  readonly type: string;
  initialize?(config: AdapterConfig): Promise<void>;
  onMessage(callback: (message: AgentMessage) => Promise<void>): void;
  sendMessage(channelId: string, content: string, options?: SendMessageOptions): Promise<SendMessageResult>;
  setTyping?(channelId: string, typing: boolean): Promise<void>;
  stop?(): Promise<void>;
}
