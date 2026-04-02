import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractFileMarkers } from '../core/attachments';
import { packageArtifacts, resolveArtifacts } from '../core/file-return';

interface RecentFileMemoryRecord {
  relativePath: string;
  displayName: string;
  summary: string;
  source?: string;
}

export interface FileReturnStopHookInput {
  session_id?: string;
  transcript_path?: string;
  cwd: string;
  permission_mode?: string;
  hook_event_name: 'Stop';
  stop_hook_active: boolean;
  last_assistant_message: string;
}

export interface FileReturnStopHookResult {
  decision?: 'block';
  reason?: string;
}

function loadRecentFileCandidates(workingDirectory: string): RecentFileMemoryRecord[] {
  const recentFilesPath = join(workingDirectory, '.claude-gateway', 'memory', 'recent-files.json');
  if (!existsSync(recentFilesPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(recentFilesPath, 'utf8')) as {
      recentFiles?: RecentFileMemoryRecord[];
    };

    return (parsed.recentFiles ?? []).filter((file) => file.source !== 'discord_inbound');
  } catch {
    return [];
  }
}

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

  const parsed = JSON.parse(rawInput) as FileReturnStopHookInput;
  const result = await runFileReturnStopHook(parsed);
  process.stdout.write(JSON.stringify(result));
}

if (require.main === module) {
  void main();
}
