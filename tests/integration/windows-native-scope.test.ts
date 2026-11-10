import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execute = promisify(execFile);

describe.skipIf(process.platform !== 'win32' || process.env.LOOM_TEST_PRIVILEGED_NATIVE !== '1')(
  'disposable Windows native scope feasibility (not an execution backend)',
  () => {
    it('protects reviewed bytes and terminates original Job members after finish, abort and broker death', async () => {
      if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_OS !== 'Windows' ||
          process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
        throw new Error('Native fixtures require explicitly opted-in disposable hosted Windows runners.');
      }
      const root = await mkdtemp(join(tmpdir(), 'loom-windows-native-'));
      try {
        const systemRoot = process.env.SystemRoot;
        if (!systemRoot) throw new Error('Windows system directory is unavailable.');
        const result = await execute(join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
          '-NoLogo', '-NoProfile', '-NonInteractive', '-File',
          resolve('tests/fixtures/windows-native-scope.ps1'), '-Root', root,
        ], { timeout: 90_000, maxBuffer: 128 * 1024, windowsHide: true });
        expect(result.stderr).toBe('');
        const evidence: unknown = JSON.parse(result.stdout);
        expect(evidence).toEqual({
          platform: 'windows', candidate: 'appcontainer-job',
          protectedWritesDenied: true, breakawayDenied: true,
          brokerHandleDuplicationDenied: true, originalProcessesTerminated: true,
          originalConsoleHostsTerminated: true,
          conptyInputOutputResizeVerified: true, conptyBrokerDeathVerified: true,
          conptyInheritedStdioVerified: true,
          actualOwnerDeathVerified: true,
          modes: ['finish', 'abort', 'broker-death', 'owner-death'],
        });
        console.info(JSON.stringify(evidence));
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }, 120_000);
  },
);
