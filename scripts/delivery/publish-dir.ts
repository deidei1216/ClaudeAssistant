import { cpSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { ensureDeliveryBoundaryScaffold, resolveDeliveriesRoot } from '../../core/delivery-paths';
import { upsertDeliveryManifestEntry } from '../../skills/file-return/lib/delivery-manifest';
import { isCliFlag, normalizeWorkspaceInputPath, validateDeliveryRelativePath } from './delivery-paths';

interface PublishDirOptions {
  cwd: string;
  source: string;
  name?: string;
  primary?: boolean;
}

export function publishDir(options: PublishDirOptions): { publishedPath: string } {
  const boundary = ensureDeliveryBoundaryScaffold(options.cwd);
  const normalizedSource = isAbsolute(options.source) ? options.source : normalizeWorkspaceInputPath(options.source);
  const absoluteSourcePath = isAbsolute(normalizedSource) ? normalizedSource : resolve(boundary.workspaceRoot, normalizedSource);
  const directoryName = options.name?.trim()
    ? validateDeliveryRelativePath(options.name, 'Destination path')
    : basename(absoluteSourcePath);
  const publishedPath = join(resolveDeliveriesRoot(boundary.workspaceRoot), directoryName);
  const sourcePath = toManifestSourcePath(boundary.workspaceRoot, absoluteSourcePath, normalizedSource);

  cpSync(absoluteSourcePath, publishedPath, { recursive: true, force: true });

  upsertDeliveryManifestEntry(
    boundary.workspaceRoot,
    {
      kind: 'directory',
      path: directoryName,
      sourcePath,
      packaged: false
    },
    { primary: options.primary ?? false }
  );

  return {
    publishedPath
  };
}

function parseArgs(argv: string[]): PublishDirOptions {
  const [source, maybeName, ...rest] = argv;

  if (!source) {
    throw new Error('Usage: tsx scripts/delivery/publish-dir.ts <source> [name] [--primary|--no-primary]');
  }

  const name = isCliFlag(maybeName) ? undefined : maybeName;
  const flags = isCliFlag(maybeName) ? [maybeName, ...rest] : rest;

  return {
    cwd: process.cwd(),
    source,
    name,
    primary: parsePrimaryFlag(flags, true)
  };
}

function parsePrimaryFlag(flags: string[], defaultValue: boolean): boolean {
  if (flags.includes('--primary')) {
    return true;
  }

  if (flags.includes('--no-primary')) {
    return false;
  }

  return defaultValue;
}

function toManifestSourcePath(workspaceRoot: string, absoluteSourcePath: string, source: string): string {
  if (!isAbsolute(source)) {
    return source;
  }

  const relativeSourcePath = relative(workspaceRoot, absoluteSourcePath).replaceAll('\\', '/');
  if (relativeSourcePath.length === 0 || relativeSourcePath === '.' || relativeSourcePath.startsWith('..')) {
    return basename(absoluteSourcePath);
  }

  return relativeSourcePath;
}

function main(): void {
  const result = publishDir(parseArgs(process.argv.slice(2)));
  process.stdout.write(JSON.stringify({ publishedPath: result.publishedPath }));
}

if (require.main === module) {
  main();
}
