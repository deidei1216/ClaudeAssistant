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
const now = new Date();
const run = store.getRun(args.get('run-id') ?? '');

if (!run) {
  throw new Error(`Unknown run: ${args.get('run-id')}`);
}

store.saveRun({ ...run, status: 'waiting_control', updatedAt: now });
store.saveRequest({
  id: args.get('request-id') ?? '',
  runId: run.id,
  kind: 'approval',
  status: 'pending',
  summary: args.get('summary') ?? '',
  requestedAt: now
});

console.log(JSON.stringify({ ok: true, requestId: args.get('request-id') }, null, 2));