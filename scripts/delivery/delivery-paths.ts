import { basename, normalize } from 'node:path';

export function validateDeliveryRelativePath(value: string, label: string): string {
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    throw new Error(`${label} must stay inside .deliveries`);
  }

  const normalizedValue = normalize(trimmedValue).replaceAll('\\', '/');

  if (
    normalizedValue === '.' ||
    normalizedValue.startsWith('../') ||
    normalizedValue === '..' ||
    normalizedValue.includes('/../') ||
    normalizedValue.startsWith('/')
  ) {
    throw new Error(`${label} must stay inside .deliveries`);
  }

  if (basename(normalizedValue) === 'manifest.json') {
    throw new Error(`${label} must stay inside .deliveries`);
  }

  return normalizedValue;
}

export function isCliFlag(value: string | undefined): boolean {
  return value === '--primary' || value === '--no-primary';
}

export function normalizeWorkspaceInputPath(value: string): string {
  const normalizedValue = value.replaceAll('\\', '/');

  if (normalizedValue === 'workspace') {
    return '.';
  }

  if (normalizedValue.startsWith('./workspace/')) {
    return normalizedValue.slice('./workspace/'.length);
  }

  if (normalizedValue.startsWith('workspace/')) {
    return normalizedValue.slice('workspace/'.length);
  }

  return value;
}
