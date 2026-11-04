import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from '../router';
import { chainBuilderPath, type Chain } from '../api/chains';
import {
  globalChainsApi,
  type GlobalChainsApi,
} from '../api/globalChains';
import { ApiClientError } from '../api/client';
import { toApiClientError } from '../api/projects';
import { formatRelativeTime } from '../components/ChainList';
import { InlineError } from '../components/InlineError';
import { useStatusAnnouncer } from '../components/StatusRegion';
import { CHAIN_HARNESS_LABELS, CHAIN_SESSION_MODE_LABELS } from '../hooks/useChains';
import { useGlobalChains } from '../hooks/useGlobalChains';
import { useRecentProjects } from '../hooks/useRecentProjects';

export interface GlobalChainsPageProps {
  api?: GlobalChainsApi;
}

function stepsLabel(count: number): string {
  return `${String(count)} step${count === 1 ? '' : 's'}`;
}

/**
 * Global chain template library.
 *
 * Templates are snapshots saved from a project chain. Importing copies one
 * into the selected recent project and opens its builder, where the copy can
 * be adjusted for that project's skills before running.
 */
export function GlobalChainsPage({ api = globalChainsApi }: GlobalChainsPageProps) {
  const { navigate } = useRouter();
  const { announce } = useStatusAnnouncer();
  const { state, reload } = useGlobalChains({ api });
  const { state: recentState } = useRecentProjects();
  const [destinationId, setDestinationId] = useState<string>('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<ApiClientError | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const destinationHelpId = useId();

  const projects = recentState.status === 'ready' ? recentState.projects : [];

  useEffect(() => {
    if (destinationId !== '' || projects.length === 0) {
      return;
    }
    setDestinationId(projects[0]?.id ?? '');
  }, [destinationId, projects]);

  const importTemplate = async (chain: Chain) => {
    const destination = projects.find((project) => project.id === destinationId);
    if (destination === undefined) {
      setMutationError(
        new ApiClientError('Choose a destination project before importing a template.', {
          code: 'PROJECT_REQUIRED',
          status: 0,
        }),
      );
      return;
    }

    setBusyId(chain.id);
    setMutationError(null);
    try {
      const imported = await api.importIntoProject(destination.id, chain.id);
      announce(
        `Imported ${chain.name} into ${destination.displayName} as ${imported.name}.`,
      );
      navigate(chainBuilderPath(destination.id, imported.id));
    } catch (error) {
      const apiError = toApiClientError(
        error,
        'An unexpected error prevented importing this template.',
      );
      setMutationError(apiError);
      announce(`Template could not be imported: ${apiError.message}`, 'assertive');
    } finally {
      setBusyId(null);
    }
  };

  const removeTemplate = async (chain: Chain) => {
    setBusyId(chain.id);
    setMutationError(null);
    try {
      await api.remove(chain.id);
      setConfirmingId(null);
      await reload();
      announce(`Removed ${chain.name} from the global chain library. Project copies were not changed.`);
      heading.current?.focus();
    } catch (error) {
      const apiError = toApiClientError(
        error,
        'An unexpected error prevented removing this template.',
      );
      setMutationError(apiError);
      announce(`Template could not be removed: ${apiError.message}`, 'assertive');
    } finally {
      setBusyId(null);
    }
  };

  const empty = state.status === 'ready' && state.chains.length === 0;

  return (
    <section aria-labelledby="global-chains-title" data-testid="global-chains-page">
      <header className="projects-header">
        <h1 className="panel__title" id="global-chains-title" ref={heading} tabIndex={-1}>
          Global chain library
        </h1>
        <p className="lede">
          Templates are snapshots you can copy into any project. Saving a chain here does not
          link it: later edits to the project chain or the template do not sync.
        </p>
      </header>

      {projects.length > 0 ? (
        <section className="panel global-chains-destination" aria-labelledby="import-target-title">
          <h2 className="section-title" id="import-target-title">
            Import destination
          </h2>
          <div className="field">
            <label className="field__label" htmlFor="global-import-project">
              Target project
            </label>
            <select
              className="input"
              id="global-import-project"
              value={destinationId}
              onChange={(event) => setDestinationId(event.target.value)}
              aria-describedby={destinationHelpId}
              data-testid="global-import-project"
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.displayName}
                </option>
              ))}
            </select>
            <p className="field__hint" id={destinationHelpId}>
              Import copies the template into <code>.loom/chains</code> and opens its builder.
            </p>
          </div>
        </section>
      ) : recentState.status === 'ready' ? (
        <p className="state-note" data-testid="global-import-no-project">
          <span aria-hidden="true">○</span> Open a project first to import a template.
        </p>
      ) : null}

      {state.error !== null ? (
        <InlineError
          title="Global chain library failed"
          message={state.error.message}
          code={state.error.code}
          httpStatus={state.error.status}
          onRetry={() => void reload()}
        />
      ) : null}

      {mutationError !== null ? (
        <InlineError
          title="Template action failed"
          message={mutationError.message}
          code={mutationError.code}
          httpStatus={mutationError.status}
        />
      ) : null}

      {state.warnings.length > 0 ? (
        <section className="chain-warnings" aria-labelledby="global-warnings-title">
          <h2 className="chain-warnings__title" id="global-warnings-title">
            <span aria-hidden="true">▲</span> {String(state.warnings.length)} template file
            warning{state.warnings.length === 1 ? '' : 's'}
          </h2>
          <ul className="chain-warnings__list">
            {state.warnings.map((warning, index) => (
              <li className="chain-warnings__item" key={`${warning.path}-${String(index)}`}>
                <p className="chain-warnings__message">{warning.message}</p>
                <p className="chain-warnings__meta">
                  <code>{warning.code}</code> · <code>{warning.path}</code>
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {state.status === 'loading' ? (
        <p className="state-note" data-testid="global-chains-loading">
          <span aria-hidden="true">◌</span> Loading global templates…
        </p>
      ) : null}

      {empty ? (
        <div className="empty-state" data-testid="global-chains-empty">
          <p>No global chain templates yet.</p>
          <p>
            Open a project, save a chain, then choose <strong>Save copy to library</strong> in
            the builder. The template can then be imported into any project.
          </p>
        </div>
      ) : null}

      {state.chains.length > 0 ? (
        <ul className="chain-list" data-testid="global-chain-list">
          {state.chains.map((chain) => {
            const isBusy = busyId === chain.id;
            const isConfirming = confirmingId === chain.id;
            return (
              <li
                className="chain-card"
                key={chain.id}
                data-testid="global-chain-card"
                data-chain-id={chain.id}
                data-chain-name={chain.name}
              >
                <div className="chain-card__identity">
                  <h2 className="chain-card__name">{chain.name}</h2>
                  <p className="chain-card__badges">
                    <span className="badge">
                      Harness: {CHAIN_HARNESS_LABELS[chain.harness]}
                    </span>
                    <span className="badge">
                      Session: {CHAIN_SESSION_MODE_LABELS[chain.sessionMode]}
                    </span>
                  </p>
                  <p className="chain-card__meta">
                    {stepsLabel(chain.steps.length)}
                    {' · '}
                    Updated{' '}
                    <time dateTime={chain.updatedAt}>
                      {formatRelativeTime(chain.updatedAt)}
                    </time>
                  </p>
                </div>

                <div className="chain-card__actions">
                  <button
                    type="button"
                    className="button button--small"
                    onClick={() => void importTemplate(chain)}
                    disabled={isBusy || destinationId === ''}
                    data-testid="global-chain-import"
                  >
                    {isBusy ? 'Importing…' : 'Import copy'}
                  </button>
                  <button
                    type="button"
                    className="button button--secondary button--danger button--small"
                    onClick={() => setConfirmingId(chain.id)}
                    disabled={isBusy}
                    data-testid="global-chain-remove"
                  >
                    Remove
                  </button>
                </div>

                {isConfirming ? (
                  <div
                    className="confirm-panel chain-card__confirm"
                    role="group"
                    aria-label={`Confirm removal of ${chain.name}`}
                  >
                    <p>
                      Remove <strong>{chain.name}</strong> from the global template library?
                      Project copies are not affected.
                    </p>
                    <div className="panel__actions">
                      <button
                        type="button"
                        className="button button--danger button--small"
                        onClick={() => void removeTemplate(chain)}
                        disabled={isBusy}
                        data-testid="global-chain-remove-confirm"
                      >
                        {isBusy ? 'Removing…' : 'Remove template'}
                      </button>
                      <button
                        type="button"
                        className="button button--secondary button--small"
                        onClick={() => setConfirmingId(null)}
                        disabled={isBusy}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
