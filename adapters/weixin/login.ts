import { randomUUID } from 'node:crypto';
import { saveStoredWeixinAccount, type StoredWeixinAccount } from './account-store';

type FetchLike = typeof fetch;

interface ActiveLogin {
  sessionKey: string;
  qrcode: string;
  qrcodeUrl: string;
  startedAt: number;
  currentApiBaseUrl: string;
}

interface QRCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

interface StatusResponse {
  status: 'wait' | 'scaned' | 'confirmed' | 'expired' | 'scaned_but_redirect';
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  redirect_host?: string;
}

export interface StartWeixinQrLoginResult {
  sessionKey: string;
  qrcodeUrl: string;
  message: string;
}

export interface CompleteWeixinQrLoginResult {
  connected: boolean;
  account?: StoredWeixinAccount;
  message: string;
}

const FIXED_BASE_URL = 'https://ilinkai.weixin.qq.com';
const DEFAULT_BOT_TYPE = '3';
const ACTIVE_LOGIN_TTL_MS = 5 * 60_000;
const QR_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_WAIT_TIMEOUT_MS = 8 * 60_000;
const MAX_QR_REFRESH_COUNT = 3;

const activeLogins = new Map<string, ActiveLogin>();

export async function startWeixinQrLogin(options?: {
  sessionKey?: string;
  botType?: string;
  fetchImpl?: FetchLike;
}): Promise<StartWeixinQrLoginResult> {
  const sessionKey = options?.sessionKey?.trim() || randomUUID();
  purgeExpiredLogins();

  const qr = await fetchQrCode(options?.fetchImpl ?? fetch, options?.botType ?? DEFAULT_BOT_TYPE);
  activeLogins.set(sessionKey, {
    sessionKey,
    qrcode: qr.qrcode,
    qrcodeUrl: qr.qrcode_img_content,
    startedAt: Date.now(),
    currentApiBaseUrl: FIXED_BASE_URL
  });

  return {
    sessionKey,
    qrcodeUrl: qr.qrcode_img_content,
    message: '使用微信扫描二维码，确认后将自动保存登录凭证。'
  };
}

export async function waitForWeixinQrLogin(options: {
  sessionKey: string;
  authFile: string;
  timeoutMs?: number;
  botType?: string;
  fetchImpl?: FetchLike;
  onQrRefresh?: (qrcodeUrl: string) => void;
  onStatus?: (status: string) => void;
}): Promise<CompleteWeixinQrLoginResult> {
  const login = activeLogins.get(options.sessionKey);
  if (!login) {
    return {
      connected: false,
      message: '当前没有进行中的微信登录，请重新发起扫码。'
    };
  }

  if (Date.now() - login.startedAt > ACTIVE_LOGIN_TTL_MS) {
    activeLogins.delete(options.sessionKey);
    return {
      connected: false,
      message: '二维码已过期，请重新开始登录。'
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS);
  let qrRefreshCount = 1;

  while (Date.now() < deadline) {
    const status = await pollQrStatus(fetchImpl, login.currentApiBaseUrl, login.qrcode);
    options.onStatus?.(status.status);

    if (status.status === 'wait' || status.status === 'scaned') {
      await delay(1000);
      continue;
    }

    if (status.status === 'scaned_but_redirect') {
      if (status.redirect_host?.trim()) {
        login.currentApiBaseUrl = `https://${status.redirect_host.trim()}`;
      }
      await delay(1000);
      continue;
    }

    if (status.status === 'expired') {
      qrRefreshCount += 1;
      if (qrRefreshCount > MAX_QR_REFRESH_COUNT) {
        activeLogins.delete(options.sessionKey);
        return {
          connected: false,
          message: '二维码多次过期，请重新开始登录。'
        };
      }

      const refreshed = await fetchQrCode(fetchImpl, options.botType ?? DEFAULT_BOT_TYPE);
      login.qrcode = refreshed.qrcode;
      login.qrcodeUrl = refreshed.qrcode_img_content;
      login.startedAt = Date.now();
      login.currentApiBaseUrl = FIXED_BASE_URL;
      options.onQrRefresh?.(refreshed.qrcode_img_content);
      await delay(1000);
      continue;
    }

    if (status.status === 'confirmed') {
      if (!status.bot_token || !status.ilink_bot_id || !status.ilink_user_id) {
        activeLogins.delete(options.sessionKey);
        return {
          connected: false,
          message: '扫码成功，但服务端返回的账号信息不完整。'
        };
      }

      const account: StoredWeixinAccount = {
        id: status.ilink_bot_id,
        token: status.bot_token,
        ilinkUserId: status.ilink_user_id,
        baseUrl: status.baseurl?.trim() || FIXED_BASE_URL,
        savedAt: new Date().toISOString()
      };

      saveStoredWeixinAccount(account, options.authFile);
      activeLogins.delete(options.sessionKey);

      return {
        connected: true,
        account,
        message: `微信账号 ${account.id} 已绑定完成。`
      };
    }
  }

  activeLogins.delete(options.sessionKey);
  return {
    connected: false,
    message: '登录超时，请重新运行扫码登录。'
  };
}

async function fetchQrCode(fetchImpl: FetchLike, botType: string): Promise<QRCodeResponse> {
  const rawText = await apiGetFetch(fetchImpl, {
    baseUrl: FIXED_BASE_URL,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    label: 'fetchQRCode'
  });
  return JSON.parse(rawText) as QRCodeResponse;
}

async function pollQrStatus(fetchImpl: FetchLike, baseUrl: string, qrcode: string): Promise<StatusResponse> {
  try {
    const rawText = await apiGetFetch(fetchImpl, {
      baseUrl,
      endpoint: `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      label: 'pollQRStatus',
      timeoutMs: QR_LONG_POLL_TIMEOUT_MS
    });
    return JSON.parse(rawText) as StatusResponse;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { status: 'wait' };
    }

    return { status: 'wait' };
  }
}

async function apiGetFetch(
  fetchImpl: FetchLike,
  params: { baseUrl: string; endpoint: string; label: string; timeoutMs?: number }
): Promise<string> {
  const url = new URL(params.endpoint, ensureTrailingSlash(params.baseUrl));
  const timeoutMs = params.timeoutMs;
  const controller = timeoutMs ? new AbortController() : undefined;
  const timer = controller && timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      signal: controller?.signal
    });
    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`${params.label} ${response.status}: ${rawText}`);
    }
    return rawText;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function purgeExpiredLogins(): void {
  for (const [sessionKey, login] of activeLogins.entries()) {
    if (Date.now() - login.startedAt > ACTIVE_LOGIN_TTL_MS) {
      activeLogins.delete(sessionKey);
    }
  }
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
