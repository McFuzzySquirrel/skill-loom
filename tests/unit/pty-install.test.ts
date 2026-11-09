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

describe('Windows PTY installation', () => {
  async function windowsFixture() {
    root = await realpath(await mkdtemp(join(tmpdir(), 'loom-pty-windows-install-')));
    const directory = join(root, 'lib');
    await mkdir(directory);
    const require = createRequire(import.meta.url);
    const installed = join(dirname(require.resolve('node-pty/package.json')), 'lib');
    // Reconstruct upstream bytes even when Windows postinstall already patched them.
    const source = (await readFile(join(installed, 'windowsPtyAgent.js'), 'utf8')).replace(
      /WindowsPtyAgent\.prototype\._cleanUpProcess = function \(\) \{[\s\S]*?\n    \};/,
      [
        'WindowsPtyAgent.prototype._cleanUpProcess = function () {',
        '        if (this._useConptyDll) {',
        '            return;',
        '        }',
        '        this._inSocket.readable = false;',
        '        this._outSocket.readable = false;',
        '        this._outSocket.destroy();',
        '    };',
      ].join('\n'),
    ).replace('        if (this._exitCode !== undefined) { return; }\n', '');
    const path = join(directory, 'windowsPtyAgent.js');
    await writeFile(path, source);
    await writeFile(join(directory, 'windowsConoutConnection.js'), await readFile(join(installed, 'windowsConoutConnection.js')));
    return { path, source };
  }

  it('waits for the worker before closing output, and never kills an exited PID', async () => {
    const { path, source } = await windowsFixture();
    await ensurePtyHelper({ platform: 'win32', arch: process.arch, packageDirectory: root });
    const fixed = await readFile(path, 'utf8');
    expect(fixed).not.toBe(source);
    const exported: { WindowsPtyAgent?: { prototype: {
      _cleanUpProcess: (this: unknown) => void; kill: (this: unknown) => void;
    } } } = {};
    runInNewContext(fixed, { exports: exported, require: () => ({}), setTimeout, clearTimeout, console });
    const prototype = exported.WindowsPtyAgent!.prototype;
    const calls: string[] = [];
    let finishWorker: (() => void) | undefined;
    const agent = {
      _useConptyDll: false,
      _inSocket: { readable: true, destroy() { calls.push('input'); } },
      _outSocket: { readable: true, destroy() { calls.push('output'); } },
      _conoutSocketWorker: { _destroySocket() {
        calls.push('worker');
        return new Promise<void>((resolve) => { finishWorker = resolve; });
      } },
    };
    prototype._cleanUpProcess.call(agent);
    prototype._cleanUpProcess.call(agent);
    expect(calls).toEqual(['input', 'worker']);
    finishWorker?.();
    await Promise.resolve();
    expect(calls).toEqual(['input', 'worker', 'output']);
    prototype.kill.call({ _exitCode: 0 });
    prototype.kill.call({ _exitCode: 1 });
    await ensurePtyHelper({ platform: 'win32', arch: process.arch, packageDirectory: root });
    expect(await readFile(path, 'utf8')).toBe(fixed);
  });

  it('upgrades the earlier drain-before-dispose fix instead of accepting it as current', async () => {
    const { path, source } = await windowsFixture();
    await writeFile(path, source.replace(
      '        this._outSocket.readable = false;\n        this._outSocket.destroy();',
      '        this._outSocket.readable = false;\n        this._inSocket.destroy();\n        this._conoutSocketWorker.dispose();\n        this._outSocket.destroy();',
    ));
    await ensurePtyHelper({ platform: 'win32', arch: process.arch, packageDirectory: root });
    expect(await readFile(path, 'utf8')).toContain('this._conoutSocketWorker._destroySocket().then');
  });

  it('surfaces worker termination failure through the terminal error path', async () => {
    const { path } = await windowsFixture();
    await ensurePtyHelper({ platform: 'win32', arch: process.arch, packageDirectory: root });
    const exported: { WindowsPtyAgent?: { prototype: { _cleanUpProcess: (this: unknown) => void } } } = {};
    runInNewContext(await readFile(path, 'utf8'), {
      exports: exported, require: () => ({}), setTimeout, clearTimeout, console,
    });
    const failure = new Error('injected worker termination failure');
    let received: unknown;
    exported.WindowsPtyAgent!.prototype._cleanUpProcess.call({
      _useConptyDll: false,
      _inSocket: { destroy() {} },
      _outSocket: { destroy(error: unknown) { received = error; } },
      _conoutSocketWorker: { _destroySocket: () => Promise.reject(failure) },
    });
    await Promise.resolve();
    expect(received).toBe(failure);
  });

  it('refuses unknown dependency bytes without overwriting them', async () => {
    const { path } = await windowsFixture();
    await writeFile(path, 'unexpected upstream release');
    await expect(ensurePtyHelper({ platform: 'win32', arch: process.arch, packageDirectory: root }))
      .rejects.toThrow('Unsupported node-pty');
    expect(await readFile(path, 'utf8')).toBe('unexpected upstream release');
  });

  it('refuses an unknown worker lifecycle implementation', async () => {
    const { path, source } = await windowsFixture();
    await writeFile(join(root, 'lib/windowsConoutConnection.js'), 'unexpected lifecycle');
    await expect(ensurePtyHelper({ platform: 'win32', arch: process.arch, packageDirectory: root }))
      .rejects.toThrow('Unsupported node-pty conout');
    expect(await readFile(path, 'utf8')).toBe(source);
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
  });

  it('rejects a linked lib directory without modifying the agent', async () => {
    const { source } = await windowsFixture();
    const actual = join(root, 'actual-lib');
    await mkdir(actual);
    const target = join(actual, 'windowsPtyAgent.js');
    await writeFile(target, source);
    await rm(join(root, 'lib'), { recursive: true });
    await symlink(actual, join(root, 'lib'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(ensurePtyHelper({ platform: 'win32', arch: process.arch, packageDirectory: root })).rejects.toThrow();
    expect(await readFile(target, 'utf8')).toBe(source);
  });

  it.skipIf(process.platform === 'win32')('rejects a symlinked agent without modifying the target', async () => {
    const { path, source } = await windowsFixture();
    const target = join(root, 'target.js');
    await writeFile(target, source);
    await rm(path);
    await symlink(target, path);
    await expect(ensurePtyHelper({ platform: 'win32', arch: process.arch, packageDirectory: root })).rejects.toThrow();
    expect(await readFile(target, 'utf8')).toBe(source);
  });
});
