import { useEffect, useId, useRef, useState } from 'react';
import { globalChainsApi, type GlobalChainsApi } from '../api/globalChains';
import { toApiClientError, type Chain } from '../api/chains';
import type { ApiClientError } from '../api/client';
import { useGlobalChains } from '../hooks/useGlobalChains';
import { CHAIN_HARNESS_LABELS, CHAIN_SESSION_MODE_LABELS } from '../hooks/useChains';
import { InlineError } from './InlineError';
import { useStatusAnnouncer } from './StatusRegion';

export interface ImportChainDialogProps {
  projectId: string;
  onImported: (chain: Chain) => void;
  onClose: () => void;
  api?: GlobalChainsApi;
}

/**
 * Copy one global template into the current project.
 *
 * The project id is server-validated; the browser only chooses a template id.
 * Import always creates a new project chain id, so the same template can be
 * imported repeatedly without linking the copies.
 */
export function ImportChainDialog({
  projectId,
  onImported,
  onClose,
  api = globalChainsApi,
}: ImportChainDialogProps) {
  const titleId = useId();
  const { announce } = useStatusAnnouncer();
  const { state, reload } = useGlobalChains({ api });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const importTemplate = async (chain: Chain) => {
    setBusyId(chain.id);
    setError(null);
    try {
      const imported = await api.importIntoProject(projectId, chain.id);
      announce(`Imported ${chain.name} as ${imported.name}.`);
      onImported(imported);
    } catch (caught) {
      const apiError = toApiClientError(
        caught,
        'An unexpected error prevented importing this template.',
      );
      setError(apiError);
      announce(`Template could not be imported: ${apiError.message}`, 'assertive');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section
      className="new-chain import-chain"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-testid="import-chain-dialog"
    >
      <div className="new-chain__header">
        <h3 className="new-chain__title" id={titleId} ref={heading} tabIndex={-1}>
          Import a chain template
        </h3>
        <button
          type="button"
          className="button button--secondary button--small"
          onClick={onClose}
          aria-label="Close import chain dialog"
        >
          Close
        </button>
      </div>

      <p className="field__hint">
        Import copies the selected template into this project with a new chain id. The
        template and the imported copy stay independent.
      </p>

      {error !== null ? (
        <InlineError
          title="Template could not be imported"
          message={error.message}
          code={error.code}
          httpStatus={error.status}
          onRetry={() => void reload()}
        />
      ) : null}

      {state.status === 'loading' ? (
        <p className="state-note">
          <span aria-hidden="true">◌</span> Loading global templates…
        </p>
      ) : null}

      {state.error !== null ? (
        <InlineError
          title="Global templates could not be loaded"
          message={state.error.message}
          code={state.error.code}
          httpStatus={state.error.status}
          onRetry={() => void reload()}
        />
      ) : null}

      {state.status === 'ready' && state.chains.length === 0 ? (
        <div className="empty-state" data-testid="import-chain-empty">
          <p>No global templates yet.</p>
          <p>
            Save a chain from a project builder with <strong>Save copy to library</strong>,
            then return here to import it.
          </p>
        </div>
      ) : null}

      {state.chains.length > 0 ? (
        <ul className="chain-list" data-testid="import-chain-list">
          {state.chains.map((chain) => {
            const busy = busyId === chain.id;
            return (
              <li
                className="chain-card"
                key={chain.id}
                data-testid="import-chain-card"
                data-chain-id={chain.id}
              >
                <div className="chain-card__identity">
                  <h4 className="chain-card__name">{chain.name}</h4>
                  <p className="chain-card__badges">
                    <span className="badge">
                      Harness: {CHAIN_HARNESS_LABELS[chain.harness]}
                    </span>
                    <span className="badge">
                      Session: {CHAIN_SESSION_MODE_LABELS[chain.sessionMode]}
                    </span>
                    <span className="badge">
                      {String(chain.steps.length)} step{chain.steps.length === 1 ? '' : 's'}
                    </span>
                  </p>
                </div>
                <div className="chain-card__actions">
                  <button
                    type="button"
                    className="button button--small"
                    onClick={() => void importTemplate(chain)}
                    disabled={busyId !== null}
                    data-testid="import-chain-submit"
                  >
                    {busy ? 'Importing…' : 'Import copy'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
