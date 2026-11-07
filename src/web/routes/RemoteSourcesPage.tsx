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
import { useStatusAnnouncer } from '../components/StatusRegion';

export function RemoteSourcesPage({ api = catalogApi }: { api?: CatalogApi }) {
  const repositoryId = useId();
  const refId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const { announce } = useStatusAnnouncer();
  const [sources, setSources] = useState<RemoteSkillSource[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, RemoteSkillSnapshot[]>>({});
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

  const refreshSource = async (source: RemoteSkillSource) => {
    setBusyId(source.id);
    setError(null);
    try {
      const snapshot = await api.refreshRemoteSource(source.id);
      setSnapshots((current) => ({
        ...current,
        [source.id]: [
          snapshot,
          ...(current[source.id] ?? []).filter((item) => item.revision !== snapshot.revision),
        ],
      }));
      announce(
        `Refreshed ${source.repository} at commit ${snapshot.revision.slice(0, 12)}. Found ${snapshot.packages.length} skill packages.`,
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
      announce(`Unregistered ${source.repository}. Saved snapshots were retained.`);
    } catch (failure) {
      const apiError = toApiClientError(failure, 'The remote repository could not be unregistered.');
      setError(apiError);
      announce(`Remote repository could not be unregistered: ${apiError.message}`, 'assertive');
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
        {loading ? <p role="status">Loading remote repositories…</p> : null}
        {!loading && sources.length === 0 ? (
          <p>No remote repositories are registered.</p>
        ) : null}
        <div className="chain-list">
          {sources.map((source) => (
            <article className="chain-list__item" key={source.id}>
              <h3>{source.repository}</h3>
              <p>{source.ref === undefined ? 'Default branch' : `Ref: ${source.ref}`}</p>
              <div className="panel__actions">
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
                  disabled={busyId !== null}
                >
                  Unregister
                </button>
              </div>
              {(snapshots[source.id] ?? []).map((snapshot) => (
                <section key={snapshot.revision} aria-label={`Snapshot ${snapshot.revision}`}>
                  <h4>Commit <code>{snapshot.revision}</code></h4>
                  {snapshot.packages.length === 0 ? (
                    <p>No skill packages were found at this commit.</p>
                  ) : (
                    <ul>
                      {snapshot.packages.map((item) => (
                        <li key={`${item.repositoryPath}-${item.fingerprint}`}>
                          <strong>{item.name}</strong>
                          {' — '}{item.description || 'No description'}
                          {' '}<code>{item.repositoryPath}</code>
                          {' '}({item.files} files, {item.bytes} bytes)
                        </li>
                      ))}
                    </ul>
                  )}
                  {snapshot.agents.length === 0 ? (
                    <p>No native agent definitions were found at this commit.</p>
                  ) : (
                    <>
                      <h4>Native agent definitions</h4>
                      <ul>
                        {snapshot.agents.map((agent) => (
                          <li key={`${agent.harness}-${agent.repositoryPath}-${agent.fingerprint}`}>
                            <strong>{agent.name}</strong>
                            {' — '}{agent.description || 'No description'}
                            {' '}({agent.harness}; {agent.status})
                            {' '}<code>{agent.repositoryPath}</code>
                            {agent.statusReason === null ? null : ` — ${agent.statusReason}`}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </section>
              ))}
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
