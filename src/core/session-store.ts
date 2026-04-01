import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionProfile } from './types';

function serialize(session: SessionProfile): string {
  return JSON.stringify(
    {
      ...session,
      createdAt: session.createdAt.toISOString(),
      lastActiveAt: session.lastActiveAt.toISOString()
    },
    null,
    2
  );
}

function deserialize(raw: string): SessionProfile {
  const parsed = JSON.parse(raw);
  return {
    ...parsed,
    createdAt: new Date(parsed.createdAt),
    lastActiveAt: new Date(parsed.lastActiveAt)
  };
}

export class SessionStore {
  constructor(private readonly baseDir: string) {}

  save(session: SessionProfile): void {
    const filePath = this.getPath(session.channelType, session.channelId);
    mkdirSync(join(this.baseDir, session.channelType), { recursive: true });
    writeFileSync(filePath, serialize(session));
  }

  loadByChannel(channelType: string, channelId: string): SessionProfile | null {
    const filePath = this.getPath(channelType, channelId);
    try {
      return deserialize(readFileSync(filePath, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null; // Expected: file doesn't exist
      }
      throw error; // Unexpected: rethrow (e.g., permission denied, corrupt JSON)
    }
  }

  list(): SessionProfile[] {
    try {
      return readdirSync(this.baseDir)
        .flatMap((channelType) => {
          if (channelType.startsWith('.')) {
            return [];
          }

          const dir = join(this.baseDir, channelType);
          if (!statSync(dir).isDirectory()) {
            return [];
          }

          return readdirSync(dir)
            .filter((file) => file.endsWith('.json'))
            .map((file) => deserialize(readFileSync(join(dir, file), 'utf8')));
        })
        .sort((left, right) => right.lastActiveAt.getTime() - left.lastActiveAt.getTime());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []; // Expected: base directory doesn't exist yet
      }
      throw error; // Unexpected: rethrow (e.g., permission denied, corrupt JSON)
    }
  }

  private getPath(channelType: string, channelId: string): string {
    return join(this.baseDir, channelType, `${channelId}.json`);
  }
}
