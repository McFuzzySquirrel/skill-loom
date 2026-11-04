import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import type { ChainStep } from '../api/chains';
import { stepDisplayName } from '../hooks/useChainDraft';

export interface StepListProps {
  steps: ChainStep[];
  selectedStepId: string | null;
  invalidStepIds: ReadonlySet<string>;
  /** Per-step text label for a blocking issue; defaults to "Needs instruction". */
  stepIssueLabels?: ReadonlyMap<string, string>;
  onSelect: (stepId: string) => void;
  onMove: (stepId: string, direction: 'up' | 'down') => void;
  onRemove: (stepId: string) => void;
  onReorder: (draggedStepId: string, targetStepId: string) => void;
}

type MoveDirection = 'up' | 'down';

function instructionExcerpt(instruction: string): string {
  const collapsed = instruction.replace(/\s+/g, ' ').trim();
  if (collapsed === '') {
    return 'No instruction yet.';
  }
  return collapsed.length > 96 ? `${collapsed.slice(0, 96)}…` : collapsed;
}

/**
 * Ordered chain steps (CHAIN-FR-05).
 *
 * Pointer dragging is an enhancement backed by native HTML drag events. Every
 * row also exposes Move up and Move down, which are the keyboard path. Focus
 * stays on the moved row after a reorder, and the list never rewrites step
 * content, so unsaved instruction text survives every move.
 */
export function StepList({
  steps,
  selectedStepId,
  invalidStepIds,
  stepIssueLabels,
  onSelect,
  onMove,
  onRemove,
  onReorder,
}: StepListProps) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const hintId = `${baseId}-hint`;
  const heading = useRef<HTMLHeadingElement>(null);
  const selectButtons = useRef(new Map<string, HTMLButtonElement>());
  const moveButtons = useRef(new Map<string, HTMLButtonElement>());
  const pendingMoveFocus = useRef<{ stepId: string; action: MoveDirection } | null>(null);
  const pendingRemoveFocus = useRef<{ stepId: string | null } | null>(null);
  const dragId = useRef<string | null>(null);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  useEffect(() => {
    const moveFocus = pendingMoveFocus.current;
    if (moveFocus !== null) {
      pendingMoveFocus.current = null;
      const position = steps.findIndex((step) => step.id === moveFocus.stepId);
      const button = moveButtons.current.get(`${moveFocus.stepId}:${moveFocus.action}`);
      if (button !== undefined && !button.disabled) {
        button.focus();
      } else if (position >= 0) {
        selectButtons.current.get(moveFocus.stepId)?.focus();
      } else {
        heading.current?.focus();
      }
      return;
    }

    const removeFocus = pendingRemoveFocus.current;
    if (removeFocus !== null) {
      pendingRemoveFocus.current = null;
      if (removeFocus.stepId === null) {
        heading.current?.focus();
      } else {
        selectButtons.current.get(removeFocus.stepId)?.focus();
      }
    }
  }, [steps]);

  const handleMove = (stepId: string, direction: MoveDirection) => {
    pendingMoveFocus.current = { stepId, action: direction };
    onMove(stepId, direction);
  };

  const handleRemove = (stepId: string) => {
    const index = steps.findIndex((step) => step.id === stepId);
    const neighbor = steps[index + 1] ?? steps[index - 1] ?? null;
    pendingRemoveFocus.current = { stepId: neighbor?.id ?? null };
    onRemove(stepId);
  };

  const handleDragStart = (event: DragEvent<HTMLLIElement>, stepId: string) => {
    dragId.current = stepId;
    setDraggingId(stepId);
    setDropTargetId(null);
    if (event.dataTransfer !== null) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', stepId);
    }
  };

  const handleDrop = (event: DragEvent<HTMLLIElement>, targetStepId: string) => {
    event.preventDefault();
    const dragged =
      dragId.current ??
      (event.dataTransfer === null ? null : event.dataTransfer.getData('text/plain'));
    dragId.current = null;
    setDraggingId(null);
    setDropTargetId(null);
    if (dragged !== null && dragged !== '' && dragged !== targetStepId) {
      onReorder(dragged, targetStepId);
    }
  };

  const handleDragEnd = () => {
    dragId.current = null;
    setDraggingId(null);
    setDropTargetId(null);
  };

  return (
    <section className="builder-panel step-panel" aria-labelledby={titleId}>
      <div className="builder-panel__heading">
        <h2 className="section-title builder-panel__title" id={titleId} ref={heading} tabIndex={-1}>
          Steps
        </h2>
        <span className="builder-panel__count" data-testid="step-list-count">
          {String(steps.length)} step{steps.length === 1 ? '' : 's'}
        </span>
      </div>

      <p className="field__hint" id={hintId}>
        Drag a step to reorder, or use Move up and Move down. Selecting a step opens it
        in the editor. Reordering never discards unsaved text.
      </p>

      {steps.length === 0 ? (
        <div className="empty-state" data-testid="step-list-empty">
          <p>No steps yet.</p>
          <p>
            Expand a skill in the catalog and choose <strong>Add as step</strong> to start
            building the ordered recipe.
          </p>
        </div>
      ) : (
        <>
          <p className="builder-panel__drag-hint" aria-hidden="true">
            <span className="step-row__handle">⠿</span> Drag handle
          </p>
          <ol className="step-list" aria-labelledby={titleId} aria-describedby={hintId}>
            {steps.map((step, index) => {
              const selected = step.id === selectedStepId;
              const invalid = invalidStepIds.has(step.id);
              const displayName = stepDisplayName(step);
              const canMoveUp = index > 0;
              const canMoveDown = index < steps.length - 1;
              const dropTarget = dropTargetId === step.id && draggingId !== step.id;

              return (
                <li
                  className={`step-row${selected ? ' step-row--selected' : ''}${
                    draggingId === step.id ? ' step-row--dragging' : ''
                  }${dropTarget ? ' step-row--drop-target' : ''}`}
                  key={step.id}
                  draggable
                  data-testid="step-row"
                  data-step-id={step.id}
                  data-skill-name={step.skillName}
                  data-position={String(index + 1)}
                  aria-posinset={index + 1}
                  aria-setsize={steps.length}
                  onDragStart={(event) => handleDragStart(event, step.id)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (event.dataTransfer !== null) {
                      event.dataTransfer.dropEffect = 'move';
                    }
                    if (draggingId !== null && draggingId !== step.id) {
                      setDropTargetId(step.id);
                    }
                  }}
                  onDragLeave={() => {
                    setDropTargetId((current) => (current === step.id ? null : current));
                  }}
                  onDrop={(event) => handleDrop(event, step.id)}
                  onDragEnd={handleDragEnd}
                >
                  <span
                    className="step-row__handle"
                    aria-hidden="true"
                    title="Drag to reorder"
                    draggable
                  >
                    ⠿
                  </span>
                  <span className="step-row__number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <button
                    type="button"
                    className="step-row__identity"
                    ref={(node) => {
                      if (node === null) {
                        selectButtons.current.delete(step.id);
                      } else {
                        selectButtons.current.set(step.id, node);
                      }
                    }}
                    onClick={() => onSelect(step.id)}
                    aria-current={selected ? 'step' : undefined}
                    aria-label={`Select step ${String(index + 1)}: ${displayName} (${step.skillName})`}
                    data-testid="step-select"
                  >
                    <span className="step-row__label">{displayName}</span>
                    <span className="step-row__skill">{step.skillName}</span>
                    <span className="step-row__excerpt">{instructionExcerpt(step.instruction)}</span>
                    {invalid ? (
                      <span
                        className="status-tag status-tag--warning step-row__warning"
                        data-testid="step-needs-instruction"
                      >
                        <span aria-hidden="true">▲</span>{' '}
                        {stepIssueLabels?.get(step.id) ?? 'Needs instruction'}
                      </span>
                    ) : null}
                  </button>
                  <div className="step-row__actions">
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      ref={(node) => {
                        if (node === null) {
                          moveButtons.current.delete(`${step.id}:up`);
                        } else {
                          moveButtons.current.set(`${step.id}:up`, node);
                        }
                      }}
                      onClick={() => handleMove(step.id, 'up')}
                      disabled={!canMoveUp}
                      aria-label={`Move up ${displayName}, step ${String(index + 1)}`}
                      data-testid="step-move-up"
                    >
                      Move up
                    </button>
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      ref={(node) => {
                        if (node === null) {
                          moveButtons.current.delete(`${step.id}:down`);
                        } else {
                          moveButtons.current.set(`${step.id}:down`, node);
                        }
                      }}
                      onClick={() => handleMove(step.id, 'down')}
                      disabled={!canMoveDown}
                      aria-label={`Move down ${displayName}, step ${String(index + 1)}`}
                      data-testid="step-move-down"
                    >
                      Move down
                    </button>
                    <button
                      type="button"
                      className="button button--secondary button--small button--danger"
                      onClick={() => handleRemove(step.id)}
                      aria-label={`Remove step ${String(index + 1)}: ${displayName} (${step.skillName})`}
                      data-testid="step-remove"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
