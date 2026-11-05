import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import type { ApiClientError } from '../api/client';
import {
  runTerminalPath,
  type Run,
  type RunActionName,
} from '../api/runs';
import { InlineError } from '../components/InlineError';
import { RunControls } from '../components/RunControls';
import { StatusText, stepDisplayName } from '../components/StepRail';
import { TerminalPane } from '../components/TerminalPane';
import { useRunStream } from '../hooks/useRunStream';
import { Link, useRouter } from '../router';
import { useWorkspace } from '../WorkspaceContext';

export interface TerminalRunPageProps {
  runId: string;
}

const MODE_LABELS: Record<Run['mode'], string> = {
  supervised: 'Supervised',
  automatic: 'Automatic',
};

function formatElapsed(run: Run, now: number): string {
  if (run.startedAt === null) {
    return 'Not started';
  }
  const start = Date.parse(run.startedAt);
  const end = run.finishedAt === null ? now : Date.parse(run.finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return 'Unknown';
  }
  const totalSeconds = Math.floor((end - start) / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes >= 60
    ? `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m ${String(seconds)}s`
    : `${String(minutes)}m ${String(seconds)}s`;
}

/**
 * Dedicated full-height terminal view.
 *
 * This route keeps the xterm surface visible without scrolling past step
 * details. It carries compact mode controls and links back to the full run
 * view for recovery guidance and step metadata.
 */
export function TerminalRunPage({ runId }: TerminalRunPageProps) {
  const { navigate } = useRouter();
  const { setInfo } = useWorkspace();
  const stream = useRunStream({ runId });
  const controlsRef = useRef<HTMLDivElement>(null);
  const [clock, setClock] = useState(() => Date.now());

  const view = stream.view;
  const run = view?.run ?? null;

  useEffect(() => {
    if (run !== null) {
      setInfo({
        projectId: run.projectId,
        chainId: run.chainId,
        chainName: run.chainSnapshot.name,
        runId: run.id,
      });
    }
  }, [run, setInfo]);
  const isActive =
    run !== null &&
    (run.status === 'starting' ||
      run.status === 'running' ||
      run.status === 'awaiting-user' ||
      run.status === 'paused');

  useEffect(() => {
    if (!isActive) {
      return;
    }
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [isActive]);

  const currentStep =
    run === null ? null : (run.steps[run.currentStepIndex] ?? null);
  const currentStepName =
    run === null || currentStep === null
      ? null
      : stepDisplayName(run, currentStep.id);

  const elapsed = useMemo(() => {
    if (run === null) {
      return 'Unknown';
    }
    void clock;
    return formatElapsed(run, clock);
  }, [clock, run]);

  const handleAction = useCallback(
    async (action: RunActionName, reason?: string) => {
      const result = await stream.applyAction(action, reason);
      if (result?.restartedFrom !== null && result?.restartedFrom !== undefined) {
        navigate(`/runs/${encodeURIComponent(result.run.id)}/terminal`, { replace: true });
      }
    },
    [navigate, stream],
  );

  const handleExitTerminal = useCallback(() => {
    controlsRef.current?.focus();
  }, []);

  if (stream.phase === 'loading') {
    return (
      <section className="run-terminal-page" data-testid="run-terminal-page">
        <h1 className="panel__title">Run terminal</h1>
        <p className="state-note">
          <span aria-hidden="true">◌</span> Loading the run snapshot…
        </p>
      </section>
    );
  }

  if (stream.phase === 'error' || view === null || run === null) {
    return (
      <section className="run-terminal-page" data-testid="run-terminal-page">
        <h1 className="panel__title">Run terminal</h1>
        <InlineError
          title="Run request failed"
          message={
            (stream.error as ApiClientError | null)?.message ??
            'The run could not be loaded because of an unexpected error.'
          }
          {...(stream.error === null
            ? {}
            : { code: stream.error.code, httpStatus: stream.error.status })}
          onRetry={stream.reload}
        />
        <p className="panel__actions">
          <Link className="button button--secondary" to="/projects">
            Back to projects
          </Link>
        </p>
      </section>
    );
  }

  const terminalId = view.terminalId;
  const detailsPath = `/runs/${encodeURIComponent(run.id)}`;

  return (
    <section className="run-terminal-page" aria-labelledby="run-terminal-page-title" data-testid="run-terminal-page">
      <header className="run-terminal-page__header">
        <div className="run-terminal-page__identity">
          <h1 className="panel__title" id="run-terminal-page-title">
            Run terminal
          </h1>
          <p className="run-header__chain" data-testid="terminal-run-chain-name">
            {run.chainSnapshot.name}
          </p>
        </div>

        <p className="run-terminal-page__status">
          <span className="status-tag status-tag--run" data-testid="terminal-run-status" data-status={run.status}>
            <StatusText status={run.status} kind="run" />
          </span>
          <span className="field__hint">
            {MODE_LABELS[run.mode]} · Step {run.currentStepIndex + 1} of{' '}
            {run.steps.length}
            {currentStepName === null ? '' : ` · ${currentStepName}`} · {elapsed}
          </span>
        </p>

        <p className="panel__actions run-terminal-page__links">
          <Link className="button button--secondary button--small" to={detailsPath}>
            Run details
          </Link>
          <Link className="button button--secondary button--small" to="/projects">
            Projects
          </Link>
        </p>
      </header>

      {stream.actionError !== null ? (
        <InlineError
          title="Run action failed"
          message={stream.actionError.message}
          code={stream.actionError.code}
          httpStatus={stream.actionError.status}
          onRetry={stream.dismissActionError}
          retryLabel="Dismiss"
        />
      ) : null}

      <RunControls
        compact
        mode={run.mode}
        status={run.status}
        actions={view.actions}
        recovery={view.recovery}
        currentStepStatus={run.steps[run.currentStepIndex]?.status ?? null}
        busyAction={stream.busyAction}
        onAction={(action, reason) => void handleAction(action, reason)}
        controlBarRef={controlsRef}
      />

      <div className="run-terminal-page__surface">
        {terminalId !== null ? (
          <TerminalPane
            sessionId={terminalId}
            terminalPath={runTerminalPath(terminalId)}
            label={`Harness terminal for ${run.chainSnapshot.name}`}
            onExitFocus={handleExitTerminal}
            testId="run-terminal"
            screenTestId="run-terminal-screen"
            reconnectOnClose
            dense
            exitHint="Escape leaves the terminal and returns focus to the compact run controls."
          />
        ) : (
          <div className="run-terminal__empty" data-testid="run-terminal-empty">
            <p className="state-note">
              <span aria-hidden="true">○</span>{' '}
              {run.status === 'completed' ||
              run.status === 'aborted' ||
              run.status === 'failed' ||
              run.status === 'interrupted'
                ? 'This run has finished and its terminal session is closed. Open run details for the recorded status and recovery choices.'
                : 'No attachable terminal is live for this run. Open run details for the full status and controls.'}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
