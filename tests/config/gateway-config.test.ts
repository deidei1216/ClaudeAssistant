import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { loadGatewayConfig } from '../../config/gateway-config';

describe('loadGatewayConfig', () => {
  test('applies defaults for omitted configuration fields', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'gateway-config-'));
    const configDir = join(tempDir, 'config');
    const configPath = join(configDir, 'gateway.json');
    const pluginDir = join(tempDir, '.claude-plugin');
    const pluginMetadataPath = join(pluginDir, 'plugin.json');

    try {
      await mkdir(configDir, { recursive: true });
      await mkdir(pluginDir, { recursive: true });
      await writeFile(
        pluginMetadataPath,
        JSON.stringify(
          {
            name: 'Temp Plugin Name',
            version: '9.9.9'
          },
          null,
          2
        ),
        'utf8'
      );
      await writeFile(
        configPath,
        JSON.stringify(
          {
            enabledAdapters: ['discord']
          },
          null,
          2
        ),
        'utf8'
      );

      const config = loadGatewayConfig(configPath);

      expect(config.name).toBe('Temp Plugin Name');
      expect(config.version).toBe('9.9.9');
      expect(config.defaults.model).toBe('sonnet');
      expect(config.defaults.permissionMode).toBe('auto');
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
