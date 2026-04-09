import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

export function resolveSessionUploadsDirectory(workingDirectory: string): string {
  return join(resolve(workingDirectory), '..', 'uploads');
}

export function resolveWorkspaceUploadsAliasPath(workingDirectory: string): string {
  return join(resolve(workingDirectory), 'uploads');
}

export function toWorkspaceVisibleUploadPath(workingDirectory: string, absolutePath: string): string | null {
  const uploadsDirectory = resolveSessionUploadsDirectory(workingDirectory);
  const resolvedAbsolutePath = resolve(absolutePath);

  if (
    resolvedAbsolutePath !== uploadsDirectory &&
    !resolvedAbsolutePath.startsWith(`${uploadsDirectory}${sep}`)
  ) {
    return null;
  }

  const relativeUploadPath = relative(uploadsDirectory, resolvedAbsolutePath).replace(/\\/g, '/');
  return relativeUploadPath.length > 0 ? `uploads/${relativeUploadPath}` : 'uploads';
}

export function ensureWorkspaceUploadsAlias(workingDirectory: string): void {
  const workspaceDirectory = resolve(workingDirectory);
  const uploadsDirectory = resolveSessionUploadsDirectory(workspaceDirectory);
  const aliasPath = resolveWorkspaceUploadsAliasPath(workspaceDirectory);
  const expectedLinkTarget = '../uploads';

  mkdirSync(uploadsDirectory, { recursive: true });

  if (existsSync(aliasPath)) {
    const aliasStats = lstatSync(aliasPath);
    if (aliasStats.isSymbolicLink() && readlinkSync(aliasPath) === expectedLinkTarget) {
      return;
    }

    rmSync(aliasPath, { recursive: true, force: true });
  }

  symlinkSync(expectedLinkTarget, aliasPath, 'dir');
}
