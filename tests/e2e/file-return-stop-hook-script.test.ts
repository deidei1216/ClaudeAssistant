import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertFileReturnE2EResult,
  createFileReturnE2EFixture,
  createMultiFileDirectReturnE2EFixture,
  createFileReturnE2ESettings,
  getFileReturnStopHookPath
} from '../../scripts/e2e/file-return-stop-hook';

describe('file-return stop hook e2e script helpers', () => {
  const tsxPath = join(process.cwd(), 'node_modules', '.bin', 'tsx');

  it('resolves the skill-owned stop hook entrypoint', () => {
    expect(getFileReturnStopHookPath()).toBe(
      join(process.cwd(), 'skills', 'file-return', 'file-return-stop.ts')
    );
  });

  it('creates a fixture workspace with a manifest-backed delivery and an expected marker', () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), 'file-return-e2e-script-'));
    const fixture = createFileReturnE2EFixture(rootDirectory);

    expect(fixture.expectedMarkers).toEqual(['[[file:.deliveries/demo.txt]]']);
    expect(fixture.prompt).toBe('把刚才那个文件直接发给我');
    expect(readFileSync(join(fixture.workingDirectory, '.deliveries', 'demo.txt'), 'utf8')).toBe('final report');
    expect(JSON.parse(readFileSync(join(fixture.workingDirectory, '.deliveries', 'manifest.json'), 'utf8'))).toEqual({
      version: 1,
      entries: [
        {
          kind: 'file',
          path: 'demo.txt',
          sourcePath: 'demo.txt',
          packaged: false
        }
      ],
      primary: 'demo.txt'
    });
  });

  it('creates a multi-file fixture that prefers direct attachments over zip output', () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), 'file-return-e2e-multi-script-'));
    const fixture = createMultiFileDirectReturnE2EFixture(rootDirectory);

    expect(fixture.expectedMarkers).toEqual([
      '[[file:.deliveries/crop_左上.png]]',
      '[[file:.deliveries/crop_右上.png]]',
      '[[file:.deliveries/crop_左下.png]]',
      '[[file:.deliveries/crop_右下.png]]'
    ]);
    expect(fixture.forbiddenSnippets).toEqual(['.zip', '[[file:.deliveries/4等份裁剪.zip]]']);
    expect(fixture.prompt).toContain('不要压缩包');
    expect(readFileSync(join(fixture.workingDirectory, '.deliveries', 'crop_左上.png'), 'utf8')).toBe('crop_左上.png bytes');
    expect(JSON.parse(readFileSync(join(fixture.workingDirectory, '.deliveries', 'manifest.json'), 'utf8'))).toEqual({
      version: 1,
      entries: [
        { kind: 'file', path: 'crop_左上.png', sourcePath: 'crop_左上.png', packaged: false },
        { kind: 'file', path: 'crop_右上.png', sourcePath: 'crop_右上.png', packaged: false },
        { kind: 'file', path: 'crop_左下.png', sourcePath: 'crop_左下.png', packaged: false },
        { kind: 'file', path: 'crop_右下.png', sourcePath: 'crop_右下.png', packaged: false }
      ],
      primary: null,
      handoff: ['crop_左上.png', 'crop_右上.png', 'crop_左下.png', 'crop_右下.png']
    });
  });

  it('creates a settings file that points Stop hooks at the skill-owned entrypoint', () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), 'file-return-e2e-settings-'));
    const settingsPath = createFileReturnE2ESettings(rootDirectory);
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      hooks?: {
        Stop?: Array<{
          hooks?: Array<{
            type?: string;
            command?: string;
          }>;
        }>;
      };
    };

    expect(parsed.hooks?.Stop?.[0]?.hooks?.[0]).toEqual({
      type: 'command',
      command: `npx tsx ${getFileReturnStopHookPath()}`
    });
  });

  it('executes the stop-hook entrypoint and emits a manifest-driven block response', () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), 'file-return-e2e-entrypoint-'));
    const fixture = createFileReturnE2EFixture(rootDirectory);
    const result = spawnSync(
      tsxPath,
      [getFileReturnStopHookPath()],
      {
        cwd: fixture.workingDirectory,
        input: JSON.stringify({
          cwd: fixture.workingDirectory,
          hook_event_name: 'Stop',
          stop_hook_active: false,
          last_assistant_message: '文件已经准备好了。'
        }),
        encoding: 'utf8'
      }
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      decision: 'block',
      reason: expect.stringContaining(fixture.expectedMarkers[0] ?? '')
    });
  });

  it('executes the stop-hook entrypoint for a primary directory and emits the packaged archive marker', () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-e2e-entrypoint-dir-'));
    mkdirSync(join(workingDirectory, '.deliveries', 'site'), { recursive: true });
    writeFileSync(join(workingDirectory, '.deliveries', 'site', 'index.html'), '<html>ok</html>');
    writeFileSync(
      join(workingDirectory, '.deliveries', 'manifest.json'),
      JSON.stringify(
        {
          version: 1,
          entries: [
            {
              kind: 'directory',
              path: 'site',
              sourcePath: 'site',
              packaged: false
            }
          ],
          primary: 'site'
        },
        null,
        2
      )
    );

    const result = spawnSync(
      tsxPath,
      [getFileReturnStopHookPath()],
      {
        cwd: workingDirectory,
        input: JSON.stringify({
          cwd: workingDirectory,
          hook_event_name: 'Stop',
          stop_hook_active: false,
          last_assistant_message: '站点已经准备好了。'
        }),
        encoding: 'utf8'
      }
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      decision: 'block',
      reason: expect.stringContaining('[[file:.deliveries/site.zip]]')
    });
  });

  it('accepts claude output only when it contains the expected bridge marker', () => {
    expect(() =>
      assertFileReturnE2EResult(
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'done\n[[file:.deliveries/demo.txt]]'
        }),
        ['[[file:.deliveries/demo.txt]]']
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
        ['[[file:.deliveries/demo.txt]]']
      )
    ).toThrow('Expected Claude result to include [[file:.deliveries/demo.txt]]');
  });

  it('rejects claude output that falls back to zip text in the direct multi-file scenario', () => {
    expect(() =>
      assertFileReturnE2EResult(
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: '[[file:.deliveries/crop_左上.png]]\n[[file:.deliveries/crop_右上.png]]\n[[file:.deliveries/crop_左下.png]]\n[[file:.deliveries/crop_右下.png]]'
        }),
        [
          '[[file:.deliveries/crop_左上.png]]',
          '[[file:.deliveries/crop_右上.png]]',
          '[[file:.deliveries/crop_左下.png]]',
          '[[file:.deliveries/crop_右下.png]]'
        ],
        ['.zip']
      )
    ).not.toThrow();

    expect(() =>
      assertFileReturnE2EResult(
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: '[[file:.deliveries/crop_左上.png]]\n或打包下载：[[file:.deliveries/4等份裁剪.zip]]'
        }),
        ['[[file:.deliveries/crop_左上.png]]'],
        ['.zip']
      )
    ).toThrow('Expected Claude result not to include .zip');
  });
});
