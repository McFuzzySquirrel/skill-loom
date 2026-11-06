import { useEffect, useRef, useState } from 'react';
import type { ApiClientError } from '../api/client';
import {
  chainBuilderPath,
  chainRunPath,
  chainsApi,
  toApiClientError,
  type Chain,
  type ChainStoreWarning,
  type ChainsApi,
} from '../api/chains';
import {
  CHAIN_HARNESS_LABELS,
  CHAIN_SESSION_MODE_LABELS,
  useChains,
} from '../hooks/useChains';
import { Link } from '../router';
import { ImportChainDialog } from './ImportChainDialog';
import { ImportBundleDialog } from './ImportBundleDialog';
import { ExportChainDialog } from './ExportChainDialog';
import { InlineError } from './InlineError';
import { NewChainDialog } from './NewChainDialog';
import { useStatusAnnouncer } from './StatusRegion';
import { HelpPopover } from './HelpPopover';

export interface ChainListProps {
  projectId: string;
  api?: ChainsApi;
}

interface MutationFailure {
  title: string;
  error: ApiClientError;
}

type BusyAction = 'duplicate' | 'delete';

interface BusyState {
  chainId: string;
  action: BusyAction;
}

function formatAbsolute(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/** Local, human-readable relative time; the exact timestamp stays in `title`. */
export function formatRelativeTime(value: string, now: number = Date.now()): string {
  const date = new Date(value);
  const timestamp = date.getTime();
  if (Number.isNaN(timestamp)) {
    return value;
  }

  const difference = timestamp - now;
  const magnitude = Math.abs(difference);
  if (magnitude < 45_000) {
    return 'just now';
  }

  const units: Array<{ unit: Intl.RelativeTimeFormatUnit; milliseconds: number }> = [
    { unit: 'year', milliseconds: 31_536_000_000 },
    { unit: 'month', milliseconds: 2_592_000_000 },
    { unit: 'week', milliseconds: 604_800_000 },
    { unit: 'day', milliseconds: 86_400_000 },
    { unit: 'hour', milliseconds: 3_600_000 },
    { unit: 'minute', milliseconds: 60_000 },
  ];

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const { unit, milliseconds } of units) {
    if (magnitude >= milliseconds) {
      return formatter.format(Math.round(difference / milliseconds), unit);
    }
  }
  return 'just now';
}

function stepCountLabel(count: number): string {
  return `${String(count)} step${count === 1 ? '' : 's'}`;
}

/**
 * Project chain library (CHAIN-FR-04).
 *
 * Cards are keyed by server chain ids, never names. Delete is a two-step,
 * consequence-stating confirmation; Duplicate reloads the list and focuses the
 * new card; corrupt-file warnings render above valid chains. The catalog panel
 * is a sibling on the project route and stays visible throughout.
 */
export function ChainList({ projectId, api = chainsApi }: ChainListProps) {
  const { state, reload } = useChains({ projectId, api });
  const { announce } = useStatusAnnouncer();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [bundleImportOpen, setBundleImportOpen] = useState(false);
  const [exportChainId, setExportChainId] = useState<string | null>(null);
  const bundleTrigger = useRef<HTMLButtonElement>(null);
  const exportTrigger = useRef<HTMLButtonElement | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyState | null>(null);
  const [mutationFailure, setMutationFailure] = useState<MutationFailure | null>(null);
  const [focusChainId, setFocusChainId] = useState<string | null>(null);

  const heading = useRef<HTMLHeadingElement>(null);
  const newChainTrigger = useRef<HTMLButtonElement>(null);
  const restoreNewChainFocus = useRef(false);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const deleteButtons = useRef(new Map<string, HTMLButtonElement>());
  const cardHeadings = useRef(new Map<string, HTMLHeadingElement>());
  const restoreDeleteFocusId = useRef<string | null>(null);
  const focusLibraryHeading = useRef(false);

  useEffect(() => {
    if (!dialogOpen && restoreNewChainFocus.current) {
      restoreNewChainFocus.current = false;
      newChainTrigger.current?.focus();
    }
  }, [dialogOpen]);

  useEffect(() => {
    if (confirmingId !== null) {
      confirmButton.current?.focus();
      return;
    }
    if (focusLibraryHeading.current) {
      focusLibraryHeading.current = false;
      heading.current?.focus();
      return;
    }
    const id = restoreDeleteFocusId.current;
    if (id !== null) {
      restoreDeleteFocusId.current = null;
      deleteButtons.current.get(id)?.focus();
    }
  }, [confirmingId]);

  useEffect(() => {
    if (focusChainId === null) {
      return;
    }
    const target = cardHeadings.current.get(focusChainId);
    if (target !== undefined) {
      target.focus();
      setFocusChainId(null);
    }
  }, [focusChainId, state.chains]);

  const openNewChain = () => {
    setMutationFailure(null);
    restoreNewChainFocus.current = false;
    setDialogOpen(true);
    announce('New chain dialog opened. Enter a name and choose a harness.');
  };

  const closeNewChain = () => {
    restoreNewChainFocus.current = true;
    setDialogOpen(false);
  };

  const cancelDelete = () => {
    restoreDeleteFocusId.current = confirmingId;
    setConfirmingId(null);
  };

  const duplicate = async (chain: Chain) => {
    setMutationFailure(null);
    setBusy({ chainId: chain.id, action: 'duplicate' });
    try {
      const copy = await api.duplicateChain(projectId, chain.id);
      setFocusChainId(copy.id);
      await reload();
      announce(`Duplicated ${chain.name} as ${copy.name}.`);
    } catch (error) {
      const apiError = toApiClientError(
        error,
        'An unexpected error prevented duplicating this chain.',
      );
      setMutationFailure({ title: 'Chain could not be duplicated', error: apiError });
      announce(`Chain could not be duplicated: ${apiError.message}`);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (chain: Chain) => {
    setMutationFailure(null);
    setBusy({ chainId: chain.id, action: 'delete' });
    try {
      await api.deleteChain(projectId, chain.id);
      await reload();
      focusLibraryHeading.current = true;
      setConfirmingId(null);
      announce(`Deleted chain ${chain.name}. No other chain or project file was removed.`);
    } catch (error) {
      const apiError = toApiClientError(
        error,
        'An unexpected error prevented deleting this chain.',
      );
      setMutationFailure({ title: 'Chain could not be deleted', error: apiError });
      announce(`Chain could not be deleted: ${apiError.message}`);
    } finally {
      setBusy(null);
    }
  };

  const showEmpty =
    state.status === 'ready' && state.chains.length === 0 && state.error === null;

  return (
    <section
      className="panel chain-library"
      aria-labelledby="chain-library-title"
      aria-busy={
        state.status === 'loading' || state.refreshing || busy !== null
      }
      data-testid="chain-library"
    >
      <div className="chain-library__heading">
        <div className="chain-library__intro">
          <div className="page-title-row">
            <h2 className="section-title chain-library__title" id="chain-library-title" ref={heading} tabIndex={-1}>
              Chains
            </h2>
            <HelpPopover topic="projectChains" />
          </div>
          <p className="field__hint">
            Chains are saved as project-local JSON inside <code>.loom/chains</code>. Skills
            are model-invoked context: Skill Loom guarantees prompt order, not that a harness
            loads a named skill.
          </p>
        </div>
        <div className="panel__actions chain-library__actions">
          <button
            type="button"
            className="button button--secondary"
            ref={bundleTrigger}
            onClick={() => { setBundleImportOpen(true); setExportChainId(null); }}
            disabled={busy !== null || bundleImportOpen}
          >
            Import bundle
          </button>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => {
              setMutationFailure(null);
              setImportOpen(true);
            }}
            disabled={busy !== null}
            data-testid="import-chain-open"
          >
            Import template
          </button>
          <button
            type="button"
            className="button"
            ref={newChainTrigger}
            onClick={openNewChain}
            disabled={busy !== null}
            data-testid="new-chain-open"
          >
            New chain
          </button>
        </div>
      </div>

      {dialogOpen ? (
        <NewChainDialog projectId={projectId} onClose={closeNewChain} />
      ) : null}

      {exportChainId !== null ? (
        <ExportChainDialog
          projectId={projectId}
          chainId={exportChainId}
          onClose={() => {
            setExportChainId(null);
            exportTrigger.current?.focus();
          }}
        />
      ) : null}

      {bundleImportOpen ? (
        <ImportBundleDialog
          projectId={projectId}
          onClose={() => { setBundleImportOpen(false); bundleTrigger.current?.focus(); }}
          onImported={(chain) => {
            setBundleImportOpen(false);
            setFocusChainId(chain.id);
            void reload();
          }}
        />
      ) : null}

      {importOpen ? (
        <ImportChainDialog
          projectId={projectId}
          onClose={() => setImportOpen(false)}
          onImported={(chain) => {
            setImportOpen(false);
            setFocusChainId(chain.id);
            void reload();
          }}
        />
      ) : null}

      {state.status === 'loading' ? (
        <p className="state-note" data-testid="chain-library-loading">
          <span aria-hidden="true">◌</span> Loading chains…
        </p>
      ) : null}

      {state.refreshing ? (
        <p className="state-note" data-testid="chain-library-refreshing">
          <span aria-hidden="true">◌</span> Refreshing chains…
        </p>
      ) : null}

      {state.error !== null ? (
        <div data-testid="chain-library-error">
          <InlineError
            title="Chain library failed"
            message={state.error.message}
            code={state.error.code}
            httpStatus={state.error.status}
            onRetry={() => void reload()}
          />
        </div>
      ) : null}

      {mutationFailure !== null ? (
        <div data-testid="chain-mutation-error">
          <InlineError
            title={mutationFailure.title}
            message={mutationFailure.error.message}
            code={mutationFailure.error.code}
            httpStatus={mutationFailure.error.status}
          />
        </div>
      ) : null}

      {state.warnings.length > 0 ? (
        <section
          className="chain-warnings"
          aria-labelledby="chain-warnings-title"
          data-testid="chain-warnings"
        >
          <h3 className="chain-warnings__title" id="chain-warnings-title">
            <span aria-hidden="true">▲</span> {String(state.warnings.length)} chain file
            warning{state.warnings.length === 1 ? '' : 's'} — valid chains are still shown
          </h3>
          <ul className="chain-warnings__list">
            {state.warnings.map((warning, index) => (
              <ChainWarningRow
                warning={warning}
                key={`${warning.chainId}-${warning.path}-${warning.code}-${String(index)}`}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {showEmpty ? (
        <div className="empty-state" data-testid="chain-library-empty">
          <p>No chains yet.</p>
          <p>
            Select <strong>New chain</strong> to name a recipe, choose its harness, and
            start an ordered sequence of skills.
          </p>
        </div>
      ) : null}

      {state.chains.length > 0 ? (
        <ul className="chain-list" data-testid="chain-list">
          {state.chains.map((chain) => {
            const isConfirming = confirmingId === chain.id;
            const isBusy = busy?.chainId === chain.id;
            const isDuplicating = isBusy && busy.action === 'duplicate';
            const isDeleting = isBusy && busy.action === 'delete';

            return (
              <li
                className="chain-card"
                key={chain.id}
                data-testid="chain-card"
                data-chain-id={chain.id}
                data-chain-name={chain.name}
                data-harness={chain.harness}
                data-session-mode={chain.sessionMode}
              >
                <div className="chain-card__identity">
                  <h3
                    className="chain-card__name"
                    tabIndex={-1}
                    ref={(node) => {
                      if (node === null) {
                        cardHeadings.current.delete(chain.id);
                      } else {
                        cardHeadings.current.set(chain.id, node);
                      }
                    }}
                  >
                    {chain.name}
                  </h3>
                  <p className="chain-card__badges">
                    <span
                      className="badge"
                      data-testid="chain-harness"
                      data-harness={chain.harness}
                    >
                      Harness: {CHAIN_HARNESS_LABELS[chain.harness]}
                    </span>
                    <span
                      className="badge"
                      data-testid="chain-session-mode"
                      data-session-mode={chain.sessionMode}
                    >
                      Session: {CHAIN_SESSION_MODE_LABELS[chain.sessionMode]}
                    </span>
                  </p>
                  <p className="chain-card__meta">
                    <span data-testid="chain-step-count">
                      {stepCountLabel(chain.steps.length)}
                    </span>
                    {' · '}
                    <span data-testid="chain-updated">
                      Updated{' '}
                      <time dateTime={chain.updatedAt} title={formatAbsolute(chain.updatedAt)}>
                        {formatRelativeTime(chain.updatedAt)}
                      </time>
                    </span>
                  </p>
                </div>

                <div className="chain-card__actions">
                  <button
                    type="button"
                    className="button button--secondary button--small"
                    disabled={busy !== null || bundleImportOpen}
                    aria-label={`Export ${chain.name}`}
                    onClick={(event) => {
                      exportTrigger.current = event.currentTarget;
                      setExportChainId(chain.id);
                    }}
                  >
                    Export
                  </button>
                  <Link
                    className="button button--small"
                    to={chainRunPath(projectId, chain.id)}
                    aria-label={`Run ${chain.name}`}
                    data-testid="chain-run"
                  >
                    Run
                  </Link>
                  <Link
                    className="button button--secondary button--small"
                    to={chainBuilderPath(projectId, chain.id)}
                    aria-label={`Open ${chain.name}`}
                  >
                    Open
                  </Link>
                  <button
                    type="button"
                    className="button button--secondary button--small"
                    onClick={() => void duplicate(chain)}
                    disabled={busy !== null}
                    aria-label={`Duplicate ${chain.name}`}
                  >
                    {isDuplicating ? 'Duplicating…' : 'Duplicate'}
                  </button>
                  <button
                    type="button"
                    className="button button--secondary button--small button--danger"
                    ref={(node) => {
                      if (node === null) {
                        deleteButtons.current.delete(chain.id);
                      } else {
                        deleteButtons.current.set(chain.id, node);
                      }
                    }}
                    onClick={() => setConfirmingId(chain.id)}
                    disabled={busy !== null}
                    aria-label={`Delete ${chain.name}`}
                  >
                    {isDeleting ? 'Deleting…' : 'Delete'}
                  </button>
                </div>

                {isConfirming ? (
                  <div
                    className="confirm-panel chain-card__confirm"
                    role="group"
                    aria-label={`Confirm deletion of ${chain.name}`}
                  >
                    <p>
                      Delete <strong>{chain.name}</strong>? This removes only{' '}
                      <code>
                        .loom/chains/{chain.id}.json
                      </code>{' '}
                      and cannot be undone. Other chains and project files are not
                      affected.
                    </p>
                    <div className="panel__actions">
                      <button
                        type="button"
                        className="button button--danger button--small"
                        ref={confirmButton}
                        onClick={() => void remove(chain)}
                        disabled={isBusy}
                        data-testid="chain-delete-confirm"
                      >
                        {isDeleting ? 'Deleting…' : 'Delete chain'}
                      </button>
                      <button
                        type="button"
                        className="button button--secondary button--small"
                        onClick={cancelDelete}
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

function ChainWarningRow({ warning }: { warning: ChainStoreWarning }) {
  return (
    <li className="chain-warnings__item" data-testid="chain-warning">
      <p className="chain-warnings__message">{warning.message}</p>
      <p className="chain-warnings__meta">
        <code>{warning.code}</code> · chain <code>{warning.chainId}</code> ·{' '}
        <code>{warning.path}</code>
        {warning.version === undefined ? null : (
          <> · version {String(warning.version)}</>
        )}
      </p>
      {warning.reason === undefined ? null : (
        <p className="chain-warnings__meta">Reason: {warning.reason}</p>
      )}
    </li>
  );
}
