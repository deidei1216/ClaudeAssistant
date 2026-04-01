import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DiscordAdapter } from './adapters';
import { CommandHandler } from './commands';
import { buildBuiltInCommands } from './commands/built-in/help';
import { loadGatewayConfig } from './config/gateway-config';
import { ControlRouter } from './core/control-router';
import { ControlStore } from './core/control-store';
import { ControlSync } from './core/control-sync';
import { AgentGateway } from './core/gateway';
import { SessionOrchestrator } from './core/orchestrator';
import { ProfileManager } from './core/profile-manager';
import { SessionStore } from './core/session-store';
import { ClaudeCodeWorker } from './core/worker';
import { createLogger } from './utils/logger';

async function main(): Promise<void> {
  const config = loadGatewayConfig('config/gateway.json');
  const logger = createLogger(config.logging.level);
  const discordFile = JSON.parse(readFileSync(join('config', 'adapters', 'discord.json'), 'utf8'));
  const discordConfig = {
    ...discordFile,
    token: process.env.DISCORD_BOT_TOKEN ?? discordFile.token
  };
  const adapter = new DiscordAdapter(undefined, logger);

  await adapter.initialize(discordConfig);

  const orchestrator = new SessionOrchestrator({
    sessionStore: new SessionStore(join('data', 'sessions')),
    profileManager: new ProfileManager('profiles'),
    executor: new ClaudeCodeWorker(),
    defaults: config.defaults
  });
  const commandHandler = new CommandHandler();

  buildBuiltInCommands(commandHandler);

  const controlStore = new ControlStore(config.control.baseDir);
  const controlRouter = new ControlRouter(controlStore, undefined, logger);
  const controlSync = new ControlSync({
    adapters: [adapter],
    controlStore,
    logger,
    intervalMs: config.control.syncIntervalMs
  });

  const gateway = new AgentGateway({
    adapters: [adapter],
    commandHandler,
    orchestrator,
    controlStore,
    controlRouter,
    controlSync,
    logger
  });

  await gateway.start();
  logger.info({}, 'Agent Gateway started.');

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
