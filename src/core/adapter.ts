import { AgentMessage, AgentResponse } from './types';

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
  send(channelId: string, response: AgentResponse): Promise<MessageResult>;
  typing?(channelId: string): Promise<void>;
  react?(messageId: string, emoji: string): Promise<void>;
  edit?(messageId: string, response: AgentResponse): Promise<void>;
}