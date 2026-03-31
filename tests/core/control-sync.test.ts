import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ControlSync } from '../../src/core/control-sync';
import { ControlStore } from '../../src/core/control-store';
import { ChannelAdapter } from '../../src/core/adapter';

describe('ControlSync', () => {
  it('creates a thread once and upserts the pending control message for adapters with control support', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'control-sync-'));
    const store = new ControlStore(baseDir);
    const adapter = {
      type: 'discord',
      name: 'Discord',
      createThread: vi.fn().mockResolvedValue({ channelId: 'thread-1', messageId: 'root-1', success: true }),
      upsertControlMessage: vi.fn().mockResolvedValue({ messageId: 'status-1', success: true })
    };

    store.saveRun({
      id: 'run-1',
      sessionId: 'session-1',
      title: 'Architect subagent',
      status: 'waiting_control',
      channelBinding: {
        channelType: 'discord',
        channelId: 'channel-1'
      },
      createdAt: new Date('2026-03-31T01:30:00.000Z'),
      updatedAt: new Date('2026-03-31T01:30:00.000Z')
    });
    store.saveRequest({
      id: 'request-1',
      runId: 'run-1',
      kind: 'approval',
      status: 'pending',
      summary: 'Approve the plan',
      requestedAt: new Date('2026-03-31T01:31:00.000Z')
    });

    const sync = new ControlSync({ adapters: [adapter as unknown as ChannelAdapter], controlStore: store, logger: console });
    await sync.syncOnce();

    expect(adapter.createThread).toHaveBeenCalled();
    expect(adapter.upsertControlMessage).toHaveBeenCalled();
    expect(store.getProjection('discord', 'run-1')?.threadId).toBe('thread-1');
  });

  it('skips adapters without control support', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'control-sync-skip-'));
    const store = new ControlStore(baseDir);
    const adapter = {
      type: 'discord',
      name: 'Discord'
      // No upsertControlMessage method
    };

    store.saveRun({
      id: 'run-2',
      sessionId: 'session-2',
      title: 'Test run',
      status: 'waiting_control',
      channelBinding: {
        channelType: 'discord',
        channelId: 'channel-2'
      },
      createdAt: new Date('2026-03-31T01:30:00.000Z'),
      updatedAt: new Date('2026-03-31T01:30:00.000Z')
    });
    store.saveRequest({
      id: 'request-2',
      runId: 'run-2',
      kind: 'approval',
      status: 'pending',
      summary: 'Approve',
      requestedAt: new Date('2026-03-31T01:31:00.000Z')
    });

    const sync = new ControlSync({ adapters: [adapter as unknown as ChannelAdapter], controlStore: store, logger: console });
    await sync.syncOnce();

    expect(store.getProjection('discord', 'run-2')).toBeNull();
  });

  it('reuses existing projection and does not create thread again', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'control-sync-reuse-'));
    const store = new ControlStore(baseDir);
    const adapter = {
      type: 'discord',
      name: 'Discord',
      createThread: vi.fn().mockResolvedValue({ channelId: 'thread-1', messageId: 'root-1', success: true }),
      upsertControlMessage: vi.fn().mockResolvedValue({ messageId: 'status-1', success: true })
    };

    store.saveRun({
      id: 'run-3',
      sessionId: 'session-3',
      title: 'Test run',
      status: 'waiting_control',
      channelBinding: {
        channelType: 'discord',
        channelId: 'channel-3'
      },
      createdAt: new Date('2026-03-31T01:30:00.000Z'),
      updatedAt: new Date('2026-03-31T01:30:00.000Z')
    });
    store.saveRequest({
      id: 'request-3',
      runId: 'run-3',
      kind: 'approval',
      status: 'pending',
      summary: 'Approve',
      requestedAt: new Date('2026-03-31T01:31:00.000Z')
    });
    // Pre-create a projection
    store.saveProjection({
      runId: 'run-3',
      channelType: 'discord',
      channelId: 'channel-3',
      threadId: 'existing-thread',
      title: 'Test run',
      updatedAt: new Date('2026-03-31T01:30:00.000Z')
    });

    const sync = new ControlSync({ adapters: [adapter as unknown as ChannelAdapter], controlStore: store, logger: console });
    await sync.syncOnce();

    expect(adapter.createThread).not.toHaveBeenCalled();
    expect(adapter.upsertControlMessage).toHaveBeenCalledWith('existing-thread', expect.any(Object), undefined);
  });

  it('starts and stops the sync loop', () => {
    vi.useFakeTimers();
    const baseDir = mkdtempSync(join(tmpdir(), 'control-sync-loop-'));
    const store = new ControlStore(baseDir);
    const adapter = {
      type: 'discord',
      name: 'Discord',
      upsertControlMessage: vi.fn().mockResolvedValue({ messageId: 'status-1', success: true })
    };

    const sync = new ControlSync({
      adapters: [adapter as unknown as ChannelAdapter],
      controlStore: store,
      logger: console,
      intervalMs: 1000
    });

    sync.start();
    expect(vi.getTimerCount()).toBe(1);

    sync.stop();
    expect(vi.getTimerCount()).toBe(0);

    vi.useRealTimers();
  });
});