import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionProfileTemplate } from './types';

export class ProfileManager {
  constructor(private readonly profilesDir: string) {}

  load(name: string): SessionProfileTemplate {
    const filePath = join(this.profilesDir, `${name}.json`);
    return JSON.parse(readFileSync(filePath, 'utf8')) as SessionProfileTemplate;
  }
}