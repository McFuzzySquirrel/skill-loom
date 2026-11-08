import { useEffect, useState } from 'react';
import { discoveryWorkspaceApi, type DiscoveryWorkspace } from '../api/discovery';
import { toApiClientError } from '../api/projects';
import { InlineError } from '../components/InlineError';
import { RunStartPage } from './RunStartPage';
import { Link } from '../router';

export function DiscoveryWorkspaceStartPage({ workspaceId }: { workspaceId: string }) {
  const [workspace, setWorkspace] = useState<DiscoveryWorkspace | null>(null);
  const [error, setError] = useState<{ message: string; code: string; status: number } | null>(null);

  useEffect(() => {
    let active = true;
    void discoveryWorkspaceApi.list().then((workspaces) => {
      if (!active) return;
      const found = workspaces.find((candidate) => candidate.id === workspaceId);
      if (found === undefined) {
        setError({
          message: 'The retained discovery workspace is no longer available.',
          code: 'DISCOVERY_WORKSPACE_NOT_FOUND',
          status: 404,
        });
        return;
      }
      setWorkspace(found);
    }).catch((reason: unknown) => {
      if (!active) return;
      const apiError = toApiClientError(reason, 'The discovery workspace could not be loaded.');
      setError({ message: apiError.message, code: apiError.code, status: apiError.status });
    });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  if (error !== null) {
    return (
      <section className="panel" aria-labelledby="discovery-run-error-title">
        <h1 className="panel__title" id="discovery-run-error-title">Discovery workspace unavailable</h1>
        <InlineError
          title="Workspace could not be loaded"
          message={error.message}
          code={error.code}
          httpStatus={error.status}
        />
        <Link className="button button--secondary" to="/discovery">Back to discovery</Link>
      </section>
    );
  }
  if (workspace === null) {
    return (
      <section className="panel" aria-labelledby="discovery-run-loading-title">
        <h1 className="panel__title" id="discovery-run-loading-title">Loading discovery workspace</h1>
        <p className="state-note" role="status">Checking retained workspace details…</p>
      </section>
    );
  }
  return (
    <RunStartPage
      projectId={workspace.projectId}
      chainId={workspace.chainId}
      supervisedOnly
    />
  );
}
