import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { loadStoredWeixinAccounts, saveStoredWeixinAccount } from '../../../adapters/weixin/account-store';

describe('Weixin account store', () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    while (tempDirectories.length > 0) {
      const directory = tempDirectories.pop();
      if (directory) {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it('persists and replaces stored accounts by id', () => {
    const root = mkdtempSync(join(tmpdir(), 'weixin-auth-store-'));
    tempDirectories.push(root);
    const authFile = join(root, 'weixin-auth.json');

    saveStoredWeixinAccount(
      {
        id: 'acct-1',
        token: 'token-1',
        ilinkUserId: 'user-1',
        baseUrl: 'https://ilinkai.weixin.qq.com',
        savedAt: '2026-04-09T00:00:00.000Z'
      },
      authFile
    );
    saveStoredWeixinAccount(
      {
        id: 'acct-1',
        token: 'token-2',
        ilinkUserId: 'user-2',
        baseUrl: 'https://redirect.weixin.qq.com',
        savedAt: '2026-04-10T00:00:00.000Z'
      },
      authFile
    );

    expect(loadStoredWeixinAccounts(authFile)).toEqual([
      {
        id: 'acct-1',
        token: 'token-2',
        ilinkUserId: 'user-2',
        baseUrl: 'https://redirect.weixin.qq.com',
        savedAt: '2026-04-10T00:00:00.000Z'
      }
    ]);
    expect(JSON.parse(readFileSync(authFile, 'utf8'))).toEqual({
      accounts: [
        {
          id: 'acct-1',
          token: 'token-2',
          ilinkUserId: 'user-2',
          baseUrl: 'https://redirect.weixin.qq.com',
          savedAt: '2026-04-10T00:00:00.000Z'
        }
      ]
    });
  });
});
