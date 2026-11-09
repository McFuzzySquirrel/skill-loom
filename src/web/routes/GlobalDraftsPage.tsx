import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { catalogApi, type CatalogHarness } from '../api/catalog';
import { type Chain, type ChainDraft } from '../api/chains';
import {
  globalDraftChainsApi,
  globalDraftsApi,
  type GlobalDraftsApi,
} from '../api/drafts';
import { ApiClientError } from '../api/client';
import { toApiClientError } from '../api/projects';
import { InlineError } from '../components/InlineError';
import { ExportChainDialog } from '../components/ExportChainDialog';
import { useStatusAnnouncer } from '../components/StatusRegion';
import { createLocalStepId } from '../hooks/useChainDraft';
import { Link, useRouter } from '../router';

export interface GlobalDraftsPageProps {
  api?: GlobalDraftsApi;
}

function draftPath(draftId: string): string {
  return `/drafts/${encodeURIComponent(draftId)}`;
}

export function GlobalDraftsPage({ api = globalDraftsApi }: GlobalDraftsPageProps) {
  const { announce } = useStatusAnnouncer();
  const { navigate } = useRouter();
  const [drafts, setDrafts] = useState<Chain[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);
  const [mutationError, setMutationError] = useState<ApiClientError | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [goal, setGoal] = useState('');
  const [harness, setHarness] = useState<CatalogHarness>('opencode');
  const [repositories, setRepositories] = useState([
    { id: 'repository-1', repository: '', ref: '' },
  ]);
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<ApiClientError | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const goalId = useId();
  const harnessId = useId();

  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await api.list(signal === undefined ? {} : { signal });
      setDrafts(result.chains);
    } catch (error) {
      if (signal?.aborted) return;
      setLoadError(toApiClientError(error, 'Global drafts could not be loaded.'));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  const removeDraft = async (draft: Chain) => {
    setBusyId(draft.id);
    setMutationError(null);
    try {
      await api.remove(draft.id, {
        ...(draft.revision === undefined ? {} : { expectedRevision: draft.revision }),
      });
      setConfirmingId(null);
      await reload();
      announce(`Deleted draft ${draft.name}.`);
      heading.current?.focus();
    } catch (error) {
      const apiError = toApiClientError(error, 'The draft could not be deleted.');
      setMutationError(apiError);
      announce(`Draft could not be deleted: ${apiError.message}`, 'assertive');
    } finally {
      setBusyId(null);
    }
  };

  const startDiscovery = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = goal.trim();
    if (outcome === '' || discoveryBusy) return;
    setDiscoveryBusy(true);
    setDiscoveryError(null);
    try {
      const selectedRepositories = repositories.filter(
        (entry) => entry.repository.trim() !== '',
      );
      for (const entry of selectedRepositories) {
        const source = await catalogApi.addRemoteSource(
          entry.repository.trim(),
          entry.ref.trim() === '' ? undefined : entry.ref.trim(),
        );
        await catalogApi.refreshRemoteSource(source.id);
      }
      const draft: ChainDraft = {
        name: outcome.slice(0, 100).trim(),
        harness,
        sessionMode: 'shared',
        steps: [{
          id: createLocalStepId(),
          kind: 'instruction',
          instruction: `Achieve this outcome: ${outcome}`,
        }],
        inputs: [],
        automaticPermissionOptIn: false,
      };
      const created = await globalDraftChainsApi.createChain('', draft);
      announce(
        selectedRepositories.length === 0
          ? 'Created a goal draft using the current remote catalog.'
          : `Registered and refreshed ${selectedRepositories.length} remote repositories and created a goal draft. Choose observed packages in the draft catalog.`,
      );
      navigate(`/drafts/${encodeURIComponent(created.id)}`);
    } catch (error) {
      const apiError = toApiClientError(
        error,
        'The scenario draft could not be created from the requested goal or repositories.',
      );
      setDiscoveryError(apiError);
      announce(
        `Scenario setup failed: ${apiError.message} Any repositories already registered remain available in the catalog.`,
        'assertive',
      );
    } finally {
      setDiscoveryBusy(false);
    }
  };

  const createDraftPath = '/drafts/new?name=Untitled%20chain&harness=opencode&sessionMode=shared';

  return (
    <section aria-labelledby="global-drafts-title" data-testid="global-drafts-page">
      <header className="projects-header">
        <h1
          className="panel__title"
          id="global-drafts-title"
          ref={heading}
          tabIndex={-1}
        >
          Chain drafts
        </h1>
        <p className="lede">
          Create and edit chains without selecting a project. Drafts are stored separately from
          project chains and reusable templates. Select pinned remote skills and native agents,
          then explicitly copy a draft into a project when it is ready.
        </p>
        <div className="panel__actions">
          <Link className="button button--secondary" to="/discovery">
            Discover reusable workflows
          </Link>
          <button
            type="button"
            className="button"
            onClick={() => setDiscoveryOpen((open) => !open)}
            data-testid="new-global-draft"
          >
            Start from a goal
          </button>
          <Link className="button button--secondary" to={createDraftPath}>
            Blank draft
          </Link>
          <Link className="button button--secondary" to="/sources">
            Manage remote repositories
          </Link>
        </div>
      </header>

      {discoveryOpen ? (
        <form className="panel" onSubmit={(event) => void startDiscovery(event)} data-testid="scenario-discovery-form">
          <h2 className="section-title">Start a manual goal draft</h2>
          <div className="field">
            <label className="field__label" htmlFor={goalId}>What outcome do you want?</label>
            <textarea
              className="input"
              id={goalId}
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              maxLength={1000}
              required
              aria-describedby={`${goalId}-hint`}
              disabled={discoveryBusy}
            />
            <p className="field__hint" id={`${goalId}-hint`}>
              This seeds a draft instruction; it does not recommend or assemble a scenario.
              Keep credentials and private runtime values out;
              add values that should be collected later as named inputs.
            </p>
          </div>
          <div className="field">
            <label className="field__label" htmlFor={harnessId}>Target harness</label>
            <select
              className="input"
              id={harnessId}
              value={harness}
              onChange={(event) => setHarness(event.target.value as CatalogHarness)}
              disabled={discoveryBusy}
            >
              <option value="opencode">OpenCode</option>
              <option value="copilot">Copilot CLI</option>
            </select>
          </div>
          <fieldset className="field">
            <legend className="field__label">Optional remote Git repositories</legend>
            <p className="field__hint">
              Enter HTTPS or SSH URLs and optional refs. Skill Loom fetches only after you submit,
              stores a pinned snapshot, and does not execute repository files.
            </p>
            {repositories.map((entry, index) => (
              <div className="remote-source-row" key={entry.id}>
                <div className="field">
                  <label className="field__label" htmlFor={`${entry.id}-url`}>
                    Repository URL {String(index + 1)}
                  </label>
                  <input
                    className="input"
                    id={`${entry.id}-url`}
                    value={entry.repository}
                    onChange={(event) => setRepositories((current) =>
                      current.map((candidate) =>
                        candidate.id === entry.id
                          ? { ...candidate, repository: event.target.value }
                          : candidate,
                      ),
                    )}
                    maxLength={2048}
                    placeholder="https://github.com/team/skills.git"
                    disabled={discoveryBusy}
                  />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor={`${entry.id}-ref`}>
                    Optional branch, tag, or commit
                  </label>
                  <input
                    className="input"
                    id={`${entry.id}-ref`}
                    value={entry.ref}
                    onChange={(event) => setRepositories((current) =>
                      current.map((candidate) =>
                        candidate.id === entry.id
                          ? { ...candidate, ref: event.target.value }
                          : candidate,
                      ),
                    )}
                    maxLength={255}
                    disabled={discoveryBusy}
                  />
                </div>
                {repositories.length > 1 ? (
                  <button
                    type="button"
                    className="button button--secondary button--small"
                    onClick={() => setRepositories((current) =>
                      current.filter((candidate) => candidate.id !== entry.id),
                    )}
                    disabled={discoveryBusy}
                  >
                    Remove repository {String(index + 1)}
                  </button>
                ) : null}
              </div>
            ))}
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => setRepositories((current) => [
                ...current,
                { id: `repository-${String(current.length + 1)}-${String(Date.now())}`, repository: '', ref: '' },
              ])}
              disabled={discoveryBusy}
            >
              Add another repository
            </button>
          </fieldset>
          {discoveryError !== null ? (
            <InlineError
              title="Scenario setup failed"
              message={discoveryError.message}
              code={discoveryError.code}
              httpStatus={discoveryError.status}
            />
          ) : null}
          <div className="panel__actions">
            <button type="submit" className="button" disabled={discoveryBusy || goal.trim() === ''}>
              {discoveryBusy ? 'Fetching pinned snapshots…' : 'Review catalog and build draft'}
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setDiscoveryOpen(false)}
              disabled={discoveryBusy}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {mutationError !== null ? (
        <InlineError
          title="Draft action failed"
          message={mutationError.message}
          code={mutationError.code}
          httpStatus={mutationError.status}
        />
      ) : null}
      {loadError !== null ? (
        <InlineError
          title="Drafts could not be loaded"
          message={loadError.message}
          code={loadError.code}
          httpStatus={loadError.status}
          onRetry={() => void reload()}
        />
      ) : null}
      {loading ? <p className="state-note">Loading drafts…</p> : null}
      {!loading && loadError === null && drafts.length === 0 ? (
        <p className="state-note" data-testid="global-drafts-empty">
          No saved drafts yet. Create one to start building from the remote catalog.
        </p>
      ) : null}
      {drafts.length > 0 ? (
        <ul className="chain-list" aria-label="Saved drafts">
          {drafts.map((draft) => (
            <li className="chain-card" key={draft.id} data-testid={`global-draft-${draft.id}`}>
              <div className="chain-card__header">
                <h2 className="chain-card__title">
                  <Link to={draftPath(draft.id)}>{draft.name}</Link>
                </h2>
                <span className="badge">Draft</span>
              </div>
              <p>{draft.steps.length} steps · {draft.harness} · {draft.sessionMode}</p>
              {draft.agent === undefined ? null : (
                <p>Native agent: {draft.agent.name}</p>
              )}
              <p className="field__hint">
                Updated {new Intl.DateTimeFormat(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(draft.updatedAt))}
              </p>
              <div className="panel__actions">
                <Link className="button button--secondary" to={draftPath(draft.id)}>
                  Edit draft
                </Link>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => setExportingId(draft.id)}
                  data-testid={`export-draft-${draft.id}`}
                >
                  Export bundle
                </button>
                <button
                  type="button"
                  className="button button--danger button--small"
                  onClick={() => setConfirmingId(draft.id)}
                  disabled={busyId === draft.id}
                >
                  Delete draft
                </button>
              </div>
              {confirmingId === draft.id ? (
                <div className="confirm-panel" role="group" aria-label={`Confirm deleting ${draft.name}`}>
                  <p>Delete this draft? Project chains and templates are not changed.</p>
                  <div className="panel__actions">
                    <button
                      type="button"
                      className="button button--danger button--small"
                      onClick={() => void removeDraft(draft)}
                      disabled={busyId === draft.id}
                    >
                      {busyId === draft.id ? 'Deleting…' : 'Confirm delete'}
                    </button>
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      onClick={() => setConfirmingId(null)}
                      disabled={busyId === draft.id}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {exportingId !== null ? (
        <ExportChainDialog
          draftId={exportingId}
          onClose={() => setExportingId(null)}
        />
      ) : null}
    </section>
  );
}
