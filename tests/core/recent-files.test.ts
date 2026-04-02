import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createRecentFileRecord,
  formatRecentFilesSummary,
  mergeRecentFiles,
  writeRecentFilesMemory
} from '../../src/core/recent-files';
import { RecentFileRecord } from '../../src/core/types';

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
      id: 'outbound:exports/report.html',
      workingDirectory: '/tmp/project',
      absolutePath: '/tmp/project/exports/report.html',
      displayName: 'report.html',
      source: 'claude_outbound',
      mediaType: 'text/html',
      lastSeenAt: seenAt
    });

    expect(result).toEqual({
      id: 'outbound:exports/report.html',
      displayName: 'report.html',
      relativePath: 'exports/report.html',
      absolutePath: '/tmp/project/exports/report.html',
      source: 'claude_outbound',
      mediaType: 'text/html',
      lastSeenAt: seenAt,
      summary: 'last sent html'
    });
  });

  it('refreshes an existing file when the same absolute path is remembered again', () => {
    const older: RecentFileRecord = {
      id: 'workspace:exports/budget.xlsx',
      displayName: 'budget.xlsx',
      relativePath: 'exports/budget.xlsx',
      absolutePath: '/tmp/project/exports/budget.xlsx',
      source: 'workspace_detected',
      mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      lastSeenAt: new Date('2026-04-01T00:00:00.000Z'),
      summary: 'generated excel'
    };

    const refreshed: RecentFileRecord = {
      ...older,
      id: 'outbound:exports/budget.xlsx',
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
      relativePath: `outputs/report-${index}.html`,
      absolutePath: `/tmp/project/outputs/report-${index}.html`,
      source: 'workspace_detected' as const,
      mediaType: 'text/html',
      lastSeenAt: new Date(`2026-04-01T00:${String(index).padStart(2, '0')}:00.000Z`),
      summary: 'generated html'
    }));

    const merged = mergeRecentFiles([], files);

    expect(merged).toHaveLength(10);
    expect(merged[0].relativePath).toBe('outputs/report-11.html');
    expect(merged.at(-1)?.relativePath).toBe('outputs/report-2.html');
  });

  it('formats a compact prompt block for remembered files', () => {
    const result = formatRecentFilesSummary([
      {
        id: 'file-1',
        displayName: 'report.html',
        relativePath: 'outputs/report.html',
        absolutePath: '/tmp/project/outputs/report.html',
        source: 'workspace_detected',
        mediaType: 'text/html',
        lastSeenAt: seenAt,
        summary: 'generated html'
      }
    ]);

    expect(result).toBe('Recent files in this session:\n- generated html: outputs/report.html');
  });

  it('writes recent-file memory into the workspace memory directory', () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'recent-files-'));
    tempDirectories.push(workingDirectory);
    const memoryPath = writeRecentFilesMemory(workingDirectory, [
      {
        id: 'file-1',
        displayName: 'report.html',
        relativePath: 'outputs/report.html',
        absolutePath: '/tmp/project/outputs/report.html',
        source: 'workspace_detected',
        mediaType: 'text/html',
        lastSeenAt: seenAt,
        summary: 'generated html'
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
});
