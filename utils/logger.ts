import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Writable } from 'node:stream';
import pino from 'pino';

export function createLogger(level = 'info', filePath?: string, outputStream: Writable = process.stdout) {
  if (!filePath) {
    return pino({ level }, outputStream);
  }

  mkdirSync(dirname(filePath), { recursive: true });
  return pino(
    { level },
    pino.multistream([
      { stream: outputStream },
      { stream: pino.destination({ dest: filePath, sync: true }) }
    ])
  );
}

export type Logger = ReturnType<typeof createLogger>;
