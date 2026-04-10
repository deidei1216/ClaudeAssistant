import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDefaultWeixinAuthFile } from '../../adapters/weixin/account-store';
import { startWeixinQrLogin, waitForWeixinQrLogin } from '../../adapters/weixin/login';

async function main(): Promise<void> {
  const authFile = process.env.WEIXIN_AUTH_FILE?.trim() || getDefaultWeixinAuthFile();
  const gatewayConfigPath = join(process.cwd(), 'settings.json');
  const started = await startWeixinQrLogin();

  console.log(started.message);
  console.log(`session: ${started.sessionKey}`);
  console.log('');
  console.log('QR URL:');
  console.log(started.qrcodeUrl);
  console.log('');
  console.log('请用微信扫描上面的二维码链接。如果终端支持图片预览，也可以直接打开该 URL。');

  const result = await waitForWeixinQrLogin({
    sessionKey: started.sessionKey,
    authFile,
    onQrRefresh(qrcodeUrl) {
      console.log('');
      console.log('二维码已刷新，请重新扫描：');
      console.log(qrcodeUrl);
    },
    onStatus(status) {
      if (status === 'scaned') {
        console.log('已扫码，等待手机端确认...');
      }
    }
  });

  console.log(result.message);
  if (result.account) {
    ensureWeixinEnabledInGatewayConfig(gatewayConfigPath);
    console.log(`accountId: ${result.account.id}`);
    console.log(`ilinkUserId: ${result.account.ilinkUserId}`);
    console.log(`savedAuthFile: ${authFile}`);
    console.log(`gatewayConfig: ${gatewayConfigPath} 已自动启用 weixin`);
  }

  if (!result.connected) {
    process.exitCode = 1;
  }
}

function ensureWeixinEnabledInGatewayConfig(configPath: string): void {
  if (!existsSync(configPath)) {
    return;
  }

  const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as {
    enabledAdapters?: string[];
    [key: string]: unknown;
  };
  const enabledAdapters = Array.isArray(parsed.enabledAdapters) ? parsed.enabledAdapters : [];

  if (enabledAdapters.includes('weixin')) {
    return;
  }

  parsed.enabledAdapters = [...enabledAdapters, 'weixin'];
  writeFileSync(configPath, JSON.stringify(parsed, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
