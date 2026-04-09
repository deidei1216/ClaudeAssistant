export type PermissionMode = 'default' | 'auto' | 'plan' | 'bypassPermissions' | 'dontAsk' | 'acceptEdits';
export type SessionStatus = 'active' | 'archived';

export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  url: string;
  localPath?: string;
}

export type RecentFileSource = 'discord_inbound' | 'claude_outbound';

export interface RecentFileRecord {
  id: string;
  displayName: string;
  relativePath: string;
  absolutePath: string;
  source: RecentFileSource;
  mediaType: string;
  lastSeenAt: Date;
  summary: string;
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
  recentFiles?: RecentFileRecord[];
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
  status?: SessionStatus;
}

export interface SessionFilter {
  status?: SessionStatus;
  channelType?: string;
}

export interface AgentExecutor {
  execute(session: SessionProfile, message: AgentMessage): Promise<AgentResponse>;
}

export interface SourceMessageRef {
  channelType: string;
  channelId: string;
  messageId: string;
  threadId?: string;
}
