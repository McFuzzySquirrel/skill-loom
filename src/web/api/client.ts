import {
  isApiErrorEnvelope,
  type HealthResponse,
} from '../../shared/api';

/** Browser `fetch` signature, narrowed so tests can inject a fake transport. */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ApiClientErrorOptions {
  code: string;
  status: number;
  details?: unknown;
}

/**
 * A failed API request. `message` is always safe to render: it is either the
 * server's own envelope message or a local description of the transport
 * failure. Raw response bodies are never surfaced.
 */
export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, options: ApiClientErrorOptions) {
    super(message);
    this.name = 'ApiClientError';
    this.code = options.code;
    this.status = options.status;
    this.details = options.details;
  }
}

export interface RequestJsonOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  headers?: HeadersInit;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * True for a caller-initiated abort. Hooks use this to ignore a request that
 * was superseded by unmount or a retry instead of rendering an error.
 */
export function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  return (error as { name?: unknown }).name === 'AbortError';
}

/**
 * Perform one JSON request and decode the shared error envelope.
 *
 * - `2xx` with JSON resolves with the decoded value.
 * - Any failure envelope throws `ApiClientError` with `error.code` and message.
 * - Non-envelope failures throw a local error that still names the HTTP status.
 */
export async function requestJson<T>(
  path: string,
  options: RequestJsonOptions = {},
  fetchImpl: FetchLike = fetch,
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');

  let body: string | undefined;
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.body);
  }

  const init: RequestInit = { method: options.method ?? 'GET', headers };
  if (body !== undefined) {
    init.body = body;
  }
  if (options.signal !== undefined) {
    init.signal = options.signal;
  }

  let response: Response;
  try {
    response = await fetchImpl(path, init);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw new ApiClientError(
      'Could not reach the Skill Loom server. Check that it is running, then retry.',
      { code: 'NETWORK_ERROR', status: 0 },
    );
  }

  const text = await response.text();
  const payload = text.trim() === '' ? undefined : parseJson(text);

  if (!response.ok) {
    if (isApiErrorEnvelope(payload)) {
      throw new ApiClientError(payload.error.message, {
        code: payload.error.code,
        status: response.status,
        details: payload.error.details,
      });
    }

    throw new ApiClientError(
      `The Skill Loom server returned HTTP ${response.status} without a readable error message.`,
      { code: 'UNEXPECTED_RESPONSE', status: response.status },
    );
  }

  if (payload === undefined) {
    throw new ApiClientError('The Skill Loom server returned an empty or invalid JSON response.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
    });
  }

  return payload as T;
}

function decodeHealthResponse(value: unknown): HealthResponse {
  if (
    !isRecord(value) ||
    value.status !== 'ok' ||
    typeof value.version !== 'string' ||
    typeof value.configDirectory !== 'string' ||
    typeof value.port !== 'number' ||
    !isRecord(value.activeRun) ||
    typeof value.activeRun.active !== 'boolean'
  ) {
    throw new ApiClientError('The Skill Loom server returned an unexpected health response.', {
      code: 'INVALID_RESPONSE',
      status: 200,
    });
  }

  return value as unknown as HealthResponse;
}

export interface HealthRequestOptions {
  signal?: AbortSignal;
}

export interface ApiClient {
  getHealth: (options?: HealthRequestOptions) => Promise<HealthResponse>;
}

export function createApiClient(fetchImpl: FetchLike = fetch): ApiClient {
  return {
    async getHealth(options: HealthRequestOptions = {}): Promise<HealthResponse> {
      const requestOptions: RequestJsonOptions =
        options.signal === undefined ? {} : { signal: options.signal };
      const value = await requestJson<unknown>('/api/health', requestOptions, fetchImpl);
      return decodeHealthResponse(value);
    },
  };
}

/** Same-origin client; Vite proxies /api in development. */
export const apiClient = createApiClient();
