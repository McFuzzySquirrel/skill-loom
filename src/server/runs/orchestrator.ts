import { spawn as spawnChild } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { withProjectClaimTransaction } from '../../shared/project-claim.js';
import { beginCoordinatedProjectRun, withCoordinatedProjectRun } from '../../shared/project-coordination.js';
import { chainRevision, type ChainService } from '../chains/service.js';
import type { HarnessRegistry } from '../harness/registry.js';
import type { HarnessAdapter } from '../harness/types.js';
import { HarnessError } from '../harness/types.js';
import type { PreflightEngine, PreflightReport } from '../preflight/engine.js';
import type { ProjectRegistry } from '../projects/registry.js';
import {
  RunStoreError,
  RUN_STORE_ERROR_CODES,
  RUN_STORE_WARNING_CODES,
  activeRunPathFor,
  clearActiveRunPointerFile,
  createRunStore,
  readActiveRunPointerFile,
  type ActiveRunPointer,
  type RunStore,
  type RunStoreWarning,
} from './store.js';
import {
  RunError,
  createRunRecord,
  isActiveRunStatus,
  isFinalRunStatus,
  markRunInterrupted,
  toTimestamp,
  trimTail,
  truncateReason,
  type Run,
  type RunMode,
  type RunStepRecord,
  type RunStatus,
  type SkillObservationState,
} from './model.js';
import {
  AutomaticRunner,
  AutomaticRunnerError,
  AUTOMATIC_TERMINAL_COLS,
  AUTOMATIC_TERMINAL_ROWS,
  createAutomaticRunner,
  type AutomaticProcess,
  type AutomaticRunEvent,
  type AutomaticSpawnSpec,
  type AutomaticSpawner,
} from './automatic.js';
import {
  SupervisedRunner,
  SupervisedRunnerError,
  createSupervisedRunner,
  type SupervisedPty,
  type SupervisedPtyContext,
  type SupervisedPtyProcess,
  type SupervisedRunEvent,
} from './supervised.js';
import type { TerminalExit, TerminalManager, TerminalSession } from '../terminal/pty.js';

/**
 * Run orchestration.
 *
 * The orchestrator is the only place that owns the lifecycle of a run: it
 * re-runs preflight at creation, freezes the chain snapshot, resolves inputs,
 * claims the single global active-run slot, creates the selected runner, and
 * broadcasts state to WebSocket subscribers. Routes stay thin: they validate a
 * request, call one orchestrator method, and map a typed failure to the shared
 * error envelope.
 *
 * Nothing here compares a harness name. Adapter descriptors and capabilities
 * decide command construction, trust behavior, and advancement, so adding a
 * harness stays behind the adapter contract (NFR-COMPAT-01).
 */

/** Stable action vocabulary shared by the HTTP action route and the runners. */
export const RUN_ACTIONS = [
  'next',
  'retry',
  'skip',
  'abort',
  'pause',
  'resume',
  'run-next',
  'continue',
  'restart',
  'done',
  'failed',
  'skipped',
] as const;
export type RunActionName = (typeof RUN_ACTIONS)[number];

/** Actions offered only for a run recovered as `interrupted`. */
export const RUN_RECOVERY_ACTIONS = ['retry', 'continue', 'restart'] as const;
export type RunRecoveryActionName = (typeof RUN_RECOVERY_ACTIONS)[number];

const SUPERVISED_ACTION_NAMES: ReadonlySet<string> = new Set([
  'done',
  'failed',
  'skipped',
  'next',
  'retry',
  'skip',
  'abort',
]);

const AUTOMATIC_ACTION_NAMES: ReadonlySet<string> = new Set([
  'pause',
  'resume',
  'run-next',
  'next',
  'retry',
  'skip',
  'abort',
]);

/** Stable orchestrator failure codes; the route maps each to one status. */
export const RUN_ORCHESTRATOR_ERROR_CODES = {
  PROJECT_ID_INVALID: 'RUN_PROJECT_ID_INVALID',
  PROJECT_NOT_FOUND: 'RUN_PROJECT_NOT_FOUND',
  RUN_ID_INVALID: 'RUN_ID_INVALID',
  RUN_NOT_FOUND: 'RUN_NOT_FOUND',
  ACTIVE_CONFLICT: 'RUN_ACTIVE_CONFLICT',
  PREFLIGHT_BLOCKED: 'RUN_PREFLIGHT_BLOCKED',
  MODE_INVALID: 'RUN_MODE_INVALID',
  ACTION_INVALID: 'RUN_ACTION_INVALID',
  ACTION_MODE_MISMATCH: 'RUN_ACTION_MODE_MISMATCH',
  ACTION_NOT_ALLOWED: 'RUN_ACTION_NOT_ALLOWED',
  STALE: 'RUN_STALE',
  NOT_LIVE: 'RUN_NOT_LIVE',
  RECOVERY_REQUIRED: 'RUN_RECOVERY_REQUIRED',
  RECOVERY_NOT_AVAILABLE: 'RUN_RECOVERY_NOT_AVAILABLE',
  RECOVERY_STEP_INVALID: 'RUN_RECOVERY_STEP_INVALID',
  RECOVERY_NO_PENDING: 'RUN_RECOVERY_NO_PENDING',
  START_FAILED: 'RUN_START_FAILED',
  COORDINATION_REQUIRED: 'RUN_COORDINATION_REQUIRED',
} as const;
export type RunOrchestratorErrorCode =
  (typeof RUN_ORCHESTRATOR_ERROR_CODES)[keyof typeof RUN_ORCHESTRATOR_ERROR_CODES];

/** Typed orchestration failure. Details never contain prompts or credentials. */
export class RunOrchestratorError extends Error {
  readonly code: RunOrchestratorErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: RunOrchestratorErrorCode,
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

/** Action flags published with a run snapshot. */
export interface RunActionAvailability {
  next: boolean;
  retry: boolean;
  skip: boolean;
  abort: boolean;
  pause: boolean;
  resume: boolean;
  runNext: boolean;
  done: boolean;
  failed: boolean;
  continue: boolean;
  restart: boolean;
}

/** Recovery choices for an interrupted run. */
export interface RunRecoveryOptions {
  retry: boolean;
  continue: boolean;
  restart: boolean;
}

export interface RunView {
  readonly run: Run;
  readonly projectPath: string;
  /** Live terminal id for attaching the browser, or null when no PTY is live. */
  readonly terminalId: string | null;
  readonly actions: RunActionAvailability;
  readonly recovery: RunRecoveryOptions | null;
}

export interface RunActiveState {
  readonly active: boolean;
  readonly runId: string | null;
  readonly status: string | null;
  readonly run: Run | null;
  readonly terminalId: string | null;
  readonly actions: RunActionAvailability | null;
  readonly recovery: RunRecoveryOptions | null;
}

export interface CreateRunRequest {
  readonly projectId: string;
  readonly chainId: string;
  readonly harness?: string | undefined;
  readonly mode?: string | undefined;
  readonly inputs?: unknown;
  readonly acknowledgements?: unknown;
  readonly expectedStart?: {
    chainRevision: string;
    preflightDigest: string;
    projectPath: string;
    projectDevice: string;
    projectInode: string;
  };
}

export interface RunActionRequest {
  readonly action: string;
  readonly reason?: string | undefined;
  readonly expectedRevision?: string | undefined;
  readonly expectedProject?: {
    path: string;
    device: string;
    inode: string;
  };
  readonly expectedPreflight?: {
    digest: string;
    acknowledgements?: unknown;
  };
}

export function runRevision(run: Run): string {
  return createHash('sha256').update(JSON.stringify(run)).digest('hex');
}

export interface RunActionResult {
  readonly run: Run;
  /** New run id when the action restarted the chain, otherwise null. */
  readonly restartedFrom: string | null;
}

export interface RunRecoverySummary {
  readonly interrupted: Run[];
  readonly clearedActiveRun: boolean;
  readonly warnings: RunStoreWarning[];
  readonly projects: string[];
}

/** Event union emitted by either runner. */
export type OrchestratedRunEvent = SupervisedRunEvent | AutomaticRunEvent;

/** Snapshot delivered first on every WebSocket (re)connect. */
export interface RunStreamSnapshot {
  readonly type: 'snapshot';
  readonly runId: string;
  readonly sequence: number;
  readonly run: Run;
  readonly terminalId: string | null;
  readonly actions: RunActionAvailability;
  readonly recovery: RunRecoveryOptions | null;
}

/** State delta delivered after the reconnect snapshot. */
export interface RunStreamDelta {
  readonly type: Exclude<OrchestratedRunEvent['type'], 'snapshot'>;
  readonly runId: string;
  readonly sequence: number;
  readonly run: Run;
  readonly stepIndex: number;
  readonly stepId: string | null;
  readonly terminalId: string | null;
  readonly actions: RunActionAvailability;
  readonly exitCode?: number | null;
  readonly observation?: SkillObservationState;
  readonly reason?: string | null;
  readonly chunk?: string;
  readonly permissions?: readonly string[];
}

export type RunStreamMessage = RunStreamSnapshot | RunStreamDelta;

/** WebSocket protocol failure, sent before the socket is closed. */
export interface RunStreamError {
  readonly type: 'error';
  readonly code: string;
  readonly message: string;
}

export type RunStreamServerMessage = RunStreamMessage | RunStreamError;

/** A runner plus the project and terminal it owns. */
type LiveRun =
  | {
      readonly mode: 'supervised';
      readonly projectPath: string;
      readonly terminalId: string;
      readonly store: RunStore;
      readonly runner: SupervisedRunner;
    }
  | {
      readonly mode: 'automatic';
      readonly projectPath: string;
      readonly terminalId: string;
      readonly store: RunStore;
      readonly runner: AutomaticRunner;
    };

/** Injection context for the production supervised PTY surface. */
export interface RunSupervisedPtyContext {
  readonly runId: string;
  readonly terminalId: string;
  readonly cols: number;
  readonly rows: number;
}

/** Injection context for the production automatic process/PTY surface. */
export interface RunAutomaticSpawnerContext {
  readonly runId: string;
  readonly terminalId: string;
  readonly cols: number;
  readonly rows: number;
}

type Resolvable<T> = T | (() => T | Promise<T>);

export interface RunOrchestratorOptions {
  /** Skill Loom config directory that owns the global active-run pointer. */
  readonly configDirectory: string;
  readonly projectRegistry: ProjectRegistry;
  readonly chainService: ChainService;
  readonly harnessRegistry: Resolvable<HarnessRegistry>;
  readonly preflightEngine: Resolvable<PreflightEngine>;
  readonly terminalManager: TerminalManager;
  /** Clock seam. Defaults to the wall clock. */
  readonly now?: (() => Date) | undefined;
  /** Session id seam used by shared/fresh/fork plans. */
  readonly createSessionId?: (() => string) | undefined;
  /** Run id seam. Defaults to `run-<uuid>`. */
  readonly createRunId?: (() => string) | undefined;
  /** Optional store factory for deterministic storage tests. */
  readonly runStoreFor?: ((projectPath: string) => RunStore) | undefined;
  /** Production PTY seam. Defaults to the shared terminal manager. */
  readonly createSupervisedPty?:
    | ((context: RunSupervisedPtyContext) => SupervisedPty)
    | undefined;
  /** Production automatic surface seam. Defaults to manager/child process. */
  readonly createAutomaticSpawner?:
    | ((context: RunAutomaticSpawnerContext) => AutomaticSpawner)
    | undefined;
  /** Bound for one automatic step. Defaults to 30 minutes. */
  readonly stepTimeoutMs?: number | undefined;
  /** Max queued deltas per subscriber while a reconnect snapshot is built. */
  readonly reconnectBufferSize?: number | undefined;
}

export interface RunOrchestrator {
  /** Re-run blocking preflight, freeze the chain, then start the selected runner. */
  createRun(request: CreateRunRequest): Promise<Run>;
  /** Read one recorded run by safe id. */
  getRun(runId: string): Promise<Run>;
  /** Run record plus mode-appropriate action flags. */
  getRunView(runId: string): Promise<RunView>;
  /** Current global active-run summary. */
  getActiveRun(): Promise<RunActiveState>;
  /** True until all owned processes and finalization for this project are finished. */
  hasLiveProject(projectPath: string): boolean;
  /** Apply one action with mode-appropriate validation. */
  applyAction(runId: string, request: RunActionRequest): Promise<RunActionResult>;
  /**
   * Subscribe to a run stream. The listener receives a full snapshot first,
   * then ordered deltas. Returns an unsubscribe function.
   */
  subscribe(
    runId: string,
    listener: (message: RunStreamMessage) => void,
  ): Promise<() => void>;
  /** Mark stale active records interrupted and clear the global pointer. */
  recoverOnStartup(): Promise<RunRecoverySummary>;
  /** Dispose every runner, close every run PTY, and clear subscribers. */
  shutdown(): Promise<void>;
}

const DEFAULT_RECONNECT_BUFFER_SIZE = 256;
const MAX_PROCESS_BUFFER_BYTES = 64 * 1024;

interface Subscription {
  readonly listener: (message: RunStreamMessage) => void;
  ready: boolean;
  buffer: RunStreamDelta[];
}

export function runTerminalIdFor(runId: string): string {
  return `loom_run_${runId}`;
}

class RunOrchestratorService implements RunOrchestrator {
  private readonly options: RunOrchestratorOptions;
  private readonly stores = new Map<string, RunStore>();
  private readonly liveRuns = new Map<string, LiveRun>();
  private readonly runLocations = new Map<string, string>();
  private readonly sequences = new Map<string, number>();
  private readonly finalized = new Set<string>();
  private readonly finalizationQueues = new Map<string, Promise<void>>();
  private readonly subscribers = new Map<string, Set<Subscription>>();
  private readonly persistQueues = new Map<string, Promise<void>>();
  private readonly actionQueues = new Map<string, Promise<void>>();
  private readonly reconnectBufferSize: number;
  private shuttingDown = false;
  private registryPromise: Promise<HarnessRegistry> | null = null;
  private enginePromise: Promise<PreflightEngine> | null = null;

  constructor(options: RunOrchestratorOptions) {
    if (typeof options.configDirectory !== 'string' || options.configDirectory.trim() === '') {
      throw new RunOrchestratorError(
        RUN_ORCHESTRATOR_ERROR_CODES.START_FAILED,
        'A Skill Loom config directory is required.',
      );
    }
    this.options = options;
    this.reconnectBufferSize = Math.max(
      1,
      options.reconnectBufferSize ?? DEFAULT_RECONNECT_BUFFER_SIZE,
    );
  }

  async createRun(request: CreateRunRequest): Promise<Run> {
    this.assertRunning();
    const projectPath = await this.resolveProjectPath(request.projectId);
    const chain = await this.options.chainService.get(projectPath, request.chainId);
    if (request.expectedStart !== undefined &&
        (projectPath !== request.expectedStart.projectPath || chainRevision(chain) !== request.expectedStart.chainRevision)) {
      throw new RunOrchestratorError(RUN_ORCHESTRATOR_ERROR_CODES.STALE, 'The project or chain changed since review.');
    }

    // Check for an active run before preflight so a second start is a clean
    // conflict even when the request would also fail preflight.
    await this.assertNoActiveRun();

    const engine = await this.preflightEngine();
    const preflightRequest = {
      chain,
      projectPath,
      ...(request.harness === undefined ? {} : { harness: request.harness }),
      ...(request.mode === undefined ? {} : { mode: request.mode }),
      ...(request.inputs === undefined ? {} : { inputs: request.inputs }),
      ...(request.acknowledgements === undefined
        ? {}
        : { acknowledgements: request.acknowledgements }),
    };

    const report = await engine.run(preflightRequest);
    if (request.expectedStart !== undefined) {
      let info;
      let canonicalPath;
      try {
        canonicalPath = await realpath(projectPath);
        info = await stat(projectPath, { bigint: true });
      } catch {
        throw new RunOrchestratorError(RUN_ORCHESTRATOR_ERROR_CODES.STALE, 'The reviewed project is no longer available.');
      }
      if (canonicalPath !== projectPath || !info.isDirectory() || String(info.dev) !== request.expectedStart.projectDevice ||
          String(info.ino) !== request.expectedStart.projectInode ||
          createHash('sha256').update(JSON.stringify(report)).digest('hex') !== request.expectedStart.preflightDigest) {
        throw new RunOrchestratorError(RUN_ORCHESTRATOR_ERROR_CODES.STALE, 'The project or preflight evidence changed since review.');
      }
    }
    if (!report.startAllowed || report.status === 'blocked') {
      throw new RunOrchestratorError(
        RUN_ORCHESTRATOR_ERROR_CODES.PREFLIGHT_BLOCKED,
        'Preflight blocks this run. Resolve the blocking findings before starting.',
        {
          projectId: request.projectId,
          chainId: request.chainId,
          status: report.status,
          report,
        },
      );
    }

    const mode = normalizeRunMode(request.mode ?? report.mode ?? 'supervised');
    const run = createRunRecord({
      ...(this.options.createRunId === undefined ? {} : { id: this.options.createRunId() }),
      projectId: request.projectId,
      chain,
      mode,
      ...(request.inputs === undefined ? {} : { inputs: request.inputs }),
      now: this.now(),
    });

    return beginCoordinatedProjectRun(projectPath, 'managed', run.id, async () => {
      const store = this.storeFor(projectPath);
      try {
        await store.create(run);
      } catch (error) {
        if (isRunStoreCode(error, RUN_STORE_ERROR_CODES.ACTIVE_CONFLICT)) {
          throw this.conflictFromStoreError(error);
        }
        throw error;
      }

      this.runLocations.set(run.id, projectPath);
      this.finalized.delete(run.id);

      return await this.startRun(run, projectPath);
    });
  }

  async getRun(runId: string): Promise<Run> {
    const located = await this.locateRun(runId);
    return located.run;
  }

  async getRunView(runId: string): Promise<RunView> {
    const located = await this.locateRun(runId);
    const live = this.liveRuns.get(located.run.id);
    const run = live?.runner.getRun() ?? located.run;
    let recovery = this.recoveryFor(run);
    if (recovery !== null) {
      const availableRecovery = recovery;
      recovery = await withProjectClaimTransaction(located.projectPath, async (tx) => {
        const protocol = tx.protocol();
        const claim = tx.read();
        if (protocol === null && claim === null) return availableRecovery;
        const matches = protocol !== null && claim?.kind === 'managed' && claim.runId === run.id;
        return {
          retry: matches && availableRecovery.retry,
          continue: matches && availableRecovery.continue,
          restart: false,
        };
      });
    }
    const actions = this.availableActions(run);
    if (recovery !== null) {
      actions.retry = recovery.retry;
      actions.continue = recovery.continue;
      actions.restart = recovery.restart;
    }
    return {
      run,
      projectPath: located.projectPath,
      terminalId: this.liveTerminalId(run.id),
      actions,
      recovery,
    };
  }

  async getActiveRun(): Promise<RunActiveState> {
    const pointer = await this.readPointerOrNull();
    if (pointer !== null) {
      const live = this.liveRuns.get(pointer.runId);
      const run = live?.runner.getRun() ?? (await this.tryReadPointerRun(pointer));
      if (run !== null && isActiveRunStatus(run.status)) {
        return this.activeState(run);
      }
    }

    for (const entry of this.liveRuns.values()) {
      const run = entry.runner.getRun();
      if (isActiveRunStatus(run.status)) {
        return this.activeState(run);
      }
    }

    return {
      active: false,
      runId: null,
      status: null,
      run: null,
      terminalId: null,
      actions: null,
      recovery: null,
    };
  }

  hasLiveProject(projectPath: string): boolean {
    return [...this.liveRuns.values()].some((entry) => entry.projectPath === projectPath);
  }

  async applyAction(runId: string, request: RunActionRequest): Promise<RunActionResult> {
    const previous = this.actionQueues.get(runId) ?? Promise.resolve();
    const act = async (): Promise<RunActionResult> => {
      const located = await this.locateRun(runId);
      const live = this.liveRuns.get(runId);
      if (live?.mode === 'automatic') {
        const result = await live.runner.withSerializedTransition(
          () => this.applyActionUnlocked(runId, request, true),
        );
        if (isFinalRunStatus(result.run.status)) await this.finalizeRunAsync(runId);
        return { ...result, run: this.currentRun(runId) ?? result.run };
      }
      return withCoordinatedProjectRun(located.projectPath, { kind: 'managed', runId }, async (claim) => {
        return this.applyActionUnlocked(runId, request, false, claim !== null);
      });
    };
    const result = previous.then(act, act);
    const settled = result.then(() => undefined, () => undefined);
    this.actionQueues.set(runId, settled);
    void settled.then(() => {
      if (this.actionQueues.get(runId) === settled) this.actionQueues.delete(runId);
    });
    return result;
  }

  private async applyActionUnlocked(
    runId: string,
    request: RunActionRequest,
    automaticTransition = false,
    coordinated = false,
  ): Promise<RunActionResult> {
    this.assertRunning();
    const action = assertActionName(request.action);
    const located = await this.locateRun(runId);
    if (request.expectedPreflight !== undefined) {
      const preflightRun = this.liveRuns.get(runId)?.runner.getRun() ?? located.run;
      const report = await (await this.preflightEngine()).run({
        chain: preflightRun.chainSnapshot, projectPath: located.projectPath,
        mode: preflightRun.mode, inputs: preflightRun.resolvedInputs,
        ...(request.expectedPreflight.acknowledgements === undefined ? {} :
          { acknowledgements: request.expectedPreflight.acknowledgements }),
      });
      if (createHash('sha256').update(JSON.stringify(report)).digest('hex') !== request.expectedPreflight.digest) {
        throw new RunOrchestratorError(RUN_ORCHESTRATOR_ERROR_CODES.STALE, 'Preflight evidence changed since review.');
      }
      if (!report.startAllowed || report.status === 'blocked') {
        throw new RunOrchestratorError(RUN_ORCHESTRATOR_ERROR_CODES.PREFLIGHT_BLOCKED, 'Preflight blocks this action.', { report });
      }
    }
    if (request.expectedProject !== undefined) {
      try {
        const canonical = await realpath(located.projectPath);
        const info = await stat(located.projectPath, { bigint: true });
        if (canonical !== located.projectPath || located.projectPath !== request.expectedProject.path ||
            !info.isDirectory() || String(info.dev) !== request.expectedProject.device ||
            String(info.ino) !== request.expectedProject.inode) {
          throw new RunOrchestratorError(RUN_ORCHESTRATOR_ERROR_CODES.STALE, 'The reviewed project changed.');
        }
      } catch (error) {
        if (error instanceof RunOrchestratorError) throw error;
        throw new RunOrchestratorError(RUN_ORCHESTRATOR_ERROR_CODES.STALE, 'The reviewed project is no longer available.');
      }
    }
    const current = this.liveRuns.get(runId)?.runner.getRun() ?? located.run;
    if (request.expectedRevision !== undefined && runRevision(current) !== request.expectedRevision) {
      throw new RunOrchestratorError(
        RUN_ORCHESTRATOR_ERROR_CODES.STALE,
        'The run changed since the action was reviewed. Review the current state again.',
        { runId },
      );
    }

    if (located.run.status === 'interrupted') {
      if (coordinated && action === 'restart') {
        throw new RunOrchestratorError(
          RUN_ORCHESTRATOR_ERROR_CODES.COORDINATION_REQUIRED,
          'Abandon and clear the reviewed claim before restarting this chain as a new run.',
        );
      }
      return this.applyRecoveryAction(located.run, located.projectPath, action, request.reason, request.expectedRevision);
    }

    if (
      action === 'continue' ||
      action === 'restart' ||
      (action === 'retry' && this.liveRuns.get(runId) === undefined)
    ) {
      throw new RunOrchestratorError(
        RUN_ORCHESTRATOR_ERROR_CODES.RECOVERY_REQUIRED,
        'This run is not in an interrupted state; recovery actions are unavailable.',
        {
          runId,
          status: located.run.status,
          supported: [...RUN_RECOVERY_ACTIONS],
        },
      );
    }

    const entry = this.liveRuns.get(runId);
    if (entry === undefined) {
      throw new RunOrchestratorError(
        RUN_ORCHESTRATOR_ERROR_CODES.NOT_LIVE,
        'The run is not live in this server process.',
        { runId, status: located.run.status },
      );
    }

    let run: Run;
    if (entry.mode === 'supervised') {
      this.assertActionAllowed(action, 'supervised', SUPERVISED_ACTION_NAMES);
      run = await entry.runner.applyAction({
        action,
        ...(request.reason === undefined ? {} : { reason: request.reason }),
      });
    } else {
      this.assertActionAllowed(action, 'automatic', AUTOMATIC_ACTION_NAMES);
      run = await entry.runner.applyAction({
        action,
        ...(request.reason === undefined ? {} : { reason: request.reason }),
      }, !automaticTransition);
    }

    if (isFinalRunStatus(run.status) && !automaticTransition) {
      await this.finalizeRunAsync(runId);
    }

    return { run: this.currentRun(runId) ?? run, restartedFrom: null };
  }

  async subscribe(
    runId: string,
    listener: (message: RunStreamMessage) => void,
  ): Promise<() => void> {
    const startSequence = this.sequences.get(runId) ?? 0;
    const subscription: Subscription = { listener, ready: false, buffer: [] };

    let subscribers = this.subscribers.get(runId);
    if (subscribers === undefined) {
      subscribers = new Set<Subscription>();
      this.subscribers.set(runId, subscribers);
    }
    subscribers.add(subscription);

    try {
      const view = await this.getRunView(runId);
      const snapshot: RunStreamSnapshot = {
        type: 'snapshot',
        runId,
        sequence: startSequence,
        run: view.run,
        terminalId: view.terminalId,
        actions: view.actions,
        recovery: view.recovery,
      };
      sendSafely(listener, snapshot);

      subscription.ready = true;
      const pending = subscription.buffer.filter(
        (delta) => delta.sequence > startSequence,
      );
      subscription.buffer = [];
      for (const delta of pending) {
        sendSafely(listener, delta);
      }
    } catch (error) {
      subscribers.delete(subscription);
      if (subscribers.size === 0) {
        this.subscribers.delete(runId);
      }
      throw error;
    }

    return () => {
      subscribers?.delete(subscription);
      if (subscribers !== undefined && subscribers.size === 0) {
        this.subscribers.delete(runId);
      }
    };
  }

  async recoverOnStartup(): Promise<RunRecoverySummary> {
    const warnings: RunStoreWarning[] = [];
    const interrupted: Run[] = [];
    const projects: string[] = [];
    let clearedActiveRun = false;

    const pointer = await this.readPointerOrNull();

    const recent = await this.options.projectRegistry.listKnownProjects();
    const targets: string[] = [];
    if (pointer !== null) {
      targets.push(pointer.projectPath);
    }
    for (const project of recent) {
      targets.push(project.canonicalPath);
    }

    for (const target of [...new Set(targets)]) {
      projects.push(target);

      let directory = false;
      try {
        directory = (await stat(target)).isDirectory();
      } catch {
        directory = false;
      }

      if (!directory) {
        if (pointer !== null && pointer.projectPath === target) {
          warnings.push({
            code: RUN_STORE_WARNING_CODES.PROJECT_NOT_FOUND,
            message: 'The project referenced by the active-run pointer no longer exists.',
            path: activeRunPathFor(this.options.configDirectory),
            runId: pointer.runId,
            projectPath: target,
            reason: 'PROJECT_NOT_FOUND',
          });
          clearedActiveRun = await this.clearPointerQuietly();
        }
        continue;
      }

      const store = this.storeFor(target);
      try {
        const result = await store.recoverInterruptedRuns();
        interrupted.push(...result.interrupted);
        warnings.push(...result.warnings);
        clearedActiveRun = clearedActiveRun || result.clearedActiveRun;
      } catch (error) {
        if (!isRecoverableRecoveryError(error)) {
          throw error;
        }
        if (pointer !== null && pointer.projectPath === target) {
          warnings.push({
            code: RUN_STORE_WARNING_CODES.PROJECT_NOT_FOUND,
            message: 'The project referenced by the active-run pointer could not be recovered.',
            path: activeRunPathFor(this.options.configDirectory),
            runId: pointer.runId,
            projectPath: target,
            reason: errorCode(error),
          });
          clearedActiveRun = (await this.clearPointerQuietly()) || clearedActiveRun;
        }
      }
    }

    // A pointer can outlive the project that owned it. Never leave a stale
    // pointer that would block every future start.
    const remaining = await this.readPointerOrNull();
    if (remaining !== null) {
      const run = await this.tryReadPointerRun(remaining);
      if (run === null || !isActiveRunStatus(run.status)) {
        const wasClaimed = warnings.some((warning) =>
          warning.code === RUN_STORE_WARNING_CODES.RECOVERY_CLAIMED &&
          warning.projectPath === remaining.projectPath && warning.runId === remaining.runId);
        if (!wasClaimed) {
          await withProjectClaimTransaction(remaining.projectPath, async (tx) => {
            const pointer = await this.readPointerOrNull();
            if (pointer === null || pointer.projectPath !== remaining.projectPath || pointer.runId !== remaining.runId) return;
            if (tx.read() !== null || tx.protocol() !== null) {
              warnings.push({
                code: RUN_STORE_WARNING_CODES.RECOVERY_CLAIMED,
                message: 'Project coordination requires explicit review; startup left the run and active pointer unchanged.',
                path: activeRunPathFor(this.options.configDirectory),
                runId: pointer.runId,
                projectPath: pointer.projectPath,
                reason: 'PROJECT_RECONCILIATION_REQUIRED',
              });
              return;
            }
            const current = await this.tryReadPointerRun(pointer);
            if (current === null || !isActiveRunStatus(current.status)) {
              clearedActiveRun = (await this.clearPointerQuietly()) || clearedActiveRun;
            }
          });
        }
      }
    }

    return { interrupted, clearedActiveRun, warnings, projects };
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const entries = [...this.liveRuns.entries()];
    const failures: unknown[] = [];

    for (const [runId, entry] of entries) {
      try {
        const finalizing = this.finalizationQueues.get(runId);
        if (finalizing !== undefined) {
          await finalizing;
          continue;
        }
        await entry.runner.shutdown();
        this.options.terminalManager.closeSession(entry.terminalId);
        await withCoordinatedProjectRun(entry.projectPath, { kind: 'managed', runId }, async () => {
          await this.awaitPersistQueue(runId);
          const latest = await entry.store.read(runId);
          if (isActiveRunStatus(latest.status)) {
            const interrupted = markRunInterrupted(
              latest,
              this.timestamp(),
              'SERVER_SHUTDOWN',
            );
            await entry.store.update(interrupted);
          }
          await entry.store.releaseActiveRun(runId);
          this.finalized.add(runId);
          this.liveRuns.delete(runId);
          this.subscribers.delete(runId);
        });
      } catch (error) {
        failures.push(error);
      }
    }

    await Promise.all(this.persistQueues.values());
    if (failures.length > 0) {
      throw new AggregateError(failures, 'One or more active runs could not be shut down cleanly.');
    }
    this.subscribers.clear();
  }

  private async startRun(run: Run, projectPath: string): Promise<Run> {
    const store = this.storeFor(projectPath);
    const terminalId = runTerminalIdFor(run.id);
    const persist = (next: Run): Promise<void> => this.persistRun(projectPath, next);
    const onEvent = (event: OrchestratedRunEvent): void => {
      this.handleRunnerEvent(run.id, event);
    };

    try {
      this.assertRunning();
      const registry = await this.harnessRegistry();
      this.assertRunning();
      const adapter = registry.get(run.harness);
      if (run.mode === 'supervised') {
        const createPty = this.options.createSupervisedPty ?? ((context) =>
          createManagedSupervisedPty(this.options.terminalManager, context));
        const runner = createSupervisedRunner({
          run,
          adapter,
          projectPath,
          createPty: (context: SupervisedPtyContext) =>
            createPty({
              runId: run.id,
              terminalId: context.terminalId,
              cols: context.cols,
              rows: context.rows,
            }),
          terminalId,
          ...(this.options.now === undefined ? {} : { now: this.options.now }),
          ...(this.options.createSessionId === undefined
            ? {}
            : { createSessionId: this.options.createSessionId }),
          coordinate: (task) => withCoordinatedProjectRun(projectPath, { kind: 'managed', runId: run.id }, task),
          persist,
          onEvent,
        });

        this.liveRuns.set(run.id, {
          mode: 'supervised',
          projectPath,
          terminalId,
          store,
          runner,
        });
        await runner.start();
      } else {
        const createSpawner =
          this.options.createAutomaticSpawner ??
          ((context) => createManagedAutomaticSpawner(this.options.terminalManager, context));
        const runner = createAutomaticRunner({
          run,
          adapter,
          projectPath,
          spawn: createSpawner({
            runId: run.id,
            terminalId,
            cols: AUTOMATIC_TERMINAL_COLS,
            rows: AUTOMATIC_TERMINAL_ROWS,
          }),
          terminalId,
          ...(this.options.now === undefined ? {} : { now: this.options.now }),
          ...(this.options.createSessionId === undefined
            ? {}
            : { createSessionId: this.options.createSessionId }),
          ...(this.options.stepTimeoutMs === undefined
            ? {}
            : { stepTimeoutMs: this.options.stepTimeoutMs }),
          coordinate: (task) => withCoordinatedProjectRun(projectPath, { kind: 'managed', runId: run.id }, task),
          persist,
          onEvent,
        });

        this.liveRuns.set(run.id, {
          mode: 'automatic',
          projectPath,
          terminalId,
          store,
          runner,
        });
        await runner.start();
      }
    } catch (error) {
      const live = this.liveRuns.get(run.id);
      if (live !== undefined) {
        try {
          await live.runner.shutdown();
        } catch (cleanupError) {
          throw new RunOrchestratorError(
            RUN_ORCHESTRATOR_ERROR_CODES.START_FAILED,
            'The run could not start and its harness could not be terminated. The run remains active.',
            { runId: run.id },
            { cause: new AggregateError([error, cleanupError], 'Run start and cleanup failed.') },
          );
        }
      }
      await this.awaitPersistQueue(run.id);
      await this.failStartingRun(store, run.id);
      await store.releaseActiveRun(run.id);
      await this.finalizeRunAsync(run.id);
      if (
        error instanceof RunOrchestratorError ||
        error instanceof SupervisedRunnerError ||
        error instanceof AutomaticRunnerError ||
        error instanceof HarnessError ||
        error instanceof RunError
      ) {
        throw error;
      }
      throw new RunOrchestratorError(
        RUN_ORCHESTRATOR_ERROR_CODES.START_FAILED,
        'The run could not be started.',
        { runId: run.id, reason: errorCode(error) },
        { cause: error },
      );
    }

    return this.currentRun(run.id) ?? run;
  }

  private async applyRecoveryAction(
    run: Run,
    projectPath: string,
    action: RunActionName,
    reason: string | undefined,
    expectedRevision?: string,
  ): Promise<RunActionResult> {
    if (!(RUN_RECOVERY_ACTIONS as readonly string[]).includes(action)) {
      throw new RunOrchestratorError(
        RUN_ORCHESTRATOR_ERROR_CODES.ACTION_NOT_ALLOWED,
        'Only retry, continue, or restart are available for an interrupted run.',
        {
          runId: run.id,
          action,
          supported: [...RUN_RECOVERY_ACTIONS],
        },
      );
    }

    if (action === 'restart') {
      return this.restartRun(run, projectPath, expectedRevision);
    }

    await this.assertNoActiveRun(run.id);
    await this.finalizeRunAsync(run.id);
    await this.awaitPersistQueue(run.id);
    await this.assertRecoveryRevision(projectPath, run.id, expectedRevision);

    if (action === 'retry') {
      const step = run.steps[run.currentStepIndex];
      if (step === undefined || step.status !== 'interrupted') {
        throw new RunOrchestratorError(
          RUN_ORCHESTRATOR_ERROR_CODES.RECOVERY_STEP_INVALID,
          'The interrupted step cannot be retried because no step is marked interrupted.',
          {
            runId: run.id,
            currentStepIndex: run.currentStepIndex,
            stepStatus: step?.status ?? null,
          },
        );
      }
      const resumed = resumedRun(run, this.now(), run.currentStepIndex, 'retry');
      return this.launchResumedRun(resumed, run, projectPath);
    }

    const target = findNextPendingIndex(run);
    if (target === null) {
      throw new RunOrchestratorError(
        RUN_ORCHESTRATOR_ERROR_CODES.RECOVERY_NO_PENDING,
        'There is no pending step to continue from.',
        { runId: run.id, currentStepIndex: run.currentStepIndex },
      );
    }
    const resumed = resumedRun(run, this.now(), target, 'continue');
    return this.launchResumedRun(resumed, run, projectPath);
  }

  private async launchResumedRun(
    resumed: Run,
    previous: Run,
    projectPath: string,
  ): Promise<RunActionResult> {
    const store = this.storeFor(projectPath);
    try {
      await store.update(resumed);
      await store.activate(resumed);
    } catch (error) {
      // Never leave a run record that claims to be starting without the global
      // pointer. Reverting restores the explicit interrupted state.
      await store.update(previous).catch(() => undefined);
      if (isRunStoreCode(error, RUN_STORE_ERROR_CODES.ACTIVE_CONFLICT)) {
        throw this.conflictFromStoreError(error);
      }
      throw error;
    }

    this.runLocations.set(resumed.id, projectPath);
    this.finalized.delete(resumed.id);
    const started = await this.startRun(resumed, projectPath);
    return { run: started, restartedFrom: null };
  }

  private async restartRun(run: Run, projectPath: string, expectedRevision?: string): Promise<RunActionResult> {
    await this.assertNoActiveRun(run.id);
    await this.finalizeRunAsync(run.id);
    await this.awaitPersistQueue(run.id);
    await this.assertRecoveryRevision(projectPath, run.id, expectedRevision);

    const fresh = createRunRecord({
      ...(this.options.createRunId === undefined ? {} : { id: this.options.createRunId() }),
      projectId: run.projectId,
      chain: run.chainSnapshot,
      mode: run.mode,
      inputs: run.resolvedInputs,
      now: this.now(),
    });

    const store = this.storeFor(projectPath);
    try {
      await store.create(fresh);
    } catch (error) {
      if (isRunStoreCode(error, RUN_STORE_ERROR_CODES.ACTIVE_CONFLICT)) {
        throw this.conflictFromStoreError(error);
      }
      throw error;
    }

    this.runLocations.set(fresh.id, projectPath);
    this.finalized.delete(fresh.id);
    const started = await this.startRun(fresh, projectPath);
    return { run: started, restartedFrom: run.id };
  }

  private async assertRecoveryRevision(projectPath: string, runId: string, expectedRevision?: string): Promise<void> {
    if (expectedRevision === undefined) return;
    const current = await this.storeFor(projectPath).read(runId);
    if (runRevision(current) !== expectedRevision) {
      throw new RunOrchestratorError(RUN_ORCHESTRATOR_ERROR_CODES.STALE, 'The interrupted run changed since review.');
    }
  }

  private persistRun(projectPath: string, run: Run): Promise<void> {
    const store = this.storeFor(projectPath);
    const previous = this.persistQueues.get(run.id) ?? Promise.resolve();

    // Transitions and best-effort output persistence can overlap (for example,
    // a process-exit snapshot starts while an abort transition is being saved).
    // Serialize writes in invocation order so the newest state always wins.
    const next = previous.then(
      () => store.update(run),
      () => store.update(run),
    );
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.persistQueues.set(run.id, settled);
    void settled.then(() => {
      if (this.persistQueues.get(run.id) === settled) {
        this.persistQueues.delete(run.id);
      }
    });

    return next.then((saved) => {
      this.runLocations.set(saved.id, projectPath);
    });
  }

  private async awaitPersistQueue(runId: string): Promise<void> {
    const pending = this.persistQueues.get(runId);
    if (pending !== undefined) {
      await pending;
    }
  }

  private assertRunning(): void {
    if (this.shuttingDown) {
      throw new RunOrchestratorError(
        RUN_ORCHESTRATOR_ERROR_CODES.NOT_LIVE,
        'The server is shutting down and cannot start or change runs.',
      );
    }
  }

  private assertLegacyManagedCoordination(protocol: unknown, claim: unknown): void {
    if (protocol !== null || claim !== null) {
      throw new RunOrchestratorError(
        RUN_ORCHESTRATOR_ERROR_CODES.COORDINATION_REQUIRED,
        'Managed execution is not yet available for a coordinated project. Review the project before proceeding.',
      );
    }
  }

  private handleRunnerEvent(runId: string, event: OrchestratedRunEvent): void {
    const entry = this.liveRuns.get(runId);
    if (entry !== undefined) {
      this.runLocations.set(runId, entry.projectPath);
    }
    this.broadcast(runId, event);
    if (isFinalRunStatus(event.run.status) && event.type !== 'disposed' &&
        !this.finalizationQueues.has(runId)) {
      void this.finalizeRunAsync(runId).catch(() => {
        console.error(`Skill Loom could not finish cleanup for run ${runId}; stop the service to retry.`);
      });
    }
  }

  private broadcast(runId: string, event: OrchestratedRunEvent): void {
    const seq = (this.sequences.get(runId) ?? 0) + 1;
    this.sequences.set(runId, seq);

    const delta: RunStreamDelta = {
      type: event.type,
      runId,
      sequence: seq,
      run: event.run,
      stepIndex: event.stepIndex,
      stepId: event.stepId,
      terminalId: event.terminalId,
      actions: this.availableActions(event.run),
      ...(event.exitCode === undefined ? {} : { exitCode: event.exitCode }),
      ...(event.observation === undefined ? {} : { observation: event.observation }),
      ...(event.reason === undefined ? {} : { reason: event.reason }),
      ...(event.chunk === undefined ? {} : { chunk: event.chunk }),
      ...('permissions' in event && event.permissions !== undefined
        ? { permissions: event.permissions }
        : {}),
    };

    const subscribers = this.subscribers.get(runId);
    if (subscribers === undefined) {
      return;
    }

    for (const subscription of [...subscribers]) {
      if (!subscription.ready) {
        subscription.buffer.push(delta);
        if (subscription.buffer.length > this.reconnectBufferSize) {
          subscription.buffer.shift();
        }
        continue;
      }
      sendSafely(subscription.listener, delta);
    }
  }

  private availableActions(run: Run): RunActionAvailability {
    const recovery = this.recoveryFor(run);
    if (recovery !== null) {
      return {
        next: false,
        retry: recovery.retry,
        skip: false,
        abort: false,
        pause: false,
        resume: false,
        runNext: false,
        done: false,
        failed: false,
        continue: recovery.continue,
        restart: recovery.restart,
      };
    }

    const entry = this.liveRuns.get(run.id);
    if (entry === undefined || isFinalRunStatus(run.status)) {
      return emptyActions();
    }

    if (entry.mode === 'supervised') {
      const state = entry.runner.state;
      const canOutcome = state.currentStepStatus === 'running';
      return {
        next: state.canNext,
        retry: state.canRetry,
        skip: state.canSkip,
        abort: state.canAbort,
        pause: false,
        resume: false,
        runNext: false,
        done: canOutcome,
        failed: canOutcome,
        continue: false,
        restart: false,
      };
    }

    const state = entry.runner.state;
    return {
      next: state.canRunNext,
      retry: state.canRetry,
      skip: state.canSkip,
      abort: state.canAbort,
      pause: state.canPause,
      resume: run.status === 'paused',
      runNext: state.canRunNext,
      done: false,
      failed: false,
      continue: false,
      restart: false,
    };
  }

  private recoveryFor(run: Run): RunRecoveryOptions | null {
    if (run.status !== 'interrupted') {
      return null;
    }
    const step = run.steps[run.currentStepIndex];
    return {
      retry: step?.status === 'interrupted',
      continue: findNextPendingIndex(run) !== null,
      restart: true,
    };
  }

  private activeState(run: Run): RunActiveState {
    return {
      active: true,
      runId: run.id,
      status: run.status,
      run,
      terminalId: this.liveTerminalId(run.id),
      actions: this.availableActions(run),
      recovery: this.recoveryFor(run),
    };
  }

  private liveTerminalId(runId: string): string | null {
    const entry = this.liveRuns.get(runId);
    if (entry === undefined) {
      return null;
    }
    if (entry.mode === 'supervised') {
      return entry.terminalId;
    }
    return entry.runner.state.surface === 'pty' ? entry.terminalId : null;
  }

  private finalizeRunAsync(runId: string): Promise<void> {
    const pending = this.finalizationQueues.get(runId);
    if (pending !== undefined) return pending;
    const entry = this.liveRuns.get(runId);
    if (entry === undefined || this.finalized.has(runId)) return Promise.resolve();

    const finalizing = (async () => {
      await entry.runner.shutdown();
      this.options.terminalManager.closeSession(entry.terminalId);
      this.finalized.add(runId);
      this.liveRuns.delete(runId);
    })();
    this.finalizationQueues.set(runId, finalizing);
    void finalizing.then(
      () => { if (this.finalizationQueues.get(runId) === finalizing) this.finalizationQueues.delete(runId); },
      () => { if (this.finalizationQueues.get(runId) === finalizing) this.finalizationQueues.delete(runId); },
    );
    return finalizing;
  }

  private async failStartingRun(store: RunStore, runId: string): Promise<void> {
    const latest = await store.read(runId);
    if (!isActiveRunStatus(latest.status)) {
      return;
    }

    const timestamp = this.timestamp();
    const failed: Run = {
      ...structuredClone(latest),
      status: 'failed',
      updatedAt: timestamp,
      finishedAt: timestamp,
      reason: truncateReason('START_FAILED'),
    };
    await store.update(failed);
  }

  private assertActionAllowed(
    action: string,
    mode: RunMode,
    supported: ReadonlySet<string>,
  ): void {
    if (supported.has(action)) {
      return;
    }
    throw new RunOrchestratorError(
      RUN_ORCHESTRATOR_ERROR_CODES.ACTION_MODE_MISMATCH,
      `The "${action}" action is not available for a ${mode} run.`,
      {
        action,
        mode,
        supported: [...supported],
      },
    );
  }

  private async assertNoActiveRun(excludeRunId?: string): Promise<void> {
    for (const [runId, entry] of this.liveRuns) {
      if (excludeRunId !== undefined && runId === excludeRunId) {
        continue;
      }
      const live = entry.runner.getRun();
      throw new RunOrchestratorError(
        RUN_ORCHESTRATOR_ERROR_CODES.ACTIVE_CONFLICT,
        isActiveRunStatus(live.status)
          ? 'Another run is already active.'
          : 'A previous run has not finished cleanup. Stop the service to retry cleanup.',
        {
          runId: live.id,
          projectId: live.projectId,
          status: live.status,
        },
      );
    }

    const pointer = await this.readPointerOrNull();
    if (pointer === null) {
      return;
    }
    if (excludeRunId !== undefined && pointer.runId === excludeRunId) {
      return;
    }

    const run = await this.tryReadPointerRun(pointer);
    if (run !== null && isActiveRunStatus(run.status)) {
      throw new RunOrchestratorError(
        RUN_ORCHESTRATOR_ERROR_CODES.ACTIVE_CONFLICT,
        'Another run is already active.',
        {
          runId: run.id,
          projectId: run.projectId,
          status: run.status,
        },
      );
    }
    await withProjectClaimTransaction(pointer.projectPath, async (tx) => {
      this.assertLegacyManagedCoordination(tx.protocol(), tx.read());
    });
  }

  private conflictFromStoreError(error: RunStoreError): RunOrchestratorError {
    return new RunOrchestratorError(
      RUN_ORCHESTRATOR_ERROR_CODES.ACTIVE_CONFLICT,
      'Another run is already active.',
      { ...error.details },
      { cause: error },
    );
  }

  private async resolveProjectPath(projectId: string): Promise<string> {
    if (!isProjectIdString(projectId)) {
      throw new RunOrchestratorError(
        RUN_ORCHESTRATOR_ERROR_CODES.PROJECT_ID_INVALID,
        'The project id is not valid.',
        { projectId },
      );
    }

    const project = await this.options.projectRegistry.findRecentProject(projectId);
    if (project === undefined) {
      throw new RunOrchestratorError(
        RUN_ORCHESTRATOR_ERROR_CODES.PROJECT_NOT_FOUND,
        'No registered project matches that id.',
        { projectId },
      );
    }
    return project.canonicalPath;
  }

  private async locateRun(
    runId: string,
  ): Promise<{ run: Run; projectPath: string }> {
    assertSafeRunId(runId);

    const known = this.runLocations.get(runId);
    if (known !== undefined) {
      const run = await this.tryReadRun(known, runId);
      if (run !== null) {
        return { run, projectPath: known };
      }
      this.runLocations.delete(runId);
    }

    const pointer = await this.readPointerOrNull();
    if (pointer !== null && pointer.runId === runId) {
      const run = await this.tryReadPointerRun(pointer);
      if (run !== null) {
        this.runLocations.set(runId, pointer.projectPath);
        return { run, projectPath: pointer.projectPath };
      }
    }

    let firstError: unknown;
    const projects = await this.options.projectRegistry.listKnownProjects();
    for (const project of projects) {
      try {
        const run = await this.storeFor(project.canonicalPath).read(runId);
        this.runLocations.set(runId, project.canonicalPath);
        return { run, projectPath: project.canonicalPath };
      } catch (error) {
        if (isRecoverableLocationError(error)) {
          continue;
        }
        firstError ??= error;
      }
    }

    if (firstError !== undefined) {
      throw firstError;
    }
    throw new RunOrchestratorError(
      RUN_ORCHESTRATOR_ERROR_CODES.RUN_NOT_FOUND,
      'No run matches that id.',
      { runId },
    );
  }

  private async tryReadRun(projectPath: string, runId: string): Promise<Run | null> {
    if (!isSafeRunIdString(runId)) {
      return null;
    }
    try {
      return await this.storeFor(projectPath).read(runId);
    } catch (error) {
      if (isRecoverableLocationError(error)) {
        return null;
      }
      throw error;
    }
  }

  private async tryReadPointerRun(pointer: ActiveRunPointer): Promise<Run | null> {
    try {
      return await this.storeFor(pointer.projectPath).read(pointer.runId);
    } catch (error) {
      if (isRunStoreCode(error, RUN_STORE_ERROR_CODES.NOT_FOUND) ||
          isRunStoreCode(error, RUN_STORE_ERROR_CODES.PROJECT_NOT_FOUND)) {
        return null;
      }
      throw error;
    }
  }

  private async readPointerOrNull(): Promise<ActiveRunPointer | null> {
    return readActiveRunPointerFile({ configDirectory: this.options.configDirectory });
  }

  private async clearPointerQuietly(): Promise<boolean> {
    try {
      return await clearActiveRunPointerFile({
        configDirectory: this.options.configDirectory,
      });
    } catch {
      return false;
    }
  }

  private storeFor(projectPath: string): RunStore {
    const existing = this.stores.get(projectPath);
    if (existing !== undefined) {
      return existing;
    }
    const store =
      this.options.runStoreFor?.(projectPath) ??
      createRunStore({
        projectPath,
        configDirectory: this.options.configDirectory,
        ...(this.options.now === undefined ? {} : { now: this.options.now }),
      });
    this.stores.set(projectPath, store);
    return store;
  }

  private async harnessRegistry(): Promise<HarnessRegistry> {
    this.registryPromise ??= Promise.resolve(
      typeof this.options.harnessRegistry === 'function'
        ? this.options.harnessRegistry()
        : this.options.harnessRegistry,
    );
    return this.registryPromise;
  }

  private async preflightEngine(): Promise<PreflightEngine> {
    this.enginePromise ??= Promise.resolve(
      typeof this.options.preflightEngine === 'function'
        ? this.options.preflightEngine()
        : this.options.preflightEngine,
    );
    return this.enginePromise;
  }

  private currentRun(runId: string): Run | null {
    const entry = this.liveRuns.get(runId);
    return entry?.runner.getRun() ?? null;
  }

  private now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }

  private timestamp(): string {
    return toTimestamp(this.now());
  }
}

export function createRunOrchestrator(
  options: RunOrchestratorOptions,
): RunOrchestrator {
  return new RunOrchestratorService(options);
}

/* ------------------------------------------------------------------ */
/* Production PTY and process surfaces                                 */
/* ------------------------------------------------------------------ */

function createManagedSupervisedPty(
  terminalManager: TerminalManager,
  context: RunSupervisedPtyContext,
): SupervisedPty {
  let current: TerminalSession | null = null;

  const closeCurrent = (): void => {
    if (current === null) {
      return;
    }
    current = null;
    terminalManager.closeSession(context.terminalId);
  };

  return {
    id: context.terminalId,
    spawn(spec): SupervisedPtyProcess {
      // A step never reuses a live TUI. Closing the previous session frees the
      // stable terminal id before the next child is created.
      closeCurrent();
      const session = terminalManager.createSession(
        {
          executable: spec.executable,
          args: [...spec.args],
          cwd: spec.cwd,
          cols: spec.cols,
          rows: spec.rows,
        },
        { id: context.terminalId },
      );
      current = session;
      return wrapTerminalSession(session);
    },
    close(): void {
      closeCurrent();
    },
  };
}

function wrapTerminalSession(session: TerminalSession): SupervisedPtyProcess {
  return {
    pid: session.pid,
    onData(listener) {
      return session.onData(listener);
    },
    onExit(listener) {
      return session.onExit(listener);
    },
    write(data) {
      session.write(data);
    },
    kill(signal) {
      session.kill(signal);
    },
    isRunning() {
      return session.isRunning();
    },
    getExit() {
      return session.getExit();
    },
  };
}

function createManagedAutomaticSpawner(
  terminalManager: TerminalManager,
  context: RunAutomaticSpawnerContext,
): AutomaticSpawner {
  let current: TerminalSession | null = null;

  const closePty = (): void => {
    if (current === null) {
      return;
    }
    current = null;
    terminalManager.closeSession(context.terminalId);
  };

  return (spec: AutomaticSpawnSpec): AutomaticProcess => {
    if (spec.surface === 'pty') {
      closePty();
      const session = terminalManager.createSession(
        {
          executable: spec.executable,
          args: [...spec.args],
          cwd: spec.cwd,
          cols: spec.cols,
          rows: spec.rows,
        },
        { id: context.terminalId },
      );
      current = session;
      return wrapTerminalSession(session);
    }

    return createChildProcessAdapter(spec);
  };
}

/**
 * Process-exit surface used by adapters whose declared advancement is a
 * headless process exit. The executable and argument array are passed to
 * `spawn` with `shell: false`; no user text is ever interpreted by a shell.
 */
function createChildProcessAdapter(spec: AutomaticSpawnSpec): AutomaticProcess {
  const dataListeners = new Set<(chunk: string) => void>();
  const exitListeners = new Set<(event: TerminalExit) => void>();
  let dataSubscribed = false;
  let buffered = '';
  let exitEvent: TerminalExit | null = null;

  const child: ChildProcess = spawnChild(spec.executable, [...spec.args], {
    cwd: spec.cwd,
    env: process.env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const append = (chunk: string): void => {
    if (chunk === '') {
      return;
    }
    if (dataSubscribed) {
      for (const listener of [...dataListeners]) {
        listener(chunk);
      }
      return;
    }
    buffered += chunk;
    if (Buffer.byteLength(buffered, 'utf8') > MAX_PROCESS_BUFFER_BYTES) {
      buffered = trimTail(buffered);
    }
  };

  child.stdout?.on('data', (chunk: Buffer | string) => {
    append(chunk.toString());
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    append(chunk.toString());
  });

  const finish = (event: TerminalExit): void => {
    if (exitEvent !== null) {
      return;
    }
    exitEvent = event;
    for (const listener of [...exitListeners]) {
      listener(event);
    }
    exitListeners.clear();
  };

  child.once('error', () => {
    finish({ exitCode: -1 });
  });
  child.once('exit', (code) => {
    finish({ exitCode: code ?? -1 });
  });

  return {
    pid: child.pid ?? -1,
    onData(listener) {
      dataListeners.add(listener);
      if (!dataSubscribed) {
        dataSubscribed = true;
        const pending = buffered;
        buffered = '';
        if (pending !== '') {
          listener(pending);
        }
      }
      return () => {
        dataListeners.delete(listener);
      };
    },
    onExit(listener) {
      if (exitEvent !== null) {
        const event = exitEvent;
        queueMicrotask(() => listener(event));
        return () => undefined;
      }
      exitListeners.add(listener);
      return () => {
        exitListeners.delete(listener);
      };
    },
    kill(signal) {
      try {
        child.kill(signal as NodeJS.Signals | undefined);
      } catch {
        // A process that exits between the check and the kill is already gone.
      }
    },
    isRunning() {
      return exitEvent === null;
    },
    getExit() {
      return exitEvent;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function resumedRun(
  run: Run,
  now: Date,
  targetIndex: number,
  mode: 'retry' | 'continue',
): Run {
  const timestamp = toTimestamp(now);
  const next = structuredClone(run);
  next.status = 'starting';
  next.updatedAt = timestamp;
  next.finishedAt = null;
  next.reason = null;
  next.currentStepIndex = targetIndex;

  if (mode === 'retry') {
    const step = next.steps[targetIndex];
    if (step !== undefined) {
      resetStepForRetry(step);
    }
  }

  return next;
}

function resetStepForRetry(step: RunStepRecord): void {
  step.status = 'pending';
  step.startedAt = null;
  step.finishedAt = null;
  step.exitCode = null;
  step.tail = '';
  step.reason = null;
  step.skillObservation = 'unknown';
}

function findNextPendingIndex(run: Run): number | null {
  const current = run.steps[run.currentStepIndex];
  const start = current?.status === 'pending' ? run.currentStepIndex : run.currentStepIndex + 1;
  for (let index = start; index < run.steps.length; index += 1) {
    if (run.steps[index]?.status === 'pending') {
      return index;
    }
  }
  return null;
}

function emptyActions(): RunActionAvailability {
  return {
    next: false,
    retry: false,
    skip: false,
    abort: false,
    pause: false,
    resume: false,
    runNext: false,
    done: false,
    failed: false,
    continue: false,
    restart: false,
  };
}

function normalizeRunMode(value: string): RunMode {
  if (value === 'supervised' || value === 'automatic') {
    return value;
  }
  throw new RunOrchestratorError(
    RUN_ORCHESTRATOR_ERROR_CODES.MODE_INVALID,
    'The run mode is not valid.',
    { field: 'mode', value },
  );
}

function assertActionName(value: unknown): RunActionName {
  if (typeof value !== 'string' || !(RUN_ACTIONS as readonly string[]).includes(value)) {
    throw new RunOrchestratorError(
      RUN_ORCHESTRATOR_ERROR_CODES.ACTION_INVALID,
      'The run action is not recognized.',
      {
        action: typeof value === 'string' ? value : typeof value,
        supported: [...RUN_ACTIONS],
      },
    );
  }
  return value as RunActionName;
}

function assertSafeRunId(value: unknown): asserts value is string {
  if (!isSafeRunIdString(value)) {
    throw new RunOrchestratorError(
      RUN_ORCHESTRATOR_ERROR_CODES.RUN_ID_INVALID,
      'The run id is not valid.',
      { runId: typeof value === 'string' ? value : typeof value },
    );
  }
}

function isSafeRunIdString(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
}

function isProjectIdString(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,31}-[0-9a-f]{12}$/.test(value);
}

function isRunStoreCode(error: unknown, code: string): error is RunStoreError {
  return error instanceof RunStoreError && error.code === code;
}

function isRecoverableRecoveryError(error: unknown): boolean {
  if (!(error instanceof RunStoreError)) {
    return false;
  }
  return (
    error.code === RUN_STORE_ERROR_CODES.PROJECT_NOT_FOUND ||
    error.code === RUN_STORE_ERROR_CODES.PROJECT_INVALID ||
    error.code === RUN_STORE_ERROR_CODES.PROJECT_NOT_DIRECTORY ||
    error.code === RUN_STORE_ERROR_CODES.PROJECT_UNREADABLE ||
    error.code === RUN_STORE_ERROR_CODES.STORE_SETUP_FAILED ||
    error.code === RUN_STORE_ERROR_CODES.PATH_ESCAPED
  );
}

function isRecoverableLocationError(error: unknown): boolean {
  if (!(error instanceof RunStoreError)) {
    return false;
  }
  return (
    error.code === RUN_STORE_ERROR_CODES.NOT_FOUND ||
    error.code === RUN_STORE_ERROR_CODES.PROJECT_NOT_FOUND ||
    error.code === RUN_STORE_ERROR_CODES.PROJECT_INVALID ||
    error.code === RUN_STORE_ERROR_CODES.PROJECT_NOT_DIRECTORY ||
    error.code === RUN_STORE_ERROR_CODES.READ_FAILED ||
    error.code === RUN_STORE_ERROR_CODES.FILE_CORRUPT ||
    error.code === RUN_STORE_ERROR_CODES.FILE_UNREADABLE ||
    error.code === RUN_STORE_ERROR_CODES.FILE_ID_MISMATCH ||
    error.code === RUN_STORE_ERROR_CODES.UNSUPPORTED_VERSION
  );
}

function sendSafely(
  listener: (message: RunStreamMessage) => void,
  message: RunStreamMessage,
): void {
  try {
    listener(message);
  } catch {
    // A dropped WebSocket must never interrupt run state or other subscribers.
  }
}

function errorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }
  return 'UNKNOWN';
}

/** Re-exported so route code can keep one import for run contracts. */
export type { PreflightReport, RunStatus, RunStoreWarning };
