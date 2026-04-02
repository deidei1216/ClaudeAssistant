import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

export interface PackageArtifactsInput {
  cwd: string;
  files: string[];
  outputName: string;
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
