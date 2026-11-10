import { randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createConfigStore } from '../src/server/config/store.js';
import { createHarnessRegistry } from '../src/server/harness/registry.js';
import { runLocalCommand } from '../src/server/preflight/auth.js';
import { acquireProfileOwner, type ProfileOwner } from '../src/server/profile-owner.js';
import { createRunOwner, type RunOwner } from '../src/server/runs/owner.js';
import type { RunOrchestrator } from '../src/server/runs/orchestrator.js';
import { Osc7501Parser, Osc7501StateMachine } from '../src/server/runs/osc.js';
import { createRunStore } from '../src/server/runs/store.js';
import type { Run } from '../src/server/runs/model.js';
import { createLoomServices } from '../src/server/services.js';
import {
  TerminalManager,
  type CreateTerminalSessionOptions,
  type TerminalSession,
  type TerminalSpawnSpec,
} from '../src/server/terminal/pty.js';
import { MINIMUM_OPENCODE_VERSION, supportsOpenCodeVersion } from './opencode-version.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCENARIOS = ['chain', 'pause', 'abort', 'recovery'] as const;
type Scenario = typeof SCENARIOS[number];
const SANITIZED_ENV = [
  'OPENCODE', 'OPENCODE_SESSION_ID', 'OPENCODE_TERMINAL', 'OPENCODE_CONFIG',
  'OPENCODE_CONFIG_CONTENT', 'OPENCODE_CONFIG_DIR', 'OPENCODE_WORKTREE_PATH', 'OPENCODE_DB',
];

export function parseManagedProbeArgs(args: readonly string[]) {
  let confirmed = false;
  let evidence = join(ROOT, 'docs/evidence/live-managed-opencode.json');
  let timeoutMs = 180_000;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--confirm-live') confirmed = true;
    else if (arg === '--evidence' && args[index + 1] && !args[index + 1]!.startsWith('--')) {
      evidence = resolve(args[++index]!);
    } else if (arg === '--timeout-ms' && /^\d+$/.test(args[index + 1] ?? '')) {
      timeoutMs = Number(args[++index]);
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 600_000) {
        throw new ProbeFailure('USAGE', '--timeout-ms must be between 500 and 600000.');
      }
    } else throw new ProbeFailure('USAGE', 'Use --confirm-live [--evidence PATH] [--timeout-ms 180000].');
  }
  if (!confirmed) {
    throw new ProbeFailure('LIVE_CONFIRMATION_REQUIRED',
      'Pass --confirm-live to approve paid model calls and temporary-project read/edit permissions. This is not a sandbox.');
  }
  return { evidence, timeoutMs };
}

class ProbeFailure extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

interface Check {
  id: string;
  status: 'passed' | 'failed' | 'not-run';
  code?: string;
  observed?: Record<string, boolean | number>;
}

interface SpawnEvidence {
  scenario: Scenario;
  executable: string;
  args: string[];
  sessionId: string | null;
  records: Array<{ state: string; recordId: string | null }>;
  recordsTruncated: boolean;
  advancementEdges: number;
  exitCode: number | null;
}

class ObservedTerminals extends TerminalManager {
  scenario: Scenario = 'chain';
  readonly spawns: SpawnEvidence[] = [];
  readonly sessions: TerminalSession[] = [];

  override createSession(spec: TerminalSpawnSpec, options: CreateTerminalSessionOptions = {}) {
    if (this.spawns.length >= 8) throw new ProbeFailure('SPAWN_LIMIT', 'The probe exceeded its expected launch budget.');
    const session = super.createSession(spec, options);
    this.sessions.push(session);
    const sessionIndex = spec.args.indexOf('--session');
    const sessionId = sessionIndex < 0 ? null : spec.args[sessionIndex + 1] ?? null;
    const evidence: SpawnEvidence = {
      scenario: this.scenario,
      executable: basename(spec.executable),
      args: spec.args.map((arg, index) =>
        (index === 0 && arg === 'run') || arg.startsWith('--') || (sessionIndex >= 0 && index === sessionIndex + 1)
          ? arg : '<redacted>'),
      sessionId,
      records: [],
      recordsTruncated: false,
      advancementEdges: 0,
      exitCode: null,
    };
    this.spawns.push(evidence);
    const parser = new Osc7501Parser();
    const machine = new Osc7501StateMachine();
    session.onData((chunk) => {
      for (const event of parser.push(chunk)) {
        if (evidence.records.length < 64) {
          evidence.records.push({ state: event.state, recordId: event.sessionId });
        } else evidence.recordsTruncated = true;
      }
      evidence.advancementEdges += machine.push(chunk).filter((change) => change.advanced).length;
    });
    session.onExit((event) => { evidence.exitCode = event.exitCode; });
    return session;
  }
}

function requireCondition(condition: boolean, code: string): asserts condition {
  if (!condition) throw new ProbeFailure(code, 'Managed acceptance failed; inspect checks, launches and run summaries in the evidence.');
}

function errorCode(error: unknown): string {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string' &&
      /^[A-Z][A-Z0-9_]{0,100}$/.test(error.code)) return error.code;
  return 'MANAGED_PROBE_FAILED';
}

async function exists(path: string) {
  try { await lstat(path); return true; }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function artifactMatches(path: string, expected: string) {
  if (!await exists(path)) return false;
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) return false;
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.size > 4096 || opened.dev !== info.dev || opened.ino !== info.ino) return false;
    const buffer = Buffer.alloc(4097);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    return bytesRead <= 4096 && buffer.subarray(0, bytesRead).toString('utf8') === expected;
  } finally { await file.close(); }
}

function summarize(run: Run) {
  return {
    id: run.id, status: run.status, reason: run.reason, currentStepIndex: run.currentStepIndex,
    sessionId: run.sessionId,
    steps: run.steps.map((step) => ({
      id: step.id, status: step.status, reason: step.reason, sessionId: step.sessionId,
      startedAt: step.startedAt, finishedAt: step.finishedAt, exitCode: step.exitCode,
    })),
  };
}

async function runProbe(options: ReturnType<typeof parseManagedProbeArgs>, signal: AbortSignal) {
  const startedAt = Date.now();
  const terminals = new ObservedTerminals();
  const checks: Check[] = SCENARIOS.map((id) => ({ id, status: 'not-run' }));
  const runs: ReturnType<typeof summarize>[] = [];
  const preflight: Array<{ code: string; status: string }> = [];
  let root: string | undefined;
  let project: string | undefined;
  let executable: string | undefined;
  let version: string | null = null;
  let profile: ProfileOwner | undefined;
  let owner: RunOwner | undefined;
  let orchestrator: RunOrchestrator | undefined;
  let currentRun: Run | undefined;
  let failure: { code: string; remediation: string } | undefined;
  const cleanup = {
    ownerStopped: false, profileReleased: false, temporaryRootRemoved: false,
    trackedProcessesRemaining: 0, ptySessionsRemaining: 0,
    sessions: [] as Array<{ sessionId: string; verifiedAbsent: boolean }>,
    errors: [] as string[],
  };
  const envNames = [...SANITIZED_ENV, 'LOOM_CONFIG_DIR', 'COPILOT_HOME', 'PWD', 'OLDPWD', 'OPENCODE_LOG_LEVEL'];
  const inherited = new Map(envNames.map((name) => [name, process.env[name]]));
  const assertNotInterrupted = () => {
    if (signal.aborted) throw new ProbeFailure('INTERRUPTED', 'The probe was interrupted; inspect cleanup before retrying.');
  };

  try {
    root = await realpath(await mkdtemp(join(tmpdir(), 'loom-managed-opencode-')));
    project = join(root, 'project');
    const configDirectory = join(root, 'loom-config');
    await mkdir(project, { mode: 0o700 });
    await mkdir(join(root, 'copilot-home'), { mode: 0o700 });
    for (const name of SANITIZED_ENV) delete process.env[name];
    process.env.LOOM_CONFIG_DIR = configDirectory;
    process.env.COPILOT_HOME = join(root, 'copilot-home');
    process.env.PWD = project;
    process.env.OLDPWD = project;
    process.env.OPENCODE_LOG_LEVEL = 'none';
    const model = process.env.LOOM_LIVE_OPENCODE_MODEL?.trim();
    if (model && !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/.test(model)) {
      throw new ProbeFailure('MODEL_INVALID', 'LOOM_LIVE_OPENCODE_MODEL must be a provider/model identifier.');
    }
    await writeFile(join(project, 'opencode.json'), JSON.stringify({
      ...(model ? { model } : {}),
      permission: {
        '*': 'deny', read: 'allow', edit: 'allow', glob: 'allow', grep: 'allow', list: 'allow',
        external_directory: 'deny',
      },
    }), { flag: 'wx', mode: 0o600 });
    const registry = createHarnessRegistry({ env: process.env });
    executable = registry.get('opencode').resolveExecutable().executable;
    const command = async (args: string[]) => {
      const result = await runLocalCommand({
        executable: executable!, args, cwd: project!, env: process.env,
        timeoutMs: 10_000, maxOutputBytes: 4 * 1024 * 1024,
      });
      if (result.exitCode !== 0 || result.timedOut || result.spawnError ||
          Buffer.byteLength(result.stdout) >= 4 * 1024 * 1024 ||
          Buffer.byteLength(result.stderr) >= 4 * 1024 * 1024) {
        throw new ProbeFailure('COMMAND_FAILED', 'An OpenCode prerequisite or session command failed or exceeded its output/time limit.');
      }
      return result.stdout;
    };
    version = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(await command(['--version']))?.[1] ?? null;
    if (!supportsOpenCodeVersion(version)) {
      throw new ProbeFailure('OPENCODE_VERSION_UNSUPPORTED',
        `Install stable OpenCode >=${MINIMUM_OPENCODE_VERSION}, verify opencode --version on PATH, then rerun the probe.`);
    }
    const store = createConfigStore({ env: process.env });
    profile = await acquireProfileOwner(store.getConfigDir());
    await store.update({});
    const services = createLoomServices({ configStore: store, harnessRegistry: registry, preflightEnv: process.env });
    const registered = await services.projectRegistry.openProject(project);
    const newOwner = () => createRunOwner({
      configStore: store, projectRegistry: services.projectRegistry, chainService: services.chainService,
      preflightProvider: services.preflightProvider, terminalManager: terminals,
      runStepTimeoutMs: options.timeoutMs,
    });
    owner = newOwner();
    orchestrator = await owner.get();
    const runStore = createRunStore({ projectPath: project, configDirectory });

    const waitFor = async (initial: Run, accept: (run: Run) => boolean, allowPaused = false): Promise<Run> => {
      const deadline = Date.now() + initial.steps.length * options.timeoutMs + 10_000;
      while (true) {
        assertNotInterrupted();
        const run = await orchestrator!.getRun(initial.id);
        currentRun = run;
        if (accept(run)) return run;
        const pausedInFlight = allowPaused && run.status === 'paused' && run.steps[0]!.status === 'running';
        if (['failed', 'aborted', 'completed', 'interrupted'].includes(run.status) ||
            (run.status === 'paused' && !pausedInFlight)) {
          throw new ProbeFailure('RUN_STOPPED_BEFORE_EXPECTED_STATE',
            'Inspect the run reason and actual launch surface. opencode run may not emit the interactive OSC signal; do not bypass the guard.');
        }
        if (Date.now() >= deadline) throw new ProbeFailure('PROBE_TIMEOUT', 'The managed run exceeded its bounded deadline.');
        await delay(50);
      }
    };

    for (const scenario of SCENARIOS) {
      assertNotInterrupted();
      const check = checks.find((item) => item.id === scenario)!;
      terminals.scenario = scenario;
      const token = `LOOM_${randomBytes(16).toString('hex').toUpperCase()}`;
      const first = `managed-${scenario}-first.txt`;
      const second = `managed-${scenario}-second.txt`;
      const chain = await services.chainService.create(project, {
        name: `Managed acceptance ${scenario}`, harness: 'opencode', sessionMode: 'shared',
        automaticPermissionOptIn: false, inputs: [],
        steps: [
          { id: 'first', kind: 'instruction', instruction:
            `Create the new regular file ${first} with exactly ${token} followed by one newline. ` +
            'Use file editing tools only. Do not execute commands, inspect unrelated files, or change any other file. ' +
            'If the file already exists, report failure instead of overwriting it.' },
          { id: 'second', kind: 'instruction', instruction:
            `Read ${first}, then create the new regular file ${second} with exactly the same contents. ` +
            'Do not modify the first file. Use file editing tools only; do not execute commands or change any other file. ' +
            'If either requirement cannot be satisfied, report failure.' },
        ],
      });
      const report = await (await services.preflightProvider.preflightEngine()).run({
        chain, projectPath: project, mode: 'automatic',
      });
      if (preflight.length === 0) {
        preflight.push(...report.checks.map((item) => ({ code: item.id, status: item.status })));
      }
      requireCondition(report.startAllowed, 'PREFLIGHT_BLOCKED');
      assertNotInterrupted();
      currentRun = await orchestrator.createRun({
        projectId: registered.id, chainId: chain.id, mode: 'automatic',
      });
      const id = currentRun.id;
      if (scenario !== 'chain') {
        currentRun = await waitFor(currentRun, (run) => run.status === 'running' &&
          terminals.spawns.some((launch) => launch.scenario === scenario &&
            launch.records.some((record) => record.state === 'working')));
      }
      if (scenario === 'chain') {
        const run = await waitFor(currentRun, (item) => item.status === 'completed');
        const launches = terminals.spawns.filter((item) => item.scenario === scenario);
        requireCondition(launches.length === 2 && launches.every((item) => item.advancementEdges === 1), 'ADVANCEMENT_COUNT');
        requireCondition(run.steps.every((step) => step.status === 'done') &&
          run.sessionId !== null && run.steps.every((step) => step.sessionId === run.sessionId) &&
          launches.every((item) => item.sessionId === run.sessionId), 'ORDER_OR_SESSION_MISMATCH');
        requireCondition(run.steps[0]!.finishedAt !== null && run.steps[1]!.startedAt !== null &&
          run.steps[0]!.finishedAt! <= run.steps[1]!.startedAt!, 'STEP_ORDER');
        const firstArtifactMatched = await artifactMatches(join(project, first), `${token}\n`);
        const secondArtifactMatched = await artifactMatches(join(project, second), `${token}\n`);
        check.observed = { launches: launches.length, firstArtifactMatched, secondArtifactMatched };
        requireCondition(firstArtifactMatched && secondArtifactMatched, 'ARTIFACT_MISMATCH');
        const saved = await runStore.read(id);
        requireCondition(saved.status === 'completed' && saved.steps.every((step) => step.status === 'done'), 'PERSISTED_RUN_MISMATCH');
      } else if (scenario === 'pause') {
        await orchestrator.applyAction(id, { action: 'pause' });
        const paused = await waitFor(currentRun, (run) => run.status === 'paused' && run.steps[0]!.status === 'done', true);
        await delay(250);
        const launches = terminals.spawns.filter((item) => item.scenario === scenario).length;
        const secondArtifactAbsent = !await exists(join(project, second));
        const firstArtifactMatched = await artifactMatches(join(project, first), `${token}\n`);
        check.observed = { launches, secondArtifactAbsent, firstArtifactMatched };
        requireCondition(launches === 1 && paused.steps[1]!.status === 'pending' &&
          secondArtifactAbsent && firstArtifactMatched, 'PAUSE_ADVANCED');
        await orchestrator.applyAction(id, { action: 'abort' });
      } else if (scenario === 'abort') {
        requireCondition(currentRun.status === 'running', 'ABORT_NOT_LIVE');
        await orchestrator.applyAction(id, { action: 'abort' });
        await delay(250);
        const aborted = await orchestrator.getRun(id);
        requireCondition(aborted.status === 'aborted' &&
          terminals.spawns.filter((item) => item.scenario === scenario).length === 1 &&
          !await exists(join(project, second)), 'ABORT_ADVANCED');
      } else {
        requireCondition(currentRun.status === 'running', 'RECOVERY_NOT_LIVE');
        await owner.shutdown();
        owner = newOwner();
        orchestrator = await owner.get();
        const before = terminals.spawns.length;
        const recovered = await orchestrator.getRun(id);
        await delay(250);
        requireCondition(recovered.status === 'interrupted' && terminals.spawns.length === before &&
          !await exists(join(project, second)) && !(await orchestrator.getActiveRun()).active, 'RECOVERY_REPLAYED');
      }
      currentRun = await orchestrator.getRun(id);
      runs.push(summarize(currentRun));
      currentRun = undefined;
      requireCondition(terminals.sessions.every((session) => !session.isRunning()), 'PROCESS_STILL_RUNNING');
      check.status = 'passed';
    }
  } catch (error) {
    const code = errorCode(error);
    const check = checks.find((item) => item.status === 'not-run');
    if (check) { check.status = 'failed'; check.code = code; }
    failure = {
      code,
      remediation: code === 'HARNESS_UNAVAILABLE' ?
        `Install stable OpenCode >=${MINIMUM_OPENCODE_VERSION}, verify opencode --version on PATH and authenticate with opencode auth login.` :
        error instanceof ProbeFailure ? error.message :
        'Check the installed OpenCode, authentication and model. Inspect checks and cleanup; no automatic retry was performed.',
    };
    if (currentRun && orchestrator) {
      try { runs.push(summarize(await orchestrator.getRun(currentRun.id))); }
      catch (readError) { cleanup.errors.push(errorCode(readError)); }
    }
  } finally {
    try { await owner?.shutdown(); cleanup.ownerStopped = true; }
    catch (error) { cleanup.errors.push(errorCode(error)); }
    for (const session of terminals.sessions.filter((item) => item.isRunning())) {
      try { session.kill('SIGKILL'); }
      catch (error) { cleanup.errors.push(errorCode(error)); }
    }
    const deadline = Date.now() + 3000;
    while (terminals.sessions.some((session) => session.isRunning()) && Date.now() < deadline) await delay(25);
    cleanup.trackedProcessesRemaining = terminals.sessions.filter((session) => session.isRunning()).length;
    if (cleanup.ownerStopped && cleanup.trackedProcessesRemaining === 0) {
      try { await terminals.shutdown(); }
      catch (error) { cleanup.errors.push(errorCode(error)); }
      if (executable && project) {
        for (const sessionId of new Set(terminals.spawns.map((item) => item.sessionId).filter((id) => id !== null))) {
          try {
            const list = async () => {
              const result = await runLocalCommand({
                executable: executable!, args: ['session', 'list'], cwd: project!,
                timeoutMs: 10_000, env: process.env, maxOutputBytes: 4 * 1024 * 1024,
              });
              if (result.exitCode !== 0 || result.timedOut || result.spawnError ||
                  Buffer.byteLength(result.stdout) >= 4 * 1024 * 1024 ||
                  Buffer.byteLength(result.stderr) >= 4 * 1024 * 1024) {
                throw new ProbeFailure('SESSION_LIST_FAILED', 'Cannot verify probe session cleanup.');
              }
              return result.stdout;
            };
            if ((await list()).includes(sessionId)) {
              const deleted = await runLocalCommand({
                executable, args: ['session', 'delete', sessionId], cwd: project,
                timeoutMs: 10_000, env: process.env,
              });
              requireCondition(deleted.exitCode === 0 && !deleted.timedOut && !deleted.spawnError, 'SESSION_DELETE_FAILED');
            }
            cleanup.sessions.push({ sessionId, verifiedAbsent: !(await list()).includes(sessionId) });
          } catch (error) {
            cleanup.sessions.push({ sessionId, verifiedAbsent: false });
            cleanup.errors.push(errorCode(error));
          }
        }
      }
      try { profile?.release(); cleanup.profileReleased = true; }
      catch (error) { cleanup.errors.push(errorCode(error)); }
      if (root && cleanup.errors.length === 0 && cleanup.sessions.every((session) => session.verifiedAbsent)) {
        try { await rm(root, { recursive: true }); cleanup.temporaryRootRemoved = !await exists(root); }
        catch (error) { cleanup.errors.push(errorCode(error)); }
      }
    }
    cleanup.ptySessionsRemaining = terminals.size;
    for (const [name, value] of inherited) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  if (signal.aborted && !failure) {
    failure = { code: 'INTERRUPTED', remediation: 'The probe was interrupted; inspect cleanup before retrying.' };
  }
  const passed = !failure && checks.every((check) => check.status === 'passed') &&
    cleanup.errors.length === 0 && cleanup.ownerStopped && cleanup.profileReleased &&
    cleanup.temporaryRootRemoved && cleanup.trackedProcessesRemaining === 0 &&
    cleanup.ptySessionsRemaining === 0 && cleanup.sessions.every((session) => session.verifiedAbsent);
  return {
    version: 1, scope: 'managed-opencode', generatedAt: new Date().toISOString(),
    node: process.version, platform: `${process.platform}-${process.arch}`,
    durationMs: Date.now() - startedAt, result: passed ? 'passed' : 'failed',
    opencode: { version, minimumVersion: MINIMUM_OPENCODE_VERSION },
    isolation: { loomProfile: 'temporary', copilotHome: 'temporary', project: 'temporary',
      permissions: 'read/edit/search allowed; other tools and external directories denied by temporary project config' },
    checks, preflight, launches: terminals.spawns, runs, cleanup,
    ...(failure ? { failure } : {}),
    ...(!cleanup.temporaryRootRemoved && root ? { retainedTemporaryRoot: root } : {}),
    limitations: [
      'Not a sandbox or proof of descendant containment.',
      'Exercises shared-session instruction-only chains, not native agents, skill firing, fresh or fork modes.',
      'Recovery uses orderly owner shutdown and startup, not abrupt owner death.',
      'Missing-signal and nonzero-exit failure cases require deterministic fixture coverage; they are not injected into this live run.',
      'Does not enable or exercise the blocked reviewed CLI automatic-start path.',
    ],
  };
}

async function main() {
  if (process.argv.slice(2).includes('--help')) {
    console.log('Usage: npm run test:live:managed -- --confirm-live [--evidence PATH] [--timeout-ms 180000]\n' +
      'Makes paid model calls through the production managed runner. Grants temporary-project read/edit permissions; not a sandbox.\n' +
      'Optional LOOM_LIVE_OPENCODE_MODEL=provider/model. Never starts Copilot or unblocks automatic CLI starts.');
    return;
  }
  const options = parseManagedProbeArgs(process.argv.slice(2));
  const controller = new AbortController();
  const interrupted = () => controller.abort();
  process.on('SIGINT', interrupted);
  process.on('SIGTERM', interrupted);
  try {
    const report = await runProbe(options, controller.signal);
    await mkdir(dirname(options.evidence), { recursive: true, mode: 0o700 });
    const temporary = `${options.evidence}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      await rename(temporary, options.evidence);
    } finally {
      await rm(temporary, { force: true });
    }
    console.log(JSON.stringify(report));
    if (report.result !== 'passed' || controller.signal.aborted) process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(JSON.stringify({ ok: false, error: {
      code: errorCode(error),
      message: error instanceof ProbeFailure ? error.message : 'Managed probe failed; inspect the evidence destination and local environment.',
    } }));
    process.exitCode = 1;
  });
}
