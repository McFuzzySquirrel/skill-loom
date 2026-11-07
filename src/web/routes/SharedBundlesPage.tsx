import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChainBundle } from '../../shared/bundles';
import { chainBuilderPath, type Chain } from '../api/chains';
import { ApiClientError } from '../api/client';
import { toApiClientError } from '../api/projects';
import {
  sharedBundlesApi,
  type SharedLibraryEntry,
  type SharedLibrarySnapshot,
} from '../api/sharedBundles';
import { ImportBundleDialog } from '../components/ImportBundleDialog';
import { InlineError } from '../components/InlineError';
import { useStatusAnnouncer } from '../components/StatusRegion';
import { Link, useRouter } from '../router';
import { useRecentProjects } from '../hooks/useRecentProjects';

function entryStatusLabel(entry: SharedLibraryEntry): string {
  switch (entry.status) {
    case 'available':
      return 'Available for review';
    case 'invalid':
      return `Invalid: ${entry.message ?? 'bundle cannot be read'}`;
    case 'unsafe':
      return `Unsafe: ${entry.message ?? 'not a regular file'}`;
    case 'unreadable':
      return `Unreadable: ${entry.message ?? 'access denied'}`;
  }
}

export function SharedBundlesPage() {
  const { navigate } = useRouter();
  const { announce } = useStatusAnnouncer();
  const { state: projectsState } = useRecentProjects();
  const [snapshot, setSnapshot] = useState<SharedLibrarySnapshot>({
    directory: null,
    entries: [],
    truncated: false,
  });
  const [directory, setDirectory] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [loadingBundleId, setLoadingBundleId] = useState<string | null>(null);
  const [importingBundle, setImportingBundle] = useState<ChainBundle | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const projects = projectsState.status === 'ready' ? projectsState.projects : [];

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await sharedBundlesApi.list();
      setSnapshot(result);
      setDirectory(result.directory ?? '');
    } catch (caught) {
      setError(toApiClientError(caught, 'The shared bundle library could not be read.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (selectedProjectId === '' && projects.length > 0) {
      setSelectedProjectId(projects[0]?.id ?? '');
    }
  }, [projects, selectedProjectId]);

  const saveDirectory = async (value: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const configured = await sharedBundlesApi.configure(value);
      await reload();
      setDirectory(configured ?? '');
      announce(configured === null
        ? 'Cleared the shared bundle directory setting.'
        : 'Configured the shared bundle directory.');
      heading.current?.focus();
    } catch (caught) {
      const apiError = toApiClientError(caught, 'The shared bundle directory could not be configured.');
      setError(apiError);
      announce(`Shared directory could not be configured: ${apiError.message}`, 'assertive');
    } finally {
      setBusy(false);
    }
  };

  const openBundle = async (entry: SharedLibraryEntry) => {
    if (entry.status !== 'available' || selectedProjectId === '') return;
    setLoadingBundleId(entry.id);
    setError(null);
    try {
      const bundle = await sharedBundlesApi.read(entry.id);
      setImportingBundle(bundle);
    } catch (caught) {
      const apiError = toApiClientError(caught, 'The shared bundle could not be opened.');
      setError(apiError);
      announce(`Shared bundle could not be opened: ${apiError.message}`, 'assertive');
    } finally {
      setLoadingBundleId(null);
    }
  };

  const imported = (chain: Chain) => {
    announce(`Imported ${chain.name} from the shared library.`);
    navigate(chainBuilderPath(selectedProjectId, chain.id), { skipGuard: true });
  };

  return (
    <section aria-labelledby="shared-bundles-title" data-testid="shared-bundles-page">
      <header className="projects-header">
        <h1 className="panel__title" id="shared-bundles-title" ref={heading} tabIndex={-1}>
          Shared bundle library
        </h1>
        <p className="lede">
          Browse immutable `.loom.json` files on a configured filesystem directory or mounted
          share. This library is separate from local chain templates; publishers cannot overwrite
          or delete an existing bundle through this page.
        </p>
        <div className="panel__actions">
          <Link className="button button--secondary" to="/drafts">Chain drafts</Link>
          <Link className="button button--secondary" to="/chains">Local templates</Link>
        </div>
      </header>

      <section className="panel" aria-labelledby="shared-directory-title">
        <h2 className="section-title" id="shared-directory-title">Shared directory</h2>
        <p>
          Enter an existing absolute directory visible to the Skill Loom server. A mounted share
          must support same-directory hard links for atomic no-overwrite publication.
        </p>
        <div className="field">
          <label className="field__label" htmlFor="shared-directory-path">
            Server-side directory path
          </label>
          <input
            className="input"
            id="shared-directory-path"
            value={directory}
            onChange={(event) => setDirectory(event.target.value)}
            placeholder="/mnt/team/skill-loom"
            maxLength={4096}
            disabled={busy}
          />
        </div>
        <div className="panel__actions">
          <button
            type="button"
            className="button"
            onClick={() => void saveDirectory(directory)}
            disabled={busy || directory.trim() === ''}
          >
            {busy ? 'Saving…' : 'Configure directory'}
          </button>
          {snapshot.directory !== null ? (
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void saveDirectory(null)}
              disabled={busy}
            >
              Clear directory
            </button>
          ) : null}
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void reload()}
            disabled={loading || busy}
          >
            Refresh library
          </button>
        </div>
        {snapshot.directory !== null ? (
          <p className="field__hint">Configured path: <code>{snapshot.directory}</code></p>
        ) : (
          <p className="state-note">No shared directory is configured.</p>
        )}
      </section>

      {projects.length > 0 ? (
        <div className="field">
          <label className="field__label" htmlFor="shared-import-project">Import destination</label>
          <select
            className="input"
            id="shared-import-project"
            value={selectedProjectId}
            onChange={(event) => setSelectedProjectId(event.target.value)}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.displayName}</option>
            ))}
          </select>
        </div>
      ) : projectsState.status === 'ready' ? (
        <p className="state-note">Open a project before importing a shared bundle.</p>
      ) : null}

      {error !== null ? (
        <InlineError
          title="Shared library operation failed"
          message={error.message}
          code={error.code}
          httpStatus={error.status}
          onRetry={() => void reload()}
        />
      ) : null}
      {loading ? <p className="state-note">Loading shared bundles…</p> : null}
      {snapshot.truncated ? (
        <p className="state-note">
          Only the first 500 bundle files are shown. Move older bundles to another directory to
          browse them.
        </p>
      ) : null}
      {!loading && snapshot.directory !== null && snapshot.entries.length === 0 ? (
        <p className="state-note">No `.loom.json` bundles were found in this directory.</p>
      ) : null}
      {snapshot.entries.length > 0 ? (
        <ul className="chain-list" aria-label="Shared bundles">
          {snapshot.entries.map((entry) => (
            <li className="chain-card" key={entry.id} data-testid={`shared-bundle-${entry.id}`}>
              <div className="chain-card__header">
                <h2 className="chain-card__title">{entry.name ?? entry.filename}</h2>
                <span className="badge">{entryStatusLabel(entry)}</span>
              </div>
              {entry.status === 'available' ? (
                <p>
                  Format v{entry.version}; {entry.skills ?? 0} skill packages
                  {entry.agent === undefined ? '' : `; native agent ${entry.agent}`}.
                  Execution/test status: not verified by this library.
                </p>
              ) : null}
              <p className="field__hint"><code>{entry.filename}</code></p>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => void openBundle(entry)}
                disabled={
                  entry.status !== 'available' ||
                  selectedProjectId === '' ||
                  loadingBundleId !== null
                }
              >
                {loadingBundleId === entry.id ? 'Opening…' : 'Review and import'}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {importingBundle !== null ? (
        <ImportBundleDialog
          projectId={selectedProjectId}
          initialBundle={importingBundle}
          onImported={imported}
          onClose={() => setImportingBundle(null)}
        />
      ) : null}
    </section>
  );
}
