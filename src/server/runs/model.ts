import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ChainSchema,
  ChainSessionModeSchema,
  parseChain,
  type Chain,
} from '../chains/model.js';
import { HARNESS_IDS } from '../config/schema.js';

/**
 * Current on-disk run version.
 *
 * A run is a versioned JSON document like a chain. An unknown version is
 * rejected rather than reinterpreted, and an unversioned run is treated as a
 * pre-versioning draft and stamped with the current version.
 */
export const RUN_VERSION = 1;

/** A run is either fully user-driven or advanced by the adapter signal. */
export const RUN_MODES = ['supervised', 'automatic'] as const;
export const RunModeSchema = z.enum(RUN_MODES);
export type RunMode = z.infer<typeof RunModeSchema>;

/**
 * Lifecycle states from PRD 10.5. Only four of them own the global active-run
 * pointer: `starting`, `running`, `paused`, and `awaiting-user`. `failed` is a
 * terminal record that offers recovery actions but no longer blocks a start.
 */
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
export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatusSchema>;

/** Statuses that hold the one global active-run slot (EXEC-03). */
export const ACTIVE_RUN_STATUSES = [
  'starting',
  'running',
  'paused',
  'awaiting-user',
] as const;
export type ActiveRunStatus = (typeof ACTIVE_RUN_STATUSES)[number];

/** Statuses that must never block a later start. */
export const FINAL_RUN_STATUSES = ['failed', 'completed', 'aborted', 'interrupted'] as const;
export type FinalRunStatus = (typeof FINAL_RUN_STATUSES)[number];

/** Per-step lifecycle from PRD 10.6. */
export const STEP_STATUSES = [
  'pending',
  'running',
  'done',
  'failed',
  'skipped',
  'interrupted',
] as const;
export const StepStatusSchema = z.enum(STEP_STATUSES);
export type StepStatus = z.infer<typeof StepStatusSchema>;

/**
 * Fork mechanism recorded on a run and each step. `handoff` is explicitly not
 * a native fork: it starts a new session seeded with a bounded handoff note.
 */
export const RUN_FORK_MECHANISMS = ['none', 'native', 'handoff'] as const;
export const RunForkMechanismSchema = z.enum(RUN_FORK_MECHANISMS);
export type RunForkMechanism = z.infer<typeof RunForkMechanismSchema>;

/**
 * Best-effort skill observation state (RUN-FR-10). It is informational and
 * must never be used to block or fail a step.
 */
export const SKILL_OBSERVATION_STATES = [
  'unknown',
  'not-observable',
  'observed',
  'not-observed',
] as const;
export const SkillObservationStateSchema = z.enum(SKILL_OBSERVATION_STATES);
export type SkillObservationState = z.infer<typeof SkillObservationStateSchema>;

/** Bounded terminal tail limits shared with the PTY transport (PRIV-01). */
export const MAX_TAIL_LINES = 200;
export const MAX_TAIL_BYTES = 32 * 1024;

/**
 * Every free-text field on a run is bounded. A run document is not a
 * transcript, and no field may grow without a limit.
 */
export const MAX_RUN_REASON_LENGTH = 2_000;

/** Top-level fields written to disk, in stable document order. */
export const RUN_TOP_LEVEL_FIELDS = [
  'version',
  'id',
  'projectId',
  'chainId',
  'harness',
  'mode',
  'sessionMode',
  'chainSnapshot',
  'resolvedInputs',
  'status',
  'currentStepIndex',
  'createdAt',
  'updatedAt',
  'startedAt',
  'finishedAt',
  'sessionId',
  'forkMechanism',
  'steps',
  'reason',
] as const;

/** Top-level fields of one step record, in stable document order. */
export const RUN_STEP_FIELDS = [
  'id',
  'index',
  'kind',
  'skillName',
  'label',
  'status',
  'startedAt',
  'finishedAt',
  'exitCode',
  'sessionId',
  'forkMechanism',
  'skillObservation',
  'tail',
  'reason',
] as const;

const NonEmptyStringSchema = z.string().trim().min(1);
const TimestampSchema = z.iso.datetime({ offset: true });
const BoundedReasonSchema = z.string().max(MAX_RUN_REASON_LENGTH).nullable().default(null);
const InputValuesSchema = z.record(z.string(), z.string().nullable());

/**
 * A persisted tail must already satisfy both caps. Constructing a run passes
 * through `trimTail`; loading an oversized document is a corrupt document
 * instead of an invitation to store a transcript.
 */
const TailSchema = z
  .string()
  .refine(isTailWithinLimits, {
    message: `A step tail must be at most ${String(MAX_TAIL_LINES)} lines and ${String(MAX_TAIL_BYTES)} bytes.`,
  })
  .default('');

const RunStepRecordContent = {
  /** Stable snapshot step id; reordering never changes it. */
  id: NonEmptyStringSchema,
  /** Position of this step in the frozen snapshot, zero based. */
  index: z.number().int().min(0),
  label: NonEmptyStringSchema.nullable().default(null),
  status: StepStatusSchema,
  startedAt: TimestampSchema.nullable().default(null),
  finishedAt: TimestampSchema.nullable().default(null),
  /** Null until the harness process exits. */
  exitCode: z.number().int().nullable().default(null),
  /** Session id actually used for this step, when a plan has assigned one. */
  sessionId: NonEmptyStringSchema.nullable().default(null),
  forkMechanism: RunForkMechanismSchema,
  skillObservation: SkillObservationStateSchema.default('unknown'),
  tail: TailSchema,
  /** Short, bounded explanation for the current status. Never a transcript. */
  reason: BoundedReasonSchema,
};
export const RunStepRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...RunStepRecordContent,
    kind: z.literal('skill').optional(),
    skillName: NonEmptyStringSchema,
  }),
  z.strictObject({
    ...RunStepRecordContent,
    kind: z.literal('instruction'),
    skillName: z.never().optional(),
  }),
]);
export type RunStepRecord = z.infer<typeof RunStepRecordSchema>;

/**
 * A frozen run. `chainSnapshot` is a deep clone of the saved chain at creation
 * time, so later chain edits cannot alter an in-flight or recorded run
 * (EXEC-08). There is deliberately no transcript field.
 */
export const RunSchema = z.strictObject({
  version: z.literal(RUN_VERSION),
  /** Server-generated stable id; the store validates path safety separately. */
  id: NonEmptyStringSchema,
  projectId: NonEmptyStringSchema,
  chainId: NonEmptyStringSchema,
  harness: z.enum(HARNESS_IDS),
  mode: RunModeSchema,
  sessionMode: ChainSessionModeSchema,
  chainSnapshot: ChainSchema,
  /** Every declared input resolved to a concrete string before the run starts. */
  resolvedInputs: z.record(z.string(), z.string()).default({}),
  status: RunStatusSchema,
  /** Index into the frozen snapshot's steps. */
  currentStepIndex: z.number().int().min(0),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  startedAt: TimestampSchema.nullable().default(null),
  finishedAt: TimestampSchema.nullable().default(null),
  /** Run-level session id; `fresh` assigns per step instead. */
  sessionId: NonEmptyStringSchema.nullable().default(null),
  forkMechanism: RunForkMechanismSchema,
  steps: z.array(RunStepRecordSchema).min(1),
  reason: BoundedReasonSchema,
});
export type Run = z.infer<typeof RunSchema>;

export const RunDocumentSchema = RunSchema;

/** Stable issue codes for validation details. */
export const RUN_ISSUE_CODES = {
  STEP_COUNT_MISMATCH: 'run_step_count_mismatch',
  STEP_ID_MISMATCH: 'run_step_id_mismatch',
  STEP_INDEX_MISMATCH: 'run_step_index_mismatch',
  STEP_SKILL_MISMATCH: 'run_step_skill_mismatch',
  CURRENT_STEP_OUT_OF_RANGE: 'run_current_step_out_of_range',
  INPUT_UNDECLARED: 'run_input_undeclared',
  INPUT_REQUIRED: 'run_input_required',
  TAIL_TOO_LARGE: 'run_tail_too_large',
} as const;

export type RunErrorCode =
  | 'RUN_INVALID'
  | 'RUN_UNSUPPORTED_VERSION'
  | 'RUN_INPUT_REQUIRED'
  | 'RUN_INPUT_INVALID'
  | 'RUN_STEP_NOT_FOUND'
  | 'RUN_CHAIN_INVALID';

export interface RunValidationIssue {
  /** Dot-separated path such as `steps.1.tail`. */
  path: string;
  /** Zod issue code or a stable `RUN_ISSUE_CODES` value. */
  code: string;
  message: string;
  stepId?: string;
  stepIndex?: number;
  inputName?: string;
}

/**
 * Typed run failure. Details contain only field paths, stable codes, step
 * identifiers, and input names: never terminal output or credentials.
 */
export class RunError extends Error {
  readonly code: RunErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: RunErrorCode,
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

export class RunValidationError extends RunError {
  readonly issues: RunValidationIssue[];

  constructor(issues: RunValidationIssue[]) {
    super('RUN_INVALID', 'The run record is not valid.', { issues });
    this.issues = issues;
  }
}

export class RunUnsupportedVersionError extends RunError {
  constructor(version: unknown) {
    super('RUN_UNSUPPORTED_VERSION', 'The run uses an unsupported version.', {
      version: describeVersion(version),
      supportedVersion: RUN_VERSION,
    });
  }
}

/** A declared input is missing, or the supplied input values are malformed. */
export class RunInputError extends RunError {
  constructor(
    code: 'RUN_INPUT_REQUIRED' | 'RUN_INPUT_INVALID',
    message: string,
    details: Record<string, unknown> = {},
    options: { cause?: unknown } = {},
  ) {
    super(code, message, details, options);
  }
}

export interface ResolvedRunInputs {
  /** Only declared inputs, in declaration order, each resolved to a string. */
  resolvedInputs: Record<string, string>;
  /** Required inputs whose resolved value is empty. */
  missing: string[];
  /** Supplied names the chain does not declare. They are not persisted. */
  unknown: string[];
}

export interface ResolveRunInputsOptions {
  /**
   * Reject unresolved required inputs. Run creation keeps this on because a
   * run must never start with an empty required value.
   */
  requireComplete?: boolean;
}

/**
 * Resolve chain inputs to a concrete string map. Defaults fill absent values;
 * an optional input with no default resolves to an empty string. Unknown
 * supplied names are reported but never copied into the run snapshot.
 */
export function resolveRunInputs(
  chain: Chain,
  rawInputs: unknown,
  options: ResolveRunInputsOptions = {},
): ResolvedRunInputs {
  let values: Record<string, string | null> = {};
  if (rawInputs !== undefined && rawInputs !== null) {
    const parsed = InputValuesSchema.safeParse(rawInputs);
    if (!parsed.success) {
      throw new RunInputError('RUN_INPUT_INVALID', 'The run input values are not valid.', {
        issues: normalizeZodIssues(parsed.error.issues),
      });
    }
    values = parsed.data;
  }

  const declared = new Set(chain.inputs.map((input) => input.name));
  const unknown = Object.keys(values)
    .filter((name) => !declared.has(name))
    .sort();

  const resolvedInputs: Record<string, string> = {};
  const missing: string[] = [];

  for (const input of chain.inputs) {
    const supplied = values[input.name];
    const value =
      supplied !== undefined && supplied !== null ? supplied : input.defaultValue ?? '';
    resolvedInputs[input.name] = value;
    if (input.required && value.trim() === '') {
      missing.push(input.name);
    }
  }

  if (missing.length > 0 && options.requireComplete !== false) {
    throw new RunInputError('RUN_INPUT_REQUIRED', 'Required run inputs are unresolved.', {
      missing,
      inputNames: missing,
    });
  }

  return { resolvedInputs, missing, unknown };
}

export interface CreateRunInput {
  /** Optional explicit id. Defaults to `run-<uuid>`. */
  id?: string;
  projectId: string;
  /** The saved chain read at run creation time. It is deep-cloned, not mutated. */
  chain: Chain;
  mode: RunMode;
  /** Raw input values; validated and resolved before the snapshot is frozen. */
  inputs?: unknown;
  /** Clock seam. Defaults to the current time. */
  now?: Date | string;
  /** Optional run-level session id. Defaults to null until the plan assigns one. */
  sessionId?: string | null;
  forkMechanism?: RunForkMechanism;
}

/**
 * Create a run by deep-cloning the chain, resolving inputs, and initializing
 * one pending step record per snapshot step. The returned document is fully
 * validated; the source chain object is never mutated.
 */
export function createRunRecord(input: CreateRunInput): Run {
  const snapshot = parseChain(structuredClone(input.chain));
  const resolved = resolveRunInputs(snapshot, input.inputs);
  const timestamp = toTimestamp(input.now);
  const sessionId = input.sessionId ?? null;
  const forkMechanism = input.forkMechanism ?? 'none';

  const run: Run = validateRun({
    version: RUN_VERSION,
    id: input.id ?? createRunId(),
    projectId: input.projectId,
    chainId: snapshot.id,
    harness: snapshot.harness,
    mode: input.mode,
    sessionMode: snapshot.sessionMode,
    chainSnapshot: snapshot,
    resolvedInputs: resolved.resolvedInputs,
    status: 'starting',
    currentStepIndex: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    finishedAt: null,
    sessionId,
    forkMechanism,
    steps: snapshot.steps.map((step, index) => ({
      id: step.id,
      index,
      ...(step.kind === 'instruction'
        ? { kind: 'instruction' as const }
        : { ...(step.kind === undefined ? {} : { kind: step.kind }), skillName: step.skillName }),
      label: step.label ?? null,
      status: 'pending' as const,
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      sessionId: null,
      forkMechanism,
      skillObservation: step.kind === 'instruction' ? 'not-observable' as const : 'unknown' as const,
      tail: '',
      reason: null,
    })),
    reason: null,
  });

  return run;
}

/** Server-generated run id: readable, unique, and safe as a filename. */
export function createRunId(): string {
  return `run-${randomUUID()}`;
}

/**
 * Upgrade a decoded JSON document to the current run version. Version 1 is the
 * first persisted format; an unversioned draft is structurally identical and
 * is upgraded by adding `version`.
 */
export function migrateRunDocument(raw: unknown): unknown {
  if (!isRecord(raw) || Object.hasOwn(raw, 'version')) {
    return raw;
  }
  return { ...raw, version: RUN_VERSION };
}

/** Validate a decoded run document, applying the documented migration first. */
export function parseRunDocument(raw: unknown): Run {
  if (isRecord(raw) && Object.hasOwn(raw, 'version') && raw.version !== RUN_VERSION) {
    throw new RunUnsupportedVersionError(raw.version);
  }
  return validateRun(migrateRunDocument(raw));
}

/**
 * Structural and cross-field validation. Beyond the schema, a persisted run
 * must align its step records with the frozen snapshot and may not carry an
 * undeclared input or an oversized tail.
 */
export function validateRun(value: unknown): Run {
  const parsed = RunSchema.safeParse(value);
  if (!parsed.success) {
    throw new RunValidationError(normalizeZodIssues(parsed.error.issues));
  }

  const run = parsed.data;
  const issues: RunValidationIssue[] = [];
  const snapshotSteps = run.chainSnapshot.steps;

  if (run.steps.length !== snapshotSteps.length) {
    issues.push({
      path: 'steps',
      code: RUN_ISSUE_CODES.STEP_COUNT_MISMATCH,
      message: `The run has ${String(run.steps.length)} step records for ${String(snapshotSteps.length)} snapshot steps.`,
    });
  }

  run.steps.forEach((step, index) => {
    const snapshotStep = snapshotSteps[index];
    if (snapshotStep === undefined) {
      return;
    }
    if (step.index !== index) {
      issues.push({
        path: `steps.${String(index)}.index`,
        code: RUN_ISSUE_CODES.STEP_INDEX_MISMATCH,
        stepId: step.id,
        stepIndex: index,
        message: `Step record ${String(index)} records index ${String(step.index)}.`,
      });
    }
    if (step.id !== snapshotStep.id) {
      issues.push({
        path: `steps.${String(index)}.id`,
        code: RUN_ISSUE_CODES.STEP_ID_MISMATCH,
        stepId: step.id,
        stepIndex: index,
        message: `Step record ${String(index)} does not match the frozen snapshot step id.`,
      });
    }
    if (step.skillName !== snapshotStep.skillName ||
      (step.kind === 'instruction') !== (snapshotStep.kind === 'instruction')) {
      issues.push({
        path: `steps.${String(index)}.skillName`,
        code: RUN_ISSUE_CODES.STEP_SKILL_MISMATCH,
        stepId: step.id,
        stepIndex: index,
        message: `Step record ${String(index)} does not match the frozen snapshot skill.`,
      });
    }
    if (!isTailWithinLimits(step.tail)) {
      issues.push({
        path: `steps.${String(index)}.tail`,
        code: RUN_ISSUE_CODES.TAIL_TOO_LARGE,
        stepId: step.id,
        stepIndex: index,
        message: `The step tail exceeds ${String(MAX_TAIL_LINES)} lines or ${String(MAX_TAIL_BYTES)} bytes.`,
      });
    }
  });

  if (run.currentStepIndex < 0 || run.currentStepIndex >= run.steps.length) {
    issues.push({
      path: 'currentStepIndex',
      code: RUN_ISSUE_CODES.CURRENT_STEP_OUT_OF_RANGE,
      message: 'The current step index is outside the frozen step list.',
    });
  }

  const declaredInputs = new Map(
    run.chainSnapshot.inputs.map((input) => [input.name, input] as const),
  );
  for (const name of Object.keys(run.resolvedInputs)) {
    if (!declaredInputs.has(name)) {
      issues.push({
        path: `resolvedInputs.${name}`,
        code: RUN_ISSUE_CODES.INPUT_UNDECLARED,
        inputName: name,
        message: `Resolved input "${name}" is not declared by the frozen chain.`,
      });
    }
  }
  for (const input of run.chainSnapshot.inputs) {
    const value = run.resolvedInputs[input.name] ?? '';
    if (input.required && value.trim() === '') {
      issues.push({
        path: `resolvedInputs.${input.name}`,
        code: RUN_ISSUE_CODES.INPUT_REQUIRED,
        inputName: input.name,
        message: `Required input "${input.name}" is unresolved.`,
      });
    }
  }

  if (issues.length > 0) {
    throw new RunValidationError(issues);
  }

  return run;
}

/** Convenience alias for callers that only want the validated run. */
export function parseRun(value: unknown): Run {
  return validateRun(value);
}

/** True when the status owns the single global active-run slot. */
export function isActiveRunStatus(value: unknown): value is ActiveRunStatus {
  return typeof value === 'string' && (ACTIVE_RUN_STATUSES as readonly string[]).includes(value);
}

/** True when the status is terminal and must not block a later start. */
export function isFinalRunStatus(value: unknown): value is FinalRunStatus {
  return typeof value === 'string' && (FINAL_RUN_STATUSES as readonly string[]).includes(value);
}

/** True when a step process is considered live. */
export function isActiveStepStatus(value: unknown): value is StepStatus {
  return value === 'running';
}

/** Count newline-delimited lines; an empty tail has zero lines. */
export function countTailLines(value: string): number {
  return value === '' ? 0 : value.split('\n').length;
}

/** UTF-8 byte size of a tail. */
export function tailByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/** True only when a tail already obeys both documented caps. */
export function isTailWithinLimits(value: string): boolean {
  return countTailLines(value) <= MAX_TAIL_LINES && tailByteLength(value) <= MAX_TAIL_BYTES;
}

/**
 * Trim terminal output from the oldest end until it satisfies both caps.
 *
 * Line trimming happens first so the retained tail is the most recent whole
 * lines. The byte cap then drops a leading partial UTF-8 code point, producing
 * a string that is still valid UTF-8.
 */
export function trimTail(
  value: string,
  limits: { maxLines?: number; maxBytes?: number } = {},
): string {
  const maxLines = limits.maxLines ?? MAX_TAIL_LINES;
  const maxBytes = limits.maxBytes ?? MAX_TAIL_BYTES;
  let trimmed = typeof value === 'string' ? value : '';

  if (maxLines <= 0) {
    return '';
  }

  const lines = trimmed.split('\n');
  if (lines.length > maxLines) {
    trimmed = lines.slice(-maxLines).join('\n');
  }

  if (maxBytes <= 0) {
    return '';
  }

  const bytes = Buffer.from(trimmed, 'utf8');
  if (bytes.length > maxBytes) {
    let start = bytes.length - maxBytes;
    // Move forward to the first byte that starts a UTF-8 code point. This
    // avoids emitting a replacement character for a split multi-byte glyph.
    while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) {
      start += 1;
    }
    trimmed = bytes.subarray(start).toString('utf8');
  }

  return trimmed;
}

/** Find a step record by snapshot step id. */
export function findRunStep(run: Run, stepId: string): RunStepRecord {
  const step = run.steps.find((candidate) => candidate.id === stepId);
  if (step === undefined) {
    throw new RunError('RUN_STEP_NOT_FOUND', 'No step in this run matches that id.', { stepId });
  }
  return step;
}

/** Replace one step tail, trimming before storing. The input run is untouched. */
export function setStepTail(run: Run, stepId: string, tail: string): Run {
  const next = structuredClone(run);
  const step = findRunStep(next, stepId);
  step.tail = trimTail(tail);
  return next;
}

/** Append terminal output to one step tail, trimming before storing. */
export function appendStepTail(run: Run, stepId: string, chunk: string): Run {
  const next = structuredClone(run);
  const step = findRunStep(next, stepId);
  step.tail = trimTail(`${step.tail}${chunk}`);
  return next;
}

/**
 * Mark a live run and any running step as interrupted. Startup calls this for
 * every record still in an active status. The input run is never mutated, and
 * a final run is returned as a clone without changing its status.
 */
export function markRunInterrupted(
  run: Run,
  now: Date | string = new Date(),
  reason = 'SERVER_RESTART',
): Run {
  const timestamp = toTimestamp(now);
  const next = structuredClone(run);
  if (!isActiveRunStatus(next.status)) {
    return next;
  }

  next.status = 'interrupted';
  next.updatedAt = timestamp;
  next.finishedAt = timestamp;
  next.reason = truncateReason(reason);

  for (const step of next.steps) {
    if (step.status === 'running') {
      step.status = 'interrupted';
      step.finishedAt = timestamp;
      step.reason ??= truncateReason(reason);
    }
  }

  return validateRun(next);
}

/** Convert a clock value into the persisted ISO timestamp shape. */
export function toTimestamp(value: Date | string | undefined): string {
  if (value === undefined) {
    return new Date().toISOString();
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RunError('RUN_INVALID', 'The run clock returned an invalid date.');
  }
  return date.toISOString();
}

/** Trim arbitrary status text to the bounded reason length. */
export function truncateReason(value: string): string {
  return value.length <= MAX_RUN_REASON_LENGTH
    ? value
    : value.slice(0, MAX_RUN_REASON_LENGTH);
}

function normalizeZodIssues(
  issues: ReadonlyArray<{ path: PropertyKey[]; code: string; message: string }>,
): RunValidationIssue[] {
  return issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join('.'),
    code: issue.code,
    message: issue.message,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeVersion(version: unknown): unknown {
  if (version === null || ['string', 'number', 'boolean'].includes(typeof version)) {
    return version;
  }
  return Array.isArray(version) ? 'array' : typeof version;
}
