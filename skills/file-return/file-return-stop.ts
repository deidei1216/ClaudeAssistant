import { extractFileMarkers, formatFileMarker } from '../../core/attachments';
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
        'After publishing, finish normally. The Stop hook will provide the exact delivery handoff line if one is needed.'
      ].join(' ')
    };
  }

  if (resolved.mode === 'invalid_delivery_state') {
    return {
      decision: 'block',
      reason: [
        'The published delivery intent is invalid or no longer exists on disk.',
        'Repair the published delivery state before stopping.',
        'Re-run publish-file, publish-dir, or package-delivery for the intended final artifact. The Stop hook will provide the exact delivery handoff line once the state is valid.'
      ].join(' ')
    };
  }

  const handoffPath = resolved.mode === 'direct' ? resolved.files[0] : undefined;
  if (!handoffPath) {
    return {};
  }

  if (matchesExpectedMarkers(markers, resolved.files)) {
    return {};
  }

  const handoffLines = resolved.files.map((path) => formatFileMarker(path)).join('\n');

  return {
    decision: 'block',
    reason: [
      resolved.files.length === 1
        ? 'If this turn should deliver the prepared artifact, add exactly this delivery handoff line on its own line in your final answer before stopping:'
        : 'If this turn should deliver the prepared artifacts, add exactly these delivery handoff lines on their own lines in your final answer before stopping:',
      handoffLines,
      'Do not invent, rewrite, inline, reorder, or quote the delivery handoff lines.'
    ].join('\n')
  };
}

function matchesExpectedMarkers(markers: string[], expected: string[]): boolean {
  return markers.length === expected.length && markers.every((marker, index) => marker === expected[index]);
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
