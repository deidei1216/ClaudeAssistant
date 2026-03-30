import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { loadGatewayConfig } from '../../src/config/gateway-config';

describe('loadGatewayConfig', () => {
  test('applies defaults for omitted configuration fields', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'gateway-config-'));
    const configDir = join(tempDir, 'config');
    const configPath = join(configDir, 'gateway.json');

    try {
      await mkdir(configDir, { recursive: true });
      await writeFile(
        configPath,
        JSON.stringify(
          {
            name: 'Agent Gateway',
            version: '1.0.0',
            enabledAdapters: ['discord']
          },
          null,
          2
        ),
        'utf8'
      );

      const config = loadGatewayConfig(configPath);

      expect(config.defaults.model).toBe('sonnet');
      expect(config.defaults.permissionMode).toBe('auto');
      expect(config.defaults.workingDirectory).toBe('.');
      expect(config.limits.maxConcurrentSessions).toBe(10);
      expect(config.limits.sessionTimeout).toBe(3_600_000);
      expect(config.limits.maxTriggersPerSession).toBe(50);
      expect(config.logging.level).toBe('info');
      expect(config.logging.file).toBe('logs/gateway.log');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
