import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbortError, type ApiClientError } from '../api/client';
import {
  chainsApi,
  toApiClientError,
  type Chain,
  type ChainHarness,
  type ChainSessionMode,
  type ChainStoreWarning,
  type ChainsApi,
} from '../api/chains';
import { useStatusAnnouncer } from '../components/StatusRegion';

/** Human labels used by the library cards and the New Chain dialog. */
export const CHAIN_HARNESS_LABELS: Record<ChainHarness, string> = {
  opencode: 'OpenCode',
  copilot: 'Copilot',
};

export const CHAIN_SESSION_MODE_LABELS: Record<ChainSessionMode, string> = {
  shared: 'Shared session',
  fresh: 'Fresh session per step',
  fork: 'Forked session',
};

export interface ChainsViewState {
  status: 'loading' | 'ready' | 'error';
  chains: Chain[];
  warnings: ChainStoreWarning[];
  error: ApiClientError | null;
  /** True when an existing list is being reloaded without a blank screen. */
  refreshing: boolean;
}

export interface UseChainsOptions {
  projectId: string;
  api?: ChainsApi;
}

export interface UseChainsResult {
  state: ChainsViewState;
  reload: () => Promise<void>;
}

const EMPTY_STATE: ChainsViewState = {
  status: 'loading',
  chains: [],
  warnings: [],
  error: null,
  refreshing: false,
};

/**
 * Load one project's chain library.
 *
 * A superseded request may never publish, an unmount aborts the in-flight
 * request, and a failed refresh keeps the previous valid list visible while it
 * shows the server's own error. Corrupt-file warnings are retained alongside
 * valid chains instead of replacing them.
 */
export function useChains({
  projectId,
  api = chainsApi,
}: UseChainsOptions): UseChainsResult {
  const [state, setState] = useState<ChainsViewState>(EMPTY_STATE);
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
      const result = await api.listChains(projectId, {
        signal: controller.signal,
      });
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

      const warningSuffix =
        result.warnings.length === 0
          ? ''
          : ` ${String(result.warnings.length)} chain file warning${
              result.warnings.length === 1 ? '' : 's'
            } reported.`;
      announce(
        `Chain library loaded: ${String(result.chains.length)} chain${
          result.chains.length === 1 ? '' : 's'
        }.${warningSuffix}`,
      );
    } catch (error) {
      if (generation.current !== current || isAbortError(error)) {
        return;
      }
      const apiError = toApiClientError(
        error,
        'An unexpected error prevented loading the chain library.',
      );
      setState((previous) => ({
        status: 'error',
        chains: previous.chains,
        warnings: previous.warnings,
        error: apiError,
        refreshing: false,
      }));
      announce(`Chain library could not be loaded: ${apiError.message}`);
    }
  }, [announce, api, projectId]);

  useEffect(() => {
    void reload();
    return () => {
      generation.current += 1;
      abortRef.current?.abort();
    };
  }, [reload]);

  return { state, reload };
}
