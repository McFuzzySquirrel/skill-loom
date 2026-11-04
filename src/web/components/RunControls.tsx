import type { RefObject } from 'react';
import type {
  RunActionAvailability,
  RunActionName,
  RunMode,
  RunRecoveryOptions,
  RunStatus,
  StepStatus,
} from '../api/runs';

/**
 * Mode-specific run controls.
 *
 * Supervised runs expose explicit Done, Failed, and Skipped outcomes plus
 * Next, Retry, Skip, and Abort. Automatic runs expose Pause, Resume, Run next,
 * and Abort, and reuse Retry/Skip/Abort after a failure. The server-published
 * availability flags decide which mode-appropriate controls are enabled; a
 * button is never enabled for an action the run cannot currently accept.
 */

const SKIP_REASON = 'Skipped from the run view.';

export interface RunControlsProps {
  mode: RunMode;
  status: RunStatus;
  actions: RunActionAvailability;
  recovery: RunRecoveryOptions | null;
  currentStepStatus: StepStatus | null;
  busyAction: RunActionName | null;
  onAction: (action: RunActionName, reason?: string) => void;
  controlBarRef: RefObject<HTMLDivElement | null>;
  /** Hide explanatory copy for the dedicated terminal page. */
  compact?: boolean;
}

interface ControlDefinition {
  action: RunActionName;
  label: string;
  description: string;
  available: boolean;
  reason?: string;
  testId: string;
  variant?: 'primary' | 'danger';
}

function controlButton(
  definition: ControlDefinition,
  busyAction: RunActionName | null,
  onAction: RunControlsProps['onAction'],
) {
  const busy = busyAction !== null;
  const isCurrent = busyAction === definition.action;
  return (
    <button
      key={definition.action}
      type="button"
      className={
        definition.variant === 'danger'
          ? 'button button--secondary button--danger'
          : definition.variant === 'primary'
            ? 'button'
            : 'button button--secondary'
      }
      onClick={() => onAction(definition.action, definition.reason)}
      disabled={busy || !definition.available}
      aria-disabled={busy || !definition.available}
      data-testid={definition.testId}
      title={definition.description}
    >
      {isCurrent ? `${definition.label}…` : definition.label}
    </button>
  );
}

export function RunControls({
  mode,
  status,
  actions,
  recovery,
  currentStepStatus,
  busyAction,
  onAction,
  controlBarRef,
  compact = false,
}: RunControlsProps) {
  const busy = busyAction !== null;
  const className = compact ? 'run-controls run-controls--compact' : 'run-controls';

  if (recovery !== null) {
    return (
      <div
        className={className}
        role="group"
        aria-label="Run controls"
        tabIndex={-1}
        ref={controlBarRef}
        data-testid="run-controls"
      >
        <section className="run-recovery" aria-labelledby="run-recovery-title" data-testid="run-recovery">
          <h2 className="section-title" id="run-recovery-title">
            Interrupted run recovery
          </h2>
          <p className="state-note state-note--warning" data-testid="run-recovery-note">
            <span aria-hidden="true">⚠</span> This run is interrupted. Nothing replays until you
            choose an action, and no step starts automatically after a reload.
          </p>
          <div className="run-controls__buttons">
            <button
              type="button"
              className="button"
              onClick={() => onAction('retry')}
              disabled={!recovery.retry || busy}
              data-testid="run-recovery-retry"
            >
              Retry interrupted step
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => onAction('continue')}
              disabled={!recovery.continue || busy}
              data-testid="run-recovery-continue"
            >
              Continue from next pending step
            </button>
            <button
              type="button"
              className="button button--secondary button--danger"
              onClick={() => onAction('restart')}
              disabled={!recovery.restart || busy}
              data-testid="run-recovery-restart"
            >
              Restart chain
            </button>
          </div>
          <ul className="plain-list run-recovery__explain">
            <li>
              <strong>Retry interrupted step</strong> restarts only the step that was
              interrupted, with its existing session plan.
            </li>
            <li>
              <strong>Continue from next pending step</strong> leaves every finished step alone
              and starts at the next pending step.
            </li>
            <li>
              <strong>Restart chain</strong> creates a new run from the frozen snapshot. It does
              not rewrite the saved chain.
            </li>
          </ul>
        </section>
      </div>
    );
  }

  const supervisedOutcomes: ControlDefinition[] = [];
  const supervisedControls: ControlDefinition[] = [];
  const automaticControls: ControlDefinition[] = [];
  const failureStep =
    currentStepStatus === 'failed' || currentStepStatus === 'interrupted';

  if (mode === 'supervised') {
    // Outcome and control buttons stay in a stable order. The server-published
    // availability flags decide which are enabled, never color or position.
    supervisedOutcomes.push(
      {
        action: 'done',
        label: 'Mark done',
        description: 'Record this step as Done. Next becomes available.',
        available: actions.done,
        testId: 'run-outcome-done',
        variant: 'primary',
      },
      {
        action: 'failed',
        label: 'Mark failed',
        description: 'Record this step as Failed and pause the chain for Retry, Skip, or Abort.',
        available: actions.failed,
        testId: 'run-outcome-failed',
      },
      {
        action: 'skipped',
        label: 'Mark skipped',
        description: 'Record this step as Skipped with an explicit reason. Next becomes available.',
        available: actions.skip,
        reason: SKIP_REASON,
        testId: 'run-outcome-skipped',
      },
    );

    supervisedControls.push(
      {
        action: 'next',
        label: 'Next',
        description: 'Advance to the next step. Available only after Done or Skipped.',
        available: actions.next,
        testId: 'run-control-next',
        variant: 'primary',
      },
      {
        action: 'retry',
        label: 'Retry',
        description: 'Restart the current failed or interrupted step with the same session plan.',
        available: actions.retry,
        testId: 'run-control-retry',
      },
      {
        action: 'skip',
        label: 'Skip',
        description: 'Record this step as skipped without rerunning it.',
        available: actions.skip,
        reason: SKIP_REASON,
        testId: 'run-control-skip',
      },
      {
        action: 'abort',
        label: 'Abort',
        description: 'Stop the run and close the harness process. No step is replayed.',
        available: actions.abort,
        testId: 'run-control-abort',
        variant: 'danger',
      },
    );
  } else {
    automaticControls.push(
      {
        action: 'pause',
        label: 'Pause',
        description: 'Ask the automatic run to stop before the next step.',
        available: actions.pause,
        testId: 'run-control-pause',
      },
      {
        action: 'resume',
        label: 'Resume',
        description: 'Clear the pause request and let the current automatic signal advance.',
        available: actions.resume,
        testId: 'run-control-resume',
        variant: 'primary',
      },
      {
        action: 'run-next',
        label: 'Run next',
        description: 'Start the next pending step after a pause.',
        available: actions.runNext,
        testId: 'run-control-run-next',
        variant: 'primary',
      },
    );

    // Retry and Skip are the failure choices named by RUN-FR-08. They are not
    // part of a healthy automatic control bar, so they appear only when the
    // current step has failed or was interrupted.
    if (failureStep || actions.retry || actions.skip) {
      automaticControls.push(
        {
          action: 'retry',
          label: 'Retry',
          description: 'Restart the failed automatic step with the same session plan.',
          available: actions.retry,
          testId: 'run-control-retry',
        },
        {
          action: 'skip',
          label: 'Skip',
          description: 'Record the failed step as skipped and keep the run paused.',
          available: actions.skip,
          reason: SKIP_REASON,
          testId: 'run-control-skip',
        },
      );
    }

    automaticControls.push({
      action: 'abort',
      label: 'Abort',
      description: 'Stop the run and close the harness process. No step is replayed.',
      available: actions.abort,
      testId: 'run-control-abort',
      variant: 'danger',
    });
  }

  const outcomes = mode === 'supervised' ? supervisedOutcomes : [];
  const controls = mode === 'supervised' ? supervisedControls : automaticControls;
  const showFailureHint =
    failureStep || status === 'failed' || (status === 'paused' && (actions.retry || actions.skip));

  return (
    <div
      className={className}
      role="group"
      aria-label="Run controls"
      tabIndex={-1}
      ref={controlBarRef}
      data-testid="run-controls"
      data-mode={mode}
    >
      {showFailureHint ? (
        <p className="state-note state-note--warning" data-testid="run-failure-hint">
          <span aria-hidden="true">⚠</span> The chain is paused. Choose Retry, Skip, or Abort.
          The run never continues through a failure automatically.
        </p>
      ) : null}

      {outcomes.length > 0 ? (
        <div className="run-controls__group" data-testid="run-outcomes">
          <h2 className="section-title">Mark the current step</h2>
          <div className="run-controls__buttons">
            {outcomes.map((definition) => controlButton(definition, busyAction, onAction))}
          </div>
        </div>
      ) : null}

      {controls.length > 0 ? (
        <div className="run-controls__group" data-testid="run-mode-controls">
          <h2 className="section-title">
            {mode === 'supervised' ? 'Supervised controls' : 'Automatic controls'}
          </h2>
          <div className="run-controls__buttons">
            {controls.map((definition) => controlButton(definition, busyAction, onAction))}
          </div>
        </div>
      ) : null}

      {outcomes.length === 0 && controls.length === 0 ? (
        <p className="state-note" data-testid="run-controls-empty">
          <span aria-hidden="true">○</span> No run controls are available for this state.
        </p>
      ) : null}

      <p className="field__hint">
        Every control is a separate explicit action. A page load, a timer, or a terminal
        transition never sends one. Skills are model-invoked context: Slan guarantees prompt
        order, not that the harness fires a named skill.
      </p>
    </div>
  );
}
