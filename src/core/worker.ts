import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { extractFileMarkers, resolveOutboundAttachment } from './attachments';
import { createRecentFileRecord } from './recent-files';
import { AgentExecutor, AgentMessage, AgentResponse, RecentFileRecord, SessionProfile } from './types';

const TRACKED_OUTPUT_EXTENSIONS = new Set([
  '.csv',
  '.doc',
  '.docx',
  '.gif',
  '.htm',
  '.html',
  '.json',
  '.jpeg',
  '.jpg',
  '.md',
  '.pdf',
  '.png',
  '.ppt',
  '.pptx',
  '.txt',
  '.webp',
  '.xlsx',
  '.yaml',
  '.yml'
]);
const OUTPUT_PATH_PATTERN = /(?:^|[\s(])([A-Za-z0-9._/-]+\.(?:csv|doc|docx|gif|htm|html|json|jpeg|jpg|md|pdf|png|ppt|pptx|txt|webp|xlsx|yaml|yml))(?:$|[\s).,:])/gm;

type WorkspaceSnapshot = Map<string, number>;

interface ClaudePrintResult {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
}

export class ClaudeExecutionError extends Error {
  constructor(
    message: string,
    readonly details: {
      args: string[];
      cwd: string;
      exitCode: number;
      stdout: string;
      stderr: string;
    }
  ) {
    super(message);
    this.name = 'ClaudeExecutionError';
  }
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string }
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

function defaultRunner(
  command: string,
  args: string[],
  options: { cwd: string }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 0 });
    });
  });
}

export class ClaudeCodeWorker implements AgentExecutor {
  constructor(private readonly runner: CommandRunner = defaultRunner) {}

  async execute(session: SessionProfile, message: AgentMessage): Promise<AgentResponse> {
    const snapshotBeforeRun = this.snapshotWorkspaceOutputs(session.workingDirectory);
    const args = this.buildArgs(session, message, session.messageCount > 0 ? '--resume' : '--session-id');

    let result = await this.runner('claude', args, { cwd: session.workingDirectory });

    if (this.shouldRetryWithResume(args, result)) {
      const resumeArgs = this.buildArgs(session, message, '--resume');
      result = await this.runner('claude', resumeArgs, { cwd: session.workingDirectory });
      return this.toAgentResponse(result, resumeArgs, session.workingDirectory, message.id, snapshotBeforeRun);
    }

    return this.toAgentResponse(result, args, session.workingDirectory, message.id, snapshotBeforeRun);
  }

  private buildArgs(session: SessionProfile, message: AgentMessage, sessionFlag: '--resume' | '--session-id'): string[] {
    const args = ['--print', '--output-format', 'json'];
    args.push(sessionFlag, session.id, '--model', session.model, '--permission-mode', session.permissionMode);

    if (session.settingsPath) {
      args.push('--settings', session.settingsPath);
    }

    if (session.allowedTools?.length) {
      args.push('--allowedTools', ...session.allowedTools);
    }

    if (session.deniedTools?.length) {
      args.push('--disallowedTools', ...session.deniedTools);
    }

    if (session.customSystemPrompt) {
      args.push('--append-system-prompt', session.customSystemPrompt);
    }

    args.push(this.buildPrompt(session, message));
    return args;
  }

  private buildPrompt(session: SessionProfile, message: AgentMessage): string {
    const sections = [message.content];

    if (message.attachments?.length) {
      const manifest = message.attachments
        .map((attachment) => {
          const location = attachment.localPath && this.isInsideWorkingDirectory(session.workingDirectory, attachment.localPath)
            ? relative(session.workingDirectory, attachment.localPath)
            : attachment.url;
          return `- name: ${attachment.name} | type: ${attachment.type} | size: ${attachment.size} bytes | location: ${location}`;
        })
        .join('\n');

      sections.push('', 'Attached files:', manifest);
    }

    return sections.join('\n');
  }

  private isInsideWorkingDirectory(workingDirectory: string, candidatePath: string): boolean {
    const absoluteWorkingDirectory = resolve(workingDirectory);
    const absoluteCandidatePath = resolve(candidatePath);

    return (
      absoluteCandidatePath === absoluteWorkingDirectory ||
      absoluteCandidatePath.startsWith(`${absoluteWorkingDirectory}${sep}`)
    );
  }

  private shouldRetryWithResume(
    args: string[],
    result: { stdout: string; stderr: string; exitCode: number }
  ): boolean {
    return args.includes('--session-id') && result.exitCode !== 0 && result.stderr.toLowerCase().includes('already in use');
  }

  private async toAgentResponse(
    result: { stdout: string; stderr: string; exitCode: number },
    args: string[],
    cwd: string,
    replyTo: string,
    snapshotBeforeRun: WorkspaceSnapshot
  ): Promise<AgentResponse> {
    if (result.exitCode !== 0) {
      throw new ClaudeExecutionError(result.stderr || `claude exited with status ${result.exitCode}`, {
        args,
        cwd,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr
      });
    }

    const parsed = this.parseClaudeOutput(result.stdout, args, cwd);
    const { content, attachments = [] } = this.parseOutboundAttachments(parsed.result?.trim() ?? '', cwd);

    const recentFileCandidates = this.detectWorkspaceArtifacts(cwd, content, snapshotBeforeRun);

    return {
      content,
      attachments: attachments.length > 0 ? attachments : undefined,
      replyTo,
      metadata: recentFileCandidates.length > 0 ? { recentFileCandidates } : undefined
    };
  }

  private snapshotWorkspaceOutputs(workingDirectory: string, currentDirectory = workingDirectory, entries: WorkspaceSnapshot = new Map()): WorkspaceSnapshot {
    if (!existsSync(currentDirectory)) {
      return entries;
    }

    for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') {
        continue;
      }

      const absolutePath = join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        this.snapshotWorkspaceOutputs(workingDirectory, absolutePath, entries);
        continue;
      }

      const fileExtension = absolutePath.slice(absolutePath.lastIndexOf('.')).toLowerCase();
      if (!TRACKED_OUTPUT_EXTENSIONS.has(fileExtension)) {
        continue;
      }

      entries.set(relative(workingDirectory, absolutePath).replace(/\\/g, '/'), statSync(absolutePath).mtimeMs);
    }

    return entries;
  }

  private detectWorkspaceArtifacts(
    workingDirectory: string,
    content: string,
    snapshotBeforeRun: WorkspaceSnapshot
  ): RecentFileRecord[] {
    const snapshotAfterRun = this.snapshotWorkspaceOutputs(workingDirectory);
    const referencedPaths = new Set(Array.from(content.matchAll(OUTPUT_PATH_PATTERN), (match) => match[1]));

    return Array.from(snapshotAfterRun.entries())
      .filter(([relativePath, mtimeMs]) => referencedPaths.has(relativePath) && (snapshotBeforeRun.get(relativePath) ?? -1) !== mtimeMs)
      .map(([relativePath]) =>
        createRecentFileRecord({
          id: `workspace:${relativePath}`,
          workingDirectory,
          absolutePath: join(workingDirectory, relativePath),
          displayName: basename(relativePath),
          source: 'workspace_detected',
          mediaType: 'application/octet-stream',
          lastSeenAt: new Date()
        })
      );
  }

  private parseOutboundAttachments(content: string, workingDirectory: string): Pick<AgentResponse, 'content' | 'attachments'> {
    const { content: strippedContent, markers } = extractFileMarkers(content);
    const attachments: NonNullable<AgentResponse['attachments']> = [];
    const errors: string[] = [];

    for (const marker of markers) {
      const resolved = resolveOutboundAttachment(workingDirectory, marker);
      if (!resolved.ok) {
        errors.push(`Could not attach ${marker}: ${resolved.reason}.`);
        continue;
      }

      try {
        const fileStat = statSync(resolved.absolutePath);
        if (!fileStat.isFile()) {
          errors.push(`Could not attach ${marker}: Path points to a directory.`);
          continue;
        }

        attachments.push({
          id: `outbound:${resolved.relativePath}`,
          name: basename(resolved.absolutePath),
          type: 'application/octet-stream',
          size: fileStat.size,
          url: resolved.absolutePath,
          localPath: resolved.absolutePath
        });
      } catch {
        errors.push(`Could not attach ${marker}: File does not exist.`);
      }
    }

    const visibleContent = [strippedContent.trim(), ...errors].filter(Boolean).join('\n\n');

    return {
      content: visibleContent,
      attachments
    };
  }

  private parseClaudeOutput(stdout: string, args: string[], cwd: string): ClaudePrintResult {
    try {
      const parsed = JSON.parse(stdout) as ClaudePrintResult;
      if (typeof parsed.result !== 'string') {
        throw new ClaudeExecutionError('Claude returned an invalid result payload', {
          args,
          cwd,
          exitCode: 0,
          stdout,
          stderr: `Unexpected result type: ${parsed.result === undefined ? 'missing' : typeof parsed.result}`
        });
      }
      return parsed;
    } catch (error) {
      if (error instanceof ClaudeExecutionError) {
        throw error;
      }

      throw new ClaudeExecutionError('Claude returned invalid JSON output', {
        args,
        cwd,
        exitCode: 0,
        stdout,
        stderr: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
