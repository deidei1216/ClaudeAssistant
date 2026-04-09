import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFileReturnStopHook } from '../../skills/file-return/file-return-stop';
import { readDeliveryManifest, writeDeliveryManifest } from '../../skills/file-return/lib/delivery-manifest';
import { packageArtifacts } from '../../skills/file-return/lib/package-artifacts';

describe('file return skill scripts', () => {
  const tsxPath = join(process.cwd(), 'node_modules', '.bin', 'tsx');

  function writeTranscript(workingDirectory: string, records: unknown[]): string {
    const transcriptPath = join(workingDirectory, 'transcript.jsonl');
    writeFileSync(transcriptPath, records.map((record) => JSON.stringify(record)).join('\n'));
    return transcriptPath;
  }

  it('keeps the file-return skill contract in the skill files and out of CLAUDE.md', () => {
    const claudeMd = readFileSync(join(process.cwd(), 'CLAUDE.md'), 'utf8');
    const skillMd = readFileSync(join(process.cwd(), 'skills', 'file-return', 'SKILL.md'), 'utf8');
    const openaiYaml = readFileSync(join(process.cwd(), 'skills', 'file-return', 'agents', 'openai.yaml'), 'utf8');

    expect(claudeMd).not.toContain('### File Return Protocol');
    expect(skillMd).toContain('---\nname: file-return\n');
    expect(skillMd).toContain('description: Use when');
    expect(skillMd).toContain('## Runtime Entry');
    expect(skillMd).toContain('file-return-stop.ts');
    expect(openaiYaml).toContain('display_name:');
    expect(openaiYaml).toContain('short_description:');
    expect(openaiYaml).toContain('default_prompt:');
  });

  it('registers the Stop hook from the file-return skill entrypoint', async () => {
    const settings = JSON.parse(readFileSync(join(process.cwd(), '.claude', 'settings.json'), 'utf8')) as {
      hooks?: {
        Stop?: Array<{
          hooks?: Array<{
            type?: string;
            command?: string;
          }>;
        }>;
      };
    };

    expect(settings.hooks?.Stop?.[0]?.hooks?.[0]).toEqual(
      expect.objectContaining({
        type: 'command'
      })
    );
    expect(settings.hooks?.Stop?.[0]?.hooks?.[0]?.command).toContain('skills/file-return/file-return-stop.ts');
  });

  it('executes the file-return skill entrypoint via tsx and returns JSON on stdout', { timeout: 15000 }, async () => {
    const scriptPath = join(process.cwd(), 'skills', 'file-return', 'file-return-stop.ts');
    const result = spawnSync(
      'npx',
      [
        'tsx',
        scriptPath
      ],
      {
        input: JSON.stringify({
          cwd: process.cwd(),
          hook_event_name: 'Stop',
          stop_hook_active: true,
          last_assistant_message: '已经准备好了。'
        }),
        encoding: 'utf8'
      }
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('{}');
  });

  it('packages multiple related artifacts into a single zip deliverable', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-package-'));
    mkdirSync(join(workingDirectory, 'exports'), { recursive: true });
    writeFileSync(join(workingDirectory, 'exports', 'one.html'), '<html>one</html>');
    writeFileSync(join(workingDirectory, 'exports', 'two.html'), '<html>two</html>');
    const result = await packageArtifacts({
      cwd: workingDirectory,
      files: ['exports/one.html', 'exports/two.html'],
      outputName: 'exports/site-bundle.zip'
    });

    expect(result).toEqual({
      outputPath: 'exports/site-bundle.zip'
    });

    const archivePath = join(workingDirectory, 'exports', 'site-bundle.zip');
    const integrity = spawnSync('unzip', ['-t', archivePath], { encoding: 'utf8' });
    const listing = spawnSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' });

    expect(integrity.status).toBe(0);
    expect(listing.status).toBe(0);
    expect(listing.stdout.trim().split('\n')).toEqual(['exports/one.html', 'exports/two.html']);
  });

  it('publishes a single file into workspace/.deliveries and marks it primary in the manifest', () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-publish-file-'));
    const sourcePath = join(workingDirectory, 'report.txt');
    writeFileSync(sourcePath, 'ready to deliver');

    const scriptPath = join(process.cwd(), 'scripts', 'delivery', 'publish-file.ts');
    const result = spawnSync(tsxPath, [scriptPath, sourcePath], {
      cwd: workingDirectory,
      encoding: 'utf8'
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(readFileSync(join(workingDirectory, '.deliveries', 'report.txt'), 'utf8')).toBe('ready to deliver');
    expect(readDeliveryManifest(workingDirectory)).toEqual({
      version: 1,
      entries: [
        {
          kind: 'file',
          path: 'report.txt',
          sourcePath: 'report.txt',
          packaged: false
        }
      ],
      primary: 'report.txt'
    });
  });

  it('publishes a workspace-prefixed file path without duplicating the workspace segment', () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-publish-file-'));
    writeFileSync(join(workingDirectory, 'avatar_cropped.png'), 'png bytes');

    const scriptPath = join(process.cwd(), 'scripts', 'delivery', 'publish-file.ts');
    const result = spawnSync(tsxPath, [scriptPath, 'workspace/avatar_cropped.png', '头像.png'], {
      cwd: workingDirectory,
      encoding: 'utf8'
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(readFileSync(join(workingDirectory, '.deliveries', '头像.png'), 'utf8')).toBe('png bytes');
    expect(readDeliveryManifest(workingDirectory)).toEqual({
      version: 1,
      entries: [
        {
          kind: 'file',
          path: '头像.png',
          sourcePath: 'avatar_cropped.png',
          packaged: false
        }
      ],
      primary: '头像.png'
    });
  });

  it('publishes a directory into workspace/.deliveries and records it without scanning the workspace', () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-publish-dir-'));
    mkdirSync(join(workingDirectory, 'site'), { recursive: true });
    writeFileSync(join(workingDirectory, 'site', 'index.html'), '<html>ok</html>');
    writeFileSync(join(workingDirectory, 'unpublished.txt'), 'do not include');

    const scriptPath = join(process.cwd(), 'scripts', 'delivery', 'publish-dir.ts');
    const result = spawnSync(tsxPath, [scriptPath, 'site'], {
      cwd: workingDirectory,
      encoding: 'utf8'
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(readFileSync(join(workingDirectory, '.deliveries', 'site', 'index.html'), 'utf8')).toBe('<html>ok</html>');
    expect(readDeliveryManifest(workingDirectory)).toEqual({
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
    });
  });

  it('publishes a workspace-prefixed directory path without duplicating the workspace segment', () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-publish-dir-'));
    mkdirSync(join(workingDirectory, 'site'), { recursive: true });
    writeFileSync(join(workingDirectory, 'site', 'index.html'), '<html>ok</html>');

    const scriptPath = join(process.cwd(), 'scripts', 'delivery', 'publish-dir.ts');
    const result = spawnSync(tsxPath, [scriptPath, 'workspace/site', '站点'], {
      cwd: workingDirectory,
      encoding: 'utf8'
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(readFileSync(join(workingDirectory, '.deliveries', '站点', 'index.html'), 'utf8')).toBe('<html>ok</html>');
    expect(readDeliveryManifest(workingDirectory)).toEqual({
      version: 1,
      entries: [
        {
          kind: 'directory',
          path: '站点',
          sourcePath: 'site',
          packaged: false
        }
      ],
      primary: '站点'
    });
  });

  it('makes a newly published directory primary by default even when an older file delivery already exists', () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-publish-dir-'));
    writeFileSync(join(workingDirectory, 'avatar.png'), 'old avatar');
    mkdirSync(join(workingDirectory, 'site'), { recursive: true });
    writeFileSync(join(workingDirectory, 'site', 'index.html'), '<html>ok</html>');

    const publishFileScriptPath = join(process.cwd(), 'scripts', 'delivery', 'publish-file.ts');
    const publishDirScriptPath = join(process.cwd(), 'scripts', 'delivery', 'publish-dir.ts');

    expect(spawnSync(tsxPath, [publishFileScriptPath, 'avatar.png', '头像.png'], {
      cwd: workingDirectory,
      encoding: 'utf8'
    }).status).toBe(0);

    const publishDirResult = spawnSync(tsxPath, [publishDirScriptPath, 'site', '4等分图片'], {
      cwd: workingDirectory,
      encoding: 'utf8'
    });

    expect(publishDirResult.status).toBe(0);
    expect(readDeliveryManifest(workingDirectory)).toEqual({
      version: 1,
      entries: [
        {
          kind: 'file',
          path: '头像.png',
          sourcePath: 'avatar.png',
          packaged: false
        },
        {
          kind: 'directory',
          path: '4等分图片',
          sourcePath: 'site',
          packaged: false
        }
      ],
      primary: '4等分图片'
    });
  });

  it('does not treat --no-primary as a rename when publishing a file', () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-publish-file-'));
    writeFileSync(join(workingDirectory, 'report.txt'), 'ready to deliver');

    const scriptPath = join(process.cwd(), 'scripts', 'delivery', 'publish-file.ts');
    const result = spawnSync(tsxPath, [scriptPath, 'report.txt', '--no-primary'], {
      cwd: workingDirectory,
      encoding: 'utf8'
    });

    expect(result.status).toBe(0);
    expect(readFileSync(join(workingDirectory, '.deliveries', 'report.txt'), 'utf8')).toBe('ready to deliver');
    expect(readDeliveryManifest(workingDirectory)).toEqual({
      version: 1,
      entries: [
        {
          kind: 'file',
          path: 'report.txt',
          sourcePath: 'report.txt',
          packaged: false
        }
      ],
      primary: null
    });
  });

  it('does not treat --primary as a rename when publishing a directory', () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-publish-dir-'));
    mkdirSync(join(workingDirectory, 'site'), { recursive: true });
    writeFileSync(join(workingDirectory, 'site', 'index.html'), '<html>ok</html>');

    const scriptPath = join(process.cwd(), 'scripts', 'delivery', 'publish-dir.ts');
    const result = spawnSync(tsxPath, [scriptPath, 'site', '--primary'], {
      cwd: workingDirectory,
      encoding: 'utf8'
    });

    expect(result.status).toBe(0);
    expect(readFileSync(join(workingDirectory, '.deliveries', 'site', 'index.html'), 'utf8')).toBe('<html>ok</html>');
    expect(readDeliveryManifest(workingDirectory)).toEqual({
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
    });
  });

  it('rejects traversal in publish-file destination names before writing', () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-publish-file-'));
    writeFileSync(join(workingDirectory, 'report.txt'), 'ready to deliver');

    const scriptPath = join(process.cwd(), 'scripts', 'delivery', 'publish-file.ts');
    const result = spawnSync(tsxPath, [scriptPath, 'report.txt', '../escape.txt'], {
      cwd: workingDirectory,
      encoding: 'utf8'
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('must stay inside .deliveries');
    expect(() => readFileSync(join(workingDirectory, '.deliveries', 'escape.txt'), 'utf8')).toThrow();
    expect(readDeliveryManifest(workingDirectory)).toEqual({
      version: 1,
      entries: [],
      primary: null
    });
  });

  it('rejects traversal in publish-dir destination names before writing', () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-publish-dir-'));
    mkdirSync(join(workingDirectory, 'site'), { recursive: true });
    writeFileSync(join(workingDirectory, 'site', 'index.html'), '<html>ok</html>');

    const scriptPath = join(process.cwd(), 'scripts', 'delivery', 'publish-dir.ts');
    const result = spawnSync(tsxPath, [scriptPath, 'site', '../escape'], {
      cwd: workingDirectory,
      encoding: 'utf8'
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('must stay inside .deliveries');
    expect(() => readFileSync(join(workingDirectory, '.deliveries', 'escape', 'index.html'), 'utf8')).toThrow();
    expect(readDeliveryManifest(workingDirectory)).toEqual({
      version: 1,
      entries: [],
      primary: null
    });
  });

  it('packages a published delivery entry and records the archive as primary', () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-package-delivery-'));
    mkdirSync(join(workingDirectory, 'site'), { recursive: true });
    writeFileSync(join(workingDirectory, 'site', 'index.html'), '<html>ok</html>');

    const publishDirScriptPath = join(process.cwd(), 'scripts', 'delivery', 'publish-dir.ts');
    const publishDirResult = spawnSync(tsxPath, [publishDirScriptPath, 'site'], {
      cwd: workingDirectory,
      encoding: 'utf8'
    });
    expect(publishDirResult.status).toBe(0);

    const packageScriptPath = join(process.cwd(), 'scripts', 'delivery', 'package-delivery.ts');
    const packageResult = spawnSync(tsxPath, [packageScriptPath, 'site'], {
      cwd: workingDirectory,
      encoding: 'utf8'
    });

    expect(packageResult.status).toBe(0);
    const archivePath = join(workingDirectory, '.deliveries', 'site.zip');
    const integrity = spawnSync('unzip', ['-t', archivePath], { encoding: 'utf8' });
    const listing = spawnSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' });

    expect(integrity.status).toBe(0);
    expect(listing.status).toBe(0);
    expect(listing.stdout.trim().split('\n')).toEqual(['site/', 'site/index.html']);
    expect(readDeliveryManifest(workingDirectory)).toEqual({
      version: 1,
      entries: [
        {
          kind: 'directory',
          path: 'site',
          sourcePath: 'site',
          packaged: false
        },
        {
          kind: 'archive',
          path: 'site.zip',
          sourcePath: 'site',
          packaged: true
        }
      ],
      primary: 'site.zip'
    });
  });

  it('replaces an existing archive when package-delivery is run again for the same entry', () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-package-delivery-'));
    mkdirSync(join(workingDirectory, 'site'), { recursive: true });
    writeFileSync(join(workingDirectory, 'site', 'index.html'), '<html>first</html>');
    writeFileSync(join(workingDirectory, 'site', 'stale.txt'), 'stale file');

    const publishDirScriptPath = join(process.cwd(), 'scripts', 'delivery', 'publish-dir.ts');
    const publishDirResult = spawnSync(tsxPath, [publishDirScriptPath, 'site'], {
      cwd: workingDirectory,
      encoding: 'utf8'
    });
    expect(publishDirResult.status).toBe(0);

    const packageScriptPath = join(process.cwd(), 'scripts', 'delivery', 'package-delivery.ts');
    const firstPackageResult = spawnSync(tsxPath, [packageScriptPath, 'site'], {
      cwd: workingDirectory,
      encoding: 'utf8'
    });
    expect(firstPackageResult.status).toBe(0);

    writeFileSync(join(workingDirectory, '.deliveries', 'site', 'index.html'), '<html>second</html>');
    rmSync(join(workingDirectory, '.deliveries', 'site', 'stale.txt'));
    writeFileSync(join(workingDirectory, '.deliveries', 'site', 'fresh.txt'), 'fresh file');

    const secondPackageResult = spawnSync(tsxPath, [packageScriptPath, 'site'], {
      cwd: workingDirectory,
      encoding: 'utf8'
    });

    expect(secondPackageResult.status).toBe(0);

    const archivePath = join(workingDirectory, '.deliveries', 'site.zip');
    const listing = spawnSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' });
    const extractedIndex = spawnSync('unzip', ['-p', archivePath, 'site/index.html'], { encoding: 'utf8' });

    expect(listing.status).toBe(0);
    expect(extractedIndex.status).toBe(0);
    expect(listing.stdout.trim().split('\n')).toEqual(['site/', 'site/index.html', 'site/fresh.txt']);
    expect(extractedIndex.stdout.trim()).toBe('<html>second</html>');
  });

  it('rejects package-delivery when a published zip would be overwritten in place', () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-package-delivery-'));
    writeFileSync(join(workingDirectory, 'report.txt'), 'report body');

    const publishFileScriptPath = join(process.cwd(), 'scripts', 'delivery', 'publish-file.ts');
    const publishFileResult = spawnSync(tsxPath, [publishFileScriptPath, 'report.txt', 'bundle.zip'], {
      cwd: workingDirectory,
      encoding: 'utf8'
    });
    expect(publishFileResult.status).toBe(0);

    const packageScriptPath = join(process.cwd(), 'scripts', 'delivery', 'package-delivery.ts');
    const result = spawnSync(tsxPath, [packageScriptPath, 'bundle.zip'], {
      cwd: workingDirectory,
      encoding: 'utf8'
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('must not match the published source path');
    expect(readFileSync(join(workingDirectory, '.deliveries', 'bundle.zip'), 'utf8')).toBe('report body');
    expect(readDeliveryManifest(workingDirectory)).toEqual({
      version: 1,
      entries: [
        {
          kind: 'file',
          path: 'bundle.zip',
          sourcePath: 'report.txt',
          packaged: false
        }
      ],
      primary: 'bundle.zip'
    });
  });

  it('rejects package-delivery for unpublished paths outside the manifest', () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-package-delivery-'));
    mkdirSync(join(workingDirectory, '.deliveries', 'site'), { recursive: true });
    writeFileSync(join(workingDirectory, '.deliveries', 'site', 'index.html'), '<html>ok</html>');

    const packageScriptPath = join(process.cwd(), 'scripts', 'delivery', 'package-delivery.ts');
    const result = spawnSync(tsxPath, [packageScriptPath, 'site'], {
      cwd: workingDirectory,
      encoding: 'utf8'
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('published delivery entry');
    expect(result.stderr).toContain('return multiple [[file:...]] markers instead of creating a zip');
    expect(result.stderr).toContain('first publish a directory with publish-dir');
    expect(readDeliveryManifest(workingDirectory)).toEqual({
      version: 1,
      entries: [],
      primary: null
    });
  });

  it('rejects unsafe source and output paths in package-delivery before packaging', { timeout: 15000 }, () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-package-delivery-'));
    mkdirSync(join(workingDirectory, 'site'), { recursive: true });
    writeFileSync(join(workingDirectory, 'site', 'index.html'), '<html>ok</html>');

    const publishDirScriptPath = join(process.cwd(), 'scripts', 'delivery', 'publish-dir.ts');
    const publishDirResult = spawnSync(tsxPath, [publishDirScriptPath, 'site'], {
      cwd: workingDirectory,
      encoding: 'utf8'
    });
    expect(publishDirResult.status).toBe(0);

    const packageScriptPath = join(process.cwd(), 'scripts', 'delivery', 'package-delivery.ts');
    const unsafeSourceResult = spawnSync(tsxPath, [packageScriptPath, '../site'], {
      cwd: workingDirectory,
      encoding: 'utf8'
    });
    const unsafeOutputResult = spawnSync(tsxPath, [packageScriptPath, 'site', '../site.zip'], {
      cwd: workingDirectory,
      encoding: 'utf8'
    });

    expect(unsafeSourceResult.status).not.toBe(0);
    expect(unsafeSourceResult.stderr).toContain('must stay inside .deliveries');
    expect(unsafeOutputResult.status).not.toBe(0);
    expect(unsafeOutputResult.stderr).toContain('must stay inside .deliveries');
    expect(readDeliveryManifest(workingDirectory)).toEqual({
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
    });
  });

  it('blocks stop once and asks Claude to emit a bridge marker for the manifest primary artifact', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-stop-hook-'));
    mkdirSync(join(workingDirectory, '.deliveries'), { recursive: true });
    writeFileSync(join(workingDirectory, '.deliveries', 'cropped-image.png'), 'png bytes');
    writeDeliveryManifest(workingDirectory, {
      version: 1,
      entries: [
        {
          kind: 'file',
          path: 'cropped-image.png',
          sourcePath: 'images/cropped-image.png',
          packaged: false
        }
      ],
      primary: 'cropped-image.png'
    });

    const result = await runFileReturnStopHook({
      session_id: 'session-1',
      transcript_path: join(workingDirectory, '.claude', 'transcript.jsonl'),
      cwd: workingDirectory,
      permission_mode: 'auto',
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: '已经裁剪好了。'
    });

    expect(result).toEqual({
      decision: 'block',
      reason: expect.stringContaining('[[file:.deliveries/cropped-image.png]]')
    });
  });

  it('packages a primary directory before blocking stop so the bridge marker points at an archive', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-stop-hook-'));
    mkdirSync(join(workingDirectory, '.deliveries', 'site'), { recursive: true });
    writeFileSync(join(workingDirectory, '.deliveries', 'site', 'index.html'), '<html>ok</html>');
    writeDeliveryManifest(workingDirectory, {
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
    });

    const result = await runFileReturnStopHook({
      session_id: 'session-1',
      transcript_path: join(workingDirectory, '.claude', 'transcript.jsonl'),
      cwd: workingDirectory,
      permission_mode: 'auto',
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: '站点已经准备好了。'
    });

    expect(result).toEqual({
      decision: 'block',
      reason: expect.stringContaining('[[file:.deliveries/site.zip]]')
    });
    expect(readDeliveryManifest(workingDirectory)).toEqual({
      version: 1,
      entries: [
        {
          kind: 'directory',
          path: 'site',
          sourcePath: 'site',
          packaged: false
        },
        {
          kind: 'archive',
          path: 'site.zip',
          sourcePath: 'site',
          packaged: true
        }
      ],
      primary: 'site.zip'
    });
  });

  it('does not trigger a handoff from transcript mentions alone when the manifest is empty', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-stop-hook-'));
    const transcriptPath = writeTranscript(workingDirectory, [
      {
        type: 'user',
        message: {
          role: 'user',
          content: '请把结果给我'
        }
      },
      {
        type: 'tool_result',
        message: {
          role: 'tool',
          content: [
            {
              type: 'tool_result',
              content: 'Wrote output to report.pdf',
              is_error: false
            }
          ]
        }
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: '报告已经生成。'
        }
      }
    ]);

    const result = await runFileReturnStopHook({
      session_id: 'session-1',
      transcript_path: transcriptPath,
      cwd: workingDirectory,
      permission_mode: 'auto',
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: '这轮没有生成新的文件。'
    });

    expect(result).toEqual({});
  });

  it('blocks when deliveries contains files but no published delivery state exists', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-stop-hook-'));
    mkdirSync(join(workingDirectory, '.deliveries'), { recursive: true });
    writeFileSync(join(workingDirectory, '.deliveries', 'avatar_cropped.png'), 'png bytes');

    const result = await runFileReturnStopHook({
      session_id: 'session-1',
      transcript_path: join(workingDirectory, '.claude', 'transcript.jsonl'),
      cwd: workingDirectory,
      permission_mode: 'auto',
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: '已经裁剪好了。'
    });

    expect(result).toEqual({
      decision: 'block',
      reason: expect.stringContaining('Do not write files into workspace/.deliveries/ manually.')
    });
  });

  it('blocks when deliveries contains unmanaged files alongside stale published entries', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-stop-hook-'));
    mkdirSync(join(workingDirectory, '.deliveries', 'site'), { recursive: true });
    writeFileSync(join(workingDirectory, '.deliveries', 'site', 'index.html'), '<html>ok</html>');
    writeFileSync(join(workingDirectory, '.deliveries', 'avatar_cropped.png'), 'png bytes');
    writeDeliveryManifest(workingDirectory, {
      version: 1,
      entries: [
        {
          kind: 'directory',
          path: 'site',
          sourcePath: 'site',
          packaged: false
        }
      ],
      primary: null
    });

    const result = await runFileReturnStopHook({
      session_id: 'session-1',
      transcript_path: join(workingDirectory, '.claude', 'transcript.jsonl'),
      cwd: workingDirectory,
      permission_mode: 'auto',
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: '已经裁剪好了。'
    });

    expect(result).toEqual({
      decision: 'block',
      reason: expect.stringContaining('Do not write files into workspace/.deliveries/ manually.')
    });
  });

  it('does not let a stale marker bypass the hook when it does not match the manifest artifact', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-stop-hook-'));
    mkdirSync(join(workingDirectory, '.deliveries'), { recursive: true });
    writeFileSync(join(workingDirectory, '.deliveries', 'cropped-image.png'), 'png bytes');
    writeDeliveryManifest(workingDirectory, {
      version: 1,
      entries: [
        {
          kind: 'file',
          path: 'cropped-image.png',
          sourcePath: 'images/cropped-image.png',
          packaged: false
        }
      ],
      primary: 'cropped-image.png'
    });

    const result = await runFileReturnStopHook({
      session_id: 'session-1',
      transcript_path: join(workingDirectory, '.claude', 'transcript.jsonl'),
      cwd: workingDirectory,
      permission_mode: 'auto',
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: '已经裁剪好了。\n[[file:.deliveries/old-image.png]]'
    });

    expect(result).toEqual({
      decision: 'block',
      reason: expect.stringContaining('[[file:.deliveries/cropped-image.png]]')
    });
  });

  it('blocks when the manifest primary file is missing on disk', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-stop-hook-'));
    writeDeliveryManifest(workingDirectory, {
      version: 1,
      entries: [
        {
          kind: 'file',
          path: 'missing.txt',
          sourcePath: 'missing.txt',
          packaged: false
        }
      ],
      primary: 'missing.txt'
    });

    await expect(
      runFileReturnStopHook({
        session_id: 'session-1',
        transcript_path: join(workingDirectory, '.claude', 'transcript.jsonl'),
        cwd: workingDirectory,
        permission_mode: 'auto',
        hook_event_name: 'Stop',
        stop_hook_active: false,
        last_assistant_message: '文件已经准备好了。'
      })
    ).resolves.toEqual({
      decision: 'block',
      reason: expect.stringContaining('published delivery intent is invalid')
    });
  });

  it('blocks when the manifest primary directory is missing on disk', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-stop-hook-'));
    writeDeliveryManifest(workingDirectory, {
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
    });

    await expect(
      runFileReturnStopHook({
        session_id: 'session-1',
        transcript_path: join(workingDirectory, '.claude', 'transcript.jsonl'),
        cwd: workingDirectory,
        permission_mode: 'auto',
        hook_event_name: 'Stop',
        stop_hook_active: false,
        last_assistant_message: '站点已经准备好了。'
      })
    ).resolves.toEqual({
      decision: 'block',
      reason: expect.stringContaining('published delivery intent is invalid')
    });
  });

  it('allows stop only when Claude already emitted the manifest-driven bridge marker', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'file-return-stop-hook-'));
    mkdirSync(join(workingDirectory, '.deliveries'), { recursive: true });
    writeFileSync(join(workingDirectory, '.deliveries', 'cropped-image.png'), 'png bytes');
    writeDeliveryManifest(workingDirectory, {
      version: 1,
      entries: [
        {
          kind: 'file',
          path: 'cropped-image.png',
          sourcePath: 'images/cropped-image.png',
          packaged: false
        }
      ],
      primary: 'cropped-image.png'
    });

    const withMarker = await runFileReturnStopHook({
      session_id: 'session-1',
      transcript_path: join(workingDirectory, '.claude', 'transcript.jsonl'),
      cwd: workingDirectory,
      permission_mode: 'auto',
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: '已经裁剪好了。\n[[file:.deliveries/cropped-image.png]]'
    });
    const alreadyActive = await runFileReturnStopHook({
      session_id: 'session-1',
      transcript_path: join(workingDirectory, '.claude', 'transcript.jsonl'),
      cwd: workingDirectory,
      permission_mode: 'auto',
      hook_event_name: 'Stop',
      stop_hook_active: true,
      last_assistant_message: '已经裁剪好了。\n[[file:cropped-image.png]]'
    });

    expect(withMarker).toEqual({});
    expect(alreadyActive).toEqual({
      decision: 'block',
      reason: 'If this turn should deliver the prepared artifact, replace any other file marker with exactly [[file:.deliveries/cropped-image.png]] on its own line in your final answer before stopping. Do not use bare filenames or workspace-prefixed paths.'
    });
  });
});
