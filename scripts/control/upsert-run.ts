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

store.saveRun({
  id: args.get('run-id') ?? '',
  sessionId: args.get('session-id') ?? '',
  title: args.get('title') ?? '',
  status: (args.get('status') as 'running' | 'waiting_control' | 'paused' | 'completed' | 'failed' | 'cancelled') ?? 'running',
  createdAt: now,
  updatedAt: now
});

console.log(JSON.stringify({ ok: true, runId: args.get('run-id') }, null, 2));