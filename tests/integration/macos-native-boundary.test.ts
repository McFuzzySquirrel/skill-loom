import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const observationSchema = z.strictObject({
  operation: z.enum(['setsid', 'setpgid']),
  forkDenied: z.boolean(),
  escaped: z.boolean(),
  error: z.number().int().nonnegative(),
});

describe.skipIf(process.platform !== 'darwin' || process.env.LOOM_TEST_MACOS_BOUNDARY !== '1')(
  'macOS native boundary feasibility (not an execution backend)',
  () => {
    it('demonstrates whether sandbox process-control denial actually prevents group escape', async () => {
      const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-macos-boundary-')));
      try {
        const executable = join(root, 'boundary-probe');
        await execute('/usr/bin/clang', [
          '-Wall', '-Wextra', '-Werror', '-o', executable,
          resolve('tests/fixtures/macos-native-boundary.c'),
        ], { timeout: 60_000 });
        const run = async (profile?: string) => {
          const result = await execute(
            profile === undefined ? executable : '/usr/bin/sandbox-exec',
            profile === undefined ? [] : ['-f', profile, executable],
            { timeout: 15_000, maxBuffer: 64 * 1024 },
          );
          const observations = result.stdout.trim().split(/\r?\n/).map((line) =>
            observationSchema.parse(JSON.parse(line) as unknown));
          expect(observations.map((observation) => observation.operation)).toEqual(['setsid', 'setpgid']);
          return observations;
        };
        const baseline = await run();
        expect(baseline.every((observation) => !observation.forkDenied && observation.escaped && observation.error === 0)).toBe(true);

        const groupPolicy = join(root, 'group-control.sb');
        await writeFile(groupPolicy, '(version 1)\n(allow default)\n(deny process-info-setcontrol)\n');
        const groupControl = await run(groupPolicy);
        console.info(JSON.stringify({ platform: 'darwin', candidate: 'process-info-setcontrol', observations: groupControl }));
        // A successful sandbox invocation is not proof of process containment.
        expect(groupControl.every((observation) => !observation.forkDenied && observation.escaped)).toBe(true);

        const forkPolicy = join(root, 'no-fork.sb');
        await writeFile(forkPolicy, '(version 1)\n(allow default)\n(deny process-fork)\n');
        const noFork = await run(forkPolicy);
        console.info(JSON.stringify({ platform: 'darwin', candidate: 'process-fork-denial', observations: noFork }));
        expect(noFork.every((observation) => observation.forkDenied && !observation.escaped && observation.error !== 0)).toBe(true);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }, 90_000);
  },
);
