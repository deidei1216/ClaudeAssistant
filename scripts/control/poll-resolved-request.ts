import { ControlStore } from '../../src/core/control-store';

const args = new Map(
  process.argv.slice(2).reduce<string[][]>((entries, value, index, list) => {
    if (value.startsWith('--')) {
      entries.push([value.slice(2), list[index + 1]]);
    }
    return entries;
  }, [])
);

const store = new ControlStore(args.get('base-dir') ?? 'data/control');
const timeoutMs = Number(args.get('timeout-ms') ?? '30000');
const requestId = args.get('request-id') ?? '';
const start = Date.now();

async function main(): Promise<void> {
  while (Date.now() - start < timeoutMs) {
    const request = store.getRequest(requestId);
    if (request?.status === 'resolved') {
      const signal = store.getLatestSignalForRequest(requestId);
      console.log(JSON.stringify({ ok: true, requestId, signal: signal?.signal, comment: signal?.comment }, null, 2));
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  console.log(JSON.stringify({ ok: false, requestId, reason: 'timeout' }, null, 2));
  process.exitCode = 1;
}

void main();