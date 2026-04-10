import { getDefaultWeixinAuthFile, loadStoredWeixinAccounts, type StoredWeixinAccount } from './account-store';
import {
  startWeixinQrLogin,
  waitForWeixinQrLogin,
  type CompleteWeixinQrLoginResult,
  type StartWeixinQrLoginResult
} from './login';

export interface WeixinStartupAccountConfig {
  id: string;
  token?: string;
  ilinkUserId?: string;
  baseUrl?: string;
  cdnBaseUrl?: string;
  enabled?: boolean;
}

export interface WeixinStartupConfig {
  authFile?: string;
  accounts?: WeixinStartupAccountConfig[];
}

export interface PreparedWeixinStartupAccount extends WeixinStartupAccountConfig {
  token: string;
  ilinkUserId: string;
}

interface WeixinStartupLoginDependencies {
  print?: (message: string) => void;
  startLogin?: () => Promise<StartWeixinQrLoginResult>;
  waitForLogin?: (options: {
    sessionKey: string;
    authFile: string;
    onQrRefresh?: (qrcodeUrl: string) => void;
    onStatus?: (status: string) => void;
  }) => Promise<CompleteWeixinQrLoginResult>;
}

const MISSING_ACCOUNT_MESSAGE =
  'No enabled Weixin accounts were configured. Run `npm run weixin:login` or fill config/adapters/weixin.json manually.';

export async function prepareWeixinConfigForStartup<T extends WeixinStartupConfig>(
  config: T,
  dependencies: WeixinStartupLoginDependencies = {}
): Promise<T & { authFile: string; accounts: PreparedWeixinStartupAccount[] }> {
  const authFile = config.authFile?.trim() || getDefaultWeixinAuthFile();
  let accounts = resolveUsableWeixinAccounts({
    ...config,
    authFile
  });

  if (accounts.length === 0) {
    const loggedInAccount = await runAutomaticWeixinLogin(authFile, dependencies);
    accounts = resolveUsableWeixinAccounts({
      ...config,
      authFile
    });

    if (accounts.length === 0 && loggedInAccount) {
      accounts = [
        {
          id: loggedInAccount.id,
          token: loggedInAccount.token,
          ilinkUserId: loggedInAccount.ilinkUserId,
          baseUrl: loggedInAccount.baseUrl,
          enabled: true
        }
      ];
    }
  }

  if (accounts.length === 0) {
    throw new Error(MISSING_ACCOUNT_MESSAGE);
  }

  return {
    ...config,
    authFile,
    accounts
  };
}

export function resolveUsableWeixinAccounts(config: WeixinStartupConfig): PreparedWeixinStartupAccount[] {
  const configuredAccounts = (config.accounts ?? []).filter((account) => account.enabled !== false);
  const storedAccounts = loadStoredWeixinAccounts(config.authFile ?? getDefaultWeixinAuthFile());
  const storedById = new Map(storedAccounts.map((account) => [account.id, account]));

  if (configuredAccounts.length === 0) {
    return storedAccounts
      .map((account) => ({
        id: account.id,
        token: account.token,
        ilinkUserId: account.ilinkUserId,
        baseUrl: account.baseUrl,
        enabled: true
      }))
      .filter(isUsableWeixinAccount);
  }

  return configuredAccounts
    .map((account) => mergeConfiguredWeixinAccount(account, storedById.get(account.id)))
    .filter(isUsableWeixinAccount);
}

async function runAutomaticWeixinLogin(
  authFile: string,
  dependencies: WeixinStartupLoginDependencies
): Promise<StoredWeixinAccount | undefined> {
  const print = dependencies.print ?? console.log;
  const startLogin = dependencies.startLogin ?? startWeixinQrLogin;
  const waitForLogin = dependencies.waitForLogin ?? waitForWeixinQrLogin;

  print('未检测到可用的微信登录凭证，正在自动发起扫码登录...');

  const started = await startLogin();
  print(started.message);
  print(`session: ${started.sessionKey}`);
  print('');
  print('QR URL:');
  print(started.qrcodeUrl);
  print('');
  print('请用微信扫描上面的二维码链接，确认后服务会继续启动。');

  const result = await waitForLogin({
    sessionKey: started.sessionKey,
    authFile,
    onQrRefresh(qrcodeUrl) {
      print('');
      print('二维码已刷新，请重新扫描：');
      print(qrcodeUrl);
    },
    onStatus(status) {
      if (status === 'scaned') {
        print('已扫码，等待手机端确认...');
      }
    }
  });

  print(result.message);
  if (!result.connected) {
    throw new Error(result.message);
  }

  return result.account;
}

function mergeConfiguredWeixinAccount(
  account: WeixinStartupAccountConfig,
  stored?: StoredWeixinAccount
): PreparedWeixinStartupAccount {
  return {
    ...account,
    token: account.token?.trim() || stored?.token || '',
    ilinkUserId: account.ilinkUserId?.trim() || stored?.ilinkUserId || '',
    baseUrl: account.baseUrl?.trim() || stored?.baseUrl || account.baseUrl
  };
}

function isUsableWeixinAccount(account: PreparedWeixinStartupAccount): boolean {
  return Boolean(account.id?.trim() && account.token?.trim() && account.ilinkUserId?.trim());
}

export { MISSING_ACCOUNT_MESSAGE as missingWeixinAccountMessage };
