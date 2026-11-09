import { link, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
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

  it('does not modify dependencies on Linux', async () => {
    await expect(ensurePtyHelper({ platform: 'linux', arch: process.arch, packageDirectory: 'unused' }))
      .resolves.toBeUndefined();
  });

  describe('Windows PTY installation', () => {
    async function windowsFixture() {
      root = await realpath(await mkdtemp(join(tmpdir(), 'loom-pty-windows-install-')));
      const directory = join(root, 'lib');
      await mkdir(directory);
      const require = createRequire(import.meta.url);
      const installed = join(dirname(require.resolve('node-pty/package.json')), 'lib/windowsPtyAgent.js');
      // Windows npm postinstall may already have applied this exact compatibility fix.
      const source = (await readFile(installed, 'utf8')).replace(
        '        this._inSocket.destroy();\n        this._conoutSocketWorker.dispose();\n        this._outSocket.destroy();',
        '        this._outSocket.destroy();',
      );
      const path = join(directory, 'windowsPtyAgent.js');
      await writeFile(path, source);
      return { path, source };
    }

    it('releases the natural-exit worker and input pipe without terminating processes', async () => {
      const { path, source } = await windowsFixture();
      await ensurePtyHelper({ platform: 'win32', arch: process.arch, packageDirectory: root });
      const fixed = await readFile(path, 'utf8');
      expect(fixed).not.toBe(source);
      const exported: { WindowsPtyAgent?: { prototype: { _cleanUpProcess: (this: unknown) => void } } } = {};
      runInNewContext(fixed, { exports: exported, require: () => ({}), setTimeout, clearTimeout, console });
      const calls: string[] = [];
      exported.WindowsPtyAgent!.prototype._cleanUpProcess.call({
        _useConptyDll: false,
        _inSocket: { readable: true, destroy() { calls.push('input'); } },
        _outSocket: { readable: true, destroy() { calls.push('output'); } },
        _conoutSocketWorker: { dispose() { calls.push('worker'); } },
      });
      expect(calls).toEqual(['input', 'worker', 'output']);
      await ensurePtyHelper({ platform: 'win32', arch: process.arch, packageDirectory: root });
      expect(await readFile(path, 'utf8')).toBe(fixed);
    });

    it('refuses unknown dependency bytes without overwriting them', async () => {
      const { path } = await windowsFixture();
      await writeFile(path, 'unexpected upstream release');
      await expect(ensurePtyHelper({ platform: 'win32', arch: process.arch, packageDirectory: root }))
        .rejects.toThrow('Unsupported node-pty');
      expect(await readFile(path, 'utf8')).toBe('unexpected upstream release');
    });

    it('rejects linked agent files without modifying their targets', async () => {
      const { path, source } = await windowsFixture();
      const target = join(root, 'target.js');
      await writeFile(target, source);
      await rm(path);
      await link(target, path);
      await expect(ensurePtyHelper({ platform: 'win32', arch: process.arch, packageDirectory: root }))
        .rejects.toThrow('private regular file');
      expect(await readFile(target, 'utf8')).toBe(source);
      await rm(path);
      await symlink(target, path);
      await expect(ensurePtyHelper({ platform: 'win32', arch: process.arch, packageDirectory: root })).rejects.toThrow();
      expect(await readFile(target, 'utf8')).toBe(source);
    });
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
