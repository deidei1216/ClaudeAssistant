import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadStoredWeixinAccounts } from '../../../adapters/weixin/account-store';
import { startWeixinQrLogin, waitForWeixinQrLogin } from '../../../adapters/weixin/login';

describe('Weixin QR login', () => {
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

  it('fetches a qr code, follows redirect polling, and persists credentials', async () => {
    const root = mkdtempSync(join(tmpdir(), 'weixin-login-'));
    tempDirectories.push(root);
    const authFile = join(root, 'weixin-auth.json');

    const requests: string[] = [];
    let pollCount = 0;

    const fetchMock = vi.fn(async (input: URL | string) => {
      const url = String(input);
      requests.push(url);

      if (url.includes('/ilink/bot/get_bot_qrcode')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              qrcode: 'qr-token-1',
              qrcode_img_content: 'https://qrcode.weixin.example/1'
            })
        } as Response;
      }

      if (url.includes('/ilink/bot/get_qrcode_status')) {
        pollCount += 1;
        if (pollCount === 1) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                status: 'scaned_but_redirect',
                redirect_host: 'redirect.weixin.example'
              })
          } as Response;
        }

        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              status: 'confirmed',
              bot_token: 'bot-token-1',
              ilink_bot_id: 'acct-1',
              ilink_user_id: 'user-1@im.wechat',
              baseurl: 'https://redirect.weixin.example'
            })
        } as Response;
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const started = await startWeixinQrLogin({ fetchImpl: fetchMock as never, sessionKey: 'session-1' });
    const result = await waitForWeixinQrLogin({
      sessionKey: started.sessionKey,
      authFile,
      fetchImpl: fetchMock as never
    });

    expect(started).toEqual({
      sessionKey: 'session-1',
      qrcodeUrl: 'https://qrcode.weixin.example/1',
      message: '使用微信扫描二维码，确认后将自动保存登录凭证。'
    });
    expect(result).toEqual({
      connected: true,
      account: {
        id: 'acct-1',
        token: 'bot-token-1',
        ilinkUserId: 'user-1@im.wechat',
        baseUrl: 'https://redirect.weixin.example',
        savedAt: expect.any(String)
      },
      message: '微信账号 acct-1 已绑定完成。'
    });
    expect(loadStoredWeixinAccounts(authFile)).toEqual([
      {
        id: 'acct-1',
        token: 'bot-token-1',
        ilinkUserId: 'user-1@im.wechat',
        baseUrl: 'https://redirect.weixin.example',
        savedAt: expect.any(String)
      }
    ]);
    expect(requests.some((url) => url.startsWith('https://redirect.weixin.example/'))).toBe(true);
  });
});
