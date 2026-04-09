import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../utils/logger';

describe('createLogger', () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    while (tempDirectories.length > 0) {
      const directory = tempDirectories.pop();
      if (directory) {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it('writes logs to the configured file path', () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), 'logger-test-'));
    tempDirectories.push(tempDirectory);
    const logPath = join(tempDirectory, 'logs', 'gateway.log');

    const logger = createLogger('info', logPath);
    logger.info({ channelId: 'channel-1' }, 'logger smoke test');

    const output = readFileSync(logPath, 'utf8');

    expect(output).toContain('"level":30');
    expect(output).toContain('"channelId":"channel-1"');
    expect(output).toContain('"msg":"logger smoke test"');
  });

  it('keeps writing to the provided output stream when a file path is configured', () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), 'logger-test-'));
    tempDirectories.push(tempDirectory);
    const logPath = join(tempDirectory, 'logs', 'gateway.log');
    const outputStream = new PassThrough();
    let stdoutOutput = '';
    outputStream.on('data', (chunk) => {
      stdoutOutput += chunk.toString();
    });

    const logger = createLogger('info', logPath, outputStream);
    logger.info({ channelId: 'channel-2' }, 'logger dual output test');

    const fileOutput = readFileSync(logPath, 'utf8');

    expect(fileOutput).toContain('"msg":"logger dual output test"');
    expect(stdoutOutput).toContain('"channelId":"channel-2"');
    expect(stdoutOutput).toContain('"msg":"logger dual output test"');
  });
});
