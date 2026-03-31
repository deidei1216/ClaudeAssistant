export type PermissionMode = 'default' | 'auto' | 'plan' | 'bypassPermissions' | 'dontAsk' | 'acceptEdits';
export type SessionStatus = 'active' | 'idle' | 'archived';

export type AgentRunStatus = 'running' | 'waiting_control' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type ControlRequestKind = 'approval' | 'decision' | 'input';
export type ControlRequestStatus = 'pending' | 'resolved' | 'expired' | 'cancelled';
export type ControlSignalName = 'approve' | 'reject' | 'hold' | 'adjust' | 'resume';
export type ChannelControlInputKind = 'reaction' | 'reply' | 'command' | 'button';

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

export interface AgentRun {
  id: string;
  parentRunId?: string;
  sessionId: string;
  role?: string;
  title: string;
  status: AgentRunStatus;
  channelBinding?: {
    channelType: string;
    channelId: string;
    threadId?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface ControlRequest {
  id: string;
  runId: string;
  kind: ControlRequestKind;
  status: ControlRequestStatus;
  summary: string;
  details?: string;
  requestedAt: Date;
  resolvedAt?: Date;
  sourceMessage?: SourceMessageRef;
}

export interface ControlSignal {
  id: string;
  requestId: string;
  runId: string;
  signal: ControlSignalName;
  comment?: string;
  actor: {
    channelType: string;
    userId: string;
    username?: string;
  };
  source: {
    channelType: string;
    channelId: string;
    messageId: string;
    threadId?: string;
    interactionType: ChannelControlInputKind;
    rawValue: string;
  };
  createdAt: Date;
}

export interface ChannelProjection {
  runId: string;
  channelType: string;
  channelId: string;
  threadId?: string;
  rootMessageId?: string;
  lastStatusMessageId?: string;
  title: string;
  updatedAt: Date;
}

export interface ChannelControlInput {
  channelType: string;
  channelId: string;
  messageId: string;
  threadId?: string;
  signal: ControlSignalName;
  comment?: string;
  userId: string;
  username?: string;
  interactionType: ChannelControlInputKind;
  rawValue: string;
  timestamp: Date;
}