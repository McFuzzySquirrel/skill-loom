import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.platform === 'win32')('live execution probe scope', () => {
  it('never invokes Copilot in OpenCode-only mode and keeps evidence separate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-live-scope-'));
    try {
      const bin = join(root, 'bin');
      await mkdir(bin);
      const sentinel = join(root, 'copilot-invoked');
      const copilot = join(bin, 'copilot');
      await writeFile(copilot, '#!/bin/sh\nprintf invoked > "$COPILOT_SENTINEL"\nexit 1\n');
      await chmod(copilot, 0o755);
      const env = {
        PATH: bin,
        HOME: root,
        XDG_CACHE_HOME: join(root, 'cache'),
        COPILOT_SENTINEL: sentinel,
      };
      const evidencePath = join(root, 'opencode.json');
      const run = (args: string[]) => spawnSync(
        process.execPath,
        ['--import', 'tsx', resolve('scripts/live-execution.ts'), ...args],
        { env, encoding: 'utf8', timeout: 30_000 },
      );
      const scoped = run(['--harness', 'opencode', '--evidence', evidencePath]);
      expect(scoped.status, scoped.stderr).toBe(1);
      const evidence = JSON.parse(await readFile(evidencePath, 'utf8')) as {
        scope: string;
        result: string;
        prerequisites: Record<string, unknown>;
        harnesses: Record<string, unknown>;
        checks: Array<{ id: string; status: string }>;
        cleanup: { temporaryRootRemoved: boolean; processesRemaining: number; ptySessionsRemaining: number };
      };
      expect(evidence.scope).toBe('opencode');
      expect(evidence.result).toBe('failed');
      expect(evidence.prerequisites).toHaveProperty('opencode');
      expect(evidence.prerequisites).not.toHaveProperty('copilot');
      expect(evidence.harnesses).not.toHaveProperty('copilot');
      expect(evidence.checks).toContainEqual(expect.objectContaining({ id: 'opencode.product-advancement', status: 'failed' }));
      expect(evidence.checks.some((check) => check.id.startsWith('copilot.'))).toBe(false);
      expect(evidence.cleanup).toMatchObject({ temporaryRootRemoved: true, processesRemaining: 0, ptySessionsRemaining: 0 });
      await expect(readFile(sentinel)).rejects.toMatchObject({ code: 'ENOENT' });

      const combinedPath = join(root, 'both.json');
      const combined = run(['--evidence', combinedPath]);
      expect(combined.status, combined.stderr).toBe(1);
      const both = JSON.parse(await readFile(combinedPath, 'utf8')) as {
        scope: string;
        prerequisites: Record<string, unknown>;
      };
      expect(both.scope).toBe('both');
      expect(both.prerequisites).toHaveProperty('copilot');
      expect(await readFile(sentinel, 'utf8')).toBe('invoked');

      const invalid = run(['--harness', 'copilot', '--evidence', evidencePath]);
      expect(invalid.status).toBe(1);
      expect(invalid.stderr).toContain('Usage:');
      expect(JSON.parse(await readFile(evidencePath, 'utf8'))).toEqual(evidence);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 90_000);

  it('fails OpenCode-only verification when the captured signal cannot advance the product', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-live-signal-'));
    try {
      const bin = join(root, 'bin');
      await mkdir(bin);
      const opencode = join(bin, 'opencode');
      await writeFile(opencode, `#!/bin/sh
case "$1" in
  --version) printf '2.2.5\\n'; exit 0 ;;
  auth) printf '[]\\n'; exit 0 ;;
  session)
    if [ "$2" = list ] && [ "$FAKE_LIST_FAIL" = 1 ]; then exit 1; fi
    exit 0 ;;
esac
/bin/sleep 0.1
if [ "$FAKE_EARLY_TOKEN" = 1 ]; then printf 'PINEAPPLE\\r\\n'; fi
printf '\\033]7501;state=working'
if [ "$FAKE_C1" = 1 ]; then printf '\\302\\234'; else printf '\\007'; fi
if [ "$FAKE_CLEAR" = 1 ]; then printf '\\033]7501;state=clear\\007'; fi
if [ "$FAKE_POST_CLEAR" = 1 ]; then
  printf 'PINEAPPLE\\r\\n\\033]7501;state=idle\\007\\033]7501;state=clear\\007'
else
  if [ "$FAKE_EARLY_TOKEN" != 1 ]; then printf 'PINEAPPLE\\r\\n'; fi
  printf '\\033]7501;state=idle'
  if [ "$FAKE_C1" = 1 ]; then printf '\\302\\234'; else printf '\\007'; fi
fi
/bin/sleep 1
`);
      await chmod(opencode, 0o755);
      for (const scenario of ['working-idle', 'c1-terminator', 'clear', 'post-clear', 'early-token', 'unverified-cleanup'] as const) {
        const evidencePath = join(root, `${scenario}.json`);
        const result = spawnSync(process.execPath, [
          '--import', 'tsx', resolve('scripts/live-execution.ts'),
          '--harness', 'opencode', '--evidence', evidencePath,
        ], {
          env: {
            PATH: bin,
            HOME: root,
            XDG_CACHE_HOME: join(root, 'cache'),
            OPENAI_API_KEY: 'fixture-only',
            LOOM_LIVE_OPENCODE_MODEL: 'fixture/model',
            FAKE_CLEAR: scenario === 'clear' ? '1' : '0',
            FAKE_C1: scenario === 'c1-terminator' ? '1' : '0',
            FAKE_POST_CLEAR: scenario === 'post-clear' ? '1' : '0',
            FAKE_EARLY_TOKEN: scenario === 'early-token' ? '1' : '0',
            FAKE_LIST_FAIL: scenario === 'unverified-cleanup' ? '1' : '0',
          },
          encoding: 'utf8',
          timeout: 30_000,
        });
        const passed = scenario === 'working-idle' || scenario === 'c1-terminator' || scenario === 'post-clear';
        expect(result.status, result.stderr).toBe(passed ? 0 : 1);
        const evidence = JSON.parse(await readFile(evidencePath, 'utf8')) as {
          scope: string;
          result: string;
          checks: Array<{ id: string; status: string }>;
          harnesses: { opencode: { signal: { productStateMachine: { advanced: boolean } } } };
          cleanup: { opencodeSessionCleanupPassed: boolean; opencodeSessions: Array<{ deleted: boolean; verifiedAbsent: boolean }> };
        };
        expect(evidence.scope).toBe('opencode');
        expect(evidence.result).toBe(passed ? 'passed' : 'failed');
        expect(evidence.harnesses.opencode.signal.productStateMachine.advanced).toBe(scenario !== 'clear');
        expect(evidence.checks).toContainEqual(expect.objectContaining({
          id: 'opencode.product-advancement',
          status: scenario === 'clear' ? 'failed' : 'passed',
        }));
        expect(evidence.checks).toContainEqual(expect.objectContaining({
          id: 'opencode.seed',
          status: scenario === 'early-token' ? 'failed' : 'passed',
        }));
        expect(evidence.cleanup.opencodeSessionCleanupPassed).toBe(scenario !== 'unverified-cleanup');
        if (scenario === 'unverified-cleanup') {
          expect(evidence.cleanup.opencodeSessions).toContainEqual(expect.objectContaining({
            existed: null, deleted: true, verifiedAbsent: false,
          }));
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 90_000);
});
