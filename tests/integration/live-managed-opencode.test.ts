import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseManagedProbeArgs } from '../../scripts/live-managed-opencode.js';
import { runLocalCommand } from '../../src/server/preflight/auth.js';

let root: string;
const retained: string[] = [];

// The subprocess fixture supplies only the executable. Ownership, preflight,
// persistence, orchestration, PTYs, signals and cleanup use production code.
const fixture = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const mode = process.env.LOOM_MANAGED_FIXTURE_MODE;
const state = process.env.LOOM_MANAGED_FIXTURE_STATE;
const sessions = () => fs.existsSync(state) ? fs.readFileSync(state, 'utf8').trim().split('\\n').filter(Boolean) : [];
if (args[0] === '--version') { console.log(mode === 'old-version' ? '2.2.4' : '2.2.6'); process.exit(0); }
if (args[0] === 'auth') {
  console.log(JSON.stringify([{ provider: 'fixture', connections: [{ type: 'oauth' }] }]));
  process.exit(0);
}
if (args[0] === 'session') {
  if (args[1] === 'list') console.log(sessions().join('\\n'));
  else if (args[1] === 'delete') {
    if (mode === 'cleanup-failure') process.exit(3);
    fs.writeFileSync(state, sessions().filter(id => id !== args[2]).join('\\n'));
  } else process.exit(2);
  process.exit(0);
}
if (args[0] !== 'run') process.exit(9);
const sessionId = args[args.indexOf('--session') + 1];
if (!sessions().includes(sessionId)) fs.appendFileSync(state, sessionId + '\\n');
const prompt = args[args.length - 1];
const scenario = /managed-(chain|pause|abort|recovery)-/.exec(prompt)[1];
fs.appendFileSync(state + '.launches', JSON.stringify({ scenario, pid: process.pid }) + '\\n');
const osc = (state, id) => process.stdout.write('\\x1b]7501;state=' + state + (id ? ';id=' + id : '') + '\\x07');
if (mode === 'idle-only') {
  osc('idle');
  setTimeout(() => process.exit(0), 100);
} else {
  osc('working');
  osc('working', sessionId);
  if (mode === 'nonzero') setTimeout(() => process.exit(7), 100);
  else if (mode !== 'timeout') {
    setTimeout(() => {
      const first = path.join(process.cwd(), 'managed-' + scenario + '-first.txt');
      const second = path.join(process.cwd(), 'managed-' + scenario + '-second.txt');
      const token = /LOOM_[A-F0-9]{32}/.exec(prompt)?.[0];
      if (token) fs.writeFileSync(first, token + (mode === 'wrong-artifact' ? 'wrong' : '') + '\\n', { flag: 'wx' });
      else fs.writeFileSync(second, fs.readFileSync(first), { flag: 'wx' });
      if (mode === 'zero-without-idle') process.exit(0);
      osc('clear', sessionId);
      osc('idle');
      setInterval(() => {}, 1000);
    }, 250);
  } else setInterval(() => {}, 1000);
}
`;

interface Evidence {
  result: string;
  checks: Array<{ id: string; status: string; code?: string }>;
  launches: Array<{ scenario: string; args: string[]; sessionId: string; advancementEdges: number }>;
  runs: Array<{ status: string; reason: string; steps: Array<{ reason: string; status: string }> }>;
  cleanup: {
    trackedProcessesRemaining: number;
    ptySessionsRemaining: number;
    temporaryRootRemoved: boolean;
    profileReleased: boolean;
    errors: string[];
  };
  retainedTemporaryRoot?: string;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loom-managed-fixture-'));
  await mkdir(join(root, 'bin'));
  const executable = join(root, 'bin', 'opencode');
  await writeFile(executable, fixture);
  await chmod(executable, 0o755);
});

afterEach(async () => {
  for (const directory of retained.splice(0)) {
    expect(directory.startsWith(join(tmpdir(), 'loom-managed-opencode-'))).toBe(true);
    await rm(directory, { recursive: true, force: true });
  }
  await rm(root, { recursive: true, force: true });
});

async function runFixture(mode: string, extraArgs: string[] = []) {
  const output = join(root, 'evidence.json');
  const result = await runLocalCommand({
    executable: process.execPath,
    args: ['--import', 'tsx', 'scripts/live-managed-opencode.ts', '--confirm-live',
      '--timeout-ms', '1500', '--evidence', output, ...extraArgs],
    cwd: process.cwd(), timeoutMs: 20_000, maxOutputBytes: 1024 * 1024,
    env: {
      ...process.env,
      PATH: `${join(root, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
      LOOM_MANAGED_FIXTURE_MODE: mode,
      LOOM_MANAGED_FIXTURE_STATE: join(root, 'sessions'),
      LOOM_LIVE_OPENCODE_MODEL: 'fixture/model',
      LOOM_CONFIG_DIR: join(root, 'must-not-use-profile'),
      COPILOT_HOME: join(root, 'must-not-use-copilot'),
    },
  });
  expect(result.timedOut, result.stderr).toBe(false);
  const text = await readFile(output, 'utf8');
  const evidence = JSON.parse(text) as Evidence;
  if (evidence.retainedTemporaryRoot) retained.push(evidence.retainedTemporaryRoot);
  return { result, evidence, text };
}

describe('managed acceptance arguments', () => {
  it('requires explicit live approval and rejects invalid bounds and unknown flags', () => {
    expect(() => parseManagedProbeArgs([])).toThrow('Pass --confirm-live');
    for (const args of [
      ['--timeout-ms', '499'], ['--timeout-ms', '600001'], ['--timeout-ms', 'NaN'],
      ['--evidence'], ['--evidence', '--confirm-live'], ['--bypass-cli-guard'],
    ]) expect(() => parseManagedProbeArgs(['--confirm-live', ...args])).toThrow();
    expect(parseManagedProbeArgs(['--confirm-live', '--evidence', 'probe.json']).evidence)
      .toBe(resolve('probe.json'));
  });
});

describe.skipIf(process.platform === 'win32')('managed acceptance subprocess fixture (not live evidence)', () => {
  it('runs the production two-step path, controls and restart without leaking prompts', async () => {
    const { result, evidence, text } = await runFixture('signal');
    expect(result.exitCode, text).toBe(0);
    expect(evidence.result).toBe('passed');
    expect(evidence.checks.map((check) => check.status)).toEqual(['passed', 'passed', 'passed', 'passed']);
    expect(evidence.launches.map((item) => item.scenario)).toEqual(['chain', 'chain', 'pause', 'abort', 'recovery']);
    expect(evidence.launches.every((item) => item.args[0] === 'run')).toBe(true);
    expect(evidence.launches[0]!.sessionId).toBe(evidence.launches[1]!.sessionId);
    expect(evidence.runs.map((run) => run.status)).toEqual(['completed', 'aborted', 'aborted', 'interrupted']);
    expect(evidence.cleanup).toMatchObject({
      trackedProcessesRemaining: 0, ptySessionsRemaining: 0, temporaryRootRemoved: true, profileReleased: true, errors: [],
    });
    expect(text).not.toMatch(/LOOM_[A-F0-9]{32}|Create the new regular file|Use file editing tools/);
    expect(text).not.toContain(root);
    await expect(readFile(join(root, 'must-not-use-profile', 'config.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(root, 'must-not-use-copilot', 'config.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 30_000);

  it.each([
    ['zero-without-idle', 'MISSING_COMPLETION_SIGNAL'],
    ['idle-only', 'MISSING_COMPLETION_SIGNAL'],
    ['nonzero', 'PROCESS_EXITED_NONZERO'],
    ['timeout', 'AUTOMATIC_TIMEOUT'],
  ])('fails closed without retry or step two for %s', async (mode, reason) => {
    const { result, evidence, text } = await runFixture(mode);
    expect(result.exitCode, text).toBe(1);
    expect(evidence.result).toBe('failed');
    expect(evidence.launches).toHaveLength(1);
    expect(evidence.runs[0]?.steps[0]?.reason).toContain(reason);
    expect(evidence.checks.slice(1).every((check) => check.status === 'not-run')).toBe(true);
    expect(evidence.cleanup).toMatchObject({
      trackedProcessesRemaining: 0, ptySessionsRemaining: 0, temporaryRootRemoved: true,
    });
  });

  it('fails and retains diagnostic state when session cleanup cannot be verified', async () => {
    const { result, evidence, text } = await runFixture('cleanup-failure');
    expect(result.exitCode, text).toBe(1);
    expect(evidence.result).toBe('failed');
    expect(evidence.checks.every((check) => check.status === 'passed'), text).toBe(true);
    expect(evidence.cleanup.temporaryRootRemoved).toBe(false);
    expect(evidence.cleanup.errors).toContain('SESSION_DELETE_FAILED');
    expect(evidence.retainedTemporaryRoot).toBeDefined();
  }, 30_000);

  it('rejects unsupported prerequisites without starting a harness run', async () => {
    const { result, evidence } = await runFixture('old-version');
    expect(result.exitCode).toBe(1);
    expect(evidence.checks[0]).toMatchObject({ status: 'failed', code: 'OPENCODE_VERSION_UNSUPPORTED' });
    expect(evidence.launches).toHaveLength(0);
    expect(evidence.cleanup.temporaryRootRemoved).toBe(true);
  });

  it('does not equate completion signals with correct artifacts', async () => {
    const { result, evidence } = await runFixture('wrong-artifact');
    expect(result.exitCode).toBe(1);
    expect(evidence.checks[0]).toMatchObject({ status: 'failed', code: 'ARTIFACT_MISMATCH' });
    expect(evidence.runs[0]?.status).toBe('completed');
    expect(evidence.cleanup.temporaryRootRemoved).toBe(true);
  });

  it('absorbs repeated termination signals until cleanup and evidence finish', async () => {
    const output = join(root, 'interrupted.json');
    const state = join(root, 'sessions');
    const child = spawn(process.execPath, [
      '--import', 'tsx', 'scripts/live-managed-opencode.ts', '--confirm-live', '--evidence', output,
    ], {
      cwd: process.cwd(), stdio: 'ignore',
      env: {
        ...process.env, PATH: `${join(root, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
        LOOM_MANAGED_FIXTURE_MODE: 'timeout', LOOM_MANAGED_FIXTURE_STATE: state,
      },
    });
    const exited = new Promise<number | null>((accept, reject) => {
      child.once('error', reject);
      child.once('exit', accept);
    });
    const force = setTimeout(() => child.kill('SIGKILL'), 15_000);
    try {
      const deadline = Date.now() + 8000;
      while (true) {
        try { await readFile(`${state}.launches`); break; }
        catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
          if (Date.now() >= deadline) throw new Error('Fixture did not launch.');
          await delay(25);
        }
      }
      child.kill('SIGTERM');
      await delay(25);
      child.kill('SIGTERM');
      expect(await exited).toBe(1);
      const evidence = JSON.parse(await readFile(output, 'utf8')) as Evidence;
      if (evidence.retainedTemporaryRoot) retained.push(evidence.retainedTemporaryRoot);
      expect(evidence.checks[0]).toMatchObject({ status: 'failed', code: 'INTERRUPTED' });
      expect(evidence.cleanup).toMatchObject({
        trackedProcessesRemaining: 0, ptySessionsRemaining: 0, temporaryRootRemoved: true,
      });
    } finally {
      child.kill('SIGTERM');
      await exited;
      clearTimeout(force);
    }
  }, 20_000);
});
