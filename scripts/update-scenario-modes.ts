import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGitExecutablePaths } from '../src/server/chains/git-file-modes.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../src/server/chains');
const packages = [];
for (const directory of (await readdir(join(root, 'scenario-skills'), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
  if (directory.isFile()) continue;
  if (!directory.isDirectory()) throw new Error('Scenario packages must be regular directories.');
  const packagePath = join(root, 'scenario-skills', directory.name);
  const files: Array<{ path: string; sha256: string }> = [];
  async function visit(path: string, prefix: string): Promise<void> {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relativePath = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await visit(join(path, entry.name), `${relativePath}/`);
      else if (entry.isFile()) files.push({
        path: relativePath,
        sha256: createHash('sha256').update(await readFile(join(path, entry.name))).digest('hex'),
      });
      else throw new Error('Scenario packages cannot contain symbolic links or special files.');
    }
  }
  await visit(packagePath, '');
  const executable = await readGitExecutablePaths(packagePath, files.map((file) => file.path));
  packages.push({
    name: directory.name,
    files: files.map((file) => ({ ...file, executable: executable.has(file.path) })),
  });
}
await writeFile(join(root, 'scenario-skill-modes.json'), `${JSON.stringify({ version: 1, packages }, null, 2)}\n`);
