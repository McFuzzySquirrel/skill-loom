import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isAbortError, type ApiClientError } from '../api/client';
import {
  CHAIN_HARNESSES,
  CHAIN_SESSION_MODES,
  NEW_CHAIN_ID,
  chainsApi,
  toApiClientError,
  type Chain,
  type ChainHarness,
  type ChainInput,
  type ChainSessionMode,
  type ChainStep,
  type ChainsApi,
} from '../api/chains';
import { useStatusAnnouncer } from '../components/StatusRegion';

/**
 * Unsaved editor state for one chain (CHAIN-05).
 *
 * The hook owns step add, edit, remove, and reorder. Nothing here writes to the
 * API: the builder can validate and order a draft, while persistence and named
 * inputs belong to CHAIN-06. Steps are keyed by their stable id, never by name
 * or array index, so repeated skills and reordering stay correct.
 */

/** Editable content mirrored from the chain model, plus optional timestamps. */
export interface ChainDraftDocument {
  name: string;
  harness: ChainHarness;
  sessionMode: ChainSessionMode;
  steps: ChainStep[];
  inputs: ChainInput[];
  automaticPermissionOptIn: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type ChainDraftState =
  | { status: 'loading'; chainId: string; document: null; error: null }
  | { status: 'error'; chainId: string; document: null; error: ApiClientError }
  | { status: 'ready'; chainId: string; document: ChainDraftDocument; error: null };

export interface StepInstructionIssue {
  stepId: string;
  /** One-based position at the time validation ran. */
  position: number;
  message: string;
}

export interface ChainDraftValidation {
  issues: StepInstructionIssue[];
  invalidStepIds: ReadonlySet<string>;
  /** False when there are no steps or any instruction is blank. */
  canSave: boolean;
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
  addStep: (skill: { name: string }) => string;
  updateStep: (
    stepId: string,
    patch: Partial<Pick<ChainStep, 'skillName' | 'instruction' | 'label'>>,
  ) => void;
  removeStep: (stepId: string) => void;
  moveStep: (stepId: string, direction: 'up' | 'down') => void;
  reorderStep: (draggedStepId: string, targetStepId: string) => void;
  validation: ChainDraftValidation;
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

function documentFromChain(chain: Chain): ChainDraftDocument {
  return {
    name: chain.name,
    harness: chain.harness,
    sessionMode: chain.sessionMode,
    steps: chain.steps,
    inputs: chain.inputs,
    automaticPermissionOptIn: chain.automaticPermissionOptIn,
    createdAt: chain.createdAt,
    updatedAt: chain.updatedAt,
  };
}

/** Human name used in row actions and announcements. */
export function stepDisplayName(step: ChainStep): string {
  const label = step.label?.trim() ?? '';
  return label === '' ? step.skillName : label;
}

/** Find every step whose instruction is empty after trimming. */
export function collectStepInstructionIssues(
  steps: readonly ChainStep[],
): StepInstructionIssue[] {
  const issues: StepInstructionIssue[] = [];
  steps.forEach((step, index) => {
    if (step.instruction.trim() === '') {
      issues.push({
        stepId: step.id,
        position: index + 1,
        message: `Step ${String(index + 1)} needs an instruction before the draft can be saved.`,
      });
    }
  });
  return issues;
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

/** Load or draft one chain and expose ordered step editing operations. */
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

    api
      .getChain(projectId, chainId, { signal: controller.signal })
      .then((chain) => {
        if (generation.current !== current) {
          return;
        }
        const document = documentFromChain(chain);
        setState({ status: 'ready', chainId, document, error: null });
        setSelectedStepId(document.steps[0]?.id ?? null);
        announce(
          `Chain ${document.name} loaded with ${String(document.steps.length)} step${
            document.steps.length === 1 ? '' : 's'
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
    (skill: { name: string }): string => {
      const stepId = createLocalStepId();
      const step: ChainStep = {
        id: stepId,
        skillName: skill.name,
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

  const updateStep = useCallback(
    (
      stepId: string,
      patch: Partial<Pick<ChainStep, 'skillName' | 'instruction' | 'label'>>,
    ) => {
      setState((previous) =>
        updateReadyDocument(previous, (document) => ({
          ...document,
          steps: document.steps.map((step) =>
            step.id === stepId ? { ...step, ...patch } : step,
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

  const reload = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  const selectedStep = useMemo(() => {
    if (state.status !== 'ready' || selectedStepId === null) {
      return null;
    }
    return state.document.steps.find((step) => step.id === selectedStepId) ?? null;
  }, [selectedStepId, state]);

  const validation = useMemo<ChainDraftValidation>(() => {
    const steps = state.status === 'ready' ? state.document.steps : [];
    const issues = collectStepInstructionIssues(steps);
    return {
      issues,
      invalidStepIds: new Set(issues.map((issue) => issue.stepId)),
      canSave: steps.length > 0 && issues.length === 0,
    };
  }, [state]);

  return {
    state,
    selectedStepId,
    selectedStep,
    selectStep,
    addStep,
    updateStep,
    removeStep,
    moveStep,
    reorderStep,
    validation,
    reload,
  };
}
