import { existsSync, lstatSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readDeliveryManifest } from './delivery-manifest';
import { ResolveArtifactsInput, ResolveArtifactsResult } from './contracts';
import { packageDelivery } from '../../../scripts/delivery/package-delivery';

const BATCH_FILE_WINDOW_SECONDS = 5;

export async function resolveArtifacts(
  input: ResolveArtifactsInput
): Promise<ResolveArtifactsResult> {
  const manifest = readDeliveryManifest(input.cwd);

  if (manifest.handoff?.length) {
    const handoffFiles = manifest.handoff.map((path) => resolvePublishedFile(input.cwd, manifest.entries, path));
    if (handoffFiles.some((path) => !path)) {
      return {
        mode: 'invalid_delivery_state',
        files: []
      };
    }

    return {
      mode: 'direct',
      files: handoffFiles.filter((path): path is string => Boolean(path))
    };
  }

  if (!manifest.primary) {
    if (deliveriesContainUnmanagedArtifacts(input.cwd, manifest.entries.map((entry) => entry.path))) {
      return {
        mode: 'orphaned_delivery',
        files: []
      };
    }

    return {
      mode: 'none',
      files: []
    };
  }

  const primaryEntry = manifest.entries.find((entry) => entry.path === manifest.primary);
  if (!primaryEntry) {
    return {
      mode: 'invalid_delivery_state',
      files: []
    };
  }

  if (primaryEntry.kind === 'directory') {
    const absoluteDirectoryPath = join(input.cwd, '.deliveries', primaryEntry.path);
    if (!existsSync(absoluteDirectoryPath)) {
      return {
        mode: 'invalid_delivery_state',
        files: []
      };
    }

    try {
      if (!lstatSync(absoluteDirectoryPath).isDirectory()) {
        return {
          mode: 'invalid_delivery_state',
          files: []
        };
      }
    } catch {
      return {
        mode: 'invalid_delivery_state',
        files: []
      };
    }

    try {
      const packaged = await packageDelivery({
        cwd: input.cwd,
        sourcePath: primaryEntry.path
      });

      return {
        mode: 'direct',
        files: [`.deliveries/${packaged.publishedRelativePath}`]
      };
    } catch {
      return {
        mode: 'invalid_delivery_state',
        files: []
      };
    }
  }

  const inferredBatchFiles = inferDirectFileBatch(input.cwd, manifest.entries, primaryEntry.path);
  if (inferredBatchFiles.length > 1) {
    return {
      mode: 'direct',
      files: inferredBatchFiles.map((path) => `.deliveries/${path}`)
    };
  }

  const absolutePrimaryPath = join(input.cwd, '.deliveries', primaryEntry.path);
  if (!existsSync(absolutePrimaryPath)) {
    return {
      mode: 'invalid_delivery_state',
      files: []
    };
  }

  try {
    if (!lstatSync(absolutePrimaryPath).isFile()) {
      return {
        mode: 'invalid_delivery_state',
        files: []
      };
    }
  } catch {
    return {
      mode: 'invalid_delivery_state',
      files: []
    };
  }

  return {
    mode: 'direct',
    files: [`.deliveries/${primaryEntry.path}`]
  };
}

function resolvePublishedFile(
  workingDirectory: string,
  entries: ReturnType<typeof readDeliveryManifest>['entries'],
  entryPath: string
): string | null {
  const entry = entries.find((candidate) => candidate.path === entryPath);
  if (!entry || entry.kind === 'directory') {
    return null;
  }

  const absolutePath = join(workingDirectory, '.deliveries', entry.path);
  if (!existsSync(absolutePath)) {
    return null;
  }

  try {
    if (!lstatSync(absolutePath).isFile()) {
      return null;
    }
  } catch {
    return null;
  }

  return `.deliveries/${entry.path}`;
}

function inferDirectFileBatch(
  workingDirectory: string,
  entries: ReturnType<typeof readDeliveryManifest>['entries'],
  primaryPath: string
): string[] {
  const fileEntries = entries.filter((entry) => entry.kind === 'file');
  if (fileEntries.length <= 1) {
    return [];
  }

  const primaryEntry = fileEntries.find((entry) => entry.path === primaryPath);
  if (!primaryEntry) {
    return [];
  }

  const primaryAbsolutePath = join(workingDirectory, '.deliveries', primaryEntry.path);
  if (!existsSync(primaryAbsolutePath)) {
    return [];
  }

  let primaryMtimeSeconds: number;
  try {
    if (!lstatSync(primaryAbsolutePath).isFile()) {
      return [];
    }
    primaryMtimeSeconds = Math.floor(statSync(primaryAbsolutePath).mtimeMs / 1000);
  } catch {
    return [];
  }

  const batch = fileEntries.filter((entry) => {
    const absolutePath = join(workingDirectory, '.deliveries', entry.path);
    if (!existsSync(absolutePath)) {
      return false;
    }

    try {
      if (!lstatSync(absolutePath).isFile()) {
        return false;
      }

      const entryMtimeSeconds = Math.floor(statSync(absolutePath).mtimeMs / 1000);
      return Math.abs(primaryMtimeSeconds - entryMtimeSeconds) <= BATCH_FILE_WINDOW_SECONDS;
    } catch {
      return false;
    }
  });

  return batch.length > 1 ? batch.map((entry) => entry.path) : [];
}

function deliveriesContainUnmanagedArtifacts(workingDirectory: string, managedPaths: string[]): boolean {
  const deliveriesRoot = join(workingDirectory, '.deliveries');
  if (!existsSync(deliveriesRoot)) {
    return false;
  }

  try {
    const managedTopLevelEntries = new Set(
      managedPaths
        .map((entry) => entry.split('/')[0])
        .filter((entry) => entry.length > 0)
    );

    return readdirSync(deliveriesRoot).some((entry) => entry !== 'manifest.json' && !managedTopLevelEntries.has(entry));
  } catch {
    return false;
  }
}
