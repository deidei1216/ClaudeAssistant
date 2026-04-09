import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { ensureDeliveryBoundaryScaffold, resolveDeliveriesRoot } from '../../core/delivery-paths';
import { upsertDeliveryManifestEntry } from '../../skills/file-return/lib/delivery-manifest';
import { isCliFlag, normalizeWorkspaceInputPath, validateDeliveryRelativePath } from './delivery-paths';

interface PublishFileOptions {
  cwd: string;
  source: string;
  displayName?: string;
  primary?: boolean;
}

export function publishFile(options: PublishFileOptions): { publishedPath: string } {
  const boundary = ensureDeliveryBoundaryScaffold(options.cwd);
  const normalizedSource = isAbsolute(options.source) ? options.source : normalizeWorkspaceInputPath(options.source);
  const absoluteSourcePath = isAbsolute(normalizedSource) ? normalizedSource : resolve(boundary.workspaceRoot, normalizedSource);
  const fileName = options.displayName?.trim()
    ? validateDeliveryRelativePath(options.displayName, 'Destination path')
    : basename(absoluteSourcePath);
  const publishedPath = join(resolveDeliveriesRoot(boundary.workspaceRoot), fileName);
  const sourcePath = toManifestSourcePath(boundary.workspaceRoot, absoluteSourcePath, normalizedSource);

  mkdirSync(dirname(publishedPath), { recursive: true });
  copyFileSync(absoluteSourcePath, publishedPath);

  upsertDeliveryManifestEntry(
    boundary.workspaceRoot,
    {
      kind: 'file',
      path: fileName,
      sourcePath,
      packaged: false
    },
    { primary: options.primary ?? true }
  );

  return {
    publishedPath
  };
}

function parseArgs(argv: string[]): PublishFileOptions {
  const [source, maybeDisplayName, ...rest] = argv;

  if (!source) {
    throw new Error('Usage: tsx scripts/delivery/publish-file.ts <source> [displayName] [--primary|--no-primary]');
  }

  const displayName = isCliFlag(maybeDisplayName) ? undefined : maybeDisplayName;
  const flags = isCliFlag(maybeDisplayName) ? [maybeDisplayName, ...rest] : rest;

  return {
    cwd: process.cwd(),
    source,
    displayName,
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
  const result = publishFile(parseArgs(process.argv.slice(2)));
  process.stdout.write(JSON.stringify({ publishedPath: result.publishedPath }));
}

if (require.main === module) {
  main();
}
