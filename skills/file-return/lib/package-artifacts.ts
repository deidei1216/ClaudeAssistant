import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { PackageArtifactsInput } from './contracts';

export async function packageArtifacts(
  input: PackageArtifactsInput
): Promise<{ outputPath: string }> {
  const absoluteOutputPath = isAbsolute(input.outputName)
    ? input.outputName
    : join(input.cwd, input.outputName);

  mkdirSync(dirname(absoluteOutputPath), { recursive: true });
  rmSync(absoluteOutputPath, { force: true });

  const archivePath = isAbsolute(input.outputName) ? absoluteOutputPath : input.outputName;
  const result = spawnSync('/usr/bin/zip', ['-q', archivePath, ...input.files], {
    cwd: input.cwd,
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'zip command failed');
  }

  return {
    outputPath: input.outputName
  };
}
