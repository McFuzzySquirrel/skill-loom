import { useEffect, useId, useRef, useState } from 'react';
import type { ApiClientError } from '../api/client';
import {
  preflightApi,
  type PreflightApi,
  type PreflightHarness,
  type TrustStartResult,
  type TrustVerifyResult,
} from '../api/preflight';
import { toApiClientError } from '../api/projects';
import { InlineError } from './InlineError';
import { useStatusAnnouncer } from './StatusRegion';
import { TerminalPane } from './TerminalPane';

/**
 * Copilot folder-trust panel.
 *
 * Start is an explicit, confirmed action: it opens an unseeded interactive
 * Copilot session in the project through the server-owned PTY. Verify re-reads
 * the trusted-folder configuration. The exact manual fallback command is always
 * visible, and failure never marks the folder trusted locally.
 */

export interface TrustPanelProps {
  projectId: string;
  harness: PreflightHarness;
  /** Last trust state reported by preflight: trusted, untrusted, or unknown. */
  trustState: string | null;
  /** Manual fallback carried by the preflight report, if any. */
  manualCommandText?: string | null;
  disabled?: boolean;
  onTrustChanged?: (trusted: boolean) => void;
  /** Test seam; the app always uses the same-origin typed client. */
  api?: PreflightApi;
}

const STATE_LABELS: Record<string, string> = {
  trusted: 'Trusted',
  untrusted: 'Not trusted',
  unknown: 'Unknown',
  'not-required': 'Not required',
};

const STATE_ICONS: Record<string, string> = {
  trusted: '✓',
  untrusted: '✕',
  unknown: '○',
  'not-required': '✓',
};

type Phase = 'idle' | 'confirming' | 'starting' | 'session' | 'verifying';

export function TrustPanel({
  projectId,
  harness,
  trustState,
  manualCommandText,
  disabled = false,
  onTrustChanged,
  api = preflightApi,
}: TrustPanelProps) {
  const { announce } = useStatusAnnouncer();
  const prefix = useId();
  const confirmHeading = useRef<HTMLHeadingElement>(null);
  const verifyButton = useRef<HTMLButtonElement>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [session, setSession] = useState<TrustStartResult | null>(null);
  const [verification, setVerification] = useState<TrustVerifyResult | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);

  useEffect(() => {
    if (phase === 'confirming') {
      confirmHeading.current?.focus();
    }
  }, [phase]);

  const state = verification === null ? (trustState ?? 'unknown') : verification.state;
  const stateLabel = STATE_LABELS[state] ?? state;
  const stateIcon = STATE_ICONS[state] ?? '○';
  const fallback =
    verification?.manualCommandText ??
    session?.manualCommandText ??
    manualCommandText ??
    null;
  const busy = phase === 'starting' || phase === 'verifying';
  const trusted = state === 'trusted' || state === 'not-required';

  const handleStart = async (): Promise<void> => {
    setPhase('starting');
    setError(null);
    try {
      const started = await api.startTrust(projectId, harness);
      setSession(started);
      setPhase('session');
      announce(
        `${started.displayName} trust terminal opened. Accept the folder-trust dialog, then choose Verify trust.`,
      );
    } catch (caught) {
      setError(
        toApiClientError(caught, 'The trust terminal could not be started.'),
      );
      setPhase('idle');
      announce('The trust terminal could not be started.', 'assertive');
    }
  };

  const handleVerify = async (): Promise<void> => {
    setPhase('verifying');
    setError(null);
    try {
      const result = await api.verifyTrust(projectId, harness, session?.sessionId);
      setVerification(result);
      setPhase('idle');
      if (result.trusted) {
        announce(
          `${result.displayName} folder trust is verified. Run preflight again to refresh the report before starting.`,
        );
      } else {
        announce(
          `${result.displayName} folder trust is not established. Accept the dialog or run the manual fallback, then verify again.`,
        );
      }
      onTrustChanged?.(result.trusted);
    } catch (caught) {
      setError(
        toApiClientError(caught, 'Folder trust could not be verified.'),
      );
      setPhase('idle');
      announce('Folder trust could not be verified.', 'assertive');
    }
  };

  return (
    <section
      className="preflight-panel trust-panel"
      aria-labelledby={`${prefix}-title`}
      data-testid="trust-panel"
      data-trust-state={state}
    >
      <div className="trust-panel__heading">
        <div>
          <h2 className="section-title preflight-section-title" id={`${prefix}-title`}>
            Copilot folder trust
          </h2>
          <p className="field__hint">
            The first Copilot prompt can be swallowed by a folder-trust dialog. Slan starts an
            unseeded interactive session so you can accept that dialog before the run.
          </p>
        </div>
        <span
          className={`status-tag ${
            trusted ? 'status-tag--ok' : 'status-tag--warning'
          }`}
          data-testid="trust-state"
          data-state={state}
        >
          <span aria-hidden="true">{stateIcon}</span> {stateLabel}
        </span>
      </div>

      <p className="state-note" data-testid="trust-state-note">
        {trusted
          ? 'The project folder is trusted by Copilot. Re-run preflight to refresh the findings before Start.'
          : state === 'untrusted'
            ? 'The project folder is not trusted yet. Open the trust terminal, accept the dialog, then verify.'
            : 'Folder trust could not be verified automatically. Use the trust terminal or the manual fallback, then verify again.'}
      </p>

      {error === null ? null : (
        <InlineError
          title="Trust action failed"
          message={error.message}
          code={error.code}
          httpStatus={error.status}
        />
      )}

      {phase === 'confirming' ? (
        <section
          className="confirm-panel trust-panel__confirm"
          role="group"
          aria-labelledby={`${prefix}-confirm-title`}
          data-testid="trust-start-confirm-panel"
        >
          <h3
            className="trust-panel__confirm-title"
            id={`${prefix}-confirm-title`}
            ref={confirmHeading}
            tabIndex={-1}
          >
            Open a Copilot trust session?
          </h3>
          <p>
            This starts an interactive Copilot session in this project. Slan sends no prompt,
            no session id, and no model call. A folder-trust dialog may appear in the embedded
            terminal.
          </p>
          <p className="field__hint">
            Accept the dialog, then choose Verify trust. If Copilot cannot persist trust, the
            exact manual command shown below remains available.
          </p>
          <div className="panel__actions">
            <button
              type="button"
              className="button button--small"
              onClick={() => void handleStart()}
              data-testid="trust-start-confirm"
            >
              Confirm and open trust terminal
            </button>
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => setPhase('idle')}
              data-testid="trust-start-cancel"
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      <div className="trust-panel__actions">
        {session === null ? (
          <button
            type="button"
            className="button"
            onClick={() => setPhase('confirming')}
            disabled={disabled || busy}
            data-testid="trust-start"
          >
            {phase === 'starting' ? 'Starting trust terminal…' : 'Open trust terminal'}
          </button>
        ) : null}
        <button
          type="button"
          className="button button--secondary"
          onClick={() => void handleVerify()}
          disabled={disabled || busy}
          ref={verifyButton}
          data-testid="trust-verify"
        >
          {phase === 'verifying' ? 'Verifying trust…' : 'Verify trust'}
        </button>
      </div>

      {session === null ? null : (
        <TerminalPane
          sessionId={session.sessionId}
          terminalPath={session.terminalPath}
          label="Copilot folder-trust terminal"
          onExitFocus={() => verifyButton.current?.focus()}
        />
      )}

      <section
        className="trust-panel__fallback"
        aria-labelledby={`${prefix}-fallback-title`}
        data-testid="trust-manual-fallback"
      >
        <h3 className="trust-panel__fallback-title" id={`${prefix}-fallback-title`}>
          Manual fallback
        </h3>
        <p className="field__hint">
          Display only. Slan never executes this line for you. Run it in a terminal inside the
          project if the dialog cannot persist trust.
        </p>
        <pre className="trust-panel__command">
          <code data-testid="trust-manual-command">
            {fallback ?? 'Start a trust session or run preflight to load the exact command.'}
          </code>
        </pre>
        {verification === null ? null : (
          <p
            className={
              verification.trusted
                ? 'state-note preflight-note--ok'
                : 'state-note state-note--warning'
            }
            data-testid="trust-verify-result"
          >
            <span aria-hidden="true">{verification.trusted ? '✓' : '▲'}</span>{' '}
            {verification.remediation}
            {verification.configPath === null ? null : (
              <>
                {' '}
                Trust config: <code>{verification.configPath}</code>.
              </>
            )}
          </p>
        )}
      </section>
    </section>
  );
}
