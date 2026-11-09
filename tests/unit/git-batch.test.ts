import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGitBlobReader } from '../../src/server/catalog/git-batch.js';

const roots: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'loom-git-batch-'));
  roots.push(root);
  execFileSync('git', ['init', '--quiet', root]);
  return root;
}

function blob(repo: string, value: Buffer): string {
  return execFileSync('git', ['-C', repo, 'hash-object', '-w', '--stdin'], {
    input: value,
    encoding: 'utf8',
  }).trim();
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('batched Git blob reader', () => {
  it('reads multiple binary and empty objects through one process', async () => {
    const repo = await repository();
    const data = Buffer.concat([Buffer.from([0, 10, 255]), Buffer.alloc(100_000, 42)]);
    const first = blob(repo, data);
    const empty = blob(repo, Buffer.alloc(0));
    const reader = createGitBlobReader({ repository: repo, cwd: repo, timeoutMs: 5_000, maxStderrBytes: 2_048 });
    try {
      expect(await reader.read(first, data.length)).toEqual(data);
      expect(await reader.read(empty, 0)).toEqual(Buffer.alloc(0));
      expect(await reader.read(first, data.length)).toEqual(data);
      await reader.close();
    } finally {
      await reader.close(true);
    }
  });

  it('rejects a blob before reading beyond the specified byte budget', async () => {
    const repo = await repository();
    const object = blob(repo, Buffer.alloc(128));
    const reader = createGitBlobReader({ repository: repo, cwd: repo, timeoutMs: 5_000, maxStderrBytes: 2_048 });
    try {
      await expect(reader.read(object, 127)).rejects.toMatchObject({
        code: 'TOO_LARGE',
        details: { bytes: 128, limit: 127 },
      });
    } finally {
      await reader.close(true);
    }
  });

  it('times out a stalled Git process and reaps it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-git-stalled-'));
    roots.push(root);
    let child: ChildProcessWithoutNullStreams | undefined;
    const reader = createGitBlobReader({
      repository: root, cwd: root, timeoutMs: 200, maxStderrBytes: 2_048,
      spawnGit: () => {
        child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
          cwd: root, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32',
        });
        return child;
      },
    });
    try {
      await expect(reader.read('a'.repeat(40), 10)).rejects.toMatchObject({ code: 'TIMEOUT' });
    } finally {
      await reader.close(true);
    }
    expect(child).toBeDefined();
    expect(child!.exitCode !== null || child!.signalCode !== null).toBe(true);
  });

  it('escalates termination when the Git process ignores SIGTERM', async () => {
    if (process.platform === 'win32') return;
    const root = await mkdtemp(join(tmpdir(), 'loom-git-ignore-term-'));
    roots.push(root);
    const executable = join(root, 'git');
    await writeFile(executable, `#!${process.execPath}\nprocess.on('SIGTERM', () => {});\nsetInterval(() => {}, 1000);\n`);
    await chmod(executable, 0o700);
    const previousPath = process.env.PATH;
    process.env.PATH = root;
    try {
      const reader = createGitBlobReader({ repository: root, cwd: root, timeoutMs: 500, maxStderrBytes: 2_048 });
      await expect(reader.read('a'.repeat(40), 10)).rejects.toMatchObject({ code: 'TIMEOUT' });
      await reader.close(true);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

  it('rejects concurrent reads rather than mixing Git object responses', async () => {
    const repo = await repository();
    const object = blob(repo, Buffer.alloc(1024));
    const reader = createGitBlobReader({ repository: repo, cwd: repo, timeoutMs: 5_000, maxStderrBytes: 2_048 });
    try {
      const first = reader.read(object, 1024);
      await expect(reader.read(object, 1024)).rejects.toMatchObject({ code: 'FAILED' });
      expect(await first).toEqual(Buffer.alloc(1024));
      await reader.close();
    } finally {
      await reader.close(true);
    }
  });

  it('reaps a stalled process before reporting a close timeout', async () => {
    if (process.platform === 'win32') return;
    const root = await mkdtemp(join(tmpdir(), 'loom-git-close-timeout-'));
    roots.push(root);
    const executable = join(root, 'git');
    const pidFile = join(root, 'git.pid');
    await writeFile(executable, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nprocess.on('SIGTERM', () => {});\nsetInterval(() => {}, 1000);\n`);
    await chmod(executable, 0o700);
    const previousPath = process.env.PATH;
    process.env.PATH = root;
    try {
      const reader = createGitBlobReader({ repository: root, cwd: root, timeoutMs: 500, maxStderrBytes: 2_048 });
      await expect(reader.close()).rejects.toMatchObject({ code: 'TIMEOUT' });
      const { readFile } = await import('node:fs/promises');
      const pid = Number(await readFile(pidFile, 'utf8'));
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });
});
