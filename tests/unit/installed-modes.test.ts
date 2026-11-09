import { chmod, link, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  discardInstalledModeIndex, installedExecutableFlag, readInstalledModeIndex, writeInstalledModeIndex,
} from '../../src/portable/installed-modes.js';
import { writeBundleSkillFiles } from '../../src/portable/install-skill.js';
import { packageFingerprint, treeFingerprint } from '../../src/portable/runtime.js';

const roots: string[] = [];
const files = [
  { path: 'SKILL.md', content: Buffer.from('---\nname: example\n---\nInstructions.\n'), executable: false },
  { path: 'scripts/run.sh', content: Buffer.from('#!/bin/sh\nexit 0\n'), executable: true },
];
const bundleFiles = files.map((file) => ({ ...file, content: file.content.toString('base64') }));

async function setup() {
  const project = await realpath(await mkdtemp(join(tmpdir(), 'loom-installed-modes-')));
  roots.push(project);
  const destination = join(project, '.agents', 'skills', 'example');
  await mkdir(destination, { recursive: true });
  return { project, destination, local: join(destination, '.loom', 'installed-modes.json') };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('installed executable-mode records', () => {
  it.each(['before', 'nested', 'after'])('retains mode evidence through real installer termination (%s link)', async (phase) => {
    const { destination } = await setup();
    const child = spawn(process.execPath, [
      '--import', 'tsx', 'tests/fixtures/install-skill-crash.ts', destination, phase, 'record-modes',
    ], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = once(child, 'exit');
    try {
      const [ready] = await once(child.stdout, 'data', { signal: AbortSignal.timeout(15_000) });
      expect(String(ready)).toContain('READY');
      await expect(writeInstalledModeIndex(destination, files)).rejects.toMatchObject({ code: 'EEXIST' });
      child.kill('SIGKILL');
      await exited;
      expect((await readInstalledModeIndex(destination))?.files).toHaveLength(4);
      if (phase === 'after') await expect(treeFingerprint(destination)).resolves.toMatch(/^[a-f0-9]{64}$/);
      else await expect(treeFingerprint(destination)).rejects.toThrow(/metadata/);
      await expect(writeInstalledModeIndex(destination, files)).rejects.toMatchObject({ code: 'EEXIST' });
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
    }
  }, 30_000);

  it('round-trips explicit executable intent without deriving it from Windows stat', async () => {
    const { destination } = await setup();
    const receipt = await writeInstalledModeIndex(destination, files);
    const index = await readInstalledModeIndex(destination);
    expect(index?.version).toBe(1);
    expect(index?.files).toHaveLength(2);
    expect(installedExecutableFlag(index!, 'scripts/run.sh', true)).toBe(true);
    expect(installedExecutableFlag(index!, 'SKILL.md', false)).toBe(false);
    if (process.platform === 'win32') {
      expect(installedExecutableFlag(index!, 'scripts/run.sh', false)).toBe(true);
    } else {
      expect(() => installedExecutableFlag(index!, 'scripts/run.sh', false)).toThrow(/metadata/);
    }
    await expect(writeInstalledModeIndex(destination, files)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readInstalledModeIndex(destination)).toEqual(index);
    await discardInstalledModeIndex(receipt);
    await expect(readInstalledModeIndex(destination)).rejects.toThrow(/metadata/);
  });

  it.each(['local', 'registry', 'directory'])('rejects missing %s metadata without repair', async (part) => {
    const { destination, local } = await setup();
    const receipt = await writeInstalledModeIndex(destination, files);
    if (part === 'local') await unlink(local);
    else if (part === 'registry') await unlink(receipt.registryPath);
    else await rm(dirname(local), { recursive: true });
    await expect(readInstalledModeIndex(destination)).rejects.toThrow(/metadata/);
  });

  it.each(['version', 'path', 'executable', 'hash', 'extra-file', 'invalid-json', 'invalid-utf8', 'hard-link'])(
    'rejects %s tampering and leaves the evidence unchanged',
    async (change) => {
      const { destination, local } = await setup();
      const receipt = await writeInstalledModeIndex(destination, files);
      const original = await readFile(local);
      const changed = JSON.parse(original.toString()) as {
        version: number; files: Array<{ path: string; executable: boolean; sha256: string }>;
      };
      if (change === 'version') changed.version = 2;
      if (change === 'path') changed.files[0]!.path = '../escape';
      if (change === 'executable') changed.files[0]!.executable = true;
      if (change === 'hash') changed.files[0]!.sha256 = '0'.repeat(64);
      if (change === 'extra-file') await writeFile(join(dirname(local), 'hidden.txt'), 'hidden');
      else if (change === 'hard-link') await link(local, join(dirname(local), 'linked'));
      else {
        const content = change === 'invalid-json' ? '{broken' : change === 'invalid-utf8' ? Buffer.from([255]) : JSON.stringify(changed);
        await writeFile(local, content);
        // A corrupt schema must be rejected even when both copies match.
        if (change === 'version' || change === 'path') await writeFile(receipt.registryPath, content);
      }
      const before = await readFile(local);
      await expect(readInstalledModeIndex(destination)).rejects.toThrow();
      expect(await readFile(local)).toEqual(before);
    },
  );

  it('binds original content while retaining path intent for explicitly re-reviewed edits', async () => {
    const { destination } = await setup();
    await writeInstalledModeIndex(destination, files);
    const index = await readInstalledModeIndex(destination);
    expect(index?.files.find((file) => file.path === 'scripts/run.sh')?.sha256)
      .toBe(createHash('sha256').update(files[1]!.content).digest('hex'));
    expect(installedExecutableFlag(index!, 'scripts/run.sh', true)).toBe(true);
    expect(() => installedExecutableFlag(index!, 'new.sh', true)).toThrow(/metadata/);
  });

  it('rejects duplicate paths, unsafe paths and oversized records before writing', async () => {
    const { destination } = await setup();
    for (const invalid of [
      [files[0]!, { ...files[0]!, path: 'skill.md' }],
      [{ ...files[0]!, path: '../escape' }],
      Array.from({ length: 2001 }, (_, index) => ({ ...files[0]!, path: `file-${index}` })),
    ]) {
      await expect(writeInstalledModeIndex(destination, invalid)).rejects.toThrow();
    }
    expect(await readdir(destination)).toEqual([]);
  });

  it('rejects oversized on-disk records before parsing or repairing them', async () => {
    const { destination, local } = await setup();
    await writeInstalledModeIndex(destination, files);
    await writeFile(local, Buffer.alloc(2 * 1024 * 1024 + 1));
    await expect(readInstalledModeIndex(destination)).rejects.toThrow(/metadata/);
  });

  it.each(['file', 'local-directory', 'registry-directory'])('rejects a linked %s without following it', async (part) => {
    const { project, destination, local } = await setup();
    const receipt = await writeInstalledModeIndex(destination, files);
    const outside = join(project, 'outside');
    await mkdir(outside);
    const sentinel = join(outside, 'installed-modes.json');
    await writeFile(sentinel, receipt.content);
    if (part === 'file') {
      await unlink(local);
      await symlink(sentinel, local, 'file');
    } else {
      const target = part === 'local-directory' ? dirname(local) : dirname(receipt.registryPath);
      await rm(target, { recursive: true });
      await symlink(outside, target, process.platform === 'win32' ? 'junction' : 'dir');
    }
    await expect(readInstalledModeIndex(destination)).rejects.toThrow();
    expect(await readFile(sentinel, 'utf8')).toBe(receipt.content);
  });

  it('allows only one concurrent installer to reserve a registry entry', async () => {
    const { destination } = await setup();
    const results = await Promise.allSettled([
      writeInstalledModeIndex(destination, files),
      writeInstalledModeIndex(destination, files),
    ]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((item) => item.status === 'rejected')).toHaveLength(1);
    expect((await readInstalledModeIndex(destination))?.files).toHaveLength(files.length);
  });

  it('publishes metadata before entries and excludes only validated metadata from fingerprints', async () => {
    const { destination } = await setup();
    const receipt = await writeBundleSkillFiles(destination, bundleFiles, {
      directoryMode: 0o700, enforceFileMode: true, recordExecutableModes: true,
      publish: async (source, target) => {
        expect(await readInstalledModeIndex(destination)).not.toBeNull();
        await link(source, target);
      },
    });
    expect(receipt).toBeDefined();
    const inventory: Parameters<typeof treeFingerprint>[1] = [];
    expect(await treeFingerprint(destination, inventory)).toBe(packageFingerprint(bundleFiles));
    expect(inventory.map((entry) => entry.path)).toEqual(['scripts', 'scripts/run.sh', 'SKILL.md'].sort((a, b) => a.localeCompare(b)));
    await writeFile(join(destination, 'scripts', 'run.sh'), 'changed');
    expect(await treeFingerprint(destination)).not.toBe(packageFingerprint(bundleFiles));
  });

  it.each(['added', 'removed', 'mode'])('rejects a package with %s files or intent', async (change) => {
    if (change === 'mode' && process.platform === 'win32') return;
    const { destination } = await setup();
    await writeBundleSkillFiles(destination, bundleFiles, {
      directoryMode: 0o700, enforceFileMode: true, recordExecutableModes: true,
    });
    if (change === 'added') await writeFile(join(destination, 'extra.txt'), 'extra');
    else if (change === 'removed') await unlink(join(destination, 'SKILL.md'));
    else await chmod(join(destination, 'scripts', 'run.sh'), 0o644);
    await expect(treeFingerprint(destination)).rejects.toThrow(/metadata/);
  });

  it('rolls back its own registry after a failed entry publication', async () => {
    const { project, destination } = await setup();
    await expect(writeBundleSkillFiles(destination, bundleFiles, {
      directoryMode: 0o700, enforceFileMode: true, recordExecutableModes: true,
      publish: async () => { throw new Error('injected failure'); },
    })).rejects.toThrow('injected failure');
    expect(await readdir(join(project, '.loom', 'package-modes'))).toEqual([]);
    await expect(readFile(join(destination, 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    // The failed caller still owns its incomplete directory and must roll it back.
    await expect(readInstalledModeIndex(destination)).rejects.toThrow(/metadata/);
  });

  it('does not remove another installation record during stale rollback', async () => {
    const { destination, local } = await setup();
    const first = await writeInstalledModeIndex(destination, files);
    await discardInstalledModeIndex(first);
    await unlink(local);
    const second = await writeInstalledModeIndex(destination, files);
    await expect(discardInstalledModeIndex(first)).rejects.toThrow(/metadata/);
    expect(await readFile(second.registryPath, 'utf8')).toBe(second.content);
  });

  it('treats a package without either record as legacy, not as mode-verified', async () => {
    const { destination } = await setup();
    expect(await readInstalledModeIndex(destination)).toBeNull();
    await writeFile(join(destination, 'SKILL.md'), files[0]!.content);
    if (process.platform === 'win32') await expect(readInstalledModeIndex(destination)).rejects.toThrow(/metadata/);
    else expect(await readInstalledModeIndex(destination)).toBeNull();
  });

  it.runIf(process.platform === 'win32')('does not silently infer non-executable intent after both records disappear', async () => {
    const { destination, local } = await setup();
    const receipt = await writeBundleSkillFiles(destination, bundleFiles, {
      directoryMode: 0o700, recordExecutableModes: true,
    });
    await unlink(local);
    await unlink(receipt!.registryPath);
    await rm(dirname(local), { recursive: true });
    await expect(treeFingerprint(destination)).rejects.toThrow(/metadata/);
  });
});
