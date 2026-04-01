import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionOrchestrator } from '../../src/core/orchestrator';
import { AgentExecutor, AgentMessage } from '../../src/core/types';
import { ProfileManager } from '../../src/core/profile-manager';
import { SessionStore } from '../../src/core/session-store';

describe('SessionOrchestrator', () => {
  let tempDir: string;
  let storeDir: string;
  let profilesDir: string;
  let executor: AgentExecutor;
  let store: SessionStore;
  let profiles: ProfileManager;
  let orchestrator: SessionOrchestrator;

  const clock = () => new Date('2026-03-30T00:00:00.000Z');

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orchestrator-test-'));
    storeDir = join(tempDir, 'store');
    profilesDir = join(tempDir, 'profiles');
    mkdirSync(storeDir, { recursive: true });
    mkdirSync(profilesDir, { recursive: true });

    // Create a test profile
    writeFileSync(
      join(profilesDir, 'test-profile.json'),
      JSON.stringify({
        name: 'test-profile',
        description: 'Test profile',
        model: 'opus',
        workingDirectory: '/test/work',
        permissionMode: 'plan'
      })
    );

    executor = {
      execute: vi.fn().mockResolvedValue({ content: 'hello from claude' })
    };
    store = new SessionStore(storeDir);
    profiles = new ProfileManager(profilesDir);
    orchestrator = new SessionOrchestrator({
      sessionStore: store,
      profileManager: profiles,
      executor,
      defaults: {
        model: 'sonnet',
        permissionMode: 'auto',
        workingDirectory: '.'
      },
      clock
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('getOrCreateSession', () => {
    it('creates one session per channel and reuses it on later messages', async () => {
      const first = orchestrator.getOrCreateSession('channel-1', 'discord');
      const second = orchestrator.getOrCreateSession('channel-1', 'discord');
      const message: AgentMessage = {
        id: 'msg-1',
        channelId: 'channel-1',
        channelType: 'discord',
        userId: 'user-1',
        content: 'summarize this repo',
        timestamp: clock()
      };

      const response = await orchestrator.execute(first.id, message);

      expect(second.id).toBe(first.id);
      expect(response.content).toBe('hello from claude');
      expect(executor.execute).toHaveBeenCalledTimes(1);
      expect(orchestrator.getSession(first.id)?.messageCount).toBe(1);
    });

    it('recreates the Claude session and retries when resuming hits a corrupt JSON session error', async () => {
      const first = orchestrator.getOrCreateSession('channel-1', 'discord');
      store.save({
        ...first,
        messageCount: 1
      });

      const message: AgentMessage = {
        id: 'msg-2',
        channelId: 'channel-1',
        channelType: 'discord',
        userId: 'user-1',
        content: 'hello again',
        timestamp: clock()
      };

      const corruptResumeError = new Error('Unexpected token \'\', "\\u0001Bud1"... is not valid JSON');
      vi.mocked(executor.execute)
        .mockRejectedValueOnce(corruptResumeError)
        .mockResolvedValueOnce({ content: 'recovered response' });

      const response = await orchestrator.execute(first.id, message);
      const replacement = orchestrator.getSessionByChannel('channel-1', 'discord');

      expect(response.content).toBe('recovered response');
      expect(executor.execute).toHaveBeenCalledTimes(2);
      expect(vi.mocked(executor.execute).mock.calls[0][0].id).toBe(first.id);
      expect(vi.mocked(executor.execute).mock.calls[1][0].id).not.toBe(first.id);
      expect(vi.mocked(executor.execute).mock.calls[1][0].messageCount).toBe(0);
      expect(replacement?.id).toBe(vi.mocked(executor.execute).mock.calls[1][0].id);
      expect(replacement?.messageCount).toBe(1);
    });
  });

  describe('getSession', () => {
    it('returns null for unknown session', () => {
      const result = orchestrator.getSession('non-existent-session-id');
      expect(result).toBeNull();
    });

    it('returns session for known session id', () => {
      const session = orchestrator.getOrCreateSession('channel-1', 'discord');
      const result = orchestrator.getSession(session.id);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(session.id);
      expect(result?.channelId).toBe('channel-1');
    });
  });

  describe('getSessionByChannel', () => {
    it('returns null for non-existent channel', () => {
      const result = orchestrator.getSessionByChannel('unknown-channel', 'discord');
      expect(result).toBeNull();
    });

    it('returns session for existing channel', () => {
      const session = orchestrator.getOrCreateSession('channel-1', 'discord');
      const result = orchestrator.getSessionByChannel('channel-1', 'discord');
      expect(result).not.toBeNull();
      expect(result?.id).toBe(session.id);
    });

    it('returns null when channel exists but channelType does not match', () => {
      orchestrator.getOrCreateSession('channel-1', 'discord');
      const result = orchestrator.getSessionByChannel('channel-1', 'slack');
      expect(result).toBeNull();
    });
  });

  describe('listSessions', () => {
    it('returns all sessions when no filter provided', () => {
      orchestrator.getOrCreateSession('channel-1', 'discord');
      orchestrator.getOrCreateSession('channel-2', 'slack');
      orchestrator.getOrCreateSession('channel-3', 'discord');

      const result = orchestrator.listSessions();
      expect(result).toHaveLength(3);
    });

    it('filters by status', () => {
      orchestrator.getOrCreateSession('channel-1', 'discord');
      orchestrator.getOrCreateSession('channel-2', 'slack');

      // Archive one session
      const sessions = orchestrator.listSessions();
      orchestrator.archiveSession(sessions[0].id);

      const activeSessions = orchestrator.listSessions({ status: 'active' });
      const archivedSessions = orchestrator.listSessions({ status: 'archived' });

      expect(activeSessions).toHaveLength(1);
      expect(archivedSessions).toHaveLength(1);
    });

    it('filters by channelType', () => {
      orchestrator.getOrCreateSession('channel-1', 'discord');
      orchestrator.getOrCreateSession('channel-2', 'slack');
      orchestrator.getOrCreateSession('channel-3', 'discord');

      const discordSessions = orchestrator.listSessions({ channelType: 'discord' });
      const slackSessions = orchestrator.listSessions({ channelType: 'slack' });

      expect(discordSessions).toHaveLength(2);
      expect(slackSessions).toHaveLength(1);
    });

    it('filters by combined status and channelType', () => {
      orchestrator.getOrCreateSession('channel-1', 'discord');
      orchestrator.getOrCreateSession('channel-2', 'discord');
      orchestrator.getOrCreateSession('channel-3', 'slack');

      // Archive one discord session
      const sessions = orchestrator.listSessions();
      const discordSession = sessions.find((s) => s.channelId === 'channel-1');
      if (discordSession) {
        orchestrator.archiveSession(discordSession.id);
      }

      const activeDiscordSessions = orchestrator.listSessions({
        status: 'active',
        channelType: 'discord'
      });

      expect(activeDiscordSessions).toHaveLength(1);
      expect(activeDiscordSessions[0].channelId).toBe('channel-2');
    });
  });

  describe('updateSessionConfig', () => {
    it('updates model', () => {
      const session = orchestrator.getOrCreateSession('channel-1', 'discord');
      const updated = orchestrator.updateSessionConfig(session.id, { model: 'opus' });

      expect(updated.model).toBe('opus');
      expect(updated.id).toBe(session.id);
    });

    it('updates workingDirectory', () => {
      const session = orchestrator.getOrCreateSession('channel-1', 'discord');
      const updated = orchestrator.updateSessionConfig(session.id, {
        workingDirectory: '/new/path'
      });

      expect(updated.workingDirectory).toBe('/new/path');
    });

    it('updates permissionMode', () => {
      const session = orchestrator.getOrCreateSession('channel-1', 'discord');
      const updated = orchestrator.updateSessionConfig(session.id, {
        permissionMode: 'plan'
      });

      expect(updated.permissionMode).toBe('plan');
    });

    it('updates multiple fields at once', () => {
      const session = orchestrator.getOrCreateSession('channel-1', 'discord');
      const updated = orchestrator.updateSessionConfig(session.id, {
        model: 'opus',
        workingDirectory: '/new/path',
        permissionMode: 'bypassPermissions',
        customSystemPrompt: 'Be helpful',
        allowedTools: ['Read', 'Write']
      });

      expect(updated.model).toBe('opus');
      expect(updated.workingDirectory).toBe('/new/path');
      expect(updated.permissionMode).toBe('bypassPermissions');
      expect(updated.customSystemPrompt).toBe('Be helpful');
      expect(updated.allowedTools).toEqual(['Read', 'Write']);
    });

    it('throws error for unknown session', () => {
      expect(() =>
        orchestrator.updateSessionConfig('non-existent-id', { model: 'opus' })
      ).toThrow('Unknown session: non-existent-id');
    });

    it('preserves immutable fields (id, channelId, channelType)', () => {
      const session = orchestrator.getOrCreateSession('channel-1', 'discord');
      const updated = orchestrator.updateSessionConfig(session.id, {
        model: 'opus',
        // @ts-expect-error - intentionally trying to set immutable field
        id: 'hacked-id',
        // @ts-expect-error - intentionally trying to set immutable field
        channelId: 'hacked-channel',
        // @ts-expect-error - intentionally trying to set immutable field
        channelType: 'hacked-type'
      });

      expect(updated.id).toBe(session.id);
      expect(updated.channelId).toBe('channel-1');
      expect(updated.channelType).toBe('discord');
    });
  });

  describe('archiveSession', () => {
    it('sets status to archived', () => {
      const session = orchestrator.getOrCreateSession('channel-1', 'discord');
      expect(session.status).toBe('active');

      orchestrator.archiveSession(session.id);

      const archived = orchestrator.getSession(session.id);
      expect(archived?.status).toBe('archived');
    });

    it('throws for unknown session', () => {
      expect(() => orchestrator.archiveSession('non-existent-id')).toThrow(
        'Unknown session: non-existent-id'
      );
    });
  });

  describe('execute', () => {
    it('throws error for unknown sessionId', async () => {
      const message: AgentMessage = {
        id: 'msg-1',
        channelId: 'channel-1',
        channelType: 'discord',
        userId: 'user-1',
        content: 'test message',
        timestamp: clock()
      };

      await expect(orchestrator.execute('non-existent-id', message)).rejects.toThrow(
        'Unknown session: non-existent-id'
      );
    });

    it('increments message count after execution', async () => {
      const session = orchestrator.getOrCreateSession('channel-1', 'discord');
      const message: AgentMessage = {
        id: 'msg-1',
        channelId: 'channel-1',
        channelType: 'discord',
        userId: 'user-1',
        content: 'test message',
        timestamp: clock()
      };

      await orchestrator.execute(session.id, message);
      await orchestrator.execute(session.id, message);

      const updated = orchestrator.getSession(session.id);
      expect(updated?.messageCount).toBe(2);
    });
  });

  describe('loadProfile', () => {
    it('delegates to ProfileManager and returns profile', () => {
      const profile = orchestrator.loadProfile('test-profile');

      expect(profile.name).toBe('test-profile');
      expect(profile.model).toBe('opus');
      expect(profile.workingDirectory).toBe('/test/work');
      expect(profile.permissionMode).toBe('plan');
    });

    it('throws ProfileLoadError for non-existent profile', () => {
      expect(() => orchestrator.loadProfile('non-existent')).toThrow();
    });
  });
});
