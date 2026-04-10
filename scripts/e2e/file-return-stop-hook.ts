import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { formatFileMarkers } from '../../core/attachments';
import { buildSessionClaudeMd } from '../../core/session-claude-md';
import { writeDeliveryManifest } from '../../skills/file-return/lib/delivery-manifest';

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
  expectedMarkers: string[];
  forbiddenSnippets?: string[];
  prompt: string;
}

export function getFileReturnStopHookPath(): string {
  return join(process.cwd(), 'skills', 'file-return', 'file-return-stop.ts');
}

export function createFileReturnE2EFixture(rootDirectory: string): FileReturnE2EFixture {
  const workingDirectory = resolve(rootDirectory);
  const deliveriesDirectory = join(workingDirectory, '.deliveries');
  const relativePath = '.deliveries/demo.txt';
  const absolutePath = join(workingDirectory, relativePath);

  mkdirSync(deliveriesDirectory, { recursive: true });
  writeFileSync(join(workingDirectory, 'CLAUDE.md'), buildSessionClaudeMd());
  writeFileSync(absolutePath, 'final report');
  writeDeliveryManifest(workingDirectory, {
    version: 1,
    entries: [
      {
        kind: 'file',
        path: 'demo.txt',
        sourcePath: 'demo.txt',
        packaged: false
      }
    ],
    primary: 'demo.txt'
  });

  return {
    workingDirectory,
    expectedMarkers: formatFileMarkers([relativePath]),
    prompt: '把刚才那个文件直接发给我'
  };
}

export function createMultiFileDirectReturnE2EFixture(rootDirectory: string): FileReturnE2EFixture {
  const workingDirectory = resolve(rootDirectory);
  const deliveriesDirectory = join(workingDirectory, '.deliveries');
  const fileNames = ['crop_左上.png', 'crop_右上.png', 'crop_左下.png', 'crop_右下.png'];

  mkdirSync(deliveriesDirectory, { recursive: true });
  writeFileSync(join(workingDirectory, 'CLAUDE.md'), buildSessionClaudeMd());

  for (const fileName of fileNames) {
    writeFileSync(join(deliveriesDirectory, fileName), `${fileName} bytes`);
  }

  writeDeliveryManifest(workingDirectory, {
    version: 1,
    entries: fileNames.map((fileName) => ({
      kind: 'file' as const,
      path: fileName,
      sourcePath: fileName,
      packaged: false
    })),
    primary: null,
    handoff: fileNames
  });

  return {
    workingDirectory,
    expectedMarkers: formatFileMarkers(fileNames.map((fileName) => `.deliveries/${fileName}`)),
    forbiddenSnippets: ['.zip', ...formatFileMarkers(['.deliveries/4等份裁剪.zip'])],
    prompt: '把这 4 张已发布图片直接发给我，不要压缩包。按 Stop hook 给出的交付 handoff line 原样返回，每个 handoff line 单独占一行。'
  };
}

export function createFileReturnE2ESettings(rootDirectory: string): string {
  const settingsPath = join(resolve(rootDirectory), 'claude-settings.json');
  writeFileSync(
    settingsPath,
    JSON.stringify(
      {
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: 'command',
                  command: `npx tsx ${getFileReturnStopHookPath()}`
                }
              ]
            }
          ]
        }
      },
      null,
      2
    )
  );

  return settingsPath;
}

function runClaudePrint(
  workingDirectory: string,
  prompt: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const settingsPath = createFileReturnE2ESettings(workingDirectory);

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
        settingsPath,
        '--tools',
        '',
        '--append-system-prompt',
        'Treat the current working directory as an isolated workspace for this validation. Use only files inside the current working directory. If a Stop hook gives you a delivery handoff line, copy it exactly on its own line and do not quote file contents.',
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

export function assertFileReturnE2EResult(
  stdout: string,
  expectedMarkers: string[],
  forbiddenSnippets: string[] = []
): ClaudeResultPayload {
  const parsed = JSON.parse(stdout) as ClaudeResultPayload;

  if (parsed.is_error) {
    throw new Error(`Claude returned an error result: ${parsed.result ?? 'unknown error'}`);
  }

  if (typeof parsed.result !== 'string') {
    throw new Error('Claude returned a result payload without a string result');
  }

  for (const expectedMarker of expectedMarkers) {
    if (!parsed.result.includes(expectedMarker)) {
      throw new Error(`Expected Claude result to include ${expectedMarker}, got: ${parsed.result}`);
    }
  }

  for (const forbiddenSnippet of forbiddenSnippets) {
    if (parsed.result.includes(forbiddenSnippet)) {
      throw new Error(`Expected Claude result not to include ${forbiddenSnippet}, got: ${parsed.result}`);
    }
  }

  return parsed;
}

async function main(): Promise<void> {
  const keepTempDirectory = process.argv.includes('--keep-temp');
  const scenarioFlagIndex = process.argv.indexOf('--scenario');
  const scenario = scenarioFlagIndex >= 0 && process.argv[scenarioFlagIndex + 1]
    ? process.argv[scenarioFlagIndex + 1]
    : 'single-file';
  const attemptsFlagIndex = process.argv.indexOf('--attempts');
  const attemptCount =
    attemptsFlagIndex >= 0 && process.argv[attemptsFlagIndex + 1]
      ? Number.parseInt(process.argv[attemptsFlagIndex + 1], 10)
      : 3;
  let lastFailure: { workingDirectory: string; error: string } | null = null;

  for (let attempt = 1; attempt <= attemptCount; attempt += 1) {
    const rootDirectory = mkdtempSync(join(tmpdir(), 'file-return-stop-hook-e2e-'));
    const fixture = scenario === 'multi-file-direct'
      ? createMultiFileDirectReturnE2EFixture(rootDirectory)
      : createFileReturnE2EFixture(rootDirectory);

    try {
      const result = await runClaudePrint(fixture.workingDirectory, fixture.prompt);

      if (result.exitCode !== 0) {
        throw new Error(`claude exited with status ${result.exitCode}: ${result.stderr || result.stdout}`);
      }

      const parsed = assertFileReturnE2EResult(
        result.stdout,
        fixture.expectedMarkers,
        fixture.forbiddenSnippets
      );

      process.stdout.write(
        JSON.stringify(
          {
            ok: true,
            attempt,
            scenario,
            workingDirectory: fixture.workingDirectory,
            expectedMarkers: fixture.expectedMarkers,
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
