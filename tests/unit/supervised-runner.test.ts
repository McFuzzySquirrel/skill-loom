import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CHAIN_VERSION, type Chain, type ChainSessionMode } from '../../src/server/chains/model.js';
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
  SUPERVISED_RUNNER_ERROR_CODES,
  SUPERVISED_STEP_REASONS,
  SupervisedRunner,
  SupervisedRunnerError,
  createSupervisedRunner,
  type SupervisedPty,
  type SupervisedPtyContext,
  type SupervisedPtyFactory,
  type SupervisedPtyProcess,
  type SupervisedRunEvent,
  type SupervisedSpawnSpec,
} from '../../src/server/runs/supervised.js';
import { createTerminalSession, type TerminalExit, type TerminalSession } from '../../src/server/terminal/pty.js';

const CREATED_AT = '2026-11-04T10:00:00.000Z';
const PROJECT_PATH = resolve('/tmp/loom-supervised-project');

const OPENCODE_EXECUTABLE = resolve('/opt/loom/bin/opencode');
const COPILOT_EXECUTABLE = resolve('/opt/loom/bin/copilot');

function makeChain(overrides: Partial<Chain> = {}): Chain {
  return {
    version: CHAIN_VERSION,
    id: 'chain-supervised',
    name: 'Supervised chain',
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
      {
        id: 'step-review',
        skillName: 'review',
        instruction: 'Review the result.',
        label: 'Review',
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
    id: 'run-supervised-1',
    projectId: 'project-1',
    chain,
    mode: options.mode ?? 'supervised',
    inputs: { task: 'ship the runner' },
    now: CREATED_AT,
    sessionId:
      options.sessionId !== undefined
        ? options.sessionId
        : sessionMode === 'fresh'
          ? null
          : `ses_${sessionMode}`,
  });
}

class FakeProcess implements SupervisedPtyProcess {
  readonly pid: number;
  readonly writes: string[] = [];
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

  write(data: string): void {
    this.writes.push(data);
  }

  kill(signal = 'SIGTERM'): void {
    this.killSignals.push(signal);
    if (this.running) {
      // Simulate the child reacting to the signal so a test can prove the
      // runner does not leave a live process behind.
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

class FakePty implements SupervisedPty {
  readonly id: string;
  readonly spawns: Array<{ spec: SupervisedSpawnSpec; process: FakeProcess }> = [];
  closeCalls = 0;
  failSpawn = false;
  private current: FakeProcess | null = null;
  private nextPid = 5000;

  constructor(id: string) {
    this.id = id;
  }

  spawn(spec: SupervisedSpawnSpec): SupervisedPtyProcess {
    if (this.failSpawn) {
      throw new Error('simulated spawn failure');
    }
    const process = new FakeProcess(this.nextPid);
    this.nextPid += 1;
    this.spawns.push({ spec, process });
    this.current = process;
    return process;
  }

  close(): void {
    this.closeCalls += 1;
    if (this.current?.isRunning() === true) {
      this.current.kill();
    }
    this.current = null;
  }

  get currentProcess(): FakeProcess | null {
    return this.current;
  }

  get lastProcess(): FakeProcess {
    const spawn = this.spawns.at(-1);
    if (spawn === undefined) {
      throw new Error('The fake PTY has not spawned a process.');
    }
    return spawn.process;
  }

  get lastSpec(): SupervisedSpawnSpec {
    const spawn = this.spawns.at(-1);
    if (spawn === undefined) {
      throw new Error('The fake PTY has not spawned a process.');
    }
    return spawn.spec;
  }
}

interface Harness {
  readonly runner: SupervisedRunner;
  readonly run: Run;
  readonly chain: Chain;
  readonly ptys: FakePty[];
  readonly contexts: SupervisedPtyContext[];
  readonly persisted: Run[];
  readonly events: SupervisedRunEvent[];
  readonly adapter: HarnessAdapter;
  readonly now: () => Date;
}

function makeClock(): () => Date {
  let current = Date.parse(CREATED_AT);
  return () => {
    current += 1_000;
    return new Date(current);
  };
}

function makeHarness(options: {
  chain?: Chain;
  run?: Run;
  adapter?: HarnessAdapter;
  failSpawn?: boolean;
  persist?: (run: Run) => void | Promise<void>;
} = {}): Harness {
  const chain = options.chain ?? makeChain();
  const run = options.run ?? makeRun(chain);
  const adapter = options.adapter ?? opencodeAdapter();
  const ptys: FakePty[] = [];
  const contexts: SupervisedPtyContext[] = [];
  const persisted: Run[] = [];
  const events: SupervisedRunEvent[] = [];
  const now = makeClock();

  const createPty: SupervisedPtyFactory = (context) => {
    contexts.push(context);
    const pty = new FakePty(context.terminalId);
    pty.failSpawn = options.failSpawn ?? false;
    ptys.push(pty);
    return pty;
  };

  let generated = 0;
  const runner = createSupervisedRunner({
    run,
    adapter,
    projectPath: PROJECT_PATH,
    createPty,
    now,
    createSessionId: () => {
      generated += 1;
      return `ses_generated_${String(generated)}`;
    },
    persist: (nextRun) => {
      persisted.push(nextRun);
      return options.persist?.(nextRun);
    },
    onEvent: (event) => {
      events.push(event);
    },
  });

  return { runner, run, chain, ptys, contexts, persisted, events, adapter, now };
}

function captureRunnerError(operation: () => unknown | Promise<unknown>): Promise<SupervisedRunnerError> {
  return Promise.resolve()
    .then(operation)
    .then(
      () => {
        throw new Error('Expected a SupervisedRunnerError.');
      },
      (error: unknown) => {
        if (error instanceof SupervisedRunnerError) {
          return error;
        }
        throw error;
      },
    );
}

describe('supervised runner start', () => {
  it('runs instructions with the same user outcome gating and without skill observations', async () => {
    const chain = makeChain({
      steps: [
        { id: 'plain', kind: 'instruction', instruction: 'Plan {{task}}.' },
        { id: 'skill', skillName: 'implement', instruction: 'Implement {{task}}.' },
      ],
    });
    const harness = makeHarness({ chain, adapter: copilotAdapter() });
    await harness.runner.start();
    expect(harness.ptys[0]!.lastSpec.args.join('\n')).toContain('Instruction:\nPlan ship the runner.');
    expect(harness.ptys[0]!.lastSpec.args.join('\n')).not.toContain('Skill:');
    harness.ptys[0]!.lastProcess.emitData('skill(unrelated)\n');
    expect(harness.runner.getRun().steps[0]?.skillObservation).toBe('not-observable');
    expect(harness.runner.getRun().currentStepIndex).toBe(0);
    expect(harness.runner.canNext).toBe(false);
    await harness.runner.markDone();
    await harness.runner.next();
    expect(harness.ptys[0]!.lastSpec.args.join('\n')).toContain('Skill: implement');
    await harness.runner.abort();
  });

  it('starts one fresh CLI process on a stable PTY with the session id and prompt', async () => {
    const harness = makeHarness();
    const run = await harness.runner.start();

    expect(harness.ptys).toHaveLength(1);
    expect(harness.contexts).toEqual([
      { terminalId: 'loom_run_run-supervised-1', cols: 120, rows: 32 },
    ]);
    expect(harness.ptys[0]!.spawns).toHaveLength(1);

    const spec = harness.ptys[0]!.lastSpec;
    expect(spec.executable).toBe(OPENCODE_EXECUTABLE);
    expect(spec.cwd).toBe(PROJECT_PATH);
    expect(spec.args.slice(0, 4)).toEqual([
      '--session',
      'ses_shared',
      '--prompt',
      expect.stringContaining('Skill: brainstorm'),
    ]);
    expect(spec.args.join('\n')).toContain('Instruction:\nPlan the task for ship the runner.');
    expect(spec.args.at(-1)).toBe(PROJECT_PATH);

    expect(run.status).toBe('awaiting-user');
    expect(run.currentStepIndex).toBe(0);
    expect(run.sessionId).toBe('ses_shared');
    expect(run.steps[0]).toMatchObject({
      id: 'step-plan',
      status: 'running',
      sessionId: 'ses_shared',
      exitCode: null,
      skillObservation: 'not-observable',
    });
    expect(run.steps[0]!.startedAt).not.toBeNull();
    expect(run.steps[0]!.finishedAt).toBeNull();
    expect(harness.runner.terminalId).toBe('loom_run_run-supervised-1');
    expect(harness.runner.state.isProcessRunning).toBe(true);
    expect(harness.ptys[0]!.lastProcess.writes).toEqual([]);
  });

  it('regenerates an incompatible stored session id instead of replaying it', async () => {
    const run = makeRun(makeChain(), {
      sessionId: '3f2a1c0e-4b1e-4f45-9d2f-6b2a0c9d8e11',
    });
    const harness = makeHarness({ run });

    const started = await harness.runner.start();
    const spec = harness.ptys[0]!.lastSpec;

    expect(spec.args.slice(0, 2)).toEqual(['--session', 'ses_generated_1']);
    expect(started.sessionId).toBe('ses_generated_1');
    expect(started.steps[0]!.sessionId).toBe('ses_generated_1');
  });

  it('rejects an automatic run and an already-started runner', async () => {
    const chain = makeChain();
    const automaticRun = makeRun(chain, { mode: 'automatic' });
    expect(() => makeHarness({ chain, run: automaticRun })).toThrowError(
      expect.objectContaining({ code: SUPERVISED_RUNNER_ERROR_CODES.MODE_INVALID }),
    );

    const harness = makeHarness();
    await harness.runner.start();
    const error = await captureRunnerError(() => harness.runner.start());
    expect(error.code).toBe(SUPERVISED_RUNNER_ERROR_CODES.ALREADY_STARTED);
  });

  it('fails before spawning when the step prompt cannot be assembled', async () => {
    const chain = makeChain();
    // createRunRecord validates declared placeholders, so this chain cannot be
    // saved normally; the runner still has to fail closed if a frozen snapshot
    // slips through. Corrupt the snapshot after creation to simulate that.
    const run = makeRun(chain);
    run.chainSnapshot.steps[0]!.instruction = 'Plan for {{missingInput}}.';
    run.resolvedInputs = {};
    const harness = makeHarness({ chain, run });

    const error = await captureRunnerError(() => harness.runner.start());
    expect(error.code).toBe(SUPERVISED_RUNNER_ERROR_CODES.PROMPT_FAILED);
    expect(harness.ptys).toHaveLength(1);
    expect(harness.ptys[0]!.spawns).toHaveLength(0);
    expect(harness.runner.getRun().status).toBe('paused');
    expect(harness.runner.getRun().steps[0]!.reason).toBe(
      SUPERVISED_STEP_REASONS.PROMPT_FAILED,
    );
  });

  it('pauses the run when the PTY cannot spawn a process', async () => {
    const harness = makeHarness({ failSpawn: true });
    const error = await captureRunnerError(() => harness.runner.start());

    expect(error.code).toBe(SUPERVISED_RUNNER_ERROR_CODES.SPAWN_FAILED);
    const run = harness.runner.getRun();
    expect(run.status).toBe('paused');
    expect(run.steps[0]).toMatchObject({
      status: 'failed',
      reason: SUPERVISED_STEP_REASONS.SPAWN_FAILED,
      exitCode: null,
    });
    expect(harness.runner.state.isProcessRunning).toBe(false);
  });
});

describe('supervised process exit semantics', () => {
  it('records a clean exit but never marks the step done or advances', async () => {
    const harness = makeHarness();
    await harness.runner.start();
    const process = harness.ptys[0]!.lastProcess;

    process.emitExit(0);

    const run = harness.runner.getRun();
    expect(run.status).toBe('awaiting-user');
    expect(run.currentStepIndex).toBe(0);
    expect(run.steps[0]).toMatchObject({
      status: 'running',
      exitCode: 0,
      reason: SUPERVISED_STEP_REASONS.PROCESS_EXITED,
    });
    expect(harness.runner.canNext).toBe(false);
    expect(harness.ptys[0]!.spawns).toHaveLength(1);
    expect(harness.events.map((event) => event.type)).toContain('process-exit');
    expect(harness.events.map((event) => event.type)).not.toContain('step-advanced');
  });

  it('pauses on a non-zero exit and offers Retry, Skip, and Abort', async () => {
    const harness = makeHarness();
    await harness.runner.start();

    harness.ptys[0]!.lastProcess.emitExit(2);

    const run = harness.runner.getRun();
    expect(run.status).toBe('paused');
    expect(run.steps[0]).toMatchObject({
      status: 'running',
      exitCode: 2,
      reason: SUPERVISED_STEP_REASONS.PROCESS_EXITED_NONZERO,
    });
    expect(run.reason).toBe(SUPERVISED_STEP_REASONS.PROCESS_EXITED_NONZERO);
    expect(harness.runner.canNext).toBe(false);
    expect(harness.runner.canRetry).toBe(true);
    expect(harness.runner.canSkip).toBe(true);
    expect(harness.runner.canAbort).toBe(true);
    expect(harness.runner.state.currentStepIndex).toBe(0);
  });
});

describe('supervised user outcomes and Next gating', () => {
  it('enables Next after Done and advances on the same PTY with the same session', async () => {
    const harness = makeHarness();
    await harness.runner.start();
    const first = harness.ptys[0]!.lastProcess;

    const done = await harness.runner.markDone();
    expect(done.status).toBe('awaiting-user');
    expect(done.steps[0]).toMatchObject({ status: 'done', exitCode: 143 });
    expect(done.steps[0]!.finishedAt).not.toBeNull();
    expect(harness.runner.canNext).toBe(true);

    const advanced = await harness.runner.next();
    expect(harness.ptys).toHaveLength(1);
    expect(harness.ptys[0]!.spawns).toHaveLength(2);
    expect(harness.ptys[0]!.spawns[1]!.spec.args).toContain('ses_shared');
    expect(advanced.currentStepIndex).toBe(1);
    expect(advanced.status).toBe('awaiting-user');
    expect(advanced.steps[1]).toMatchObject({
      id: 'step-build',
      status: 'running',
      sessionId: 'ses_shared',
    });
    expect(first.killSignals.length).toBeGreaterThan(0);
    expect(harness.ptys[0]!.lastProcess.writes).toEqual([]);
  });

  it('enables Next after Skipped and records the reason', async () => {
    const harness = makeHarness();
    await harness.runner.start();

    const skipped = await harness.runner.skip('Reviewed manually outside Skill Loom.');
    expect(skipped.status).toBe('awaiting-user');
    expect(skipped.steps[0]).toMatchObject({
      status: 'skipped',
      reason: 'Reviewed manually outside Skill Loom.',
    });
    expect(skipped.steps[0]!.finishedAt).not.toBeNull();
    expect(harness.runner.canNext).toBe(true);

    const advanced = await harness.runner.next();
    expect(advanced.currentStepIndex).toBe(1);
    expect(harness.ptys[0]!.spawns).toHaveLength(2);
  });

  it('does not enable Next after Failed and rejects Next with a typed error', async () => {
    const harness = makeHarness();
    await harness.runner.start();

    const failed = await harness.runner.markFailed('The agent refused the request.');
    expect(failed.status).toBe('paused');
    expect(failed.steps[0]).toMatchObject({
      status: 'failed',
      reason: 'The agent refused the request.',
    });
    expect(harness.runner.canNext).toBe(false);
    expect(harness.runner.canRetry).toBe(true);

    const error = await captureRunnerError(() => harness.runner.next());
    expect(error.code).toBe(SUPERVISED_RUNNER_ERROR_CODES.NEXT_NOT_READY);
    expect(harness.ptys[0]!.spawns).toHaveLength(1);
    expect(harness.runner.getRun().currentStepIndex).toBe(0);
  });

  it('rejects a skip without a reason', async () => {
    const harness = makeHarness();
    await harness.runner.start();

    const error = await captureRunnerError(() => harness.runner.skip('   '));
    expect(error.code).toBe(SUPERVISED_RUNNER_ERROR_CODES.SKIP_REASON_REQUIRED);
    expect(harness.runner.getRun().steps[0]!.status).toBe('running');
    expect(harness.runner.canNext).toBe(false);
  });
});

describe('supervised retry', () => {
  it('restarts the same step with the same prompt and session id', async () => {
    const harness = makeHarness();
    await harness.runner.start();
    const firstSpec = harness.ptys[0]!.spawns[0]!.spec;
    await harness.runner.markFailed('Retry me.');

    const retried = await harness.runner.retry();

    expect(harness.ptys).toHaveLength(1);
    expect(harness.ptys[0]!.spawns).toHaveLength(2);
    expect(harness.ptys[0]!.spawns[1]!.spec).toEqual(firstSpec);
    expect(retried.currentStepIndex).toBe(0);
    expect(retried.status).toBe('awaiting-user');
    expect(retried.steps[0]).toMatchObject({
      status: 'running',
      sessionId: 'ses_shared',
      exitCode: null,
      tail: '',
      reason: null,
    });
    expect(harness.runner.canRetry).toBe(false);
  });

  it('retries a paused non-zero exit without changing the plan', async () => {
    const harness = makeHarness();
    await harness.runner.start();
    harness.ptys[0]!.lastProcess.emitExit(9);
    const firstSpec = harness.ptys[0]!.spawns[0]!.spec;

    expect(harness.runner.canRetry).toBe(true);
    const retried = await harness.runner.retry();

    expect(retried.status).toBe('awaiting-user');
    expect(harness.ptys[0]!.spawns[1]!.spec).toEqual(firstSpec);
    expect(harness.ptys[0]!.spawns[1]!.spec.args).toContain('ses_shared');
  });

  it('refuses retry when the step is done', async () => {
    const harness = makeHarness();
    await harness.runner.start();
    await harness.runner.markDone();

    const error = await captureRunnerError(() => harness.runner.retry());
    expect(error.code).toBe(SUPERVISED_RUNNER_ERROR_CODES.RETRY_NOT_AVAILABLE);
    expect(harness.ptys[0]!.spawns).toHaveLength(1);
  });
});

describe('supervised abort and completion cleanup', () => {
  it('aborts the run, kills the process, and closes the PTY', async () => {
    const harness = makeHarness();
    await harness.runner.start();

    const aborted = await harness.runner.abort('User stopped the chain.');

    expect(aborted.status).toBe('aborted');
    expect(aborted.finishedAt).not.toBeNull();
    expect(aborted.reason).toBe('User stopped the chain.');
    expect(aborted.steps[0]!.status).toBe('interrupted');
    expect(harness.ptys[0]!.lastProcess.killSignals.length).toBeGreaterThan(0);
    expect(harness.ptys[0]!.lastProcess.isRunning()).toBe(false);
    expect(harness.ptys[0]!.closeCalls).toBe(1);
    expect(harness.runner.canAbort).toBe(false);
    expect(harness.runner.state.isProcessRunning).toBe(false);
    expect(harness.runner.state.currentStepIndex).toBe(0);

    // Disposal is idempotent and does not spawn or advance anything.
    harness.runner.dispose();
    harness.runner.dispose();
    expect(harness.ptys[0]!.spawns).toHaveLength(1);
  });

  it('completes the chain only after Done/Skipped for every step and cleans up', async () => {
    const harness = makeHarness();
    await harness.runner.start();

    await harness.runner.markDone();
    await harness.runner.next();
    await harness.runner.markDone();
    await harness.runner.next();
    await harness.runner.skip('No review needed.');

    const completed = await harness.runner.next();

    expect(completed.status).toBe('completed');
    expect(completed.currentStepIndex).toBe(2);
    expect(completed.steps.map((step) => step.status)).toEqual([
      'done',
      'done',
      'skipped',
    ]);
    expect(completed.finishedAt).not.toBeNull();
    expect(harness.ptys[0]!.spawns).toHaveLength(3);
    expect(harness.ptys[0]!.closeCalls).toBe(1);
    expect(harness.runner.canAbort).toBe(false);
    expect(
      harness.ptys[0]!.spawns.every((spawn) => spawn.process.writes.length === 0),
    ).toBe(true);
  });

  it('reaps a stubborn process before starting the next supervised step', async () => {
    const harness = makeHarness();
    await harness.runner.start();
    const first = harness.ptys[0]!.lastProcess;
    const kill = first.kill.bind(first);
    vi.spyOn(first, 'kill').mockImplementation((signal) => {
      if (signal === 'SIGKILL') kill(signal);
    });

    await harness.runner.markDone();
    await harness.runner.next();
    expect(first.killSignals).toContain('SIGKILL');
    expect(first.isRunning()).toBe(false);
    expect(harness.ptys[0]!.spawns).toHaveLength(2);
    await harness.runner.abort();
  });

  it.skipIf(process.platform === 'win32')('reaps a real SIGTERM-resistant PTY before advancing', async () => {
    const harness = makeHarness();
    const sessions: TerminalSession[] = [];
    const runner = createSupervisedRunner({
      run: harness.run,
      adapter: harness.adapter,
      projectPath: PROJECT_PATH,
      now: harness.now,
      createPty: (context) => ({
        id: context.terminalId,
        spawn: () => {
          const session = createTerminalSession({
            executable: process.execPath,
            args: ['-e', "process.on('SIGTERM', () => {}); process.stdout.write('READY\\n'); setInterval(() => {}, 1000);"],
            cwd: process.cwd(),
          }, { id: `${context.terminalId}-${String(sessions.length)}` });
          sessions.push(session);
          return session;
        },
        close: () => sessions.at(-1)?.kill(),
      }),
    });
    try {
      await runner.start();
      const first = sessions[0]!;
      await vi.waitFor(() => expect(first.getBufferedOutput()).toContain('READY'), { timeout: 5_000 });
      await runner.markDone();
      await runner.next();
      expect(first.isRunning()).toBe(false);
      expect(sessions).toHaveLength(2);
      await runner.abort();
    } finally {
      for (const session of sessions) session.kill('SIGKILL');
      await runner.shutdown();
    }
  }, 10_000);

  it('refuses to advance when the supervised process cannot be terminated', async () => {
    const harness = makeHarness();
    await harness.runner.start();
    const first = harness.ptys[0]!.lastProcess;
    const kill = vi.spyOn(first, 'kill').mockImplementation(() => { throw new Error('termination failed'); });
    await harness.runner.markDone();
    await expect(harness.runner.next()).rejects.toMatchObject({
      code: 'SUPERVISED_PROCESS_TERMINATION_FAILED',
    });
    expect(harness.runner.getRun()).toMatchObject({ status: 'awaiting-user', currentStepIndex: 0 });
    expect(harness.ptys[0]!.spawns).toHaveLength(1);
    expect(first.isRunning()).toBe(true);
    kill.mockRestore();
    await harness.runner.shutdown();
    expect(first.isRunning()).toBe(false);
  });

  it('does not record an abort when the supervised process cannot be terminated', async () => {
    const harness = makeHarness();
    await harness.runner.start();
    const process = harness.ptys[0]!.lastProcess;
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw new Error('termination failed'); });
    await expect(harness.runner.abort()).rejects.toMatchObject({
      code: 'SUPERVISED_PROCESS_TERMINATION_FAILED',
    });
    expect(harness.runner.getRun().status).not.toBe('aborted');
    expect(process.isRunning()).toBe(true);
    kill.mockRestore();
    await harness.runner.shutdown();
  });

  it('retains the supervised process after a failed shutdown so cleanup can be retried', async () => {
    const harness = makeHarness();
    await harness.runner.start();
    const process = harness.ptys[0]!.lastProcess;
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw new Error('termination failed'); });

    await expect(harness.runner.shutdown()).rejects.toMatchObject({
      code: 'SUPERVISED_PROCESS_TERMINATION_FAILED',
    });
    expect(process.isRunning()).toBe(true);
    expect(harness.ptys[0]!.closeCalls).toBe(0);

    kill.mockRestore();
    await harness.runner.shutdown();
    expect(process.isRunning()).toBe(false);
    expect(harness.ptys[0]!.closeCalls).toBe(1);
  });

  it('retains a supervised process that ignores both termination signals', async () => {
    const harness = makeHarness();
    await harness.runner.start();
    const process = harness.ptys[0]!.lastProcess;
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => undefined);
    vi.useFakeTimers();
    try {
      const shutdown = harness.runner.shutdown();
      const failure = expect(shutdown).rejects.toMatchObject({
        code: 'SUPERVISED_PROCESS_TERMINATION_FAILED',
      });
      await vi.advanceTimersByTimeAsync(2_500);
      await failure;
      expect(kill.mock.calls.map(([signal]) => signal)).toEqual(['SIGTERM', 'SIGKILL']);
      expect(process.isRunning()).toBe(true);
    } finally {
      vi.useRealTimers();
      kill.mockRestore();
      await harness.runner.shutdown();
    }
    expect(process.isRunning()).toBe(false);
  });
});

describe('supervised session plans', () => {
  it('uses a new session id for every step in fresh mode', async () => {
    const chain = makeChain({ sessionMode: 'fresh' });
    const harness = makeHarness({ chain });
    const started = await harness.runner.start();

    expect(started.sessionId).toBeNull();
    expect(started.steps[0]!.sessionId).toBe('ses_generated_1');
    expect(harness.ptys[0]!.lastSpec.args).toContain('ses_generated_1');

    await harness.runner.markDone();
    const advanced = await harness.runner.next();

    expect(advanced.steps[1]!.sessionId).toBe('ses_generated_2');
    expect(harness.ptys[0]!.lastSpec.args).toContain('ses_generated_2');
    expect(harness.ptys[0]!.lastSpec.args).not.toContain('ses_generated_1');
  });

  it('uses the native handoff prompt for a supervised fork on the next step', async () => {
    const chain = makeChain({ sessionMode: 'fork' });
    const harness = makeHarness({ chain });
    await harness.runner.start();
    await harness.runner.markDone();
    const advanced = await harness.runner.next();

    expect(advanced.forkMechanism).toBe('handoff');
    expect(advanced.steps[1]!.forkMechanism).toBe('handoff');
    expect(harness.ptys[0]!.lastSpec.args.join('\n')).toContain('Handoff');
    expect(harness.ptys[0]!.lastSpec.args).toContain(advanced.steps[1]!.sessionId);
  });
});

describe('supervised output, tail, and observation', () => {
  it('records a bounded tail of at most 200 lines and 32 KiB', async () => {
    const harness = makeHarness();
    await harness.runner.start();
    const process = harness.ptys[0]!.lastProcess;

    const manyLines = Array.from({ length: 400 }, (_, index) => `line-${String(index)}`).join('\r\n');
    process.emitData(`${manyLines}\r\n${'x'.repeat(40_000)}`);

    const step = harness.runner.getRun().steps[0]!;
    expect(step.tail.split('\n').length).toBeLessThanOrEqual(MAX_TAIL_LINES);
    expect(Buffer.byteLength(step.tail, 'utf8')).toBeLessThanOrEqual(MAX_TAIL_BYTES);
    expect(step.tail).not.toContain('line-0\r');
    expect(step.tail).toContain('x'.repeat(1_000));
  });

  it('records not-observable for interactive OpenCode', async () => {
    const harness = makeHarness();
    await harness.runner.start();
    harness.ptys[0]!.lastProcess.emitData('skill(brainstorm)\r\n');

    expect(harness.runner.getRun().steps[0]!.skillObservation).toBe('not-observable');
    await harness.runner.markDone();
    expect(harness.runner.getRun().steps[0]!.skillObservation).toBe('not-observable');
  });

  it('records Copilot skill(name) evidence as observed', async () => {
    const chain = makeChain({ harness: 'copilot' });
    const harness = makeHarness({ chain, adapter: copilotAdapter() });
    const started = await harness.runner.start();

    expect(started.steps[0]!.skillObservation).toBe('unknown');
    harness.ptys[0]!.lastProcess.emitData('\x1b[36m● skill(brainstorm)\x1b[0m\r\n');

    expect(harness.runner.getRun().steps[0]!.skillObservation).toBe('observed');
    await harness.runner.markDone();
    expect(harness.runner.getRun().steps[0]!.skillObservation).toBe('observed');
  });

  it('streams output events without persisting a transcript', async () => {
    const harness = makeHarness();
    await harness.runner.start();
    harness.ptys[0]!.lastProcess.emitData('hello from the harness\r\n');

    const output = harness.events.filter((event) => event.type === 'output');
    expect(output).toHaveLength(1);
    expect(output[0]!.chunk).toBe('hello from the harness\r\n');
    expect(harness.persisted.every((run) => !JSON.stringify(run).includes('hello from the harness'))).toBe(
      true,
    );
  });
});

describe('supervised action dispatch', () => {
  it('dispatches Done, Next, Retry, Skip, and Abort through the action surface', async () => {
    const doneHarness = makeHarness();
    await doneHarness.runner.start();
    const nextRun = await doneHarness.runner.applyAction({ action: 'done' });
    expect(nextRun.steps[0]!.status).toBe('done');
    await doneHarness.runner.applyAction({ action: 'next' });
    expect(doneHarness.runner.state.currentStepIndex).toBe(1);

    const retryHarness = makeHarness();
    await retryHarness.runner.start();
    await retryHarness.runner.applyAction({ action: 'failed', reason: 'nope' });
    await retryHarness.runner.applyAction({ action: 'retry' });
    expect(retryHarness.runner.getRun().steps[0]!.status).toBe('running');
    expect(retryHarness.ptys[0]!.spawns).toHaveLength(2);

    const skipHarness = makeHarness();
    await skipHarness.runner.start();
    const skipped = await skipHarness.runner.applyAction({
      action: 'skip',
      reason: 'Skipped by the operator.',
    });
    expect(skipped.steps[0]!.status).toBe('skipped');

    const abortHarness = makeHarness();
    await abortHarness.runner.start();
    const aborted = await abortHarness.runner.applyAction({ action: 'abort' });
    expect(aborted.status).toBe('aborted');

    const invalidHarness = makeHarness();
    await invalidHarness.runner.start();
    const error = await captureRunnerError(() =>
      invalidHarness.runner.applyAction({ action: 'pause' }),
    );
    expect(error.code).toBe(SUPERVISED_RUNNER_ERROR_CODES.ACTION_INVALID);
  });

  it('persists state snapshots through the injected atomic-write seam', async () => {
    const harness = makeHarness();
    await harness.runner.start();
    await harness.runner.markDone();

    expect(harness.persisted.length).toBeGreaterThanOrEqual(2);
    expect(harness.persisted.at(-1)!.steps[0]!.status).toBe('done');
    // Each persisted snapshot is a clone, not the runner's live object.
    expect(harness.persisted[0]).not.toBe(harness.persisted[1]);
  });

  it('does not spawn a supervised step if its running snapshot cannot be persisted', async () => {
    const harness = makeHarness({
      persist: (run) => {
        if (run.steps[0]?.status === 'running') throw new Error('simulated persistence failure');
      },
    });

    await expect(harness.runner.start()).rejects.toMatchObject({
      code: 'SUPERVISED_PERSIST_FAILED',
    });
    expect(harness.ptys[0]!.spawns).toHaveLength(0);
    await harness.runner.shutdown();
  });

  it('does not spawn a later supervised step if its running snapshot cannot be persisted', async () => {
    let fail = true;
    const harness = makeHarness({
      persist: (run) => {
        if (fail && run.steps[1]?.status === 'running') throw new Error('simulated persistence failure');
      },
    });
    await harness.runner.start();
    const first = harness.ptys[0]!.lastProcess;
    await harness.runner.markDone();
    await expect(harness.runner.next()).rejects.toMatchObject({
      code: 'SUPERVISED_PERSIST_FAILED',
    });
    expect(first.isRunning()).toBe(false);
    expect(harness.ptys[0]!.spawns).toHaveLength(1);
    expect(harness.runner.getRun()).toMatchObject({
      status: 'paused', reason: 'PERSIST_FAILED', steps: [{ status: 'done' }, { status: 'failed' }, {}],
    });
    expect(harness.runner.state.canRetry).toBe(true);
    fail = false;
    await harness.runner.retry();
    expect(harness.ptys[0]!.spawns).toHaveLength(2);
    await harness.runner.shutdown();
  });
});
