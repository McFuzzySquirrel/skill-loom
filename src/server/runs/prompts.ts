import { randomUUID } from 'node:crypto';
import {
  CHAIN_INPUT_NAME_PATTERN as INPUT_NAME_PATTERN,
  type Chain,
  type ChainSessionMode,
  type ChainStep,
} from '../chains/model.js';
import type { ForkMechanism } from '../harness/types.js';
import {
  buildHandoffNote,
  type HandoffNoteOptions,
  type HandoffSourceStep,
} from './handoff.js';
import {
  RunModeSchema,
  type RunMode,
  type StepStatus,
} from './model.js';

/**
 * Prompt assembly and session planning.
 *
 * A prompt names the skill explicitly and contains the resolved instruction.
 * Skill loading itself remains model-invoked (EXEC-01): Slan controls the text
 * and its order, not whether the harness chooses to load the skill.
 *
 * Session planning consumes adapter capabilities as data. This module never
 * compares a harness id, so a CLI flag or fork change stays inside the adapter
 * contract (NFR-COMPAT-01). Everything here is pure: nothing spawns a process,
 * reads a file, or makes a model call.
 */

export const RUN_SESSION_SURFACES = ['interactive', 'headless'] as const;
export type RunSessionSurface = (typeof RUN_SESSION_SURFACES)[number];

/** Stable prompt/session failure codes. */
export const RUN_PROMPT_ERROR_CODES = {
  STEP_NOT_FOUND: 'RUN_PROMPT_STEP_NOT_FOUND',
  INSTRUCTION_INVALID: 'RUN_PROMPT_INSTRUCTION_INVALID',
  INPUT_REQUIRED: 'RUN_PROMPT_INPUT_REQUIRED',
  INPUT_INVALID: 'RUN_PROMPT_INPUT_INVALID',
  PLACEHOLDER_INVALID: 'RUN_PROMPT_PLACEHOLDER_INVALID',
  PLACEHOLDER_UNRESOLVED: 'RUN_PROMPT_PLACEHOLDER_UNRESOLVED',
  SESSION_MODE_UNSUPPORTED: 'RUN_PROMPT_SESSION_MODE_UNSUPPORTED',
  MODE_INVALID: 'RUN_PROMPT_MODE_INVALID',
  FORK_UNSUPPORTED: 'RUN_PROMPT_FORK_UNSUPPORTED',
  SESSION_ID_INVALID: 'RUN_PROMPT_SESSION_ID_INVALID',
  HANDOFF_UNAVAILABLE: 'RUN_PROMPT_HANDOFF_UNAVAILABLE',
} as const;
export type RunPromptErrorCode =
  (typeof RUN_PROMPT_ERROR_CODES)[keyof typeof RUN_PROMPT_ERROR_CODES];

/**
 * Typed prompt/session failure. Details contain only field names, step ids,
 * indices, labels, and placeholder/input names. An input *value* is never
 * copied into an error.
 */
export class RunPromptError extends Error {
  readonly code: RunPromptErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: RunPromptErrorCode,
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

/** Terminal text that can be resolved from a run's frozen input map. */
export type PromptInputValues = Readonly<Record<string, string | null | undefined>>;

/** Adapter capabilities used for planning; a `HarnessAdapter` satisfies this. */
export interface SessionCapabilities {
  readonly supportedSessionModes: readonly ChainSessionMode[];
  readonly forkMechanisms: {
    readonly interactive: ForkMechanism;
    readonly headless: ForkMechanism;
  };
  readonly nativeFork: boolean;
}

export interface PlannedStepSession {
  readonly stepId: string;
  readonly stepIndex: number;
  readonly skillName: string;
  /** Session id assigned to this step, including a native fork target. */
  readonly sessionId: string;
  readonly forkMechanism: ForkMechanism;
  /** Present only for a native fork; the parent session to fork from. */
  readonly forkFromSessionId: string | null;
  /** True when this step's prompt must carry a deterministic handoff note. */
  readonly handoffRequired: boolean;
}

export interface RunSessionPlan {
  readonly sessionMode: ChainSessionMode;
  readonly surface: RunSessionSurface;
  /** Overall fork mechanism for the chain on this surface. */
  readonly mechanism: ForkMechanism;
  readonly nativeFork: boolean;
  readonly steps: readonly PlannedStepSession[];
}

export interface PlanRunSessionsInput {
  readonly chain: Chain;
  readonly capabilities: SessionCapabilities;
  readonly mode: RunMode;
  /**
   * Optional run-level session id. Shared mode reuses it for every step and a
   * fork chain uses it for its first step. Fresh mode always creates one id
   * per step.
   */
  readonly runSessionId?: string | undefined;
  /** Deterministic id seam for unit tests and future harness-specific ids. */
  readonly createSessionId?: (() => string) | undefined;
}

/** Prompt assembly for one step in a chain or frozen chain snapshot. */
export interface AssembleStepPromptInput {
  readonly chain: Chain;
  readonly stepIndex: number;
  readonly inputs: PromptInputValues;
}

/** Previous step state needed only when a handoff note is required. */
export interface PreviousStepState {
  readonly stepIndex: number;
  readonly status: StepStatus;
  readonly tail?: string | undefined;
}

export interface BuildStepPromptInput extends AssembleStepPromptInput {
  readonly sessionPlan?: RunSessionPlan | undefined;
  readonly previousStep?: PreviousStepState | undefined;
  readonly handoffOptions?: HandoffNoteOptions | undefined;
}

/** Exact prompt shape. The skill is explicit and the instruction follows. */
export function formatStepPrompt(step: ChainStep, instruction: string): string {
  return `Skill: ${step.skillName}\n\nInstruction:\n${instruction}`;
}

/**
 * Resolve `{{name}}` placeholders from the frozen input map and return the
 * bare instruction text.
 *
 * A placeholder whose input was not resolved throws before any spawn. An
 * optional input resolved to the empty string is a real value and is
 * substituted as empty; only a missing key is unresolved.
 */
export function resolveStepInstruction(
  step: ChainStep,
  inputs: PromptInputValues,
  stepIndex = 0,
): string {
  const instruction = validateInstruction(step, stepIndex);
  const stepLabel = step.label ?? step.skillName;

  return instruction.replace(/\{\{([^{}]*)\}\}/g, (raw, inner: string) => {
    const name = inner.trim();

    if (!INPUT_NAME_PATTERN.test(name)) {
      throw new RunPromptError(
        RUN_PROMPT_ERROR_CODES.PLACEHOLDER_INVALID,
        `Step ${String(stepIndex + 1)} "${stepLabel}" contains an invalid placeholder "${raw}".`,
        {
          stepId: step.id,
          stepIndex,
          stepLabel,
          placeholder: raw,
          inputName: name,
        },
      );
    }

    const value = inputs[name];
    if (typeof value !== 'string') {
      throw new RunPromptError(
        RUN_PROMPT_ERROR_CODES.PLACEHOLDER_UNRESOLVED,
        `Step ${String(stepIndex + 1)} "${stepLabel}" references placeholder "{{${name}}}" without a resolved input.`,
        {
          stepId: step.id,
          stepIndex,
          stepLabel,
          placeholder: name,
          raw,
          inputName: name,
        },
      );
    }

    return value;
  });
}

/**
 * Build one step prompt. Required inputs are checked across the whole chain
 * first, so a missing value fails before any process can start even when the
 * missing input is not referenced by this particular step.
 */
export function assembleStepPrompt(input: AssembleStepPromptInput): string {
  const step = getChainStep(input.chain, input.stepIndex);
  assertRequiredInputs(input.chain, input.inputs, step, input.stepIndex);
  const instruction = resolveStepInstruction(step, input.inputs, input.stepIndex);
  return formatStepPrompt(step, instruction);
}

/**
 * Plan shared, fresh, and fork session behaviour from the chain and adapter
 * capabilities.
 *
 * - `shared` assigns one session id to every step.
 * - `fresh` assigns a new id to every step.
 * - `fork` uses the surface's native mechanism when the adapter reports one;
 *   otherwise the step gets a new id and `handoffRequired` so the runner must
 *   append a deterministic handoff note. The first step of a fork chain has no
 *   previous session, so it starts a new session and is labelled `none`.
 */
export function planRunSessions(input: PlanRunSessionsInput): RunSessionPlan {
  const mode = parseRunMode(input.mode);
  const chain = input.chain;
  const surface: RunSessionSurface =
    mode === 'automatic' ? 'headless' : 'interactive';

  if (!input.capabilities.supportedSessionModes.includes(chain.sessionMode)) {
    throw new RunPromptError(
      RUN_PROMPT_ERROR_CODES.SESSION_MODE_UNSUPPORTED,
      `The harness does not support the "${chain.sessionMode}" session mode.`,
      {
        sessionMode: chain.sessionMode,
        supported: [...input.capabilities.supportedSessionModes],
      },
    );
  }

  let mechanism: ForkMechanism = 'none';
  if (chain.sessionMode === 'fork') {
    mechanism = input.capabilities.forkMechanisms[surface];
    if (mechanism === 'none') {
      throw new RunPromptError(
        RUN_PROMPT_ERROR_CODES.FORK_UNSUPPORTED,
        `The harness cannot fork a session on the ${surface} surface.`,
        { sessionMode: chain.sessionMode, surface, mechanism },
      );
    }
    // Never invent a native fork when the adapter does not report one.
    if (mechanism === 'native' && input.capabilities.nativeFork !== true) {
      mechanism = 'handoff';
    }
  }

  const createSessionId = input.createSessionId ?? ((): string => randomUUID());
  const nextSessionId = (field: string): string =>
    assertSessionId(createSessionId(), field);

  let sharedSessionId: string | null = null;
  if (chain.sessionMode === 'shared') {
    sharedSessionId =
      input.runSessionId === undefined
        ? nextSessionId('runSessionId')
        : assertSessionId(input.runSessionId, 'runSessionId');
  }

  const steps: PlannedStepSession[] = [];
  let previousSessionId: string | null = null;

  chain.steps.forEach((step, index) => {
    let sessionId: string;
    let forkMechanism: ForkMechanism = 'none';
    let forkFromSessionId: string | null = null;
    let handoffRequired = false;

    if (chain.sessionMode === 'shared') {
      // `sharedSessionId` is assigned above whenever the mode is shared.
      sessionId = sharedSessionId ?? nextSessionId('sessionId');
    } else if (chain.sessionMode === 'fresh') {
      sessionId = nextSessionId('sessionId');
    } else if (index === 0) {
      // There is no previous session to fork from, so the first step starts a
      // new conversation. The overall plan still reports the fork mechanism.
      sessionId =
        input.runSessionId === undefined
          ? nextSessionId('sessionId')
          : assertSessionId(input.runSessionId, 'runSessionId');
    } else if (mechanism === 'native') {
      forkMechanism = 'native';
      forkFromSessionId = previousSessionId;
      sessionId = nextSessionId('sessionId');
    } else {
      forkMechanism = 'handoff';
      handoffRequired = true;
      sessionId = nextSessionId('sessionId');
    }

    steps.push({
      stepId: step.id,
      stepIndex: index,
      skillName: step.skillName,
      sessionId,
      forkMechanism,
      forkFromSessionId,
      handoffRequired,
    });
    previousSessionId = sessionId;
  });

  return {
    sessionMode: chain.sessionMode,
    surface,
    mechanism,
    nativeFork: input.capabilities.nativeFork,
    steps,
  };
}

/**
 * Build the final prompt for one step, appending the deterministic handoff
 * note when the session plan selected a handoff fork.
 *
 * A missing previous-step state for a handoff step is a typed failure rather
 * than an empty note: silently starting a fresh session without context would
 * misrepresent the chain's fork behaviour.
 */
export function buildStepPrompt(input: BuildStepPromptInput): string {
  const basePrompt = assembleStepPrompt(input);

  if (input.sessionPlan === undefined) {
    return basePrompt;
  }

  const planned = input.sessionPlan.steps[input.stepIndex];
  if (planned === undefined) {
    throw new RunPromptError(
      RUN_PROMPT_ERROR_CODES.STEP_NOT_FOUND,
      `The session plan has no step at index ${String(input.stepIndex)}.`,
      { stepIndex: input.stepIndex, stepCount: input.sessionPlan.steps.length },
    );
  }

  if (!planned.handoffRequired) {
    return basePrompt;
  }

  const previous = input.previousStep;
  if (previous === undefined) {
    throw new RunPromptError(
      RUN_PROMPT_ERROR_CODES.HANDOFF_UNAVAILABLE,
      `Step ${String(input.stepIndex + 1)} requires a handoff note from the previous step.`,
      {
        stepId: planned.stepId,
        stepIndex: input.stepIndex,
        previousStepIndex: input.stepIndex - 1,
      },
    );
  }

  if (previous.stepIndex !== input.stepIndex - 1) {
    throw new RunPromptError(
      RUN_PROMPT_ERROR_CODES.HANDOFF_UNAVAILABLE,
      `A handoff note for step ${String(input.stepIndex + 1)} must come from step ${String(input.stepIndex)}.`,
      {
        stepId: planned.stepId,
        stepIndex: input.stepIndex,
        previousStepIndex: previous.stepIndex,
        expectedPreviousStepIndex: input.stepIndex - 1,
      },
    );
  }

  const previousChainStep = getChainStep(input.chain, previous.stepIndex);
  const previousInstruction = resolveStepInstruction(
    previousChainStep,
    input.inputs,
    previous.stepIndex,
  );

  const handoffSource: HandoffSourceStep = {
    index: previous.stepIndex,
    label: previousChainStep.label ?? null,
    skillName: previousChainStep.skillName,
    instruction: previousInstruction,
    status: previous.status,
    tail: previous.tail ?? '',
  };

  const note =
    input.handoffOptions === undefined
      ? buildHandoffNote(handoffSource)
      : buildHandoffNote(handoffSource, input.handoffOptions);

  return `${basePrompt}\n\n${note}`;
}

function validateInstruction(step: ChainStep, stepIndex: number): string {
  const stepLabel = step.label ?? step.skillName;
  if (
    typeof step.instruction !== 'string' ||
    step.instruction.trim() === '' ||
    step.instruction.includes('\0')
  ) {
    throw new RunPromptError(
      RUN_PROMPT_ERROR_CODES.INSTRUCTION_INVALID,
      `Step ${String(stepIndex + 1)} "${stepLabel}" needs a nonempty instruction without NUL characters.`,
      { stepId: step.id, stepIndex, stepLabel },
    );
  }
  return step.instruction;
}

function assertRequiredInputs(
  chain: Chain,
  inputs: PromptInputValues,
  step: ChainStep,
  stepIndex: number,
): void {
  const stepLabel = step.label ?? step.skillName;
  const missing: string[] = [];

  for (const input of chain.inputs) {
    const value = inputs[input.name];
    if (value !== undefined && value !== null && typeof value !== 'string') {
      throw new RunPromptError(
        RUN_PROMPT_ERROR_CODES.INPUT_INVALID,
        `Input "${input.name}" must be a string.`,
        {
          stepId: step.id,
          stepIndex,
          stepLabel,
          inputName: input.name,
        },
      );
    }
    if (input.required && (typeof value !== 'string' || value.trim() === '')) {
      missing.push(input.name);
    }
  }

  if (missing.length > 0) {
    throw new RunPromptError(
      RUN_PROMPT_ERROR_CODES.INPUT_REQUIRED,
      `Required input(s) are unresolved: ${missing.join(', ')}.`,
      {
        stepId: step.id,
        stepIndex,
        stepLabel,
        missing,
        inputNames: missing,
      },
    );
  }
}

function getChainStep(chain: Chain, stepIndex: number): ChainStep {
  const step = chain.steps[stepIndex];
  if (step === undefined) {
    throw new RunPromptError(
      RUN_PROMPT_ERROR_CODES.STEP_NOT_FOUND,
      `The chain has no step at index ${String(stepIndex)}.`,
      { stepIndex, stepCount: chain.steps.length },
    );
  }
  return step;
}

function parseRunMode(value: unknown): RunMode {
  const parsed = RunModeSchema.safeParse(value);
  if (!parsed.success) {
    throw new RunPromptError(
      RUN_PROMPT_ERROR_CODES.MODE_INVALID,
      'The run mode is not valid.',
      { field: 'mode', value: typeof value === 'string' ? value : typeof value },
    );
  }
  return parsed.data;
}

function assertSessionId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) {
    throw new RunPromptError(
      RUN_PROMPT_ERROR_CODES.SESSION_ID_INVALID,
      'A session id must be a nonempty string without NUL characters.',
      { field },
    );
  }
  return value;
}
