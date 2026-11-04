import { useEffect, useRef } from 'react';
import { useStatusAnnouncer } from './StatusRegion';
import { useHealth } from '../hooks/useHealth';

/**
 * Compact server health indicator. A failure renders inline with the server's
 * own message and a Retry action; the aria-live region carries the short
 * announcement so screen-reader users hear the same transition.
 */
export function ServerStatus() {
  const { state, retry } = useHealth();
  const { announce } = useStatusAnnouncer();
  const hadError = useRef(false);

  useEffect(() => {
    if (state.status === 'error') {
      hadError.current = true;
      announce(`API request failed: ${state.error.message}`);
      return;
    }
    if (state.status === 'ready' && hadError.current) {
      hadError.current = false;
      announce(`Server connection restored. Slan ${state.data.version} is responding.`);
    }
  }, [announce, state]);

  if (state.status === 'loading') {
    return (
      <p className="server-status status-text status-text--pending">
        <span aria-hidden="true">◌</span> Checking server connection…
      </p>
    );
  }

  if (state.status === 'ready') {
    return (
      <p className="server-status status-text status-text--ok">
        <span aria-hidden="true">✓</span> Server connected · v{state.data.version}
      </p>
    );
  }

  return (
    <section
      className="inline-error server-status"
      role="group"
      aria-labelledby="server-connection-error-title"
    >
      <p className="inline-error__title" id="server-connection-error-title">
        Server connection error
      </p>
      <p className="inline-error__message">{state.error.message}</p>
      <p className="inline-error__meta">
        Error code: {state.error.code}
        {state.error.status > 0 ? ` · HTTP ${state.error.status}` : ''}
      </p>
      <button type="button" className="button" onClick={() => void retry()}>
        Retry
      </button>
    </section>
  );
}
