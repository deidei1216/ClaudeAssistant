import { existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { isWithinPublishedDeliveriesBoundary } from './delivery-paths';

const INVALID_FILE_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const MARKER_PATTERN = /^[\t ]*\[\[file:([^\]\r\n]+)\]\][\t ]*$/;
const FENCE_PATTERN = /^[\t ]*(([`~])\2{2,})/;

function isInsideWorkingDirectory(workingDirectory: string, candidatePath: string): boolean {
  return candidatePath === workingDirectory || candidatePath.startsWith(`${workingDirectory}${sep}`);
}

export function sanitizeAttachmentName(name: string): string {
  const fileName = basename(name)
    .replace(INVALID_FILE_NAME_CHARS, '_')
    .replace(/^[._]+/, '')
    .trim();
  return fileName.length > 0 ? fileName : 'attachment';
}

interface InboundAttachmentDownload {
  id: string;
  name: string;
  url: string;
}

interface InboundAttachmentBufferSave {
  id: string;
  name: string;
  data: Buffer;
}

function resolveInboundInboxTarget(rootDirectory: string, sessionKey: string): string {
  const inboxRoot = join(realpathSync(resolve(rootDirectory)), '.claude-gateway', 'inbox');
  const targetDirectory = normalize(resolve(inboxRoot, sessionKey));

  if (!isInsideWorkingDirectory(inboxRoot, targetDirectory)) {
    throw new Error('Path escapes the inbox root');
  }

  let currentPath = inboxRoot;
  const segments = normalize(sessionKey).split(sep).filter(Boolean);
  for (const segment of segments) {
    currentPath = resolve(currentPath, segment);

    if (!existsSync(currentPath)) {
      break;
    }

    const realCurrentPath = realpathSync(currentPath);
    if (!isInsideWorkingDirectory(inboxRoot, realCurrentPath)) {
      throw new Error('Path escapes the inbox root');
    }

    currentPath = realCurrentPath;
  }

  return targetDirectory;
}

export async function downloadInboundAttachment(
  rootDirectory: string,
  sessionKey: string,
  attachment: InboundAttachmentDownload
): Promise<string> {
  const safeAttachmentId = sanitizeAttachmentName(attachment.id);
  const safeFileName = sanitizeAttachmentName(attachment.name);
  const targetDirectory = resolveInboundInboxTarget(rootDirectory, sessionKey);
  const targetPath = join(targetDirectory, `${safeAttachmentId}-${safeFileName}`);

  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error(`Failed to download inbound attachment ${attachment.id}: ${response.status}`);
  }

  mkdirSync(targetDirectory, { recursive: true });
  writeFileSync(targetPath, Buffer.from(await response.arrayBuffer()));

  return targetPath;
}

export function saveInboundAttachment(
  rootDirectory: string,
  sessionKey: string,
  attachment: InboundAttachmentBufferSave
): string {
  const safeAttachmentId = sanitizeAttachmentName(attachment.id);
  const safeFileName = sanitizeAttachmentName(attachment.name);
  const targetDirectory = resolveInboundInboxTarget(rootDirectory, sessionKey);
  const targetPath = join(targetDirectory, `${safeAttachmentId}-${safeFileName}`);

  mkdirSync(targetDirectory, { recursive: true });
  writeFileSync(targetPath, attachment.data);

  return targetPath;
}

export function extractFileMarkers(content: string): { content: string; markers: string[] } {
  const markers: string[] = [];
  let activeFence: { char: '`' | '~'; length: number } | null = null;

  const stripped = content
    .split('\n')
    .map((line) => {
      const fenceMatch = line.match(FENCE_PATTERN);
      if (fenceMatch) {
        const fenceLength = fenceMatch[1].length;
        const fenceChar = fenceMatch[2] as '`' | '~';
        if (!activeFence) {
          activeFence = { char: fenceChar, length: fenceLength };
        } else if (activeFence.char === fenceChar && fenceLength >= activeFence.length) {
          activeFence = null;
        }
        return line;
      }

      if (activeFence) {
        return line;
      }

      const match = line.match(MARKER_PATTERN);
      if (!match) {
        return line;
      }

      markers.push(match[1].trim());
      return '';
    })
    .join('\n');

  return {
    content: stripped,
    markers
  };
}

export function formatFileMarker(relativePath: string): string {
  return `[[file:${relativePath}]]`;
}

export function formatFileMarkers(relativePaths: string[]): string[] {
  return relativePaths.map((relativePath) => formatFileMarker(relativePath));
}

export function resolveOutboundAttachment(
  workingDirectory: string,
  relativePath: string
):
  | { ok: true; relativePath: string; absolutePath: string }
  | { ok: false; reason: string } {
  const lexicalWorkingDirectory = resolve(workingDirectory);
  const normalizedRelativePath = normalizeOutboundAttachmentPath(relativePath);
  const absolutePath = isAbsolute(normalizedRelativePath) || /^[a-zA-Z]:[\\/]/.test(normalizedRelativePath)
    ? normalize(resolve(normalizedRelativePath))
    : normalize(resolve(lexicalWorkingDirectory, normalizedRelativePath));

  if (!isWithinPublishedDeliveriesBoundary(workingDirectory, absolutePath)) {
    return { ok: false, reason: 'Path is outside the published deliveries boundary' };
  }

  if (absolutePath === lexicalWorkingDirectory) {
    return { ok: false, reason: 'Path points to a directory' };
  }

  if (existsSync(absolutePath) && statSync(absolutePath).isDirectory()) {
    return { ok: false, reason: 'Path points to a directory' };
  }

  return {
    ok: true,
    relativePath: relative(lexicalWorkingDirectory, absolutePath).replace(/\\/g, '/'),
    absolutePath
  };
}

function normalizeOutboundAttachmentPath(relativePath: string): string {
  const normalizedPath = relativePath.replace(/\\/g, '/');

  if (normalizedPath === 'workspace') {
    return '.';
  }

  if (normalizedPath.startsWith('workspace/')) {
    return normalizedPath.slice('workspace/'.length);
  }

  return relativePath;
}
