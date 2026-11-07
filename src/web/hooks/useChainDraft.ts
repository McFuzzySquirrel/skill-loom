import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chainStepName } from '../../shared/chain';
import type {
  ChainAgentSelection,
  SkillSnapshotBinding,
} from '../../shared/chain';
import { isAbortError, type ApiClientError } from '../api/client';
import type { SkillEntry } from '../api/catalog';
import {
  CHAIN_HARNESSES,
  CHAIN_INPUT_NAME_PATTERN,
  CHAIN_SESSION_MODES,
  NEW_CHAIN_ID,
  chainsApi,
  normalizeChainDraft,
  toApiClientError,
  type Chain,
  type ChainDraft,
  type ChainHarness,
  type ChainInput,
  type ChainSessionMode,
  type ChainStep,
  type ChainsApi,
} from '../api/chains';
import type { SkillChainStep } from '../../shared/chain';
import { useStatusAnnouncer } from '../components/StatusRegion';

/**
 * Unsaved editor state for one chain (CHAIN-05, CHAIN-06).
 *
 * The hook owns steps, named inputs, validation, dirty tracking, and the save
 * mutation. A draft is always keyed by stable step ids and by input names; the
 * inputs editor keeps its own row identity while a rename is being reviewed, so
 * a rejected rename never rewrites a saved instruction.
 */

/** Editable content mirrored from the chain model, plus optional identity. */
export interface ChainDraftDocument {
  id?: string;
  version?: number;
  name: string;
  harness: ChainHarness;
  sessionMode: ChainSessionMode;
  steps: ChainStep[];
  inputs: ChainInput[];
  automaticPermissionOptIn: boolean;
  agent?: ChainAgentSelection;
  createdAt?: string;
  updatedAt?: string;
}

export type ChainDraftState =
  | { status: 'loading'; chainId: string; document: null; error: null }
  | { status: 'error'; chainId: string; document: null; error: ApiClientError }
  | { status: 'ready'; chainId: string; document: ChainDraftDocument; error: null };

export type ChainDraftIssueKind = 'chain' | 'step' | 'placeholder' | 'input';

/** One blocking reason that keeps Save disabled. */
export interface ChainDraftIssue {
  /** Stable key for rendering; never an array index. */
  key: string;
  kind: ChainDraftIssueKind;
  message: string;
  stepId?: string;
  /** One-based step position at validation time. */
  position?: number;
  inputName?: string;
}

export interface ChainDraftValidation {
  issues: ChainDraftIssue[];
  invalidStepIds: ReadonlySet<string>;
  /** Per-step messages so the step editor can mark the exact field. */
  stepIssues: ReadonlyMap<string, ChainDraftIssue[]>;
  /** Non-blocking advisories such as an input no instruction uses. */
  warnings: string[];
  /** False when there are no steps or any blocking issue remains. */
  canSave: boolean;
}

/** One instruction that references a named input placeholder. */
export interface InputReference {
  stepId: string;
  position: number;
  displayName: string;
  instruction: string;
  occurrences: number;
  placeholder: string;
}

export interface UseChainDraftOptions {
  projectId: string;
  chainId: string;
  /** Current query string; used only for an unsaved `new` draft. */
  search?: string;
  api?: ChainsApi;
}

export interface UseChainDraftResult {
  state: ChainDraftState;
  selectedStepId: string | null;
  selectedStep: ChainStep | null;
  selectStep: (stepId: string | null) => void;
  addStep: (skill: SkillEntry) => string;
  addInstruction: () => string;
  updateStep: (
    stepId: string,
    patch: Partial<
      Pick<SkillChainStep, 'skillName' | 'skillBinding' | 'instruction' | 'label'>
    >,
  ) => void;
  removeStep: (stepId: string) => void;
  moveStep: (stepId: string, direction: 'up' | 'down') => void;
  reorderStep: (draggedStepId: string, targetStepId: string) => void;
  addInput: (input: ChainInput) => void;
  updateInput: (name: string, patch: Partial<Omit<ChainInput, 'name'>>) => void;
  /** Apply a reviewed rename and rewrite every matching placeholder. */
  renameInput: (oldName: string, newName: string) => void;
  /** Apply a reviewed removal and delete every matching placeholder. */
  removeInput: (name: string) => void;
  /** The harness can change only before the draft is first saved. */
  setHarness: (harness: ChainHarness) => void;
  setAgent: (agent: ChainAgentSelection | undefined) => void;
  validation: ChainDraftValidation;
  /** True when the editable content differs from the last load or save. */
  isDirty: boolean;
  /** Persist through the chain API and return the server's saved document. */
  save: () => Promise<Chain>;
  reload: () => void;
}

const DEFAULT_NEW_CHAIN_NAME = 'Untitled chain';

let localStepSequence = 0;

/** Stable local id for a step that has not been saved yet. */
export function createLocalStepId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return `step-${cryptoApi.randomUUID()}`;
  }
  localStepSequence += 1;
  return `step-local-${Date.now().toString(36)}-${String(localStepSequence)}`;
}

function parseHarness(value: string | null): ChainHarness {
  return value !== null && (CHAIN_HARNESSES as readonly string[]).includes(value)
    ? (value as ChainHarness)
    : 'opencode';
}

function parseSessionMode(value: string | null): ChainSessionMode {
  return value !== null && (CHAIN_SESSION_MODES as readonly string[]).includes(value)
    ? (value as ChainSessionMode)
    : 'shared';
}

/**
 * Build the unsaved draft handed over by the New Chain dialog.
 *
 * Only the name, harness, and session mode travel in the URL. Steps always
 * start empty so an abandoned dialog leaves no half-written chain file.
 */
export function parseNewChainDraft(search: string): ChainDraftDocument {
  const params = new URLSearchParams(search);
  const name = params.get('name')?.trim() ?? '';
  return {
    name: name === '' ? DEFAULT_NEW_CHAIN_NAME : name,
    harness: parseHarness(params.get('harness')),
    sessionMode: parseSessionMode(params.get('sessionMode')),
    steps: [],
    inputs: [],
    automaticPermissionOptIn: false,
  };
}

export function documentFromChain(chain: Chain): ChainDraftDocument {
  return {
    id: chain.id,
    version: chain.version,
    name: chain.name,
    harness: chain.harness,
    sessionMode: chain.sessionMode,
    steps: chain.steps,
    inputs: chain.inputs,
    automaticPermissionOptIn: chain.automaticPermissionOptIn,
    ...(chain.agent === undefined ? {} : { agent: chain.agent }),
    createdAt: chain.createdAt,
    updatedAt: chain.updatedAt,
  };
}

/** API payload; identity and timestamps stay server-owned. */
export function toChainDraft(document: ChainDraftDocument): ChainDraft {
  return {
    name: document.name,
    harness: document.harness,
    sessionMode: document.sessionMode,
    steps: document.steps,
    inputs: document.inputs,
    automaticPermissionOptIn: document.automaticPermissionOptIn,
    ...(document.agent === undefined ? {} : { agent: document.agent }),
  };
}

/** Human name used in row actions and announcements. */
export function stepDisplayName(step: ChainStep): string {
  return chainStepName(step);
}

/**
 * Canonical serialization of editable content only. Timestamps are excluded so
 * a save that changes nothing else leaves the dirty indicator off.
 */
export function serializeChainDraft(document: ChainDraftDocument): string {
  return JSON.stringify({
    name: document.name,
    harness: document.harness,
    sessionMode: document.sessionMode,
    steps: document.steps.map((step) => {
      const label = step.label?.trim() ?? '';
      return {
        id: step.id,
        ...(step.kind === 'instruction'
          ? { kind: 'instruction' as const }
          : {
              ...(step.kind === undefined ? {} : { kind: step.kind }),
              skillName: step.skillName,
              ...(step.skillBinding === undefined
                ? {}
                : { skillBinding: step.skillBinding }),
            }),
        instruction: step.instruction,
        ...(label === '' ? {} : { label }),
      };
    }),
    inputs: document.inputs.map((input) => {
      const label = input.label?.trim() ?? '';
      const defaultValue = input.defaultValue;
      return {
        name: input.name,
        required: input.required,
        ...(label === '' ? {} : { label }),
        ...(defaultValue === undefined || defaultValue === '' ? {} : { defaultValue }),
      };
    }),
    automaticPermissionOptIn: document.automaticPermissionOptIn,
    ...(document.agent === undefined ? {} : { agent: document.agent }),
  });
}

function skillSnapshotBinding(skill: SkillEntry): SkillSnapshotBinding | undefined {
  if (skill.source !== 'remote') {
    return undefined;
  }
  if (
    skill.sourceId === undefined ||
    skill.revision === undefined ||
    skill.repositoryPath === undefined
  ) {
    throw new Error('Remote catalog entry is missing its snapshot identity.');
  }
  return {
    sourceId: skill.sourceId,
    revision: skill.revision,
    repositoryPath: skill.repositoryPath,
  };
}

/** Find every `{{name}}` token, including an invalid or empty expression. */
export interface PlaceholderMatch {
  raw: string;
  name: string;
}

export function findPlaceholders(instruction: string): PlaceholderMatch[] {
  const matches: PlaceholderMatch[] = [];
  for (const match of instruction.matchAll(/\{\{([^{}]*)\}\}/g)) {
    const raw = match[1] ?? '';
    matches.push({ raw, name: raw.trim() });
  }
  return matches;
}

/** Find every step whose instruction is empty after trimming. */
export function collectStepInstructionIssues(
  steps: readonly ChainStep[],
): ChainDraftIssue[] {
  const issues: ChainDraftIssue[] = [];
  steps.forEach((step, index) => {
    if (step.instruction.trim() === '') {
      issues.push({
        key: `step:${step.id}:instruction`,
        kind: 'step',
        stepId: step.id,
        position: index + 1,
        message: `Step ${String(index + 1)} needs an instruction before the draft can be saved.`,
      });
    }
  });
  return issues;
}

/**
 * Validate placeholders before save. Every issue names the step and the exact
 * placeholder, matching the server's own `chain_placeholder_*` diagnostics.
 */
export function collectPlaceholderIssues(
  steps: readonly ChainStep[],
  inputs: readonly ChainInput[],
): ChainDraftIssue[] {
  const declared = new Set(inputs.map((input) => input.name));
  const issues: ChainDraftIssue[] = [];

  steps.forEach((step, index) => {
    const position = index + 1;
    const display = stepDisplayName(step);
    const reported = new Set<string>();

    for (const placeholder of findPlaceholders(step.instruction)) {
      const identity = placeholder.name === '' ? placeholder.raw : placeholder.name;
      if (reported.has(identity)) {
        continue;
      }
      reported.add(identity);

      if (
        placeholder.name === '' ||
        !CHAIN_INPUT_NAME_PATTERN.test(placeholder.name)
      ) {
        issues.push({
          key: `placeholder:${step.id}:${identity}`,
          kind: 'placeholder',
          stepId: step.id,
          position,
          inputName: placeholder.name,
          message: `Step ${String(position)} "${display}" contains an invalid placeholder "{{${placeholder.raw}}}". Placeholder names must start with a letter and use only letters, numbers, and underscores.`,
        });
        continue;
      }

      if (!declared.has(placeholder.name)) {
        issues.push({
          key: `placeholder:${step.id}:${placeholder.name}`,
          kind: 'placeholder',
          stepId: step.id,
          position,
          inputName: placeholder.name,
          message: `Step ${String(position)} "${display}" references undeclared input "${placeholder.name}".`,
        });
      }
    }
  });

  return issues;
}

function collectInputDeclarationIssues(inputs: readonly ChainInput[]): ChainDraftIssue[] {
  const issues: ChainDraftIssue[] = [];
  const seen = new Map<string, number>();

  inputs.forEach((input, index) => {
    const position = index + 1;
    const name = input.name.trim();
    if (name === '') {
      issues.push({
        key: `input:${String(index)}:empty`,
        kind: 'input',
        position,
        inputName: input.name,
        message: `Input ${String(position)} needs a name.`,
      });
      return;
    }

    if (!CHAIN_INPUT_NAME_PATTERN.test(name)) {
      issues.push({
        key: `input:${name}:syntax`,
        kind: 'input',
        position,
        inputName: name,
        message: `Input ${String(position)} name "${name}" must start with a letter and use only letters, numbers, and underscores.`,
      });
    }

    const previous = seen.get(name);
    if (previous !== undefined) {
      issues.push({
        key: `input:${name}:duplicate`,
        kind: 'input',
        position,
        inputName: name,
        message: `Input "${name}" is declared more than once (first at position ${String(
          previous + 1,
        )}).`,
      });
      return;
    }
    seen.set(name, index);
  });

  return issues;
}

/** Declared inputs that no instruction references are allowed but reported. */
export function collectInputWarnings(
  steps: readonly ChainStep[],
  inputs: readonly ChainInput[],
): string[] {
  return inputs
    .filter((input) => collectInputReferences(steps, input.name).length === 0)
    .map(
      (input) =>
        `Input "${input.name}" is declared but no instruction uses {{${input.name}}}. Unused inputs do not block saving.`,
    );
}

/** Validate the whole draft in one pass shared by the header and editor. */
export function validateChainDraft(document: ChainDraftDocument): ChainDraftValidation {
  const issues: ChainDraftIssue[] = [];

  if (document.name.trim() === '') {
    issues.push({
      key: 'chain:name',
      kind: 'chain',
      message: 'Enter a chain name before saving.',
    });
  }
  if (document.steps.length === 0) {
    issues.push({
      key: 'chain:steps',
      kind: 'chain',
      message: 'Add at least one catalog skill as a step before saving.',
    });
  }

  issues.push(...collectStepInstructionIssues(document.steps));
  issues.push(...collectPlaceholderIssues(document.steps, document.inputs));
  issues.push(...collectInputDeclarationIssues(document.inputs));

  const invalidStepIds = new Set<string>();
  const stepIssues = new Map<string, ChainDraftIssue[]>();
  for (const issue of issues) {
    if (issue.stepId === undefined) {
      continue;
    }
    invalidStepIds.add(issue.stepId);
    const existing = stepIssues.get(issue.stepId);
    if (existing === undefined) {
      stepIssues.set(issue.stepId, [issue]);
    } else {
      existing.push(issue);
    }
  }

  return {
    issues,
    invalidStepIds,
    stepIssues,
    warnings: collectInputWarnings(document.steps, document.inputs),
    canSave: issues.length === 0,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function placeholderPattern(inputName: string): RegExp {
  return new RegExp(`\\{\\{\\s*${escapeRegExp(inputName)}\\s*\\}\\}`, 'g');
}

/** Every instruction that references one input, in chain order. */
export function collectInputReferences(
  steps: readonly ChainStep[],
  inputName: string,
): InputReference[] {
  if (inputName === '') {
    return [];
  }

  const pattern = placeholderPattern(inputName);
  const references: InputReference[] = [];
  steps.forEach((step, index) => {
    const occurrences = step.instruction.match(pattern)?.length ?? 0;
    if (occurrences === 0) {
      return;
    }
    references.push({
      stepId: step.id,
      position: index + 1,
      displayName: stepDisplayName(step),
      instruction: step.instruction,
      occurrences,
      placeholder: `{{${inputName}}}`,
    });
  });
  return references;
}

/** Rewrite every whitespace-tolerant occurrence of one placeholder. */
export function replaceInputPlaceholders(
  instruction: string,
  oldName: string,
  newName: string,
): string {
  return instruction.replace(placeholderPattern(oldName), `{{${newName}}}`);
}

/**
 * Remove every occurrence of one placeholder while preserving the rest of the
 * instruction's text. Remaining content may become empty; validation then
 * blocks the save and names that step instead of silently inventing text.
 */
export function removeInputPlaceholders(instruction: string, inputName: string): string {
  return instruction
    .replace(placeholderPattern(inputName), '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

/**
 * Move one step to a target index, clamped to the list bounds. Returns a new
 * array; the input is never mutated.
 */
export function moveStepToIndex(
  steps: readonly ChainStep[],
  stepId: string,
  targetIndex: number,
): ChainStep[] {
  const from = steps.findIndex((step) => step.id === stepId);
  if (from < 0) {
    return [...steps];
  }

  const clamped = Math.max(0, Math.min(targetIndex, steps.length - 1));
  if (clamped === from) {
    return [...steps];
  }

  const next = [...steps];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) {
    return next;
  }
  next.splice(clamped, 0, moved);
  return next;
}

function updateReadyDocument(
  state: ChainDraftState,
  update: (document: ChainDraftDocument) => ChainDraftDocument,
): ChainDraftState {
  if (state.status !== 'ready') {
    return state;
  }
  return { ...state, document: update(state.document) };
}

/** Load or draft one chain and expose ordered editing plus persistence. */
export function useChainDraft({
  projectId,
  chainId,
  search = '',
  api = chainsApi,
}: UseChainDraftOptions): UseChainDraftResult {
  const isNew = chainId === NEW_CHAIN_ID;
  const [state, setState] = useState<ChainDraftState>(() =>
    isNew
      ? {
          status: 'ready',
          chainId,
          document: parseNewChainDraft(search),
          error: null,
        }
      : { status: 'loading', chainId, document: null, error: null },
  );
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<string | null>(() =>
    isNew ? serializeChainDraft(parseNewChainDraft(search)) : null,
  );
  const [reloadToken, setReloadToken] = useState(0);
  const generation = useRef(0);
  const { announce } = useStatusAnnouncer();

  useEffect(() => {
    if (isNew) {
      return;
    }

    const current = generation.current + 1;
    generation.current = current;
    const controller = new AbortController();
    setState({ status: 'loading', chainId, document: null, error: null });
    setBaseline(null);

    api
      .getChain(projectId, chainId, { signal: controller.signal })
      .then((chain) => {
        if (generation.current !== current) {
          return;
        }
        const document = documentFromChain(chain);
        setState({ status: 'ready', chainId, document, error: null });
        setSelectedStepId(document.steps[0]?.id ?? null);
        setBaseline(serializeChainDraft(document));
        announce(
          `Chain ${document.name} loaded with ${String(document.steps.length)} step${
            document.steps.length === 1 ? '' : 's'
          } and ${String(document.inputs.length)} input${
            document.inputs.length === 1 ? '' : 's'
          }.`,
        );
      })
      .catch((error: unknown) => {
        if (generation.current !== current || isAbortError(error)) {
          return;
        }
        const apiError = toApiClientError(
          error,
          'An unexpected error prevented loading this chain.',
        );
        setState({ status: 'error', chainId, document: null, error: apiError });
        setSelectedStepId(null);
        setBaseline(null);
        announce(`Chain could not be loaded: ${apiError.message}`);
      });

    return () => {
      controller.abort();
    };
  }, [announce, api, chainId, isNew, projectId, reloadToken]);

  const selectStep = useCallback((stepId: string | null) => {
    setSelectedStepId(stepId);
  }, []);

  const addStep = useCallback(
    (skill: SkillEntry): string => {
      const stepId = createLocalStepId();
      const skillBinding = skillSnapshotBinding(skill);
      const step: ChainStep = {
        id: stepId,
        skillName: skill.name,
        ...(skillBinding === undefined ? {} : { skillBinding }),
        instruction: '',
      };

      setState((previous) =>
        updateReadyDocument(previous, (document) => ({
          ...document,
          steps: [...document.steps, step],
        })),
      );
      setSelectedStepId(stepId);
      announce(`Added ${skill.name} as a new step. Write its instruction.`);
      return stepId;
    },
    [announce],
  );

  const addInstruction = useCallback((): string => {
    const stepId = createLocalStepId();
    const step: ChainStep = { id: stepId, kind: 'instruction', instruction: '' };
    setState((previous) =>
      updateReadyDocument(previous, (document) => ({
        ...document,
        steps: [...document.steps, step],
      })),
    );
    setSelectedStepId(stepId);
    announce('Added an instruction step. Write its instruction.');
    return stepId;
  }, [announce]);

  const updateStep = useCallback(
    (
      stepId: string,
      patch: Partial<
        Pick<SkillChainStep, 'skillName' | 'skillBinding' | 'instruction' | 'label'>
      >,
    ) => {
      setState((previous) =>
        updateReadyDocument(previous, (document) => ({
          ...document,
          steps: document.steps.map((step) =>
            step.id === stepId
              ? step.kind === 'instruction'
                ? {
                    ...step,
                    instruction: patch.instruction ?? step.instruction,
                    ...(patch.label === undefined ? {} : { label: patch.label }),
                  }
                : { ...step, ...patch, skillName: patch.skillName ?? step.skillName }
              : step,
          ),
        })),
      );
    },
    [],
  );

  const removeStep = useCallback(
    (stepId: string) => {
      if (state.status !== 'ready') {
        return;
      }

      const steps = state.document.steps;
      const index = steps.findIndex((step) => step.id === stepId);
      if (index < 0) {
        return;
      }

      const removed = steps[index];
      const remaining = steps.filter((step) => step.id !== stepId);
      setState((previous) =>
        updateReadyDocument(previous, (document) => ({
          ...document,
          steps: document.steps.filter((step) => step.id !== stepId),
        })),
      );
      setSelectedStepId((current) => {
        if (current !== stepId) {
          return current;
        }
        return remaining[index]?.id ?? remaining[index - 1]?.id ?? null;
      });
      announce(
        `Removed ${removed === undefined ? 'the step' : stepDisplayName(removed)}. ${String(
          remaining.length,
        )} step${remaining.length === 1 ? '' : 's'} remain.`,
      );
    },
    [announce, state],
  );

  const moveStep = useCallback(
    (stepId: string, direction: 'up' | 'down') => {
      if (state.status !== 'ready') {
        return;
      }

      const steps = state.document.steps;
      const from = steps.findIndex((step) => step.id === stepId);
      if (from < 0) {
        return;
      }
      const targetIndex = direction === 'up' ? from - 1 : from + 1;
      if (targetIndex < 0 || targetIndex >= steps.length) {
        return;
      }

      const moved = steps[from];
      setState((previous) =>
        updateReadyDocument(previous, (document) => ({
          ...document,
          steps: moveStepToIndex(document.steps, stepId, targetIndex),
        })),
      );
      announce(
        `Moved ${moved === undefined ? 'step' : stepDisplayName(moved)} to position ${String(
          targetIndex + 1,
        )} of ${String(steps.length)}.`,
      );
    },
    [announce, state],
  );

  const reorderStep = useCallback(
    (draggedStepId: string, targetStepId: string) => {
      if (state.status !== 'ready') {
        return;
      }

      const steps = state.document.steps;
      const from = steps.findIndex((step) => step.id === draggedStepId);
      const targetIndex = steps.findIndex((step) => step.id === targetStepId);
      if (from < 0 || targetIndex < 0 || from === targetIndex) {
        return;
      }

      setState((previous) =>
        updateReadyDocument(previous, (document) => ({
          ...document,
          steps: moveStepToIndex(document.steps, draggedStepId, targetIndex),
        })),
      );
      const moved = steps[from];
      announce(
        `Step order updated. ${moved === undefined ? 'The step' : stepDisplayName(moved)} is now position ${String(
          targetIndex + 1,
        )} of ${String(steps.length)}.`,
      );
    },
    [announce, state],
  );

  const addInput = useCallback(
    (input: ChainInput) => {
      setState((previous) =>
        updateReadyDocument(previous, (document) => ({
          ...document,
          inputs: [...document.inputs, input],
        })),
      );
      announce(
        `Added input ${input.name}. Use {{${input.name}}} in a step instruction.`,
      );
    },
    [announce],
  );

  const updateInput = useCallback(
    (name: string, patch: Partial<Omit<ChainInput, 'name'>>) => {
      setState((previous) =>
        updateReadyDocument(previous, (document) => ({
          ...document,
          inputs: document.inputs.map((input) =>
            input.name === name ? { ...input, ...patch } : input,
          ),
        })),
      );
    },
    [],
  );

  const renameInput = useCallback(
    (oldName: string, newName: string) => {
      if (state.status !== 'ready' || oldName === newName) {
        return;
      }

      const occurrences = state.document.steps.reduce(
        (total, step) =>
          total + (step.instruction.match(placeholderPattern(oldName))?.length ?? 0),
        0,
      );
      setState((previous) =>
        updateReadyDocument(previous, (document) => ({
          ...document,
          inputs: document.inputs.map((input) =>
            input.name === oldName ? { ...input, name: newName } : input,
          ),
          steps: document.steps.map((step) => ({
            ...step,
            instruction: replaceInputPlaceholders(step.instruction, oldName, newName),
          })),
        })),
      );
      announce(
        `Renamed input ${oldName} to ${newName} and updated ${String(
          occurrences,
        )} placeholder${occurrences === 1 ? '' : 's'}.`,
      );
    },
    [announce, state],
  );

  const removeInput = useCallback(
    (name: string) => {
      if (state.status !== 'ready') {
        return;
      }
      if (!state.document.inputs.some((input) => input.name === name)) {
        return;
      }

      setState((previous) =>
        updateReadyDocument(previous, (document) => ({
          ...document,
          inputs: document.inputs.filter((input) => input.name !== name),
          steps: document.steps.map((step) => ({
            ...step,
            instruction: removeInputPlaceholders(step.instruction, name),
          })),
        })),
      );
      announce(`Removed input ${name} and its placeholders from every step.`);
    },
    [announce, state],
  );

  const setHarness = useCallback(
    (harness: ChainHarness) => {
      if (!isNew) {
        announce(
          'The harness is read-only after creation. Duplicate the chain to use another harness.',
        );
        return;
      }
      setState((previous) =>
        updateReadyDocument(previous, (document) => {
          if (document.agent === undefined || document.agent.harness === harness) {
            return { ...document, harness };
          }
          const { agent: _agent, ...withoutAgent } = document;
          return { ...withoutAgent, harness };
        }),
      );
      announce(`Draft harness set to ${harness}.`);
    },
    [announce, isNew],
  );

  const setAgent = useCallback(
    (agent: ChainAgentSelection | undefined) => {
      if (agent !== undefined && state.status === 'ready' && agent.harness !== state.document.harness) {
        announce(`The ${agent.harness} agent is incompatible with the ${state.document.harness} chain.`);
        return;
      }
      setState((previous) =>
        updateReadyDocument(previous, (document) => {
          if (agent !== undefined) return { ...document, agent };
          const { agent: _agent, ...withoutAgent } = document;
          return withoutAgent;
        }),
      );
      announce(agent === undefined ? 'Removed the selected native agent.' : `Selected native agent ${agent.name}.`);
    },
    [announce, state],
  );

  const save = useCallback(async (): Promise<Chain> => {
    if (state.status !== 'ready') {
      throw new Error('The chain must finish loading before it can be saved.');
    }

    const draft = normalizeChainDraft(toChainDraft(state.document));
    const saved = isNew
      ? await api.createChain(projectId, draft)
      : await api.updateChain(projectId, chainId, {
          ...draft,
          ...(state.document.id === undefined ? {} : { id: state.document.id }),
          ...(state.document.version === undefined
            ? {}
            : { version: state.document.version }),
          ...(state.document.createdAt === undefined
            ? {}
            : { createdAt: state.document.createdAt }),
        });

    const next = documentFromChain(saved);
    setState({ status: 'ready', chainId: saved.id, document: next, error: null });
    setSelectedStepId((current) =>
      current !== null && next.steps.some((step) => step.id === current)
        ? current
        : (next.steps[0]?.id ?? null),
    );
    setBaseline(serializeChainDraft(next));
    return saved;
  }, [api, chainId, isNew, projectId, state]);

  const reload = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  const selectedStep = useMemo(() => {
    if (state.status !== 'ready' || selectedStepId === null) {
      return null;
    }
    return state.document.steps.find((step) => step.id === selectedStepId) ?? null;
  }, [selectedStepId, state]);

  const validation = useMemo<ChainDraftValidation>(
    () =>
      state.status === 'ready'
        ? validateChainDraft(state.document)
        : {
            issues: [],
            invalidStepIds: new Set<string>(),
            stepIssues: new Map<string, ChainDraftIssue[]>(),
            warnings: [],
            canSave: false,
          },
    [state],
  );

  const isDirty = useMemo(
    () =>
      state.status === 'ready' &&
      baseline !== null &&
      serializeChainDraft(state.document) !== baseline,
    [baseline, state],
  );

  return {
    state,
    selectedStepId,
    selectedStep,
    selectStep,
    addStep,
    addInstruction,
    updateStep,
    removeStep,
    moveStep,
    reorderStep,
    addInput,
    updateInput,
    renameInput,
    removeInput,
    setHarness,
    setAgent,
    validation,
    isDirty,
    save,
    reload,
  };
}
