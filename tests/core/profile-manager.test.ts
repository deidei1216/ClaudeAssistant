import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProfileManager } from '../../src/core/profile-manager';

describe('ProfileManager', () => {
  it('loads a profile and keeps only session-overridable fields', () => {
    const root = mkdtempSync(join(tmpdir(), 'profiles-'));
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'writing.json'),
      JSON.stringify({
        name: 'writing',
        description: 'Writing mode',
        model: 'opus',
        permissionMode: 'plan',
        customSystemPrompt: 'Write concise drafts.'
      })
    );

    const manager = new ProfileManager(root);
    const profile = manager.load('writing');

    expect(profile.name).toBe('writing');
    expect(profile.model).toBe('opus');
    expect(profile.permissionMode).toBe('plan');
    expect(profile.customSystemPrompt).toContain('concise');
  });
});