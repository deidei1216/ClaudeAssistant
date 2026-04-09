import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

export interface DeliveryManifest {
  version: 1;
  entries: DeliveryManifestEntry[];
  primary: null;
}

export interface DeliveryManifestEntry {
  [key: string]: unknown;
}

export const INITIAL_DELIVERY_MANIFEST: DeliveryManifest = {
  version: 1,
  entries: [],
  primary: null
};

export function createInitialDeliveryManifest(): DeliveryManifest {
  return {
    version: INITIAL_DELIVERY_MANIFEST.version,
    entries: [],
    primary: INITIAL_DELIVERY_MANIFEST.primary
  };
}

export function resolveWorkspaceRoot(workingDirectory: string): string {
  const resolvedWorkingDirectory = resolve(workingDirectory);
  let currentPath = resolvedWorkingDirectory;

  while (true) {
    if (basename(currentPath) === 'workspace') {
      return currentPath;
    }

    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) {
      return resolvedWorkingDirectory;
    }

    currentPath = parentPath;
  }
}

export function resolveSessionRoot(workingDirectory: string): string {
  return dirname(resolveWorkspaceRoot(workingDirectory));
}

export function resolveDeliveriesRoot(workingDirectory: string): string {
  return join(resolveWorkspaceRoot(workingDirectory), '.deliveries');
}

export function resolveDeliveryManifestPath(workingDirectory: string): string {
  return join(resolveDeliveriesRoot(workingDirectory), 'manifest.json');
}

export function isInsideDeliveriesRoot(workingDirectory: string, candidatePath: string): boolean {
  const deliveriesRoot = resolveDeliveriesRoot(workingDirectory);
  const resolvedCandidate = resolve(candidatePath);

  return resolvedCandidate === deliveriesRoot || resolvedCandidate.startsWith(`${deliveriesRoot}${sep}`);
}

export function isWithinPublishedDeliveriesBoundary(workingDirectory: string, candidatePath: string): boolean {
  const deliveriesRoot = resolveDeliveriesRoot(workingDirectory);
  const lexicalCandidatePath = resolve(candidatePath);

  if (!isInsideDirectory(deliveriesRoot, lexicalCandidatePath)) {
    return false;
  }

  return isInsideDirectory(resolveBoundaryPath(deliveriesRoot), resolveBoundaryPath(lexicalCandidatePath));
}

export function toDeliveryRelativePath(workingDirectory: string, absolutePath: string): string {
  const resolvedAbsolutePath = resolve(absolutePath);

  if (!isWithinPublishedDeliveriesBoundary(workingDirectory, resolvedAbsolutePath)) {
    throw new Error('Path is outside the deliveries root');
  }

  const deliveriesRoot = resolveDeliveriesRoot(workingDirectory);
  const relativePath = relative(deliveriesRoot, resolvedAbsolutePath);

  return relativePath.length > 0 ? relativePath : '.';
}

export function ensureDeliveryBoundaryScaffold(workingDirectory: string): {
  workspaceRoot: string;
  deliveriesRoot: string;
  manifestPath: string;
} {
  const workspaceRoot = resolveWorkspaceRoot(workingDirectory);
  if (basename(workspaceRoot) !== 'workspace') {
    return {
      workspaceRoot,
      deliveriesRoot: resolveDeliveriesRoot(workspaceRoot),
      manifestPath: resolveDeliveryManifestPath(workspaceRoot)
    };
  }

  const deliveriesRoot = resolveDeliveriesRoot(workspaceRoot);
  const manifestPath = resolveDeliveryManifestPath(workspaceRoot);

  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(deliveriesRoot, { recursive: true });

  if (!existsSync(manifestPath)) {
    writeFileSync(manifestPath, JSON.stringify(createInitialDeliveryManifest(), null, 2));
  }

  return {
    workspaceRoot,
    deliveriesRoot,
    manifestPath
  };
}

function isInsideDirectory(directory: string, candidatePath: string): boolean {
  return candidatePath === directory || candidatePath.startsWith(`${directory}${sep}`);
}

function resolveBoundaryPath(candidatePath: string): string {
  let currentPath = resolve(candidatePath);
  const trailingSegments: string[] = [];

  while (!existsSync(currentPath)) {
    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }

    trailingSegments.unshift(basename(currentPath));
    currentPath = parentPath;
  }

  let resolvedPath = existsSync(currentPath) ? realpathSync(currentPath) : currentPath;
  for (const segment of trailingSegments) {
    resolvedPath = join(resolvedPath, segment);
  }

  return resolvedPath;
}
