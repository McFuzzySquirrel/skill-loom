import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ApiClientError } from '../api/client';
import { runsApi, type ActiveRunState } from '../api/runs';
import { getServerLifecycle, stopServer } from '../api/server';
import { HelpPopover } from './HelpPopover';
import { useStatusAnnouncer } from './StatusRegion';

interface StopServerDialogProps {
  dirty: boolean;
  saving: boolean;
  onClose: () => void;
  onStopped: () => void;
}

type DialogState = 'loading' | 'ready' | 'stopping' | 'error';

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

export function StopServerDialog({
  dirty,
  saving,
  onClose,
  onStopped,
}: StopServerDialogProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [dialogState, setDialogState] = useState<DialogState>('loading');
  const [token, setToken] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<ActiveRunState | null>(null);
  const [discardConfirmed, setDiscardConfirmed] = useState(false);
  const [shutdownAccepted, setShutdownAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { announce } = useStatusAnnouncer();

  useEffect(() => {
    heading.current?.focus();
    let disposed = false;
    Promise.all([getServerLifecycle(), runsApi.getActiveRun()])
      .then(([lifecycle, active]) => {
        if (disposed) return;
        if (lifecycle.state !== 'running' && lifecycle.state !== 'stopping') {
          setError('The server is already stopping or is not available.');
          setDialogState('error');
          return;
        }
        setToken(lifecycle.token);
        setActiveRun(active);
        setShutdownAccepted(lifecycle.state === 'stopping');
        setDialogState('ready');
      })
      .catch((cause: unknown) => {
        if (disposed) return;
        setError(
          cause instanceof Error ? cause.message : 'Could not load shutdown details.',
        );
        setDialogState('error');
      });
    return () => {
      disposed = true;
    };
  }, []);

  const handleStop = async () => {
    if (token === null || saving || (dirty && !discardConfirmed)) {
      return;
    }

    setDialogState('stopping');
    setError(null);
    try {
      if (!shutdownAccepted) {
        await stopServer(token);
        setShutdownAccepted(true);
        if (typeof BroadcastChannel !== 'undefined') {
          const channel = new BroadcastChannel('skill-loom-server-lifecycle');
          channel.postMessage({ state: 'stopping' });
          channel.close();
        }
        announce('Server shutdown was accepted. Waiting for the server to stop.');
      }

      let consecutiveNetworkErrors = 0;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await delay(150);
        try {
          const lifecycle = await getServerLifecycle();
          consecutiveNetworkErrors = 0;
          if (lifecycle.state === 'failed' || lifecycle.state === 'running') {
            throw new Error('The server did not complete its accepted shutdown.');
          }
        } catch (cause) {
          if (cause instanceof ApiClientError && cause.code === 'NETWORK_ERROR') {
            consecutiveNetworkErrors += 1;
            if (consecutiveNetworkErrors >= 3) {
              onStopped();
              return;
            }
            continue;
          }
          throw cause;
        }
      }

      throw new Error(
        'Shutdown was accepted, but the server is still responding. Its final state is uncertain.',
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'The server shutdown could not be verified.',
      );
      setDialogState('error');
      announce('Server shutdown could not be verified. Your current page and edits were kept.');
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && dialogState !== 'stopping') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), a[href]',
    );
    const first = focusable.item(0);
    const last = focusable.item(focusable.length - 1);
    if (first === null || last === null) {
      event.preventDefault();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const run = activeRun?.active ? activeRun.run : null;

  return (
    <div
      className="stop-server-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dialogState !== 'stopping') {
          onClose();
        }
      }}
    >
      <section
        className="stop-server-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stop-server-title"
        aria-describedby="stop-server-description"
        onKeyDown={handleKeyDown}
      >
        <div className="stop-server-dialog__heading">
          <h2 id="stop-server-title" ref={heading} tabIndex={-1}>
            Stop Skill Loom server
          </h2>
          <HelpPopover topic="stopServer" />
        </div>
        <p id="stop-server-description">
          This stops the local server for every open tab. You can restart it later with the
          same command you used to launch it.
        </p>

        {dialogState === 'loading' ? <p role="status">Loading shutdown details…</p> : null}
        {run !== null ? (
          <div className="state-note state-note--warning">
            <p>
              Active run: <strong>{run.chainSnapshot.name}</strong> ({run.status}).
            </p>
            <p>
              Its current step will be marked interrupted. Completed steps and recovery
              choices will be preserved for after restart.
            </p>
          </div>
        ) : activeRun?.active === false ? (
          <p>No active run is currently registered.</p>
        ) : null}

        {dirty ? (
          <label className="stop-server-dialog__discard">
            <input
              type="checkbox"
              checked={discardConfirmed}
              disabled={dialogState === 'stopping'}
              onChange={(event) => setDiscardConfirmed(event.target.checked)}
            />
            <span>
              I understand that stopping will discard this unsaved chain draft.
            </span>
          </label>
        ) : null}
        {saving ? <p role="status">A save is in progress. Wait for it to finish before stopping.</p> : null}
        {error !== null ? (
          <p className="inline-error__message" role="alert">
            {error}
          </p>
        ) : null}
        {dialogState === 'stopping' ? (
          <p role="status">Stopping the server and verifying that it is no longer available…</p>
        ) : null}

        <div className="stop-server-dialog__actions">
          <button
            type="button"
            className="button button--danger"
            disabled={
              dialogState === 'loading' ||
              dialogState === 'stopping' ||
              token === null ||
              saving ||
              (dirty && !discardConfirmed)
            }
            onClick={() => void handleStop()}
          >
            {dialogState === 'stopping'
              ? 'Stopping…'
              : shutdownAccepted
                ? 'Check shutdown'
                : 'Stop server'}
          </button>
          <button
            type="button"
            className="button button--secondary"
            disabled={dialogState === 'stopping'}
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}
