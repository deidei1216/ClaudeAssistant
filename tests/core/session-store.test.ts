import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionStore } from '../../src/core/session-store';
import { SessionProfile } from '../../src/core/types';

describe('SessionStore', () => {
  it('persists and reloads a session keyed by channel', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'session-store-'));
    const store = new SessionStore(baseDir);
    const session: SessionProfile = {
      id: '9e0ef8e2-f9d7-4fb9-a261-4d35bc8b23eb',
      channelId: 'channel-1',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory: '.',
      permissionMode: 'auto',
      createdAt: new Date('2026-03-30T00:00:00.000Z'),
      lastActiveAt: new Date('2026-03-30T00:00:00.000Z'),
      status: 'active',
      messageCount: 0
    };

    store.save(session);

    expect(store.loadByChannel('discord', 'channel-1')).toEqual(session);
  });

  it('loadByChannel returns null when session does not exist', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'session-store-'));
    const store = new SessionStore(baseDir);

    expect(store.loadByChannel('discord', 'nonexistent-channel')).toBeNull();
  });

  it('list returns all sessions sorted by lastActiveAt descending', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'session-store-'));
    const store = new SessionStore(baseDir);

    const session1: SessionProfile = {
      id: 'session-1',
      channelId: 'channel-1',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory: '.',
      permissionMode: 'auto',
      createdAt: new Date('2026-03-28T00:00:00.000Z'),
      lastActiveAt: new Date('2026-03-28T00:00:00.000Z'),
      status: 'active',
      messageCount: 0
    };

    const session2: SessionProfile = {
      id: 'session-2',
      channelId: 'channel-2',
      channelType: 'discord',
      model: 'opus',
      workingDirectory: '.',
      permissionMode: 'plan',
      createdAt: new Date('2026-03-29T00:00:00.000Z'),
      lastActiveAt: new Date('2026-03-30T12:00:00.000Z'),
      status: 'active',
      messageCount: 5
    };

    const session3: SessionProfile = {
      id: 'session-3',
      channelId: 'channel-3',
      channelType: 'slack',
      model: 'haiku',
      workingDirectory: '/tmp',
      permissionMode: 'auto',
      createdAt: new Date('2026-03-30T00:00:00.000Z'),
      lastActiveAt: new Date('2026-03-29T00:00:00.000Z'),
      status: 'active',
      messageCount: 2
    };

    store.save(session1);
    store.save(session2);
    store.save(session3);

    const sessions = store.list();
    expect(sessions).toHaveLength(3);
    // Should be sorted by lastActiveAt descending
    expect(sessions[0].id).toBe('session-2'); // Most recent
    expect(sessions[1].id).toBe('session-3');
    expect(sessions[2].id).toBe('session-1'); // Oldest
  });

  it('list returns empty array when no sessions exist', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'session-store-'));
    const store = new SessionStore(baseDir);

    expect(store.list()).toEqual([]);
  });

  it('list ignores non-json files in session directories', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'session-store-'));
    const store = new SessionStore(baseDir);

    const session: SessionProfile = {
      id: 'session-json-only',
      channelId: 'channel-json-only',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory: '.',
      permissionMode: 'auto',
      createdAt: new Date('2026-03-30T00:00:00.000Z'),
      lastActiveAt: new Date('2026-03-30T00:00:00.000Z'),
      status: 'active',
      messageCount: 0
    };

    store.save(session);
    writeFileSync(join(baseDir, 'discord', '.DS_Store'), Buffer.from([0x00, 0x00, 0x00, 0x01, 0x42, 0x75, 0x64, 0x31, 0x00, 0x00]));

    expect(store.list()).toEqual([session]);
  });

  it('multiple sessions can be saved and retrieved independently', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'session-store-'));
    const store = new SessionStore(baseDir);

    const discordSession: SessionProfile = {
      id: 'discord-session',
      channelId: 'discord-channel-1',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory: '/discord/work',
      permissionMode: 'auto',
      createdAt: new Date('2026-03-30T00:00:00.000Z'),
      lastActiveAt: new Date('2026-03-30T00:00:00.000Z'),
      status: 'active',
      messageCount: 10
    };

    const slackSession: SessionProfile = {
      id: 'slack-session',
      channelId: 'slack-channel-1',
      channelType: 'slack',
      model: 'opus',
      workingDirectory: '/slack/work',
      permissionMode: 'plan',
      createdAt: new Date('2026-03-30T00:00:00.000Z'),
      lastActiveAt: new Date('2026-03-30T01:00:00.000Z'),
      status: 'active',
      messageCount: 20
    };

    store.save(discordSession);
    store.save(slackSession);

    // Retrieve each session independently
    const retrievedDiscord = store.loadByChannel('discord', 'discord-channel-1');
    const retrievedSlack = store.loadByChannel('slack', 'slack-channel-1');

    expect(retrievedDiscord).toEqual(discordSession);
    expect(retrievedSlack).toEqual(slackSession);

    // Verify they are truly independent
    expect(retrievedDiscord?.id).toBe('discord-session');
    expect(retrievedSlack?.id).toBe('slack-session');
    expect(retrievedDiscord?.workingDirectory).toBe('/discord/work');
    expect(retrievedSlack?.workingDirectory).toBe('/slack/work');
  });

  it('persists recent files with date fields', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'session-store-'));
    const store = new SessionStore(baseDir);
    const session: SessionProfile = {
      id: 'session-with-files',
      channelId: 'channel-files',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory: '/tmp/project',
      permissionMode: 'auto',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      lastActiveAt: new Date('2026-04-01T00:00:00.000Z'),
      status: 'active',
      messageCount: 1,
      recentFiles: [
        {
          id: 'file-1',
          displayName: 'report.html',
          relativePath: 'outputs/report.html',
          absolutePath: '/tmp/project/outputs/report.html',
          source: 'workspace_detected',
          mediaType: 'text/html',
          lastSeenAt: new Date('2026-04-01T00:01:00.000Z'),
          summary: 'generated html'
        }
      ]
    };

    store.save(session);

    expect(store.loadByChannel('discord', 'channel-files')).toEqual(session);
  });
});
