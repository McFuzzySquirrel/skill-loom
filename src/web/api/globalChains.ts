import {
  ApiClientError,
  requestJson,
  type FetchLike,
  type RequestJsonOptions,
} from './client';
import {
  decodeChain,
  type Chain,
  type ChainStoreWarning,
} from './chains';

/**
 * Typed client for the global chain template library.
 *
 * Templates are snapshots. Saving reads a saved project chain on the server;
 * importing copies a template into a project with a new id. The browser never
 * sends a chain file or an arbitrary filesystem path.
 */

export interface GlobalChainListResult {
  chains: Chain[];
  warnings: ChainStoreWarning[];
}

export interface SaveGlobalChainInput {
  projectId: string;
  chainId: string;
  name?: string;
}

export interface GlobalChainsApi {
  list: (options?: { signal?: AbortSignal }) => Promise<GlobalChainListResult>;
  save: (
    input: SaveGlobalChainInput,
    options?: { signal?: AbortSignal },
  ) => Promise<Chain>;
  remove: (chainId: string, options?: { signal?: AbortSignal }) => Promise<void>;
  importIntoProject: (
    projectId: string,
    libraryChainId: string,
    options?: { name?: string; signal?: AbortSignal },
  ) => Promise<Chain>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function invalidResponse(what: string): ApiClientError {
  return new ApiClientError(
    `The Slan server returned an unexpected ${what} response.`,
    { code: 'INVALID_RESPONSE', status: 200 },
  );
}

function decodeWarning(value: unknown): ChainStoreWarning {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.code) ||
    !isNonEmptyString(value.message) ||
    !isNonEmptyString(value.path) ||
    !isNonEmptyString(value.chainId)
  ) {
    throw invalidResponse('global chain warning');
  }

  return {
    code: value.code,
    message: value.message,
    path: value.path,
    chainId: value.chainId,
    ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
    ...(value.version === undefined ? {} : { version: value.version as string | number | boolean | null }),
    ...(Array.isArray(value.issues) ? { issues: value.issues } : {}),
  };
}

function decodeList(value: unknown): GlobalChainListResult {
  if (!isRecord(value) || !Array.isArray(value.chains) || !Array.isArray(value.warnings)) {
    throw invalidResponse('global chain library');
  }
  return {
    chains: value.chains.map(decodeChain),
    warnings: value.warnings.map(decodeWarning),
  };
}

function decodeChainResponse(value: unknown, what: string): Chain {
  if (!isRecord(value) || value.chain === undefined) {
    throw invalidResponse(what);
  }
  return decodeChain(value.chain);
}

function optionsFor(signal: AbortSignal | undefined): RequestJsonOptions {
  return signal === undefined ? {} : { signal };
}

export function createGlobalChainsApi(fetchImpl: FetchLike = fetch): GlobalChainsApi {
  return {
    async list(options = {}): Promise<GlobalChainListResult> {
      const value = await requestJson<unknown>(
        '/api/chains',
        optionsFor(options.signal),
        fetchImpl,
      );
      return decodeList(value);
    },

    async save(input, options = {}): Promise<Chain> {
      const body: Record<string, unknown> = {
        projectId: input.projectId,
        chainId: input.chainId,
      };
      if (input.name !== undefined) {
        body.name = input.name;
      }
      const value = await requestJson<unknown>(
        '/api/chains',
        {
          method: 'POST',
          body,
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      return decodeChainResponse(value, 'saved global chain');
    },

    async remove(chainId, options = {}): Promise<void> {
      const value = await requestJson<unknown>(
        `/api/chains/${encodeURIComponent(chainId)}`,
        {
          method: 'DELETE',
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      if (!isRecord(value) || value.deleted !== true) {
        throw invalidResponse('global chain deletion');
      }
    },

    async importIntoProject(projectId, libraryChainId, options = {}): Promise<Chain> {
      const body: Record<string, unknown> = { libraryChainId };
      if (options.name !== undefined) {
        body.name = options.name;
      }
      const value = await requestJson<unknown>(
        `/api/projects/${encodeURIComponent(projectId)}/chains/import`,
        {
          method: 'POST',
          body,
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      return decodeChainResponse(value, 'imported chain');
    },
  };
}

/** Same-origin client; Vite proxies /api in development. */
export const globalChainsApi = createGlobalChainsApi();
