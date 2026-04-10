import { lstatSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, extname, join } from 'node:path';
import { ensureDeliveryBoundaryScaffold } from '../../core/delivery-paths';
import { readDeliveryManifest, upsertDeliveryManifestEntry } from '../../skills/file-return/lib/delivery-manifest';
import { validateDeliveryRelativePath } from './delivery-paths';

interface PackageDeliveryOptions {
  cwd: string;
  sourcePath: string;
  outputName?: string;
}

export async function packageDelivery(
  options: PackageDeliveryOptions
): Promise<{ publishedPath: string; publishedRelativePath: string }> {
  const boundary = ensureDeliveryBoundaryScaffold(options.cwd);
  const sourcePath = validateDeliveryRelativePath(options.sourcePath, 'Source path');
  const outputName = validateDeliveryRelativePath(
    options.outputName?.trim() || defaultArchiveName(sourcePath),
    'Output path'
  );
  const manifest = readDeliveryManifest(boundary.workspaceRoot);
  const publishedEntry = manifest.entries.find((entry) => entry.path === sourcePath);

  if (!publishedEntry) {
    throw new Error(
      'package-delivery only accepts a published delivery entry from .deliveries. ' +
      'If you need to send a small set of standalone files, publish each file separately instead of creating a zip. ' +
      'If you do need an archive, first publish a directory with publish-dir and then pass that published directory name to package-delivery.'
    );
  }

  if (sourcePath === outputName) {
    throw new Error('Output path must not match the published source path; provide a distinct output name');
  }

  const absoluteSourcePath = join(boundary.deliveriesRoot, sourcePath);
  const archivePath = join(boundary.deliveriesRoot, outputName);
  const sourceStat = lstatSync(absoluteSourcePath);
  rmSync(archivePath, { force: true });
  const zipArgs = sourceStat.isDirectory() ? ['-qr', outputName, sourcePath] : ['-q', outputName, sourcePath];
  const result = spawnSync('/usr/bin/zip', zipArgs, {
    cwd: boundary.deliveriesRoot,
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'zip command failed');
  }

  upsertDeliveryManifestEntry(
    boundary.workspaceRoot,
    {
      kind: 'archive',
      path: outputName,
      sourcePath,
      packaged: true
    },
    {
      primary: true,
      handoff: { mode: 'clear' }
    }
  );

  return {
    publishedPath: archivePath,
    publishedRelativePath: outputName
  };
}

function defaultArchiveName(sourcePath: string): string {
  const sourceBaseName = basename(sourcePath);
  if (extname(sourceBaseName) === '.zip') {
    return sourceBaseName;
  }

  return `${sourceBaseName}.zip`;
}

function parseArgs(argv: string[]): PackageDeliveryOptions {
  const [sourcePath, outputName] = argv;

  if (!sourcePath) {
    throw new Error('Usage: tsx scripts/delivery/package-delivery.ts <sourcePath> [outputName]');
  }

  return {
    cwd: process.cwd(),
    sourcePath,
    outputName
  };
}

async function main(): Promise<void> {
  const result = await packageDelivery(parseArgs(process.argv.slice(2)));
  process.stdout.write(JSON.stringify({ publishedPath: result.publishedPath }));
}

if (require.main === module) {
  void main();
}
