import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClientError } from '../api/client';
import {
  discoveryWorkspaceApi,
  type DiscoveryWorkspace,
} from '../api/discovery';
import {
  runTerminalPath,
  type Run,
  type RunActionName,
  type RunStep,
  type RunView,
} from '../api/runs';
import { InlineError } from '../components/InlineError';
import { HelpPopover } from '../components/HelpPopover';
import { RunControls } from '../components/RunControls';
import { StatusText, StepRail, stepDisplayName } from '../components/StepRail';
import { TerminalPane } from '../components/TerminalPane';
import { useRunStream } from '../hooks/useRunStream';
import { CHAIN_HARNESS_LABELS, CHAIN_SESSION_MODE_LABELS } from '../hooks/useChains';
import { Link, useRouter } from '../router';
import { useWorkspace } from '../WorkspaceContext';
import { toApiClientError } from '../api/projects';

/**
 * Terminal-dominant run view (RUN-FR-12).
 *
 * The terminal, step rail, and mode-specific controls stay visible together.
 * The view attaches to a live session, shows an interrupted recovery panel
 * when no session survives, and never starts, advances, or retries a step on
 * mount, on a timer, or because terminal output changed.
 */

export interface RunPageProps {
  runId: string;
}

const MODE_LABELS: Record<Run['mode'], string> = {
  supervised: 'Supervised',
  automatic: 'Automatic',
};

const OBSERVATION_LABELS: Record<string, string> = {
  unknown: 'Not reported yet (best-effort observation only)',
  'not-observable': 'Not observable in interactive output (best-effort only)',
  observed: 'Observed in harness output (best-effort only)',
  'not-observed': 'Not observed in harness output (best-effort only)',
};

function formatElapsed(startedAt: string | null, finishedAt: string | null): string {
  if (startedAt === null) {
    return 'Not started';
  }
  const start = Date.parse(startedAt);
  const end = finishedAt === null ? Date.now() : Date.parse(finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return 'Unknown';
  }
  const totalSeconds = Math.floor((end - start) / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${String(hours)}h ${String(minutes % 60)}m ${String(seconds)}s`;
  }
  return `${String(minutes)}m ${String(seconds)}s`;
}

function stepFor(view: RunView, stepId: string | null): RunStep | null {
  if (stepId === null) {
    return view.run.steps[view.run.currentStepIndex] ?? null;
  }
  return view.run.steps.find((step) => step.id === stepId) ?? null;
}

function RunStepDetail({ run, step }: { run: Run; step: RunStep }) {
  const snapshot = run.chainSnapshot.steps.find((entry) => entry.id === step.id);
  const name = stepDisplayName(run, step.id);

  return (
    <section className="run-step-detail" aria-labelledby="run-step-detail-title" data-testid="run-step-detail">
      <div className="run-step-detail__heading">
        <div>
          <div className="page-title-row">
            <h2 className="section-title" id="run-step-detail-title">
              Step {step.index + 1}: {name}
            </h2>
            <HelpPopover topic="runControls" />
          </div>
          <p className="field__hint">
            {step.kind === 'instruction' ? 'Instruction step' : <>Skill: <code>{step.skillName}</code></>}
          </p>
        </div>
        <span className="badge" data-testid="run-step-detail-status">
          <StatusText status={step.status} kind="step" />
        </span>
      </div>

      <p className="run-step-detail__instruction">
        {snapshot?.instruction ?? 'The instruction is unavailable in this run snapshot.'}
      </p>

      {step.reason !== null ? (
        <p className="state-note state-note--warning" data-testid="run-step-reason">
          <span aria-hidden="true">⚠</span> Reason: {step.reason}
        </p>
      ) : null}

      <dl className="detail-grid run-step-detail__meta">
        <div>
          <dt>Exit code</dt>
          <dd>{step.exitCode === null ? 'Not reported' : String(step.exitCode)}</dd>
        </div>
        <div>
          <dt>Session</dt>
          <dd>{step.sessionId ?? run.sessionId ?? 'Not assigned'}</dd>
        </div>
        <div>
          <dt>Fork mechanism</dt>
          <dd>{step.forkMechanism}</dd>
        </div>
        <div>
          <dt>Skill observation</dt>
          <dd data-testid="run-observation">
            {OBSERVATION_LABELS[step.skillObservation] ?? step.skillObservation}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function RunFailurePanel({ run }: { run: Run }) {
  const step = run.steps[run.currentStepIndex];
  if (
    run.status !== 'failed' &&
    run.status !== 'paused' &&
    run.status !== 'interrupted' &&
    step?.status !== 'failed'
  ) {
    return null;
  }

  const name = step === undefined ? 'The current step' : stepDisplayName(run, step.id);
  const reason = step?.reason ?? run.reason;

  return (
    <section className="run-failure" aria-labelledby="run-failure-title" data-testid="run-failure">
      <h2 className="section-title" id="run-failure-title">
        <span aria-hidden="true">⚠</span>{' '}
        {run.status === 'interrupted' ? 'Run interrupted' : 'Run paused'}
      </h2>
      <p>
        {name} needs attention. Retry, Skip, and Abort remain available; the chain never
        continues through a failure automatically.
      </p>
      {reason === null ? null : (
        <p className="run-failure__reason" data-testid="run-failure-reason">
          Reason: {reason}
        </p>
      )}
    </section>
  );
}

export function RunPage({ runId }: RunPageProps) {
  const { navigate } = useRouter();
  const { setInfo } = useWorkspace();
  const stream = useRunStream({ runId });
  const controlsRef = useRef<HTMLDivElement>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const lastCurrentIndexRef = useRef<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [discoveryWorkspace, setDiscoveryWorkspace] = useState<DiscoveryWorkspace | null>(null);
  const [discoveryResult, setDiscoveryResult] = useState<{ bundle: unknown; fingerprint: string } | null>(null);
  const [discoveryResultError, setDiscoveryResultError] = useState<ApiClientError | null>(null);
  const [resultContentsReviewed, setResultContentsReviewed] = useState(false);
  const [resultRedistributionReviewed, setResultRedistributionReviewed] = useState(false);
  const [resultBusy, setResultBusy] = useState(false);

  const view = stream.view;
  const run = view?.run ?? null;

  useEffect(() => {
    if (run === null) return;
    let active = true;
    void discoveryWorkspaceApi.list().then((workspaces) => {
      if (!active) return;
      setDiscoveryWorkspace(workspaces.find((candidate) =>
        candidate.projectId === run.projectId && candidate.chainId === run.chainId,
      ) ?? null);
    }).catch(() => {
      if (active) setDiscoveryWorkspace(null);
    });
    return () => {
      active = false;
    };
  }, [run?.projectId, run?.chainId, run?.status]);

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

  useEffect(() => {
    if (run === null) {
      return;
    }
    // Follow the active step when the run advances. A manual selection on the
    // same step is preserved until the next transition.
    if (lastCurrentIndexRef.current !== run.currentStepIndex) {
      lastCurrentIndexRef.current = run.currentStepIndex;
      setSelectedStepId(run.steps[run.currentStepIndex]?.id ?? null);
    }
  }, [run]);

  const isActive =
    run !== null &&
    (run.status === 'starting' || run.status === 'running' || run.status === 'awaiting-user' || run.status === 'paused');

  useEffect(() => {
    if (!isActive) {
      return;
    }
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [isActive]);

  const selectedStep = view === null ? null : stepFor(view, selectedStepId);
  const terminalId = view?.terminalId ?? null;
  const elapsed = useMemo(() => {
    if (run === null) {
      return 'Unknown';
    }
    // `clock` updates only the visible elapsed label; it never drives an action.
    void clock;
    return formatElapsed(run.startedAt, run.finishedAt);
  }, [clock, run]);

  const handleAction = useCallback(
    async (action: RunActionName, reason?: string) => {
      if (action === 'done' && discoveryWorkspace !== null) {
        if (
          discoveryResult === null ||
          !resultContentsReviewed ||
          !resultRedistributionReviewed
        ) {
          setDiscoveryResultError(new ApiClientError(
            'Load and review the complete result and redistribution rights before marking discovery Done.',
            { code: 'DISCOVERY_RESULT_REVIEW_REQUIRED', status: 0 },
          ));
          return;
        }
        setResultBusy(true);
        try {
          await discoveryWorkspaceApi.reviewResult(
            discoveryWorkspace.id,
            discoveryResult.fingerprint,
          );
        } catch (error) {
          setDiscoveryResultError(toApiClientError(error, 'The discovery result could not be reviewed.'));
          setResultBusy(false);
          return;
        }
      }
      const result = await stream.applyAction(action, reason);
      setResultBusy(false);
      if (result?.run.status === 'completed' && discoveryWorkspace !== null) {
        if (result.discoveryImportError !== undefined) {
          setDiscoveryResultError(new ApiClientError(
            result.discoveryImportError.message,
            { code: result.discoveryImportError.code, status: 0 },
          ));
        }
        const workspaces = await discoveryWorkspaceApi.list().catch(() => []);
        setDiscoveryWorkspace(workspaces.find((candidate) => candidate.id === discoveryWorkspace.id) ?? discoveryWorkspace);
      }
      if (result?.restartedFrom !== null && result?.restartedFrom !== undefined) {
        navigate(`/runs/${encodeURIComponent(result.run.id)}`, { replace: true });
      }
    },
    [discoveryResult, discoveryWorkspace, navigate, resultContentsReviewed, resultRedistributionReviewed, stream],
  );

  const loadDiscoveryResult = async () => {
    if (discoveryWorkspace === null) return;
    setResultBusy(true);
    setDiscoveryResultError(null);
    try {
      setDiscoveryResult(await discoveryWorkspaceApi.previewResult(discoveryWorkspace.id));
      setResultContentsReviewed(false);
      setResultRedistributionReviewed(false);
    } catch (error) {
      setDiscoveryResultError(toApiClientError(error, 'The discovery result could not be loaded for review.'));
    } finally {
      setResultBusy(false);
    }
  };

  const importDiscoveryResult = async () => {
    if (discoveryWorkspace === null) return;
    setResultBusy(true);
    setDiscoveryResultError(null);
    try {
      await discoveryWorkspaceApi.importResult(discoveryWorkspace.id);
      const workspaces = await discoveryWorkspaceApi.list();
      setDiscoveryWorkspace(workspaces.find((candidate) => candidate.id === discoveryWorkspace.id) ?? discoveryWorkspace);
    } catch (error) {
      setDiscoveryResultError(toApiClientError(error, 'The approved result could not be imported.'));
    } finally {
      setResultBusy(false);
    }
  };

  const handleExitTerminal = useCallback(() => {
    controlsRef.current?.focus();
  }, []);

  if (stream.phase === 'loading') {
    return (
      <section aria-labelledby="run-view-title" data-testid="run-page">
        <h1 className="panel__title" id="run-view-title">
          Run view
        </h1>
        <section className="panel" aria-labelledby="run-loading-title">
          <h2 className="section-title" id="run-loading-title">
            Run
          </h2>
          <p className="state-note" data-testid="run-loading">
            <span aria-hidden="true">◌</span> Loading the run snapshot…
          </p>
        </section>
      </section>
    );
  }

  if (stream.phase === 'error' || view === null || run === null) {
    return (
      <section aria-labelledby="run-view-title" data-testid="run-page">
        <h1 className="panel__title" id="run-view-title">
          Run view
        </h1>
        <section className="panel" aria-labelledby="run-error-title">
          <h2 className="section-title" id="run-error-title">
            Run could not be loaded
          </h2>
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
      </section>
    );
  }

  const connectionMessage =
    run.status === 'completed' ||
    run.status === 'aborted' ||
    run.status === 'failed' ||
    run.status === 'interrupted'
      ? 'Event stream closed; run finished'
      : stream.connection === 'live'
        ? 'Event stream live'
        : stream.connection === 'connecting'
          ? 'Event stream connecting'
          : 'Event stream offline; retrying with a snapshot first';

  return (
    <section className="run-page" aria-labelledby="run-view-title" data-testid="run-page">
      <header className="run-header" data-testid="run-header">
        <div className="run-header__identity">
          <h1 className="panel__title" id="run-view-title">
            Run view
          </h1>
          <p className="run-header__chain" data-testid="run-chain-name">
            {run.chainSnapshot.name}
          </p>
        </div>

        <p className="run-header__status">
          <span className="status-tag status-tag--run" data-testid="run-status" data-status={run.status}>
            <StatusText status={run.status} kind="run" />
          </span>
          <span className="run-header__connection" data-testid="run-stream-state">
            <span aria-hidden="true">{stream.connection === 'live' ? '●' : '○'}</span>{' '}
            {connectionMessage}
          </span>
        </p>

        <dl className="run-header__meta">
          <div>
            <dt>Harness</dt>
            <dd>{CHAIN_HARNESS_LABELS[run.harness]}</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd data-testid="run-mode">{MODE_LABELS[run.mode]}</dd>
          </div>
          <div>
            <dt>Session</dt>
            <dd>{CHAIN_SESSION_MODE_LABELS[run.sessionMode]}</dd>
          </div>
          <div>
            <dt>Step</dt>
            <dd>
              {run.currentStepIndex + 1} of {run.steps.length}
            </dd>
          </div>
          <div>
            <dt>Elapsed</dt>
            <dd data-testid="run-elapsed">{elapsed}</dd>
          </div>
          <div>
            <dt>Run id</dt>
            <dd>
              <code>{run.id}</code>
            </dd>
          </div>
        </dl>

        <p className="field__hint run-header__truth">
          Skills are model-invoked context. Skill Loom guarantees prompt order, not that the harness
          fires a named skill. Skill observation is best-effort and never blocks a step.
        </p>

        {terminalId === null ? null : (
          <p className="panel__actions">
            <Link
              className="button button--secondary button--small"
              to={`/runs/${encodeURIComponent(run.id)}/terminal`}
              data-testid="open-terminal-page"
            >
              Open terminal page
            </Link>
          </p>
        )}
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

      <RunFailurePanel run={run} />

      {discoveryWorkspace !== null ? (
        <section className="panel" aria-labelledby="discovery-result-review-title">
          <h2 className="section-title" id="discovery-result-review-title">
            Review scenario-discovery result
          </h2>
          <p>
            The harness output is untrusted. Load the fixed result file for complete validation,
            review the generated chain and package contents, and approve redistribution separately.
            Marking the discovery step Done binds approval to this exact result fingerprint.
          </p>
          <p>Workspace handoff fingerprint: <code>{discoveryWorkspace.handoffFingerprint}</code></p>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void loadDiscoveryResult()}
            disabled={resultBusy}
          >
            {resultBusy ? 'Loading result…' : 'Load result for review'}
          </button>
          {discoveryResultError !== null ? (
            <InlineError
              title="Discovery result action failed"
              message={discoveryResultError.message}
              code={discoveryResultError.code}
              httpStatus={discoveryResultError.status}
              onRetry={() => void loadDiscoveryResult()}
            />
          ) : null}
          {discoveryResult !== null ? (
            <>
              <p>Result fingerprint: <code>{discoveryResult.fingerprint}</code></p>
              <details open>
                <summary>Review complete chain, package inventory, and contents</summary>
                <pre>{JSON.stringify(discoveryResult.bundle, null, 2)}</pre>
              </details>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={resultContentsReviewed}
                  onChange={(event) => setResultContentsReviewed(event.target.checked)}
                />
                <span>I reviewed the complete generated chain and package contents.</span>
              </label>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={resultRedistributionReviewed}
                  onChange={(event) => setResultRedistributionReviewed(event.target.checked)}
                />
                <span>I separately reviewed whether sharing these package contents is permitted.</span>
              </label>
            </>
          ) : null}
          {discoveryWorkspace.importedDraftId ? (
            <p className="state-note">
              Imported as a new project-independent draft:{' '}
              <Link to={`/drafts/${encodeURIComponent(discoveryWorkspace.importedDraftId)}`}>
                Open Chain draft
              </Link>
            </p>
          ) : run.status === 'completed' && discoveryWorkspace.resultFingerprint !== undefined ? (
            <button type="button" className="button" onClick={() => void importDiscoveryResult()} disabled={resultBusy}>
              {resultBusy ? 'Creating draft…' : 'Create new Chain draft from reviewed result'}
            </button>
          ) : null}
        </section>
      ) : null}

      <RunControls
        mode={run.mode}
        status={run.status}
        actions={discoveryWorkspace === null
          ? view.actions
          : {
              ...view.actions,
              done: view.actions.done &&
                discoveryResult !== null &&
                resultContentsReviewed &&
                resultRedistributionReviewed &&
                !resultBusy,
            }}
        recovery={view.recovery}
        currentStepStatus={run.steps[run.currentStepIndex]?.status ?? null}
        busyAction={stream.busyAction}
        onAction={(action, reason) => void handleAction(action, reason)}
        controlBarRef={controlsRef}
      />

      <section className="run-terminal" aria-labelledby="run-terminal-title" data-testid="run-terminal-region">
        <div className="run-terminal__heading">
          <h2 className="section-title" id="run-terminal-title">
            Live terminal
          </h2>
          <p className="field__hint">
            The terminal is the primary surface and stays visible for the whole run. Output is
            written by xterm.js only; it is never inserted as HTML.
          </p>
        </div>

        {terminalId !== null ? (
          <TerminalPane
            sessionId={terminalId}
            terminalPath={runTerminalPath(terminalId)}
            label={`Harness terminal for ${run.chainSnapshot.name}`}
            onExitFocus={handleExitTerminal}
            testId="run-terminal"
            screenTestId="run-terminal-screen"
            reconnectOnClose
            exitHint="Screen-reader mode is on. Press Escape to leave the terminal and return to the run controls. Screen-reader output is not a substitute for reviewing the run status."
          />
        ) : (
          <div
            className="run-terminal__empty"
            role="region"
            aria-label={`Harness terminal for ${run.chainSnapshot.name}`}
            data-testid="run-terminal-empty"
          >
            <p className="state-note">
              <span aria-hidden="true">○</span>{' '}
              {run.status === 'interrupted'
                ? 'No live terminal survived the interruption. Choose a recovery action below; no step starts automatically.'
                : run.status === 'completed' ||
                    run.status === 'aborted' ||
                    run.status === 'failed'
                  ? 'This run has finished and its terminal session is closed. The recorded status and step reasons remain available above.'
                  : 'No attachable terminal is live for this run. A headless automatic harness reports completion through process exit, not a PTY.'}
            </p>
          </div>
        )}
      </section>

      <StepRail run={run} selectedStepId={selectedStepId} onSelect={setSelectedStepId} />

      {selectedStep !== null ? <RunStepDetail run={run} step={selectedStep} /> : null}

      <p className="run-footer-note">
        <Link to="/projects">← Back to projects</Link>
        <span className="field__hint">
          Reloading this page fetches the run snapshot and reattaches a live terminal. It never
          starts or replays a step.
        </span>
      </p>
    </section>
  );
}
