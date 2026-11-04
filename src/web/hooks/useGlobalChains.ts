import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbortError, type ApiClientError } from '../api/client';
import {
  globalChainsApi,
  type GlobalChainsApi,
} from '../api/globalChains';
import { toApiClientError, type Chain, type ChainStoreWarning } from '../api/chains';
import { useStatusAnnouncer } from '../components/StatusRegion';

export interface GlobalChainsViewState {
  status: 'loading' | 'ready' | 'error';
  chains: Chain[];
  warnings: ChainStoreWarning[];
  error: ApiClientError | null;
  refreshing: boolean;
}

export interface UseGlobalChainsOptions {
  api?: GlobalChainsApi;
}

export interface UseGlobalChainsResult {
  state: GlobalChainsViewState;
  reload: () => Promise<void>;
}

const EMPTY_STATE: GlobalChainsViewState = {
  status: 'loading',
  chains: [],
  warnings: [],
  error: null,
  refreshing: false,
};

/** Load the global template library with the same supersession rules as chains. */
export function useGlobalChains({
  api = globalChainsApi,
}: UseGlobalChainsOptions = {}): UseGlobalChainsResult {
  const [state, setState] = useState<GlobalChainsViewState>(EMPTY_STATE);
  const generation = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const { announce } = useStatusAnnouncer();

  const reload = useCallback(async (): Promise<void> => {
    const current = generation.current + 1;
    generation.current = current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((previous) => ({
      status: previous.chains.length === 0 ? 'loading' : 'ready',
      chains: previous.chains,
      warnings: previous.warnings,
      error: null,
      refreshing: previous.chains.length > 0,
    }));

    try {
      const result = await api.list({ signal: controller.signal });
      if (generation.current !== current) {
        return;
      }
      setState({
        status: 'ready',
        chains: result.chains,
        warnings: result.warnings,
        error: null,
        refreshing: false,
      });
      announce(
        `Global chain library loaded: ${String(result.chains.length)} template${
          result.chains.length === 1 ? '' : 's'
        }.`,
      );
    } catch (error) {
      if (generation.current !== current || isAbortError(error)) {
        return;
      }
      const apiError = toApiClientError(
        error,
        'An unexpected error prevented loading the global chain library.',
      );
      setState((previous) => ({
        status: 'error',
        chains: previous.chains,
        warnings: previous.warnings,
        error: apiError,
        refreshing: false,
      }));
      announce(`Global chain library could not be loaded: ${apiError.message}`);
    }
  }, [announce, api]);

  useEffect(() => {
    void reload();
    return () => {
      generation.current += 1;
      abortRef.current?.abort();
    };
  }, [reload]);

  return { state, reload };
}
