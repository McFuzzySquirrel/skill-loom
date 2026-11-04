import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbortError, type ApiClientError } from '../api/client';
import {
  projectsApi,
  toApiClientError,
  type ProjectsApi,
  type RecentProject,
} from '../api/projects';

export type RecentProjectsState =
  | { status: 'loading' }
  | { status: 'ready'; projects: RecentProject[] }
  | { status: 'error'; error: ApiClientError };

/**
 * Load the newest-first recent-project list.
 *
 * The request is generation-guarded so a retry or unmount cannot publish a
 * stale list. A failure leaves the folder browser completely usable; the page
 * renders the error inside the recent-projects column instead of replacing
 * the whole screen with an empty state.
 */
export function useRecentProjects(api: ProjectsApi = projectsApi) {
  const [state, setState] = useState<RecentProjectsState>({ status: 'loading' });
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const current = generation.current + 1;
    generation.current = current;
    setState({ status: 'loading' });

    try {
      const projects = await api.listRecent();
      if (generation.current === current) {
        setState({ status: 'ready', projects });
      }
    } catch (error) {
      if (generation.current !== current || isAbortError(error)) {
        return;
      }
      setState({
        status: 'error',
        error: toApiClientError(
          error,
          'An unexpected error prevented loading recent projects.',
        ),
      });
    }
  }, [api]);

  useEffect(() => {
    void reload();
    return () => {
      generation.current += 1;
    };
  }, [reload]);

  return { state, reload };
}
