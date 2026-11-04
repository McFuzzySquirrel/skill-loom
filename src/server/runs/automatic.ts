/**
 * Automatic run state machine (RUN-FR-07, RUN-FR-08, RUN-FR-09).
 *
 * An automatic run advances a step only on the signal the adapter declares:
 *
 * - `osc-working-idle` (OpenCode): one PTY process per step. A step advances
 *   only when `OSC 7501;state=idle` follows `state=working` in the same step.
 *   The process is stopped gracefully after the completion edge and the next
 *   step is restarted with its planned session id.
 * - `process-exit` (Copilot): one headless process per step. A step advances
 *   only when that process exits; a non-zero exit fails the step.
 *
 * There is deliberately no output-idle heuristic, no animation-quiescence
 * check, and no fixed sleep that can advance a step. The single timer in this
 * module is a bounded per-step timeout that pauses the run when the declared
 * signal never arrives (EXEC-02).
 *
 * Harness commands, flags, session/fork support, and the advancement signal
 * all come from the adapter descriptor. This module never compares a harness
 * name (NFR-COMPAT-01).
 */

import { isAbsolute } from 'node:path';
import type {
  HarnessAdapter,
  HarnessAdvancementSignal,
  HarnessCommand,
  ForkMechanism,
} from '../harness/types.js';
import type { TerminalExit } from '../terminal/pty.js';
import {
  MAX_TAIL_BYTES,
  MAX_TAIL_LINES,
  isFinalRunStatus,
  toTimestamp,
  trimTail,
  truncateReason,
  type Run,
  type RunStepRecord,
  type SkillObservationState,
  type StepStatus,
} from './model.js';
import { SkillObservationTracker } from './observations.js';
import { Osc7501StateMachine } from './osc.js';
import {
  buildStepPrompt,
  planRunSessions,
  type PlannedStepSession,
  type RunSessionPlan,
} from './prompts.js';

/** Default terminal geometry for a PTY-backed automatic step. */
export const AUTOMATIC_TERMINAL_COLS = 120;
export const AUTOMATIC_TERMINAL_ROWS = 32;

/**
 * Default bound for one automatic step. A missing completion signal pauses
 * the run instead of skipping the step or retrying it (RUN-FR-08).
 */
export const DEFAULT_AUTOMATIC_STEP_TIMEOUT_MS = 30 * 60 * 1_000;

/** The two process surfaces an automatic adapter may declare. */
export const AUTOMATIC_SPAWN_SURFACES = ['pty', 'process'] as const;
export type AutomaticSpawnSurface = (typeof AUTOMATIC_SPAWN_SURFACES)[number];

/**
 * One shell-free process invocation. The surface is chosen from
 * `adapter.automaticAdvancement`, never from a harness name.
 */
export interface AutomaticSpawnSpec {
  readonly surface: AutomaticSpawnSurface;
  /** Stable run terminal id. A PTY-backed spawner must reuse it across steps. */
  readonly terminalId: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly cols: number;
  readonly rows: number;
}

/** A child process attached to one automatic step. */
export interface AutomaticProcess {
  readonly pid: number;
  onData(listener: (chunk: string) => void): () => void;
  onExit(listener: (event: TerminalExit) => void): () => void;
  kill(signal?: string): void;
  isRunning(): boolean;
  getExit(): TerminalExit | null;
}

/** Injected process factory. Adds an executable plus args, never a shell string. */
export type AutomaticSpawner = (spec: AutomaticSpawnSpec) => AutomaticProcess;

/** Timer seam so timeout behaviour is deterministic in unit tests. */
export interface AutomaticTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const DEFAULT_TIMERS: AutomaticTimers = {
  setTimeout(callback: () => void, ms: number): unknown {
    const handle = setTimeout(callback, ms);
    // A 30 minute timeout must not keep a finished server process alive.
    const unref = (handle as { unref?: () => void }).unref;
    if (typeof unref === 'function') {
      unref.call(handle);
    }
    return handle;
  },
  clearTimeout(handle: unknown): void {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/** Stable automatic-run failure codes. */
export const AUTOMATIC_RUNNER_ERROR_CODES = {
  RUN_INVALID: 'AUTOMATIC_RUN_INVALID',
  MODE_INVALID: 'AUTOMATIC_MODE_INVALID',
  PROJECT_PATH_INVALID: 'AUTOMATIC_PROJECT_PATH_INVALID',
  TERMINAL_ID_INVALID: 'AUTOMATIC_TERMINAL_ID_INVALID',
  ALREADY_STARTED: 'AUTOMATIC_ALREADY_STARTED',
  NOT_STARTED: 'AUTOMATIC_NOT_STARTED',
  DISPOSED: 'AUTOMATIC_DISPOSED',
  START_STATE_INVALID: 'AUTOMATIC_START_STATE_INVALID',
  STEP_NOT_ACTIVE: 'AUTOMATIC_STEP_NOT_ACTIVE',
  ACTION_INVALID: 'AUTOMATIC_ACTION_INVALID',
  FINAL_RUN: 'AUTOMATIC_FINAL_RUN',
  RUN_NEXT_NOT_READY: 'AUTOMATIC_RUN_NEXT_NOT_READY',
  PROCESS_STILL_RUNNING: 'AUTOMATIC_PROCESS_STILL_RUNNING',
  RETRY_NOT_AVAILABLE: 'AUTOMATIC_RETRY_NOT_AVAILABLE',
  SKIP_REASON_REQUIRED: 'AUTOMATIC_SKIP_REASON_REQUIRED',
  PROMPT_FAILED: 'AUTOMATIC_PROMPT_FAILED',
  COMMAND_FAILED: 'AUTOMATIC_COMMAND_FAILED',
  SPAWN_FAILED: 'AUTOMATIC_SPAWN_FAILED',
  ADVANCEMENT_UNSUPPORTED: 'AUTOMATIC_ADVANCEMENT_UNSUPPORTED',
  PERSIST_FAILED: 'AUTOMATIC_PERSIST_FAILED',
} as const;
export type AutomaticRunnerErrorCode =
  (typeof AUTOMATIC_RUNNER_ERROR_CODES)[keyof typeof AUTOMATIC_RUNNER_ERROR_CODES];

/** Typed runner failure. Details never contain prompt text or credentials. */
export class AutomaticRunnerError extends Error {
  readonly code: AutomaticRunnerErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: AutomaticRunnerErrorCode,
    message: string,
    details: Record<string, unknown> = {},
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

/** Actions accepted by the future HTTP action route for automatic runs. */
export const AUTOMATIC_ACTIONS = [
  'pause',
  'resume',
  'run-next',
  'next',
  'retry',
  'skip',
  'abort',
] as const;
export type AutomaticActionName = (typeof AUTOMATIC_ACTIONS)[number];

export interface AutomaticActionRequest {
  readonly action: AutomaticActionName | string;
  readonly reason?: string;
}

/** Events emitted for the run view and the WebSocket stream (RUN-06). */
export const AUTOMATIC_EVENT_TYPES = [
  'started',
  'step-started',
  'output',
  'process-exit',
  'signal',
  'step-done',
  'step-failed',
  'step-skipped',
  'step-advanced',
  'run-paused',
  'run-resumed',
  'run-completed',
  'run-aborted',
  'run-failed',
  'timeout',
  'disposed',
] as const;
export type AutomaticEventType = (typeof AUTOMATIC_EVENT_TYPES)[number];

export interface AutomaticRunEvent {
  readonly type: AutomaticEventType;
  /** Deep-cloned run state at the moment of the event. Never a transcript. */
  readonly run: Run;
  readonly stepIndex: number;
  readonly stepId: string | null;
  readonly terminalId: string | null;
  readonly surface: AutomaticSpawnSurface | null;
  readonly exitCode?: number | null;
  readonly observation?: SkillObservationState;
  readonly reason?: string | null;
  /** Live output chunk. It is not persisted; only the bounded tail is. */
  readonly chunk?: string;
  /** Exact broad permission flags active for this step, if any. */
  readonly permissions?: readonly string[];
}

/** Stable reasons written into automatic step records. Never transcripts. */
export const AUTOMATIC_STEP_REASONS = {
  PROCESS_EXITED: 'PROCESS_EXITED',
  PROCESS_EXITED_NONZERO: 'PROCESS_EXITED_NONZERO',
  COMPLETION_SIGNAL: 'COMPLETION_SIGNAL',
  COMPLETION_TIMEOUT: 'AUTOMATIC_TIMEOUT',
  MISSING_COMPLETION_SIGNAL: 'MISSING_COMPLETION_SIGNAL',
  AMBIGUOUS_STATE: 'AMBIGUOUS_STATE',
  PAUSED_BY_USER: 'PAUSED_BY_USER',
  SKIPPED_BY_USER: 'SKIPPED_BY_USER',
  ABORTED_BY_USER: 'ABORTED_BY_USER',
  PROMPT_FAILED: 'PROMPT_FAILED',
  COMMAND_FAILED: 'COMMAND_FAILED',
  PERMISSION_OPT_IN_REQUIRED: 'PERMISSION_OPT_IN_REQUIRED',
  SPAWN_FAILED: 'SPAWN_FAILED',
  UNSUPPORTED_ADVANCEMENT: 'UNSUPPORTED_ADVANCEMENT',
} as const;

export interface AutomaticRunnerOptions {
  /** A validated run record in automatic mode, normally from `createRunRecord`. */
  readonly run: Run;
  /** Adapter from the harness registry, never selected by a harness-name branch. */
  readonly adapter: HarnessAdapter;
  /** Canonical absolute project directory resolved from a project id. */
  readonly projectPath: string;
  /** Creates exactly one child process per step on the declared surface. */
  readonly spawn: AutomaticSpawner;
  /** Clock seam for deterministic timestamps. */
  readonly now?: (() => Date) | undefined;
  /** Session id seam used by fresh and fork plans. */
  readonly createSessionId?: (() => string) | undefined;
  /** Stable run terminal id. Defaults to `slan_run_<runId>`. */
  readonly terminalId?: string | undefined;
  readonly cols?: number | undefined;
  readonly rows?: number | undefined;
  readonly maxTailLines?: number | undefined;
  readonly maxTailBytes?: number | undefined;
  /** Bound for one automatic step. Defaults to 30 minutes. */
  readonly stepTimeoutMs?: number | undefined;
  /** Timer seam; defaults to the global timers. */
  readonly timers?: AutomaticTimers | undefined;
  /** Optional atomic persistence callback owned by the orchestrator/store. */
  readonly persist?: ((run: Run) => void | Promise<void>) | undefined;
  /** Event listener for the live terminal and step-state stream. */
  readonly onEvent?: ((event: AutomaticRunEvent) => void) | undefined;
}

/** Read-only view used by the run view and the action route. */
export interface AutomaticRunnerState {
  readonly run: Run;
  readonly terminalId: string | null;
  readonly surface: AutomaticSpawnSurface | null;
  readonly started: boolean;
  readonly disposed: boolean;
  readonly currentStepIndex: number;
  readonly currentStepStatus: StepStatus | null;
  readonly isProcessRunning: boolean;
  readonly pauseRequested: boolean;
  readonly canPause: boolean;
  readonly canRunNext: boolean;
  /** Alias for `canRunNext`, matching the generic action vocabulary. */
  readonly canNext: boolean;
  readonly canRetry: boolean;
  readonly canSkip: boolean;
  readonly canAbort: boolean;
  /** Exact broad flags in force for the current chain, or an empty list. */
  readonly permissions: readonly string[];
}

interface AttachedProcess {
  readonly token: symbol;
  readonly stepIndex: number;
  readonly process: AutomaticProcess;
  readonly unsubscribeData: () => void;
  readonly unsubscribeExit: () => void;
}

interface PreparedStep {
  readonly prompt: string;
  readonly planned: PlannedStepSession;
}

/**
 * Automatic runner.
 *
 * Lifecycle:
 *   start() -> step 1 running
 *   -> declared signal => step done => next step starts automatically
 *   -> failure/timeout/ambiguous exit => step failed, run paused
 *   -> pause() => the in-flight step may finish, but the next step waits for
 *      runNext(); `runNext()` starts the next pending step without changing
 *      the run mode.
 */
export class AutomaticRunner {
  private readonly runValue: Run;
  private readonly adapter: HarnessAdapter;
  private readonly projectPathValue: string;
  private readonly spawn: AutomaticSpawner;
  private readonly clock: () => Date;
  private readonly createSessionId: (() => string) | undefined;
  private readonly requestedTerminalId: string;
  private readonly cols: number;
  private readonly rows: number;
  private readonly maxTailLines: number;
  private readonly maxTailBytes: number;
  private readonly stepTimeoutMs: number;
  private readonly timers: AutomaticTimers;
  private readonly persistHook: ((run: Run) => void | Promise<void>) | undefined;
  private readonly listeners = new Set<(event: AutomaticRunEvent) => void>();

  private sessionPlanValue: RunSessionPlan | null = null;
  private preparedSteps = new Map<number, PreparedStep>();
  private tracker: SkillObservationTracker | null = null;
  private osc: Osc7501StateMachine | null = null;
  private current: AttachedProcess | null = null;
  private timeoutHandle: unknown = null;
  private terminalIdValue: string | null = null;
  private surfaceValue: AutomaticSpawnSurface | null = null;
  private startedValue = false;
  private disposedValue = false;
  private pauseRequestedValue = false;
  private transitions: Promise<void> = Promise.resolve();

  constructor(options: AutomaticRunnerOptions) {
    if (typeof options !== 'object' || options === null) {
      throw new AutomaticRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.RUN_INVALID,
        'An automatic runner requires a run record.',
      );
    }

    let run: Run;
    try {
      run = structuredClone(options.run);
    } catch (error) {
      throw new AutomaticRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.RUN_INVALID,
        'The run record could not be read.',
        {},
        { cause: error },
      );
    }

    if (run === null || typeof run !== 'object' || run.mode !== 'automatic') {
      throw new AutomaticRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.MODE_INVALID,
        'The automatic runner only accepts a run in automatic mode.',
        { mode: run !== null && typeof run === 'object' ? run.mode : typeof run },
      );
    }
    if (run.status !== 'starting') {
      throw new AutomaticRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.START_STATE_INVALID,
        'An automatic runner starts from a run in the "starting" state.',
        { status: run.status },
      );
    }
    if (options.adapter === undefined || options.adapter === null) {
      throw new AutomaticRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.RUN_INVALID,
        'A harness adapter is required.',
      );
    }
    if (typeof options.spawn !== 'function') {
      throw new AutomaticRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.RUN_INVALID,
        'An automatic process spawner is required.',
      );
    }

    this.runValue = run;
    this.adapter = options.adapter;
    this.projectPathValue = validateProjectPath(options.projectPath);
    this.spawn = options.spawn;
    this.clock = options.now ?? (() => new Date());
    this.createSessionId = options.createSessionId ?? (() => this.adapter.createSessionId());
    this.requestedTerminalId = options.terminalId ?? `slan_run_${run.id}`;
    assertTerminalId(this.requestedTerminalId);
    this.cols = positiveDimension(options.cols, AUTOMATIC_TERMINAL_COLS, 'cols');
    this.rows = positiveDimension(options.rows, AUTOMATIC_TERMINAL_ROWS, 'rows');
    this.maxTailLines = positiveTailLimit(
      options.maxTailLines,
      MAX_TAIL_LINES,
      MAX_TAIL_LINES,
      'maxTailLines',
    );
    this.maxTailBytes = positiveTailLimit(
      options.maxTailBytes,
      MAX_TAIL_BYTES,
      MAX_TAIL_BYTES,
      'maxTailBytes',
    );
    this.stepTimeoutMs = positiveTimeout(options.stepTimeoutMs);
    this.timers = options.timers ?? DEFAULT_TIMERS;
    this.persistHook = options.persist;

    if (options.onEvent !== undefined) {
      if (typeof options.onEvent !== 'function') {
        throw new AutomaticRunnerError(
          AUTOMATIC_RUNNER_ERROR_CODES.RUN_INVALID,
          'The event listener must be a function.',
        );
      }
      this.listeners.add(options.onEvent);
    }
  }

  /** Stable terminal surface id for the whole run, or null before start. */
  get terminalId(): string | null {
    return this.terminalIdValue;
  }

  /** True after `start()` planned sessions and began step one. */
  get started(): boolean {
    return this.startedValue;
  }

  get disposed(): boolean {
    return this.disposedValue;
  }

  /** Current run snapshot. Callers cannot mutate the runner's state. */
  getRun(): Run {
    return structuredClone(this.runValue);
  }

  /** Subscribe to state and output events. Returns an unsubscribe function. */
  onEvent(listener: (event: AutomaticRunEvent) => void): () => void {
    if (typeof listener !== 'function') {
      throw new AutomaticRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.ACTION_INVALID,
        'An event listener must be a function.',
      );
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Current mode/step flags without exposing the internal mutable record. */
  get state(): AutomaticRunnerState {
    const step = this.currentStepOrNull();
    return {
      run: this.getRun(),
      terminalId: this.terminalIdValue,
      surface: this.surfaceValue,
      started: this.startedValue,
      disposed: this.disposedValue,
      currentStepIndex: this.runValue.currentStepIndex,
      currentStepStatus: step?.status ?? null,
      isProcessRunning: this.current?.process.isRunning() === true,
      pauseRequested: this.pauseRequestedValue,
      canPause: this.canPause,
      canRunNext: this.canRunNext,
      canNext: this.canRunNext,
      canRetry: this.canRetry,
      canSkip: this.canSkip,
      canAbort: this.canAbort,
      permissions: this.automaticPermissionFlags(),
    };
  }

  /** Pause is offered while the run is live and not already paused. */
  get canPause(): boolean {
    return (
      this.startedValue &&
      !this.disposedValue &&
      !isFinalStatus(this.runValue.status) &&
      this.runValue.status !== 'paused'
    );
  }

  /** Run next is offered only after a pause with no unresolved step. */
  get canRunNext(): boolean {
    const step = this.currentStepOrNull();
    return (
      this.startedValue &&
      !this.disposedValue &&
      !isFinalStatus(this.runValue.status) &&
      this.runValue.status === 'paused' &&
      this.current?.process.isRunning() !== true &&
      step?.status !== 'running' &&
      this.findNextPendingIndex() !== null
    );
  }

  /** Alias for `canRunNext` used by the generic action surface. */
  get canNext(): boolean {
    return this.canRunNext;
  }

  /** Retry is offered for a failed/interrupted step with no live process. */
  get canRetry(): boolean {
    const step = this.currentStepOrNull();
    if (
      step === null ||
      !this.startedValue ||
      this.disposedValue ||
      isFinalStatus(this.runValue.status) ||
      this.current?.process.isRunning() === true
    ) {
      return false;
    }
    return (
      step.status === 'failed' ||
      step.status === 'interrupted' ||
      (this.runValue.status === 'paused' && step.status === 'running')
    );
  }

  get canSkip(): boolean {
    const step = this.currentStepOrNull();
    return (
      step !== null &&
      this.startedValue &&
      !this.disposedValue &&
      !isFinalStatus(this.runValue.status) &&
      this.current?.process.isRunning() !== true &&
      (step.status === 'running' ||
        step.status === 'failed' ||
        step.status === 'interrupted')
    );
  }

  get canAbort(): boolean {
    return (
      this.startedValue &&
      !this.disposedValue &&
      !isFinalStatus(this.runValue.status)
    );
  }

  /**
   * Plan sessions and start the first step. Planning and prompt failures are
   * resolved before any process is spawned.
   */
  async start(): Promise<Run> {
    this.assertNotDisposed();
    if (this.startedValue) {
      throw new AutomaticRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.ALREADY_STARTED,
        'This automatic runner has already started.',
      );
    }
    if (this.runValue.status !== 'starting') {
      throw new AutomaticRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.START_STATE_INVALID,
        'An automatic runner starts from a run in the "starting" state.',
        { status: this.runValue.status },
      );
    }

    const reusableSessionId = this.validRunSessionId();
    if (this.runValue.sessionId !== null && reusableSessionId === undefined) {
      this.runValue.sessionId = null;
    }

    try {
      this.sessionPlanValue = planRunSessions({
        chain: this.runValue.chainSnapshot,
        capabilities: this.adapter,
        mode: 'automatic',
        runSessionId: reusableSessionId,
        createSessionId: this.createSessionId,
      });
      this.applySessionPlan(this.sessionPlanValue);
    } catch (error) {
      this.runValue.status = 'paused';
      this.runValue.reason = AUTOMATIC_STEP_REASONS.PROMPT_FAILED;
      this.runValue.updatedAt = this.timestamp();
      await this.emitAndPersist('run-failed', null, {
        reason: this.runValue.reason,
      });
      throw toRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.PROMPT_FAILED,
        'The automatic session plan could not be built.',
        { runId: this.runValue.id },
        error,
      );
    }

    this.startedValue = true;
    this.runValue.status = 'running';
    this.runValue.startedAt ??= this.timestamp();
    this.runValue.updatedAt = this.timestamp();
    this.terminalIdValue = this.requestedTerminalId;
    this.emit('started', null);

    await this.startCurrentStep('start');
    return this.getRun();
  }

  /**
   * Stop advancement after the current completion signal. The in-flight
   * process is left alone so its declared signal can still be recorded; no
   * next step is started until `runNext()` is invoked.
   */
  async pause(reason?: string): Promise<Run> {
    this.assertStarted();
    if (isFinalStatus(this.runValue.status)) {
      throw new AutomaticRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.FINAL_RUN,
        'The run has already finished.',
        { runId: this.runValue.id, status: this.runValue.status },
      );
    }
    if (this.runValue.status === 'paused') {
      return this.getRun();
    }

    this.pauseRequestedValue = true;
    this.runValue.status = 'paused';
    this.runValue.reason = truncateReason(
      normalizeReason(reason) ?? AUTOMATIC_STEP_REASONS.PAUSED_BY_USER,
    );
    this.runValue.updatedAt = this.timestamp();

    await this.emitAndPersist('run-paused', this.currentStepOrNull(), {
      reason: this.runValue.reason,
    });
    return this.getRun();
  }

  /**
   * Start the next pending step after a pause. This is the automatic-mode
   * "Run next" control and never changes the run mode.
   */
  async runNext(): Promise<Run> {
    this.assertStarted();
    this.assertNotFinal();
    await this.whenSettled();
    if (this.current?.process.isRunning() === true) {
      throw new AutomaticRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.PROCESS_STILL_RUNNING,
        'Run next is available only after the current process has finished.',
        this.stepDetails(this.requireCurrentStep()),
      );
    }
    if (this.runValue.status !== 'paused') {
      throw new AutomaticRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.RUN_NEXT_NOT_READY,
        'Run next is available only from a paused automatic run.',
        {
          runId: this.runValue.id,
          status: this.runValue.status,
          stepIndex: this.runValue.currentStepIndex,
        },
      );
    }
    if (this.currentStepOrNull()?.status === 'running') {
      throw new AutomaticRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.RUN_NEXT_NOT_READY,
        'Run next is available only after the current step has a final outcome.',
        this.stepDetails(this.requireCurrentStep()),
      );
    }

    const target = this.findNextPendingIndex();
    if (target === null) {
      throw new AutomaticRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.RUN_NEXT_NOT_READY,
        'There is no pending step to run next.',
        {
          runId: this.runValue.id,
          stepIndex: this.runValue.currentStepIndex,
          stepStatus: this.currentStepOrNull()?.status ?? null,
        },
      );
    }

    this.pauseRequestedValue = false;
    this.runValue.currentStepIndex = target;
    this.runValue.status = 'running';
    this.runValue.reason = null;
    this.runValue.updatedAt = this.timestamp();
    this.emit('step-advanced', this.runValue.steps[target] ?? null);
    await this.startCurrentStep('run-next');
    return this.getRun();
  }

  /** Alias for `runNext` used by the generic action surface. */
  async next(): Promise<Run> {
    return this.runNext();
  }

  /**
   * Resume automatic advancement. If the in-flight step is still live, its
   * pause flag is cleared so the current signal can advance normally. If the
   * step already finished, this behaves like Run next.
   */
  async resume(): Promise<Run> {
    this.assertStarted();
    this.assertNotFinal();
    await this.whenSettled();
    if (this.runValue.status !== 'paused') {
      return this.getRun();
    }
    if (this.current?.process.isRunning() === true) {
      this.pauseRequestedValue = false;
      this.runValue.status = 'running';
      this.runValue.reason = null;
      this.runValue.updatedAt = this.timestamp();
      await this.emitAndPersist('run-resumed', this.currentStepOrNull());
      return this.getRun();
    }
    return this.runNext();
  }

  /**
   * Restart the current step with the cached snapshot prompt and the same
   * planned session id. Retry never reads the saved chain and never replays
   * another step.
   */
  async retry(): Promise<Run> {
    this.assertCanAct();
    await this.whenSettled();
    if (!this.canRetry) {
      throw new AutomaticRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.RETRY_NOT_AVAILABLE,
        'Retry is available only for a failed or interrupted automatic step.',
        this.stepDetails(this.requireCurrentStep()),
      );
    }

    this.detachCurrent({ kill: true });
    this.pauseRequestedValue = false;
    this.runValue.reason = null;
    this.runValue.updatedAt = this.timestamp();
    await this.startCurrentStep('retry');
    return this.getRun();
  }

  /**
   * Record the current step as skipped and keep the run paused. The next step
   * starts only when the user explicitly chooses Run next.
   */
  async skip(reason: string): Promise<Run> {
    this.assertCanAct();
    await this.whenSettled();
    if (!this.canSkip) {
      throw new AutomaticRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.STEP_NOT_ACTIVE,
        'No automatic step is eligible to skip.',
        this.stepDetails(this.requireCurrentStep()),
      );
    }
    const bounded = requireSkipReason(reason);

    this.finishObservation();
    this.detachCurrent({ kill: true });

    const step = this.requireCurrentStep();
    const timestamp = this.timestamp();
    step.status = 'skipped';
    step.finishedAt = timestamp;
    step.reason = bounded;
    this.runValue.status = 'paused';
    this.runValue.reason = null;
    this.runValue.updatedAt = timestamp;

    await this.emitAndPersist('step-skipped', step, { reason: bounded });
    return this.getRun();
  }

  /** Terminate the current process and end the run without replaying steps. */
  async abort(reason?: string): Promise<Run> {
    this.assertStarted();
    await this.whenSettled();
    if (isFinalStatus(this.runValue.status)) {
      throw new AutomaticRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.FINAL_RUN,
        'The run has already finished.',
        { runId: this.runValue.id, status: this.runValue.status },
      );
    }

    const step = this.currentStepOrNull();
    this.finishObservation();
    this.terminateProcess();
    this.detachCurrent({ kill: true });

    const timestamp = this.timestamp();
    const bounded = truncateReason(
      normalizeReason(reason) ?? AUTOMATIC_STEP_REASONS.ABORTED_BY_USER,
    );
    if (step !== null && (step.status === 'running' || step.status === 'pending')) {
      step.status = 'interrupted';
      step.finishedAt = timestamp;
      step.reason = bounded;
    }
    this.runValue.status = 'aborted';
    this.runValue.finishedAt = timestamp;
    this.runValue.reason = bounded;
    this.runValue.updatedAt = timestamp;
    this.pauseRequestedValue = false;

    await this.emitAndPersist('run-aborted', step, { reason: bounded });
    return this.getRun();
  }

  /** Dispatch one action from the API surface with mode-appropriate validation. */
  async applyAction(request: AutomaticActionRequest): Promise<Run> {
    if (typeof request !== 'object' || request === null) {
      throw new AutomaticRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.ACTION_INVALID,
        'An automatic run action is required.',
      );
    }

    switch (request.action) {
      case 'pause':
        return this.pause(request.reason);
      case 'resume':
        return this.resume();
      case 'run-next':
      case 'next':
        return this.runNext();
      case 'retry':
        return this.retry();
      case 'skip':
        return this.skip(requireSkipReason(request.reason));
      case 'abort':
        return this.abort(request.reason);
      default:
        throw new AutomaticRunnerError(
          AUTOMATIC_RUNNER_ERROR_CODES.ACTION_INVALID,
          'The automatic run action is not recognized.',
          {
            action: typeof request.action === 'string' ? request.action : typeof request.action,
            supported: [...AUTOMATIC_ACTIONS],
          },
        );
    }
  }

  /**
   * Kill any remaining child, clear the step timeout, and stop emitting
   * events. Safe to call repeatedly and automatically used after abort.
   */
  dispose(): void {
    if (this.disposedValue) {
      return;
    }
    this.disposedValue = true;
    this.detachCurrent({ kill: true });
    this.emit('disposed', this.currentStepOrNull());
  }

  /**
   * Wait until every queued state transition has settled. Unit tests use this
   * instead of sleeps; a new transition queued by a transition is awaited too.
   */
  async whenSettled(): Promise<void> {
    let observed: Promise<void>;
    do {
      observed = this.transitions;
      await observed;
    } while (observed !== this.transitions);
  }

  private async startCurrentStep(mode: 'start' | 'retry' | 'run-next'): Promise<void> {
    const index = this.runValue.currentStepIndex;
    const step = this.runValue.steps[index];
    if (step === undefined) {
      throw new AutomaticRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.STEP_NOT_ACTIVE,
        'The run has no current step.',
        { runId: this.runValue.id, stepIndex: index },
      );
    }

    const planned = this.plannedStep(index);

    let prepared: PreparedStep;
    try {
      prepared = this.preparedStep(index, planned);
    } catch (error) {
      await this.failBeforeSpawn(step, AUTOMATIC_STEP_REASONS.PROMPT_FAILED);
      throw toRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.PROMPT_FAILED,
        'The step prompt could not be assembled.',
        this.stepDetails(step),
        error,
      );
    }

    let command: HarnessCommand;
    try {
      command = this.adapter.buildHeadlessCommand({
        prompt: prepared.prompt,
        sessionId: planned.sessionId,
        projectPath: this.projectPathValue,
        sessionMode: this.runValue.chainSnapshot.sessionMode,
        ...(planned.forkFromSessionId === null
          ? {}
          : { forkFromSessionId: planned.forkFromSessionId }),
        automaticPermissionOptIn: this.runValue.chainSnapshot.automaticPermissionOptIn,
      });
    } catch (error) {
      const reason =
        error instanceof Error && 'code' in error && error.code === 'HARNESS_PERMISSION_OPT_IN_REQUIRED'
          ? AUTOMATIC_STEP_REASONS.PERMISSION_OPT_IN_REQUIRED
          : AUTOMATIC_STEP_REASONS.COMMAND_FAILED;
      await this.failBeforeSpawn(step, reason);
      throw toRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.COMMAND_FAILED,
        'The automatic harness command could not be built.',
        this.stepDetails(step),
        error,
      );
    }

    let surface: AutomaticSpawnSurface;
    try {
      surface = automaticSurfaceFor(this.adapter.automaticAdvancement);
    } catch (error) {
      await this.failBeforeSpawn(step, AUTOMATIC_STEP_REASONS.UNSUPPORTED_ADVANCEMENT);
      throw toRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.ADVANCEMENT_UNSUPPORTED,
        'The adapter declares no supported automatic advancement signal.',
        this.stepDetails(step),
        error,
      );
    }

    this.detachCurrent({ kill: true });
    const timestamp = this.timestamp();
    this.resetStepForRun(step, planned, timestamp, surface);
    this.runValue.status = 'running';
    this.runValue.reason = null;
    this.runValue.updatedAt = timestamp;
    this.surfaceValue = surface;
    this.terminalIdValue = this.requestedTerminalId;
    // Persist the running step before spawning so a crash can never leave a
    // live process attached to a record that still claims the step is pending.
    await this.emitAndPersist('step-started', step, { reason: mode });

    let process: AutomaticProcess;
    try {
      process = this.spawn({
        surface,
        terminalId: this.requestedTerminalId,
        executable: command.executable,
        args: [...command.args],
        cwd: command.cwd,
        cols: this.cols,
        rows: this.rows,
      });
    } catch (error) {
      await this.failBeforeSpawn(step, AUTOMATIC_STEP_REASONS.SPAWN_FAILED);
      throw toRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.SPAWN_FAILED,
        'The automatic harness process could not be started.',
        this.stepDetails(step),
        error,
      );
    }

    this.attachProcess(process, index);
    this.startStepTimeout(index);

    const exit = process.getExit();
    if (exit !== null) {
      // A factory may hand back an already-exited child. Route it through the
      // same exit semantics so state is never skipped.
      this.handleExit(index, this.current?.token ?? null, exit);
    }
  }

  private preparedStep(index: number, planned: PlannedStepSession): PreparedStep {
    const cached = this.preparedSteps.get(index);
    if (cached !== undefined) {
      return cached;
    }

    const previous = index > 0 ? this.runValue.steps[index - 1] : undefined;
    const prompt = buildStepPrompt({
      chain: this.runValue.chainSnapshot,
      stepIndex: index,
      inputs: this.runValue.resolvedInputs,
      sessionPlan: this.sessionPlanValue ?? undefined,
      ...(previous === undefined
        ? {}
        : {
            previousStep: {
              stepIndex: index - 1,
              status: previous.status,
              tail: previous.tail,
            },
          }),
    });

    const prepared: PreparedStep = { prompt, planned };
    this.preparedSteps.set(index, prepared);
    return prepared;
  }

  private plannedStep(index: number): PlannedStepSession {
    const plan = this.sessionPlanValue;
    if (plan === null) {
      throw new AutomaticRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.NOT_STARTED,
        'The automatic session plan is not available.',
        { runId: this.runValue.id },
      );
    }
    const planned = plan.steps[index];
    if (planned === undefined) {
      throw new AutomaticRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.STEP_NOT_ACTIVE,
        'The session plan has no entry for this step.',
        { runId: this.runValue.id, stepIndex: index, stepCount: plan.steps.length },
      );
    }
    return planned;
  }

  /**
   * Reuse a stored run-level session id only when the adapter accepts it.
   * Older records may carry a bare UUID that OpenCode rejects; retrying those
   * must start a fresh valid session instead of repeating the failure.
   */
  private validRunSessionId(): string | undefined {
    const stored = this.runValue.sessionId;
    return stored !== null && this.adapter.isSessionId(stored) ? stored : undefined;
  }

  private applySessionPlan(plan: RunSessionPlan): void {
    this.runValue.sessionMode = plan.sessionMode;
    this.runValue.forkMechanism = plan.mechanism as ForkMechanism;
    const first = plan.steps[0];
    // Fresh mode assigns an id per step, so the run-level field stays null.
    if (this.runValue.sessionId === null && first !== undefined && plan.sessionMode !== 'fresh') {
      this.runValue.sessionId = first.sessionId;
    }
  }

  private resetStepForRun(
    step: RunStepRecord,
    planned: PlannedStepSession,
    timestamp: string,
    surface: AutomaticSpawnSurface,
  ): void {
    step.status = 'running';
    step.startedAt = timestamp;
    step.finishedAt = null;
    step.exitCode = null;
    step.sessionId = planned.sessionId;
    step.forkMechanism = planned.forkMechanism as ForkMechanism;
    step.skillObservation =
      this.adapter.skillObservation === 'unobservable' ? 'not-observable' : 'unknown';
    step.tail = '';
    step.reason = null;

    this.tracker = new SkillObservationTracker({
      capability: this.adapter.skillObservation,
      expectedSkillName: step.skillName,
    });
    this.osc = surface === 'pty' ? new Osc7501StateMachine() : null;
  }

  private attachProcess(process: AutomaticProcess, stepIndex: number): void {
    const token = Symbol(`automatic-step-${String(stepIndex)}`);
    const unsubscribeData = process.onData((chunk: string) => {
      this.handleData(stepIndex, token, chunk);
    });
    const unsubscribeExit = process.onExit((event: TerminalExit) => {
      this.handleExit(stepIndex, token, event);
    });
    this.current = {
      token,
      stepIndex,
      process,
      unsubscribeData,
      unsubscribeExit,
    };
  }

  private handleData(stepIndex: number, token: symbol, chunk: string): void {
    if (this.disposedValue || this.current?.token !== token) {
      return;
    }
    const step = this.runValue.steps[stepIndex];
    if (step === undefined || typeof chunk !== 'string' || chunk === '') {
      return;
    }

    step.tail = trimTail(`${step.tail}${chunk}`, {
      maxLines: this.maxTailLines,
      maxBytes: this.maxTailBytes,
    });
    if (this.tracker !== null) {
      step.skillObservation = this.tracker.push(chunk).state;
    }
    this.runValue.updatedAt = this.timestamp();
    this.emit('output', step, { chunk });

    // Only an adapter that declares the OSC signal may consume terminal state.
    // A quiet terminal, unrelated ANSI, or idle-without-working is ignored.
    if (this.osc !== null) {
      const changes = this.osc.push(chunk);
      for (const change of changes) {
        if (change.advanced) {
          this.emit('signal', step, {
            reason: AUTOMATIC_STEP_REASONS.COMPLETION_SIGNAL,
          });
          this.enqueue(() => this.completeFromOscSignal(stepIndex, token));
        }
      }
    }
  }

  private handleExit(stepIndex: number, token: symbol | null, event: TerminalExit): void {
    if (this.disposedValue) {
      return;
    }
    if (token !== null && this.current?.token !== token) {
      return;
    }
    const step = this.runValue.steps[stepIndex];
    if (step === undefined) {
      return;
    }

    step.exitCode = event.exitCode;
    if (this.tracker !== null) {
      step.skillObservation = this.tracker.finish().state;
    }
    this.clearStepTimeout();
    this.runValue.updatedAt = this.timestamp();
    this.emit('process-exit', step, { exitCode: event.exitCode });

    const surface = this.surfaceValue;
    if (surface === 'pty') {
      // For an OSC-backed adapter, process exit is never a completion signal.
      // A zero exit before working->idle is an ambiguous/missing signal.
      this.enqueue(() =>
        event.exitCode === 0
          ? this.failFromProcessExit(
              stepIndex,
              token,
              AUTOMATIC_STEP_REASONS.MISSING_COMPLETION_SIGNAL,
              event.exitCode,
            )
          : this.failFromProcessExit(
              stepIndex,
              token,
              AUTOMATIC_STEP_REASONS.PROCESS_EXITED_NONZERO,
              event.exitCode,
            ),
      );
      return;
    }

    // process-exit surface: exactly one exit decides the step.
    this.enqueue(() =>
      event.exitCode === 0
        ? this.completeFromProcessExit(stepIndex, token, event.exitCode)
        : this.failFromProcessExit(
            stepIndex,
            token,
            AUTOMATIC_STEP_REASONS.PROCESS_EXITED_NONZERO,
            event.exitCode,
          ),
    );
  }

  private async completeFromOscSignal(stepIndex: number, token: symbol | null): Promise<void> {
    if (!this.isCurrentRunningStep(stepIndex, token)) {
      return;
    }
    const step = this.runValue.steps[stepIndex];
    if (step === undefined) {
      return;
    }

    // A process that already exited non-zero is a failure even if the final
    // chunk happened to carry a completion edge.
    if (step.exitCode !== null && step.exitCode !== 0) {
      await this.failFromProcessExit(
        stepIndex,
        token,
        AUTOMATIC_STEP_REASONS.PROCESS_EXITED_NONZERO,
        step.exitCode,
      );
      return;
    }

    this.clearStepTimeout();
    this.finishObservation();
    const timestamp = this.timestamp();
    step.status = 'done';
    step.finishedAt = timestamp;
    step.reason = AUTOMATIC_STEP_REASONS.COMPLETION_SIGNAL;
    this.runValue.updatedAt = timestamp;

    // The signal is complete; stop the PTY child gracefully before moving on.
    this.detachCurrent({ kill: true });
    await this.afterStepCompleted(step, timestamp);
  }

  private async completeFromProcessExit(
    stepIndex: number,
    token: symbol | null,
    exitCode: number,
  ): Promise<void> {
    if (!this.isCurrentRunningStep(stepIndex, token)) {
      return;
    }
    const step = this.runValue.steps[stepIndex];
    if (step === undefined) {
      return;
    }

    this.clearStepTimeout();
    this.finishObservation();
    const timestamp = this.timestamp();
    step.exitCode = exitCode;
    step.status = 'done';
    step.finishedAt = timestamp;
    step.reason = AUTOMATIC_STEP_REASONS.PROCESS_EXITED;
    this.runValue.updatedAt = timestamp;

    this.detachCurrent({ kill: false });
    await this.afterStepCompleted(step, timestamp);
  }

  private async failFromProcessExit(
    stepIndex: number,
    token: symbol | null,
    reason: string,
    exitCode: number | null,
  ): Promise<void> {
    if (!this.isCurrentRunningStep(stepIndex, token)) {
      return;
    }
    const step = this.runValue.steps[stepIndex];
    if (step === undefined) {
      return;
    }

    this.clearStepTimeout();
    this.finishObservation();
    const timestamp = this.timestamp();
    if (exitCode !== null) {
      step.exitCode = exitCode;
    }
    step.status = 'failed';
    step.finishedAt = timestamp;
    step.reason = truncateReason(reason);
    this.runValue.status = 'paused';
    this.runValue.reason = step.reason;
    this.runValue.updatedAt = timestamp;

    this.detachCurrent({ kill: true });
    await this.emitAndPersist('step-failed', step, { reason });
    this.emit('run-paused', step, { reason: step.reason });
  }

  private async handleTimeout(stepIndex: number, token: symbol): Promise<void> {
    if (!this.isCurrentRunningStep(stepIndex, token)) {
      return;
    }
    const step = this.runValue.steps[stepIndex];
    if (step === undefined) {
      return;
    }

    this.timeoutHandle = null;
    this.finishObservation();
    const timestamp = this.timestamp();
    step.status = 'failed';
    step.finishedAt = timestamp;
    step.reason = AUTOMATIC_STEP_REASONS.COMPLETION_TIMEOUT;
    this.runValue.status = 'paused';
    this.runValue.reason = step.reason;
    this.runValue.updatedAt = timestamp;

    this.detachCurrent({ kill: true });
    this.emit('timeout', step, { reason: step.reason });
    await this.emitAndPersist('step-failed', step, { reason: step.reason });
    this.emit('run-paused', step, { reason: step.reason });
  }

  private async afterStepCompleted(step: RunStepRecord, timestamp: string): Promise<void> {
    await this.emitAndPersist('step-done', step);

    const nextIndex = step.index + 1;
    if (nextIndex >= this.runValue.steps.length) {
      // Completion is the end of the chain, not a further advancement; a
      // pause requested during the final step still records a completed run.
      this.runValue.status = 'completed';
      this.runValue.finishedAt = timestamp;
      this.runValue.reason = null;
      this.runValue.updatedAt = timestamp;
      await this.emitAndPersist('run-completed', step);
      return;
    }

    if (this.pauseRequestedValue) {
      this.runValue.status = 'paused';
      this.runValue.reason = truncateReason(AUTOMATIC_STEP_REASONS.PAUSED_BY_USER);
      this.runValue.updatedAt = this.timestamp();
      await this.emitAndPersist('run-paused', step, {
        reason: this.runValue.reason,
      });
      return;
    }

    this.runValue.currentStepIndex = nextIndex;
    this.runValue.status = 'running';
    this.runValue.reason = null;
    this.runValue.updatedAt = this.timestamp();
    this.emit('step-advanced', step);
    try {
      await this.startCurrentStep('run-next');
    } catch {
      // startCurrentStep recorded a failed/paused state before throwing. The
      // chain must not auto-continue through that failure.
    }
  }

  private isCurrentRunningStep(stepIndex: number, token: symbol | null): boolean {
    if (this.disposedValue) {
      return false;
    }
    if (this.current === null) {
      return false;
    }
    if (token !== null && this.current.token !== token) {
      return false;
    }
    if (this.current.stepIndex !== stepIndex) {
      return false;
    }
    return this.runValue.steps[stepIndex]?.status === 'running';
  }

  private startStepTimeout(stepIndex: number): void {
    this.clearStepTimeout();
    const token = this.current?.token;
    if (token === undefined) {
      return;
    }
    this.timeoutHandle = this.timers.setTimeout(() => {
      this.enqueue(() => this.handleTimeout(stepIndex, token));
    }, this.stepTimeoutMs);
  }

  private clearStepTimeout(): void {
    if (this.timeoutHandle === null) {
      return;
    }
    this.timers.clearTimeout(this.timeoutHandle);
    this.timeoutHandle = null;
  }

  private finishObservation(): void {
    if (this.tracker === null) {
      return;
    }
    const step = this.currentStepOrNull();
    if (step !== null) {
      step.skillObservation = this.tracker.finish().state;
    }
  }

  private terminateProcess(): void {
    const current = this.current;
    if (current === null) {
      return;
    }
    const exit = current.process.getExit();
    const step = this.runValue.steps[current.stepIndex];
    if (exit !== null && step !== undefined) {
      step.exitCode = exit.exitCode;
    } else if (current.process.isRunning()) {
      try {
        current.process.kill('SIGTERM');
      } catch {
        // A process that exits between the check and the kill is already gone.
      }
    }
  }

  private detachCurrent(options: { kill: boolean }): void {
    this.clearStepTimeout();
    const current = this.current;
    this.current = null;
    if (current === null) {
      return;
    }
    current.unsubscribeData();
    current.unsubscribeExit();
    if (options.kill) {
      try {
        if (current.process.isRunning()) {
          current.process.kill('SIGTERM');
        }
      } catch {
        // Cleanup is best-effort and must never mask the state transition.
      }
    }
  }

  private async failBeforeSpawn(step: RunStepRecord, reason: string): Promise<void> {
    this.finishObservation();
    this.detachCurrent({ kill: true });
    const timestamp = this.timestamp();
    step.status = 'failed';
    step.finishedAt = timestamp;
    step.reason = truncateReason(reason);
    this.runValue.status = 'paused';
    this.runValue.reason = step.reason;
    this.runValue.updatedAt = timestamp;
    await this.emitAndPersist('step-failed', step, { reason });
  }

  private findNextPendingIndex(): number | null {
    for (let index = this.runValue.currentStepIndex + 1; index < this.runValue.steps.length; index += 1) {
      if (this.runValue.steps[index]?.status === 'pending') {
        return index;
      }
    }
    return null;
  }

  private automaticPermissionFlags(): readonly string[] {
    if (!this.adapter.requiresAutomaticPermissionOptIn) {
      return [];
    }
    if (this.runValue.chainSnapshot.automaticPermissionOptIn !== true) {
      return [];
    }
    return [...this.adapter.automaticPermissions];
  }

  private async emitAndPersist(
    type: AutomaticEventType,
    step: RunStepRecord | null,
    extras: {
      readonly exitCode?: number | null;
      readonly observation?: SkillObservationState;
      readonly reason?: string | null;
    } = {},
  ): Promise<void> {
    if (this.persistHook !== undefined) {
      try {
        await this.persistHook(this.getRun());
      } catch (error) {
        throw toRunnerError(
          AUTOMATIC_RUNNER_ERROR_CODES.PERSIST_FAILED,
          'The automatic run state could not be persisted.',
          {
            runId: this.runValue.id,
            stepId: step?.id ?? null,
          },
          error,
        );
      }
    }
    this.emit(type, step, extras);
  }

  private emit(
    type: AutomaticEventType,
    step: RunStepRecord | null,
    extras: {
      readonly exitCode?: number | null;
      readonly observation?: SkillObservationState;
      readonly reason?: string | null;
      readonly chunk?: string;
    } = {},
  ): void {
    if (this.listeners.size === 0) {
      return;
    }
    const event: AutomaticRunEvent = {
      type,
      run: this.getRun(),
      stepIndex: step?.index ?? this.runValue.currentStepIndex,
      stepId: step?.id ?? null,
      terminalId: this.terminalIdValue,
      surface: this.surfaceValue,
      ...(extras.exitCode === undefined ? {} : { exitCode: extras.exitCode }),
      ...(extras.observation === undefined ? {} : { observation: extras.observation }),
      ...(extras.reason === undefined ? {} : { reason: extras.reason }),
      ...(extras.chunk === undefined ? {} : { chunk: extras.chunk }),
      permissions: this.automaticPermissionFlags(),
    };
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A UI stream listener must never break the run state machine.
      }
    }
  }

  /**
   * Serialize signal-driven transitions. Data and exit callbacks are
   * synchronous, while persistence and spawning are async; the queue keeps the
   * order identical to the real signal order and gives tests one `whenSettled`.
   */
  private enqueue(task: () => Promise<void>): void {
    this.transitions = this.transitions.then(task).catch(() => undefined);
  }

  private assertStarted(): void {
    this.assertNotDisposed();
    if (!this.startedValue) {
      throw new AutomaticRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.NOT_STARTED,
        'The automatic runner has not started.',
        { runId: this.runValue.id },
      );
    }
  }

  private assertCanAct(): void {
    this.assertStarted();
    this.assertNotFinal();
  }

  private assertNotFinal(): void {
    if (isFinalStatus(this.runValue.status)) {
      throw new AutomaticRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.FINAL_RUN,
        'The run has already finished.',
        { runId: this.runValue.id, status: this.runValue.status },
      );
    }
  }

  private assertNotDisposed(): void {
    if (this.disposedValue) {
      throw new AutomaticRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.DISPOSED,
        'The automatic runner has been disposed.',
        { runId: this.runValue.id },
      );
    }
  }

  private requireCurrentStep(): RunStepRecord {
    const step = this.currentStepOrNull();
    if (step === null) {
      throw new AutomaticRunnerError(
        AUTOMATIC_RUNNER_ERROR_CODES.STEP_NOT_ACTIVE,
        'The run has no current step.',
        { runId: this.runValue.id, stepIndex: this.runValue.currentStepIndex },
      );
    }
    return step;
  }

  private currentStepOrNull(): RunStepRecord | null {
    return this.runValue.steps[this.runValue.currentStepIndex] ?? null;
  }

  private stepDetails(step: RunStepRecord): Record<string, unknown> {
    return {
      runId: this.runValue.id,
      stepId: step.id,
      stepIndex: step.index,
      stepStatus: step.status,
      runStatus: this.runValue.status,
    };
  }

  private timestamp(): string {
    return toTimestamp(this.clock());
  }
}

/** Create an automatic runner. Convenience wrapper for the orchestrator. */
export function createAutomaticRunner(options: AutomaticRunnerOptions): AutomaticRunner {
  return new AutomaticRunner(options);
}

/**
 * Map the adapter's declared advancement signal to a process surface.
 *
 * A signal that is not one of the two documented automatic signals is a typed
 * failure instead of a guess.
 */
export function automaticSurfaceFor(
  advancement: HarnessAdvancementSignal | string,
): AutomaticSpawnSurface {
  if (advancement === 'osc-working-idle') {
    return 'pty';
  }
  if (advancement === 'process-exit') {
    return 'process';
  }
  throw new AutomaticRunnerError(
    AUTOMATIC_RUNNER_ERROR_CODES.ADVANCEMENT_UNSUPPORTED,
    'The adapter declares no supported automatic advancement signal.',
    { advancement: typeof advancement === 'string' ? advancement : typeof advancement },
  );
}

/** True when an automatic run status is terminal and accepts no more actions. */
export function isFinalAutomaticStatus(status: string): boolean {
  return isFinalRunStatus(status);
}

/** Normalize an optional reason without inventing text. */
function normalizeReason(reason: unknown): string | null {
  if (typeof reason !== 'string') {
    return null;
  }
  const trimmed = reason.trim();
  return trimmed === '' ? null : trimmed;
}

/** Skip requires a nonempty reason, bounded by the run record limit. */
function requireSkipReason(reason: unknown): string {
  const normalized = normalizeReason(reason);
  if (normalized === null) {
    throw new AutomaticRunnerError(
      AUTOMATIC_RUNNER_ERROR_CODES.SKIP_REASON_REQUIRED,
      'Skipping an automatic step requires a nonempty reason.',
      { field: 'reason' },
    );
  }
  return truncateReason(normalized);
}

function isFinalStatus(status: string): boolean {
  return isFinalRunStatus(status);
}

function validateProjectPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.includes('\0') ||
    !isAbsolute(value)
  ) {
    throw new AutomaticRunnerError(
      AUTOMATIC_RUNNER_ERROR_CODES.PROJECT_PATH_INVALID,
      'The project directory must be an absolute path without NUL characters.',
      { field: 'projectPath', value: typeof value === 'string' ? value : typeof value },
    );
  }
  return value;
}

function assertTerminalId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new AutomaticRunnerError(
      AUTOMATIC_RUNNER_ERROR_CODES.TERMINAL_ID_INVALID,
      'The terminal id must be a stable identifier.',
      { field: 'terminalId', value: typeof value === 'string' ? value : typeof value },
    );
  }
  return value;
}

function positiveDimension(
  value: number | undefined,
  fallback: number,
  field: string,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || value < 1 || value > 1_000) {
    throw new AutomaticRunnerError(
      AUTOMATIC_RUNNER_ERROR_CODES.RUN_INVALID,
      `${field} must be an integer from 1 to 1000.`,
      { field, value },
    );
  }
  return value;
}

function positiveTailLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
  field: string,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new AutomaticRunnerError(
      AUTOMATIC_RUNNER_ERROR_CODES.RUN_INVALID,
      `${field} must be an integer from 1 to ${String(maximum)}.`,
      { field, value, maximum },
    );
  }
  return value;
}

function positiveTimeout(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_AUTOMATIC_STEP_TIMEOUT_MS;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new AutomaticRunnerError(
      AUTOMATIC_RUNNER_ERROR_CODES.RUN_INVALID,
      'stepTimeoutMs must be a positive integer.',
      { field: 'stepTimeoutMs', value },
    );
  }
  return value;
}

function toRunnerError(
  code: AutomaticRunnerErrorCode,
  message: string,
  details: Record<string, unknown>,
  cause: unknown,
): AutomaticRunnerError {
  if (cause instanceof AutomaticRunnerError) {
    return cause;
  }
  return new AutomaticRunnerError(code, message, details, { cause });
}
