import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ArtifactSummary, RecentFileMemoryRecord } from './contracts';

interface RecentFilesMemoryDocument {
  recentFiles?: RecentFileMemoryRecord[];
}

export function loadRecentFileCandidates(workingDirectory: string): ArtifactSummary[] {
  const recentFilesPath = join(workingDirectory, '.claude-gateway', 'memory', 'recent-files.json');
  if (!existsSync(recentFilesPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(recentFilesPath, 'utf8')) as RecentFilesMemoryDocument;

    return (parsed.recentFiles ?? []).filter((file) => file.source === 'workspace_detected');
  } catch {
    return [];
  }
}

function isInsideWorkingDirectory(workingDirectory: string, candidatePath: string): boolean {
  const absoluteWorkingDirectory = resolve(workingDirectory);
  const absoluteCandidatePath = resolve(candidatePath);

  return (
    absoluteCandidatePath === absoluteWorkingDirectory ||
    absoluteCandidatePath.startsWith(`${absoluteWorkingDirectory}${sep}`)
  );
}

export function toRelativeWorkspacePath(
  workingDirectory: string,
  candidatePath: string
): string | null {
  const absoluteCandidatePath = isAbsolute(candidatePath)
    ? candidatePath
    : resolve(workingDirectory, candidatePath);

  if (!isInsideWorkingDirectory(workingDirectory, absoluteCandidatePath) || !existsSync(absoluteCandidatePath)) {
    return null;
  }

  const relativePath = relative(workingDirectory, absoluteCandidatePath).replace(/\\/g, '/');
  if (relativePath.startsWith('.claude-gateway/inbox/')) {
    return null;
  }

  return relativePath;
}
