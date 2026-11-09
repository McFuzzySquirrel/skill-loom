import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ApiClientError } from '../api/client';
import {
  chainsApi,
  toApiClientError,
  type Chain,
  type ChainsApi,
} from '../api/chains';
import {
  preflightApi,
  type PreflightApi,
  type PreflightReport as PreflightReportData,
} from '../api/preflight';
import { runsApi, type RunsApi } from '../api/runs';
import { InlineError } from '../components/InlineError';
import { HelpPopover } from '../components/HelpPopover';
import { InputsForm, validateRequiredInputs } from '../components/InputsForm';
import { PreflightReport } from '../components/PreflightReport';
import { useStatusAnnouncer } from '../components/StatusRegion';
import { TrustPanel } from '../components/TrustPanel';
import { CHAIN_HARNESS_LABELS, CHAIN_SESSION_MODE_LABELS } from '../hooks/useChains';
import { usePreflight } from '../hooks/usePreflight';
import { Link, useRouter } from '../router';
import { useWorkspace } from '../WorkspaceContext';
import type { PreflightRunMode } from '../api/preflight';

/**
 * Run-start and preflight screen (PRE-FR-04).
 *
 * Opening this screen loads the chain and nothing else. Preflight runs only on
 * an explicit action; trust is started only after a confirmation; the automatic
 * permission opt-in is saved on the chain only after a second confirmation.
 * Start is an explicit action: it creates the run through the server after the
 * gate is satisfied, then navigates to the terminal-dominant run view.
 */

export interface RunStartPageProps {
  projectId: string;
  chainId: string;
  supervisedOnly?: boolean;
  /** Test seams; the app always uses the same-origin typed clients. */
  api?: ChainsApi;
  preflightApiClient?: PreflightApi;
  runsApiClient?: RunsApi;
}

interface ChainLoadState {
  status: 'loading' | 'ready' | 'error';
  chain: Chain | null;
  error: ApiClientError | null;
}

const MODE_LABELS: Record<PreflightRunMode, string> = {
  supervised: 'Supervised',
  automatic: 'Automatic',
};

const MECHANISM_LABELS: Record<string, string> = {
  none: 'None',
  native: 'Native fork',
  handoff: 'Handoff',
};

function stepsLabel(count: number): string {
  return `${String(count)} step${count === 1 ? '' : 's'}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Render the exact executable-and-argument array carried by the preflight
 * report as display text. The string is never executed; the trust API owns the
 * authoritative verified command text after a verify action.
 */
function displayTrustCommand(details: Record<string, unknown>): string | null {
  const command = details['manualCommand'];
  if (!isRecord(command) || typeof command.executable !== 'string') {
    return null;
  }
  const args = Array.isArray(command.args)
    ? command.args.filter((arg): arg is string => typeof arg === 'string')
    : [];
  return [command.executable, ...args].map(quoteForDisplay).join(' ');
}

function quoteForDisplay(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", `'\\''`)}'`;
}

function describeReport(report: PreflightReportData): string {
  const blocking = report.checks.filter((check) => check.status === 'block').length;
  const warnings = report.checks.filter(
    (check) => check.status === 'warn' || check.status === 'acknowledge',
  ).length;
  if (report.status === 'blocked') {
    return `Preflight blocked the run with ${String(blocking)} blocking finding${
      blocking === 1 ? '' : 's'
    }. Resolve each item and run preflight again.`;
  }
  if (report.status === 'warn') {
    return `Preflight finished with ${String(warnings)} warning${
      warnings === 1 ? '' : 's'
    }. Acknowledge every required warning before Start is enabled.`;
  }
  return 'Preflight passed with no blocking findings and no warnings. Review the session plan before Start.';
}

export function RunStartPage({
  projectId,
  chainId,
  supervisedOnly = false,
  api = chainsApi,
  preflightApiClient = preflightApi,
  runsApiClient = runsApi,
}: RunStartPageProps) {
  const { navigate } = useRouter();
  const { setInfo } = useWorkspace();
  const { announce } = useStatusAnnouncer();
  const startHintId = useId();
  const inputHintId = useId();
  const permissionHeadingId = useId();
  const startHeadingId = useId();

  const [chainState, setChainState] = useState<ChainLoadState>({
    status: 'loading',
    chain: null,
    error: null,
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [attempted, setAttempted] = useState(false);
  const [mode, setMode] = useState<PreflightRunMode>('supervised');
  const [pendingOptIn, setPendingOptIn] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionError, setPermissionError] = useState<ApiClientError | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<ApiClientError | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const generation = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const permissionHeadingRef = useRef<HTMLHeadingElement>(null);

  const loadChain = useCallback(async (): Promise<void> => {
    const current = generation.current + 1;
    generation.current = current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setChainState({ status: 'loading', chain: null, error: null });
    try {
      const chain = await api.getChain(projectId, chainId, { signal: controller.signal });
      if (current !== generation.current) {
        return;
      }
      const nextValues: Record<string, string> = {};
      for (const input of chain.inputs) {
        nextValues[input.name] = input.defaultValue ?? '';
      }
      setValues(nextValues);
      setTouched({});
      setAttempted(false);
      setChainState({ status: 'ready', chain, error: null });
    } catch (caught) {
      if (current !== generation.current) {
        return;
      }
      if (isRecord(caught) && (caught as { name?: unknown }).name === 'AbortError') {
        return;
      }
      setChainState({
        status: 'error',
        chain: null,
        error: toApiClientError(caught, 'The chain could not be loaded.'),
      });
    }
  }, [api, chainId, projectId]);

  useEffect(() => {
    void loadChain();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadChain]);

  const chain = chainState.chain;
  useEffect(() => {
    if (chain !== null) {
      setInfo({
        projectId,
        chainId,
        chainName: chain.name,
      });
    }
  }, [chain, chainId, projectId, setInfo]);

  const preflight = usePreflight({
    projectId,
    chainId,
    harness: chain?.harness ?? null,
    mode,
    inputs: values,
    revision: chain?.updatedAt ?? '',
    api: preflightApiClient,
  });

  const inputErrors = useMemo(
    () => validateRequiredInputs(chain?.inputs ?? [], values),
    [chain?.inputs, values],
  );

  const visibleInputErrors = useMemo(() => {
    const visible: Record<string, string> = {};
    for (const [name, message] of Object.entries(inputErrors)) {
      if (attempted || touched[name] === true) {
        visible[name] = message;
      }
    }
    return visible;
  }, [attempted, inputErrors, touched]);

  const handleInputChange = useCallback((name: string, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
  }, []);

  const handleInputBlur = useCallback((name: string) => {
    setTouched((current) => ({ ...current, [name]: true }));
  }, []);

  const handleRunPreflight = useCallback(async () => {
    setAttempted(true);
    setStartError(null);
    setActiveRunId(null);
    announce('Running preflight checks. This does not start a run.');

    const report = await preflight.run();
    if (report === null) {
      announce('Preflight did not complete. Review the error and try again.', 'assertive');
      return;
    }
    announce(describeReport(report));
  }, [announce, preflight]);

  const handleOptInConfirmed = useCallback(async () => {
    if (chain === null || permissionBusy) {
      return;
    }
    setPermissionBusy(true);
    setPermissionError(null);
    try {
      const updated = await api.updateChain(
        projectId,
        chainId,
        {
          id: chain.id,
          version: chain.version,
          createdAt: chain.createdAt,
          updatedAt: chain.updatedAt,
          name: chain.name,
          harness: chain.harness,
          sessionMode: chain.sessionMode,
          steps: chain.steps,
          inputs: chain.inputs,
          automaticPermissionOptIn: true,
          ...(chain.agent === undefined ? {} : { agent: chain.agent }),
        },
        { ...(chain.revision === undefined ? {} : { expectedRevision: chain.revision }) },
      );
      setChainState({ status: 'ready', chain: updated, error: null });
      setPendingOptIn(false);
      const flags = preflight.report?.permissions?.flags ?? [];
      announce(
        `Automatic permissions saved on ${updated.name}. The exact flags are ${
          flags.join(' ') || 'unchanged'
        }. Run preflight again to refresh the report.`,
      );
    } catch (caught) {
      const apiError = toApiClientError(
        caught,
        'The automatic-permission opt-in could not be saved.',
      );
      setPermissionError(apiError);
      announce(`Automatic permissions could not be saved: ${apiError.message}`, 'assertive');
    } finally {
      setPermissionBusy(false);
    }
  }, [announce, api, chain, chainId, permissionBusy, preflight.report, projectId]);

  useEffect(() => {
    if (pendingOptIn) {
      permissionHeadingRef.current?.focus();
    }
  }, [pendingOptIn]);

  const permissions = preflight.report?.permissions ?? null;
  const flags = permissions?.flags ?? [];
  const automaticMode = mode === 'automatic';
  const optedIn = chain?.automaticPermissionOptIn === true;
  const showPermissionPanel = permissions !== null || automaticMode;

  const startHint = (() => {
    if (chainState.status !== 'ready') {
      return 'The chain must load before Start can be enabled.';
    }
    if (preflight.report === null) {
      return 'Run preflight to enable Start. Opening this screen never runs checks.';
    }
    if (preflight.status === 'running') {
      return 'Preflight is running. Wait for the report before starting the run.';
    }
    if (!preflight.isCurrent) {
      return 'Inputs, mode, or chain settings changed after the last preflight. Run preflight again.';
    }
    if (preflight.report.status === 'blocked') {
      return 'Resolve every blocking finding before Start. Start stays disabled while any block remains.';
    }
    if (Object.keys(inputErrors).length > 0) {
      return 'Provide every required input value before Start.';
    }
    if (preflight.missingAcknowledgements.length > 0) {
      return 'Acknowledge every required warning or finding before Start.';
    }
    return 'Preflight passed and all required acknowledgements are recorded. Start creates and launches the run.';
  })();

  const startEnabled =
    chainState.status === 'ready' &&
    preflight.canStart &&
    preflight.status !== 'running' &&
    Object.keys(inputErrors).length === 0 &&
    !starting;

  const handleStart = async (): Promise<void> => {
    if (!startEnabled || chain === null || starting) {
      return;
    }

    setStarting(true);
    setStartError(null);
    setActiveRunId(null);
    announce('Starting the run.');

    try {
      const result = await runsApiClient.createRun(projectId, {
        chainId,
        mode,
        inputs: { ...values },
        acknowledgements: [...preflight.acknowledgedKeys],
      });
      announce(`Run started for ${chain.name}. Opening the run terminal.`);
      navigate(`/runs/${encodeURIComponent(result.run.id)}/terminal`);
    } catch (caught) {
      const apiError = toApiClientError(
        caught,
        'An unexpected error prevented starting this run.',
      );
      setStartError(apiError);
      if (
        apiError.code === 'RUN_ACTIVE_CONFLICT' &&
        isRecord(apiError.details) &&
        typeof apiError.details['runId'] === 'string'
      ) {
        setActiveRunId(apiError.details['runId']);
        announce(
          'Another run is already active. Open that run or abort it before starting this chain.',
          'assertive',
        );
      } else {
        announce(`Run could not be started: ${apiError.message}`, 'assertive');
      }
    } finally {
      setStarting(false);
    }
  };

  const trustCheck = preflight.report?.checks.find((check) => check.id === 'trust');
  const trustState =
    trustCheck !== undefined && typeof trustCheck.details['state'] === 'string'
      ? (trustCheck.details['state'] as string)
      : null;
  const manualCommandText =
    trustCheck === undefined ? null : displayTrustCommand(trustCheck.details);
  const showTrustPanel = chain?.harness === 'copilot' && preflight.report !== null;

  return (
    <section aria-labelledby="run-start-title" data-testid="run-start-page">
      <p className="breadcrumb">
        <Link to={`/projects/${projectId}/chains/${chainId}`}>← Chain</Link>
      </p>

      <header className="preflight-header">
        <div>
          <h1 className="panel__title" id="run-start-title">
            Run start
          </h1>
          <p className="lede">
            Review the chain, resolve inputs, and run preflight. Hard blocks disable Start;
            warnings require an explicit acknowledgement. Preflight never makes a model call and
            never starts a run.
          </p>
        </div>
      </header>

      {chainState.status === 'loading' ? (
        <section className="panel" aria-labelledby="run-start-loading-title">
          <h2 className="section-title" id="run-start-loading-title">
            Chain
          </h2>
          <p className="state-note" data-testid="run-start-loading">
            <span aria-hidden="true">◌</span> Loading chain…
          </p>
        </section>
      ) : null}

      {chainState.status === 'error' && chainState.error !== null ? (
        <section className="panel" aria-labelledby="run-start-error-title">
          <h2 className="section-title" id="run-start-error-title">
            Chain could not be loaded
          </h2>
          <InlineError
            title="Chain request failed"
            message={chainState.error.message}
            code={chainState.error.code}
            httpStatus={chainState.error.status}
            onRetry={() => void loadChain()}
          />
          <p className="panel__actions">
            <Link className="button button--secondary" to={`/projects/${projectId}`}>
              Back to project
            </Link>
          </p>
        </section>
      ) : null}

      {chain !== null ? (
        <>
          <section
            className="preflight-panel chain-summary"
            aria-labelledby="chain-summary-title"
            data-testid="chain-summary"
          >
            <div className="chain-summary__heading">
              <div>
                <h2 className="section-title preflight-section-title" id="chain-summary-title">
                  Chain summary
                </h2>
                <HelpPopover topic="runStart" />
                <p className="chain-summary__name" data-testid="chain-summary-name">
                  {chain.name}
                </p>
              </div>
              <p className="chain-card__badges">
                <span className="badge" data-testid="chain-summary-harness">
                  Harness: {CHAIN_HARNESS_LABELS[chain.harness]}
                </span>
                <span className="badge" data-testid="chain-summary-session-mode">
                  Session: {CHAIN_SESSION_MODE_LABELS[chain.sessionMode]}
                </span>
                <span className="badge" data-testid="chain-summary-step-count">
                  {stepsLabel(chain.steps.length)}
                </span>
              </p>
            </div>
            <dl className="detail-grid">
              <div>
                <dt>Chain id</dt>
                <dd>
                  <code>{chain.id}</code>
                </dd>
              </div>
              <div>
                <dt>Project</dt>
                <dd>{projectId}</dd>
              </div>
              <div>
                <dt>Inputs</dt>
                <dd>
                  {String(chain.inputs.length)} input
                  {chain.inputs.length === 1 ? '' : 's'}
                </dd>
              </div>
            </dl>
            <p className="field__hint">
              Skills are model-invoked context. Skill Loom guarantees prompt order, not that the harness
              fires a named skill.
            </p>
          </section>

          <InputsForm
            inputs={chain.inputs}
            values={values}
            errors={visibleInputErrors}
            disabled={preflight.status === 'running'}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
          />

          <section className="preflight-panel" aria-labelledby="run-mode-title">
            <fieldset className="preflight-mode" data-testid="preflight-mode">
              <legend className="section-title preflight-section-title" id="run-mode-title">
                Run mode
              </legend>
              <HelpPopover topic="runMode" />
              <div className="preflight-mode__options">
                <div className="checkbox-field">
                  <input
                    id="run-mode-supervised"
                    type="radio"
                    name="run-mode"
                    value="supervised"
                    checked={mode === 'supervised'}
                    onChange={() => setMode('supervised')}
                    data-testid="run-mode-supervised"
                  />
                  <label htmlFor="run-mode-supervised">Supervised</label>
                  <p className="field__hint">
                    One step at a time. The run view advances only on an explicit action.
                  </p>
                </div>
                {!supervisedOnly ? (
                  <div className="checkbox-field">
                    <input
                      id="run-mode-automatic"
                      type="radio"
                      name="run-mode"
                      value="automatic"
                      checked={mode === 'automatic'}
                      onChange={() => setMode('automatic')}
                      data-testid="run-mode-automatic"
                    />
                    <label htmlFor="run-mode-automatic">Automatic</label>
                    <p className="field__hint">
                      Steps use the harness&apos;s automatic surface. Copilot requires an explicit
                      per-chain permission opt-in before broad flags are used.
                    </p>
                  </div>
                ) : null}
              </div>
            </fieldset>
          </section>

          <section className="preflight-run" aria-labelledby="preflight-run-title">
            <div className="preflight-run__heading">
              <div className="page-title-row">
                <h2 className="section-title preflight-section-title" id="preflight-run-title">
                  Preflight
                </h2>
                <HelpPopover topic="preflight" />
              </div>
              <p className="field__hint" id={inputHintId}>
                Required inputs block Start even before preflight. Preflight re-checks skills,
                the CLI, authentication, trust, permissions, and git state.
              </p>
            </div>
            <div className="panel__actions">
              <button
                type="button"
                className="button"
                onClick={() => void handleRunPreflight()}
                disabled={preflight.status === 'running'}
                aria-describedby={inputHintId}
                data-testid="preflight-run"
              >
                {preflight.status === 'running' ? 'Running preflight…' : 'Run preflight'}
              </button>
            </div>
            {preflight.status === 'running' ? (
              <p className="state-note preflight-pending" data-testid="preflight-pending">
                <span aria-hidden="true">◌</span> Running preflight checks…
              </p>
            ) : null}
            {preflight.error !== null ? (
              <div data-testid="preflight-error">
                <InlineError
                  title="Preflight could not run"
                  message={preflight.error.message}
                  code={preflight.error.code}
                  httpStatus={preflight.error.status}
                  onRetry={() => void handleRunPreflight()}
                />
              </div>
            ) : null}
          </section>

          {preflight.report !== null ? (
            <PreflightReport
              report={preflight.report}
              acknowledgedKeys={preflight.acknowledgedKeys}
              onToggleAcknowledgement={preflight.toggleAcknowledgement}
            />
          ) : null}

          {preflight.report?.sessionPlan !== null &&
          preflight.report?.sessionPlan !== undefined ? (
            <section
              className="preflight-panel preflight-session"
              aria-labelledby="preflight-session-title"
              data-testid="preflight-session-plan"
            >
              <h2
                className="section-title preflight-section-title"
                id="preflight-session-title"
              >
                Session and fork mechanism
              </h2>
              <p className="chain-card__badges">
                <span
                  className="badge"
                  data-testid="preflight-fork-mechanism"
                  data-mechanism={preflight.report.sessionPlan.mechanism}
                >
                  Fork: {MECHANISM_LABELS[preflight.report.sessionPlan.mechanism] ?? preflight.report.sessionPlan.mechanism}
                </span>
                <span className="badge" data-testid="preflight-session-surface">
                  Surface: {preflight.report.sessionPlan.surface}
                </span>
                <span className="badge">
                  {preflight.report.sessionPlan.nativeFork ? 'Native fork supported' : 'No native fork'}
                </span>
              </p>
              <p className="state-note" data-testid="preflight-session-description">
                {preflight.report.sessionPlan.description}
              </p>
            </section>
          ) : preflight.report !== null ? null : (
            <p className="field__hint" data-testid="preflight-session-unknown">
              Run preflight to confirm whether the session plan uses a native fork or a handoff.
            </p>
          )}

          {showPermissionPanel ? (
            <section
              className="preflight-panel preflight-permissions"
              aria-labelledby="preflight-permissions-title"
              data-testid="preflight-permissions"
            >
              <h2
                className="section-title preflight-section-title"
                id="preflight-permissions-title"
              >
                Automatic permissions
              </h2>
              <p className="field__hint">
                {permissions === null
                  ? 'Run preflight to load the exact permission flags for this harness.'
                  : permissions.automatic
                    ? 'Automatic mode passes the exact broad flags below on every step.'
                    : 'Supervised mode does not pass broad permission flags.'}
              </p>
              {flags.length > 0 ? (
                <pre className="trust-panel__command">
                  <code data-testid="permission-flags">{flags.join(' ')}</code>
                </pre>
              ) : permissions !== null ? (
                <p className="state-note" data-testid="permission-flags-none">
                  <span aria-hidden="true">✓</span> This harness requires no broad permission
                  flags.
                </p>
              ) : null}
              {permissions === null ? null : (
                <p className="state-note" data-testid="permission-scope">
                  {permissions.scope}
                </p>
              )}

              {automaticMode && permissions !== null && permissions.optInRequired ? (
                <div className="checkbox-field preflight-opt-in">
                  <input
                    id="permission-opt-in"
                    type="checkbox"
                    checked={optedIn || pendingOptIn}
                    disabled={optedIn || permissionBusy}
                    onChange={(event) => {
                      if (event.target.checked && !optedIn) {
                        setPendingOptIn(true);
                      } else if (!event.target.checked && pendingOptIn) {
                        setPendingOptIn(false);
                      }
                    }}
                    data-testid="permission-opt-in"
                  />
                  <label htmlFor="permission-opt-in">
                    Enable automatic permissions on this chain
                  </label>
                  <p className="field__hint">
                    Off by default. The opt-in is stored on the chain only after confirmation and
                    applies only to this chain. Supervised mode never uses these flags.
                  </p>
                </div>
              ) : null}

              {pendingOptIn ? (
                <section
                  className="confirm-panel preflight-opt-in__confirm"
                  role="group"
                  aria-labelledby={permissionHeadingId}
                  data-testid="permission-opt-in-confirm-panel"
                >
                  <h3
                    className="preflight-opt-in__confirm-title"
                    id={permissionHeadingId}
                    ref={permissionHeadingRef}
                    tabIndex={-1}
                  >
                    Enable automatic permissions for this chain?
                  </h3>
                  <p>
                    Saving this opt-in on chain <strong>{chain.name}</strong> permits the exact
                    flags below for every automatic run of this chain.
                  </p>
                  <pre className="trust-panel__command">
                    <code data-testid="permission-opt-in-flags">{flags.join(' ')}</code>
                  </pre>
                  <p className="field__hint">
                    This does not start a run and does not change another chain. Cancel leaves the
                    opt-in disabled.
                  </p>
                  <div className="panel__actions">
                    <button
                      type="button"
                      className="button button--small"
                      onClick={() => void handleOptInConfirmed()}
                      disabled={permissionBusy}
                      data-testid="permission-opt-in-confirm"
                    >
                      {permissionBusy ? 'Saving opt-in…' : 'Enable and save on chain'}
                    </button>
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      onClick={() => setPendingOptIn(false)}
                      disabled={permissionBusy}
                      data-testid="permission-opt-in-cancel"
                    >
                      Cancel
                    </button>
                  </div>
                </section>
              ) : null}

              {permissionError !== null ? (
                <div data-testid="permission-error">
                  <InlineError
                    title="Automatic permissions could not be saved"
                    message={permissionError.message}
                    code={permissionError.code}
                    httpStatus={permissionError.status}
                    onRetry={() => void handleOptInConfirmed()}
                    retryLabel="Retry save"
                  />
                </div>
              ) : null}
            </section>
          ) : null}

          {showTrustPanel ? (
            <TrustPanel
              projectId={projectId}
              harness="copilot"
              trustState={trustState}
              manualCommandText={manualCommandText}
              disabled={preflight.status === 'running'}
              api={preflightApiClient}
            />
          ) : null}

          <section
            className="preflight-panel preflight-start"
            aria-labelledby={startHeadingId}
            data-testid="run-start-gate"
          >
            <h2 className="section-title preflight-section-title" id={startHeadingId}>
              Start
            </h2>
            <p className="field__hint" id={startHintId} data-testid="start-reason">
              {startHint}
            </p>
            <div className="panel__actions">
              <button
                type="button"
                className="button"
                onClick={() => void handleStart()}
                disabled={!startEnabled}
                aria-describedby={startHintId}
                aria-busy={starting}
                data-testid="start-run"
              >
                {starting ? 'Starting run…' : 'Start run'}
              </button>
            </div>
            <p className="field__hint">
              Start creates a run record, re-runs the blocking preflight on the server, and
              launches the harness. Warnings must be acknowledged on this screen first.
            </p>
            {preflight.report === null ? null : (
              <p className="field__hint">
                Preflight gate:{' '}
                <strong data-testid="preflight-gate">
                  {startEnabled || starting ? 'Start allowed' : 'Start blocked'}
                </strong>
                . Mode: {MODE_LABELS[mode]}.
              </p>
            )}
            {startError === null ? null : (
              <div data-testid="start-error">
                <InlineError
                  title="Run could not be started"
                  message={startError.message}
                  code={startError.code}
                  httpStatus={startError.status}
                  onRetry={() => void handleStart()}
                  retryLabel="Retry start"
                />
                {activeRunId === null ? null : (
                  <p className="panel__actions">
                    <Link className="button" to={`/runs/${encodeURIComponent(activeRunId)}`}>
                      Open the active run
                    </Link>
                  </p>
                )}
              </div>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}
