import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbortError, type ApiClientError } from '../api/client';
import {
  catalogApi,
  toApiClientError,
  type CatalogApi,
  type CatalogHarness,
  type CatalogResponse,
} from '../api/catalog';
import { useStatusAnnouncer } from '../components/StatusRegion';

/** Debounce from the skill-catalog interaction design. */
export const CATALOG_SEARCH_DEBOUNCE_MS = 150;

export const HARNESS_LABELS: Record<CatalogHarness, string> = {
  opencode: 'OpenCode',
  copilot: 'Copilot',
};

export interface CatalogViewState {
  status: 'loading' | 'ready' | 'error';
  data: CatalogResponse | null;
  error: ApiClientError | null;
  /** True when an existing result set is being replaced without a blank screen. */
  refreshing: boolean;
}

export interface UseCatalogOptions {
  projectId: string;
  initialHarness?: CatalogHarness;
  api?: CatalogApi;
  debounceMs?: number;
}

export interface UseCatalogResult {
  harness: CatalogHarness;
  setHarness: (harness: CatalogHarness) => void;
  query: string;
  setQuery: (query: string) => void;
  clearSearch: () => void;
  state: CatalogViewState;
  refresh: () => void;
  harnessLabel: string;
}

/**
 * Fetch, debounce, and refresh one harness catalog.
 *
 * Only the newest request may publish, an unmount or a superseding request
 * aborts the old one, and the search text survives refresh. Routine results
 * are announced politely; the terminal and run failures keep the assertive
 * channel for themselves.
 */
export function useCatalog({
  projectId,
  initialHarness = 'opencode',
  api = catalogApi,
  debounceMs = CATALOG_SEARCH_DEBOUNCE_MS,
}: UseCatalogOptions): UseCatalogResult {
  const [harness, setHarnessState] = useState<CatalogHarness>(initialHarness);
  const [query, setQueryState] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [state, setState] = useState<CatalogViewState>({
    status: 'loading',
    data: null,
    error: null,
    refreshing: false,
  });
  const generation = useRef(0);
  const { announce } = useStatusAnnouncer();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, debounceMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [query, debounceMs]);

  useEffect(() => {
    const current = generation.current + 1;
    generation.current = current;
    const controller = new AbortController();

    setState((previous) => ({
      status: previous.data === null ? 'loading' : 'ready',
      data: previous.data,
      error: null,
      refreshing: previous.data !== null,
    }));

    api
      .getCatalog(projectId, {
        harness,
        query: debouncedQuery,
        signal: controller.signal,
      })
      .then((data) => {
        if (generation.current !== current) {
          return;
        }
        setState({ status: 'ready', data, error: null, refreshing: false });
        const sourceCount = data.groups.length;
        if (data.query === '') {
          announce(
            `${HARNESS_LABELS[data.harness]} catalog loaded: ${String(
              data.total,
            )} skill${data.total === 1 ? '' : 's'} in ${String(sourceCount)} source${
              sourceCount === 1 ? '' : 's'
            }.`,
          );
        } else {
          announce(
            `${String(data.total)} skill${data.total === 1 ? '' : 's'} match "${data.query}" in the ${
              HARNESS_LABELS[data.harness]
            } catalog.`,
          );
        }
      })
      .catch((error: unknown) => {
        if (generation.current !== current || isAbortError(error)) {
          return;
        }
        const apiError = toApiClientError(
          error,
          'An unexpected error prevented loading the skill catalog.',
        );
        setState({ status: 'error', data: null, error: apiError, refreshing: false });
        announce(`Skill catalog could not be loaded: ${apiError.message}`);
      });

    return () => {
      controller.abort();
    };
  }, [announce, api, debouncedQuery, harness, projectId, refreshToken]);

  const setHarness = useCallback((next: CatalogHarness) => {
    setHarnessState(next);
    setState((previous) => ({
      ...previous,
      status: 'loading',
      data: null,
      error: null,
      refreshing: false,
    }));
  }, []);

  const setQuery = useCallback((next: string) => {
    setQueryState(next);
  }, []);

  const clearSearch = useCallback(() => {
    setQueryState('');
  }, []);

  const refresh = useCallback(() => {
    setRefreshToken((current) => current + 1);
  }, []);

  return {
    harness,
    setHarness,
    query,
    setQuery,
    clearSearch,
    state,
    refresh,
    harnessLabel: HARNESS_LABELS[harness],
  };
}

export interface ExtraDirectoriesViewState {
  status: 'loading' | 'ready' | 'error';
  directories: string[];
  error: ApiClientError | null;
}

export interface UseExtraDirectoriesResult {
  state: ExtraDirectoriesViewState;
  reload: () => Promise<void>;
  add: (path: string) => Promise<string[]>;
  remove: (path: string) => Promise<string[]>;
}

/**
 * Read and mutate the global extra skill directories.
 *
 * A mutation publishes the server's returned list, so the dialog never has to
 * guess whether a failed request changed the configuration.
 */
export function useExtraDirectories(api: CatalogApi = catalogApi): UseExtraDirectoriesResult {
  const [state, setState] = useState<ExtraDirectoriesViewState>({
    status: 'loading',
    directories: [],
    error: null,
  });
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const current = generation.current + 1;
    generation.current = current;
    setState((previous) => ({
      status: previous.directories.length === 0 ? 'loading' : 'ready',
      directories: previous.directories,
      error: null,
    }));

    try {
      const result = await api.listExtraDirectories();
      if (generation.current !== current) {
        return;
      }
      setState({
        status: 'ready',
        directories: result.extraSkillDirectories,
        error: null,
      });
    } catch (error) {
      if (generation.current !== current || isAbortError(error)) {
        return;
      }
      setState({
        status: 'error',
        directories: [],
        error: toApiClientError(
          error,
          'An unexpected error prevented loading the extra skill directories.',
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

  const add = useCallback(
    async (path: string): Promise<string[]> => {
      const result = await api.addExtraDirectory(path);
      setState({ status: 'ready', directories: result.extraSkillDirectories, error: null });
      return result.extraSkillDirectories;
    },
    [api],
  );

  const remove = useCallback(
    async (path: string): Promise<string[]> => {
      const result = await api.removeExtraDirectory(path);
      setState({ status: 'ready', directories: result.extraSkillDirectories, error: null });
      return result.extraSkillDirectories;
    },
    [api],
  );

  return { state, reload, add, remove };
}
