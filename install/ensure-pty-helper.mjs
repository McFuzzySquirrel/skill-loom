import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function ensurePtyHelper({ platform, arch, packageDirectory }) {
  if (platform !== 'darwin') return;
  const locations = [
    join(packageDirectory, 'build', 'Release'),
    join(packageDirectory, 'build', 'Debug'),
    join(packageDirectory, 'prebuilds', `darwin-${arch}`),
  ];
  let found = false;
  for (const directory of locations) {
    let addon;
    try {
      addon = await lstat(join(directory, 'pty.node'));
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (!addon.isFile() || addon.isSymbolicLink()) {
      throw new Error(`The node-pty addon is not a regular file: ${directory}`);
    }
    found = true;
    const path = join(directory, 'spawn-helper');
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new Error(`The node-pty spawn helper is not a regular file: ${path}`);
      if ((info.mode & 0o100) !== 0) continue;
      if (info.nlink !== 1) {
        throw new Error(`The node-pty spawn helper is hard-linked; install a private copy before changing permissions: ${path}`);
      }
      await handle.chmod(info.mode | 0o100);
    } finally {
      await handle.close();
    }
  }
  if (!found) throw new Error(`No macOS node-pty addon was found for ${arch}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform === 'darwin') {
    const require = createRequire(import.meta.url);
    const packageDirectory = dirname(require.resolve('node-pty/package.json'));
    await ensurePtyHelper({ platform: process.platform, arch: process.arch, packageDirectory });
  }
}
