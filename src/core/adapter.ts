import { AgentMessage, AgentResponse, ChannelControlInput } from './types';

export interface AdapterConfig {
  enabled: boolean;
  [key: string]: unknown;
}

export interface MessageResult {
  messageId: string;
  success: boolean;
  error?: string;
}

export interface ChannelAdapter {
  readonly name: string;
  readonly type: string;
  initialize(config: AdapterConfig): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(callback: (message: AgentMessage) => void): void;
  onControlInput?(callback: (input: ChannelControlInput) => void): void;
  send(channelId: string, response: AgentResponse): Promise<MessageResult>;
  createThread?(channelId: string, title: string): Promise<MessageResult & { channelId: string }>;
  upsertControlMessage?(channelId: string, response: AgentResponse, messageId?: string): Promise<MessageResult>;
  typing?(channelId: string): Promise<void>;
  react?(messageId: string, emoji: string): Promise<void>;
  edit?(messageId: string, response: AgentResponse): Promise<MessageResult>;
}