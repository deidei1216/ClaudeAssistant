import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionOrchestrator } from '../../src/core/orchestrator';
import { AgentExecutor, AgentMessage } from '../../src/core/types';
import { ProfileManager } from '../../src/core/profile-manager';
import { SessionStore } from '../../src/core/session-store';

describe('SessionOrchestrator', () => {
  it('creates one session per channel and reuses it on later messages', async () => {
    const executor: AgentExecutor = {
      execute: vi.fn().mockResolvedValue({ content: 'hello from claude' })
    };
    const store = new SessionStore(mkdtempSync(join(tmpdir(), 'orchestrator-store-')));
    const profiles = new ProfileManager('profiles');
    const orchestrator = new SessionOrchestrator({
      sessionStore: store,
      profileManager: profiles,
      executor,
      defaults: {
        model: 'sonnet',
        permissionMode: 'auto',
        workingDirectory: '.'
      },
      clock: () => new Date('2026-03-30T00:00:00.000Z')
    });

    const first = orchestrator.getOrCreateSession('channel-1', 'discord');
    const second = orchestrator.getOrCreateSession('channel-1', 'discord');
    const message: AgentMessage = {
      id: 'msg-1',
      channelId: 'channel-1',
      channelType: 'discord',
      userId: 'user-1',
      content: 'summarize this repo',
      timestamp: new Date('2026-03-30T00:00:00.000Z')
    };

    const response = await orchestrator.execute(first.id, message);

    expect(second.id).toBe(first.id);
    expect(response.content).toBe('hello from claude');
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(orchestrator.getSession(first.id)?.messageCount).toBe(1);
  });
});