import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { RecentFileRecord, SessionProfile } from './types';
import { ensureDeliveryBoundaryScaffold } from './delivery-paths';
import { ensureWorkspaceUploadsAlias } from './session-paths';

function serialize(session: SessionProfile): string {
  return JSON.stringify(
    {
      ...session,
      createdAt: session.createdAt.toISOString(),
      lastActiveAt: session.lastActiveAt.toISOString(),
      recentFiles: session.recentFiles?.map((file) => ({
        ...file,
        lastSeenAt: file.lastSeenAt.toISOString()
      }))
    },
    null,
    2
  );
}

function deserialize(raw: string): SessionProfile {
  const parsed = JSON.parse(raw);
  const recentFiles = parsed.recentFiles === undefined
    ? undefined
    : (parsed.recentFiles as RecentFileRecord[]).map((file) => ({
        ...file,
        lastSeenAt: new Date(file.lastSeenAt)
      }));

  return {
    ...parsed,
    createdAt: new Date(parsed.createdAt),
    lastActiveAt: new Date(parsed.lastActiveAt),
    recentFiles
  };
}

export class SessionStore {
  constructor(public readonly baseDir: string) {}

  save(session: SessionProfile): void {
    const sessionDir = join(this.baseDir, session.id);
    mkdirSync(sessionDir, { recursive: true });

    const resolvedSessionDir = resolve(sessionDir);
    const resolvedWorkingDirectory = resolve(session.workingDirectory);
    if (
      resolvedWorkingDirectory === resolvedSessionDir ||
      resolvedWorkingDirectory.startsWith(`${resolvedSessionDir}${sep}`)
    ) {
      mkdirSync(session.workingDirectory, { recursive: true });
      ensureDeliveryBoundaryScaffold(session.workingDirectory);
      ensureWorkspaceUploadsAlias(session.workingDirectory);
    }
    mkdirSync(join(sessionDir, 'uploads'), { recursive: true });
    
    const filePath = join(sessionDir, 'session.json');
    writeFileSync(filePath, serialize(session));
  }

  load(sessionId: string): SessionProfile | null {
    const filePath = join(this.baseDir, sessionId, 'session.json');
    try {
      return deserialize(readFileSync(filePath, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  loadByChannel(channelType: string, channelId: string): SessionProfile | null {
    // We try to find the session by searching because we no longer have a direct mapping in the file name
    // However, if we follow the convention of sessionId = channelType-channelId or just channelId, 
    // we can try those first.
    const directSessionId = `${channelType}-${channelId}`;
    const session = this.load(directSessionId);
    if (session && session.status !== 'archived') return session;

    // Fallback: search all sessions
    return this.list().find(
      (session) =>
        session.channelType === channelType &&
        session.channelId === channelId &&
        session.status === 'active'
    ) ?? null;
  }

  list(): SessionProfile[] {
    try {
      return readdirSync(this.baseDir)
        .flatMap((sessionId) => {
          if (sessionId.startsWith('.')) {
            return [];
          }

          const dir = join(this.baseDir, sessionId);
          if (!statSync(dir).isDirectory()) {
            return [];
          }

          const filePath = join(dir, 'session.json');
          if (!existsSync(filePath)) {
            return [];
          }

          return [deserialize(readFileSync(filePath, 'utf8'))];
        })
        .sort((left, right) => right.lastActiveAt.getTime() - left.lastActiveAt.getTime());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }
}
