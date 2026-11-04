import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbortError, type ApiClientError } from '../api/client';
import {
  projectsApi,
  toApiClientError,
  type DirectoryListing,
  type ProjectsApi,
} from '../api/projects';

export type DirectoryListingState =
  | { status: 'loading'; requestedPath: string }
  | { status: 'ready'; listing: DirectoryListing }
  | { status: 'error'; requestedPath: string; error: ApiClientError };

/**
 * Fetch one directory listing through the typed project API.
 *
 * Navigation is explicit: components call `load(path)`, and only the newest
 * request may publish. An error keeps its requested path so the Retry action
 * repeats exactly the request that failed.
 */
export function useDirectoryListing(initialPath: string, api: ProjectsApi = projectsApi) {
  const [state, setState] = useState<DirectoryListingState>({
    status: 'loading',
    requestedPath: initialPath,
  });
  const generation = useRef(0);

  const load = useCallback(
    async (path: string) => {
      const current = generation.current + 1;
      generation.current = current;
      setState({ status: 'loading', requestedPath: path });

      try {
        const listing = await api.listDirectory(path);
        if (generation.current === current) {
          setState({ status: 'ready', listing });
        }
      } catch (error) {
        if (generation.current !== current || isAbortError(error)) {
          return;
        }
        setState({
          status: 'error',
          requestedPath: path,
          error: toApiClientError(
            error,
            'An unexpected error prevented loading this folder.',
          ),
        });
      }
    },
    [api],
  );

  useEffect(() => {
    void load(initialPath);
    return () => {
      generation.current += 1;
    };
  }, [initialPath, load]);

  return { state, load };
}
