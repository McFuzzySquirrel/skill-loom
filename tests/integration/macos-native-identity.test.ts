import { execFile } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { chmod, link, lstat, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const identitySchema = z.strictObject({
  realUid: z.number().int().nonnegative(),
  effectiveUid: z.number().int().nonnegative(),
});

describe.skipIf(process.platform !== 'darwin' || process.env.LOOM_TEST_PRIVILEGED_NATIVE !== '1')(
  'disposable macOS identity feasibility (not an execution backend)',
  () => {
    it('measures protected content access and inherited-sandbox setuid execution', async () => {
      if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_OS !== 'macOS') {
        throw new Error('Privileged native fixtures are restricted to explicitly opted-in disposable macOS runners.');
      }
      const ownerUid = process.getuid!();
      const ownerGid = process.getgid!();
      if (ownerUid === 0) throw new Error('The CI test driver must be unprivileged.');
      const sudo = (args: string[]) => execute('/usr/bin/sudo', ['-n', ...args], {
        timeout: 30_000, maxBuffer: 64 * 1024, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
      });
      await sudo(['/usr/bin/true']);
      const root = await realpath(await mkdtemp('/private/tmp/loom-native-identity-'));
      const account = `loom_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
      const record = `/Users/${account}`;
      const marker = `Loom disposable fixture ${randomUUID()}`;
      let created = false;
      let rootOwned = false;
      let operationError: unknown;
      const files = ['launch', 'identity', 'setuid-identity', 'profile.sb', 'reviewed.txt', 'exec-child', 'setuid-alias', 'try-write']
        .map((name) => join(root, name));
      try {
        const users = await execute('/usr/bin/dscl', ['.', '-list', '/Users', 'UniqueID'], { timeout: 15_000 });
        if (users.stdout.trim().split(/\r?\n/).some((line) => line.trim().split(/\s+/)[0] === account)) {
          throw new Error('The disposable fixture account already exists; refusing to alter it.');
        }
        const usedUids = new Set(users.stdout.trim().split(/\r?\n/).map((line) => Number(line.trim().split(/\s+/).at(-1))));
        let uid = randomInt(10000, 60001);
        for (let attempt = 0; usedUids.has(uid); attempt++) {
          if (attempt > 100) throw new Error('Could not allocate a disposable fixture UID.');
          uid = randomInt(10000, 60001);
        }
        const source = resolve('tests/fixtures/macos-native-identity.c');
        await execute('/usr/bin/clang', ['-Wall', '-Wextra', '-Werror', '-o', files[0]!, source], { timeout: 60_000 });
        for (const output of [files[1]!, files[2]!]) {
          await execute('/usr/bin/clang', ['-Wall', '-Wextra', '-Werror', '-DREPORT_IDENTITY', '-o', output, source], { timeout: 60_000 });
        }
        await execute('/usr/bin/clang', ['-Wall', '-Wextra', '-Werror', '-DEXEC_CHILD', '-o', files[5]!, source], { timeout: 60_000 });
        await execute('/usr/bin/clang', ['-Wall', '-Wextra', '-Werror', '-DTRY_WRITE', '-o', files[7]!, source], { timeout: 60_000 });
        await link(files[2]!, files[6]!);
        await writeFile(files[3]!, '(version 1)\n(allow default)\n');
        await writeFile(files[4]!, 'reviewed fixture content\n');
        await chmod(root, 0o711);
        for (const path of files) await chmod(path, path.endsWith('.sb') || path.endsWith('.txt') ? 0o444 : 0o755);
        rootOwned = true;
        await sudo(['/usr/sbin/chown', 'root:wheel', root, ...files]);
        await sudo(['/bin/chmod', '4755', files[2]!]);
        const setuid = await lstat(files[2]!);
        expect(setuid.uid).toBe(0);
        expect(setuid.mode & 0o4000).toBe(0o4000);

        created = true;
        await sudo(['/usr/bin/dscl', '.', '-create', record, 'RealName', marker]);
        await sudo(['/usr/bin/dscl', '.', '-create', record, 'AuthenticationAuthority', ';DisabledUser;']);
        await sudo(['/usr/bin/dscl', '.', '-create', record, 'UniqueID', String(uid)]);
        await sudo(['/usr/bin/dscl', '.', '-create', record, 'PrimaryGroupID', '65534']);
        await sudo(['/usr/bin/dscl', '.', '-create', record, 'UserShell', '/usr/bin/false']);
        await sudo(['/usr/bin/dscl', '.', '-create', record, 'NFSHomeDirectory', '/var/empty']);
        const registered = await execute('/usr/bin/dscl', ['.', '-list', '/Users', 'UniqueID'], { timeout: 15_000 });
        expect(registered.stdout.trim().split(/\r?\n/).filter((line) =>
          Number(line.trim().split(/\s+/).at(-1)) === uid)).toHaveLength(1);
        const launch = async (executable: string, args: string[] = []) =>
          sudo([files[0]!, String(uid), executable, ...args]);
        const baseline = identitySchema.parse(JSON.parse((await launch(files[1]!)).stdout) as unknown);
        expect(baseline).toEqual({ realUid: uid, effectiveUid: uid });
        expect((await launch('/bin/cat', [files[4]!])).stdout).toBe('reviewed fixture content\n');
        expect(JSON.parse((await launch(files[7]!, [files[4]!])).stdout) as unknown)
          .toEqual({ writeDenied: true, error: 13 });
        expect(await readFile(files[4]!, 'utf8')).toBe('reviewed fixture content\n');
        const privileged = identitySchema.parse(JSON.parse((await launch(files[2]!)).stdout) as unknown);
        expect(privileged).toEqual({ realUid: uid, effectiveUid: 0 });
        const sandboxed = identitySchema.parse(JSON.parse(
          (await launch('/usr/bin/sandbox-exec', ['-f', files[3]!, files[1]!])).stdout,
        ) as unknown);
        expect(sandboxed).toEqual({ realUid: uid, effectiveUid: uid });
        for (const target of [files[2]!, files[6]!]) {
          await expect(launch('/usr/bin/sandbox-exec', ['-f', files[3]!, target]))
            .rejects.toMatchObject({ stderr: expect.stringContaining('Operation not permitted') });
          const inherited = JSON.parse((await launch('/usr/bin/sandbox-exec', [
            '-f', files[3]!, files[5]!, target,
          ])).stdout) as unknown;
          expect(inherited).toEqual({
            forkAllowed: true, setsidAllowed: true, execDenied: true, error: 1,
          });
        }
        console.info(JSON.stringify({
          platform: 'darwin',
          candidate: 'distinct-uid-with-inherited-sandbox',
          rootOwnedContentWriteDenied: true,
          forkAndSetsidAllowed: true,
          directInheritedAndHardlinkedSetuidExecDenied: true,
        }));
      } catch (error) {
        operationError = error;
        throw error;
      } finally {
        const cleanupErrors: unknown[] = [];
        if (created) {
          try {
            const current = await sudo(['/usr/bin/dscl', '.', '-read', record, 'RealName']);
            if (current.stdout.trim().replace(/\s+/g, ' ') !== `RealName: ${marker}`) {
              throw new Error('Fixture account marker changed; refusing account deletion.');
            }
            await sudo(['/usr/bin/dscl', '.', '-delete', record]);
          } catch (error) { cleanupErrors.push(error); }
        }
        if (rootOwned) {
          try { await sudo(['/usr/sbin/chown', `${ownerUid}:${ownerGid}`, root, ...files]); }
          catch (error) { cleanupErrors.push(error); }
        }
        try { await rm(root, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(error); }
        if (cleanupErrors.length > 0) {
          throw new AggregateError(
            operationError === undefined ? cleanupErrors : [operationError, ...cleanupErrors],
            'Disposable native identity operation or cleanup failed.',
          );
        }
      }
    }, 180_000);
  },
);
