import type { ReactNode } from 'react';
import type { Run, RunStatus, StepStatus } from '../api/runs';

/**
 * Horizontal step rail for the run view.
 *
 * Every step shows an icon plus the visible status word, so pending, running,
 * done, failed, skipped, and interrupted stay distinguishable without color.
 * The rail is a real ordered list of buttons and is fully keyboard operable.
 */

export const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
  interrupted: 'Interrupted',
};

export const STEP_STATUS_ICONS: Record<StepStatus, string> = {
  pending: '○',
  running: '▶',
  done: '✓',
  failed: '✕',
  skipped: '↷',
  interrupted: '⚠',
};

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  starting: 'Starting',
  running: 'Running',
  'awaiting-user': 'Awaiting user',
  paused: 'Paused',
  failed: 'Failed',
  completed: 'Completed',
  aborted: 'Aborted',
  interrupted: 'Interrupted',
};

export const RUN_STATUS_ICONS: Record<RunStatus, string> = {
  starting: '◌',
  running: '▶',
  'awaiting-user': '⏸',
  paused: '⏸',
  failed: '✕',
  completed: '✓',
  aborted: '■',
  interrupted: '⚠',
};

export function stepDisplayName(run: Run, stepId: string): string {
  const snapshotStep = run.chainSnapshot.steps.find((step) => step.id === stepId);
  if (snapshotStep?.label !== undefined && snapshotStep.label !== '') {
    return snapshotStep.label;
  }
  if (snapshotStep !== undefined) {
    return snapshotStep.kind === 'instruction' ? 'Instruction' : snapshotStep.skillName;
  }
  const record = run.steps.find((step) => step.id === stepId);
  return record?.label ?? record?.skillName ?? (record?.kind === 'instruction' ? 'Instruction' : 'Step');
}

export interface StatusTextProps {
  status: StepStatus | RunStatus;
  kind: 'step' | 'run';
  children?: ReactNode;
}

/** Icon plus text status; the text is always present in the accessibility tree. */
export function StatusText({ status, kind, children }: StatusTextProps) {
  const labels = kind === 'step' ? STEP_STATUS_LABELS : RUN_STATUS_LABELS;
  const icons = kind === 'step' ? STEP_STATUS_ICONS : RUN_STATUS_ICONS;
  const label = (labels as Record<string, string>)[status] ?? status;
  const icon = (icons as Record<string, string>)[status] ?? '•';

  return (
    <span className={`status-text status-text--${status}`}>
      <span aria-hidden="true">{icon}</span>
      <span>{children ?? label}</span>
    </span>
  );
}

export interface StepRailProps {
  run: Run;
  selectedStepId: string | null;
  onSelect: (stepId: string) => void;
}

export function StepRail({ run, selectedStepId, onSelect }: StepRailProps) {
  return (
    <section className="run-step-rail" aria-labelledby="run-step-rail-title" data-testid="step-rail">
      <div className="run-step-rail__heading">
        <h2 className="section-title" id="run-step-rail-title">
          Steps
        </h2>
        <p className="field__hint">
          Status is shown as an icon and text. Select a step to read its instruction and failure
          reason.
        </p>
      </div>

      <ol className="step-rail">
        {run.steps.map((step) => {
          const selected = step.id === selectedStepId;
          const name = stepDisplayName(run, step.id);
          const awaitingUser =
            step.status === 'running' &&
            step.index === run.currentStepIndex &&
            run.status === 'awaiting-user';
          const statusLabel = awaitingUser ? 'Awaiting user' : STEP_STATUS_LABELS[step.status];
          const statusIcon = awaitingUser ? '⏸' : STEP_STATUS_ICONS[step.status];

          return (
            <li key={step.id} className={`step-rail__item step-rail__item--${step.status}`}>
              <button
                type="button"
                className={`step-rail__button${selected ? ' step-rail__button--selected' : ''}`}
                aria-current={selected ? 'step' : undefined}
                onClick={() => onSelect(step.id)}
                data-testid={`step-item-${String(step.index)}`}
                data-step-id={step.id}
                data-status={step.status}
                data-display-status={awaitingUser ? 'awaiting-user' : step.status}
              >
                <span className="step-rail__index" aria-hidden="true">
                  {String(step.index + 1)}
                </span>
                <span className="step-rail__identity">
                  <span className="step-rail__label">{name}</span>
                  <span className="step-rail__skill">{step.kind === 'instruction' ? 'Instruction' : step.skillName}</span>
                </span>
                <span
                  className="step-rail__status"
                  data-testid={`step-status-${String(step.index)}`}
                >
                  <span
                    className={`status-text status-text--${awaitingUser ? 'awaiting-user' : step.status}`}
                  >
                    <span aria-hidden="true">{statusIcon}</span>
                    <span>{statusLabel}</span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
