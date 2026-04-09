import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readDeliveryManifest } from './delivery-manifest';
import { ResolveArtifactsInput, ResolveArtifactsResult } from './contracts';
import { packageDelivery } from '../../../scripts/delivery/package-delivery';

export async function resolveArtifacts(
  input: ResolveArtifactsInput
): Promise<ResolveArtifactsResult> {
  const manifest = readDeliveryManifest(input.cwd);

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
