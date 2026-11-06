import { ApiClientError, requestJson, type FetchLike } from './client';

export type ServerLifecycleState = 'running' | 'stopping' | 'stopped' | 'failed';

export interface ServerLifecycle {
  state: ServerLifecycleState;
  token: string;
}

function decodeLifecycle(value: unknown): ServerLifecycle {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('state' in value) ||
    !('token' in value) ||
    (value.state !== 'running' &&
      value.state !== 'stopping' &&
      value.state !== 'stopped' &&
      value.state !== 'failed') ||
    typeof value.token !== 'string' ||
    value.token.length < 32
  ) {
    throw new ApiClientError(
      'The Skill Loom server returned an unexpected lifecycle response.',
      { code: 'INVALID_RESPONSE', status: 200 },
    );
  }
  return { state: value.state, token: value.token };
}

export async function getServerLifecycle(fetchImpl: FetchLike = fetch): Promise<ServerLifecycle> {
  const value = await requestJson<unknown>('/api/server/lifecycle', {}, fetchImpl);
  return decodeLifecycle(value);
}

export async function stopServer(
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await requestJson(
    '/api/server/shutdown',
    {
      method: 'POST',
      headers: { 'x-loom-shutdown-token': token },
      body: { confirm: true },
    },
    fetchImpl,
  );
}
