import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionOrchestrator } from '../../core/orchestrator';
import { AgentExecutor, AgentMessage } from '../../core/types';
import { ProfileManager } from '../../core/profile-manager';
import { SessionStore } from '../../core/session-store';
import { createInitialDeliveryManifest } from '../../core/delivery-paths';

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
        settingsPath: '.claude/settings.json',
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

      expect(first.id).toBeTypeOf('string');
      expect(second.id).toBe(first.id);
      expect(first.workingDirectory).toContain(join(first.id, 'workspace'));
      expect(existsSync(join(storeDir, first.id, 'workspace', '.deliveries'))).toBe(true);
      expect(lstatSync(join(storeDir, first.id, 'workspace', 'uploads')).isSymbolicLink()).toBe(true);
      expect(readlinkSync(join(storeDir, first.id, 'workspace', 'uploads'))).toBe('../uploads');
      const manifestPath = join(storeDir, first.id, 'workspace', '.deliveries', 'manifest.json');
      expect(readFileSync(manifestPath, 'utf8')).toBe(JSON.stringify(createInitialDeliveryManifest(), null, 2));
      const claudeMd = readFileSync(join(storeDir, first.id, 'CLAUDE.md'), 'utf8');
      expect(claudeMd).toContain('uploads/ is a read-only source directory for user-provided files.');
      expect(claudeMd).toContain('workspace/ is your free-form work area.');
      expect(claudeMd).toContain('Every Bash command starts in workspace/.');
      expect(claudeMd).toContain('User-uploaded source files are available from workspace as uploads/... .');
      expect(claudeMd).toContain('Do not assume that cd from one Bash command persists into the next command.');
      expect(claudeMd).toContain('Only content published into workspace/.deliveries/ is allowed to be returned to the user.');
      expect(claudeMd).toContain('Do not write files into workspace/.deliveries/ manually.');
      expect(claudeMd).toContain('publish-file.ts" <source> [displayName]');
      expect(claudeMd).toContain('publish-dir.ts" <sourceDir> [name]');
      expect(claudeMd).toContain('package-delivery.ts" <sourcePath> [outputName]');
      expect(claudeMd).toContain('If a published primary delivery is a directory, the Stop hook may package it into an archive before asking for the final [[file:...]] marker.');
      expect(claudeMd).toContain('Do not return files directly from uploads/, the session root, or arbitrary workspace paths.');
      expect(response.content).toBe('hello from claude');
      expect(executor.execute).toHaveBeenCalledTimes(1);
      expect(orchestrator.getSession(first.id)?.messageCount).toBe(1);
    });

    it('initializes new sessions with an empty recent file list', () => {
      const session = orchestrator.getOrCreateSession('channel-1', 'discord');

      expect(session.recentFiles).toEqual([]);
    });

    it('initializes new sessions with the default Claude settings path', () => {
      const session = orchestrator.getOrCreateSession('channel-1', 'discord');

      expect(session.settingsPath).toBe('.claude/settings.json');
    });

    it('backfills the default Claude settings path onto existing active sessions', () => {
      const existing = orchestrator.getOrCreateSession('channel-1', 'discord');
      store.save({
        ...existing,
        settingsPath: undefined
      });

      const reloaded = orchestrator.getOrCreateSession('channel-1', 'discord');

      expect(reloaded.id).toBe(existing.id);
      expect(reloaded.settingsPath).toBe('.claude/settings.json');
      expect(orchestrator.getSession(existing.id)?.settingsPath).toBe('.claude/settings.json');
    });

    it('refreshes existing active sessions onto the latest default Claude settings path', () => {
      const existing = orchestrator.getOrCreateSession('channel-1', 'discord');
      store.save({
        ...existing,
        settingsPath: '.claude/settings.json'
      });
      orchestrator = new SessionOrchestrator({
        sessionStore: store,
        profileManager: profiles,
        executor,
        defaults: {
          model: 'sonnet',
          permissionMode: 'auto',
          settingsPath: '.claude/runtime-settings.json'
        },
        clock
      });

      const reloaded = orchestrator.getOrCreateSession('channel-1', 'discord');

      expect(reloaded.id).toBe(existing.id);
      expect(reloaded.settingsPath).toBe('.claude/runtime-settings.json');
      expect(orchestrator.getSession(existing.id)?.settingsPath).toBe('.claude/runtime-settings.json');
    });

    it('keeps reusing the same channel session even when the runtime settings file is newer', () => {
      const runtimeDirectory = join(tempDir, 'sessions', '.runtime');
      mkdirSync(runtimeDirectory, { recursive: true });
      const runtimeSettingsPath = join(runtimeDirectory, 'claude-settings.json');
      writeFileSync(runtimeSettingsPath, '{"hooks":{}}');
      utimesSync(runtimeSettingsPath, clock(), new Date('2026-03-30T00:00:05.000Z'));

      orchestrator = new SessionOrchestrator({
        sessionStore: store,
        profileManager: profiles,
        executor,
        defaults: {
          model: 'sonnet',
          permissionMode: 'auto',
          settingsPath: runtimeSettingsPath
        },
        clock
      });

      const existing = orchestrator.getOrCreateSession('channel-1', 'discord');
      store.save({
        ...existing,
        settingsPath: runtimeSettingsPath,
        createdAt: new Date('2026-03-30T00:00:00.000Z'),
        lastActiveAt: new Date('2026-03-30T00:00:00.000Z')
      });

      const reloaded = orchestrator.getOrCreateSession('channel-1', 'discord');

      expect(reloaded.id).toBe(existing.id);
      expect(orchestrator.getSession(existing.id)?.status).toBe('active');
      expect(reloaded.settingsPath).toBe(runtimeSettingsPath);
    });

    it('refreshes an existing session CLAUDE.md when the scaffold contract drifts', () => {
      const session = orchestrator.getOrCreateSession('channel-1', 'discord');
      const claudeMdPath = join(storeDir, session.id, 'CLAUDE.md');
      writeFileSync(claudeMdPath, '# stale session contract\n');

      const reloaded = orchestrator.getOrCreateSession('channel-1', 'discord');
      const refreshedClaudeMd = readFileSync(claudeMdPath, 'utf8');

      expect(reloaded.id).toBe(session.id);
      expect(refreshedClaudeMd).toContain('uploads/ is a read-only source directory for user-provided files.');
      expect(refreshedClaudeMd).toContain('publish-file.ts" <source> [displayName]');
      expect(refreshedClaudeMd).not.toBe('# stale session contract\n');
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
      const replacementSessionId = vi.mocked(executor.execute).mock.calls[1][0].id;

      expect(response.content).toBe('recovered response');
      expect(executor.execute).toHaveBeenCalledTimes(2);
      expect(vi.mocked(executor.execute).mock.calls[0][0].id).toBe(first.id);
      expect(vi.mocked(executor.execute).mock.calls[1][0].id).not.toBe(first.id);
      expect(vi.mocked(executor.execute).mock.calls[1][0].messageCount).toBe(0);
      expect(replacement).not.toBeNull();
      expect(replacement?.status).toBe('active');
      expect(replacement?.id).toBe(replacementSessionId);
      expect(replacement?.messageCount).toBe(1);
      expect(replacement?.workingDirectory).toContain(join(replacementSessionId, 'workspace'));
      expect(replacement?.workingDirectory).not.toBe(first.workingDirectory);
      const replacementClaudePath = join(storeDir, replacementSessionId, 'CLAUDE.md');
      expect(existsSync(replacementClaudePath)).toBe(true);
      expect(existsSync(join(storeDir, replacementSessionId, 'workspace', '.deliveries'))).toBe(true);
      expect(
        readFileSync(join(storeDir, replacementSessionId, 'workspace', '.deliveries', 'manifest.json'), 'utf8')
      ).toBe(JSON.stringify(createInitialDeliveryManifest(), null, 2));
      const replacementClaudeMd = readFileSync(replacementClaudePath, 'utf8');
      expect(replacementClaudeMd).toContain('uploads/ is a read-only source directory for user-provided files.');
      expect(replacementClaudeMd).toContain('workspace/ is your free-form work area.');
      expect(replacementClaudeMd).toContain('Only content published into workspace/.deliveries/ is allowed to be returned to the user.');
      expect(replacementClaudeMd).toContain('Do not write files into workspace/.deliveries/ manually.');
      expect(replacementClaudeMd).toContain('publish-file.ts" <source> [displayName]');
      expect(replacementClaudeMd).toContain('publish-dir.ts" <sourceDir> [name]');
      expect(replacementClaudeMd).toContain('package-delivery.ts" <sourcePath> [outputName]');
      expect(replacementClaudeMd).toContain('If a published primary delivery is a directory, the Stop hook may package it into an archive before asking for the final [[file:...]] marker.');
      expect(replacementClaudeMd).toContain('Do not return files directly from uploads/, the session root, or arbitrary workspace paths.');
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
        id: 'hacked-id',
        channelId: 'hacked-channel',
        channelType: 'hacked-type'
      } as any);

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

  describe('registerRecentFiles', () => {
    it('registers recent files and refreshes duplicates by absolute path', () => {
      const session = orchestrator.getOrCreateSession('channel-1', 'discord');

      const updated = orchestrator.registerRecentFiles(session.id, [
        {
          id: 'file-1',
          displayName: 'report.html',
          relativePath: '.deliveries/report.html',
          absolutePath: '/tmp/project/workspace/.deliveries/report.html',
          source: 'claude_outbound',
          mediaType: 'text/html',
          lastSeenAt: new Date('2026-04-01T00:00:00.000Z'),
          summary: 'last sent html'
        },
        {
          id: 'file-2',
          displayName: 'report.html',
          relativePath: '.deliveries/report.html',
          absolutePath: '/tmp/project/workspace/.deliveries/report.html',
          source: 'claude_outbound',
          mediaType: 'text/html',
          lastSeenAt: new Date('2026-04-01T00:05:00.000Z'),
          summary: 'last sent html'
        }
      ]);

      expect(updated.recentFiles).toEqual([
        expect.objectContaining({
          source: 'claude_outbound',
          summary: 'last sent html',
          relativePath: '.deliveries/report.html'
        })
      ]);
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
