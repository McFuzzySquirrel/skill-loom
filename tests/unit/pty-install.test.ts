import { link, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensurePtyHelper } from '../../install/ensure-pty-helper.mjs';

let root = '';

afterEach(async () => {
  if (root !== '') await rm(root, { recursive: true, force: true });
  root = '';
});

async function fixture() {
  root = await realpath(await mkdtemp(join(tmpdir(), 'loom-pty-install-')));
  const directory = join(root, 'prebuilds', 'darwin-arm64');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'pty.node'), 'addon');
  return { directory, helper: join(directory, 'spawn-helper') };
}

describe.skipIf(process.platform === 'win32')('macOS PTY installation', () => {
  it('sets only owner execute permission on the installed helper', async () => {
    const { helper } = await fixture();
    await writeFile(helper, 'helper', { mode: 0o640 });
    await ensurePtyHelper({ platform: 'darwin', arch: 'arm64', packageDirectory: root });
    expect((await lstat(helper)).mode & 0o777).toBe(0o740);
    expect(await readFile(helper, 'utf8')).toBe('helper');
    await ensurePtyHelper({ platform: 'darwin', arch: 'arm64', packageDirectory: root });
    expect((await lstat(helper)).mode & 0o777).toBe(0o740);
  });

  it('does not modify dependencies on Windows', async () => {
    await expect(ensurePtyHelper({ platform: 'win32', arch: process.arch, packageDirectory: 'unused' }))
      .resolves.toBeUndefined();
  });

  it('rejects symlinked and hard-linked helpers rather than modifying another file', async () => {
    const { helper } = await fixture();
    const target = join(root, 'target');
    await writeFile(target, 'target', { mode: 0o600 });
    await symlink(target, helper);
    await expect(ensurePtyHelper({ platform: 'darwin', arch: 'arm64', packageDirectory: root })).rejects.toThrow();
    await rm(helper);
    await link(target, helper);
    await expect(ensurePtyHelper({ platform: 'darwin', arch: 'arm64', packageDirectory: root })).rejects.toThrow('hard-linked');
    expect((await lstat(target)).mode & 0o777).toBe(0o600);
  });

  it('fails explicitly when the macOS addon or helper is missing', async () => {
    await fixture();
    await expect(ensurePtyHelper({ platform: 'darwin', arch: 'arm64', packageDirectory: root })).rejects.toThrow();
    await expect(ensurePtyHelper({ platform: 'darwin', arch: 'x64', packageDirectory: root })).rejects.toThrow('No macOS');
    await expect(ensurePtyHelper({ platform: 'linux', arch: 'x64', packageDirectory: root })).resolves.toBeUndefined();
  });
});
