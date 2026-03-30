import { readFileSync } from 'node:fs';
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
  workingDirectory: z.string().default('.'),
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

export function loadGatewayConfig(configPath: string): GatewayConfig {
  const rawConfig = readFileSync(configPath, 'utf8');
  const parsedConfig = JSON.parse(rawConfig) as unknown;

  return gatewayConfigSchema.parse(parsedConfig);
}
