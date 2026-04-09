import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionStore } from '../../core/session-store';
import { SessionProfile } from '../../core/types';
import { buildSessionClaudeMd } from '../../core/session-claude-md';
import { createInitialDeliveryManifest } from '../../core/delivery-paths';

describe('SessionStore', () => {
  it('persists and reloads a session keyed by channel', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'session-store-'));
    const store = new SessionStore(baseDir);
    const session: SessionProfile = {
      id: 'discord-channel-1',
      channelId: 'channel-1',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory: join(baseDir, 'discord-channel-1', 'workspace'),
      permissionMode: 'auto',
      createdAt: new Date('2026-03-30T00:00:00.000Z'),
      lastActiveAt: new Date('2026-03-30T00:00:00.000Z'),
      status: 'active',
      messageCount: 0
    };

    store.save(session);

    expect(store.loadByChannel('discord', 'channel-1')).toEqual(session);
    expect(existsSync(join(baseDir, session.id, 'session.json'))).toBe(true);
    expect(existsSync(join(baseDir, session.id, 'workspace'))).toBe(true);
    expect(existsSync(join(baseDir, session.id, 'uploads'))).toBe(true);
    expect(lstatSync(join(baseDir, session.id, 'workspace', 'uploads')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(baseDir, session.id, 'workspace', 'uploads'))).toBe('../uploads');
    expect(existsSync(join(baseDir, session.id, 'workspace', '.deliveries'))).toBe(true);
    expect(
      readFileSync(join(baseDir, session.id, 'workspace', '.deliveries', 'manifest.json'), 'utf8')
    ).toBe(JSON.stringify(createInitialDeliveryManifest(), null, 2));
  });

  it('creates a fresh manifest entries array for each scaffolded session', () => {
    const first = createInitialDeliveryManifest();
    const second = createInitialDeliveryManifest();

    first.entries.push({ path: 'example.txt' });

    expect(second.entries).toEqual([]);
    expect(first.entries).not.toBe(second.entries);
  });

  it('exposes the exact session CLAUDE.md delivery contract text', () => {
    const contract = buildSessionClaudeMd();

    expect(contract).toContain('uploads/ is a read-only source directory for user-provided files.');
    expect(contract).toContain('workspace/ is your free-form work area.');
    expect(contract).toContain('Every Bash command starts in workspace/.');
    expect(contract).toContain('User-uploaded source files are available from workspace as uploads/... .');
    expect(contract).toContain('Do not assume that cd from one Bash command persists into the next command.');
    expect(contract).toContain('Only content published into workspace/.deliveries/ is allowed to be returned to the user.');
    expect(contract).toContain('Do not write files into workspace/.deliveries/ manually.');
    expect(contract).toContain(
      'Copying a file into workspace/.deliveries/ without updating the manifest does not count as publishing.'
    );
    expect(contract).toContain('publish-file.ts" <source> [displayName]');
    expect(contract).toContain('publish-dir.ts" <sourceDir> [name]');
    expect(contract).toContain('package-delivery.ts" <sourcePath> [outputName]');
    expect(contract).toContain('If a published primary delivery is a directory, the Stop hook may package it into an archive before asking for the final [[file:...]] marker.');
    expect(contract).toContain('If a task should return files, call a publish script before your final answer. Use package-delivery when you need to choose the archive contents explicitly.');
    expect(contract).toContain('For a small set of standalone files that can be viewed directly in chat, publish each file separately and return multiple [[file:...]] markers, one per line.');
    expect(contract).toContain('Do not create or mention a zip archive when direct file attachments are practical, unless the user explicitly asks for an archive.');
    expect(contract).toContain('package-delivery only accepts a previously published entry from workspace/.deliveries/, usually a directory published with publish-dir.');
    expect(contract).toContain('When returning a published file, your final answer must include the exact published path under .deliveries/, for example [[file:.deliveries/example.png]].');
    expect(contract).toContain('Do not use bare filenames like [[file:example.png]] or workspace-prefixed paths like [[file:workspace/.deliveries/example.png]].');
    expect(contract).toContain('If the Stop hook gives you an exact [[file:...]] marker to use, copy that marker verbatim and replace any incorrect file marker with it.');
    expect(contract).toContain('Do not return files directly from uploads/, the session root, or arbitrary workspace paths.');
  });

  it('keeps the delivery boundary anchored at the workspace root for nested working directories', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'session-store-'));
    const store = new SessionStore(baseDir);
    const session: SessionProfile = {
      id: 'nested-session',
      channelId: 'nested-channel',
      channelType: 'discord',
      model: 'sonnet',
      workingDirectory: join(baseDir, 'nested-session', 'workspace', 'drafts', 'iteration-1'),
      permissionMode: 'auto',
      createdAt: new Date('2026-03-30T00:00:00.000Z'),
      lastActiveAt: new Date('2026-03-30T00:00:00.000Z'),
      status: 'active',
      messageCount: 0
    };

    store.save(session);

    expect(existsSync(join(baseDir, session.id, 'workspace', '.deliveries'))).toBe(true);
    expect(
      readFileSync(join(baseDir, session.id, 'workspace', '.deliveries', 'manifest.json'), 'utf8')
    ).toBe(JSON.stringify(createInitialDeliveryManifest(), null, 2));
    expect(existsSync(join(baseDir, session.id, 'workspace', 'drafts', 'iteration-1', '.deliveries'))).toBe(false);
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

  it('list ignores non-json files in base directory', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'session-store-'));
    const store = new SessionStore(baseDir);

    const session: SessionProfile = {
      id: 'session-1',
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
    writeFileSync(join(baseDir, '.DS_Store'), Buffer.from([0x00, 0x00, 0x00, 0x01, 0x42, 0x75, 0x64, 0x31, 0x00, 0x00]));
    
    // Also test a directory without session.json
    mkdirSync(join(baseDir, 'empty-dir'), { recursive: true });

    expect(store.list()).toEqual([session]);
  });

  it('multiple sessions can be saved and retrieved independently', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'session-store-'));
    const store = new SessionStore(baseDir);

    const discordSession: SessionProfile = {
      id: 'discord-discord-channel-1',
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
      id: 'slack-slack-channel-1',
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
  });

  it('persists recent files with date fields', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'session-store-'));
    const store = new SessionStore(baseDir);
    const session: SessionProfile = {
      id: 'discord-channel-files',
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
          relativePath: '.deliveries/report.html',
          absolutePath: '/tmp/project/workspace/.deliveries/report.html',
          source: 'claude_outbound',
          mediaType: 'text/html',
          lastSeenAt: new Date('2026-04-01T00:01:00.000Z'),
          summary: 'last sent html'
        }
      ]
    };

    store.save(session);

    expect(store.loadByChannel('discord', 'channel-files')).toEqual(session);
  });
});
