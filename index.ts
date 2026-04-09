import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DiscordAdapter } from './adapters';
import { CommandHandler } from './commands';
import { materializeRuntimeClaudeSettings } from './config/runtime-claude-settings';
import { buildBuiltInCommands } from './commands/help';
import { loadGatewayConfig } from './config/gateway-config';
import { AgentGateway } from './core/gateway';
import { SessionOrchestrator } from './core/orchestrator';
import { ProfileManager } from './core/profile-manager';
import { SessionStore } from './core/session-store';
import { ClaudeCodeWorker } from './core/worker';
import { createLogger } from './utils/logger';

async function main(): Promise<void> {
  const config = loadGatewayConfig('settings.json');
  const logger = createLogger(config.logging.level, config.logging.file);
  const adapters = [];
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

  if (config.enabledAdapters.includes('discord')) {
    const discordFile = JSON.parse(readFileSync(join('config', 'adapters', 'discord.json'), 'utf8'));
    const discordConfig = {
      ...discordFile,
      token: process.env.DISCORD_BOT_TOKEN ?? discordFile.token
    };
    const adapter = new DiscordAdapter(undefined, logger);

    await adapter.initialize(discordConfig);
    adapters.push(adapter);
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
