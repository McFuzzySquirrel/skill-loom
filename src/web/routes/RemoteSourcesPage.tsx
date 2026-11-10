import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  catalogApi,
  toApiClientError,
  type CatalogApi,
  type RemoteSkillSnapshot,
  type RemoteSkillSource,
} from '../api/catalog';
import type { ApiClientError } from '../api/client';
import { InlineError } from '../components/InlineError';
import { RemoteCatalogLimits } from '../components/RemoteCatalogLimits';
import { useStatusAnnouncer } from '../components/StatusRegion';
import { Link } from '../router';
import { formatMegabytes } from '../utils/size';

function SnapshotContents({ snapshot, disabled, refreshing, onRefresh }: {
  snapshot: RemoteSkillSnapshot;
  disabled: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [shown, setShown] = useState(50);
  const [shownAgents, setShownAgents] = useState(50);
  return (
    <details>
      <summary>
        Commit <code>{snapshot.revision}</code> — {snapshot.packages.length} skill packages, {snapshot.agents.length} native agents
      </summary>
      <section aria-label={`Snapshot ${snapshot.revision}`}>
        <button
          type="button"
          className="button button--secondary"
          aria-label={`Refresh saved commit ${snapshot.revision}`}
          disabled={disabled}
          onClick={onRefresh}
        >
          {refreshing ? 'Refreshing saved commit…' : 'Refresh this saved commit'}
        </button>
        {snapshot.packages.length === 0 ? (
          <p>No skill packages were found at this commit.</p>
        ) : (
          <>
            <ul>
              {snapshot.packages.slice(0, shown).map((item) => (
                <li key={`${item.repositoryPath}-${item.fingerprint}`}>
                  <strong>{item.name}</strong>
                  {' — '}{item.description || 'No description'}
                  {' '}<code>{item.repositoryPath}</code>
                  {' '}({item.files} files, {formatMegabytes(item.bytes)})
                </li>
              ))}
            </ul>
            {shown < snapshot.packages.length ? (
              <button type="button" className="button button--secondary" onClick={() => setShown((count) => count + 50)}>
                Show more packages ({String(shown)} of {String(snapshot.packages.length)} shown)
              </button>
            ) : null}
          </>
        )}
        {snapshot.agents.length === 0 ? (
          <p>No native agent definitions were found at this commit.</p>
        ) : (
          <>
            <h4>Native agent definitions</h4>
            <ul>
              {snapshot.agents.slice(0, shownAgents).map((agent) => (
                <li key={`${agent.harness}-${agent.repositoryPath}-${agent.fingerprint}`}>
                  <strong>{agent.name}</strong>
                  {' — '}{agent.description || 'No description'}
                  {' '}({agent.harness}; {agent.status})
                  {' '}<code>{agent.repositoryPath}</code>
                  {agent.statusReason === null ? null : ` — ${agent.statusReason}`}
                </li>
              ))}
            </ul>
            {shownAgents < snapshot.agents.length ? (
              <button type="button" className="button button--secondary" onClick={() => setShownAgents((count) => count + 50)}>
                Show more agents ({String(shownAgents)} of {String(snapshot.agents.length)} shown)
              </button>
            ) : null}
          </>
        )}
      </section>
    </details>
  );
}

export function RemoteSourcesPage({ api = catalogApi }: { api?: CatalogApi }) {
  const repositoryId = useId();
  const refId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const { announce } = useStatusAnnouncer();
  const [sources, setSources] = useState<RemoteSkillSource[]>([]);
  const [limitsDirty, setLimitsDirty] = useState(false);
  const [snapshots, setSnapshots] = useState<Record<string, RemoteSkillSnapshot[]>>({});
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [repository, setRepository] = useState('');
  const [ref, setRef] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);

  const loadSources = async () => {
    setLoading(true);
    setError(null);
    try {
      const current = await api.listRemoteSources();
      setSources(current);
      setNameDrafts(Object.fromEntries(current.map((source) => [source.id, source.name ?? ''])));
      const snapshotEntries = await Promise.all(current.map(async (source) => [
        source.id,
        await api.listRemoteSnapshots(source.id),
      ] as const));
      setSnapshots(Object.fromEntries(snapshotEntries));
    } catch (failure) {
      setError(toApiClientError(failure, 'Remote repositories could not be loaded.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSources();
  }, [api]);

  const addSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyId('adding');
    setError(null);
    try {
      const source = await api.addRemoteSource(repository.trim(), ref.trim() || undefined);
      setSources((current) => [...current, source]);
      setSnapshots((current) => ({ ...current, [source.id]: [] }));
      setRepository('');
      setRef('');
      announce('Remote repository registered. Refresh it to discover skill packages.');
      heading.current?.focus();
    } catch (failure) {
      const apiError = toApiClientError(failure, 'Remote repository could not be registered.');
      setError(apiError);
      announce(`Remote repository could not be registered: ${apiError.message}`, 'assertive');
    } finally {
      setBusyId(null);
    }
  };

  const refreshSource = async (source: RemoteSkillSource, revision?: string) => {
    setBusyId(revision === undefined ? source.id : `${source.id}:${revision}`);
    setError(null);
    try {
      const snapshot = await api.refreshRemoteSource(source.id, revision === undefined ? {} : { revision });
      setSnapshots((current) => ({
        ...current,
        [source.id]: [
          snapshot,
          ...(current[source.id] ?? []).filter((item) => item.revision !== snapshot.revision),
        ],
      }));
      announce(
        `Refreshed ${source.name ?? source.repository} at commit ${snapshot.revision.slice(0, 12)}. Found ${snapshot.packages.length} skill packages.`,
      );
    } catch (failure) {
      const apiError = toApiClientError(failure, 'The remote repository could not be refreshed.');
      setError(apiError);
      announce(`Remote repository refresh failed: ${apiError.message}`, 'assertive');
    } finally {
      setBusyId(null);
    }
  };

  const unregisterSource = async (source: RemoteSkillSource) => {
    setBusyId(source.id);
    setError(null);
    try {
      setSources(await api.removeRemoteSource(source.id));
      announce(`Unregistered ${source.name ?? source.repository} and deleted its saved snapshots.`);
    } catch (failure) {
      const apiError = toApiClientError(failure, 'The remote repository could not be unregistered.');
      setError(apiError);
      announce(`Remote repository could not be unregistered: ${apiError.message}`, 'assertive');
    } finally {
      setBusyId(null);
    }
  };

  const saveSourceName = async (source: RemoteSkillSource) => {
    const name = nameDrafts[source.id] ?? '';
    setBusyId(`${source.id}:name`);
    setError(null);
    try {
      const updated = await api.setRemoteSourceName(source.id, name);
      setSources((current) => current.map((candidate) => candidate.id === source.id ? updated : candidate));
      setNameDrafts((current) => ({ ...current, [source.id]: updated.name ?? '' }));
      announce(updated.name === undefined
        ? `Removed the friendly name for ${source.repository}.`
        : `Saved ${updated.name} as the friendly name for ${source.repository}.`);
    } catch (failure) {
      const apiError = toApiClientError(failure, 'The catalog name could not be saved.');
      setError(apiError);
      announce(`Catalog name could not be saved: ${apiError.message}`, 'assertive');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-labelledby="remote-sources-title">
      <header className="projects-header">
        <h1 className="panel__title" id="remote-sources-title" ref={heading} tabIndex={-1}>
          Remote skill repositories
        </h1>
        <p className="lede">
          Register Git repositories, then explicitly refresh to save a pinned snapshot of
          their skill packages. Repository files are inspected as data; Loom does not check
          them out or run their scripts.
        </p>
        <p className="field__hint">
          Use HTTPS or SSH URLs without embedded passwords or tokens. Private repository
          authentication must already be configured for Git on this machine.
        </p>
        <p className="field__hint">
          After explicitly refreshing snapshots,{' '}
          <Link to="/discovery">select candidate skills for a reusable workflow handoff</Link>.
        </p>
      </header>

      {error !== null ? (
        <InlineError
          title="Remote repository operation failed"
          message={error.message}
          code={error.code}
          httpStatus={error.status}
          onRetry={() => void loadSources()}
        />
      ) : null}

      <RemoteCatalogLimits
        api={api}
        sources={sources}
        onSourceUpdated={(updated) => setSources((current) =>
          current.map((source) => source.id === updated.id ? updated : source))}
        onDirtyChange={setLimitsDirty}
      />

      <section className="panel" aria-labelledby="add-remote-source-title">
        <h2 className="section-title" id="add-remote-source-title">Add a repository</h2>
        <form className="catalog-settings__form" onSubmit={(event) => void addSource(event)}>
          <div className="field">
            <label className="field__label" htmlFor={repositoryId}>Git repository URL</label>
            <input
              className="input"
              id={repositoryId}
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
              placeholder="https://github.com/owner/skills.git"
              autoComplete="url"
              disabled={busyId !== null}
              required
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={refId}>Branch, tag, or commit (optional)</label>
            <input
              className="input"
              id={refId}
              value={ref}
              onChange={(event) => setRef(event.target.value)}
              placeholder="main"
              autoComplete="off"
              disabled={busyId !== null}
            />
          </div>
          <button
            className="button"
            type="submit"
            disabled={busyId !== null || repository.trim() === ''}
          >
            {busyId === 'adding' ? 'Registering…' : 'Register repository'}
          </button>
        </form>
      </section>

      <section className="panel" aria-labelledby="registered-sources-title">
        <h2 className="section-title" id="registered-sources-title">Registered repositories</h2>
        {limitsDirty ? <p className="field__hint">Save or discard catalog limit changes before unregistering a repository.</p> : null}
        {loading ? <p role="status">Loading remote repositories…</p> : null}
        {!loading && sources.length === 0 ? (
          <p>No remote repositories are registered.</p>
        ) : null}
        <div className="chain-list">
          {sources.map((source) => (
            <article className="chain-list__item" key={source.id}>
              <h3>{source.name || source.repository}</h3>
              <p>{source.ref === undefined ? 'Default branch' : `Ref: ${source.ref}`}</p>
              <div className="field">
                <label className="field__label" htmlFor={`remote-source-name-${source.id}`}>Friendly catalog name</label>
                <input
                  className="input"
                  id={`remote-source-name-${source.id}`}
                  value={nameDrafts[source.id] ?? ''}
                  onChange={(event) => setNameDrafts((current) => ({ ...current, [source.id]: event.target.value }))}
                  maxLength={120}
                  disabled={busyId !== null}
                />
              </div>
              <div className="panel__actions">
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => void saveSourceName(source)}
                  disabled={
                    busyId !== null ||
                    (nameDrafts[source.id] ?? '') === (source.name ?? '')
                  }
                >
                  Save name
                </button>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => void refreshSource(source)}
                  disabled={busyId !== null}
                >
                  {busyId === source.id ? 'Refreshing…' : 'Refresh pinned snapshot'}
                </button>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => void unregisterSource(source)}
                  disabled={busyId !== null || limitsDirty}
                >
                  Unregister
                </button>
              </div>
              {(snapshots[source.id] ?? []).map((snapshot) => (
                <SnapshotContents
                  key={snapshot.revision}
                  snapshot={snapshot}
                  disabled={busyId !== null}
                  refreshing={busyId === `${source.id}:${snapshot.revision}`}
                  onRefresh={() => void refreshSource(source, snapshot.revision)}
                />
              ))}
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
