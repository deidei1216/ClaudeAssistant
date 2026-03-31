import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ControlStore } from '../../src/core/control-store';
import { AgentRun, ChannelProjection, ControlRequest, ControlSignal } from '../../src/core/types';

describe('ControlStore', () => {
  it('persists runs, requests, signals, and projections', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'control-store-'));
    const store = new ControlStore(baseDir);
    const run: AgentRun = {
      id: 'run-1',
      sessionId: 'session-1',
      title: 'Architect subagent',
      status: 'running',
      createdAt: new Date('2026-03-31T00:00:00.000Z'),
      updatedAt: new Date('2026-03-31T00:00:00.000Z')
    };
    const request: ControlRequest = {
      id: 'request-1',
      runId: 'run-1',
      kind: 'approval',
      status: 'pending',
      summary: 'Approve the architecture plan',
      requestedAt: new Date('2026-03-31T00:01:00.000Z'),
      sourceMessage: {
        channelType: 'discord',
        channelId: 'channel-1',
        messageId: 'message-1',
        threadId: 'thread-1'
      }
    };
    const signal: ControlSignal = {
      id: 'signal-1',
      requestId: 'request-1',
      runId: 'run-1',
      signal: 'approve',
      actor: {
        channelType: 'discord',
        userId: 'user-1'
      },
      source: {
        channelType: 'discord',
        channelId: 'channel-1',
        messageId: 'message-1',
        threadId: 'thread-1',
        interactionType: 'reaction',
        rawValue: '👍'
      },
      createdAt: new Date('2026-03-31T00:02:00.000Z')
    };
    const projection: ChannelProjection = {
      runId: 'run-1',
      channelType: 'discord',
      channelId: 'channel-1',
      threadId: 'thread-1',
      rootMessageId: 'root-1',
      lastStatusMessageId: 'message-1',
      title: 'Architect subagent',
      updatedAt: new Date('2026-03-31T00:03:00.000Z')
    };

    store.saveRun(run);
    store.saveRequest(request);
    store.saveSignal(signal);
    store.saveProjection(projection);

    expect(store.getRun('run-1')?.title).toBe('Architect subagent');
    expect(store.findPendingRequestBySourceMessage('discord', 'message-1')?.id).toBe('request-1');
    expect(store.getLatestSignalForRequest('request-1')?.signal).toBe('approve');
    expect(store.getProjection('discord', 'run-1')?.threadId).toBe('thread-1');
  });
});