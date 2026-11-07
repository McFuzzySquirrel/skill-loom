import { z } from 'zod';
import { chainStepName, type ChainAgentSelection } from '../../shared/chain.js';
import { HARNESS_IDS, HarnessIdSchema, type HarnessId } from '../config/schema.js';
export type { ChainStep } from '../../shared/chain.js';

/**
 * Current on-disk chain version.
 *
 * Chains are stored as versioned JSON so a later Skill Loom can migrate an older
 * document deliberately instead of guessing at its shape. An unversioned
 * document is the pre-versioning draft format, and version 1 is upgraded to
 * version 2 because native-agent selection adds a strict persisted field.
 * Unsupported versions are rejected rather than reinterpreted.
 */
export const CHAIN_VERSION = 2;

/** Session behaviour shared by every step in a chain. */
export const CHAIN_SESSION_MODES = ['shared', 'fresh', 'fork'] as const;
export const ChainSessionModeSchema = z.enum(CHAIN_SESSION_MODES);
export type ChainSessionMode = z.infer<typeof ChainSessionModeSchema>;

/**
 * Input names double as template keys, so they use identifier syntax. A
 * placeholder is exactly `{{name}}` with optional surrounding whitespace.
 */
export const CHAIN_INPUT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Top-level fields written to disk, in stable document order. */
export const CHAIN_TOP_LEVEL_FIELDS = [
  'version',
  'id',
  'name',
  'harness',
  'sessionMode',
  'steps',
  'inputs',
  'automaticPermissionOptIn',
  'agent',
  'createdAt',
  'updatedAt',
] as const;

const NonEmptyStringSchema = z.string().trim().min(1);
const TimestampSchema = z.iso.datetime({ offset: true });
export const ChainAgentSelectionSchema = z.strictObject({
  harness: HarnessIdSchema,
  name: NonEmptyStringSchema,
  sourceId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  revision: z.string().regex(/^[a-f0-9]{40,64}$/),
  repositoryPath: NonEmptyStringSchema.max(4_096),
  agentPath: NonEmptyStringSchema.max(4_096),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}) satisfies z.ZodType<ChainAgentSelection>;

const StepContent = {
  /** Stable within the chain; reordering must not change it. */
  id: NonEmptyStringSchema,
  /** Required and never whitespace-only. */
  instruction: NonEmptyStringSchema,
  /** Optional human-facing name shown instead of the step's default name. */
  label: NonEmptyStringSchema.optional(),
};
export const ChainStepSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...StepContent,
    kind: z.literal('skill').optional(),
    skillName: NonEmptyStringSchema,
  }),
  z.strictObject({
    ...StepContent,
    kind: z.literal('instruction'),
    skillName: z.never().optional(),
  }),
]);

export const ChainInputSchema = z.strictObject({
  name: z.string().regex(CHAIN_INPUT_NAME_PATTERN),
  /** Optional display label; defaults to the name in the UI. */
  label: NonEmptyStringSchema.optional(),
  required: z.boolean().default(false),
  /** Raw default value; the run resolves it before spawning a harness. */
  defaultValue: z.string().optional(),
});
export type ChainInput = z.infer<typeof ChainInputSchema>;

/**
 * Structural chain schema. Cross-field rules (unique ids, unique input names,
 * placeholder resolution, unused inputs) live in `validateChain` so they can
 * report stable issue codes with step and input context.
 *
 * `strictObject` is deliberate: a per-step `harness`, a model override, or any
 * other routing field is structurally invalid instead of being silently
 * accepted and ignored.
 */
const ChainFields = {
  /** Server-generated stable id. The store validates path safety separately. */
  id: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  harness: HarnessIdSchema,
  sessionMode: ChainSessionModeSchema,
  steps: z.array(ChainStepSchema).min(1),
  inputs: z.array(ChainInputSchema).default([]),
  /**
   * Per-chain opt-in for automatic Copilot's broad permission flags. Default
   * off: broad access is never implied by saving or running a chain.
   */
  automaticPermissionOptIn: z.boolean().default(false),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
};

const ChainV1Schema = z.strictObject({
  version: z.literal(1),
  ...ChainFields,
});

export const ChainSchema = z.strictObject({
  version: z.literal(CHAIN_VERSION),
  ...ChainFields,
  /** Optional harness-native agent, pinned to a verified remote definition. */
  agent: ChainAgentSelectionSchema.optional(),
});
export type Chain = z.infer<typeof ChainSchema>;

/** Alias used by storage code that treats a chain as a decoded document. */
export const ChainDocumentSchema = ChainSchema;

/** Stable issue codes for API validation details. */
export const CHAIN_ISSUE_CODES = {
  DUPLICATE_STEP_ID: 'chain_duplicate_step_id',
  DUPLICATE_INPUT_NAME: 'chain_duplicate_input_name',
  PLACEHOLDER_INVALID: 'chain_placeholder_invalid',
  PLACEHOLDER_UNKNOWN: 'chain_placeholder_unknown',
  AGENT_HARNESS_MISMATCH: 'chain_agent_harness_mismatch',
} as const;

export const CHAIN_WARNING_CODES = {
  INPUT_UNUSED: 'chain_input_unused',
} as const;

export interface ChainValidationIssue {
  /** Dot-separated path such as `steps.1.instruction`. */
  path: string;
  /** Zod issue code or a stable `CHAIN_ISSUE_CODES` value. */
  code: string;
  message: string;
  /** Present when the issue belongs to a specific step. */
  stepId?: string;
  /** Present when the issue concerns a specific step. */
  stepIndex?: number;
  /** Present when the issue concerns a specific input name. */
  inputName?: string;
}

export interface ChainValidationWarning {
  path: string;
  code: string;
  message: string;
  inputName?: string;
}

export type ChainErrorCode = 'CHAIN_INVALID' | 'CHAIN_UNSUPPORTED_VERSION';

/**
 * Typed chain failure. Details contain only field paths, stable codes, and
 * offending step/input identifiers; they never contain file contents.
 */
export class ChainError extends Error {
  readonly code: ChainErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: ChainErrorCode,
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

export class ChainValidationError extends ChainError {
  readonly issues: ChainValidationIssue[];

  constructor(issues: ChainValidationIssue[]) {
    super('CHAIN_INVALID', 'The chain is not valid.', { issues });
    this.issues = issues;
  }
}

export class ChainUnsupportedVersionError extends ChainError {
  constructor(version: unknown) {
    super('CHAIN_UNSUPPORTED_VERSION', 'The chain uses an unsupported version.', {
      version: describeVersion(version),
      supportedVersion: CHAIN_VERSION,
    });
  }
}

export interface ChainValidationResult {
  chain: Chain;
  warnings: ChainValidationWarning[];
}

export type SafeChainValidationResult =
  | { success: true; chain: Chain; warnings: ChainValidationWarning[] }
  | { success: false; error: ChainError };

/**
 * Upgrade a decoded JSON document to the current chain version.
 *
 * Unversioned drafts are stamped with the current version. Version 1 chains
 * are validated against their historical strict shape before upgrading; the
 * input object is never mutated.
 */
export function migrateChainDocument(raw: unknown): unknown {
  if (!isRecord(raw)) {
    return raw;
  }
  if (!Object.hasOwn(raw, 'version')) return { ...raw, version: CHAIN_VERSION };
  if (raw.version === 1) {
    const legacy = ChainV1Schema.safeParse(raw);
    return legacy.success ? { ...legacy.data, version: CHAIN_VERSION } : raw;
  }
  return raw;
}

/**
 * Validate a decoded chain document, applying the documented migration first.
 * A future version is rejected with a typed error instead of being parsed as
 * if it were the current version.
 */
export function parseChainDocument(raw: unknown): ChainValidationResult {
  if (
    isRecord(raw) &&
    Object.hasOwn(raw, 'version') &&
    raw.version !== CHAIN_VERSION &&
    raw.version !== 1
  ) {
    throw new ChainUnsupportedVersionError(raw.version);
  }

  return validateChain(migrateChainDocument(raw));
}

/** Validate a chain and return it plus non-blocking warnings. */
export function validateChain(value: unknown): ChainValidationResult {
  const parsed = ChainSchema.safeParse(value);
  if (!parsed.success) {
    throw new ChainValidationError(normalizeZodIssues(parsed.error.issues));
  }

  const chain = parsed.data;
  const issues: ChainValidationIssue[] = [];

  if (chain.agent !== undefined && chain.agent.harness !== chain.harness) {
    issues.push({
      path: 'agent.harness',
      code: CHAIN_ISSUE_CODES.AGENT_HARNESS_MISMATCH,
      message: `The selected ${chain.agent.harness} agent is incompatible with the ${chain.harness} chain harness.`,
    });
  }

  validateUniqueStepIds(chain, issues);
  validateUniqueInputNames(chain, issues);
  validatePlaceholders(chain, issues);

  if (issues.length > 0) {
    throw new ChainValidationError(issues);
  }

  return { chain, warnings: collectChainWarnings(chain) };
}

/** Convenience wrapper for callers that only want the validated chain. */
export function parseChain(value: unknown): Chain {
  return validateChain(value).chain;
}

/** Envelope-friendly validation that never throws and never partially applies. */
export function safeValidateChain(value: unknown): SafeChainValidationResult {
  try {
    const result = validateChain(value);
    return { success: true, chain: result.chain, warnings: result.warnings };
  } catch (error) {
    if (error instanceof ChainError) {
      return { success: false, error };
    }
    throw error;
  }
}

/**
 * Declared inputs that no instruction references are allowed, but reported so
 * the editor can warn that they are reserved for later edits.
 */
export function collectChainWarnings(chain: Chain): ChainValidationWarning[] {
  const referenced = new Set<string>();
  for (const step of chain.steps) {
    for (const placeholder of findPlaceholders(step.instruction)) {
      referenced.add(placeholder.name);
    }
  }

  const warnings: ChainValidationWarning[] = [];
  chain.inputs.forEach((input, index) => {
    if (!referenced.has(input.name)) {
      warnings.push({
        path: `inputs.${String(index)}.name`,
        code: CHAIN_WARNING_CODES.INPUT_UNUSED,
        message: `Input "${input.name}" is declared but never used in an instruction.`,
        inputName: input.name,
      });
    }
  });
  return warnings;
}

/** All declared harnesses remain usable by the chain model. */
export function isKnownHarness(value: unknown): value is HarnessId {
  return typeof value === 'string' && (HARNESS_IDS as readonly string[]).includes(value);
}

function validateUniqueStepIds(chain: Chain, issues: ChainValidationIssue[]): void {
  const seen = new Map<string, number>();
  chain.steps.forEach((step, index) => {
    const previous = seen.get(step.id);
    if (previous === undefined) {
      seen.set(step.id, index);
      return;
    }
    issues.push({
      path: `steps.${String(index)}.id`,
      code: CHAIN_ISSUE_CODES.DUPLICATE_STEP_ID,
      message: `Step id "${step.id}" is already used by step ${String(previous + 1)}.`,
      stepId: step.id,
      stepIndex: index,
    });
  });
}

function validateUniqueInputNames(chain: Chain, issues: ChainValidationIssue[]): void {
  const seen = new Map<string, number>();
  chain.inputs.forEach((input, index) => {
    const previous = seen.get(input.name);
    if (previous === undefined) {
      seen.set(input.name, index);
      return;
    }
    issues.push({
      path: `inputs.${String(index)}.name`,
      code: CHAIN_ISSUE_CODES.DUPLICATE_INPUT_NAME,
      message: `Input name "${input.name}" is already declared by input ${String(previous + 1)}.`,
      inputName: input.name,
    });
  });
}

function validatePlaceholders(chain: Chain, issues: ChainValidationIssue[]): void {
  const declared = new Set(chain.inputs.map((input) => input.name));

  chain.steps.forEach((step, index) => {
    const reported = new Set<string>();

    for (const placeholder of findPlaceholders(step.instruction)) {
      if (reported.has(placeholder.name)) {
        continue;
      }

      const stepLabel = chainStepName(step);
      if (placeholder.name === '' || !CHAIN_INPUT_NAME_PATTERN.test(placeholder.name)) {
        reported.add(placeholder.name);
        issues.push({
          path: `steps.${String(index)}.instruction`,
          code: CHAIN_ISSUE_CODES.PLACEHOLDER_INVALID,
          message: `Step "${stepLabel}" contains an invalid placeholder "${placeholder.raw}".`,
          stepId: step.id,
          stepIndex: index,
          inputName: placeholder.name,
        });
        continue;
      }

      if (!declared.has(placeholder.name)) {
        reported.add(placeholder.name);
        issues.push({
          path: `steps.${String(index)}.instruction`,
          code: CHAIN_ISSUE_CODES.PLACEHOLDER_UNKNOWN,
          message: `Step "${stepLabel}" references undeclared input "${placeholder.name}".`,
          stepId: step.id,
          stepIndex: index,
          inputName: placeholder.name,
        });
      }
    }
  });
}

interface PlaceholderMatch {
  raw: string;
  name: string;
}

function findPlaceholders(instruction: string): PlaceholderMatch[] {
  const matches: PlaceholderMatch[] = [];
  for (const match of instruction.matchAll(/\{\{([^{}]*)\}\}/g)) {
    const raw = match[1] ?? '';
    matches.push({ raw, name: raw.trim() });
  }
  return matches;
}

function normalizeZodIssues(
  issues: ReadonlyArray<{ path: PropertyKey[]; code: string; message: string }>,
): ChainValidationIssue[] {
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
