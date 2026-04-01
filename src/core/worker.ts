import { statSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { extractFileMarkers, resolveOutboundAttachment } from './attachments';
import { AgentExecutor, AgentMessage, AgentResponse, SessionProfile } from './types';

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
    const args = this.buildArgs(session, message, session.messageCount > 0 ? '--resume' : '--session-id');

    let result = await this.runner('claude', args, { cwd: session.workingDirectory });

    if (this.shouldRetryWithResume(args, result)) {
      const resumeArgs = this.buildArgs(session, message, '--resume');
      result = await this.runner('claude', resumeArgs, { cwd: session.workingDirectory });
      return this.toAgentResponse(result, resumeArgs, session.workingDirectory, message.id);
    }

    return this.toAgentResponse(result, args, session.workingDirectory, message.id);
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
    if (!message.attachments?.length) {
      return message.content;
    }

    const manifest = message.attachments
      .map((attachment) => {
        const location = attachment.localPath && this.isInsideWorkingDirectory(session.workingDirectory, attachment.localPath)
          ? relative(session.workingDirectory, attachment.localPath)
          : attachment.url;
        return `- name: ${attachment.name} | type: ${attachment.type} | size: ${attachment.size} bytes | location: ${location}`;
      })
      .join('\n');

    return [
      message.content,
      '',
      'Attached files:',
      manifest,
      '',
      'If you want Discord to receive a local file, include [[file:relative/path/from-working-directory]] on its own line in your final answer.'
    ].join('\n');
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

  private toAgentResponse(
    result: { stdout: string; stderr: string; exitCode: number },
    args: string[],
    cwd: string,
    replyTo: string
  ): AgentResponse {
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
    const { content, attachments } = this.parseOutboundAttachments(parsed.result?.trim() ?? '', cwd);

    return {
      content,
      attachments: attachments.length > 0 ? attachments : undefined,
      replyTo
    };
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
