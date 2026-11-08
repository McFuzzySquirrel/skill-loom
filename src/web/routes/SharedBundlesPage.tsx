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
import { BundleContents } from '../components/BundleContents';
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
  const [reviewingBundle, setReviewingBundle] = useState<{ name: string; bundle: ChainBundle } | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadPreview, setUploadPreview] = useState<{ bundle: ChainBundle; reviewFingerprint: string } | null>(null);
  const [uploadContentsReviewed, setUploadContentsReviewed] = useState(false);
  const [uploadRedistributionReviewed, setUploadRedistributionReviewed] = useState(false);
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

  const readBundle = async (entry: SharedLibraryEntry) => {
    if (entry.status !== 'available') return;
    setLoadingBundleId(entry.id);
    setError(null);
    try {
      const bundle = await sharedBundlesApi.read(entry.id);
      setReviewingBundle({ name: entry.name ?? entry.filename, bundle });
    } catch (caught) {
      const apiError = toApiClientError(caught, 'The shared bundle could not be reviewed.');
      setError(apiError);
      announce(`Shared bundle could not be reviewed: ${apiError.message}`, 'assertive');
    } finally {
      setLoadingBundleId(null);
    }
  };

  const openImport = async (entry: SharedLibraryEntry) => {
    if (entry.status !== 'available' || selectedProjectId === '') return;
    setLoadingBundleId(entry.id);
    setError(null);
    try {
      setImportingBundle(await sharedBundlesApi.read(entry.id));
    } catch (caught) {
      const apiError = toApiClientError(caught, 'The shared bundle could not be opened for import.');
      setError(apiError);
      announce(`Shared bundle could not be opened: ${apiError.message}`, 'assertive');
    } finally {
      setLoadingBundleId(null);
    }
  };

  const previewUpload = async (file: File | undefined) => {
    setUploadPreview(null);
    setUploadContentsReviewed(false);
    setUploadRedistributionReviewed(false);
    setError(null);
    if (!file) return;
    setBusy(true);
    try {
      if (!file.name.endsWith('.loom.json')) {
        throw new ApiClientError('Choose a Skill Loom `.loom.json` chain bundle.', { code: 'BUNDLE_INVALID', status: 422 });
      }
      if (file.size > 30 * 1024 * 1024) {
        throw new ApiClientError('Bundle files must be smaller than 30 MiB.', { code: 'BUNDLE_TOO_LARGE', status: 413 });
      }
      let raw: unknown;
      try {
        raw = JSON.parse(await file.text()) as unknown;
      } catch {
        throw new ApiClientError('The selected bundle is not valid JSON.', { code: 'BUNDLE_INVALID', status: 422 });
      }
      const preview = await sharedBundlesApi.previewUpload(raw);
      setUploadPreview(preview);
      setUploadName(preview.bundle.chain.name);
      announce(`Reviewed ${preview.bundle.chain.name} from the selected local bundle.`);
    } catch (caught) {
      const apiError = toApiClientError(caught, 'The local bundle could not be reviewed.');
      setError(apiError);
      announce(`Local bundle review failed: ${apiError.message}`, 'assertive');
    } finally {
      setBusy(false);
    }
  };

  const publishUpload = async () => {
    if (
      uploadPreview === null ||
      uploadName.trim() === '' ||
      !uploadContentsReviewed ||
      !uploadRedistributionReviewed ||
      busy
    ) return;
    setBusy(true);
    setError(null);
    try {
      const entry = await sharedBundlesApi.publishUpload({
        bundle: uploadPreview.bundle,
        displayName: uploadName.trim(),
        contentsReviewed: true,
        redistributionReviewed: true,
        reviewFingerprint: uploadPreview.reviewFingerprint,
      });
      await reload();
      setUploadPreview(null);
      setUploadName('');
      setUploadContentsReviewed(false);
      setUploadRedistributionReviewed(false);
      announce(`Added ${entry.name ?? entry.filename} to the shared bundle library.`);
      heading.current?.focus();
    } catch (caught) {
      const apiError = toApiClientError(caught, 'The reviewed bundle could not be published.');
      setError(apiError);
      announce(`Shared bundle publication failed: ${apiError.message}`, 'assertive');
    } finally {
      setBusy(false);
    }
  };

  const downloadReviewedBundle = () => {
    if (reviewingBundle === null) return;
    const blob = new Blob([`${JSON.stringify(reviewingBundle.bundle, null, 2)}\n`], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${reviewingBundle.name.replace(/[^A-Za-z0-9._-]+/g, '-')}.loom.json`;
    link.click();
    URL.revokeObjectURL(url);
    announce('Downloaded the reviewed shared bundle.');
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
          <Link className="button button--secondary" to="/library">Library overview</Link>
          <a className="button button--secondary" href="/api/portable-skill">
            Download loom-run-bundle
          </a>
        </div>
        <p className="field__hint">
          The portable runner works inside a compatible host and does not launch a harness.
          It cannot prepare v2 bundles with selected native agents; use Skill Loom's managed
          designer and run flow for those bundles.
        </p>
      </header>

      <section className="panel" aria-labelledby="shared-upload-title">
        <h2 className="section-title" id="shared-upload-title">Review and add bundle</h2>
        <p>
          Choose a local `.loom.json` file to validate and inspect it before publication.
          The browser sends the file contents to this local server; it does not send a
          filesystem path. Adding a bundle does not execute it, install skills, or establish
          redistribution rights.
        </p>
        <div className="field">
          <label className="field__label" htmlFor="shared-upload-file">Local chain bundle (.loom.json)</label>
          <input
            id="shared-upload-file"
            type="file"
            accept=".loom.json,application/json"
            disabled={busy}
            onChange={(event) => void previewUpload(event.target.files?.[0])}
          />
        </div>
        {uploadPreview ? (
          <>
            <BundleContents bundle={uploadPreview.bundle} />
            <div className="field">
              <label className="field__label" htmlFor="shared-upload-name">Library display name</label>
              <input
                className="input"
                id="shared-upload-name"
                value={uploadName}
                maxLength={100}
                onChange={(event) => setUploadName(event.target.value)}
                disabled={busy}
              />
            </div>
            <label className="checkbox-field">
              <input type="checkbox" checked={uploadContentsReviewed} onChange={(event) => setUploadContentsReviewed(event.target.checked)} disabled={busy} />
              <span>I reviewed every instruction and package file for sensitive content.</span>
            </label>
            <label className="checkbox-field">
              <input type="checkbox" checked={uploadRedistributionReviewed} onChange={(event) => setUploadRedistributionReviewed(event.target.checked)} disabled={busy} />
              <span>I separately reviewed applicable licenses and redistribution rights.</span>
            </label>
            <button
              type="button"
              className="button"
              onClick={() => void publishUpload()}
              disabled={busy || uploadName.trim() === '' || !uploadContentsReviewed || !uploadRedistributionReviewed}
            >
              {busy ? 'Publishing…' : 'Publish reviewed bundle'}
            </button>
          </>
        ) : null}
      </section>

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
        <p className="state-note">You can review and download bundles without a project. Open a project only when you want to import one.</p>
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
                onClick={() => void readBundle(entry)}
                disabled={entry.status !== 'available' || loadingBundleId !== null}
              >
                {loadingBundleId === entry.id ? 'Opening…' : 'Review and download'}
              </button>
              {entry.status === 'available' ? (
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => void openImport(entry)}
                  disabled={selectedProjectId === '' || loadingBundleId !== null}
                >
                  {selectedProjectId === '' ? 'Import into project (choose a project)' : 'Import into project'}
                </button>
              ) : null}
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
      {reviewingBundle !== null ? (
        <section className="panel" aria-labelledby="shared-review-title">
          <h2 className="section-title" id="shared-review-title">Review shared bundle: {reviewingBundle.name}</h2>
          <p>Review and download do not require a project. Downloading does not import, install, or run the bundle.</p>
          <BundleContents bundle={reviewingBundle.bundle} />
          <div className="panel__actions">
            <button type="button" className="button" onClick={downloadReviewedBundle}>Download reviewed bundle</button>
            <button type="button" className="button button--secondary" onClick={() => setReviewingBundle(null)}>Close review</button>
          </div>
        </section>
      ) : null}
    </section>
  );
}
