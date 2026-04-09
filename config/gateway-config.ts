import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { z } from 'zod';

const permissionModeSchema = z.enum([
  'default',
  'auto',
  'plan',
  'bypassPermissions',
  'dontAsk',
  'acceptEdits'
]);

const gatewayConfigSchema = z.object({
  name: z.string(),
  version: z.string(),
  defaults: z
    .object({
      model: z.string().default('sonnet'),
      permissionMode: permissionModeSchema.default('auto')
    })
    .default({
      model: 'sonnet',
      permissionMode: 'auto'
    }),
  limits: z
    .object({
      maxConcurrentSessions: z.number().int().positive().default(10),
      sessionTimeout: z.number().int().positive().default(3_600_000),
      maxTriggersPerSession: z.number().int().positive().default(50)
    })
    .default({
      maxConcurrentSessions: 10,
      sessionTimeout: 3_600_000,
      maxTriggersPerSession: 50
    }),
  enabledAdapters: z.array(z.string()).min(1),
  logging: z
    .object({
      level: z
        .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
        .default('info'),
      file: z.string().default('logs/gateway.log')
    })
    .default({
      level: 'info',
      file: 'logs/gateway.log'
    })
});

export type GatewayConfig = z.infer<typeof gatewayConfigSchema>;

function findPluginMetadataPath(configPath: string): string | null {
  const filesystemRoot = parse(configPath).root;
  let currentDir = dirname(resolve(configPath));

  while (true) {
    const candidatePath = join(currentDir, '.claude-plugin', 'plugin.json');
    if (existsSync(candidatePath)) {
      return candidatePath;
    }

    if (currentDir === filesystemRoot) {
      return null;
    }

    currentDir = dirname(currentDir);
  }
}

export function loadGatewayConfig(configPath: string): GatewayConfig {
  const pluginMetadataPath = findPluginMetadataPath(configPath);
  const metadataRaw = pluginMetadataPath ? readFileSync(pluginMetadataPath, 'utf8') : '{}';
  const metadata = JSON.parse(metadataRaw);

  const rawConfig = readFileSync(configPath, 'utf8');
  const settings = JSON.parse(rawConfig);

  const merged = {
    ...settings,
    name: metadata.name ?? 'Claude Assistant',
    version: metadata.version ?? '0.1.0'
  };

  return gatewayConfigSchema.parse(merged);
}
