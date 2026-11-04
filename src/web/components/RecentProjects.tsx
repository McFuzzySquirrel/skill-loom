import { useEffect, useRef, useState } from 'react';
import type { ApiClientError } from '../api/client';
import type { RecentProject } from '../api/projects';
import type { RecentProjectsState } from '../hooks/useRecentProjects';
import { InlineError } from './InlineError';

export interface RecentProjectsProps {
  state: RecentProjectsState;
  onRetry: () => void;
  onOpen: (project: RecentProject) => void;
  onRemove: (project: RecentProject) => Promise<void>;
  openingId: string | null;
  removingId: string | null;
  openError: ApiClientError | null;
  removeError: ApiClientError | null;
}

function formatLastOpened(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/**
 * Recent projects with explicit, consequence-stating removal.
 *
 * Removing an entry only forgets the path; the confirmation says files are not
 * deleted. A failed open shows its own inline error above the list without
 * clearing the other entries, so a broken path never disables the workspace.
 */
export function RecentProjects({
  state,
  onRetry,
  onOpen,
  onRemove,
  openingId,
  removingId,
  openError,
  removeError,
}: RecentProjectsProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocusId = useRef<string | null>(null);
  const focusHeading = useRef(false);

  useEffect(() => {
    if (confirmingId !== null) {
      confirmButton.current?.focus();
      return;
    }
    if (focusHeading.current) {
      focusHeading.current = false;
      heading.current?.focus();
      return;
    }
    const id = restoreFocusId.current;
    if (id !== null) {
      restoreFocusId.current = null;
      removeButtons.current.get(id)?.focus();
    }
  }, [confirmingId]);

  const cancelRemoval = () => {
    restoreFocusId.current = confirmingId;
    setConfirmingId(null);
  };

  return (
    <section className="panel project-recent" aria-labelledby="recent-projects-title">
      <h2 className="section-title" id="recent-projects-title" ref={heading} tabIndex={-1}>
        Recent projects
      </h2>

      {state.status === 'loading' ? (
        <p className="state-note">
          <span aria-hidden="true">◌</span> Loading recent projects…
        </p>
      ) : null}

      {state.status === 'error' ? (
        <InlineError
          title="Recent projects could not be loaded"
          message={state.error.message}
          code={state.error.code}
          httpStatus={state.error.status}
          onRetry={onRetry}
        />
      ) : null}

      {openError !== null ? (
        <InlineError
          title="Recent project could not be opened"
          message={openError.message}
          code={openError.code}
          httpStatus={openError.status}
        />
      ) : null}

      {removeError !== null ? (
        <InlineError
          title="Recent project could not be removed"
          message={removeError.message}
          code={removeError.code}
          httpStatus={removeError.status}
        />
      ) : null}

      {state.status === 'ready' && state.projects.length === 0 ? (
        <div className="empty-state">
          <p>No recent projects yet.</p>
          <p>
            Open a folder in the browser, or create a project. Recent entries appear here
            and can be removed without deleting any files.
          </p>
        </div>
      ) : null}

      {state.status === 'ready' && state.projects.length > 0 ? (
        <ul className="recent-list">
          {state.projects.map((project) => {
            const isConfirming = confirmingId === project.id;
            const isOpening = openingId === project.id;
            const isRemoving = removingId === project.id;

            return (
              <li
                className="recent-project"
                key={project.id}
                data-testid="recent-project"
                data-project-id={project.id}
              >
                <div className="recent-project__identity">
                  <button
                    type="button"
                    className="link-button recent-project__name"
                    onClick={() => onOpen(project)}
                    disabled={isOpening}
                    aria-label={`Open ${project.displayName}`}
                  >
                    {project.displayName}
                  </button>
                  <p className="recent-project__path">
                    <code>{project.canonicalPath}</code>
                  </p>
                  <p className="recent-project__time">
                    Last opened:{' '}
                    <time dateTime={project.lastOpenedAt}>
                      {formatLastOpened(project.lastOpenedAt)}
                    </time>
                    {isOpening ? <span className="state-note"> · Opening…</span> : null}
                  </p>
                </div>

                <button
                  type="button"
                  className="button button--secondary button--small"
                  ref={(node) => {
                    if (node === null) {
                      removeButtons.current.delete(project.id);
                    } else {
                      removeButtons.current.set(project.id, node);
                    }
                  }}
                  onClick={() => setConfirmingId(project.id)}
                  aria-label={`Remove ${project.displayName}`}
                  disabled={isRemoving}
                >
                  {isRemoving ? 'Removing…' : 'Remove'}
                </button>

                {isConfirming ? (
                  <div
                    className="confirm-panel"
                    role="group"
                    aria-label={`Confirm removal of ${project.displayName}`}
                  >
                    <p>
                      Remove <strong>{project.displayName}</strong> from recent projects?
                      Its folder and files are <strong>not deleted</strong>.
                    </p>
                    <div className="panel__actions">
                      <button
                        type="button"
                        className="button button--danger"
                        ref={confirmButton}
                        onClick={() => {
                          void onRemove(project).then(() => {
                            focusHeading.current = true;
                            setConfirmingId(null);
                          });
                        }}
                      >
                        Confirm remove
                      </button>
                      <button
                        type="button"
                        className="button button--secondary"
                        onClick={cancelRemoval}
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
