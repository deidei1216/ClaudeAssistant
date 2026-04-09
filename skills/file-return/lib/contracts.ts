export interface ResolveArtifactsInput {
  cwd: string;
}

export interface ResolveArtifactsResult {
  mode: 'direct' | 'package' | 'none' | 'orphaned_delivery' | 'invalid_delivery_state';
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
