import {
  ApiClientError,
  requestJson,
  type FetchLike,
  type RequestJsonOptions,
} from './client';

/**
 * Typed client for the run record, run actions, and the run event stream.
 *
 * The browser never starts a run and never spawns a harness. It reads the run
 * snapshot, sends one explicit action at a time, and renders the terminal
 * through xterm.js. Every decoded value is validated before it reaches a
 * component, and a failed request is always a typed `ApiClientError`.
 */

export const RUN_MODES = ['supervised', 'automatic'] as const;
export type RunMode = (typeof RUN_MODES)[number];

export const RUN_STATUSES = [
  'starting',
  'running',
  'awaiting-user',
  'paused',
  'failed',
  'completed',
  'aborted',
  'interrupted',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const STEP_STATUSES = [
  'pending',
  'running',
  'done',
  'failed',
  'skipped',
  'interrupted',
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const SKILL_OBSERVATION_STATES = [
  'unknown',
  'not-observable',
  'observed',
  'not-observed',
] as const;
export type SkillObservationState = (typeof SKILL_OBSERVATION_STATES)[number];

export const RUN_FORK_MECHANISMS = ['none', 'native', 'handoff'] as const;
export type RunForkMechanism = (typeof RUN_FORK_MECHANISMS)[number];

export const RUN_HARNESSES = ['opencode', 'copilot'] as const;
export type RunHarness = (typeof RUN_HARNESSES)[number];

export const RUN_SESSION_MODES = ['shared', 'fresh', 'fork'] as const;
export type RunSessionMode = (typeof RUN_SESSION_MODES)[number];

/** One step inside the frozen chain snapshot. */
export interface RunChainStep {
  id: string;
  skillName: string;
  instruction: string;
  label?: string;
}

/** The parts of the frozen chain the run view displays. */
export interface RunChainSnapshot {
  name: string;
  harness: RunHarness;
  sessionMode: RunSessionMode;
  steps: RunChainStep[];
}

/** One persisted step record. `tail` is bounded display text, not a transcript. */
export interface RunStep {
  id: string;
  index: number;
  skillName: string;
  label: string | null;
  status: StepStatus;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  sessionId: string | null;
  forkMechanism: RunForkMechanism;
  skillObservation: SkillObservationState;
  tail: string;
  reason: string | null;
}

/** The run document the server returns. */
export interface Run {
  version: number;
  id: string;
  projectId: string;
  chainId: string;
  harness: RunHarness;
  mode: RunMode;
  sessionMode: RunSessionMode;
  chainSnapshot: RunChainSnapshot;
  resolvedInputs: Record<string, string>;
  status: RunStatus;
  currentStepIndex: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  sessionId: string | null;
  forkMechanism: RunForkMechanism;
  steps: RunStep[];
  reason: string | null;
}

/** Action flags published with the run snapshot. */
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

/** `GET /api/runs/:runId`. */
export interface RunView {
  run: Run;
  projectPath: string;
  terminalId: string | null;
  actions: RunActionAvailability;
  recovery: RunRecoveryOptions | null;
}

/** `POST /api/runs/:runId/actions`. */
export interface RunActionResultView {
  run: Run;
  terminalId: string | null;
  actions: RunActionAvailability;
  recovery: RunRecoveryOptions | null;
  restartedFrom: string | null;
}

export interface RunStreamSnapshot {
  type: 'snapshot';
  runId: string;
  sequence: number;
  run: Run;
  terminalId: string | null;
  actions: RunActionAvailability;
  recovery: RunRecoveryOptions | null;
}

export const RUN_STREAM_DELTA_TYPES = [
  'started',
  'step-started',
  'output',
  'process-exit',
  'signal',
  'timeout',
  'awaiting-user',
  'step-done',
  'step-failed',
  'step-skipped',
  'step-advanced',
  'run-paused',
  'run-resumed',
  'run-completed',
  'run-aborted',
  'run-failed',
  'disposed',
] as const;
export type RunStreamDeltaType = (typeof RUN_STREAM_DELTA_TYPES)[number];

export interface RunStreamDelta {
  type: RunStreamDeltaType;
  runId: string;
  sequence: number;
  run: Run;
  stepIndex: number;
  stepId: string | null;
  terminalId: string | null;
  actions: RunActionAvailability;
  exitCode?: number | null;
  observation?: SkillObservationState;
  reason?: string | null;
  chunk?: string;
}

export interface RunStreamError {
  type: 'error';
  code: string;
  message: string;
}

export type RunStreamServerMessage = RunStreamSnapshot | RunStreamDelta | RunStreamError;

export interface RunRequestOptions {
  signal?: AbortSignal;
}

export const RUN_ACTION_NAMES = [
  'next',
  'retry',
  'skip',
  'abort',
  'pause',
  'resume',
  'run-next',
  'done',
  'failed',
  'skipped',
  'continue',
  'restart',
] as const;
export type RunActionName = (typeof RUN_ACTION_NAMES)[number];

export interface RunsApi {
  getRun: (runId: string, options?: RunRequestOptions) => Promise<RunView>;
  applyAction: (
    runId: string,
    action: RunActionName,
    reason?: string,
    options?: RunRequestOptions,
  ) => Promise<RunActionResultView>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function invalidResponse(what: string): ApiClientError {
  return new ApiClientError(
    `The Slan server returned an unexpected ${what} response.`,
    { code: 'INVALID_RESPONSE', status: 200 },
  );
}

function decodeEnum<T extends string>(
  value: unknown,
  supported: readonly T[],
  what: string,
): T {
  if (typeof value === 'string' && (supported as readonly string[]).includes(value)) {
    return value as T;
  }
  throw invalidResponse(what);
}

function decodeNullableString(value: unknown, what: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw invalidResponse(what);
  }
  return value;
}

function decodeNullableNumber(value: unknown, what: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidResponse(what);
  }
  return value;
}

function decodeChainStep(value: unknown): RunChainStep {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.skillName) ||
    typeof value.instruction !== 'string'
  ) {
    throw invalidResponse('run chain step');
  }

  const label = typeof value.label === 'string' ? value.label : undefined;
  return {
    id: value.id,
    skillName: value.skillName,
    instruction: value.instruction,
    ...(label === undefined ? {} : { label }),
  };
}

function decodeChainSnapshot(value: unknown): RunChainSnapshot {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.name) ||
    !Array.isArray(value.steps)
  ) {
    throw invalidResponse('run chain snapshot');
  }

  return {
    name: value.name,
    harness: decodeEnum(value.harness, RUN_HARNESSES, 'run harness'),
    sessionMode: decodeEnum(value.sessionMode, RUN_SESSION_MODES, 'run session mode'),
    steps: value.steps.map(decodeChainStep),
  };
}

function decodeStep(value: unknown): RunStep {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    typeof value.index !== 'number' ||
    !isNonEmptyString(value.skillName) ||
    typeof value.tail !== 'string'
  ) {
    throw invalidResponse('run step');
  }

  return {
    id: value.id,
    index: value.index,
    skillName: value.skillName,
    label: decodeNullableString(value.label, 'run step label'),
    status: decodeEnum(value.status, STEP_STATUSES, 'run step status'),
    startedAt: decodeNullableString(value.startedAt, 'run step started time'),
    finishedAt: decodeNullableString(value.finishedAt, 'run step finished time'),
    exitCode: decodeNullableNumber(value.exitCode, 'run step exit code'),
    sessionId: decodeNullableString(value.sessionId, 'run step session id'),
    forkMechanism: decodeEnum(value.forkMechanism, RUN_FORK_MECHANISMS, 'run step fork mechanism'),
    skillObservation: decodeEnum(
      value.skillObservation,
      SKILL_OBSERVATION_STATES,
      'run step skill observation',
    ),
    tail: value.tail,
    reason: decodeNullableString(value.reason, 'run step reason'),
  };
}

function decodeResolvedInputs(value: unknown): Record<string, string> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw invalidResponse('run resolved inputs');
  }

  const resolved: Record<string, string> = {};
  for (const [name, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') {
      throw invalidResponse('run resolved input value');
    }
    resolved[name] = entry;
  }
  return resolved;
}

function decodeRun(value: unknown): Run {
  if (
    !isRecord(value) ||
    typeof value.version !== 'number' ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.projectId) ||
    !isNonEmptyString(value.chainId) ||
    !Array.isArray(value.steps) ||
    typeof value.currentStepIndex !== 'number' ||
    !isNonEmptyString(value.createdAt) ||
    !isNonEmptyString(value.updatedAt)
  ) {
    throw invalidResponse('run');
  }

  return {
    version: value.version,
    id: value.id,
    projectId: value.projectId,
    chainId: value.chainId,
    harness: decodeEnum(value.harness, RUN_HARNESSES, 'run harness'),
    mode: decodeEnum(value.mode, RUN_MODES, 'run mode'),
    sessionMode: decodeEnum(value.sessionMode, RUN_SESSION_MODES, 'run session mode'),
    chainSnapshot: decodeChainSnapshot(value.chainSnapshot),
    resolvedInputs: decodeResolvedInputs(value.resolvedInputs),
    status: decodeEnum(value.status, RUN_STATUSES, 'run status'),
    currentStepIndex: value.currentStepIndex,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    startedAt: decodeNullableString(value.startedAt, 'run started time'),
    finishedAt: decodeNullableString(value.finishedAt, 'run finished time'),
    sessionId: decodeNullableString(value.sessionId, 'run session id'),
    forkMechanism: decodeEnum(value.forkMechanism, RUN_FORK_MECHANISMS, 'run fork mechanism'),
    steps: value.steps.map(decodeStep),
    reason: decodeNullableString(value.reason, 'run reason'),
  };
}

function decodeActions(value: unknown): RunActionAvailability {
  if (!isRecord(value)) {
    throw invalidResponse('run actions');
  }

  const flags: Array<keyof RunActionAvailability> = [
    'next',
    'retry',
    'skip',
    'abort',
    'pause',
    'resume',
    'runNext',
    'done',
    'failed',
    'continue',
    'restart',
  ];
  const decoded = {} as RunActionAvailability;
  for (const flag of flags) {
    if (typeof value[flag] !== 'boolean') {
      throw invalidResponse('run action flag');
    }
    decoded[flag] = value[flag];
  }
  return decoded;
}

function decodeRecovery(value: unknown): RunRecoveryOptions | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    !isRecord(value) ||
    typeof value.retry !== 'boolean' ||
    typeof value.continue !== 'boolean' ||
    typeof value.restart !== 'boolean'
  ) {
    throw invalidResponse('run recovery options');
  }
  return { retry: value.retry, continue: value.continue, restart: value.restart };
}

function decodeView(value: unknown): RunView {
  if (!isRecord(value) || !isNonEmptyString(value.projectPath)) {
    throw invalidResponse('run view');
  }
  return {
    run: decodeRun(value.run),
    projectPath: value.projectPath,
    terminalId: decodeNullableString(value.terminalId, 'run terminal id'),
    actions: decodeActions(value.actions),
    recovery: decodeRecovery(value.recovery),
  };
}

function decodeActionResult(value: unknown): RunActionResultView {
  if (!isRecord(value)) {
    throw invalidResponse('run action result');
  }
  return {
    run: decodeRun(value.run),
    terminalId: decodeNullableString(value.terminalId, 'run terminal id'),
    actions: decodeActions(value.actions),
    recovery: decodeRecovery(value.recovery),
    restartedFrom: decodeNullableString(value.restartedFrom, 'restarted run id'),
  };
}

export function runEventsPath(runId: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/events`;
}

export function runTerminalPath(terminalId: string): string {
  return `/api/terminal/${encodeURIComponent(terminalId)}`;
}

/** Decode one run event-stream frame. Unknown frames are ignored, never rendered. */
export function decodeRunStreamMessage(value: unknown): RunStreamServerMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null;
  }

  if (value.type === 'error') {
    if (!isNonEmptyString(value.code) || typeof value.message !== 'string') {
      return null;
    }
    return { type: 'error', code: value.code, message: value.message };
  }

  if (typeof value.sequence !== 'number' || !isNonEmptyString(value.runId)) {
    return null;
  }

  if (value.type === 'snapshot') {
    return {
      type: 'snapshot',
      runId: value.runId,
      sequence: value.sequence,
      run: decodeRun(value.run),
      terminalId: decodeNullableString(value.terminalId, 'stream terminal id'),
      actions: decodeActions(value.actions),
      recovery: decodeRecovery(value.recovery),
    };
  }

  if (typeof value.stepIndex !== 'number') {
    return null;
  }

  if (!(RUN_STREAM_DELTA_TYPES as readonly string[]).includes(value.type)) {
    return null;
  }

  return {
    type: value.type as RunStreamDeltaType,
    runId: value.runId,
    sequence: value.sequence,
    run: decodeRun(value.run),
    stepIndex: value.stepIndex,
    stepId: decodeNullableString(value.stepId, 'stream step id'),
    terminalId: decodeNullableString(value.terminalId, 'stream terminal id'),
    actions: decodeActions(value.actions),
    ...(typeof value.exitCode === 'number' || value.exitCode === null
      ? { exitCode: value.exitCode }
      : {}),
    ...(typeof value.observation === 'string' &&
    (SKILL_OBSERVATION_STATES as readonly string[]).includes(value.observation)
      ? { observation: value.observation as SkillObservationState }
      : {}),
    ...(typeof value.reason === 'string' || value.reason === null
      ? { reason: value.reason }
      : {}),
    ...(typeof value.chunk === 'string' ? { chunk: value.chunk } : {}),
  };
}

function optionsFor(signal: AbortSignal | undefined): RequestJsonOptions {
  return signal === undefined ? {} : { signal };
}

export function createRunsApi(fetchImpl: FetchLike = fetch): RunsApi {
  return {
    async getRun(runId, options = {}): Promise<RunView> {
      const value = await requestJson<unknown>(
        `/api/runs/${encodeURIComponent(runId)}`,
        optionsFor(options.signal),
        fetchImpl,
      );
      return decodeView(value);
    },

    async applyAction(runId, action, reason, options = {}): Promise<RunActionResultView> {
      const body: Record<string, unknown> = { action };
      if (reason !== undefined && reason.trim() !== '') {
        body.reason = reason;
      }
      const value = await requestJson<unknown>(
        `/api/runs/${encodeURIComponent(runId)}/actions`,
        {
          method: 'POST',
          body,
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      return decodeActionResult(value);
    },
  };
}

/** Same-origin client; Vite proxies /api in development. */
export const runsApi = createRunsApi();
