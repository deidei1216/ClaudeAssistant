import { mkdirSync, writeFileSync } from 'node:fs';
import { join, extname, relative, resolve, sep } from 'node:path';
import { RecentFileRecord, RecentFileSource } from './types';

const MAX_RECENT_FILES = 10;
const HTML_EXTENSIONS = new Set(['.html', '.htm']);
const WORD_EXTENSIONS = new Set(['.doc', '.docx']);
const EXCEL_EXTENSIONS = new Set(['.csv', '.xls', '.xlsx']);
const PPT_EXTENSIONS = new Set(['.ppt', '.pptx']);
const IMAGE_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp']);

function isInsideWorkingDirectory(workingDirectory: string, absolutePath: string): boolean {
  return absolutePath === workingDirectory || absolutePath.startsWith(`${workingDirectory}${sep}`);
}

function describeFileKind(displayName: string, mediaType: string): string {
  const extension = extname(displayName).toLowerCase();

  if (mediaType.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) {
    return 'image';
  }
  if (mediaType === 'text/html' || HTML_EXTENSIONS.has(extension)) {
    return 'html';
  }
  if (WORD_EXTENSIONS.has(extension)) {
    return 'word';
  }
  if (EXCEL_EXTENSIONS.has(extension)) {
    return 'excel';
  }
  if (PPT_EXTENSIONS.has(extension)) {
    return 'ppt';
  }
  if (extension === '.pdf') {
    return 'pdf';
  }

  return 'file';
}

function describeSummary(source: RecentFileSource, kind: string): string {
  if (source === 'discord_inbound') {
    return `inbound ${kind}`;
  }
  if (source === 'claude_outbound') {
    return `last sent ${kind}`;
  }
  return `generated ${kind}`;
}

export function createRecentFileRecord(input: {
  id: string;
  workingDirectory: string;
  absolutePath: string;
  displayName: string;
  source: RecentFileSource;
  mediaType: string;
  lastSeenAt: Date;
}): RecentFileRecord {
  const workingDirectory = resolve(input.workingDirectory);
  const absolutePath = resolve(input.absolutePath);

  if (!isInsideWorkingDirectory(workingDirectory, absolutePath)) {
    throw new Error(`Recent file is outside the working directory: ${absolutePath}`);
  }

  const relativePath = relative(workingDirectory, absolutePath).replace(/\\/g, '/');

  return {
    id: input.id,
    displayName: input.displayName,
    relativePath,
    absolutePath,
    source: input.source,
    mediaType: input.mediaType,
    lastSeenAt: input.lastSeenAt,
    summary: describeSummary(input.source, describeFileKind(input.displayName, input.mediaType))
  };
}

export function mergeRecentFiles(
  existing: RecentFileRecord[] = [],
  incoming: RecentFileRecord[] = [],
  limit = MAX_RECENT_FILES
): RecentFileRecord[] {
  const merged = new Map<string, RecentFileRecord>();

  for (const file of [...incoming, ...existing]) {
    const current = merged.get(file.absolutePath);
    if (!current || current.lastSeenAt.getTime() < file.lastSeenAt.getTime()) {
      merged.set(file.absolutePath, file);
    }
  }

  return [...merged.values()]
    .sort((left, right) => right.lastSeenAt.getTime() - left.lastSeenAt.getTime())
    .slice(0, limit);
}

export function formatRecentFilesSummary(files: RecentFileRecord[] = []): string | null {
  if (files.length === 0) {
    return null;
  }

  return ['Recent files in this session:', ...files.map((file) => `- ${file.summary}: ${file.relativePath}`)].join('\n');
}

export function writeRecentFilesMemory(workingDirectory: string, files: RecentFileRecord[]): string {
  const memoryDirectory = join(resolve(workingDirectory), '.claude-gateway', 'memory');
  const memoryPath = join(memoryDirectory, 'recent-files.json');

  mkdirSync(memoryDirectory, { recursive: true });
  writeFileSync(
    memoryPath,
    JSON.stringify(
      {
        recentFiles: files.map((file) => ({
          ...file,
          lastSeenAt: file.lastSeenAt.toISOString()
        }))
      },
      null,
      2
    )
  );

  return memoryPath;
}
