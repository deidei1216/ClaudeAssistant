export function buildSessionClaudeMd(): string {
  const projectRoot = resolveProjectRoot();
  const publishFileCommand = `npx tsx "${projectRoot}/scripts/delivery/publish-file.ts" <source> [displayName]`;
  const publishDirCommand = `npx tsx "${projectRoot}/scripts/delivery/publish-dir.ts" <sourceDir> [name]`;
  const packageDeliveryCommand = `npx tsx "${projectRoot}/scripts/delivery/package-delivery.ts" <sourcePath> [outputName]`;

  return `# Session Contract

## File Delivery Contract

uploads/ is a read-only source directory for user-provided files.
workspace/ is your free-form work area.
Every Bash command starts in workspace/.
User-uploaded source files are available from workspace as uploads/... .
Do not assume that cd from one Bash command persists into the next command.
Only content published into workspace/.deliveries/ is allowed to be returned to the user.
Do not write files into workspace/.deliveries/ manually.
Copying a file into workspace/.deliveries/ without updating the manifest does not count as publishing.
If a task should return one file, run: ${publishFileCommand}
If a task should return a directory, run: ${publishDirCommand}
If a task should return multiple related files as an archive, you can run: ${packageDeliveryCommand}
If a published primary delivery is a directory, the Stop hook may package it into an archive before asking for the final [[file:...]] marker.
If a task should return files, call a publish script before your final answer. Use package-delivery when you need to choose the archive contents explicitly.
For a small set of standalone files that can be viewed directly in chat, publish each file separately and return multiple [[file:...]] markers, one per line.
Do not create or mention a zip archive when direct file attachments are practical, unless the user explicitly asks for an archive.
package-delivery only accepts a previously published entry from workspace/.deliveries/, usually a directory published with publish-dir.
When returning a published file, your final answer must include the exact published path under .deliveries/, for example [[file:.deliveries/example.png]].
Do not use bare filenames like [[file:example.png]] or workspace-prefixed paths like [[file:workspace/.deliveries/example.png]].
If the Stop hook gives you an exact [[file:...]] marker to use, copy that marker verbatim and replace any incorrect file marker with it.
Do not return files directly from uploads/, the session root, or arbitrary workspace paths.
`;
}

function resolveProjectRoot(): string {
  const { existsSync } = require('node:fs') as typeof import('node:fs');
  const { dirname, join, resolve } = require('node:path') as typeof import('node:path');

  let currentDirectory = resolve(__dirname, '..');

  while (true) {
    if (
      existsSync(join(currentDirectory, 'package.json')) &&
      existsSync(join(currentDirectory, 'scripts', 'delivery', 'publish-file.ts'))
    ) {
      return currentDirectory;
    }

    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return process.cwd();
    }

    currentDirectory = parentDirectory;
  }
}
