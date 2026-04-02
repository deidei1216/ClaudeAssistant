import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

export interface ArtifactSummary {
  relativePath: string;
  displayName: string;
  summary: string;
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

export async function packageArtifacts(
  input: PackageArtifactsInput
): Promise<{ outputPath: string }> {
  const absoluteOutputPath = isAbsolute(input.outputName)
    ? input.outputName
    : join(input.cwd, input.outputName);

  mkdirSync(dirname(absoluteOutputPath), { recursive: true });
  writeFileSync(
    absoluteOutputPath,
    JSON.stringify(
      {
        packagedAt: new Date().toISOString(),
        files: input.files
      },
      null,
      2
    )
  );

  return {
    outputPath: input.outputName
  };
}
