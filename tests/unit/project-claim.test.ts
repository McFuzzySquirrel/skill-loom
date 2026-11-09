import { execFile, execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { statSync } from 'node:fs';
import { copyFile, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { withProjectClaimTransaction, withProjectRetirementTransaction, type ProjectClaim } from '../../src/shared/project-claim.js';

const roots: string[] = [];
const execFileAsync = promisify(execFile);

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'loom-project-claim-'));
  roots.push(root);
  return root;
}

function claim(path: string, runId = 'run-one'): ProjectClaim {
  const info = statSync(path, { bigint: true });
  return {
    version: 1, projectPath: path, projectDevice: String(info.dev), projectInode: String(info.ino),
    kind: 'managed', runId,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('project claim transaction', () => {
  it('migrates version-one claims and fails closed after retirement', async () => {
    const root = await project();
    await mkdir(join(root, '.loom'));
    const path = join(root, '.loom', 'project-claim.sqlite');
    const database = new DatabaseSync(path);
    database.exec(`
      CREATE TABLE claim (id INTEGER PRIMARY KEY CHECK (id = 1), document TEXT NOT NULL);
      CREATE TABLE protocol (id INTEGER PRIMARY KEY CHECK (id = 1), document TEXT NOT NULL);
      PRAGMA user_version = 1;
      PRAGMA application_id = 1280266061;
    `);
    database.prepare('INSERT INTO claim (id, document) VALUES (1, ?)').run(JSON.stringify(claim(root)));
    database.close();
    await withProjectClaimTransaction(root, async (tx) => expect(tx.read()).toEqual(claim(root)));
    const migrated = new DatabaseSync(path);
    expect(migrated.prepare('PRAGMA user_version').get()?.user_version).toBe(2);
    migrated.close();
    await withProjectRetirementTransaction(root, async (tx) => {
      tx.release(claim(root));
      tx.retire('2026-01-02T00:00:00.000Z');
    });
    await expect(withProjectClaimTransaction(root, async () => undefined))
      .rejects.toMatchObject({ code: 'PROJECT_CLAIM_RETIRED' });
    await withProjectRetirementTransaction(root, async (tx) => expect(tx.retired()).toBe(true));
  });

  it('persists a claim and releases only the matching run', async () => {
    const root = await project();
    const first = claim(root);
    await withProjectClaimTransaction(root, async (tx) => {
      expect(tx.read()).toBeNull();
      tx.acquire(first);
    });
    await expect(withProjectClaimTransaction(root, async (tx) => tx.acquire(claim(root, 'other'))))
      .rejects.toMatchObject({ code: 'PROJECT_CLAIM_CONFLICT' });
    await expect(withProjectClaimTransaction(root, async (tx) => tx.release({ kind: 'portable', runId: first.runId })))
      .rejects.toMatchObject({ code: 'PROJECT_CLAIM_MISMATCH' });
    await withProjectClaimTransaction(root, async (tx) => {
      expect(tx.read()).toEqual(first);
      tx.release(first);
    });
    await withProjectClaimTransaction(root, async (tx) => expect(tx.read()).toBeNull());
  });

  it('keeps the database and SQLite sidecars ignored without losing existing rules', async () => {
    const root = await project();
    execFileSync('git', ['init', '--quiet', root]);
    await mkdir(join(root, '.loom'));
    const ignore = join(root, '.loom', '.gitignore');
    await writeFile(ignore, 'runs/\n!project-claim.sqlite\n', 'utf8');
    await withProjectClaimTransaction(root, async () => undefined);
    expect(await readFile(ignore, 'utf8')).toBe('runs/\n!project-claim.sqlite\nproject-claim.sqlite*\n');
    const ignored = execFileSync('git', [
      '-C', root, 'check-ignore', '.loom/project-claim.sqlite', '.loom/project-claim.sqlite-journal',
    ], { encoding: 'utf8' });
    expect(ignored.trim().split('\n')).toEqual([
      '.loom/project-claim.sqlite', '.loom/project-claim.sqlite-journal',
    ]);
  });

  it('rolls back errors and never permits a transaction object to be reused', async () => {
    const root = await project();
    const failure = new Error('injected');
    let readLater: (() => ProjectClaim | null) | undefined;
    await expect(withProjectClaimTransaction(root, async (tx) => {
      readLater = tx.read;
      tx.acquire(claim(root));
      throw failure;
    })).rejects.toBe(failure);
    expect(() => readLater?.()).toThrow('no longer active');
    await withProjectClaimTransaction(root, async (tx) => expect(tx.read()).toBeNull());
  });

  it('serializes competing transactions within a process', async () => {
    const root = await project();
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const first = withProjectClaimTransaction(root, async (tx) => {
      tx.acquire(claim(root));
      entered?.();
      await new Promise<void>((resolve) => { release = resolve; });
    });
    await started;
    const second = withProjectClaimTransaction(root, async (tx) => tx.acquire(claim(root, 'run-two')));
    release?.();
    await first;
    await expect(second).rejects.toMatchObject({ code: 'PROJECT_CLAIM_CONFLICT' });
  });

  it.skipIf(process.platform === 'win32')('fails busy against another process and retains its committed claim after a crash', async () => {
    const root = await project();
    await withProjectClaimTransaction(root, async () => undefined);
    const child = spawn(process.execPath, [
      '--disable-warning=ExperimentalWarning', '--import', 'tsx', '--input-type=module', '-e',
      `
        import { withProjectClaimTransaction } from './src/shared/project-claim.ts';
        await withProjectClaimTransaction(process.argv[1], async tx => {
          tx.acquire({version:1,...tx.identity,kind:'portable',runId:'12345678-1234-1234-1234-123456789abc',createdAt:'2026-01-01T00:00:00.000Z'});
        });
        await withProjectClaimTransaction(process.argv[1], async () => {
          process.stdout.write('locked');
          await new Promise(() => { setInterval(() => {}, 1000); });
        });
      `,
      root,
    ], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      expect((await once(child.stdout, 'data'))[0].toString()).toBe('locked');
      await expect(withProjectClaimTransaction(root, async () => undefined))
        .rejects.toMatchObject({ code: 'PROJECT_CLAIM_BUSY' });
    } finally {
      child.kill('SIGKILL');
      await once(child, 'exit');
    }
    await withProjectClaimTransaction(root, async (tx) => {
      expect(tx.read()).toMatchObject({ kind: 'portable', runId: '12345678-1234-1234-1234-123456789abc' });
    });
  });

  it.skipIf(process.platform === 'win32')('admits only one of two separate processes racing to claim a project', async () => {
    const root = await project();
    await withProjectClaimTransaction(root, async (tx) => tx.enableProtocol('2026-01-01T00:00:00.000Z'));
    const script = `
      import { acquireProjectRunClaim } from './src/shared/project-coordination.ts';
      try {
        await acquireProjectRunClaim(process.argv[1], 'managed', process.argv[2]);
        process.stdout.write('acquired');
      } catch (error) {
        process.stdout.write(error.code || 'unexpected');
      }
    `;
    const run = (id: string) => execFileAsync(process.execPath, [
      '--disable-warning=ExperimentalWarning', '--import', 'tsx', '--input-type=module',
      '-e', script, root, id,
    ], { cwd: process.cwd() });
    const results = await Promise.all([run('process-one'), run('process-two')]);
    const outcomes = results.map((result) => result.stdout);
    expect(outcomes.filter((result) => result === 'acquired')).toHaveLength(1);
    expect(outcomes.filter((result) => ['PROJECT_CLAIM_CONFLICT', 'PROJECT_CLAIM_BUSY'].includes(result))).toHaveLength(1);
    await withProjectClaimTransaction(root, async (tx) => {
      expect(['process-one', 'process-two']).toContain(tx.read()?.runId);
    });
  });

  it('publishes a fully initialized database to concurrent first-time processes', async () => {
    const root = await project();
    const script = `
      import { withProjectClaimTransaction } from './src/shared/project-claim.ts';
      try {
        await withProjectClaimTransaction(process.argv[1], async tx => {
          tx.acquire({version:1,...tx.identity,kind:'managed',runId:process.argv[2],createdAt:'2026-01-01T00:00:00.000Z'});
        });
        process.stdout.write('acquired');
      } catch (error) {
        process.stdout.write(error.code || 'unexpected');
      }
    `;
    const run = (id: string) => execFileAsync(process.execPath, [
      '--disable-warning=ExperimentalWarning', '--import', 'tsx', '--input-type=module',
      '-e', script, root, id,
    ], { cwd: process.cwd() });
    const results = await Promise.all([run('process-one'), run('process-two')]);
    const outcomes = results.map((result) => result.stdout);
    expect(outcomes.filter((result) => result === 'acquired')).toHaveLength(1);
    expect(outcomes.filter((result) => ['PROJECT_CLAIM_CONFLICT', 'PROJECT_CLAIM_BUSY'].includes(result))).toHaveLength(1);
    await withProjectClaimTransaction(root, async (tx) => {
      expect(['process-one', 'process-two']).toContain(tx.read()?.runId);
    });
  });

  it('rejects corrupt, unknown, symlinked and hard-linked databases', async () => {
    const corrupt = await project();
    await mkdir(join(corrupt, '.loom'));
    await writeFile(join(corrupt, '.loom', 'project-claim.sqlite'), 'not sqlite');
    await expect(withProjectClaimTransaction(corrupt, async () => undefined))
      .rejects.toMatchObject({ code: 'PROJECT_CLAIM_UNSAFE' });

    const incomplete = await project();
    await mkdir(join(incomplete, '.loom'));
    await writeFile(join(incomplete, '.loom', 'project-claim.sqlite'), '');
    await expect(withProjectClaimTransaction(incomplete, async () => undefined))
      .rejects.toMatchObject({ code: 'PROJECT_CLAIM_UNSAFE' });

    const unknown = await project();
    await withProjectClaimTransaction(unknown, async () => undefined);
    const path = join(unknown, '.loom', 'project-claim.sqlite');
    const db = new DatabaseSync(path);
    db.exec('PRAGMA user_version = 99');
    db.close();
    await expect(withProjectClaimTransaction(unknown, async () => undefined))
      .rejects.toMatchObject({ code: 'PROJECT_CLAIM_UNSAFE' });

    const linked = await project();
    await mkdir(join(linked, '.loom'));
    await symlink(path, join(linked, '.loom', 'project-claim.sqlite'));
    await expect(withProjectClaimTransaction(linked, async () => undefined))
      .rejects.toMatchObject({ code: 'PROJECT_CLAIM_UNSAFE' });
    const hard = await project();
    await mkdir(join(hard, '.loom'));
    await link(path, join(hard, '.loom', 'project-claim.sqlite'));
    await expect(withProjectClaimTransaction(hard, async () => undefined))
      .rejects.toMatchObject({ code: 'PROJECT_CLAIM_UNSAFE' });
  });

  it('rejects invalid claim rows and unexpected database schema', async () => {
    const root = await project();
    await withProjectClaimTransaction(root, async (tx) => tx.acquire(claim(root)));
    const db = new DatabaseSync(join(root, '.loom', 'project-claim.sqlite'));
    db.prepare('UPDATE claim SET document = ?').run('{"version":99}');
    db.close();
    await expect(withProjectClaimTransaction(root, async () => undefined))
      .rejects.toMatchObject({ code: 'PROJECT_CLAIM_UNSAFE' });

    const schemaRoot = await project();
    await withProjectClaimTransaction(schemaRoot, async () => undefined);
    const altered = new DatabaseSync(join(schemaRoot, '.loom', 'project-claim.sqlite'));
    altered.exec('CREATE TABLE unexpected (value TEXT)');
    altered.close();
    await expect(withProjectClaimTransaction(schemaRoot, async () => undefined))
      .rejects.toMatchObject({ code: 'PROJECT_CLAIM_UNSAFE' });
  });

  it('rejects a claim copied to a different project identity', async () => {
    const first = await project();
    await withProjectClaimTransaction(first, async (tx) => tx.acquire(claim(first)));
    const second = await project();
    await mkdir(join(second, '.loom'));
    await copyFile(join(first, '.loom', 'project-claim.sqlite'), join(second, '.loom', 'project-claim.sqlite'));
    await expect(withProjectClaimTransaction(second, async () => undefined))
      .rejects.toMatchObject({ code: 'PROJECT_CLAIM_UNSAFE' });
  });
});
