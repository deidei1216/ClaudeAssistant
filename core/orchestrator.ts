import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  AgentExecutor,
  AgentMessage,
  AgentResponse,
  RecentFileRecord,
  SessionConfigPatch,
  SessionFilter,
  SessionProfile,
  SessionProfileTemplate
} from './types';
import { ProfileManager } from './profile-manager';
import { mergeRecentFiles } from './recent-files';
import { SessionStore } from './session-store';
import {
  ensureDeliveryBoundaryScaffold,
  resolveSessionRoot
} from './delivery-paths';
import { buildSessionClaudeMd } from './session-claude-md';
import { ensureWorkspaceUploadsAlias } from './session-paths';

interface OrchestratorOptions {
  sessionStore: SessionStore;
  profileManager: ProfileManager;
  executor: AgentExecutor;
  defaults: Pick<SessionProfile, 'model' | 'permissionMode'> & {
    settingsPath?: SessionProfile['settingsPath'];
  };
  clock?: () => Date;
}

export class SessionOrchestrator {
  private readonly clock: () => Date;

  constructor(private readonly options: OrchestratorOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  getOrCreateSession(channelId: string, channelType: string): SessionProfile {
    const existing = this.options.sessionStore.loadByChannel(channelType, channelId);
    
    // Check if the existing session has a valid UUID as its ID.
    // The Claude CLI strictly requires UUIDs for session identification.
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    if (existing && existing.status !== 'archived') {
      if (uuidRegex.test(existing.id)) {
        if (existing.settingsPath !== this.options.defaults.settingsPath && this.options.defaults.settingsPath) {
          const updatedExisting: SessionProfile = {
            ...existing,
            settingsPath: this.options.defaults.settingsPath,
            lastActiveAt: this.clock()
          };
          this.options.sessionStore.save(updatedExisting);
          this.ensureSessionScaffold(updatedExisting.id);
          return updatedExisting;
        }
        this.ensureSessionScaffold(existing.id);
        return existing;
      }
      
      // If the ID is not a UUID, we must archive it to allow a new UUID-based session for this channel.
      this.archiveSession(existing.id);
    }

    const now = this.clock();
    const session = this.createSessionProfile({
      id: randomUUID(),
      channelId,
      channelType,
      createdAt: now
    });

    this.options.sessionStore.save(session);
    this.ensureSessionScaffold(session.id);

    return session;
  }

  getSession(sessionId: string): SessionProfile | null {
    return this.options.sessionStore.list().find((session) => session.id === sessionId) ?? null;
  }

  getSessionByChannel(channelId: string, channelType: string): SessionProfile | null {
    return this.options.sessionStore.loadByChannel(channelType, channelId);
  }

  listSessions(filter?: SessionFilter): SessionProfile[] {
    return this.options.sessionStore.list().filter((session) => {
      if (filter?.status && session.status !== filter.status) {
        return false;
      }
      if (filter?.channelType && session.channelType !== filter.channelType) {
        return false;
      }
      return true;
    });
  }

  updateSessionConfig(sessionId: string, config: SessionConfigPatch): SessionProfile {
    const session = this.requireSession(sessionId);
    const updated: SessionProfile = {
      ...session,
      ...config,
      id: session.id,
      channelId: session.channelId,
      channelType: session.channelType,
      lastActiveAt: this.clock()
    };

    this.options.sessionStore.save(updated);
    return updated;
  }

  archiveSession(sessionId: string): void {
    this.updateSessionConfig(sessionId, { status: 'archived' });
  }

  registerRecentFiles(sessionId: string, files: RecentFileRecord[]): SessionProfile {
    const session = this.requireSession(sessionId);
    const updated: SessionProfile = {
      ...session,
      recentFiles: mergeRecentFiles(session.recentFiles ?? [], files),
      lastActiveAt: this.clock()
    };

    this.options.sessionStore.save(updated);
    return updated;
  }

  loadProfile(profileName: string): SessionProfileTemplate {
    return this.options.profileManager.load(profileName);
  }

  async execute(sessionId: string, message: AgentMessage): Promise<AgentResponse> {
    const session = this.requireSession(sessionId);

    try {
      const response = await this.options.executor.execute(session, message);
      this.persistSuccessfulExecution(session);
      return response;
    } catch (error) {
      if (!this.shouldResetClaudeSession(session, error)) {
        throw error;
      }

      // Archive corrupt session
      this.archiveSession(session.id);

      const replacementSession = this.createSessionProfile({
        ...session,
        id: randomUUID(),
        workingDirectory: undefined,
        status: 'active',
        messageCount: 0,
        lastActiveAt: this.clock()
      });
      this.options.sessionStore.save(replacementSession);
      this.ensureSessionScaffold(replacementSession.id);
      const response = await this.options.executor.execute(replacementSession, message);

      this.persistSuccessfulExecution(replacementSession);
      return response;
    }
  }

  private requireSession(sessionId: string): SessionProfile {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return session;
  }

  private createSessionProfile(
    input: Pick<SessionProfile, 'id' | 'channelId' | 'channelType'> &
      Partial<Omit<SessionProfile, 'id' | 'channelId' | 'channelType'>>
  ): SessionProfile {
    const createdAt = input.createdAt ?? this.clock();
    const lastActiveAt = input.lastActiveAt ?? createdAt;

    return {
      id: input.id,
      channelId: input.channelId,
      channelType: input.channelType,
      model: input.model ?? this.options.defaults.model,
      workingDirectory: input.workingDirectory ?? join(this.options.sessionStore.baseDir, input.id, 'workspace'),
      settingsPath: input.settingsPath ?? this.options.defaults.settingsPath,
      customSystemPrompt: input.customSystemPrompt,
      permissionMode: input.permissionMode ?? this.options.defaults.permissionMode,
      allowedTools: input.allowedTools,
      deniedTools: input.deniedTools,
      profile: input.profile,
      createdAt,
      lastActiveAt,
      status: input.status ?? 'active',
      messageCount: input.messageCount ?? 0,
      totalTokens: input.totalTokens,
      recentFiles: input.recentFiles ?? []
    };
  }

  private ensureSessionScaffold(sessionId: string): void {
    const sessionDir = join(this.options.sessionStore.baseDir, sessionId);
    const workspaceDir = join(sessionDir, 'workspace');
    const claudeMdPath = join(resolveSessionRoot(workspaceDir), 'CLAUDE.md');
    const sessionClaudeMd = buildSessionClaudeMd();

    ensureDeliveryBoundaryScaffold(workspaceDir);
    mkdirSync(join(sessionDir, 'uploads'), { recursive: true });
    ensureWorkspaceUploadsAlias(workspaceDir);

    if (!existsSync(claudeMdPath) || readFileSync(claudeMdPath, 'utf8') !== sessionClaudeMd) {
      writeFileSync(claudeMdPath, sessionClaudeMd);
    }
  }

  private persistSuccessfulExecution(session: SessionProfile): void {
    this.options.sessionStore.save({
      ...session,
      messageCount: session.messageCount + 1,
      lastActiveAt: this.clock()
    });
  }

  private shouldResetClaudeSession(session: SessionProfile, error: unknown): boolean {
    if (session.messageCount === 0 || !(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();
    return (message.includes('unexpected token') && message.includes('not valid json')) || 
           message.includes('invalid session id');
  }
}
