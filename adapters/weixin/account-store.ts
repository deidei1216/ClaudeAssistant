import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface StoredWeixinAccount {
  id: string;
  token: string;
  ilinkUserId: string;
  baseUrl?: string;
  savedAt: string;
}

export interface StoredWeixinAccountFile {
  accounts: StoredWeixinAccount[];
}

const DEFAULT_AUTH_FILE = join('data', 'adapters', 'weixin-auth.json');

export function getDefaultWeixinAuthFile(): string {
  return DEFAULT_AUTH_FILE;
}

export function loadStoredWeixinAccounts(filePath = DEFAULT_AUTH_FILE): StoredWeixinAccount[] {
  try {
    if (!existsSync(filePath)) {
      return [];
    }

    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<StoredWeixinAccountFile>;
    if (!Array.isArray(parsed.accounts)) {
      return [];
    }

    return parsed.accounts.filter(isStoredWeixinAccount);
  } catch {
    return [];
  }
}

export function saveStoredWeixinAccount(account: StoredWeixinAccount, filePath = DEFAULT_AUTH_FILE): void {
  const existing = loadStoredWeixinAccounts(filePath).filter((candidate) => candidate.id !== account.id);
  const next: StoredWeixinAccountFile = {
    accounts: [...existing, account]
  };

  mkdirSync(dirname(resolve(filePath)), { recursive: true });
  writeFileSync(filePath, JSON.stringify(next, null, 2));

  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Best-effort on filesystems that support chmod.
  }
}

function isStoredWeixinAccount(value: unknown): value is StoredWeixinAccount {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<StoredWeixinAccount>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.trim().length > 0 &&
    typeof candidate.token === 'string' &&
    candidate.token.trim().length > 0 &&
    typeof candidate.ilinkUserId === 'string' &&
    candidate.ilinkUserId.trim().length > 0 &&
    typeof candidate.savedAt === 'string' &&
    candidate.savedAt.trim().length > 0
  );
}
