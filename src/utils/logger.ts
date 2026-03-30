import pino from 'pino';

export function createLogger(level = 'info') {
  return pino({ level });
}

export type Logger = ReturnType<typeof createLogger>;