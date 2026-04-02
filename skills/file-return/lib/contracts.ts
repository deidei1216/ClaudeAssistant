export interface ArtifactSummary {
  relativePath: string;
  displayName: string;
  summary: string;
}

export interface RecentFileMemoryRecord extends ArtifactSummary {
  source?: string;
}

export interface ResolveArtifactsInput {
  cwd: string;
  recentFiles: ArtifactSummary[];
}

export interface ResolveArtifactsResult {
  mode: 'direct' | 'package' | 'none';
  files: string[];
}

export interface PackageArtifactsInput {
  cwd: string;
  files: string[];
  outputName: string;
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
