import { randomUUID } from 'node:crypto';
import {
  AgentExecutor,
  AgentMessage,
  AgentResponse,
  SessionConfigPatch,
  SessionFilter,
  SessionProfile,
  SessionProfileTemplate
} from './types';
import { ProfileManager } from './profile-manager';
import { SessionStore } from './session-store';

interface OrchestratorOptions {
  sessionStore: SessionStore;
  profileManager: ProfileManager;
  executor: AgentExecutor;
  defaults: Pick<SessionProfile, 'model' | 'permissionMode' | 'workingDirectory'>;
  clock?: () => Date;
}

export class SessionOrchestrator {
  private readonly clock: () => Date;

  constructor(private readonly options: OrchestratorOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  getOrCreateSession(channelId: string, channelType: string): SessionProfile {
    const existing = this.options.sessionStore.loadByChannel(channelType, channelId);
    if (existing) {
      return existing;
    }

    const now = this.clock();
    const session: SessionProfile = {
      id: randomUUID(),
      channelId,
      channelType,
      model: this.options.defaults.model,
      workingDirectory: this.options.defaults.workingDirectory,
      permissionMode: this.options.defaults.permissionMode,
      createdAt: now,
      lastActiveAt: now,
      status: 'active',
      messageCount: 0
    };

    this.options.sessionStore.save(session);
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

  loadProfile(profileName: string): SessionProfileTemplate {
    return this.options.profileManager.load(profileName);
  }

  async execute(sessionId: string, message: AgentMessage): Promise<AgentResponse> {
    const session = this.requireSession(sessionId);
    const response = await this.options.executor.execute(session, message);

    this.options.sessionStore.save({
      ...session,
      messageCount: session.messageCount + 1,
      lastActiveAt: this.clock()
    });

    return response;
  }

  private requireSession(sessionId: string): SessionProfile {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return session;
  }
}