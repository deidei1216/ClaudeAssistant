import { spawn } from 'node:child_process';
import { AgentExecutor, AgentMessage, AgentResponse, SessionProfile } from './types';

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
    const args = ['--print'];
    const sessionFlag = session.messageCount > 0 ? '--resume' : '--session-id';

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

    args.push(message.content);

    const result = await this.runner('claude', args, { cwd: session.workingDirectory });

    if (result.exitCode !== 0) {
      throw new ClaudeExecutionError(result.stderr || `claude exited with status ${result.exitCode}`, {
        args,
        cwd: session.workingDirectory,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr
      });
    }

    return {
      content: result.stdout.trim(),
      replyTo: message.id
    };
  }
}
