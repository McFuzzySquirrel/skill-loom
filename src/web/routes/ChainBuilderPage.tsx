import { useCallback, useMemo, useState } from 'react';
import type { SkillEntry } from '../api/catalog';
import { NEW_CHAIN_ID, type ChainStep } from '../api/chains';
import { InlineError } from '../components/InlineError';
import { SkillCatalog } from '../components/SkillCatalog';
import { StepEditor } from '../components/StepEditor';
import { StepList } from '../components/StepList';
import { useStatusAnnouncer } from '../components/StatusRegion';
import { CHAIN_HARNESS_LABELS, CHAIN_SESSION_MODE_LABELS } from '../hooks/useChains';
import { useChainDraft, stepDisplayName } from '../hooks/useChainDraft';
import { Link, useRouter } from '../router';

export interface ChainBuilderPageProps {
  projectId: string;
  chainId: string;
}

function stepsLabel(count: number): string {
  return `${String(count)} step${count === 1 ? '' : 's'}`;
}

/**
 * Three-region chain builder (CHAIN-FR-05).
 *
 * The catalog on the left adds steps, the ordered list in the center reorders
 * them, and the editor on the right edits one selected step. Persistence and
 * named inputs are owned by CHAIN-06, so Save validates the current draft and
 * never writes a file from this screen.
 */
export function ChainBuilderPage({ projectId, chainId }: ChainBuilderPageProps) {
  const { search } = useRouter();
  const { announce } = useStatusAnnouncer();
  const {
    state,
    selectedStep,
    selectStep,
    addStep,
    updateStep,
    removeStep,
    moveStep,
    reorderStep,
    validation,
    reload,
  } = useChainDraft({ projectId, chainId, search });

  const [catalogSkills, setCatalogSkills] = useState<SkillEntry[]>([]);
  const [editorFocusRequest, setEditorFocusRequest] = useState(0);

  const handleCatalogChange = useCallback((entries: SkillEntry[]) => {
    setCatalogSkills(entries);
  }, []);

  const handleAddAsStep = useCallback(
    (skill: SkillEntry) => {
      addStep({ name: skill.name });
      setEditorFocusRequest((current) => current + 1);
    },
    [addStep],
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

  const handleSave = useCallback(() => {
    if (!validation.canSave) {
      return;
    }
    announce(
      'Draft is valid. Saving is not enabled on this screen yet, so no chain file was written.',
    );
  }, [announce, validation.canSave]);

  const skillOptions = useMemo(() => {
    const names = new Set(catalogSkills.map((skill) => skill.name));
    if (selectedStep !== null) {
      names.add(selectedStep.skillName);
    }
    return [...names].sort((left, right) => left.localeCompare(right));
  }, [catalogSkills, selectedStep]);

  const document = state.status === 'ready' ? state.document : null;
  const position =
    document === null || selectedStep === null
      ? null
      : document.steps.findIndex((step) => step.id === selectedStep.id) + 1;
  const canSave = state.status === 'ready' && validation.canSave;

  const saveHint = (() => {
    if (state.status !== 'ready') {
      return 'The chain must load before it can be saved.';
    }
    if (state.document.steps.length === 0) {
      return 'Add at least one skill as a step before saving.';
    }
    if (validation.issues.length > 0) {
      const count = validation.issues.length;
      return `${String(count)} step${count === 1 ? '' : 's'} need${
        count === 1 ? 's' : ''
      } an instruction before saving.`;
    }
    return 'All steps have instructions. Saving is not enabled on this screen yet.';
  })();

  return (
    <section aria-labelledby="chain-builder-title" data-testid="chain-builder-page">
      <p className="breadcrumb">
        <Link to={`/projects/${projectId}`}>← Project</Link>
      </p>

      <header className="builder-header">
        <div className="builder-header__identity">
          <h1 className="panel__title" id="chain-builder-title">
            Chain authoring
          </h1>
          <p className="lede">
            Assemble an ordered recipe from this project&apos;s skills. Slan guarantees
            prompt order; it cannot guarantee that a harness loads a named skill.
          </p>
        </div>
        <div className="builder-header__save">
          <button
            type="button"
            className="button"
            onClick={handleSave}
            disabled={!canSave}
            aria-describedby="chain-save-hint"
            data-testid="chain-save"
          >
            Save chain
          </button>
          <p className="field__hint" id="chain-save-hint">
            {saveHint}
          </p>
        </div>
      </header>

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

      {document !== null ? (
        <>
          <section className="builder-meta" aria-labelledby="builder-meta-title">
            <h2 className="section-title builder-meta__title" id="builder-meta-title">
              Builder
            </h2>
            <p className="builder-meta__name" data-testid="builder-chain-name">
              {document.name}
            </p>
            <p className="chain-card__badges">
              <span className="badge" data-testid="builder-harness" data-harness={document.harness}>
                Harness: {CHAIN_HARNESS_LABELS[document.harness]}
              </span>
              <span
                className="badge"
                data-testid="builder-session-mode"
                data-session-mode={document.sessionMode}
              >
                Session: {CHAIN_SESSION_MODE_LABELS[document.sessionMode]}
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
                <dd data-testid="builder-step-count">{stepsLabel(document.steps.length)}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>
                  {document.updatedAt === undefined
                    ? 'Not saved yet'
                    : new Intl.DateTimeFormat(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(document.updatedAt))}
                </dd>
              </div>
              <div>
                <dt>Inputs</dt>
                <dd data-testid="builder-input-count">
                  {String(document.inputs.length)} input
                  {document.inputs.length === 1 ? '' : 's'}
                </dd>
              </div>
            </dl>
            <p className="field__hint">
              This chain stays bound to {CHAIN_HARNESS_LABELS[document.harness]}. Per-step
              harness switching is unsupported; duplicate the chain to use another harness.
            </p>
          </section>

          <div className="chain-builder" data-testid="chain-builder">
            <div className="chain-builder__column chain-builder__catalog">
              <SkillCatalog
                projectId={projectId}
                context="builder"
                initialHarness={document.harness}
                onAddAsStep={handleAddAsStep}
                onCatalogChange={handleCatalogChange}
              />
            </div>

            <div className="chain-builder__column chain-builder__steps">
              <StepList
                steps={document.steps}
                selectedStepId={selectedStep?.id ?? null}
                invalidStepIds={validation.invalidStepIds}
                onSelect={selectStep}
                onMove={moveStep}
                onRemove={removeStep}
                onReorder={reorderStep}
              />
            </div>

            <div className="chain-builder__column chain-builder__editor">
              <StepEditor
                step={selectedStep}
                position={position === 0 ? null : position}
                totalSteps={document.steps.length}
                skillOptions={skillOptions}
                focusRequest={editorFocusRequest}
                onChange={handleStepChange}
              />
              {selectedStep === null ? null : (
                <p className="field__hint builder-editor-note">
                  Editing {stepDisplayName(selectedStep)}. Selection never reorders the
                  chain; use Move up and Move down in the list.
                </p>
              )}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
