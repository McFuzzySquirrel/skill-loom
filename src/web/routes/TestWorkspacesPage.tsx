import { useCallback, useEffect, useState } from 'react';
import { InlineError } from '../components/InlineError';
import { useStatusAnnouncer } from '../components/StatusRegion';
import { Link } from '../router';
import {
  testWorkspacesApi,
  type TestWorkspace,
  type TestWorkspacesApi,
} from '../api/testWorkspaces';
import { toApiClientError } from '../api/projects';
import type { ApiClientError } from '../api/client';

export interface TestWorkspacesPageProps {
  api?: TestWorkspacesApi;
}

export function TestWorkspacesPage({
  api = testWorkspacesApi,
}: TestWorkspacesPageProps) {
  const { announce } = useStatusAnnouncer();
  const [workspaces, setWorkspaces] = useState<TestWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setWorkspaces(await api.list());
    } catch (reason) {
      const apiError = toApiClientError(reason, 'Test workspaces could not be loaded.');
      setError(apiError);
      announce(`Test workspaces could not be loaded: ${apiError.message}`, 'assertive');
    } finally {
      setLoading(false);
    }
  }, [announce, api]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = useCallback(async (workspace: TestWorkspace) => {
    setBusyId(workspace.id);
    setError(null);
    try {
      await api.remove(workspace.id);
      setWorkspaces((current) => current.filter((entry) => entry.id !== workspace.id));
      setPendingDeleteId(null);
      announce(
        `Removed the disposable test workspace for ${workspace.sourceDraftId === undefined
          ? `chain ${workspace.sourceChainId ?? 'unknown'}`
          : `draft ${workspace.sourceDraftId}`}.`,
      );
    } catch (reason) {
      const apiError = toApiClientError(reason, 'The test workspace could not be removed.');
      setError(apiError);
      announce(`Test workspace could not be removed: ${apiError.message}`, 'assertive');
    } finally {
      setBusyId(null);
    }
  }, [announce, api]);

  return (
    <section className="panel" aria-labelledby="test-workspaces-title" data-testid="test-workspaces-page">
      <header className="panel__header">
        <div>
          <h1 className="panel__title" id="test-workspaces-title">Disposable test workspaces</h1>
          <p className="lede">
            Test runs use separate managed project directories. They are retained for inspection
            until you remove them; a separate working directory is not an operating-system
            security sandbox.
          </p>
        </div>
        <Link className="button button--secondary" to="/chains">Chain library</Link>
      </header>

      {error !== null ? (
        <InlineError
          title="Test workspace action failed"
          message={error.message}
          code={error.code}
          httpStatus={error.status}
          onRetry={() => void load()}
          retryLabel="Retry"
        />
      ) : null}

      {loading ? <p className="state-note" role="status">Loading test workspaces…</p> : null}
      {!loading && workspaces.length === 0 && error === null ? (
        <p className="state-note" data-testid="test-workspaces-empty">
          No retained test workspaces. Start a test from a saved chain to create one.
        </p>
      ) : null}

      {workspaces.length > 0 ? (
        <ul className="project-list" aria-label="Retained test workspaces">
          {workspaces.map((workspace) => (
            <li className="project-list__item" key={workspace.id}>
              <div>
                <h2 className="section-title">Test workspace</h2>
                <p className="field__hint">
                  Created {new Date(workspace.createdAt).toLocaleString()}
                </p>
                <p><code>{workspace.path}</code></p>
                <p className="field__hint">
                  From {workspace.sourceDraftId === undefined ? 'chain' : 'draft'}{' '}
                  <code>{workspace.sourceDraftId ?? workspace.sourceChainId ?? 'unknown'}</code>
                </p>
              </div>
              <div className="panel__actions">
                <Link
                  className="button button--secondary"
                  to={`/projects/${encodeURIComponent(workspace.projectId)}`}
                >
                  Inspect test project
                </Link>
                <button
                  type="button"
                  className="button button--danger"
                  onClick={() =>
                    setPendingDeleteId((current) =>
                      current === workspace.id ? null : workspace.id,
                    )
                  }
                  aria-expanded={pendingDeleteId === workspace.id}
                  disabled={busyId === workspace.id}
                >
                  Remove test workspace
                </button>
                {pendingDeleteId === workspace.id ? (
                  <div className="confirm-panel" role="group" aria-label="Confirm workspace removal">
                    <p>
                      Remove this test project and its run history? The original project and
                      reusable chain are not affected. First stop all work, descendants, and
                      older Skill Loom services and helpers using this workspace.
                    </p>
                    <button
                      type="button"
                      className="button button--danger button--small"
                      onClick={() => void remove(workspace)}
                      disabled={busyId === workspace.id}
                    >
                      {busyId === workspace.id ? 'Removing…' : 'Remove workspace'}
                    </button>
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      onClick={() => setPendingDeleteId(null)}
                      disabled={busyId === workspace.id}
                    >
                      Keep workspace
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
