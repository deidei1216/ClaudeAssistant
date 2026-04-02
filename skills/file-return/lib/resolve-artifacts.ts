import { ResolveArtifactsInput, ResolveArtifactsResult } from './contracts';

export async function resolveArtifacts(
  input: ResolveArtifactsInput
): Promise<ResolveArtifactsResult> {
  if (input.recentFiles.length === 0) {
    return {
      mode: 'none',
      files: []
    };
  }

  if (input.recentFiles.length === 1) {
    return {
      mode: 'direct',
      files: [input.recentFiles[0].relativePath]
    };
  }

  return {
    mode: 'package',
    files: input.recentFiles.map((file) => file.relativePath)
  };
}
