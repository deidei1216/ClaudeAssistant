import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createRecentFileRecord,
  formatRecentFilesSummary,
  mergeRecentFiles,
  writeRecentFilesMemory
} from '../../core/recent-files';
import { RecentFileRecord } from '../../core/types';

describe('recent file helpers', () => {
  const seenAt = new Date('2026-04-01T00:00:00.000Z');
  const tempDirectories: string[] = [];

  afterEach(() => {
    while (tempDirectories.length > 0) {
      const directory = tempDirectories.pop();
      if (directory) {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it('builds a workspace-safe record with a source-aware summary', () => {
    const result = createRecentFileRecord({
      id: 'outbound:.deliveries/exports/report.html',
      workingDirectory: '/tmp/project/workspace',
      absolutePath: '/tmp/project/workspace/.deliveries/exports/report.html',
      displayName: 'report.html',
      source: 'claude_outbound',
      mediaType: 'text/html',
      lastSeenAt: seenAt
    });

    expect(result).toEqual({
      id: 'outbound:.deliveries/exports/report.html',
      displayName: 'report.html',
      relativePath: '.deliveries/exports/report.html',
      absolutePath: '/tmp/project/workspace/.deliveries/exports/report.html',
      source: 'claude_outbound',
      mediaType: 'text/html',
      lastSeenAt: seenAt,
      summary: 'last sent html'
    });
  });

  it('renders inbound uploads with the workspace uploads alias', () => {
    const result = createRecentFileRecord({
      id: 'discord_inbound:att-1',
      workingDirectory: '/tmp/project/workspace',
      absolutePath: '/tmp/project/uploads/att-1-budget.xlsx',
      displayName: 'budget.xlsx',
      source: 'discord_inbound',
      mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      lastSeenAt: seenAt
    });

    expect(result).toEqual({
      id: 'discord_inbound:att-1',
      displayName: 'budget.xlsx',
      relativePath: 'uploads/att-1-budget.xlsx',
      absolutePath: '/tmp/project/uploads/att-1-budget.xlsx',
      source: 'discord_inbound',
      mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      lastSeenAt: seenAt,
      summary: 'inbound excel'
    });
  });

  it('refreshes an existing file when the same absolute path is remembered again', () => {
    const older: RecentFileRecord = {
      id: 'discord_inbound:att-1',
      displayName: 'budget.xlsx',
      relativePath: 'uploads/att-1-budget.xlsx',
      absolutePath: '/tmp/project/uploads/att-1-budget.xlsx',
      source: 'discord_inbound',
      mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      lastSeenAt: new Date('2026-04-01T00:00:00.000Z'),
      summary: 'inbound excel'
    };

    const refreshed: RecentFileRecord = {
      ...older,
      id: 'discord_inbound:att-1',
      source: 'claude_outbound',
      lastSeenAt: new Date('2026-04-01T00:05:00.000Z'),
      summary: 'last sent excel'
    };

    expect(mergeRecentFiles([older], [refreshed])).toEqual([refreshed]);
  });

  it('keeps only the latest ten remembered files', () => {
    const files = Array.from({ length: 12 }, (_, index) => ({
      id: `file-${index}`,
      displayName: `report-${index}.html`,
      relativePath: `.deliveries/report-${index}.html`,
      absolutePath: `/tmp/project/workspace/.deliveries/report-${index}.html`,
      source: 'claude_outbound' as const,
      mediaType: 'text/html',
      lastSeenAt: new Date(`2026-04-01T00:${String(index).padStart(2, '0')}:00.000Z`),
      summary: 'last sent html'
    }));

    const merged = mergeRecentFiles([], files);

    expect(merged).toHaveLength(10);
    expect(merged[0].relativePath).toBe('.deliveries/report-11.html');
    expect(merged.at(-1)?.relativePath).toBe('.deliveries/report-2.html');
  });

  it('formats a compact prompt block for remembered files', () => {
    const result = formatRecentFilesSummary([
      {
        id: 'file-1',
        displayName: 'report.html',
        relativePath: '.deliveries/report.html',
        absolutePath: '/tmp/project/workspace/.deliveries/report.html',
        source: 'claude_outbound',
        mediaType: 'text/html',
        lastSeenAt: seenAt,
        summary: 'last sent html'
      }
    ]);

    expect(result).toBe('Recent files in this session:\n- last sent html: .deliveries/report.html');
  });

  it('writes recent-file memory into the workspace memory directory', () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'recent-files-'));
    tempDirectories.push(workingDirectory);
    const memoryPath = writeRecentFilesMemory(workingDirectory, [
      {
        id: 'file-1',
        displayName: 'report.html',
        relativePath: '.deliveries/report.html',
        absolutePath: '/tmp/project/workspace/.deliveries/report.html',
        source: 'claude_outbound',
        mediaType: 'text/html',
        lastSeenAt: seenAt,
        summary: 'last sent html'
      }
    ]);

    expect(memoryPath).toBe(join(workingDirectory, '.claude-gateway', 'memory', 'recent-files.json'));
    expect(JSON.parse(readFileSync(memoryPath, 'utf8'))).toEqual({
      recentFiles: [
        expect.objectContaining({
          id: 'file-1',
          lastSeenAt: seenAt.toISOString()
        })
      ]
    });
  });

  it('rejects outbound records that were not published into deliveries', () => {
    expect(() =>
      createRecentFileRecord({
        id: 'outbound:exports/report.html',
        workingDirectory: '/tmp/project/workspace',
        absolutePath: '/tmp/project/workspace/exports/report.html',
        displayName: 'report.html',
        source: 'claude_outbound',
        mediaType: 'text/html',
        lastSeenAt: seenAt
      })
    ).toThrow('Recent file is outside the deliveries boundary: /tmp/project/workspace/exports/report.html');
  });

  it('rejects outbound records whose deliveries path escapes through a symlink', () => {
    const sessionRoot = mkdtempSync(join(tmpdir(), 'recent-files-'));
    const workingDirectory = join(sessionRoot, 'workspace');
    const outsideDirectory = mkdtempSync(join(tmpdir(), 'recent-files-outside-'));
    tempDirectories.push(sessionRoot, outsideDirectory);
    mkdirSync(join(workingDirectory, '.deliveries'), { recursive: true });
    symlinkSync(outsideDirectory, join(workingDirectory, '.deliveries', 'linked'));

    expect(() =>
      createRecentFileRecord({
        id: 'outbound:.deliveries/linked/report.html',
        workingDirectory,
        absolutePath: join(workingDirectory, '.deliveries', 'linked', 'report.html'),
        displayName: 'report.html',
        source: 'claude_outbound',
        mediaType: 'text/html',
        lastSeenAt: seenAt
      })
    ).toThrow(`Recent file is outside the deliveries boundary: ${join(workingDirectory, '.deliveries', 'linked', 'report.html')}`);
  });
});
