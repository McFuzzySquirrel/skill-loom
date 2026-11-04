import { useCallback, useEffect, useRef, useState } from 'react';
import type { HealthResponse } from '../../shared/api';
import {
  ApiClientError,
  apiClient,
  isAbortError,
  type ApiClient,
} from '../api/client';

export type HealthState =
  | { status: 'loading' }
  | { status: 'ready'; data: HealthResponse }
  | { status: 'error'; error: ApiClientError };

/**
 * Load `GET /api/health` through the typed client.
 *
 * Requests are generation-guarded so a retry or unmount cannot render a stale
 * result. The check is independent of routing, so it never blocks navigation.
 */
export function useHealth(client: ApiClient = apiClient) {
  const [state, setState] = useState<HealthState>({ status: 'loading' });
  const generation = useRef(0);

  const check = useCallback(async () => {
    const current = generation.current + 1;
    generation.current = current;
    setState({ status: 'loading' });

    try {
      const data = await client.getHealth();
      if (generation.current === current) {
        setState({ status: 'ready', data });
      }
    } catch (error) {
      if (generation.current !== current || isAbortError(error)) {
        return;
      }
      const apiError =
        error instanceof ApiClientError
          ? error
          : new ApiClientError('An unexpected error prevented the API request.', {
              code: 'UNKNOWN_ERROR',
              status: 0,
            });
      setState({ status: 'error', error: apiError });
    }
  }, [client]);

  useEffect(() => {
    void check();
    return () => {
      generation.current += 1;
    };
  }, [check]);

  return { state, retry: check };
}
