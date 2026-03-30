export type PermissionMode = 'default' | 'auto' | 'plan' | 'bypassPermissions' | 'dontAsk' | 'acceptEdits';
export type SessionStatus = 'active' | 'idle' | 'archived';

export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  url: string;
  localPath?: string;
}

export interface AgentMessage {
  id: string;
  channelId: string;
  channelType: string;
  userId: string;
  content: string;
  attachments?: Attachment[];
  replyTo?: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

export interface AgentResponse {
  content: string;
  attachments?: Attachment[];
  replyTo?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionProfile {
  id: string;
  channelId: string;
  channelType: string;
  model: string;
  workingDirectory: string;
  settingsPath?: string;
  customSystemPrompt?: string;
  permissionMode: PermissionMode;
  allowedTools?: string[];
  deniedTools?: string[];
  profile?: string;
  createdAt: Date;
  lastActiveAt: Date;
  status: SessionStatus;
  messageCount: number;
  totalTokens?: number;
}

export interface SessionProfileTemplate {
  name: string;
  description?: string;
  model?: string;
  workingDirectory?: string;
  settingsPath?: string;
  customSystemPrompt?: string;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
  deniedTools?: string[];
}

export interface SessionConfigPatch {
  model?: string;
  workingDirectory?: string;
  settingsPath?: string;
  customSystemPrompt?: string;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
  deniedTools?: string[];
  profile?: string;
}

export interface SessionFilter {
  status?: SessionStatus;
  channelType?: string;
}

export interface AgentExecutor {
  execute(session: SessionProfile, message: AgentMessage): Promise<AgentResponse>;
}