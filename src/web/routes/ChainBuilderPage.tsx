import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SkillEntry } from '../api/catalog';
import type { ApiClientError } from '../api/client';
import {
  CHAIN_HARNESSES,
  NEW_CHAIN_ID,
  chainBuilderPath,
  chainRunPath,
  chainsApi,
  toApiClientError,
  type Chain,
  type ChainHarness,
  type ChainStep,
  type ChainsApi,
} from '../api/chains';
import { globalChainsApi, type GlobalChainsApi } from '../api/globalChains';
import { InlineError } from '../components/InlineError';
import { HelpPopover } from '../components/HelpPopover';
import { InputsEditor } from '../components/InputsEditor';
import { SkillCatalog } from '../components/SkillCatalog';
import { StepEditor } from '../components/StepEditor';
import { StepList } from '../components/StepList';
import { useStatusAnnouncer } from '../components/StatusRegion';
import { CHAIN_HARNESS_LABELS, CHAIN_SESSION_MODE_LABELS } from '../hooks/useChains';
import {
  useChainDraft,
  type ChainDraftIssue,
} from '../hooks/useChainDraft';
import { Link, useRouter } from '../router';
import { useWorkspace } from '../WorkspaceContext';

export interface ChainBuilderPageProps {
  projectId: string;
  chainId: string;
  /** Test seams; the app always uses the same-origin typed clients. */
  api?: ChainsApi;
  globalChainsApiClient?: GlobalChainsApi;
}

const UNSAVED_CHANGES_MESSAGE =
  'This chain has unsaved changes. Leave and discard them?';

function stepsLabel(count: number): string {
  return `${String(count)} step${count === 1 ? '' : 's'}`;
}

function placeholderIssuesFor(
  issues: readonly ChainDraftIssue[],
  stepId: string | null,
): string[] {
  if (stepId === null) {
    return [];
  }
  return issues
    .filter((issue) => issue.stepId === stepId && issue.kind === 'placeholder')
    .map((issue) => issue.message);
}

/**
 * Chain builder with a modal step editor (CHAIN-FR-05, CHAIN-FR-06, CHAIN-FR-07).
 *
 * The catalog adds steps, the ordered list reorders them, the editor edits one
 * selected step in a dialog, and the inputs panel owns placeholder reconciliation
 * and save. The harness is fixed after the first save; another harness requires a
 * duplicate, because a chain never stores a per-step harness.
 */
export function ChainBuilderPage({
  projectId,
  chainId,
  api = chainsApi,
  globalChainsApiClient = globalChainsApi,
}: ChainBuilderPageProps) {
  const { search, navigate, setNavigationGuard } = useRouter();
  const { setDraftStatus, setInfo } = useWorkspace();
  const { announce } = useStatusAnnouncer();
  const {
    state,
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
    validation,
    isDirty,
    save,
    reload,
  } = useChainDraft({ projectId, chainId, search, api });

  const harnessFieldId = useId();
  const harnessNoteId = useId();
  const duplicateHarnessId = useId();
  const leaveHeadingId = useId();

  const [catalogSkills, setCatalogSkills] = useState<SkillEntry[]>([]);
  const [editorFocusRequest, setEditorFocusRequest] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiClientError | null>(null);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryError, setLibraryError] = useState<ApiClientError | null>(null);
  const [librarySavedName, setLibrarySavedName] = useState<string | null>(null);
  const [duplicateBusy, setDuplicateBusy] = useState(false);
  const [duplicateError, setDuplicateError] = useState<ApiClientError | null>(null);
  const [duplicateHarnessChoice, setDuplicateHarnessChoice] =
    useState<ChainHarness | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);

  const pendingNavigationRef = useRef<string | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const leaveHeading = useRef<HTMLHeadingElement>(null);
  const stepEditorDialog = useRef<HTMLDialogElement>(null);
  const lastFocusedEditorRequest = useRef(0);
  const dirtyRef = useRef(false);
  dirtyRef.current = isDirty;

  const draftDocument = state.status === 'ready' ? state.document : null;
  const selectedStepId = selectedStep?.id ?? null;
  const duplicateHarness: ChainHarness =
    duplicateHarnessChoice ??
    (draftDocument?.harness === 'opencode' ? 'copilot' : 'opencode');

  useEffect(() => {
    setDraftStatus({ dirty: isDirty, saving });
    return () => setDraftStatus({ dirty: false, saving: false });
  }, [isDirty, saving, setDraftStatus]);

  useEffect(() => {
    if (draftDocument !== null) {
      setInfo({
        projectId,
        chainId,
        chainName: draftDocument.name,
      });
    }
  }, [chainId, draftDocument, projectId, setInfo]);

  const handleCatalogChange = useCallback((entries: SkillEntry[]) => {
    setCatalogSkills(entries);
  }, []);

  const handleAddAsStep = useCallback(
    (skill: SkillEntry) => {
      addStep({ name: skill.name });
      setEditorOpen(true);
      setEditorFocusRequest((current) => current + 1);
    },
    [addStep],
  );

  const handleSelectStep = useCallback(
    (stepId: string) => {
      selectStep(stepId);
      setEditorOpen(true);
    },
    [selectStep],
  );

  const handleStepChange = useCallback(
    (patch: Partial<Pick<ChainStep, 'skillName' | 'instruction' | 'label'>>) => {
      if (selectedStep === null) {
        return;
      }
      updateStep(selectedStep.id, patch);
    },
    [selectedStep, updateStep],
  );

  /**
   * Both the browser tab and in-app router transitions are guarded while the
   * draft is dirty. The router calls this callback before changing the URL and
   * keeps the current screen when it returns false.
   */
  useEffect(() => {
    setNavigationGuard((to) => {
      if (!dirtyRef.current) {
        return true;
      }
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      pendingNavigationRef.current = to;
      setPendingNavigation(to);
      announce(UNSAVED_CHANGES_MESSAGE);
      return false;
    });
    return () => {
      setNavigationGuard(null);
    };
  }, [announce, setNavigationGuard]);

  useEffect(() => {
    if (pendingNavigation !== null) {
      leaveHeading.current?.focus();
    }
  }, [pendingNavigation]);

  useEffect(() => {
    const dialog = stepEditorDialog.current;
    if (dialog === null) {
      return;
    }
    if (!editorOpen || selectedStepId === null) {
      if (dialog.open) {
        dialog.close();
      }
      if (editorOpen) {
        setEditorOpen(false);
      }
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
    }
    if (editorFocusRequest > lastFocusedEditorRequest.current) {
      lastFocusedEditorRequest.current = editorFocusRequest;
      dialog
        .querySelector<HTMLTextAreaElement>('[data-testid="step-instruction"]')
        ?.focus();
    } else {
      dialog.querySelector('h2')?.focus();
    }
  }, [editorFocusRequest, editorOpen, selectedStepId]);

  useEffect(() => {
    if (!isDirty) {
      return;
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = UNSAVED_CHANGES_MESSAGE;
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isDirty]);

  const stayOnPage = () => {
    pendingNavigationRef.current = null;
    setPendingNavigation(null);
    announce('Stayed on this chain. Unsaved changes were kept.');
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    window.requestAnimationFrame(() => {
      target?.focus();
    });
  };

  const leaveWithoutSaving = () => {
    const target = pendingNavigationRef.current;
    pendingNavigationRef.current = null;
    setPendingNavigation(null);
    if (target === null) {
      return;
    }
    navigate(target, { skipGuard: true });
  };

  const handleSave = useCallback(async () => {
    if (state.status !== 'ready' || !validation.canSave || saving) {
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const saved = await save();
      announce(
        `Saved chain ${saved.name}. ${stepsLabel(saved.steps.length)}, ${String(
          saved.inputs.length,
        )} input${saved.inputs.length === 1 ? '' : 's'}.`,
      );
      if (chainId === NEW_CHAIN_ID) {
        // The draft became a real chain; replace the temporary route so a
        // reload loads the saved document instead of the URL draft.
        navigate(chainBuilderPath(projectId, saved.id), {
          replace: true,
          skipGuard: true,
        });
      }
    } catch (error) {
      const apiError = toApiClientError(
        error,
        'An unexpected error prevented saving this chain.',
      );
      setSaveError(apiError);
      announce(`Chain could not be saved: ${apiError.message}`, 'assertive');
    } finally {
      setSaving(false);
    }
  }, [announce, chainId, navigate, projectId, save, saving, state.status, validation.canSave]);

  const handleSaveAndRun = useCallback(async () => {
    if (state.status !== 'ready' || !validation.canSave || saving) {
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const saved = await save();
      announce(
        `Saved chain ${saved.name}. Opening run start for ${String(
          saved.steps.length,
        )} step${saved.steps.length === 1 ? '' : 's'}.`,
      );
      navigate(chainRunPath(projectId, saved.id), { skipGuard: true });
    } catch (error) {
      const apiError = toApiClientError(
        error,
        'An unexpected error prevented saving this chain.',
      );
      setSaveError(apiError);
      announce(`Chain could not be saved: ${apiError.message}`, 'assertive');
    } finally {
      setSaving(false);
    }
  }, [
    announce,
    navigate,
    projectId,
    save,
    saving,
    state.status,
    validation.canSave,
  ]);

  const handleSaveToLibrary = useCallback(async () => {
    if (state.status !== 'ready' || !validation.canSave || saving || libraryBusy) {
      return;
    }

    setSaving(true);
    setSaveError(null);
    setLibraryError(null);
    setLibrarySavedName(null);
    try {
      const saved = await save();
      setSaving(false);
      setLibraryBusy(true);
      const template = await globalChainsApiClient.save({
        projectId,
        chainId: saved.id,
      });
      setLibrarySavedName(template.name);
      announce(
        `Saved ${saved.name} to the global chain library as ${template.name}. The project copy is unchanged.`,
      );
    } catch (error) {
      const apiError = toApiClientError(
        error,
        'An unexpected error prevented saving this chain to the global library.',
      );
      setLibraryError(apiError);
      announce(
        `Chain could not be saved to the global library: ${apiError.message}`,
        'assertive',
      );
    } finally {
      setSaving(false);
      setLibraryBusy(false);
    }
  }, [
    announce,
    globalChainsApiClient,
    libraryBusy,
    projectId,
    save,
    saving,
    state.status,
    validation.canSave,
  ]);

  const handleDuplicateWithHarness = useCallback(async () => {
    if (state.status !== 'ready' || duplicateBusy) {
      return;
    }
    const source: Chain = {
      version: state.document.version ?? 1,
      id: state.document.id ?? chainId,
      name: state.document.name,
      harness: state.document.harness,
      sessionMode: state.document.sessionMode,
      steps: state.document.steps,
      inputs: state.document.inputs,
      automaticPermissionOptIn: state.document.automaticPermissionOptIn,
      createdAt: state.document.createdAt ?? new Date().toISOString(),
      updatedAt: state.document.updatedAt ?? new Date().toISOString(),
    };
    const target = duplicateHarness;
    if (target === source.harness) {
      return;
    }

    setDuplicateBusy(true);
    setDuplicateError(null);
    try {
      // Duplicate the saved record first, then change the harness only on the
      // copy. The source chain record is never rewritten.
      const copy = await api.duplicateChain(projectId, chainId);
      const updated = await api.updateChain(projectId, copy.id, {
        id: copy.id,
        version: copy.version,
        createdAt: copy.createdAt,
        updatedAt: copy.updatedAt,
        name: copy.name,
        harness: target,
        sessionMode: copy.sessionMode,
        steps: copy.steps,
        inputs: copy.inputs,
        automaticPermissionOptIn: copy.automaticPermissionOptIn,
      });
      announce(
        `Duplicated ${source.name} as ${updated.name} with the ${
          CHAIN_HARNESS_LABELS[target]
        } harness. The original chain is unchanged.`,
      );
      navigate(chainBuilderPath(projectId, updated.id));
    } catch (error) {
      const apiError = toApiClientError(
        error,
        'An unexpected error prevented duplicating this chain with another harness.',
      );
      setDuplicateError(apiError);
      announce(`Chain could not be duplicated: ${apiError.message}`, 'assertive');
    } finally {
      setDuplicateBusy(false);
    }
  }, [
    announce,
    api,
    chainId,
    duplicateBusy,
    duplicateHarness,
    navigate,
    projectId,
    state,
  ]);

  const skillOptions = useMemo(() => {
    const names = new Set(catalogSkills.map((skill) => skill.name));
    if (selectedStep !== null && selectedStep.kind !== 'instruction') {
      names.add(selectedStep.skillName);
    }
    return [...names].sort((left, right) => left.localeCompare(right));
  }, [catalogSkills, selectedStep]);

  const stepIssueLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const [stepId, issues] of validation.stepIssues) {
      labels.set(
        stepId,
        issues.some((issue) => issue.kind === 'placeholder')
          ? 'Placeholder issue'
          : 'Needs instruction',
      );
    }
    return labels;
  }, [validation.stepIssues]);

  const position =
    draftDocument === null || selectedStep === null
      ? null
      : draftDocument.steps.findIndex((step) => step.id === selectedStep.id) + 1;
  const canSave = state.status === 'ready' && validation.canSave && !saving;

  const saveHint = (() => {
    if (state.status !== 'ready') {
      return 'The chain must load before it can be saved.';
    }
    if (draftDocument !== null && draftDocument.steps.length === 0) {
      return 'Add at least one skill or instruction step before saving.';
    }
    if (validation.issues.length > 0) {
      const count = validation.issues.length;
      const onlyMissingInstructions = validation.issues.every(
        (issue) => issue.kind === 'step',
      );
      if (onlyMissingInstructions) {
        return `${String(count)} step${count === 1 ? '' : 's'} need${
          count === 1 ? 's' : ''
        } an instruction before saving.`;
      }
      return `${String(count)} issue${count === 1 ? '' : 's'} must be fixed before saving. Review the draft check.`;
    }
    return isDirty
      ? 'Ready to save. This chain has unsaved changes.'
      : 'All changes saved.';
  })();

  const dirtyLabel = (() => {
    if (isDirty) {
      return 'Unsaved changes';
    }
    return chainId === NEW_CHAIN_ID ? 'Draft not saved yet' : 'All changes saved';
  })();

  return (
    <section
      className="chain-builder-page"
      aria-labelledby="chain-builder-title"
      data-testid="chain-builder-page"
    >
      <p className="breadcrumb">
        <Link to={`/projects/${projectId}`}>← Project</Link>
      </p>

      <header className="builder-header">
        <div className="builder-header__identity">
          <h1 className="panel__title" id="chain-builder-title">
            Workflow designer
          </h1>
          <p className="lede">
            Assemble an ordered recipe from skills and instructions. Skill Loom guarantees
            prompt order; it cannot guarantee that a harness loads a named skill.
          </p>
        </div>
        <div className="builder-header__save">
          <span
            className={`status-tag ${
              isDirty ? 'status-tag--warning' : 'status-tag--ok'
            }`}
            data-testid="chain-dirty-indicator"
            data-dirty={isDirty ? 'true' : 'false'}
          >
            <span aria-hidden="true">{isDirty ? '●' : '✓'}</span> {dirtyLabel}
          </span>
          <div className="panel__actions builder-header__actions">
            <button
              type="button"
              className="button"
              onClick={() => void handleSave()}
              disabled={!canSave}
              aria-describedby="chain-save-hint"
              data-testid="chain-save"
            >
              {saving ? 'Saving…' : 'Save chain'}
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void handleSaveAndRun()}
              disabled={!canSave}
              data-testid="chain-save-and-run"
            >
              {saving ? 'Saving…' : 'Save and run'}
            </button>
            <details className="builder-header__more">
              <summary className="button button--secondary">More actions</summary>
              <div className="builder-header__more-menu">
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => void handleSaveToLibrary()}
                  disabled={!canSave || libraryBusy}
                  data-testid="chain-save-to-library"
                >
                  {libraryBusy ? 'Saving template…' : 'Save copy to library'}
                </button>
                {chainId === NEW_CHAIN_ID ? null : (
                  <Link
                    className="button button--secondary"
                    to={chainRunPath(projectId, chainId)}
                    data-testid="chain-run-from-builder"
                  >
                    Run saved chain
                  </Link>
                )}
              </div>
            </details>
          </div>
          <p className="field__hint" id="chain-save-hint">
            {saveHint}
            {chainId === NEW_CHAIN_ID
              ? ' Save once to open the run screen.'
              : isDirty
                ? ' Run uses the saved version; save first to include these edits.'
                : ''}
          </p>
        </div>
      </header>

      {pendingNavigation !== null ? (
        <section
          className="confirm-panel builder-leave-guard"
          role="group"
          aria-labelledby={leaveHeadingId}
          data-testid="unsaved-changes"
        >
          <h2
            className="builder-leave-guard__title"
            id={leaveHeadingId}
            ref={leaveHeading}
            tabIndex={-1}
          >
            Discard unsaved changes?
          </h2>
          <p>{UNSAVED_CHANGES_MESSAGE}</p>
          <p className="field__hint">
            Leaving discards edits that have not been saved to this project. Staying keeps
            the draft open.
          </p>
          <div className="panel__actions">
            <button
              type="button"
              className="button button--danger button--small"
              onClick={leaveWithoutSaving}
              data-testid="unsaved-leave"
            >
              Leave and discard changes
            </button>
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={stayOnPage}
              data-testid="unsaved-stay"
            >
              Stay and keep editing
            </button>
          </div>
        </section>
      ) : null}

      {state.status === 'loading' ? (
        <section className="panel" aria-labelledby="builder-loading-title">
          <h2 className="section-title" id="builder-loading-title">
            Chain
          </h2>
          <p className="state-note" data-testid="chain-builder-loading">
            <span aria-hidden="true">◌</span> Loading chain…
          </p>
        </section>
      ) : null}

      {state.status === 'error' ? (
        <section className="panel" aria-labelledby="builder-error-title">
          <h2 className="section-title" id="builder-error-title">
            Chain could not be loaded
          </h2>
          <InlineError
            title="Chain request failed"
            message={state.error.message}
            code={state.error.code}
            httpStatus={state.error.status}
            onRetry={reload}
          />
          <p className="panel__actions">
            <Link className="button button--secondary" to={`/projects/${projectId}`}>
              Back to project
            </Link>
          </p>
        </section>
      ) : null}

      {saveError !== null ? (
        <div data-testid="chain-save-error">
          <InlineError
            title="Chain could not be saved"
            message={saveError.message}
            code={saveError.code}
            httpStatus={saveError.status}
            onRetry={() => void handleSave()}
            retryLabel="Retry save"
          />
        </div>
      ) : null}

      {libraryError !== null ? (
        <div data-testid="chain-library-error">
          <InlineError
            title="Chain could not be saved to the library"
            message={libraryError.message}
            code={libraryError.code}
            httpStatus={libraryError.status}
            onRetry={() => void handleSaveToLibrary()}
            retryLabel="Retry save"
          />
        </div>
      ) : null}

      {librarySavedName === null ? null : (
        <p className="state-note preflight-note--ok" data-testid="chain-library-saved">
          <span aria-hidden="true">✓</span> Saved to the global chain library as{' '}
          <strong>{librarySavedName}</strong>.{' '}
          <Link to="/chains">Open the global chain library</Link>.
        </p>
      )}

      {duplicateError !== null ? (
        <div data-testid="chain-duplicate-error">
          <InlineError
            title="Chain could not be duplicated"
            message={duplicateError.message}
            code={duplicateError.code}
            httpStatus={duplicateError.status}
          />
        </div>
      ) : null}

      {draftDocument !== null ? (
        <>
          <details
            className="builder-meta"
            aria-labelledby="builder-meta-summary"
            open={chainId === NEW_CHAIN_ID}
          >
            <summary className="builder-meta__summary" id="builder-meta-summary">
              Harness and duplicate settings
            </summary>
            <div className="builder-meta__body">
            <div className="builder-meta__heading">
              <h2 className="section-title builder-meta__title" id="builder-meta-title">
                Builder settings
              </h2>
              <HelpPopover topic="builderSettings" />
            </div>
            <p className="builder-meta__name" data-testid="builder-chain-name">
              {draftDocument.name}
            </p>
            <p className="chain-card__badges">
              <span
                className="badge"
                data-testid="builder-session-mode"
                data-session-mode={draftDocument.sessionMode}
              >
                Session: {CHAIN_SESSION_MODE_LABELS[draftDocument.sessionMode]}
              </span>
              <span className="badge" data-testid="builder-harness" data-harness={draftDocument.harness}>
                Harness: {CHAIN_HARNESS_LABELS[draftDocument.harness]}
              </span>
              <span className="badge" data-testid="builder-draft-state">
                {chainId === NEW_CHAIN_ID ? 'Unsaved draft' : 'Saved chain'}
              </span>
            </p>
            <dl className="detail-grid builder-facts">
              <div>
                <dt>Chain id</dt>
                <dd>
                  <code data-testid="builder-chain-id">{chainId}</code>
                </dd>
              </div>
              <div>
                <dt>Steps</dt>
                <dd data-testid="builder-step-count">{stepsLabel(draftDocument.steps.length)}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd data-testid="builder-updated">
                  {draftDocument.updatedAt === undefined
                    ? 'Not saved yet'
                    : new Intl.DateTimeFormat(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(draftDocument.updatedAt))}
                </dd>
              </div>
              <div>
                <dt>Inputs</dt>
                <dd data-testid="builder-input-count">
                  {String(draftDocument.inputs.length)} input
                  {draftDocument.inputs.length === 1 ? '' : 's'}
                </dd>
              </div>
            </dl>

            <div className="builder-harness">
              <div className="field builder-harness__field">
                <label className="field__label" htmlFor={harnessFieldId}>
                  Harness
                </label>
                <select
                  className="input"
                  id={harnessFieldId}
                  value={draftDocument.harness}
                  onChange={(event) => setHarness(event.target.value as ChainHarness)}
                  disabled={chainId !== NEW_CHAIN_ID || saving}
                  aria-describedby={harnessNoteId}
                  data-testid="builder-harness-select"
                >
                  {CHAIN_HARNESSES.map((value) => (
                    <option key={value} value={value}>
                      {CHAIN_HARNESS_LABELS[value]}
                    </option>
                  ))}
                </select>
                <p className="field__hint" id={harnessNoteId}>
                  {chainId === NEW_CHAIN_ID
                    ? 'Choose the harness before the first save. Each step runs under this one harness.'
                    : `This chain is bound to ${CHAIN_HARNESS_LABELS[draftDocument.harness]}. The harness is read-only after creation because per-step harness switching is unsupported.`}
                </p>
              </div>

              {chainId === NEW_CHAIN_ID ? null : (
                <div
                  className="builder-harness__duplicate"
                  data-testid="harness-duplicate"
                >
                  <div className="field builder-harness__field">
                    <label className="field__label" htmlFor={duplicateHarnessId}>
                      Duplicate with another harness
                    </label>
                    <select
                      className="input"
                      id={duplicateHarnessId}
                      value={duplicateHarness}
                      onChange={(event) =>
                        setDuplicateHarnessChoice(event.target.value as ChainHarness)
                      }
                      disabled={duplicateBusy}
                      data-testid="harness-duplicate-target"
                    >
                      {CHAIN_HARNESSES.map((value) => (
                        <option key={value} value={value}>
                          {CHAIN_HARNESS_LABELS[value]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="button button--secondary button--small"
                    onClick={() => void handleDuplicateWithHarness()}
                    disabled={duplicateBusy || duplicateHarness === draftDocument.harness}
                    data-testid="harness-duplicate-action"
                  >
                    {duplicateBusy ? 'Duplicating…' : 'Duplicate chain'}
                  </button>
                  <p className="field__hint">
                    Changing the harness of this chain is not allowed. Duplicating creates a
                    separate chain with a new id and leaves the original on{' '}
                    {CHAIN_HARNESS_LABELS[draftDocument.harness]}.
                  </p>
                </div>
              )}
            </div>
            </div>
          </details>

          <section
            className="builder-panel draft-check"
            aria-labelledby="draft-check-title"
            data-testid="chain-draft-check"
          >
            <div className="builder-panel__heading">
              <h2 className="section-title builder-panel__title" id="draft-check-title">
                Draft check
              </h2>
              <span className="builder-panel__count">
                {validation.issues.length === 0
                  ? 'No blocking issues'
                  : `${String(validation.issues.length)} blocking`}
              </span>
            </div>

            {validation.issues.length === 0 ? (
              <p className="state-note" data-testid="chain-issues-none">
                <span aria-hidden="true">✓</span> Instructions are present and every
                placeholder resolves to a declared input.
              </p>
            ) : (
              <>
                <p
                  className="state-note state-note--warning"
                  data-testid="chain-issues-summary"
                >
                  <span aria-hidden="true">▲</span> {String(validation.issues.length)}{' '}
                  issue{validation.issues.length === 1 ? '' : 's'} block saving. Fix every
                  item below.
                </p>
                <ul className="draft-check__list">
                  {validation.issues.map((issue) => (
                    <li
                      key={issue.key}
                      className="draft-check__item"
                      data-testid={
                        issue.kind === 'placeholder'
                          ? 'placeholder-issue'
                          : 'chain-issue'
                      }
                      data-kind={issue.kind}
                    >
                      {issue.message}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {validation.warnings.length > 0 ? (
              <div className="draft-check__warnings" data-testid="chain-warnings-inline">
                <p className="state-note state-note--warning">
                  <span aria-hidden="true">○</span> {String(validation.warnings.length)}{' '}
                  warning{validation.warnings.length === 1 ? '' : 's'} — saving is still
                  allowed.
                </p>
                <ul className="draft-check__list">
                  {validation.warnings.map((warning) => (
                    <li key={warning} className="draft-check__item">
                      {warning}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <nav className="builder-section-nav" aria-label="Chain editor sections">
            <a href="#builder-skills">Skills</a>
            <a href="#builder-steps">Steps</a>
            <a href="#builder-inputs">Inputs</a>
          </nav>

          <div className="chain-builder" data-testid="chain-builder">
            <div
              className="chain-builder__column chain-builder__skills chain-builder__catalog"
              id="builder-skills"
              tabIndex={-1}
              data-testid="builder-skills-column"
            >
              <SkillCatalog
                projectId={projectId}
                context="builder"
                initialHarness={draftDocument.harness}
                onAddAsStep={handleAddAsStep}
                onCatalogChange={handleCatalogChange}
              />
            </div>

            <div
              className="chain-builder__column chain-builder__steps"
              id="builder-steps"
              tabIndex={-1}
              data-testid="builder-steps-column"
            >
              <StepList
                steps={draftDocument.steps}
                selectedStepId={selectedStepId}
                invalidStepIds={validation.invalidStepIds}
                stepIssueLabels={stepIssueLabels}
                onAddInstruction={() => {
                  addInstruction();
                  setEditorOpen(true);
                  setEditorFocusRequest((current) => current + 1);
                }}
                onSelect={handleSelectStep}
                onMove={moveStep}
                onRemove={removeStep}
                onReorder={reorderStep}
              />
            </div>
          </div>

          <dialog
            ref={stepEditorDialog}
            className="step-editor-dialog"
            aria-label="Step editor"
            data-testid="step-editor-dialog"
            onClose={() => setEditorOpen(false)}
          >
            <div className="step-editor-dialog__actions">
              <button
                type="button"
                className="button button--secondary"
                onClick={() => stepEditorDialog.current?.close()}
              >
                Done editing
              </button>
            </div>
            <StepEditor
              step={selectedStep}
              position={position === 0 ? null : position}
              totalSteps={draftDocument.steps.length}
              skillOptions={skillOptions}
              placeholderIssues={placeholderIssuesFor(
                validation.issues,
                selectedStepId,
              )}
              onChange={handleStepChange}
            />
          </dialog>

          <section
            className="builder-inputs"
            id="builder-inputs"
            aria-labelledby="builder-inputs-title"
            tabIndex={-1}
          >
            <h2 className="section-title" id="builder-inputs-title">Inputs</h2>
            <InputsEditor
              inputs={draftDocument.inputs}
              steps={draftDocument.steps}
              disabled={saving}
              onAdd={addInput}
              onUpdate={updateInput}
              onRename={renameInput}
              onRemove={removeInput}
            />
          </section>
        </>
      ) : null}
    </section>
  );
}
