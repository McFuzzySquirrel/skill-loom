import {
  ApiClientError,
  requestJson,
  type FetchLike,
  type RequestJsonOptions,
} from './client';
import {
  decodeChain,
  type Chain,
  type ChainDraft,
  type ChainListResult,
  type ChainRequestOptions,
  type ChainUpdateDraft,
  type ChainsApi,
} from './chains';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResponse(what: string): ApiClientError {
  return new ApiClientError(
    `The Skill Loom server returned an unexpected ${what} response.`,
    { code: 'INVALID_RESPONSE', status: 200 },
  );
}

function optionsFor(signal: AbortSignal | undefined): RequestJsonOptions {
  return signal === undefined ? {} : { signal };
}

function decodeChainResponse(value: unknown, what: string): Chain {
  if (!isRecord(value) || value.chain === undefined) {
    throw invalidResponse(what);
  }
  return decodeChain(value.chain);
}

function chainPath(draftId: string): string {
  return `/api/drafts/${encodeURIComponent(draftId)}`;
}

function draftBody(draft: ChainDraft | ChainUpdateDraft): Record<string, unknown> {
  return {
    name: draft.name,
    harness: draft.harness,
    sessionMode: draft.sessionMode,
    steps: draft.steps,
    inputs: draft.inputs ?? [],
    automaticPermissionOptIn: draft.automaticPermissionOptIn ?? false,
    ...(draft.agent === undefined ? {} : { agent: draft.agent }),
  };
}

export function createGlobalDraftChainsApi(fetchImpl: FetchLike = fetch): ChainsApi {
  return {
    async listChains(_projectId, options = {}): Promise<ChainListResult> {
      const value = await requestJson<unknown>(
        '/api/drafts',
        optionsFor(options.signal),
        fetchImpl,
      );
      if (!isRecord(value) || !Array.isArray(value.chains) || !Array.isArray(value.warnings)) {
        throw invalidResponse('global drafts');
      }
      return {
        chains: value.chains.map(decodeChain),
        warnings: value.warnings as ChainListResult['warnings'],
      };
    },

    async getChain(_projectId, draftId, options = {}): Promise<Chain> {
      const value = await requestJson<unknown>(
        chainPath(draftId),
        optionsFor(options.signal),
        fetchImpl,
      );
      return decodeChainResponse(value, 'chain draft');
    },

    async createChain(_projectId, draft, options = {}): Promise<Chain> {
      const value = await requestJson<unknown>(
        '/api/drafts',
        {
          method: 'POST',
          body: draftBody(draft),
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      return decodeChainResponse(value, 'created chain draft');
    },

    async updateChain(_projectId, draftId, draft: ChainUpdateDraft, options = {}): Promise<Chain> {
      const value = await requestJson<unknown>(
        chainPath(draftId),
        {
          method: 'PUT',
          body: draftBody(draft),
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      return decodeChainResponse(value, 'updated chain draft');
    },

    async duplicateChain(
      _projectId,
      _draftId,
      _options?: ChainRequestOptions,
    ): Promise<Chain> {
      throw new ApiClientError('Global drafts cannot be duplicated through this action.', {
        code: 'DRAFT_ACTION_UNSUPPORTED',
        status: 400,
      });
    },

    async deleteChain(_projectId, draftId, options = {}) {
      const value = await requestJson<unknown>(
        chainPath(draftId),
        {
          method: 'DELETE',
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      if (!isRecord(value) || value.deleted !== true) {
        throw invalidResponse('draft deletion');
      }
      return { chainId: draftId, deleted: true };
    },
  };
}

export const globalDraftChainsApi = createGlobalDraftChainsApi();

export interface GlobalDraftsApi {
  list: (options?: { signal?: AbortSignal }) => Promise<ChainListResult>;
  remove: (draftId: string, options?: { signal?: AbortSignal }) => Promise<void>;
}

export function createGlobalDraftsApi(fetchImpl: FetchLike = fetch): GlobalDraftsApi {
  const chains = createGlobalDraftChainsApi(fetchImpl);
  return {
    list: (options = {}) => chains.listChains('', options),
    async remove(draftId, options = {}) {
      const result = await chains.deleteChain('', draftId, options);
      if (!result.deleted) throw invalidResponse('draft deletion');
    },
  };
}

export const globalDraftsApi = createGlobalDraftsApi();
