import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApiClientError } from '../api/client';
import { toApiClientError } from '../api/chains';
import { DRAFT_CATALOG_ID, globalDraftChainsApi } from '../api/drafts';
import { ChainFlow } from '../components/ChainFlow';
import { InlineError } from '../components/InlineError';
import { InputsEditor } from '../components/InputsEditor';
import { StepEditor } from '../components/StepEditor';
import { StepList } from '../components/StepList';
import { useStatusAnnouncer } from '../components/StatusRegion';
import { useChainDraft } from '../hooks/useChainDraft';

export interface ChainEditorPageProps {
  /** Omitted for a global draft. */
  projectId?: string;
  chainId: string;
}

const UNSAVED_MESSAGE = 'This chain has unsaved changes.';

/**
 * The only interactive screen: a visual editor for an existing chain's step
 * order, instructions, and inputs. Creating, discovering, and running chains
 * happens through the CLI and companion skills.
 */
export function ChainEditorPage({ projectId, chainId }: ChainEditorPageProps) {
  const isDraft = projectId === undefined;
  const { announce } = useStatusAnnouncer();
  const {
    state,
    selectedStep,
    selectStep,
    addInstruction,
    updateStep,
    removeStep,
    moveStep,
    reorderStep,
    addInput,
    updateInput,
    renameInput,
    removeInput,
    validation,
    isDirty,
    save,
    reload,
  } = useChainDraft({
    projectId: isDraft ? DRAFT_CATALOG_ID : projectId,
    chainId,
    ...(isDraft ? { api: globalDraftChainsApi } : {}),
  });

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiClientError | null>(null);
  const [saved, setSaved] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const openStep = useCallback(
    (stepId: string) => {
      selectStep(stepId);
      setEditorOpen(true);
    },
    [selectStep],
  );

  const document_ = state.status === 'ready' ? state.document : null;
  const selectedId = selectedStep?.id ?? null;

  useEffect(() => {
    if (!isDirty) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = UNSAVED_MESSAGE;
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) {
      return;
    }
    if (!editorOpen || selectedId === null) {
      if (element.open) {
        element.close();
      }
    } else if (!element.open) {
      element.showModal();
    }
  }, [editorOpen, selectedId]);

  const handleSave = useCallback(async () => {
    if (!validation.canSave || saving) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const result = await save();
      setSaved(true);
      announce(`Saved chain ${result.name}.`);
    } catch (error) {
      const apiError = toApiClientError(error, 'An unexpected error prevented saving this chain.');
      setSaveError(apiError);
      announce(`Chain could not be saved: ${apiError.message}`, 'assertive');
    } finally {
      setSaving(false);
    }
  }, [announce, save, saving, validation.canSave]);

  useEffect(() => {
    if (isDirty) {
      setSaved(false);
    }
  }, [isDirty]);

  const stepIssueLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const [stepId, issues] of validation.stepIssues) {
      labels.set(
        stepId,
        issues.some((issue) => issue.kind === 'placeholder') ? 'Placeholder issue' : 'Needs instruction',
      );
    }
    return labels;
  }, [validation.stepIssues]);

  const position =
    document_ === null || selectedStep === null
      ? null
      : document_.steps.findIndex((step) => step.id === selectedStep.id) + 1;

  return (
    <section className="chain-builder-page" aria-labelledby="chain-editor-title" data-testid="chain-builder-page">
      <header className="builder-header">
        <div className="builder-header__identity">
          <h1 className="panel__title" id="chain-editor-title">
            {document_?.name ?? 'Chain editor'}
          </h1>
          <p className="lede">
            Reorder steps and edit instructions. Changes are saved back to the chain; run it
            with the Skill Loom CLI or the <code>loom-run-bundle</code> skill.
          </p>
        </div>
        <div className="builder-header__save">
          <span
            className={`status-tag ${isDirty ? 'status-tag--warning' : 'status-tag--ok'}`}
            data-testid="chain-dirty-indicator"
            data-dirty={isDirty ? 'true' : 'false'}
          >
            <span aria-hidden="true">{isDirty ? '●' : '✓'}</span>{' '}
            {isDirty ? 'Unsaved changes' : saved ? 'Saved' : 'No changes'}
          </span>
          <button
            type="button"
            className="button"
            onClick={() => void handleSave()}
            disabled={state.status !== 'ready' || !validation.canSave || saving || !isDirty}
            data-testid="chain-save"
          >
            {saving ? 'Saving…' : 'Save chain'}
          </button>
        </div>
      </header>

      {state.status === 'loading' ? (
        <p className="state-note" data-testid="chain-builder-loading">
          <span aria-hidden="true">◌</span> Loading chain…
        </p>
      ) : null}

      {state.status === 'error' ? (
        <InlineError
          title="Chain could not be loaded"
          message={state.error.message}
          code={state.error.code}
          httpStatus={state.error.status}
          onRetry={reload}
        />
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

      {document_ !== null ? (
        <>
          {validation.issues.length > 0 ? (
            <section className="builder-panel draft-check" aria-label="Draft check">
              <p className="state-note state-note--warning">
                <span aria-hidden="true">▲</span> {String(validation.issues.length)} issue
                {validation.issues.length === 1 ? '' : 's'} block saving.
              </p>
              <ul className="draft-check__list">
                {validation.issues.map((issue) => (
                  <li key={issue.key} className="draft-check__item" data-kind={issue.kind}>
                    {issue.message}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="builder-panel" aria-labelledby="chain-flow-title">
            <h2 className="section-title" id="chain-flow-title">Workflow</h2>
            <p className="field__hint">
              Drag a step onto another to reorder, or select one to edit it.
            </p>
            <ChainFlow
              steps={document_.steps}
              selectedStepId={selectedId}
              invalidStepIds={validation.invalidStepIds}
              onSelect={openStep}
              onReorder={reorderStep}
            />
          </section>

          <StepList
            steps={document_.steps}
            selectedStepId={selectedId}
            invalidStepIds={validation.invalidStepIds}
            stepIssueLabels={stepIssueLabels}
            onAddInstruction={() => {
              addInstruction();
              setEditorOpen(true);
            }}
            onSelect={openStep}
            onMove={moveStep}
            onRemove={removeStep}
            onReorder={reorderStep}
          />

          <dialog
            ref={dialog}
            className="step-editor-dialog"
            aria-label="Step editor"
            data-testid="step-editor-dialog"
            onClose={() => setEditorOpen(false)}
          >
            <div className="step-editor-dialog__actions">
              <button
                type="button"
                className="button button--secondary"
                onClick={() => dialog.current?.close()}
              >
                Done editing
              </button>
            </div>
            <StepEditor
              step={selectedStep}
              position={position === 0 ? null : position}
              totalSteps={document_.steps.length}
              skillOptions={selectedStep !== null && selectedStep.kind !== 'instruction' ? [selectedStep.skillName] : []}
              placeholderIssues={validation.issues
                .filter((issue) => issue.stepId === selectedId && issue.kind === 'placeholder')
                .map((issue) => issue.message)}
              onChange={(patch) => {
                if (selectedStep !== null) {
                  updateStep(selectedStep.id, patch);
                }
              }}
            />
          </dialog>

          <section className="builder-inputs" aria-labelledby="builder-inputs-title">
            <h2 className="section-title" id="builder-inputs-title">Inputs</h2>
            <InputsEditor
              inputs={document_.inputs}
              steps={document_.steps}
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
