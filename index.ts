import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DiscordAdapter, WeixinAdapter } from './adapters';
import { prepareWeixinConfigForStartup } from './adapters/weixin/startup';
import { CommandHandler } from './commands';
import { materializeRuntimeClaudeSettings } from './config/runtime-claude-settings';
import { buildBuiltInCommands } from './commands/help';
import { loadGatewayConfig } from './config/gateway-config';
import type { ChannelAdapter } from './core/adapter';
import { AgentGateway } from './core/gateway';
import { SessionOrchestrator } from './core/orchestrator';
import { ProfileManager } from './core/profile-manager';
import { SessionStore } from './core/session-store';
import { ClaudeCodeWorker } from './core/worker';
import { createLogger } from './utils/logger';

async function main(): Promise<void> {
  const config = loadGatewayConfig('settings.json');
  const logger = createLogger(config.logging.level, config.logging.file);
  const adapters = await buildAdapters(config.enabledAdapters, logger);
  const projectRoot = process.cwd();
  const defaultClaudeSettingsPath = join(projectRoot, '.claude', 'settings.json');
  const runtimeClaudeSettingsPath = join(projectRoot, 'sessions', '.runtime', 'claude-settings.json');

  if (existsSync(defaultClaudeSettingsPath)) {
    materializeRuntimeClaudeSettings({
      sourcePath: defaultClaudeSettingsPath,
      outputPath: runtimeClaudeSettingsPath,
      projectRoot
    });
  }

  const orchestrator = new SessionOrchestrator({
    sessionStore: new SessionStore('sessions'),
    profileManager: new ProfileManager('agents'),
    executor: new ClaudeCodeWorker(),
    defaults: {
      ...config.defaults,
      settingsPath: existsSync(runtimeClaudeSettingsPath) ? runtimeClaudeSettingsPath : undefined
    }
  });
  const commandHandler = new CommandHandler();

  buildBuiltInCommands(commandHandler);

  const gateway = new AgentGateway({
    adapters,
    commandHandler,
    orchestrator,
    logger
  });

  await gateway.start();
  logger.info({}, 'Claude Assistant plugin runtime started.');

  // Graceful shutdown handlers
  const shutdown = async () => {
    logger.info({}, 'Shutting down...');
    await gateway.stop();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function buildAdapters(enabledAdapters: string[], logger: ReturnType<typeof createLogger>): Promise<ChannelAdapter[]> {
  const adapters: ChannelAdapter[] = [];

  for (const adapterName of enabledAdapters) {
    if (adapterName === 'discord') {
      const adapter = new DiscordAdapter(undefined, logger);
      await adapter.initialize(readAdapterConfig<Parameters<DiscordAdapter['initialize']>[0]>(join('config', 'adapters', 'discord.json')));
      adapters.push(adapter);
      continue;
    }

    if (adapterName === 'weixin') {
      const adapter = new WeixinAdapter(undefined, logger);
      const config = readAdapterConfig<Parameters<WeixinAdapter['initialize']>[0]>(join('config', 'adapters', 'weixin.json'));
      const preparedConfig = await prepareWeixinConfigForStartup(config);
      await adapter.initialize(preparedConfig);
      adapters.push(adapter);
      continue;
    }

    throw new Error(`Unsupported adapter: ${adapterName}`);
  }

  return adapters;
}

function readAdapterConfig<T>(path: string): T {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  return substituteEnv(raw) as T;
}

function substituteEnv(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => process.env[name] ?? '');
  }

  if (Array.isArray(value)) {
    return value.map((entry) => substituteEnv(entry));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, substituteEnv(entry)])
    );
  }

  return value;
}
