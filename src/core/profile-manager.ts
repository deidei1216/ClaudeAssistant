import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionProfileTemplate } from './types';

export class ProfileLoadError extends Error {
  constructor(
    public readonly profileName: string,
    public readonly cause: Error
  ) {
    super(`Failed to load profile "${profileName}": ${cause.message}`);
    this.name = 'ProfileLoadError';
  }
}

export class ProfileManager {
  constructor(private readonly profilesDir: string) {}

  load(name: string): SessionProfileTemplate {
    const filePath = join(this.profilesDir, `${name}.json`);
    try {
      return JSON.parse(readFileSync(filePath, 'utf8')) as SessionProfileTemplate;
    } catch (error) {
      const originalError = error as Error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ProfileLoadError(name, new Error(`Profile "${name}" not found at ${filePath}`));
      }
      if (error instanceof SyntaxError) {
        throw new ProfileLoadError(name, new Error(`Profile "${name}" contains invalid JSON: ${originalError.message}`));
      }
      throw new ProfileLoadError(name, originalError);
    }
  }
}