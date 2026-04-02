import { extractFileMarkers } from '../../src/core/attachments';
import { FileReturnStopHookInput, FileReturnStopHookResult } from './lib/contracts';
import { discoverTranscriptArtifact } from './lib/discover-transcript-artifact';
import { loadRecentFileCandidates } from './lib/gateway-contract';
import { packageArtifacts } from './lib/package-artifacts';
import { resolveArtifacts } from './lib/resolve-artifacts';

export async function runFileReturnStopHook(
  input: FileReturnStopHookInput
): Promise<FileReturnStopHookResult> {
  if (input.stop_hook_active) {
    return {};
  }

  const assistantMessage = input.last_assistant_message?.trim() ?? '';
  if (!assistantMessage) {
    return {};
  }

  const { markers } = extractFileMarkers(assistantMessage);
  if (markers.length > 0) {
    return {};
  }

  const recentFiles = loadRecentFileCandidates(input.cwd);
  const resolved = await resolveArtifacts({
    cwd: input.cwd,
    recentFiles
  });

  let handoffPath: string | undefined;

  if (resolved.mode === 'direct' && resolved.files[0]) {
    handoffPath = resolved.files[0];
  }

  if (resolved.mode === 'package' && resolved.files.length > 0) {
    const packaged = await packageArtifacts({
      cwd: input.cwd,
      files: resolved.files,
      outputName: '.claude-gateway/outbox/file-return-bundle.zip'
    });
    handoffPath = packaged.outputPath;
  }

  if (!handoffPath) {
    handoffPath = discoverTranscriptArtifact(input.cwd, input.transcript_path) ?? undefined;
  }

  if (!handoffPath) {
    return {};
  }

  return {
    decision: 'block',
    reason: `If this turn should deliver the prepared artifact, add [[file:${handoffPath}]] on its own line in your final answer before stopping.`
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
