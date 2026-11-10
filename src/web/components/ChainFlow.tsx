import type { ChainStep } from '../api/chains';
import { stepDisplayName } from '../hooks/useChainDraft';

export interface ChainFlowProps {
  steps: ChainStep[];
  selectedStepId: string | null;
  invalidStepIds: ReadonlySet<string>;
  onSelect: (stepId: string) => void;
  onReorder: (draggedStepId: string, targetStepId: string) => void;
}

/**
 * Visual overview of the chain as a connected flow. Nodes are real buttons so
 * the keyboard path stays available; dragging a node onto another one moves it.
 * Every node carries its number and kind as text, never color alone.
 */
export function ChainFlow({
  steps,
  selectedStepId,
  invalidStepIds,
  onSelect,
  onReorder,
}: ChainFlowProps) {
  if (steps.length === 0) {
    return <p className="state-note">This chain has no steps yet.</p>;
  }

  return (
    <ol className="chain-flow" aria-label="Chain flow" data-testid="chain-flow">
      {steps.map((step, index) => (
        <li key={step.id} className="chain-flow__item">
          <button
            type="button"
            className={`chain-flow__node${step.id === selectedStepId ? ' chain-flow__node--selected' : ''}${
              invalidStepIds.has(step.id) ? ' chain-flow__node--invalid' : ''
            }`}
            draggable
            aria-current={step.id === selectedStepId ? 'step' : undefined}
            onClick={() => onSelect(step.id)}
            onDragStart={(event) => {
              event.dataTransfer.setData('text/plain', step.id);
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const draggedId = event.dataTransfer.getData('text/plain');
              if (draggedId !== '' && draggedId !== step.id) {
                onReorder(draggedId, step.id);
              }
            }}
          >
            <span className="chain-flow__number">{String(index + 1)}</span>
            <span className="chain-flow__kind">
              {step.kind === 'instruction' ? 'Instruction' : 'Skill'}
            </span>
            <span className="chain-flow__name">{stepDisplayName(step)}</span>
            {invalidStepIds.has(step.id) ? (
              <span className="chain-flow__issue">▲ Needs attention</span>
            ) : null}
          </button>
          {index < steps.length - 1 ? (
            <span className="chain-flow__arrow" aria-hidden="true">→</span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
