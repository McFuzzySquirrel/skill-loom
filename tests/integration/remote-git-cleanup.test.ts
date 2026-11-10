import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { listRemoteSkillSnapshots, refreshRemoteSkillSource } from '../../src/server/catalog/remote.js';
import { createConfigStore } from '../../src/server/config/store.js';
import { startControlServer } from '../../src/server/control.js';

describe('remote Git process cleanup', () => {
  it('discards unpublished materialization when cancelled after a blob is read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-refresh-materialize-'));
    try {
      const store = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') } });
      await store.update({
        remoteSkillSources: [{ id: 'materialize', repository: 'https://example.invalid/skills.git' }],
      });
      const baseline = await refreshRemoteSkillSource(store, 'materialize', {
        temporaryDirectory: root,
        gitRunner: async (args) => ({ stdout: args.includes('rev-parse') ? `${'a'.repeat(40)}\n` : '' }),
      });
      const controller = new AbortController();
      await expect(refreshRemoteSkillSource(store, 'materialize', {
        temporaryDirectory: root,
        signal: controller.signal,
        gitRunner: async (args) => {
          if (args.includes('rev-parse')) return { stdout: `${'b'.repeat(40)}\n` };
          if (args.includes('ls-tree')) return { stdout: `100644 blob ${'c'.repeat(40)}\tskill/SKILL.md\0` };
          if (args.includes('cat-file')) {
            controller.abort();
            return { stdout: '---\nname: skill\n---\n' };
          }
          return { stdout: '' };
        },
      })).rejects.toMatchObject({ code: 'REMOTE_SOURCE_CANCELLED' });
      expect(await listRemoteSkillSnapshots(store.getConfigDir(), 'materialize')).toEqual([baseline]);
      const directory = join(store.getConfigDir(), 'catalog-sources', 'materialize');
      expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
      expect((await readdir(root)).filter((name) => name.startsWith('skill-loom-source-'))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('does not start Git for a cancelled refresh waiting behind the source lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-refresh-queued-'));
    try {
      const store = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') } });
      await store.update({
        remoteSkillSources: [{ id: 'queued', repository: 'https://example.invalid/skills.git' }],
      });
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const firstStarted = new Promise<void>((resolve) => { started = resolve; });
      const first = refreshRemoteSkillSource(store, 'queued', {
        temporaryDirectory: root,
        gitRunner: async (args) => {
          if (args[0] === 'clone') {
            started();
            await gate;
          }
          return { stdout: args.includes('rev-parse') ? `${'a'.repeat(40)}\n` : '' };
        },
      });
      await firstStarted;
      const controller = new AbortController();
      const runner = vi.fn(async () => ({ stdout: '' }));
      const second = refreshRemoteSkillSource(store, 'queued', {
        temporaryDirectory: root, signal: controller.signal, gitRunner: runner,
      });
      const nextRunner = vi.fn(async (args: string[]) => ({
        stdout: args.includes('rev-parse') ? `${'b'.repeat(40)}\n` : '',
      }));
      const third = refreshRemoteSkillSource(store, 'queued', {
        temporaryDirectory: root, gitRunner: nextRunner,
      });
      controller.abort();
      await expect(second).rejects.toMatchObject({ code: 'REMOTE_SOURCE_CANCELLED' });
      expect(nextRunner).not.toHaveBeenCalled();
      release();
      await first;
      await expect(third).resolves.toMatchObject({ revision: 'b'.repeat(40) });
      expect(runner).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it.skipIf(process.platform !== 'linux')(
    'cancels a refresh when the control client disconnects',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'loom-refresh-disconnect-'));
      const executable = join(root, 'git');
      const pidPath = join(root, 'git.pid');
      const oldPath = process.env.PATH;
      const oldPidPath = process.env.LOOM_TEST_CHILD_PID;
      let server: Awaited<ReturnType<typeof startControlServer>> | undefined;
      try {
        await writeFile(executable, `#!${process.execPath}
require('node:fs').writeFileSync(process.env.LOOM_TEST_CHILD_PID, String(process.pid));
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
`);
        await chmod(executable, 0o700);
        process.env.PATH = root;
        process.env.LOOM_TEST_CHILD_PID = pidPath;
        const store = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') } });
        await store.update({
          remoteSkillSources: [{ id: 'disconnect', repository: 'https://example.invalid/skills.git' }],
          remoteCatalogLimits: { cloneTimeoutMs: 10_000 },
        });
        let disconnect: () => void;
        {
          server = await startControlServer(store);
          const metadata = JSON.parse(await readFile(join(store.getConfigDir(), 'control.json'), 'utf8')) as {
            socket: string; token: string;
          };
          const client = createConnection(metadata.socket);
          await new Promise<void>((resolve, reject) => {
            client.once('connect', resolve);
            client.once('error', reject);
          });
          client.write(`${JSON.stringify({
            version: 1, token: metadata.token, operation: 'catalog.source.refresh', input: { sourceId: 'disconnect' },
          })}\n`);
          disconnect = () => client.destroy();
        }
        let pid = 0;
        await vi.waitFor(async () => {
          pid = Number(await readFile(pidPath, 'utf8'));
          expect(pid).toBeGreaterThan(0);
        }, { timeout: 5_000 });
        disconnect();
        await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 5_000 });
        expect(await listRemoteSkillSnapshots(store.getConfigDir(), 'disconnect')).toEqual([]);
      } finally {
        await server?.close();
        if (oldPath === undefined) delete process.env.PATH;
        else process.env.PATH = oldPath;
        if (oldPidPath === undefined) delete process.env.LOOM_TEST_CHILD_PID;
        else process.env.LOOM_TEST_CHILD_PID = oldPidPath;
        await rm(root, { recursive: true, force: true });
      }
    },
    20_000,
  );
  it.skipIf(process.platform !== 'linux').each([
    { stage: 'clone', action: 'cancel' },
    { stage: 'cat-file', action: 'cancel' },
    { stage: 'clone', action: 'timeout' },
    { stage: 'cat-file', action: 'timeout' },
  ])(
    'cleans up a stalled $stage process group after $action without publishing a partial snapshot',
    async ({ stage, action }) => {
      const root = await mkdtemp(join(tmpdir(), 'loom-git-cancel-'));
      const executable = join(root, 'git');
      const pidPath = join(root, 'child.pid');
      const oldPath = process.env.PATH;
      const oldStage = process.env.LOOM_TEST_CANCEL_STAGE;
      const oldPidPath = process.env.LOOM_TEST_CHILD_PID;
      try {
        await writeFile(executable, `#!${process.execPath}
const args = process.argv.slice(2);
const stage = process.env.LOOM_TEST_CANCEL_STAGE;
const isClone = args.includes('clone');
const isBatch = args.includes('cat-file');
if ((stage === 'clone' && isClone) || (stage === 'cat-file' && isBatch)) {
  const { spawn } = require('node:child_process');
  const { writeFileSync } = require('node:fs');
  process.on('SIGTERM', () => {});
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' });
  writeFileSync(process.env.LOOM_TEST_CHILD_PID, String(child.pid));
  setInterval(() => {}, 1000);
} else if (args.includes('rev-parse')) {
  process.stdout.write('${'a'.repeat(40)}\\n');
} else if (args.includes('ls-tree') && stage === 'cat-file') {
  process.stdout.write('100644 blob ${'b'.repeat(40)}\\tskill/SKILL.md\\0');
} else if (isBatch) {
  process.stdin.resume();
}
`);
        await chmod(executable, 0o700);
        process.env.PATH = root;
        process.env.LOOM_TEST_CHILD_PID = pidPath;
        delete process.env.LOOM_TEST_CANCEL_STAGE;
        const store = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') } });
        await store.update({
          remoteSkillSources: [{ id: 'cancel-test', repository: 'https://example.invalid/skills.git' }],
          remoteCatalogLimits: { cloneTimeoutMs: 10_000, commandTimeoutMs: 10_000 },
        });
        const baseline = await refreshRemoteSkillSource(store, 'cancel-test', { temporaryDirectory: root });
        if (action === 'timeout') {
          await store.update({ remoteCatalogLimits: { cloneTimeoutMs: 5000, commandTimeoutMs: 5000 } });
        }
        process.env.LOOM_TEST_CANCEL_STAGE = stage;
        const controller = new AbortController();
        const pending = refreshRemoteSkillSource(store, 'cancel-test', { temporaryDirectory: root, signal: controller.signal });
        let pid = 0;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          try {
            pid = Number(await readFile(pidPath, 'utf8'));
            break;
          } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
            await new Promise((resolve) => setTimeout(resolve, 30));
          }
        }
        expect(pid).toBeGreaterThan(0);
        if (action === 'cancel') controller.abort();
        await expect(pending).rejects.toMatchObject({
          code: action === 'cancel' ? 'REMOTE_SOURCE_CANCELLED' : 'REMOTE_SOURCE_TIMEOUT',
        });
        await vi.waitFor(async () => {
          try {
            const status = await readFile(`/proc/${String(pid)}/stat`, 'utf8');
            expect(status.split(') ')[1]?.[0]).toBe('Z');
          } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
          }
        }, { timeout: 5_000, interval: 25 });
        expect(await listRemoteSkillSnapshots(store.getConfigDir(), 'cancel-test')).toEqual([baseline]);
        expect((await readdir(root)).filter((name) => name.startsWith('skill-loom-source-'))).toEqual([]);
        const snapshotDir = join(store.getConfigDir(), 'catalog-sources', 'cancel-test');
        expect((await readdir(snapshotDir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
      } finally {
        if (oldPath === undefined) delete process.env.PATH;
        else process.env.PATH = oldPath;
        if (oldStage === undefined) delete process.env.LOOM_TEST_CANCEL_STAGE;
        else process.env.LOOM_TEST_CANCEL_STAGE = oldStage;
        if (oldPidPath === undefined) delete process.env.LOOM_TEST_CHILD_PID;
        else process.env.LOOM_TEST_CHILD_PID = oldPidPath;
        await rm(root, { recursive: true, force: true });
      }
    },
    30_000,
  );
  it.skipIf(process.platform !== 'linux')('enforces real Git stdout and stderr limits at their exact boundaries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-git-output-'));
    const executable = join(root, 'git');
    const oldPath = process.env.PATH;
    const oldBytes = process.env.LOOM_TEST_OUTPUT_BYTES;
    const oldStream = process.env.LOOM_TEST_OUTPUT_STREAM;
    try {
      await writeFile(executable, `#!${process.execPath}
const args = process.argv.slice(2);
if (args.includes('clone')) {
  process.env.LOOM_TEST_OUTPUT_STREAM === 'stderr'
    ? process.stderr.write('x'.repeat(Number(process.env.LOOM_TEST_OUTPUT_BYTES)))
    : process.stdout.write('x'.repeat(Number(process.env.LOOM_TEST_OUTPUT_BYTES)));
} else if (args.includes('rev-parse')) {
  process.stdout.write('${'a'.repeat(40)}\\n');
} else if (args.includes('cat-file')) {
  process.stdin.resume();
} else if (!args.includes('ls-tree')) {
  process.exitCode = 1;
}
`);
      await chmod(executable, 0o700);
      process.env.PATH = root;
      const store = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') } });
      await store.update({
        remoteSkillSources: [{ id: 'output-test', repository: 'https://example.invalid/skills.git' }],
        remoteCatalogLimits: { maxCommandOutputBytes: 64 },
      });
      for (const stream of ['stdout', 'stderr']) {
        process.env.LOOM_TEST_OUTPUT_STREAM = stream;
        for (const bytes of [63, 64, 65]) {
          process.env.LOOM_TEST_OUTPUT_BYTES = String(bytes);
          const refresh = refreshRemoteSkillSource(store, 'output-test', { temporaryDirectory: root });
          if (bytes <= 64) {
            await expect(refresh).resolves.toMatchObject({ revision: 'a'.repeat(40), packages: [] });
          } else {
            await expect(refresh).rejects.toMatchObject({
              code: 'REMOTE_SOURCE_TOO_LARGE',
              message: expect.stringContaining('Adjust the catalog limits or narrow the source'),
              details: { sourceId: 'output-test', dimension: 'maxCommandOutputBytes', limit: 64 },
            });
          }
          expect((await readdir(root)).filter((name) => name.startsWith('skill-loom-source-'))).toEqual([]);
        }
      }
    } finally {
      if (oldPath === undefined) delete process.env.PATH;
      else process.env.PATH = oldPath;
      if (oldBytes === undefined) delete process.env.LOOM_TEST_OUTPUT_BYTES;
      else process.env.LOOM_TEST_OUTPUT_BYTES = oldBytes;
      if (oldStream === undefined) delete process.env.LOOM_TEST_OUTPUT_STREAM;
      else process.env.LOOM_TEST_OUTPUT_STREAM = oldStream;
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it.skipIf(process.platform !== 'linux')('reports the configured limit for batched Git diagnostic output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-git-batch-output-'));
    const executable = join(root, 'git');
    const oldPath = process.env.PATH;
    const oldBytes = process.env.LOOM_TEST_OUTPUT_BYTES;
    try {
      await writeFile(executable, `#!${process.execPath}
const args = process.argv.slice(2);
const configured = process.env.LOOM_TEST_OUTPUT_BYTES;
if (args.includes('rev-parse')) {
  process.stdout.write((configured === undefined ? '${'a'.repeat(40)}' : '${'b'.repeat(40)}') + '\\n');
} else if (args.includes('ls-tree') && configured !== undefined) {
  process.stdout.write('100644 blob ${'c'.repeat(40)}\\tskill/SKILL.md\\0');
} else if (args.includes('cat-file')) {
  process.stderr.write('x'.repeat(Number(configured)));
  process.stdin.on('data', () => {
    const content = '---\\nname: skill\\n---\\n';
    process.stdout.write('${'c'.repeat(40)} blob ' + Buffer.byteLength(content) + '\\n' + content + '\\n');
  });
  process.stdin.resume();
}
`);
      await chmod(executable, 0o700);
      process.env.PATH = root;
      delete process.env.LOOM_TEST_OUTPUT_BYTES;
      const store = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') } });
      await store.update({
        remoteSkillSources: [{ id: 'batch-output', repository: 'https://example.invalid/skills.git' }],
        remoteCatalogLimits: { maxCommandOutputBytes: 128 },
      });
      const initial = await refreshRemoteSkillSource(store, 'batch-output', { temporaryDirectory: root });
      let published = [initial];
      for (const bytes of [127, 128, 129]) {
        process.env.LOOM_TEST_OUTPUT_BYTES = String(bytes);
        const refresh = refreshRemoteSkillSource(store, 'batch-output', { temporaryDirectory: root });
        if (bytes <= 128) {
          await expect(refresh).resolves.toMatchObject({ revision: 'b'.repeat(40), packages: [{ name: 'skill' }] });
          published = await listRemoteSkillSnapshots(store.getConfigDir(), 'batch-output');
        } else {
          await expect(refresh).rejects.toMatchObject({
            code: 'REMOTE_SOURCE_TOO_LARGE',
            message: expect.stringContaining('Adjust the catalog limits or narrow the source'),
            details: { sourceId: 'batch-output', dimension: 'maxCommandOutputBytes', limit: 128 },
          });
          expect(await listRemoteSkillSnapshots(store.getConfigDir(), 'batch-output')).toEqual(published);
        }
        expect((await readdir(root)).filter((name) => name.startsWith('skill-loom-source-'))).toEqual([]);
      }
    } finally {
      if (oldPath === undefined) delete process.env.PATH;
      else process.env.PATH = oldPath;
      if (oldBytes === undefined) delete process.env.LOOM_TEST_OUTPUT_BYTES;
      else process.env.LOOM_TEST_OUTPUT_BYTES = oldBytes;
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it.skipIf(process.platform !== 'linux')('enforces staging entry and byte boundaries during real Git commands', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-git-staging-'));
    const executable = join(root, 'git');
    const oldPath = process.env.PATH;
    try {
      await writeFile(executable, `#!${process.execPath}
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const args = process.argv.slice(2);
if (args.includes('clone')) {
  const repository = args.at(-1);
  mkdirSync(repository);
  writeFileSync(join(repository, 'first'), 'ab');
  writeFileSync(join(repository, 'second'), 'cde');
} else if (args.includes('rev-parse')) {
  process.stdout.write('${'a'.repeat(40)}\\n');
} else if (args.includes('cat-file')) {
  process.stdin.resume();
} else if (!args.includes('ls-tree')) {
  process.exitCode = 1;
}
`);
      await chmod(executable, 0o700);
      process.env.PATH = root;
      const store = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') } });
      await store.update({
        remoteSkillSources: [{ id: 'staging-test', repository: 'https://example.invalid/skills.git' }],
      });
      const initial = await refreshRemoteSkillSource(store, 'staging-test', { temporaryDirectory: root });
      for (const [dimension, threshold] of [['maxStagingEntries', 3], ['maxStagingBytes', 5]] as const) {
        for (const limit of [threshold - 1, threshold, threshold + 1]) {
          await store.update({ remoteCatalogLimits: { [dimension]: limit } });
          const refresh = refreshRemoteSkillSource(store, 'staging-test', { temporaryDirectory: root });
          if (limit < threshold) {
            await expect(refresh).rejects.toMatchObject({
              code: 'REMOTE_SOURCE_TOO_LARGE', details: { dimension, limit },
            });
            expect(await listRemoteSkillSnapshots(store.getConfigDir(), 'staging-test')).toEqual([initial]);
          } else {
            await expect(refresh).resolves.toEqual(initial);
          }
          expect((await readdir(root)).filter((name) => name.startsWith('skill-loom-source-'))).toEqual([]);
        }
      }
    } finally {
      if (oldPath === undefined) delete process.env.PATH;
      else process.env.PATH = oldPath;
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it.skipIf(process.platform !== 'linux').each([true, false])(
    'terminates a timed-out Git process group when parent ignores SIGTERM: %s',
    async (parentIgnoresTerm) => {
    const root = await mkdtemp(join(tmpdir(), 'loom-git-group-'));
    const executable = join(root, 'git');
    const childPidPath = join(root, 'child.pid');
    const oldPath = process.env.PATH;
    const oldPidPath = process.env.LOOM_TEST_CHILD_PID;
    try {
      await writeFile(executable, `#!${process.execPath}
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
${parentIgnoresTerm ? "process.on('SIGTERM', () => {});" : ''}
const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' });
writeFileSync(process.env.LOOM_TEST_CHILD_PID, String(child.pid));
setInterval(() => {}, 1000);
`);
      await chmod(executable, 0o700);
      process.env.PATH = root;
      process.env.LOOM_TEST_CHILD_PID = childPidPath;
      const store = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') } });
      await store.update({
        remoteSkillSources: [{ id: 'group-test', repository: 'https://example.invalid/skills.git' }],
        remoteCatalogLimits: { cloneTimeoutMs: 500 },
      });

      await expect(refreshRemoteSkillSource(store, 'group-test', { temporaryDirectory: root }))
        .rejects.toMatchObject({ code: 'REMOTE_SOURCE_TIMEOUT' });
      const pid = Number(await readFile(childPidPath, 'utf8'));
      expect(Number.isInteger(pid) && pid > 0).toBe(true);
      await vi.waitFor(async () => {
        try {
          const status = await readFile(`/proc/${String(pid)}/stat`, 'utf8');
          expect(status.split(') ')[1]?.[0]).toBe('Z');
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        }
      }, { timeout: 5_000, interval: 25 });
    } finally {
      if (oldPath === undefined) delete process.env.PATH;
      else process.env.PATH = oldPath;
      if (oldPidPath === undefined) delete process.env.LOOM_TEST_CHILD_PID;
      else process.env.LOOM_TEST_CHILD_PID = oldPidPath;
      await rm(root, { recursive: true, force: true });
    }
    },
  );
});
