import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WINDOWS_AGENT_HASH = '8636d16b38266112204061a22b135734177c242837982fd3a4055be726efa64a';
const WINDOWS_CLEANUP = [
  '        this._inSocket.readable = false;',
  '        this._outSocket.readable = false;',
  '        this._outSocket.destroy();',
].join('\n');
const WINDOWS_CLEANUP_FIXED = [
  '        this._inSocket.readable = false;',
  '        this._outSocket.readable = false;',
  '        this._inSocket.destroy();',
  '        this._conoutSocketWorker.dispose();',
  '        this._outSocket.destroy();',
].join('\n');

async function ensureWindowsPtyCleanup(packageDirectory) {
  const root = await realpath(packageDirectory);
  const directory = join(root, 'lib');
  if (await realpath(directory) !== directory) throw new Error('The node-pty lib directory must not be a symbolic link.');
  const path = join(directory, 'windowsPtyAgent.js');
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 64 * 1024) {
    throw new Error('The node-pty Windows agent must be a bounded, private regular file.');
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes;
  try {
    const info = await handle.stat();
    if (info.dev !== before.dev || info.ino !== before.ino || info.size !== before.size ||
        info.mtimeMs !== before.mtimeMs || info.ctimeMs !== before.ctimeMs) {
      throw new Error('The node-pty Windows agent changed during inspection.');
    }
    bytes = await handle.readFile();
  } finally { await handle.close(); }
  const source = bytes.toString('utf8');
  const original = source.replace(WINDOWS_CLEANUP_FIXED, WINDOWS_CLEANUP);
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  if (hash(original) !== WINDOWS_AGENT_HASH) {
    throw new Error('Unsupported node-pty Windows agent bytes; review the natural-exit cleanup compatibility patch before updating node-pty.');
  }
  if (source !== original) return;
  if (source.split(WINDOWS_CLEANUP).length !== 2) throw new Error('Unexpected node-pty Windows cleanup implementation.');
  const fixed = source.replace(WINDOWS_CLEANUP, WINDOWS_CLEANUP_FIXED);
  const temporary = join(directory, `.loom-pty-${randomUUID()}.tmp`);
  try {
    const output = await open(temporary, 'wx', before.mode & 0o777);
    try {
      await output.writeFile(fixed);
      await output.sync();
    } finally { await output.close(); }
    const current = await lstat(path);
    if (current.dev !== before.dev || current.ino !== before.ino || current.size !== before.size ||
        current.mtimeMs !== before.mtimeMs || current.ctimeMs !== before.ctimeMs || current.nlink !== 1) {
      throw new Error('The node-pty Windows agent changed before patch publication.');
    }
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
  }
}

export async function ensurePtyHelper({ platform, arch, packageDirectory }) {
  if (platform === 'win32') {
    // node-pty 1.1.0 drains natural exit output but retains its input pipe and
    // conout worker. Dispose those resources, without killing by a stale PID.
    await ensureWindowsPtyCleanup(packageDirectory);
    return;
  }
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
  if (process.platform === 'darwin' || process.platform === 'win32') {
    const require = createRequire(import.meta.url);
    const packageDirectory = dirname(require.resolve('node-pty/package.json'));
    await ensurePtyHelper({ platform: process.platform, arch: process.arch, packageDirectory });
  }
}
