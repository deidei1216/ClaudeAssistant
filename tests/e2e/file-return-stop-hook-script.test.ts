import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertFileReturnE2EResult,
  createFileReturnE2EFixture,
  getFileReturnStopHookPath
} from '../../scripts/e2e/file-return-stop-hook';

describe('file-return stop hook e2e script helpers', () => {
  it('resolves the skill-owned stop hook entrypoint', () => {
    expect(getFileReturnStopHookPath()).toBe(
      join(process.cwd(), 'skills', 'file-return', 'file-return-stop.ts')
    );
  });

  it('creates a fixture workspace with recent-files memory and an expected marker', () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), 'file-return-e2e-script-'));
    const fixture = createFileReturnE2EFixture(rootDirectory);

    expect(fixture.expectedMarker).toBe('[[file:.claude-gateway/outbox/demo.txt]]');
    expect(readFileSync(join(fixture.workingDirectory, '.claude-gateway', 'outbox', 'demo.txt'), 'utf8')).toBe('final report');
    expect(
      JSON.parse(readFileSync(join(fixture.workingDirectory, '.claude-gateway', 'memory', 'recent-files.json'), 'utf8'))
    ).toEqual({
      recentFiles: [
        expect.objectContaining({
          relativePath: '.claude-gateway/outbox/demo.txt',
          source: 'workspace_detected',
          summary: 'generated report'
        })
      ]
    });
  });

  it('accepts claude output only when it contains the expected bridge marker', () => {
    expect(() =>
      assertFileReturnE2EResult(
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'done\n[[file:.claude-gateway/outbox/demo.txt]]'
        }),
        '[[file:.claude-gateway/outbox/demo.txt]]'
      )
    ).not.toThrow();

    expect(() =>
      assertFileReturnE2EResult(
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'done'
        }),
        '[[file:.claude-gateway/outbox/demo.txt]]'
      )
    ).toThrow('Expected Claude result to include [[file:.claude-gateway/outbox/demo.txt]]');
  });
});
