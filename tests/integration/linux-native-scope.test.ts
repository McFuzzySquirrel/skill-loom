import { execFile, spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execute = promisify(execFile);

async function processIdentity(pid: number): Promise<string | null> {
  let value: string;
  try { value = await readFile(`/proc/${pid}/stat`, 'utf8'); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
  const fields = value.slice(value.lastIndexOf(')') + 2).trim().split(/\s+/);
  const start = fields[19];
  if (start === undefined || !/^[0-9]+$/.test(start)) throw new Error('Invalid kernel process start-time evidence.');
  return start;
}

describe.skipIf(process.platform !== 'linux' || process.env.LOOM_TEST_PRIVILEGED_NATIVE !== '1')(
  'disposable Linux native scope feasibility (not an execution backend)',
  () => {
    it('protects mounts and reaps namespace descendants after finish, abort and owner death', async () => {
      if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_OS !== 'Linux' ||
          process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
        throw new Error('Privileged native fixtures require explicitly opted-in disposable hosted Linux runners.');
      }
      const uid = process.getuid!();
      const gid = process.getgid!();
      if (uid === 0 || gid === 0) throw new Error('The CI test driver must have an unprivileged UID and GID.');
      const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-linux-native-')));
      try {
        const binary = join(root, 'scope');
        const reviewed = join(root, 'reviewed.txt');
        await execute('/usr/bin/cc', [
          '-Wall', '-Wextra', '-Werror', '-o', binary, resolve('tests/fixtures/linux-native-scope.c'),
        ], { timeout: 60_000 });
        await chmod(root, 0o711);
        await writeFile(reviewed, 'reviewed fixture content\n');
        await chmod(reviewed, 0o666);
        for (const mode of ['finish', 'abort', 'owner-death'] as const) {
          const owner = spawn(process.execPath, [
            resolve('tests/fixtures/native-fixture-owner.cjs'),
            '/usr/bin/unshare', '--user', `--map-users=0:${uid}:1`, `--map-groups=0:${gid}:1`,
            '--setuid=0', '--setgid=0', '--mount', '--pid', '--fork',
            '--kill-child=KILL', '--mount-proc', binary, reviewed,
          ], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } });
          let output = '';
          let errors = '';
          let timer: ReturnType<typeof setTimeout> | undefined;
          const ended = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
            owner.once('error', reject);
            owner.once('close', (code, signal) => resolveExit({ code, signal }));
          });
          const deadline = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Linux native ${mode} timed out: ${errors}`)), 15_000);
          });
          try {
            const ready = new Promise<void>((resolveReady, reject) => {
              owner.stdout.on('data', (chunk: Buffer) => {
                if (Buffer.byteLength(output) + chunk.length > 64 * 1024) return reject(new Error('Fixture output exceeded its bound.'));
                output += chunk.toString('utf8');
                if (output.includes('ACTORS_READY\n')) resolveReady();
              });
              owner.stderr.on('data', (chunk: Buffer) => {
                if (Buffer.byteLength(errors) + chunk.length > 64 * 1024) return reject(new Error('Fixture diagnostics exceeded their bound.'));
                errors += chunk.toString('utf8');
              });
              void ended.then(() => reject(new Error(`Native namespace exited before readiness: ${errors}`)), reject);
            });
            await Promise.race([ready, deadline]);
            const census = await execute('/bin/ps', ['-eo', 'pid=,ppid=,comm='], { timeout: 5000, maxBuffer: 512 * 1024 });
            const rows = census.stdout.trim().split(/\r?\n/).map((line) => line.trim().split(/\s+/));
            const descendants = new Set<number>([owner.pid!]);
            for (;;) {
              const before = descendants.size;
              for (const row of rows) if (descendants.has(Number(row[1]))) descendants.add(Number(row[0]));
              if (descendants.size === before) break;
            }
            const actors = rows.filter((row) => row[2] === 'scope' && descendants.has(Number(row[0])));
            expect(actors).toHaveLength(4);
            const identities = await Promise.all(actors.map(async (row) => ({
              pid: Number(row[0]), start: await processIdentity(Number(row[0])),
            })));
            expect(identities.every((identity) => identity.start !== null)).toBe(true);
            if (mode === 'owner-death') owner.kill('SIGKILL');
            else owner.stdin.write(mode === 'finish' ? 'F' : 'A');
            const exit = await Promise.race([ended, deadline]);
            if (mode === 'owner-death') expect(exit.signal).toBe('SIGKILL');
            else expect(exit).toEqual({ code: 0, signal: null });
            expect(errors).toBe('');
            for (const identity of identities) {
              expect(await processIdentity(identity.pid)).not.toBe(identity.start);
            }
            expect(await readFile(reviewed, 'utf8')).toBe('reviewed fixture content\n');
            console.info(JSON.stringify({
              platform: 'linux', candidate: 'private-user-mount-pid-namespace', mode,
              readonlyMountEnforced: true, capabilityAndNestedNamespaceBypassDenied: true,
              namespaceRootMapsToUnprivilegedHostIdentity: true,
              originalProcessesReaped: true,
            }));
          } finally {
            clearTimeout(timer);
            owner.stdin.end();
            if (owner.exitCode === null && owner.signalCode === null) owner.kill('SIGKILL');
          }
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }, 180_000);
  },
);
