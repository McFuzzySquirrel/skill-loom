import { describe, expect, it } from 'vitest';
import {
  CHAIN_VERSION,
  type Chain,
  type ChainSessionMode,
} from '../../src/server/chains/model.js';
import { createCopilotAdapter } from '../../src/server/harness/copilot.js';
import { createOpenCodeAdapter } from '../../src/server/harness/opencode.js';
import type { HarnessAdapter } from '../../src/server/harness/types.js';
import {
  MAX_TAIL_BYTES,
  MAX_TAIL_LINES,
  createRunRecord,
  type Run,
} from '../../src/server/runs/model.js';
import {
  AUTOMATIC_RUNNER_ERROR_CODES,
  AUTOMATIC_STEP_REASONS,
  AutomaticRunner,
  AutomaticRunnerError,
  DEFAULT_AUTOMATIC_STEP_TIMEOUT_MS,
  createAutomaticRunner,
  type AutomaticProcess,
  type AutomaticRunEvent,
  type AutomaticSpawnSpec,
  type AutomaticTimers,
} from '../../src/server/runs/automatic.js';
import type { TerminalExit } from '../../src/server/terminal/pty.js';

const CREATED_AT = '2026-11-04T10:00:00.000Z';
const PROJECT_PATH = '/tmp/slan-automatic-project';

const OPENCODE_EXECUTABLE = '/opt/slan/bin/opencode';
const COPILOT_EXECUTABLE = '/opt/slan/bin/copilot';

const OSC_WORKING = '\x1b]7501;state=working\x07';
const OSC_IDLE = '\x1b]7501;state=idle\x07';
const OSC_CLEAR = '\x1b]7501;state=clear\x07';

function makeChain(overrides: Partial<Chain> = {}): Chain {
  return {
    version: CHAIN_VERSION,
    id: 'chain-automatic',
    name: 'Automatic chain',
    harness: 'opencode',
    sessionMode: 'shared',
    steps: [
      {
        id: 'step-plan',
        skillName: 'brainstorm',
        instruction: 'Plan the task for {{task}}.',
        label: 'Plan',
      },
      {
        id: 'step-build',
        skillName: 'implement',
        instruction: 'Implement the plan for {{task}}.',
        label: 'Build',
      },
    ],
    inputs: [{ name: 'task', required: true }],
    automaticPermissionOptIn: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function opencodeAdapter(): HarnessAdapter {
  return createOpenCodeAdapter({
    executableOverride: OPENCODE_EXECUTABLE,
    isExecutable: () => true,
  });
}

function copilotAdapter(): HarnessAdapter {
  return createCopilotAdapter({
    executableOverride: COPILOT_EXECUTABLE,
    isExecutable: () => true,
  });
}

function makeRun(
  chain: Chain = makeChain(),
  options: { sessionId?: string | null; mode?: 'supervised' | 'automatic' } = {},
): Run {
  const sessionMode: ChainSessionMode = chain.sessionMode;
  return createRunRecord({
    id: 'run-automatic-1',
    projectId: 'project-1',
    chain,
    mode: options.mode ?? 'automatic',
    inputs: { task: 'ship the automatic runner' },
    now: CREATED_AT,
    sessionId:
      options.sessionId !== undefined
        ? options.sessionId
        : sessionMode === 'fresh'
          ? null
          : `ses_${sessionMode}`,
  });
}

class FakeProcess implements AutomaticProcess {
  readonly pid: number;
  readonly killSignals: string[] = [];
  private readonly dataListeners = new Set<(chunk: string) => void>();
  private readonly exitListeners = new Set<(event: TerminalExit) => void>();
  private exitEvent: TerminalExit | null = null;
  private running = true;

  constructor(pid: number) {
    this.pid = pid;
  }

  onData(listener: (chunk: string) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onExit(listener: (event: TerminalExit) => void): () => void {
    if (this.exitEvent !== null) {
      const event = this.exitEvent;
      queueMicrotask(() => listener(event));
      return () => undefined;
    }
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  kill(signal = 'SIGTERM'): void {
    this.killSignals.push(signal);
    if (this.running) {
      // Simulate a child that reacts to the graceful signal so cleanup and
      // timeout tests can prove no live process remains.
      this.emitExit(143);
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  getExit(): TerminalExit | null {
    return this.exitEvent;
  }

  emitData(chunk: string): void {
    for (const listener of [...this.dataListeners]) {
      listener(chunk);
    }
  }

  emitExit(exitCode: number, signal?: number): void {
    if (this.exitEvent !== null) {
      return;
    }
    const event: TerminalExit =
      signal === undefined ? { exitCode } : { exitCode, signal };
    this.exitEvent = event;
    this.running = false;
    const listeners = [...this.exitListeners];
    this.exitListeners.clear();
    for (const listener of listeners) {
      listener(event);
    }
  }
}

interface RecordedSpawn {
  readonly spec: AutomaticSpawnSpec;
  readonly process: FakeProcess;
}

class FakeSpawner {
  readonly spawns: RecordedSpawn[] = [];
  failSpawn = false;
  private nextPid = 7000;

  spawn = (spec: AutomaticSpawnSpec): AutomaticProcess => {
    if (this.failSpawn) {
      throw new Error('simulated automatic spawn failure');
    }
    const process = new FakeProcess(this.nextPid);
    this.nextPid += 1;
    this.spawns.push({ spec, process });
    return process;
  };

  get lastProcess(): FakeProcess {
    const spawn = this.spawns.at(-1);
    if (spawn === undefined) {
      throw new Error('No automatic process has been spawned.');
    }
    return spawn.process;
  }

  get lastSpec(): AutomaticSpawnSpec {
    const spawn = this.spawns.at(-1);
    if (spawn === undefined) {
      throw new Error('No automatic process has been spawned.');
    }
    return spawn.spec;
  }
}

class FakeTimers implements AutomaticTimers {
  private nextId = 1;
  private readonly handles = new Map<number, { callback: () => void; cleared: boolean }>();

  setTimeout(callback: () => void): unknown {
    const id = this.nextId;
    this.nextId += 1;
    this.handles.set(id, { callback, cleared: false });
    return id;
  }

  clearTimeout(handle: unknown): void {
    const entry = this.handles.get(handle as number);
    if (entry !== undefined) {
      entry.cleared = true;
      this.handles.delete(handle as number);
    }
  }

  get pendingCount(): number {
    return [...this.handles.values()].filter((entry) => !entry.cleared).length;
  }

  fireAll(): number {
    const callbacks = [...this.handles.entries()]
      .filter(([, entry]) => !entry.cleared)
      .map(([id, entry]) => {
        this.handles.delete(id);
        return entry.callback;
      });
    for (const callback of callbacks) {
      callback();
    }
    return callbacks.length;
  }
}

interface Harness {
  readonly runner: AutomaticRunner;
  readonly run: Run;
  readonly chain: Chain;
  readonly spawner: FakeSpawner;
  readonly timers: FakeTimers;
  readonly persisted: Run[];
  readonly events: AutomaticRunEvent[];
  readonly adapter: HarnessAdapter;
}

function makeClock(): () => Date {
  let current = Date.parse(CREATED_AT);
  return () => {
    current += 1_000;
    return new Date(current);
  };
}

function makeHarness(
  options: {
    chain?: Chain;
    run?: Run;
    adapter?: HarnessAdapter;
    spawner?: FakeSpawner;
    timers?: FakeTimers;
    stepTimeoutMs?: number;
    persist?: (run: Run) => void | Promise<void>;
  } = {},
): Harness {
  const chain = options.chain ?? makeChain();
  const run = options.run ?? makeRun(chain);
  const adapter = options.adapter ?? opencodeAdapter();
  const spawner = options.spawner ?? new FakeSpawner();
  const timers = options.timers ?? new FakeTimers();
  const persisted: Run[] = [];
  const events: AutomaticRunEvent[] = [];

  let generated = 0;
  const runner = createAutomaticRunner({
    run,
    adapter,
    projectPath: PROJECT_PATH,
    spawn: spawner.spawn,
    now: makeClock(),
    createSessionId: () => {
      generated += 1;
      return `ses_generated_${String(generated)}`;
    },
    stepTimeoutMs: options.stepTimeoutMs ?? 1_000,
    timers,
    persist: (nextRun) => {
      persisted.push(nextRun);
      return options.persist?.(nextRun);
    },
    onEvent: (event) => {
      events.push(event);
    },
  });

  return { runner, run, chain, spawner, timers, persisted, events, adapter };
}

function captureRunnerError(
  operation: () => unknown | Promise<unknown>,
): Promise<AutomaticRunnerError> {
  return Promise.resolve()
    .then(operation)
    .then(
      () => {
        throw new Error('Expected an AutomaticRunnerError.');
      },
      (error: unknown) => {
        if (error instanceof AutomaticRunnerError) {
          return error;
        }
        throw error;
      },
    );
}

async function advanceOscStep(harness: Harness, process: FakeProcess): Promise<void> {
  process.emitData(OSC_WORKING);
  process.emitData(OSC_IDLE);
  await harness.runner.whenSettled();
}

describe('automatic OpenCode advancement', () => {
  it('advances only after working then idle and restarts the next step on the same session', async () => {
    const harness = makeHarness();
    const started = await harness.runner.start();

    expect(started.status).toBe('running');
    expect(started.steps[0]).toMatchObject({
      id: 'step-plan',
      status: 'running',
      sessionId: 'ses_shared',
    });
    expect(harness.spawner.spawns).toHaveLength(1);
    expect(harness.spawner.lastSpec).toMatchObject({
      surface: 'pty',
      terminalId: 'slan_run_run-automatic-1',
      executable: OPENCODE_EXECUTABLE,
      cwd: PROJECT_PATH,
    });
    expect(harness.spawner.lastSpec.args.slice(0, 4)).toEqual([
      'run',
      '--session',
      'ses_shared',
      expect.stringContaining('Skill: brainstorm'),
    ]);
    expect(harness.spawner.lastSpec.args.join('\n')).toContain(
      'Instruction:\nPlan the task for ship the automatic runner.',
    );

    harness.spawner.lastProcess.emitData(OSC_WORKING);
    await harness.runner.whenSettled();
    expect(harness.runner.getRun().steps[0]!.status).toBe('running');
    expect(harness.runner.getRun().currentStepIndex).toBe(0);
    expect(harness.spawner.spawns).toHaveLength(1);

    harness.spawner.lastProcess.emitData(OSC_IDLE);
    await harness.runner.whenSettled();

    const run = harness.runner.getRun();
    expect(run.status).toBe('running');
    expect(run.currentStepIndex).toBe(1);
    expect(run.steps[0]).toMatchObject({
      status: 'done',
      reason: AUTOMATIC_STEP_REASONS.COMPLETION_SIGNAL,
    });
    expect(run.steps[0]!.finishedAt).not.toBeNull();
    expect(run.steps[1]).toMatchObject({
      id: 'step-build',
      status: 'running',
      sessionId: 'ses_shared',
    });

    expect(harness.spawner.spawns).toHaveLength(2);
    expect(harness.spawner.spawns[0]!.process.killSignals.length).toBeGreaterThan(0);
    expect(harness.spawner.lastSpec.args).toContain('ses_shared');
    expect(harness.spawner.lastSpec.args.join('\n')).toContain(
      'Instruction:\nImplement the plan for ship the automatic runner.',
    );
    expect(harness.events.map((event) => event.type)).toContain('step-advanced');
  });

  it('does not advance on an idle-only signal or a quiet terminal', async () => {
    const harness = makeHarness();
    await harness.runner.start();
    const process = harness.spawner.lastProcess;

    process.emitData(OSC_IDLE);
    process.emitData('quiet output with no state signal\r\n');
    process.emitData('\x1b[32mstill quiet\x1b[0m\r\n');
    await harness.runner.whenSettled();

    const run = harness.runner.getRun();
    expect(run.status).toBe('running');
    expect(run.currentStepIndex).toBe(0);
    expect(run.steps[0]!.status).toBe('running');
    expect(harness.spawner.spawns).toHaveLength(1);

    // A later working -> idle pair in the same step is still the real signal.
    await advanceOscStep(harness, process);
    expect(harness.runner.getRun().currentStepIndex).toBe(1);
    expect(harness.spawner.spawns).toHaveLength(2);
  });

  it('requires a fresh working signal after clear resets the step observation', async () => {
    const harness = makeHarness();
    await harness.runner.start();
    const process = harness.spawner.lastProcess;

    process.emitData(OSC_WORKING);
    process.emitData(OSC_CLEAR);
    process.emitData(OSC_IDLE);
    await harness.runner.whenSettled();

    expect(harness.runner.getRun().currentStepIndex).toBe(0);
    expect(harness.runner.getRun().steps[0]!.status).toBe('running');
    expect(harness.spawner.spawns).toHaveLength(1);

    process.emitData(OSC_WORKING);
    process.emitData(OSC_IDLE);
    await harness.runner.whenSettled();
    expect(harness.runner.getRun().currentStepIndex).toBe(1);
  });

  it('parses a completion signal split across chunks', async () => {
    const harness = makeHarness();
    await harness.runner.start();
    const process = harness.spawner.lastProcess;

    process.emitData('\x1b]7501;sta');
    process.emitData('te=working\x07');
    process.emitData('\x1b]7501;state=id');
    process.emitData('le\x07');
    await harness.runner.whenSettled();

    expect(harness.runner.getRun().currentStepIndex).toBe(1);
    expect(harness.runner.getRun().steps[0]!.status).toBe('done');
  });

  it('pauses with a failure after the configured timeout and offers Retry', async () => {
    const harness = makeHarness({ stepTimeoutMs: 250 });
    await harness.runner.start();
    const process = harness.spawner.lastProcess;

    expect(harness.timers.pendingCount).toBe(1);
    expect(harness.timers.fireAll()).toBe(1);
    await harness.runner.whenSettled();

    const paused = harness.runner.getRun();
    expect(paused.status).toBe('paused');
    expect(paused.reason).toBe(AUTOMATIC_STEP_REASONS.COMPLETION_TIMEOUT);
    expect(paused.steps[0]).toMatchObject({
      status: 'failed',
      reason: AUTOMATIC_STEP_REASONS.COMPLETION_TIMEOUT,
    });
    expect(process.isRunning()).toBe(false);
    expect(process.killSignals.length).toBeGreaterThan(0);
    expect(harness.spawner.spawns).toHaveLength(1);
    expect(harness.runner.canRetry).toBe(true);
    expect(harness.runner.canRunNext).toBe(true);
    expect(harness.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['timeout', 'step-failed', 'run-paused']),
    );

    const retried = await harness.runner.retry();
    expect(retried.status).toBe('running');
    expect(retried.steps[0]!.status).toBe('running');
    expect(harness.spawner.spawns).toHaveLength(2);
    expect(harness.timers.pendingCount).toBe(1);
  });

  it('pauses with a missing-signal failure when the PTY exits cleanly before idle', async () => {
    const harness = makeHarness();
    await harness.runner.start();

    harness.spawner.lastProcess.emitExit(0);
    await harness.runner.whenSettled();

    const run = harness.runner.getRun();
    expect(run.status).toBe('paused');
    expect(run.steps[0]).toMatchObject({
      status: 'failed',
      exitCode: 0,
      reason: AUTOMATIC_STEP_REASONS.MISSING_COMPLETION_SIGNAL,
    });
    expect(harness.spawner.spawns).toHaveLength(1);
    expect(harness.runner.canRetry).toBe(true);
  });

  it('pauses with a non-zero exit failure before the completion signal', async () => {
    const harness = makeHarness();
    await harness.runner.start();

    harness.spawner.lastProcess.emitExit(2);
    await harness.runner.whenSettled();

    const run = harness.runner.getRun();
    expect(run.status).toBe('paused');
    expect(run.steps[0]).toMatchObject({
      status: 'failed',
      exitCode: 2,
      reason: AUTOMATIC_STEP_REASONS.PROCESS_EXITED_NONZERO,
    });
    expect(harness.runner.canRunNext).toBe(true);
    expect(harness.runner.canRetry).toBe(true);
    expect(harness.runner.canSkip).toBe(true);
    expect(harness.runner.canAbort).toBe(true);
  });

  it('records a bounded tail and not-observable OpenCode skill state', async () => {
    const harness = makeHarness();
    await harness.runner.start();
    const process = harness.spawner.lastProcess;

    const manyLines = Array.from({ length: 400 }, (_, index) => `line-${String(index)}`).join(
      '\r\n',
    );
    process.emitData(`${manyLines}\r\n${'x'.repeat(40_000)}`);
    process.emitData('skill(brainstorm)\r\n');
    await harness.runner.whenSettled();

    const step = harness.runner.getRun().steps[0]!;
    expect(step.tail.split('\n').length).toBeLessThanOrEqual(MAX_TAIL_LINES);
    expect(Buffer.byteLength(step.tail, 'utf8')).toBeLessThanOrEqual(MAX_TAIL_BYTES);
    expect(step.skillObservation).toBe('not-observable');
    expect(harness.events.filter((event) => event.type === 'output').length).toBeGreaterThan(0);
    expect(harness.persisted.every((run) => !JSON.stringify(run).includes('line-0'))).toBe(true);
  });
});

describe('automatic Copilot process-exit advancement', () => {
  function copilotChain(overrides: Partial<Chain> = {}): Chain {
    return makeChain({ harness: 'copilot', automaticPermissionOptIn: true, ...overrides });
  }

  it('runs one headless process per step with the opt-in flags and advances only on exit', async () => {
    const harness = makeHarness({
      chain: copilotChain(),
      adapter: copilotAdapter(),
    });
    const started = await harness.runner.start();

    expect(started.status).toBe('running');
    expect(harness.spawner.lastSpec).toMatchObject({
      surface: 'process',
      terminalId: 'slan_run_run-automatic-1',
      executable: COPILOT_EXECUTABLE,
      cwd: PROJECT_PATH,
    });
    expect(harness.spawner.lastSpec.args).toEqual(
      expect.arrayContaining([
        '-p',
        '--session-id',
        'ses_shared',
        '--allow-all-paths',
        '--allow-all-tools',
        '-C',
        PROJECT_PATH,
      ]),
    );
    expect(harness.runner.state.permissions).toEqual([
      '--allow-all-paths',
      '--allow-all-tools',
    ]);

    // OSC 7501 is not the Copilot advancement signal even if a terminal emits it.
    harness.spawner.lastProcess.emitData(OSC_WORKING);
    harness.spawner.lastProcess.emitData(OSC_IDLE);
    await harness.runner.whenSettled();
    expect(harness.runner.getRun().currentStepIndex).toBe(0);
    expect(harness.runner.getRun().steps[0]!.status).toBe('running');

    harness.spawner.lastProcess.emitExit(0);
    await harness.runner.whenSettled();

    const run = harness.runner.getRun();
    expect(run.status).toBe('running');
    expect(run.currentStepIndex).toBe(1);
    expect(run.steps[0]).toMatchObject({
      status: 'done',
      exitCode: 0,
      reason: AUTOMATIC_STEP_REASONS.PROCESS_EXITED,
    });
    expect(run.steps[1]!.status).toBe('running');
    expect(harness.spawner.spawns).toHaveLength(2);
    expect(harness.spawner.lastSpec.args).toContain('ses_shared');
    expect(harness.spawner.lastSpec.args).toContain('--allow-all-paths');
  });

  it('pauses on a non-zero exit and never auto-continues', async () => {
    const harness = makeHarness({
      chain: copilotChain(),
      adapter: copilotAdapter(),
    });
    await harness.runner.start();

    harness.spawner.lastProcess.emitExit(7);
    await harness.runner.whenSettled();

    const run = harness.runner.getRun();
    expect(run.status).toBe('paused');
    expect(run.reason).toBe(AUTOMATIC_STEP_REASONS.PROCESS_EXITED_NONZERO);
    expect(run.steps[0]).toMatchObject({
      status: 'failed',
      exitCode: 7,
      reason: AUTOMATIC_STEP_REASONS.PROCESS_EXITED_NONZERO,
    });
    expect(harness.spawner.spawns).toHaveLength(1);
    expect(harness.runner.canRetry).toBe(true);
    expect(harness.runner.canSkip).toBe(true);
    expect(harness.runner.canAbort).toBe(true);
  });

  it('uses the chain opt-in flags only when the chain recorded the opt-in', async () => {
    const withoutOptIn = makeHarness({
      chain: copilotChain({ automaticPermissionOptIn: false }),
      adapter: copilotAdapter(),
    });

    const error = await captureRunnerError(() => withoutOptIn.runner.start());
    expect(error.code).toBe(AUTOMATIC_RUNNER_ERROR_CODES.COMMAND_FAILED);
    expect(withoutOptIn.spawner.spawns).toHaveLength(0);
    expect(withoutOptIn.runner.getRun().status).toBe('paused');
    expect(withoutOptIn.runner.getRun().steps[0]).toMatchObject({
      status: 'failed',
      reason: AUTOMATIC_STEP_REASONS.PERMISSION_OPT_IN_REQUIRED,
    });
    expect(withoutOptIn.runner.state.permissions).toEqual([]);

    const withOptIn = makeHarness({
      chain: copilotChain({ automaticPermissionOptIn: true }),
      adapter: copilotAdapter(),
    });
    await withOptIn.runner.start();
    const startedEvent = withOptIn.events.find((event) => event.type === 'step-started');
    expect(startedEvent?.permissions).toEqual([
      '--allow-all-paths',
      '--allow-all-tools',
    ]);
    expect(withOptIn.spawner.lastSpec.args).toContain('--allow-all-tools');
  });
});

describe('automatic pause and Run next', () => {
  it('pauses after the current completion signal and starts the next step only on Run next', async () => {
    const harness = makeHarness();
    await harness.runner.start();

    const paused = await harness.runner.pause();
    expect(paused.status).toBe('paused');
    expect(paused.reason).toBe(AUTOMATIC_STEP_REASONS.PAUSED_BY_USER);
    expect(harness.runner.canPause).toBe(false);
    expect(harness.runner.state.isProcessRunning).toBe(true);

    const runNextWhileRunning = await captureRunnerError(() => harness.runner.runNext());
    expect(runNextWhileRunning.code).toBe(
      AUTOMATIC_RUNNER_ERROR_CODES.PROCESS_STILL_RUNNING,
    );

    await advanceOscStep(harness, harness.spawner.lastProcess);

    const afterSignal = harness.runner.getRun();
    expect(afterSignal.status).toBe('paused');
    expect(afterSignal.currentStepIndex).toBe(0);
    expect(afterSignal.steps[0]!.status).toBe('done');
    expect(harness.spawner.spawns).toHaveLength(1);
    expect(harness.runner.canRunNext).toBe(true);
    expect(afterSignal.mode).toBe('automatic');

    const advanced = await harness.runner.runNext();
    expect(advanced.mode).toBe('automatic');
    expect(advanced.status).toBe('running');
    expect(advanced.currentStepIndex).toBe(1);
    expect(advanced.steps[1]!.status).toBe('running');
    expect(harness.spawner.spawns).toHaveLength(2);
    expect(harness.spawner.lastSpec.args).toContain('ses_shared');
  });

  it('resumes automatic advancement while the in-flight step is still live', async () => {
    const harness = makeHarness();
    await harness.runner.start();
    const process = harness.spawner.lastProcess;

    await harness.runner.pause();
    expect(harness.runner.getRun().status).toBe('paused');

    const resumed = await harness.runner.resume();
    expect(resumed.status).toBe('running');
    expect(resumed.mode).toBe('automatic');
    expect(harness.runner.state.canPause).toBe(true);

    await advanceOscStep(harness, process);
    expect(harness.runner.getRun().currentStepIndex).toBe(1);
    expect(harness.spawner.spawns).toHaveLength(2);
    expect(harness.events.map((event) => event.type)).toContain('run-resumed');
  });

  it('dispatches Pause, Run next, Retry, Skip, and Abort through the action surface', async () => {
    const pauseHarness = makeHarness();
    await pauseHarness.runner.start();
    await pauseHarness.runner.applyAction({ action: 'pause' });
    await advanceOscStep(pauseHarness, pauseHarness.spawner.lastProcess);
    await pauseHarness.runner.applyAction({ action: 'run-next' });
    expect(pauseHarness.runner.state.currentStepIndex).toBe(1);

    const retryHarness = makeHarness();
    await retryHarness.runner.start();
    retryHarness.spawner.lastProcess.emitExit(3);
    await retryHarness.runner.whenSettled();
    await retryHarness.runner.applyAction({ action: 'retry' });
    expect(retryHarness.runner.getRun().steps[0]!.status).toBe('running');
    expect(retryHarness.spawner.spawns).toHaveLength(2);

    const skipHarness = makeHarness();
    await skipHarness.runner.start();
    skipHarness.spawner.lastProcess.emitExit(3);
    await skipHarness.runner.whenSettled();
    const skipped = await skipHarness.runner.applyAction({
      action: 'skip',
      reason: 'Ignored by the operator.',
    });
    expect(skipped.status).toBe('paused');
    expect(skipped.steps[0]).toMatchObject({
      status: 'skipped',
      reason: 'Ignored by the operator.',
    });
    expect(skipHarness.runner.canRunNext).toBe(true);

    const abortHarness = makeHarness();
    await abortHarness.runner.start();
    const aborted = await abortHarness.runner.applyAction({ action: 'abort' });
    expect(aborted.status).toBe('aborted');
    expect(aborted.steps[0]!.status).toBe('interrupted');
    expect(abortHarness.spawner.lastProcess.isRunning()).toBe(false);

    const invalidHarness = makeHarness();
    await invalidHarness.runner.start();
    const invalid = await captureRunnerError(() =>
      invalidHarness.runner.applyAction({ action: 'done' }),
    );
    expect(invalid.code).toBe(AUTOMATIC_RUNNER_ERROR_CODES.ACTION_INVALID);
  });
});

describe('automatic session plans', () => {
  it('uses one shared session id for every step', async () => {
    const harness = makeHarness({ chain: makeChain({ sessionMode: 'shared' }) });
    const started = await harness.runner.start();

    expect(started.sessionId).toBe('ses_shared');
    expect(started.steps[0]!.sessionId).toBe('ses_shared');
    await advanceOscStep(harness, harness.spawner.lastProcess);

    expect(harness.runner.getRun().steps[1]!.sessionId).toBe('ses_shared');
    expect(harness.spawner.lastSpec.args).toContain('ses_shared');
  });

  it('creates a new session id for every step in fresh mode', async () => {
    const harness = makeHarness({ chain: makeChain({ sessionMode: 'fresh' }) });
    const started = await harness.runner.start();

    expect(started.sessionId).toBeNull();
    expect(started.steps[0]!.sessionId).toBe('ses_generated_1');
    expect(harness.spawner.lastSpec.args).toContain('ses_generated_1');

    await advanceOscStep(harness, harness.spawner.lastProcess);

    expect(harness.runner.getRun().steps[1]!.sessionId).toBe('ses_generated_2');
    expect(harness.spawner.lastSpec.args).toContain('ses_generated_2');
    expect(harness.spawner.lastSpec.args).not.toContain('ses_generated_1');
  });

  it('uses the native OpenCode fork on the second automatic step', async () => {
    const harness = makeHarness({ chain: makeChain({ sessionMode: 'fork' }) });
    await harness.runner.start();

    expect(harness.spawner.lastSpec.args).not.toContain('--fork');

    await advanceOscStep(harness, harness.spawner.lastProcess);

    const run = harness.runner.getRun();
    expect(run.forkMechanism).toBe('native');
    expect(run.steps[1]!.forkMechanism).toBe('native');
    expect(run.steps[1]!.sessionId).toBe('ses_generated_1');
    expect(harness.spawner.lastSpec.args).toEqual(
      expect.arrayContaining(['--fork', '--session', 'ses_fork']),
    );
    expect(harness.spawner.lastSpec.args.join('\n')).not.toContain('Handoff note');
  });

  it('uses a deterministic handoff note for a Copilot fork', async () => {
    const chain = makeChain({
      harness: 'copilot',
      sessionMode: 'fork',
      automaticPermissionOptIn: true,
    });
    const harness = makeHarness({ chain, adapter: copilotAdapter() });
    await harness.runner.start();

    harness.spawner.lastProcess.emitExit(0);
    await harness.runner.whenSettled();

    const run = harness.runner.getRun();
    expect(run.forkMechanism).toBe('handoff');
    expect(run.steps[1]!.forkMechanism).toBe('handoff');
    expect(run.steps[1]!.sessionId).toBe('ses_generated_1');
    expect(harness.spawner.lastSpec.args).toContain('ses_generated_1');
    expect(harness.spawner.lastSpec.args.join('\n')).toContain(
      'Handoff note (not a native session fork)',
    );
  });
});

describe('automatic cleanup', () => {
  it('completes the chain, stops the final process, and clears the timeout', async () => {
    const chain = makeChain({
      steps: [
        {
          id: 'step-only',
          skillName: 'brainstorm',
          instruction: 'Plan the task for {{task}}.',
          label: 'Plan',
        },
      ],
    });
    const harness = makeHarness({ chain });
    await harness.runner.start();
    const process = harness.spawner.lastProcess;

    expect(harness.timers.pendingCount).toBe(1);
    process.emitData(OSC_WORKING);
    process.emitData(OSC_IDLE);
    await harness.runner.whenSettled();

    const completed = harness.runner.getRun();
    expect(completed.status).toBe('completed');
    expect(completed.steps[0]!.status).toBe('done');
    expect(completed.finishedAt).not.toBeNull();
    expect(harness.timers.pendingCount).toBe(0);
    expect(process.isRunning()).toBe(false);
    expect(harness.spawner.spawns).toHaveLength(1);
    expect(harness.events.map((event) => event.type)).toContain('run-completed');
    expect(harness.runner.canAbort).toBe(false);

    harness.runner.dispose();
    harness.runner.dispose();
    expect(harness.spawner.spawns).toHaveLength(1);
  });

  it('aborts a live automatic step and leaves no running process', async () => {
    const harness = makeHarness();
    await harness.runner.start();
    const process = harness.spawner.lastProcess;

    const aborted = await harness.runner.abort('Operator stopped the chain.');
    expect(aborted.status).toBe('aborted');
    expect(aborted.reason).toBe('Operator stopped the chain.');
    expect(aborted.steps[0]!.status).toBe('interrupted');
    expect(process.isRunning()).toBe(false);
    expect(process.killSignals.length).toBeGreaterThan(0);
    expect(harness.timers.pendingCount).toBe(0);
    expect(harness.events.map((event) => event.type)).toContain('run-aborted');
  });

  it('pauses with a spawn failure and never leaves an attached process', async () => {
    const spawner = new FakeSpawner();
    spawner.failSpawn = true;
    const harness = makeHarness({ spawner });

    const error = await captureRunnerError(() => harness.runner.start());
    expect(error.code).toBe(AUTOMATIC_RUNNER_ERROR_CODES.SPAWN_FAILED);
    expect(harness.spawner.spawns).toHaveLength(0);
    expect(harness.runner.getRun().status).toBe('paused');
    expect(harness.runner.getRun().steps[0]).toMatchObject({
      status: 'failed',
      reason: AUTOMATIC_STEP_REASONS.SPAWN_FAILED,
    });
    expect(harness.runner.state.isProcessRunning).toBe(false);
  });

  it('rejects a supervised run and defaults the step timeout to thirty minutes', async () => {
    const supervisedRun = makeRun(makeChain(), { mode: 'supervised' });
    expect(() => makeHarness({ run: supervisedRun })).toThrowError(
      expect.objectContaining({ code: AUTOMATIC_RUNNER_ERROR_CODES.MODE_INVALID }),
    );

    expect(DEFAULT_AUTOMATIC_STEP_TIMEOUT_MS).toBe(30 * 60 * 1_000);
    const harness = makeHarness();
    await harness.runner.start();
    // The injected fake timers are used; the default bound is still applied.
    expect(harness.timers.pendingCount).toBe(1);
  });
});
