import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

interface ClaudeResultPayload {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
  num_turns?: number;
}

export interface FileReturnE2EFixture {
  workingDirectory: string;
  expectedMarker: string;
}

export function getFileReturnStopHookPath(): string {
  return join(process.cwd(), 'skills', 'file-return', 'file-return-stop.ts');
}

export function createFileReturnE2EFixture(rootDirectory: string): FileReturnE2EFixture {
  const workingDirectory = resolve(rootDirectory);
  const outboxDirectory = join(workingDirectory, '.claude-gateway', 'outbox');
  const memoryDirectory = join(workingDirectory, '.claude-gateway', 'memory');
  const relativePath = '.claude-gateway/outbox/demo.txt';
  const absolutePath = join(workingDirectory, relativePath);

  mkdirSync(outboxDirectory, { recursive: true });
  mkdirSync(memoryDirectory, { recursive: true });
  writeFileSync(absolutePath, 'final report');
  writeFileSync(
    join(memoryDirectory, 'recent-files.json'),
    JSON.stringify({
      recentFiles: [
        {
          id: `workspace:${relativePath}`,
          displayName: 'demo.txt',
          relativePath,
          absolutePath,
          source: 'workspace_detected',
          mediaType: 'text/plain',
          lastSeenAt: '2026-04-02T00:00:00.000Z',
          summary: 'generated report'
        }
      ]
    })
  );

  return {
    workingDirectory,
    expectedMarker: `[[file:${relativePath}]]`
  };
}

function runClaudePrint(
  workingDirectory: string,
  prompt: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const hookScriptPath = getFileReturnStopHookPath();
  const settings = JSON.stringify({
    hooks: {
      Stop: [
        {
          hooks: [
            {
              type: 'command',
              command: `npx tsx ${hookScriptPath}`
            }
          ]
        }
      ]
    }
  });

  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      'claude',
      [
        '--print',
        '--output-format',
        'json',
        '--permission-mode',
        'auto',
        '--settings',
        settings,
        '--tools',
        '',
        '--append-system-prompt',
        'Treat the current working directory as an isolated workspace for this validation. Use only files inside the current working directory. If a Stop hook asks you to add a [[file:...]] marker, comply exactly and do not quote file contents.',
        prompt
      ],
      {
        cwd: workingDirectory,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );

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
      resolvePromise({ stdout, stderr, exitCode: exitCode ?? 0 });
    });
  });
}

export function assertFileReturnE2EResult(stdout: string, expectedMarker: string): ClaudeResultPayload {
  const parsed = JSON.parse(stdout) as ClaudeResultPayload;

  if (parsed.is_error) {
    throw new Error(`Claude returned an error result: ${parsed.result ?? 'unknown error'}`);
  }

  if (typeof parsed.result !== 'string') {
    throw new Error('Claude returned a result payload without a string result');
  }

  if (!parsed.result.includes(expectedMarker)) {
    throw new Error(`Expected Claude result to include ${expectedMarker}, got: ${parsed.result}`);
  }

  return parsed;
}

async function main(): Promise<void> {
  const keepTempDirectory = process.argv.includes('--keep-temp');
  const attemptsFlagIndex = process.argv.indexOf('--attempts');
  const attemptCount =
    attemptsFlagIndex >= 0 && process.argv[attemptsFlagIndex + 1]
      ? Number.parseInt(process.argv[attemptsFlagIndex + 1], 10)
      : 3;
  let lastFailure: { workingDirectory: string; error: string } | null = null;

  for (let attempt = 1; attempt <= attemptCount; attempt += 1) {
    const rootDirectory = mkdtempSync(join(tmpdir(), 'file-return-stop-hook-e2e-'));
    const fixture = createFileReturnE2EFixture(rootDirectory);

    try {
      const result = await runClaudePrint(fixture.workingDirectory, '把刚才那个文件直接发给我');

      if (result.exitCode !== 0) {
        throw new Error(`claude exited with status ${result.exitCode}: ${result.stderr || result.stdout}`);
      }

      const parsed = assertFileReturnE2EResult(result.stdout, fixture.expectedMarker);

      process.stdout.write(
        JSON.stringify(
          {
            ok: true,
            attempt,
            workingDirectory: fixture.workingDirectory,
            expectedMarker: fixture.expectedMarker,
            sessionId: parsed.session_id,
            numTurns: parsed.num_turns,
            result: parsed.result
          },
          null,
          2
        )
      );
      if (!keepTempDirectory) {
        rmSync(rootDirectory, { recursive: true, force: true });
      }
      return;
    } catch (error) {
      lastFailure = {
        workingDirectory: fixture.workingDirectory,
        error: error instanceof Error ? error.message : String(error)
      };
      if (!keepTempDirectory && attempt < attemptCount) {
        rmSync(rootDirectory, { recursive: true, force: true });
      }
    }
  }

  process.stderr.write(
    JSON.stringify(
      {
        ok: false,
        attempts: attemptCount,
        workingDirectory: lastFailure?.workingDirectory,
        error: lastFailure?.error ?? 'Unknown e2e failure'
      },
      null,
      2
    )
  );
  process.exitCode = 1;
}

if (require.main === module) {
  void main();
}
