import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, normalize, sep } from 'node:path';
import { resolveDeliveriesRoot, resolveDeliveryManifestPath } from '../../../core/delivery-paths';

export interface DeliveryManifestEntry {
  kind: 'file' | 'directory' | 'archive';
  path: string;
  sourcePath: string;
  packaged: boolean;
}

export interface DeliveryManifest {
  version: 1;
  entries: DeliveryManifestEntry[];
  primary: string | null;
}

const INITIAL_DELIVERY_MANIFEST: DeliveryManifest = {
  version: 1,
  entries: [],
  primary: null
};

export function createDeliveryManifest(): DeliveryManifest {
  return {
    version: INITIAL_DELIVERY_MANIFEST.version,
    entries: [],
    primary: null
  };
}

export function validateDeliveryManifest(manifest: unknown): DeliveryManifest {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Delivery manifest must be an object');
  }

  const candidate = manifest as Partial<DeliveryManifest>;
  if (candidate.version !== 1) {
    throw new Error('Delivery manifest version must be 1');
  }

  if (!Array.isArray(candidate.entries)) {
    throw new Error('Delivery manifest entries must be an array');
  }

  const entries = candidate.entries.map(validateDeliveryManifestEntry);
  const primary = validatePrimary(candidate.primary, entries);

  return {
    version: 1,
    entries,
    primary
  };
}

export function readDeliveryManifest(workingDirectory: string): DeliveryManifest {
  const manifestPath = resolveDeliveryManifestPath(workingDirectory);

  try {
    return validateDeliveryManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return createDeliveryManifest();
    }

    throw error;
  }
}

export function writeDeliveryManifest(workingDirectory: string, manifest: DeliveryManifest): void {
  const validatedManifest = validateDeliveryManifest(manifest);
  mkdirSync(resolveDeliveriesRoot(workingDirectory), { recursive: true });
  writeFileSync(resolveDeliveryManifestPath(workingDirectory), JSON.stringify(validatedManifest, null, 2));
}

export function upsertDeliveryManifestEntry(
  workingDirectory: string,
  entry: DeliveryManifestEntry,
  options?: { primary?: boolean }
): DeliveryManifest {
  const manifest = readDeliveryManifest(workingDirectory);
  const validatedEntry = validateDeliveryManifestEntry(entry);

  const nextManifest: DeliveryManifest = {
    version: manifest.version,
    entries: [
      ...manifest.entries.filter((existingEntry) => existingEntry.path !== validatedEntry.path),
      validatedEntry
    ],
    primary: options?.primary ? validatedEntry.path : manifest.primary
  };

  writeDeliveryManifest(workingDirectory, nextManifest);
  return nextManifest;
}

function validateDeliveryManifestEntry(entry: unknown): DeliveryManifestEntry {
  if (!entry || typeof entry !== 'object') {
    throw new Error('Delivery manifest entry must be an object');
  }

  const candidate = entry as Partial<DeliveryManifestEntry>;
  if (candidate.kind !== 'file' && candidate.kind !== 'directory' && candidate.kind !== 'archive') {
    throw new Error('Delivery manifest entry kind must be file, directory, or archive');
  }

  if (typeof candidate.path !== 'string' || !isSafeDeliveryPath(candidate.path)) {
    throw new Error('Delivery manifest entry path must stay inside .deliveries');
  }

  if (typeof candidate.sourcePath !== 'string' || candidate.sourcePath.length === 0) {
    throw new Error('Delivery manifest entry sourcePath must be a non-empty string');
  }

  if (typeof candidate.packaged !== 'boolean') {
    throw new Error('Delivery manifest entry packaged must be a boolean');
  }

  return {
    kind: candidate.kind,
    path: normalizeManifestPath(candidate.path),
    sourcePath: candidate.sourcePath,
    packaged: candidate.packaged
  };
}

function validatePrimary(
  primary: DeliveryManifest['primary'] | undefined,
  entries: DeliveryManifestEntry[]
): DeliveryManifest['primary'] {
  if (primary === null || primary === undefined) {
    return null;
  }

  if (typeof primary !== 'string' || !isSafeDeliveryPath(primary)) {
    throw new Error('Delivery manifest primary must stay inside .deliveries');
  }

  const normalizedPrimary = normalizeManifestPath(primary);
  if (!entries.some((entry) => entry.path === normalizedPrimary)) {
    throw new Error('Delivery manifest primary must match an existing entry');
  }

  return normalizedPrimary;
}

function isSafeDeliveryPath(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  const normalizedPath = normalizeManifestPath(value);
  if (normalizedPath === '.' || normalizedPath.startsWith('..') || normalizedPath.includes(`..${sep}`)) {
    return false;
  }

  return basename(normalizedPath) !== 'manifest.json';
}

function normalizeManifestPath(value: string): string {
  return normalize(value).replaceAll('\\', '/');
}
