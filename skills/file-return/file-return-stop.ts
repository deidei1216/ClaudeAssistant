import { extractFileMarkers } from '../../core/attachments';
import { FileReturnStopHookInput, FileReturnStopHookResult } from './lib/contracts';
import { resolveArtifacts } from './lib/resolve-artifacts';

export async function runFileReturnStopHook(
  input: FileReturnStopHookInput
): Promise<FileReturnStopHookResult> {
  const assistantMessage = input.last_assistant_message?.trim() ?? '';
  if (!assistantMessage) {
    return {};
  }

  const { markers } = extractFileMarkers(assistantMessage);
  const resolved = await resolveArtifacts({
    cwd: input.cwd
  });

  if (resolved.mode === 'orphaned_delivery') {
    return {
      decision: 'block',
      reason: [
        'Files exist in workspace/.deliveries/ but no published delivery intent was recorded.',
        'Do not write files into workspace/.deliveries/ manually.',
        'If this turn should return one file, run publish-file; for directories use publish-dir; for archives use package-delivery.',
        'After publishing, finish with the correct [[file:...]] marker.'
      ].join(' ')
    };
  }

  if (resolved.mode === 'invalid_delivery_state') {
    return {
      decision: 'block',
      reason: [
        'The published delivery intent is invalid or no longer exists on disk.',
        'Repair the published delivery state before stopping.',
        'Re-run publish-file, publish-dir, or package-delivery for the intended final artifact, then finish with the correct [[file:...]] marker.'
      ].join(' ')
    };
  }

  const handoffPath = resolved.mode === 'direct' ? resolved.files[0] : undefined;
  if (!handoffPath) {
    return {};
  }

  if (markers.includes(handoffPath)) {
    return {};
  }

  return {
    decision: 'block',
    reason: `If this turn should deliver the prepared artifact, replace any other file marker with exactly [[file:${handoffPath}]] on its own line in your final answer before stopping. Do not use bare filenames or workspace-prefixed paths.`
  };
}

async function main(): Promise<void> {
  const rawInput = await new Promise<string>((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      input += chunk;
    });
    process.stdin.on('end', () => resolve(input));
    process.stdin.on('error', reject);
  });

  const parsed = JSON.parse(rawInput) as Parameters<typeof runFileReturnStopHook>[0];
  const result = await runFileReturnStopHook(parsed);
  process.stdout.write(JSON.stringify(result));
}

if (require.main === module) {
  void main();
}
