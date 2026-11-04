import { useEffect, useState } from 'react';
import { runsApi, type ActiveRunState, type RunsApi } from '../api/runs';
import { Link } from '../router';

export interface ActiveRunBannerProps {
  projectId: string;
  api?: RunsApi;
}

const STATUS_LABELS: Record<string, string> = {
  starting: 'Starting',
  running: 'Running',
  'awaiting-user': 'Awaiting user',
  paused: 'Paused',
  failed: 'Failed',
  completed: 'Completed',
  aborted: 'Aborted',
  interrupted: 'Interrupted',
};

/**
 * Read-only pointer to the one active run, when it belongs to this project.
 *
 * This never starts, advances, or retries anything. It only makes the live run
 * view reachable after the user leaves the run screen.
 */
export function ActiveRunBanner({ projectId, api = runsApi }: ActiveRunBannerProps) {
  const [active, setActive] = useState<ActiveRunState | null>(null);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    api
      .getActiveRun({ signal: controller.signal })
      .then((state) => {
        if (!disposed) {
          setActive(state.active ? state : null);
        }
      })
      .catch(() => {
        // The banner is an optional shortcut; a failed read must not break the
        // project workspace.
      });
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [api]);

  if (active === null || active.run === null || active.run.projectId !== projectId) {
    return null;
  }

  const status = active.status ?? active.run.status;

  return (
    <section
      className="panel active-run-banner"
      aria-labelledby="active-run-title"
      data-testid="active-run-banner"
    >
      <h2 className="section-title" id="active-run-title">
        A run is active
      </h2>
      <p>
        <strong>{active.run.chainSnapshot.name}</strong> ·{' '}
        {STATUS_LABELS[status] ?? status} · Step {active.run.currentStepIndex + 1} of{' '}
        {active.run.steps.length}
      </p>
      <p className="panel__actions">
        <Link className="button" to={`/runs/${encodeURIComponent(active.run.id)}`}>
          Open run view
        </Link>
      </p>
    </section>
  );
}
