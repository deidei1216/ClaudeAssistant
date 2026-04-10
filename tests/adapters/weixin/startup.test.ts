import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveStoredWeixinAccount } from '../../../adapters/weixin/account-store';
import { prepareWeixinConfigForStartup, resolveUsableWeixinAccounts } from '../../../adapters/weixin/startup';

describe('prepareWeixinConfigForStartup', () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();

    while (tempDirectories.length > 0) {
      const directory = tempDirectories.pop();
      if (directory) {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it('reuses stored credentials without triggering a login flow', async () => {
    const root = mkdtempSync(join(tmpdir(), 'weixin-startup-'));
    tempDirectories.push(root);
    const authFile = join(root, 'weixin-auth.json');

    saveStoredWeixinAccount(
      {
        id: 'acct-1',
        token: 'token-1',
        ilinkUserId: 'bot-1@im.wechat',
        baseUrl: 'https://ilinkai.weixin.qq.com',
        savedAt: '2026-04-10T00:00:00.000Z'
      },
      authFile
    );

    const startLogin = vi.fn();
    const prepared = await prepareWeixinConfigForStartup(
      {
        authFile,
        accounts: [
          {
            id: 'acct-1',
            token: '',
            ilinkUserId: ''
          }
        ]
      },
      {
        startLogin: startLogin as never
      }
    );

    expect(startLogin).not.toHaveBeenCalled();
    expect(prepared.accounts).toEqual([
      {
        id: 'acct-1',
        token: 'token-1',
        ilinkUserId: 'bot-1@im.wechat',
        baseUrl: 'https://ilinkai.weixin.qq.com'
      }
    ]);
  });

  it('automatically starts qr login when no usable account exists and continues with the bound account', async () => {
    const root = mkdtempSync(join(tmpdir(), 'weixin-startup-'));
    tempDirectories.push(root);
    const authFile = join(root, 'weixin-auth.json');
    const printed: string[] = [];

    const startLogin = vi.fn(async () => ({
      sessionKey: 'session-1',
      qrcodeUrl: 'https://qrcode.weixin.example/1',
      message: '使用微信扫描二维码，确认后将自动保存登录凭证。'
    }));
    const waitForLogin = vi.fn(async ({ onStatus, onQrRefresh }: { onStatus?: (status: string) => void; onQrRefresh?: (qrcodeUrl: string) => void }) => {
      onStatus?.('scaned');
      onQrRefresh?.('https://qrcode.weixin.example/2');

      return {
        connected: true,
        account: {
          id: 'acct-auto',
          token: 'token-auto',
          ilinkUserId: 'bot-auto@im.wechat',
          baseUrl: 'https://redirect.weixin.example',
          savedAt: '2026-04-10T00:00:00.000Z'
        },
        message: '微信账号 acct-auto 已绑定完成。'
      };
    });

    const prepared = await prepareWeixinConfigForStartup(
      {
        authFile,
        accounts: [
          {
            id: 'placeholder-account',
            token: '',
            ilinkUserId: ''
          }
        ]
      },
      {
        print(message) {
          printed.push(message);
        },
        startLogin,
        waitForLogin: waitForLogin as never
      }
    );

    expect(startLogin).toHaveBeenCalledTimes(1);
    expect(waitForLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: 'session-1',
        authFile
      })
    );
    expect(prepared.accounts).toEqual([
      {
        id: 'acct-auto',
        token: 'token-auto',
        ilinkUserId: 'bot-auto@im.wechat',
        baseUrl: 'https://redirect.weixin.example',
        enabled: true
      }
    ]);
    expect(printed).toContain('未检测到可用的微信登录凭证，正在自动发起扫码登录...');
    expect(printed).toContain('已扫码，等待手机端确认...');
    expect(printed).toContain('二维码已刷新，请重新扫描：');
    expect(printed).toContain('微信账号 acct-auto 已绑定完成。');
  });
});

describe('resolveUsableWeixinAccounts', () => {
  it('drops unusable configured accounts from the runtime account list', () => {
    expect(
      resolveUsableWeixinAccounts({
        accounts: [
          {
            id: 'acct-good',
            token: 'token-good',
            ilinkUserId: 'bot-good@im.wechat'
          },
          {
            id: 'acct-bad',
            token: '',
            ilinkUserId: ''
          }
        ]
      })
    ).toEqual([
      {
        id: 'acct-good',
        token: 'token-good',
        ilinkUserId: 'bot-good@im.wechat'
      }
    ]);
  });
});
