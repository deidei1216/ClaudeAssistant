import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  downloadInboundAttachment,
  extractFileMarkers,
  resolveOutboundAttachment,
  sanitizeAttachmentName
} from '../../src/core/attachments';

describe('attachments utilities', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sanitizes inbound file names into safe local names', () => {
    expect(sanitizeAttachmentName('../contracts/..\\invoice:final?.pdf')).toBe('invoice_final_.pdf');
    expect(sanitizeAttachmentName('')).toBe('attachment');
  });

  it('downloads an inbound attachment into the inbox directory using the provided session key and a collision-safe file name', async () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), 'attachments-root-'));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(Buffer.from('invoice payload'))
      })
    );

    const localPath = await downloadInboundAttachment(rootDirectory, 'discord/channel-1', {
      id: 'att-42',
      name: '../contracts/..\\invoice:final?.pdf',
      url: 'https://cdn.discordapp.com/attachments/att-42'
    });

    expect(localPath).toBe(
      join(realpathSync(rootDirectory), '.claude-gateway', 'inbox', 'discord/channel-1', 'att-42-invoice_final_.pdf')
    );
    expect(readFileSync(localPath, 'utf8')).toBe('invoice payload');
  });

  it('rejects inbound session keys that escape the inbox root', async () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), 'attachments-root-'));
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(
      downloadInboundAttachment(rootDirectory, '../escape', {
        id: 'att-43',
        name: 'invoice.pdf',
        url: 'https://cdn.discordapp.com/attachments/att-43'
      })
    ).rejects.toThrow('Path escapes the inbox root');

    expect(fetch).not.toHaveBeenCalled();
  });

  it('sanitizes attachment ids before building the inbound file path', async () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), 'attachments-root-'));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(Buffer.from('payload'))
      })
    );

    const localPath = await downloadInboundAttachment(rootDirectory, 'discord/channel-1', {
      id: '../att:44',
      name: 'invoice.pdf',
      url: 'https://cdn.discordapp.com/attachments/att-44'
    });

    expect(localPath).toBe(
      join(realpathSync(rootDirectory), '.claude-gateway', 'inbox', 'discord/channel-1', 'att_44-invoice.pdf')
    );
    expect(readFileSync(localPath, 'utf8')).toBe('payload');
  });

  it('extracts file markers only when they appear on their own line and removes them from the content', () => {
    const result = extractFileMarkers(
      'Here is the update.\n[[file:reports/summary.txt]]\nUse `[[file:images/chart.png]]` as an example.'
    );

    expect(result.content).toBe('Here is the update.\n\nUse `[[file:images/chart.png]]` as an example.');
    expect(result.markers).toEqual(['reports/summary.txt']);
  });

  it('does not extract standalone file markers that appear inside fenced code blocks', () => {
    const result = extractFileMarkers(
      'Here is the update.\n```txt\n[[file:reports/summary.txt]]\n```\n[[file:exports/final.txt]]'
    );

    expect(result.content).toBe('Here is the update.\n```txt\n[[file:reports/summary.txt]]\n```\n');
    expect(result.markers).toEqual(['exports/final.txt']);
  });

  it('does not close a longer backtick fence when an inner shorter fence line appears', () => {
    const result = extractFileMarkers(
      '````md\n```txt\n[[file:reports/summary.txt]]\n```\n````\n[[file:exports/final.txt]]'
    );

    expect(result.content).toBe('````md\n```txt\n[[file:reports/summary.txt]]\n```\n````\n');
    expect(result.markers).toEqual(['exports/final.txt']);
  });

  it('does not extract standalone file markers inside tilde fenced code blocks', () => {
    const result = extractFileMarkers(
      '~~~md\n[[file:reports/summary.txt]]\n~~~\n[[file:exports/final.txt]]'
    );

    expect(result.content).toBe('~~~md\n[[file:reports/summary.txt]]\n~~~\n');
    expect(result.markers).toEqual(['exports/final.txt']);
  });

  it('resolves a safe outbound attachment path inside the working directory', () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'attachments-'));

    const result = resolveOutboundAttachment(workingDirectory, 'exports/report.txt');

    expect(result).toEqual({
      ok: true,
      relativePath: 'exports/report.txt',
      absolutePath: join(workingDirectory, 'exports/report.txt')
    });
  });

  it('rejects traversal outside the working directory', () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'attachments-'));

    const result = resolveOutboundAttachment(workingDirectory, '../escape.txt');

    expect(result).toEqual({
      ok: false,
      reason: 'Path escapes the working directory'
    });
  });

  it('rejects an existing subdirectory as an attachment target', () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'attachments-'));
    mkdirSync(join(workingDirectory, 'exports'));

    expect(resolveOutboundAttachment(workingDirectory, 'exports')).toEqual({
      ok: false,
      reason: 'Path points to a directory'
    });
  });

  it('rejects directory-valued outbound paths that resolve back to the working directory', () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'attachments-'));

    expect(resolveOutboundAttachment(workingDirectory, '.')).toEqual({
      ok: false,
      reason: 'Path points to a directory'
    });

    expect(resolveOutboundAttachment(workingDirectory, 'subdir/..')).toEqual({
      ok: false,
      reason: 'Path points to a directory'
    });
  });

  it('rejects outbound paths that escape through a symlinked directory inside the working directory', () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'attachments-'));
    const outsideDirectory = mkdtempSync(join(tmpdir(), 'attachments-outside-'));
    symlinkSync(outsideDirectory, join(workingDirectory, 'exports'));

    const result = resolveOutboundAttachment(workingDirectory, 'exports/report.txt');

    expect(result).toEqual({
      ok: false,
      reason: 'Path escapes the working directory'
    });
  });

  it('rejects absolute outbound paths', () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'attachments-'));

    const result = resolveOutboundAttachment(workingDirectory, '/etc/passwd');

    expect(result).toEqual({
      ok: false,
      reason: 'Absolute outbound paths are not allowed'
    });
  });
});
