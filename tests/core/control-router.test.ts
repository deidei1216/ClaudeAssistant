import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ControlStore } from '../../src/core/control-store';
import { ControlRouter } from '../../src/core/control-router';

describe('ControlRouter', () => {
  it('resolves a pending request into a saved control signal and resumes the run', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'control-router-'));
    const store = new ControlStore(baseDir);
    const router = new ControlRouter(store, () => new Date('2026-03-31T01:00:00.000Z'));

    store.saveRun({
      id: 'run-1',
      sessionId: 'session-1',
      title: 'Architect subagent',
      status: 'waiting_control',
      createdAt: new Date('2026-03-31T00:55:00.000Z'),
      updatedAt: new Date('2026-03-31T00:55:00.000Z')
    });
    store.saveRequest({
      id: 'request-1',
      runId: 'run-1',
      kind: 'approval',
      status: 'pending',
      summary: 'Approve the architecture plan',
      requestedAt: new Date('2026-03-31T00:59:00.000Z'),
      sourceMessage: {
        channelType: 'discord',
        channelId: 'channel-1',
        messageId: 'message-1'
      }
    });

    const result = router.resolve({
      channelType: 'discord',
      channelId: 'channel-1',
      messageId: 'message-1',
      signal: 'approve',
      userId: 'user-1',
      interactionType: 'reaction',
      rawValue: '👍',
      timestamp: new Date('2026-03-31T01:00:00.000Z')
    });

    expect(result?.signal.signal).toBe('approve');
    expect(result?.request.status).toBe('resolved');
    expect(result?.run.status).toBe('running');
  });

  it('marks hold signals as paused and keeps duplicate reactions idempotent', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'control-router-'));
    const store = new ControlStore(baseDir);
    const router = new ControlRouter(store, () => new Date('2026-03-31T01:10:00.000Z'));

    store.saveRun({
      id: 'run-2',
      sessionId: 'session-2',
      title: 'Tester subagent',
      status: 'waiting_control',
      createdAt: new Date('2026-03-31T01:05:00.000Z'),
      updatedAt: new Date('2026-03-31T01:05:00.000Z')
    });
    store.saveRequest({
      id: 'request-2',
      runId: 'run-2',
      kind: 'approval',
      status: 'pending',
      summary: 'Pause and wait',
      requestedAt: new Date('2026-03-31T01:09:00.000Z'),
      sourceMessage: {
        channelType: 'discord',
        channelId: 'channel-1',
        messageId: 'message-2'
      }
    });

    const first = router.resolve({
      channelType: 'discord',
      channelId: 'channel-1',
      messageId: 'message-2',
      signal: 'hold',
      userId: 'user-2',
      interactionType: 'reaction',
      rawValue: '👀',
      timestamp: new Date('2026-03-31T01:10:00.000Z')
    });
    const second = router.resolve({
      channelType: 'discord',
      channelId: 'channel-1',
      messageId: 'message-2',
      signal: 'hold',
      userId: 'user-2',
      interactionType: 'reaction',
      rawValue: '👀',
      timestamp: new Date('2026-03-31T01:11:00.000Z')
    });

    expect(first?.run.status).toBe('paused');
    expect(second).toBeNull();
  });
});