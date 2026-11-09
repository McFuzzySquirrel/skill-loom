/**
 * Supervised run state machine (RUN-FR-06, RUN-FR-08).
 *
 * A supervised run starts one fresh harness CLI process per step on the same
 * PTY surface, seeds it with the planned session id and assembled prompt, and
 * streams the live output. When the process exits, the exit is reported as a
 * signal only: it never marks the step done and never advances the chain. The
 * user explicitly marks Done, Failed, or Skipped, and only Done/Skipped enable
 * Next.
 *
 * The runner deliberately contains no keystroke injection, no output-idle
 * heuristic, no timer-driven advancement, and no automatic-mode code. Harness
 * flags and capabilities are consumed through the adapter contract, so this
 * module never compares a harness name (NFR-COMPAT-01).
 */

import { isAbsolute } from 'node:path';
import type {
  HarnessAdapter,
  HarnessCommand,
  ForkMechanism,
} from '../harness/types.js';
import type { TerminalExit } from '../terminal/pty.js';
import { disposeAndWait } from './process-cleanup.js';
import {
  MAX_TAIL_BYTES,
  MAX_TAIL_LINES,
  toTimestamp,
  trimTail,
  truncateReason,
  type Run,
  type RunStepRecord,
  type SkillObservationState,
  type StepStatus,
} from './model.js';
import { SkillObservationTracker } from './observations.js';
import {
  buildStepPrompt,
  planRunSessions,
  type PlannedStepSession,
  type RunSessionPlan,
} from './prompts.js';

/** Default terminal geometry for a supervised run's PTY surface. */
export const SUPERVISED_TERMINAL_COLS = 120;
export const SUPERVISED_TERMINAL_ROWS = 32;

/** One CLI process is always started with an executable plus args. */
export interface SupervisedSpawnSpec {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly cols: number;
  readonly rows: number;
}

/**
 * The PTY surface for one supervised run.
 *
 * `spawn` replaces any previous child on the same terminal surface. The runner
 * kills and detaches the previous child before every call, so a live TUI is
 * never reused across steps. A browser may attach to the stable `id`; it
 * never supplies an executable or a path here.
 */
export interface SupervisedPty {
  readonly id: string;
  spawn(spec: SupervisedSpawnSpec): SupervisedPtyProcess;
  close(): void;
}

/** A single harness child process attached to the run's PTY surface. */
export interface SupervisedPtyProcess {
  readonly pid: number;
  onData(listener: (chunk: string) => void): () => void;
  onExit(listener: (event: TerminalExit) => void): () => void;
  /**
   * Passthrough for browser keystrokes. The runner never calls this method;
   * supervised advancement is explicit and never scripted into the TUI.
   */
  write(data: string): void;
  kill(signal?: string): void;
  isRunning(): boolean;
  getExit(): TerminalExit | null;
}

/** Context handed to the PTY factory exactly once per supervised run. */
export interface SupervisedPtyContext {
  readonly terminalId: string;
  readonly cols: number;
  readonly rows: number;
}

export type SupervisedPtyFactory = (context: SupervisedPtyContext) => SupervisedPty;

/** Stable supervised failure codes. */
export const SUPERVISED_RUNNER_ERROR_CODES = {
  RUN_INVALID: 'SUPERVISED_RUN_INVALID',
  MODE_INVALID: 'SUPERVISED_MODE_INVALID',
  PROJECT_PATH_INVALID: 'SUPERVISED_PROJECT_PATH_INVALID',
  TERMINAL_ID_INVALID: 'SUPERVISED_TERMINAL_ID_INVALID',
  ALREADY_STARTED: 'SUPERVISED_ALREADY_STARTED',
  NOT_STARTED: 'SUPERVISED_NOT_STARTED',
  DISPOSED: 'SUPERVISED_DISPOSED',
  START_STATE_INVALID: 'SUPERVISED_START_STATE_INVALID',
  STEP_NOT_ACTIVE: 'SUPERVISED_STEP_NOT_ACTIVE',
  STEP_ALREADY_FINAL: 'SUPERVISED_STEP_ALREADY_FINAL',
  NEXT_NOT_READY: 'SUPERVISED_NEXT_NOT_READY',
  RETRY_NOT_AVAILABLE: 'SUPERVISED_RETRY_NOT_AVAILABLE',
  SKIP_REASON_REQUIRED: 'SUPERVISED_SKIP_REASON_REQUIRED',
  FINAL_RUN: 'SUPERVISED_FINAL_RUN',
  ACTION_INVALID: 'SUPERVISED_ACTION_INVALID',
  PROMPT_FAILED: 'SUPERVISED_PROMPT_FAILED',
  COMMAND_FAILED: 'SUPERVISED_COMMAND_FAILED',
  SPAWN_FAILED: 'SUPERVISED_SPAWN_FAILED',
  PROCESS_TERMINATION_FAILED: 'SUPERVISED_PROCESS_TERMINATION_FAILED',
  PTY_FAILED: 'SUPERVISED_PTY_FAILED',
  PERSIST_FAILED: 'SUPERVISED_PERSIST_FAILED',
} as const;
export type SupervisedRunnerErrorCode =
  (typeof SUPERVISED_RUNNER_ERROR_CODES)[keyof typeof SUPERVISED_RUNNER_ERROR_CODES];

/** Typed runner failure. Details never contain prompt text or credentials. */
export class SupervisedRunnerError extends Error {
  readonly code: SupervisedRunnerErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: SupervisedRunnerErrorCode,
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

/** Outcome the user can explicitly assign to the current supervised step. */
export const SUPERVISED_STEP_OUTCOMES = ['done', 'failed', 'skipped'] as const;
export type SupervisedStepOutcome = (typeof SUPERVISED_STEP_OUTCOMES)[number];

/** Action names accepted by the future HTTP action route. */
export const SUPERVISED_ACTIONS = [
  'done',
  'failed',
  'skipped',
  'next',
  'retry',
  'skip',
  'abort',
] as const;
export type SupervisedActionName = (typeof SUPERVISED_ACTIONS)[number];

export interface SupervisedActionRequest {
  readonly action: SupervisedActionName | string;
  /** Required for Skip/Skipped, optional for Failed and Abort. */
  readonly reason?: string;
}

/** Events emitted for the run view and the WebSocket stream (RUN-06). */
export const SUPERVISED_EVENT_TYPES = [
  'started',
  'step-started',
  'process-started',
  'output',
  'process-exit',
  'awaiting-user',
  'step-done',
  'step-failed',
  'step-skipped',
  'step-advanced',
  'run-paused',
  'run-completed',
  'run-aborted',
  'run-failed',
  'disposed',
] as const;
export type SupervisedEventType = (typeof SUPERVISED_EVENT_TYPES)[number];

export interface SupervisedRunEvent {
  readonly type: SupervisedEventType;
  /** Deep-cloned run state at the moment of the event. Never a transcript. */
  readonly run: Run;
  readonly stepIndex: number;
  readonly stepId: string | null;
  readonly terminalId: string | null;
  readonly exitCode?: number | null;
  readonly observation?: SkillObservationState;
  readonly reason?: string | null;
  /** Live output chunk. It is not persisted; only the bounded tail is. */
  readonly chunk?: string;
}

/** Stable reasons written into a step record. They are not transcripts. */
export const SUPERVISED_STEP_REASONS = {
  PROCESS_EXITED: 'PROCESS_EXITED',
  PROCESS_EXITED_NONZERO: 'PROCESS_EXITED_NONZERO',
  STEP_MARKED_FAILED: 'STEP_MARKED_FAILED',
  SPAWN_FAILED: 'SPAWN_FAILED',
  PROMPT_FAILED: 'PROMPT_FAILED',
  COMMAND_FAILED: 'COMMAND_FAILED',
  PERSIST_FAILED: 'PERSIST_FAILED',
  ABORTED_BY_USER: 'ABORTED_BY_USER',
  PTY_CREATE_FAILED: 'PTY_CREATE_FAILED',
} as const;

export interface SupervisedRunnerOptions {
  /** A validated run record in supervised mode, normally from `createRunRecord`. */
  readonly run: Run;
  /** Adapter from the harness registry, never selected by a harness-name branch. */
  readonly adapter: HarnessAdapter;
  /** Canonical absolute project directory resolved from a project id. */
  readonly projectPath: string;
  /**
   * Created exactly once per run. Every step spawns a new child through this
   * same surface, so the terminal id is stable for the whole run.
   */
  readonly createPty: SupervisedPtyFactory;
  /** Clock seam for deterministic timestamps. */
  readonly now?: (() => Date) | undefined;
  /** Session id seam used by fresh and fork plans. */
  readonly createSessionId?: (() => string) | undefined;
  /** Stable terminal id. Defaults to `loom_run_<runId>`. */
  readonly terminalId?: string | undefined;
  readonly cols?: number | undefined;
  readonly rows?: number | undefined;
  readonly maxTailLines?: number | undefined;
  readonly maxTailBytes?: number | undefined;
  /** Optional atomic persistence callback owned by the orchestrator/store. */
  readonly persist?: ((run: Run) => void | Promise<void>) | undefined;
  /** Serialize process-exit updates with project coordination. */
  readonly coordinate?: (<T>(task: () => Promise<T>) => Promise<T>) | undefined;
  /** Event listener for the live terminal and step-state stream. */
  readonly onEvent?: ((event: SupervisedRunEvent) => void) | undefined;
}

/** Read-only view used by the action route and the run view. */
export interface SupervisedRunnerState {
  readonly run: Run;
  readonly terminalId: string | null;
  readonly started: boolean;
  readonly disposed: boolean;
  readonly currentStepIndex: number;
  readonly currentStepStatus: StepStatus | null;
  readonly isProcessRunning: boolean;
  readonly canNext: boolean;
  readonly canRetry: boolean;
  readonly canSkip: boolean;
  readonly canAbort: boolean;
}

interface AttachedProcess {
  readonly token: symbol;
  readonly stepIndex: number;
  readonly process: SupervisedPtyProcess;
  readonly unsubscribeData: () => void;
  readonly unsubscribeExit: () => void;
}

interface PreparedStep {
  readonly prompt: string;
  readonly planned: PlannedStepSession;
}

/**
 * Supervised runner.
 *
 * Lifecycle:
 *   start() -> step 1 running / awaiting-user -> markDone|markFailed|markSkipped
 *   -> next() (only after done/skipped) -> step 2 ... -> completed
 *
 * `retry()` restarts the current step with the cached prompt and planned
 * session id. `skip(reason)` records a reason and enables Next. `abort()`
 * terminates the child and ends the run without replaying anything.
 */
export class SupervisedRunner {
  private readonly runValue: Run;
  private readonly adapter: HarnessAdapter;
  private readonly projectPathValue: string;
  private readonly createPty: SupervisedPtyFactory;
  private readonly clock: () => Date;
  private readonly createSessionId: (() => string) | undefined;
  private readonly requestedTerminalId: string;
  private readonly cols: number;
  private readonly rows: number;
  private readonly maxTailLines: number;
  private readonly maxTailBytes: number;
  private readonly persistHook: ((run: Run) => void | Promise<void>) | undefined;
  private readonly coordinate: <T>(task: () => Promise<T>) => Promise<T>;
  private readonly listeners = new Set<(event: SupervisedRunEvent) => void>();

  private pty: SupervisedPty | null = null;
  private terminalIdValue: string | null = null;
  private sessionPlanValue: RunSessionPlan | null = null;
  private preparedSteps = new Map<number, PreparedStep>();
  private tracker: SkillObservationTracker | null = null;
  private current: AttachedProcess | null = null;
  private startedValue = false;
  private disposedValue = false;

  constructor(options: SupervisedRunnerOptions) {
    if (typeof options !== 'object' || options === null) {
      throw new SupervisedRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.RUN_INVALID,
        'A supervised runner requires a run record.',
      );
    }

    let run: Run;
    try {
      run = structuredClone(options.run);
    } catch (error) {
      throw new SupervisedRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.RUN_INVALID,
        'The run record could not be read.',
        {},
        { cause: error },
      );
    }

    if (run === null || typeof run !== 'object' || run.mode !== 'supervised') {
      throw new SupervisedRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.MODE_INVALID,
        'The supervised runner only accepts a run in supervised mode.',
        { mode: run !== null && typeof run === 'object' ? run.mode : typeof run },
      );
    }
    if (run.status !== 'starting') {
      throw new SupervisedRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.START_STATE_INVALID,
        'A supervised runner starts from a run in the "starting" state.',
        { status: run.status },
      );
    }
    if (options.adapter === undefined || options.adapter === null) {
      throw new SupervisedRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.RUN_INVALID,
        'A harness adapter is required.',
      );
    }
    if (typeof options.createPty !== 'function') {
      throw new SupervisedRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.RUN_INVALID,
        'A PTY factory is required for a supervised run.',
      );
    }

    this.runValue = run;
    this.adapter = options.adapter;
    this.projectPathValue = validateProjectPath(options.projectPath);
    this.createPty = options.createPty;
    this.clock = options.now ?? (() => new Date());
    this.createSessionId = options.createSessionId ?? (() => this.adapter.createSessionId());
    this.requestedTerminalId = options.terminalId ?? `loom_run_${run.id}`;
    assertTerminalId(this.requestedTerminalId);
    this.cols = positiveDimension(options.cols, SUPERVISED_TERMINAL_COLS, 'cols');
    this.rows = positiveDimension(options.rows, SUPERVISED_TERMINAL_ROWS, 'rows');
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
    this.persistHook = options.persist;
    this.coordinate = options.coordinate ?? (async (task) => task());

    if (options.onEvent !== undefined) {
      if (typeof options.onEvent !== 'function') {
        throw new SupervisedRunnerError(
          SUPERVISED_RUNNER_ERROR_CODES.RUN_INVALID,
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

  /** True after `start()` created the PTY and began step one. */
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
  onEvent(listener: (event: SupervisedRunEvent) => void): () => void {
    if (typeof listener !== 'function') {
      throw new SupervisedRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.ACTION_INVALID,
        'An event listener must be a function.',
      );
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Current mode/step flags without exposing the internal mutable record. */
  get state(): SupervisedRunnerState {
    const step = this.currentStepOrNull();
    return {
      run: this.getRun(),
      terminalId: this.terminalIdValue,
      started: this.startedValue,
      disposed: this.disposedValue,
      currentStepIndex: this.runValue.currentStepIndex,
      currentStepStatus: step?.status ?? null,
      isProcessRunning: this.current?.process.isRunning() === true,
      canNext: this.canNext,
      canRetry: this.canRetry,
      canSkip: this.canSkip,
      canAbort: this.canAbort,
    };
  }

  /** Next is enabled only after the user marked Done or Skipped. */
  get canNext(): boolean {
    const step = this.currentStepOrNull();
    return (
      this.startedValue &&
      !this.disposedValue &&
      !isFinalStatus(this.runValue.status) &&
      step !== null &&
      (step.status === 'done' || step.status === 'skipped')
    );
  }

  /** Retry is offered for a failed or interrupted step, or a paused exit. */
  get canRetry(): boolean {
    const step = this.currentStepOrNull();
    if (step === null || !this.startedValue || this.disposedValue || isFinalStatus(this.runValue.status)) {
      return false;
    }
    if (step.status === 'failed' || step.status === 'interrupted') {
      return true;
    }
    return this.runValue.status === 'paused' && step.status === 'running';
  }

  get canSkip(): boolean {
    const step = this.currentStepOrNull();
    return (
      step !== null &&
      this.startedValue &&
      !this.disposedValue &&
      !isFinalStatus(this.runValue.status) &&
      (step.status === 'running' || step.status === 'failed' || step.status === 'interrupted')
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
   * Create the single run PTY, plan sessions, and start the first step.
   * Planning and prompt failures happen before any process is spawned.
   */
  async start(): Promise<Run> {
    this.assertNotDisposed();
    if (this.startedValue) {
      throw new SupervisedRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.ALREADY_STARTED,
        'This supervised runner has already started.',
      );
    }
    if (this.runValue.status !== 'starting') {
      throw new SupervisedRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.START_STATE_INVALID,
        'A supervised runner starts from a run in the "starting" state.',
        { status: this.runValue.status },
      );
    }

    const timestamp = this.timestamp();
    this.runValue.status = 'running';
    this.runValue.startedAt ??= timestamp;
    this.runValue.updatedAt = timestamp;

    try {
      this.pty = this.createPty({
        terminalId: this.requestedTerminalId,
        cols: this.cols,
        rows: this.rows,
      });
      this.terminalIdValue = assertTerminalId(this.pty.id);
    } catch (error) {
      this.runValue.status = 'failed';
      this.runValue.finishedAt = this.timestamp();
      this.runValue.reason = SUPERVISED_STEP_REASONS.PTY_CREATE_FAILED;
      await this.emitAndPersist('run-failed', null);
      throw toRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.PTY_FAILED,
        'The run terminal could not be created.',
        { runId: this.runValue.id },
        error,
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
        mode: 'supervised',
        runSessionId: reusableSessionId,
        createSessionId: this.createSessionId,
      });
      this.applySessionPlan(this.sessionPlanValue);
    } catch (error) {
      this.runValue.status = 'failed';
      this.runValue.finishedAt = this.timestamp();
      this.runValue.reason = SUPERVISED_STEP_REASONS.PROMPT_FAILED;
      await this.emitAndPersist('run-failed', null);
      this.closePty();
      throw toRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.PROMPT_FAILED,
        'The supervised session plan could not be built.',
        { runId: this.runValue.id },
        error,
      );
    }

    this.startedValue = true;
    this.emit('started', null);
    await this.startCurrentStep('start');
    return this.getRun();
  }

  /** The user explicitly marks the current step Done. Next then becomes enabled. */
  async markDone(): Promise<Run> {
    this.assertCanAct();
    const step = this.requireCurrentStep();
    this.assertOutcomeAllowed(step);
    this.finishObservation();
    this.terminateProcess();

    const timestamp = this.timestamp();
    step.status = 'done';
    step.finishedAt = timestamp;
    step.reason = null;
    this.runValue.status = 'awaiting-user';
    this.runValue.reason = null;
    this.runValue.updatedAt = timestamp;

    await this.emitAndPersist('step-done', step);
    return this.getRun();
  }

  /**
   * The user marks the current step Failed. The run pauses and Next stays
   * disabled; Retry, Skip, and Abort remain available.
   */
  async markFailed(reason?: string): Promise<Run> {
    this.assertCanAct();
    const step = this.requireCurrentStep();
    this.assertOutcomeAllowed(step);
    this.finishObservation();
    this.terminateProcess();

    const timestamp = this.timestamp();
    const bounded = truncateReason(
      normalizeReason(reason) ?? SUPERVISED_STEP_REASONS.STEP_MARKED_FAILED,
    );
    step.status = 'failed';
    step.finishedAt = timestamp;
    step.reason = bounded;
    this.runValue.status = 'paused';
    this.runValue.reason = bounded;
    this.runValue.updatedAt = timestamp;

    await this.emitAndPersist('step-failed', step);
    return this.getRun();
  }

  /**
   * The user marks the current step Skipped. A reason is required so a run
   * record never claims a step silently vanished.
   */
  async markSkipped(reason: string): Promise<Run> {
    this.assertCanAct();
    const step = this.requireCurrentStep();
    this.assertOutcomeAllowed(step);
    const bounded = requireSkipReason(reason);
    this.finishObservation();
    this.terminateProcess();

    const timestamp = this.timestamp();
    step.status = 'skipped';
    step.finishedAt = timestamp;
    step.reason = bounded;
    this.runValue.status = 'awaiting-user';
    this.runValue.reason = null;
    this.runValue.updatedAt = timestamp;

    await this.emitAndPersist('step-skipped', step);
    return this.getRun();
  }

  /** Skip action alias: records a reason and enables Next. */
  async skip(reason: string): Promise<Run> {
    return this.markSkipped(reason);
  }

  /**
   * Advance only after Done or Skipped. A Failed step, a live process, or a
   * paused run cannot advance. The last finished step completes the run and
   * closes the PTY.
   */
  async next(): Promise<Run> {
    this.assertStarted();
    const step = this.requireCurrentStep();
    if (step.status !== 'done' && step.status !== 'skipped') {
      throw new SupervisedRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.NEXT_NOT_READY,
        'Next is available only after the current step is marked Done or Skipped.',
        {
          runId: this.runValue.id,
          stepId: step.id,
          stepIndex: this.runValue.currentStepIndex,
          stepStatus: step.status,
        },
      );
    }

    await this.stopCurrent();
    const nextIndex = this.runValue.currentStepIndex + 1;

    if (nextIndex >= this.runValue.steps.length) {
      const timestamp = this.timestamp();
      this.runValue.status = 'completed';
      this.runValue.finishedAt = timestamp;
      this.runValue.reason = null;
      this.runValue.updatedAt = timestamp;
      await this.emitAndPersist('run-completed', step);
      this.closePty();
      return this.getRun();
    }

    this.runValue.currentStepIndex = nextIndex;
    this.runValue.status = 'running';
    this.runValue.reason = null;
    this.runValue.updatedAt = this.timestamp();
    this.emit('step-advanced', step);
    await this.startCurrentStep('start');
    return this.getRun();
  }

  /**
   * Restart the current step with the same planned session id and the same
   * cached prompt. Retry never reads the saved chain or replays another step.
   */
  async retry(): Promise<Run> {
    this.assertCanAct();
    if (!this.canRetry) {
      throw new SupervisedRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.RETRY_NOT_AVAILABLE,
        'Retry is available only for a failed, interrupted, or paused step.',
        this.stepDetails(this.requireCurrentStep()),
      );
    }

    await this.stopCurrent();
    this.runValue.reason = null;
    this.runValue.updatedAt = this.timestamp();
    await this.startCurrentStep('retry');
    return this.getRun();
  }

  /**
   * Terminate the current child and end the run. No step is replayed and no
   * process is left attached to the finished run.
   */
  async abort(reason?: string): Promise<Run> {
    this.assertStarted();
    if (isFinalStatus(this.runValue.status)) {
      throw new SupervisedRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.FINAL_RUN,
        'The run has already finished.',
        { runId: this.runValue.id, status: this.runValue.status },
      );
    }

    const step = this.currentStepOrNull();
    this.finishObservation();
    // Record an already-exited child's code before waiting for termination.
    this.terminateProcess();
    await this.stopCurrent();

    const timestamp = this.timestamp();
    const bounded = truncateReason(
      normalizeReason(reason) ?? SUPERVISED_STEP_REASONS.ABORTED_BY_USER,
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

    await this.emitAndPersist('run-aborted', step);
    this.closePty();
    return this.getRun();
  }

  /** Dispatch one action from the API surface with mode-appropriate validation. */
  async applyAction(request: SupervisedActionRequest): Promise<Run> {
    if (typeof request !== 'object' || request === null) {
      throw new SupervisedRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.ACTION_INVALID,
        'A supervised run action is required.',
      );
    }

    switch (request.action) {
      case 'done':
        return this.markDone();
      case 'failed':
        return this.markFailed(request.reason);
      case 'skipped':
      case 'skip':
        return this.markSkipped(requireSkipReason(request.reason));
      case 'next':
        return this.next();
      case 'retry':
        return this.retry();
      case 'abort':
        return this.abort(request.reason);
      default:
        throw new SupervisedRunnerError(
          SUPERVISED_RUNNER_ERROR_CODES.ACTION_INVALID,
          'The supervised run action is not recognized.',
          {
            action: typeof request.action === 'string' ? request.action : typeof request.action,
            supported: [...SUPERVISED_ACTIONS],
          },
        );
    }
  }

  /**
   * Kill any remaining child and close the PTY. Safe to call repeatedly and
   * automatically used on completion and abort.
   */
  dispose(): void {
    if (this.disposedValue) {
      return;
    }
    this.disposedValue = true;
    this.detachCurrent({ kill: true });
    this.closePty();
    this.emit('disposed', this.currentStepOrNull());
  }

  async shutdown(): Promise<void> {
    await this.stopCurrent();
    this.dispose();
  }

  private async startCurrentStep(mode: 'start' | 'retry'): Promise<void> {
    const index = this.runValue.currentStepIndex;
    const step = this.runValue.steps[index];
    if (step === undefined) {
      throw new SupervisedRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.STEP_NOT_ACTIVE,
        'The run has no current step.',
        { runId: this.runValue.id, stepIndex: index },
      );
    }

    const planned = this.plannedStep(index);
    let prepared: PreparedStep;
    try {
      prepared = this.preparedStep(index, planned);
    } catch (error) {
      await this.failBeforeSpawn(step, SUPERVISED_STEP_REASONS.PROMPT_FAILED);
      throw toRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.PROMPT_FAILED,
        'The step prompt could not be assembled.',
        this.stepDetails(step),
        error,
      );
    }

    let command: HarnessCommand;
    try {
      command = this.adapter.buildInteractiveCommand({
        prompt: prepared.prompt,
        sessionId: planned.sessionId,
        projectPath: this.projectPathValue,
        sessionMode: this.runValue.chainSnapshot.sessionMode,
        ...(planned.forkFromSessionId === null
          ? {}
          : { forkFromSessionId: planned.forkFromSessionId }),
        automaticPermissionOptIn: this.runValue.chainSnapshot.automaticPermissionOptIn,
        ...(this.runValue.chainSnapshot.agent === undefined
          ? {}
          : { agentName: this.runValue.chainSnapshot.agent.name }),
      });
    } catch (error) {
      await this.failBeforeSpawn(step, SUPERVISED_STEP_REASONS.COMMAND_FAILED);
      throw toRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.COMMAND_FAILED,
        'The harness command could not be built.',
        this.stepDetails(step),
        error,
      );
    }

    // Never reuse a live TUI across steps. A prior process is killed and its
    // listeners detached before the next spawn, including on retry.
    await this.stopCurrent();

    const timestamp = this.timestamp();
    this.resetStepForRun(step, planned, timestamp);
    this.runValue.status = 'running';
    this.runValue.updatedAt = timestamp;
    try {
      await this.emitAndPersist('step-started', step, { reason: mode });
    } catch (error) {
      const failedAt = this.timestamp();
      step.status = 'failed';
      step.finishedAt = failedAt;
      step.reason = SUPERVISED_STEP_REASONS.PERSIST_FAILED;
      this.runValue.status = 'paused';
      this.runValue.reason = step.reason;
      this.runValue.updatedAt = failedAt;
      this.emit('run-paused', step, { reason: step.reason });
      throw error;
    }

    if (this.pty === null) {
      throw new SupervisedRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.PTY_FAILED,
        'The run terminal is not available.',
        { runId: this.runValue.id },
      );
    }

    let process: SupervisedPtyProcess;
    try {
      process = this.pty.spawn({
        executable: command.executable,
        args: [...command.args],
        cwd: command.cwd,
        cols: this.cols,
        rows: this.rows,
      });
    } catch (error) {
      await this.failBeforeSpawn(step, SUPERVISED_STEP_REASONS.SPAWN_FAILED);
      throw toRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.SPAWN_FAILED,
        'The harness process could not be started.',
        this.stepDetails(step),
        error,
      );
    }

    this.attachProcess(process, index);
    this.emit('process-started', step);

    const exit = process.getExit();
    if (exit !== null) {
      this.handleExit(index, this.current?.token ?? null, exit);
      return;
    }

    this.runValue.status = 'awaiting-user';
    this.runValue.updatedAt = this.timestamp();
    await this.emitAndPersist('awaiting-user', step);
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
      throw new SupervisedRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.NOT_STARTED,
        'The supervised session plan is not available.',
        { runId: this.runValue.id },
      );
    }
    const planned = plan.steps[index];
    if (planned === undefined) {
      throw new SupervisedRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.STEP_NOT_ACTIVE,
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
  ): void {
    step.status = 'running';
    step.startedAt = timestamp;
    step.finishedAt = null;
    step.exitCode = null;
    step.sessionId = planned.sessionId;
    step.forkMechanism = planned.forkMechanism as ForkMechanism;
    step.skillObservation =
      step.kind === 'instruction' || this.adapter.skillObservation === 'unobservable' ? 'not-observable' : 'unknown';
    step.tail = '';
    step.reason = null;
    this.tracker = new SkillObservationTracker({
      capability: step.kind === 'instruction' ? 'unobservable' : this.adapter.skillObservation,
      expectedSkillName: step.skillName,
    });
  }

  private attachProcess(process: SupervisedPtyProcess, stepIndex: number): void {
    const token = Symbol(`supervised-step-${String(stepIndex)}`);
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
  }

  private handleExit(
    stepIndex: number,
    token: symbol | null,
    event: TerminalExit,
  ): void {
    void this.coordinate(() => this.handleCoordinatedExit(stepIndex, token, event)).catch(() => {
      console.error(`Skill Loom could not record the process exit for run ${this.runValue.id}; review project ownership and storage.`);
    });
  }

  private async handleCoordinatedExit(
    stepIndex: number,
    token: symbol | null,
    event: TerminalExit,
  ): Promise<void> {
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

    // Process exit is a signal only. A step whose status is already final was
    // marked by the user; leave that outcome untouched. A running step stays
    // running until the user chooses Done, Failed, or Skipped.
    if (step.status === 'running') {
      if (event.exitCode === 0) {
        this.runValue.status = 'awaiting-user';
        step.reason = SUPERVISED_STEP_REASONS.PROCESS_EXITED;
      } else {
        this.runValue.status = 'paused';
        step.reason = SUPERVISED_STEP_REASONS.PROCESS_EXITED_NONZERO;
        this.runValue.reason = step.reason;
      }
    }

    this.runValue.updatedAt = this.timestamp();
    this.emit('process-exit', step, { exitCode: event.exitCode });

    if (step.status === 'running' && event.exitCode !== 0) {
      this.emit('run-paused', step, { reason: step.reason });
    }
    if (this.persistHook !== undefined) await this.persistHook(this.getRun());
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

  private async stopCurrent(): Promise<void> {
    const current = this.current;
    if (current === null) return;
    try {
      await disposeAndWait(current.process, () => {
        current.unsubscribeData();
        current.unsubscribeExit();
        if (current.process.isRunning()) {
          try {
            current.process.kill('SIGTERM');
          } catch (error) {
            if (current.process.isRunning()) throw error;
          }
        }
      });
    } catch (error) {
      throw new SupervisedRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.PROCESS_TERMINATION_FAILED,
        'The harness process could not be terminated; no later step was started.',
        { runId: this.runValue.id, stepIndex: current.stepIndex },
        { cause: error },
      );
    }
    if (this.current === current) this.current = null;
  }

  private closePty(): void {
    const pty = this.pty;
    this.pty = null;
    if (pty !== null) {
      try {
        pty.close();
      } catch {
        // Closing an already-closed surface is harmless.
      }
    }
  }

  private async failBeforeSpawn(step: RunStepRecord, reason: string): Promise<void> {
    this.finishObservation();
    await this.stopCurrent();
    const timestamp = this.timestamp();
    step.status = 'failed';
    step.finishedAt = timestamp;
    step.reason = reason;
    this.runValue.status = 'paused';
    this.runValue.reason = reason;
    this.runValue.updatedAt = timestamp;
    await this.emitAndPersist('step-failed', step, { reason });
  }

  private async emitAndPersist(
    type: SupervisedEventType,
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
          SUPERVISED_RUNNER_ERROR_CODES.PERSIST_FAILED,
          'The supervised run state could not be persisted.',
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
    type: SupervisedEventType,
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
    const event: SupervisedRunEvent = {
      type,
      run: this.getRun(),
      stepIndex: step?.index ?? this.runValue.currentStepIndex,
      stepId: step?.id ?? null,
      terminalId: this.terminalIdValue,
      ...(extras.exitCode === undefined ? {} : { exitCode: extras.exitCode }),
      ...(extras.observation === undefined ? {} : { observation: extras.observation }),
      ...(extras.reason === undefined ? {} : { reason: extras.reason }),
      ...(extras.chunk === undefined ? {} : { chunk: extras.chunk }),
    };
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A UI stream listener must never break the run state machine.
      }
    }
  }

  private assertStarted(): void {
    this.assertNotDisposed();
    if (!this.startedValue) {
      throw new SupervisedRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.NOT_STARTED,
        'The supervised runner has not started.',
        { runId: this.runValue.id },
      );
    }
  }

  private assertCanAct(): void {
    this.assertStarted();
    if (isFinalStatus(this.runValue.status)) {
      throw new SupervisedRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.FINAL_RUN,
        'The run has already finished.',
        { runId: this.runValue.id, status: this.runValue.status },
      );
    }
  }

  private assertNotDisposed(): void {
    if (this.disposedValue) {
      throw new SupervisedRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.DISPOSED,
        'The supervised runner has been disposed.',
        { runId: this.runValue.id },
      );
    }
  }

  private assertOutcomeAllowed(step: RunStepRecord): void {
    if (step.status === 'done' || step.status === 'skipped') {
      throw new SupervisedRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.STEP_ALREADY_FINAL,
        'The current step already has a final outcome.',
        this.stepDetails(step),
      );
    }
    if (step.status !== 'running' && step.status !== 'failed' && step.status !== 'interrupted') {
      throw new SupervisedRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.STEP_NOT_ACTIVE,
        'No supervised step is awaiting an outcome.',
        this.stepDetails(step),
      );
    }
  }

  private requireCurrentStep(): RunStepRecord {
    const step = this.currentStepOrNull();
    if (step === null) {
      throw new SupervisedRunnerError(
        SUPERVISED_RUNNER_ERROR_CODES.STEP_NOT_ACTIVE,
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

/** Create a supervised runner. Convenience wrapper for the orchestrator. */
export function createSupervisedRunner(options: SupervisedRunnerOptions): SupervisedRunner {
  return new SupervisedRunner(options);
}

/** True when a run status is terminal and must not accept further actions. */
export function isFinalSupervisedStatus(status: string): boolean {
  return isFinalStatus(status);
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
    throw new SupervisedRunnerError(
      SUPERVISED_RUNNER_ERROR_CODES.SKIP_REASON_REQUIRED,
      'Skipping a supervised step requires a nonempty reason.',
      { field: 'reason' },
    );
  }
  return truncateReason(normalized);
}

function isFinalStatus(status: string): boolean {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'aborted' ||
    status === 'interrupted'
  );
}

function validateProjectPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.includes('\0') ||
    !isAbsolute(value)
  ) {
    throw new SupervisedRunnerError(
      SUPERVISED_RUNNER_ERROR_CODES.PROJECT_PATH_INVALID,
      'The project directory must be an absolute path without NUL characters.',
      { field: 'projectPath', value: typeof value === 'string' ? value : typeof value },
    );
  }
  return value;
}

function assertTerminalId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new SupervisedRunnerError(
      SUPERVISED_RUNNER_ERROR_CODES.TERMINAL_ID_INVALID,
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
    throw new SupervisedRunnerError(
      SUPERVISED_RUNNER_ERROR_CODES.RUN_INVALID,
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
    throw new SupervisedRunnerError(
      SUPERVISED_RUNNER_ERROR_CODES.RUN_INVALID,
      `${field} must be an integer from 1 to ${String(maximum)}.`,
      { field, value, maximum },
    );
  }
  return value;
}

function toRunnerError(
  code: SupervisedRunnerErrorCode,
  message: string,
  details: Record<string, unknown>,
  cause: unknown,
): SupervisedRunnerError {
  if (cause instanceof SupervisedRunnerError) {
    return cause;
  }
  return new SupervisedRunnerError(code, message, details, { cause });
}
