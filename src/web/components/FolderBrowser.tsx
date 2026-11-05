import { useEffect, useState, type FormEvent } from 'react';
import {
  projectsApi,
  toApiClientError,
  type ProjectRegistration,
  type ProjectsApi,
} from '../api/projects';
import type { ApiClientError } from '../api/client';
import { isAbsolutePath } from '../../shared/paths';
import { useDirectoryListing } from '../hooks/useDirectoryListing';
import { InlineError } from './InlineError';

/** The browser API exposes no server home directory, so Home is the root. */
export const FOLDER_BROWSER_HOME = '/';

export interface FolderBrowserProps {
  initialPath?: string;
  onProjectOpened: (project: ProjectRegistration) => void;
  onNewProject: (parentPath: string) => void;
  api?: ProjectsApi;
}

/**
 * Server-backed folder browser.
 *
 * Selecting a directory navigates into it; "Open this folder" registers the
 * current canonical directory as the project. The browser only ever sends an
 * absolute path to the typed API, and every loading, empty, invalid-path, and
 * server-error state is rendered distinctly.
 */
export function FolderBrowser({
  initialPath = FOLDER_BROWSER_HOME,
  onProjectOpened,
  onNewProject,
  api = projectsApi,
}: FolderBrowserProps) {
  const [pathInput, setPathInput] = useState(initialPath);
  const [pathError, setPathError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<ApiClientError | null>(null);
  const { state, load } = useDirectoryListing(initialPath, api);

  useEffect(() => {
    if (state.status === 'ready') {
      setPathInput(state.listing.path);
    }
  }, [state]);

  const navigateTo = (path: string) => {
    setPathError(null);
    setOpenError(null);
    setPathInput(path);
    void load(path);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const requested = pathInput.trim();
    if (requested === '') {
      setPathError('Enter an absolute folder path.');
      return;
    }
    if (!isAbsolutePath(requested)) {
      setPathError('Enter an absolute POSIX or Windows folder path.');
      return;
    }
    navigateTo(requested);
  };

  const currentPath =
    state.status === 'ready' ? state.listing.path : pathInput.trim();

  const openCurrent = async () => {
    const target = currentPath;
    if (target === '' || !isAbsolutePath(target)) {
      setPathError('Open an absolute folder before registering it as a project.');
      return;
    }

    setOpening(true);
    setOpenError(null);
    try {
      const project = await api.openProject(target);
      setOpening(false);
      onProjectOpened(project);
    } catch (error) {
      setOpening(false);
      setOpenError(
        toApiClientError(error, 'An unexpected error prevented opening the project.'),
      );
    }
  };

  return (
    <section className="panel project-browser" aria-labelledby="folder-browser-title">
      <h2 className="section-title" id="folder-browser-title">
        Folder browser
      </h2>
      <p className="field__hint">
        Browse any readable folder on this machine. The path is resolved by the Skill Loom
        server; the browser never reads file contents.
      </p>

      <form className="browser-path-form" onSubmit={handleSubmit} noValidate>
        <label className="field__label" htmlFor="folder-path">
          Folder path
        </label>
        <div className="browser-path-form__row">
          <input
            className="input"
            id="folder-path"
            name="folder-path"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            value={pathInput}
            onChange={(event) => {
              setPathInput(event.target.value);
              setPathError(null);
            }}
            aria-describedby="folder-path-hint"
            aria-invalid={pathError !== null}
          />
          <button type="submit" className="button button--secondary">
            Go
          </button>
        </div>
        <p className="field__hint" id="folder-path-hint">
          Enter an absolute path, for example <code>/home/you/code/project</code> or{' '}
          <code>C:\Users\you\code\project</code>.
        </p>
      </form>

      {pathError !== null ? (
        <InlineError title="Invalid folder path" message={pathError} />
      ) : null}

      <div className="browser-nav" role="group" aria-label="Folder navigation">
        <button
          type="button"
          className="button button--secondary"
          onClick={() => {
            if (state.status === 'ready' && state.listing.parent !== null) {
              navigateTo(state.listing.parent);
            }
          }}
          disabled={state.status !== 'ready' || state.listing.parent === null}
        >
          Up
        </button>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => navigateTo(FOLDER_BROWSER_HOME)}
        >
          Home
        </button>
      </div>

      {state.status === 'loading' ? (
        <p className="state-note">
          <span aria-hidden="true">◌</span> Loading folders…
        </p>
      ) : null}

      {state.status === 'error' ? (
        <InlineError
          title="Folder could not be loaded"
          message={state.error.message}
          code={state.error.code}
          httpStatus={state.error.status}
          onRetry={() => void load(state.requestedPath)}
        />
      ) : null}

      {state.status === 'ready' ? (
        <>
          <p className="browser-current">
            Current folder:{' '}
            <code data-testid="current-folder">{state.listing.path}</code>
          </p>

          {state.listing.entries.length === 0 ? (
            <p className="empty-state">
              This folder is empty. Choose another folder or create a project here.
            </p>
          ) : (
            <ul className="browser-list" aria-label="Folder contents">
              {state.listing.entries.map((entry) => (
                <li className="browser-entry" key={entry.path}>
                  <span className="browser-entry__icon" aria-hidden="true">
                    {entry.isDirectory ? '▸' : '·'}
                  </span>
                  {entry.isDirectory ? (
                    <button
                      type="button"
                      className="link-button browser-entry__name"
                      onClick={() => navigateTo(entry.path)}
                      aria-label={`Open folder ${entry.name}`}
                    >
                      {entry.name}
                    </button>
                  ) : (
                    <span className="browser-entry__name browser-entry__name--file">
                      {entry.name}
                    </span>
                  )}
                  <span className="browser-entry__badges">
                    <span className="badge">{entry.isDirectory ? 'folder' : 'file'}</span>
                    {entry.isGitRepo ? <span className="badge badge--git">git repo</span> : null}
                    {entry.hasLoom ? <span className="badge badge--loom">.loom</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {state.listing.truncated ? (
            <p className="state-note state-note--warning">
              <span aria-hidden="true">!</span> This folder has more entries than Skill Loom shows
              at once. Narrow the path to see the rest.
            </p>
          ) : null}

          <div className="browser-actions">
            <button
              type="button"
              className="button"
              onClick={() => void openCurrent()}
              disabled={opening}
              aria-busy={opening}
            >
              {opening ? 'Opening…' : 'Open this folder'}
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => onNewProject(currentPath)}
            >
              New project
            </button>
          </div>
        </>
      ) : null}

      {openError !== null ? (
        <InlineError
          title="Project could not be opened"
          message={openError.message}
          code={openError.code}
          httpStatus={openError.status}
          onRetry={() => void openCurrent()}
          retryLabel="Retry open"
        />
      ) : null}
    </section>
  );
}
