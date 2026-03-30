import { mkdtempSync } from 'node:fs';
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
});