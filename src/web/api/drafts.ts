import {
  ApiClientError,
  requestJson,
  type FetchLike,
  type RequestJsonOptions,
} from './client';
import {
  decodeChain,
  decodeRevision,
  revisionHeader,
  type Chain,
  type ChainDraft,
  type ChainListResult,
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
  return { ...decodeChain(value.chain), revision: decodeRevision(value.revision) };
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
      if (!isRecord(value) || !Array.isArray(value.chains) || !Array.isArray(value.warnings) || !isRecord(value.revisions)) {
        throw invalidResponse('global drafts');
      }
      const revisions = value.revisions;
      return {
        chains: value.chains.map((entry) => {
          const chain = decodeChain(entry);
          return { ...chain, revision: decodeRevision(revisions[chain.id]) };
        }),
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
          headers: revisionHeader(options.expectedRevision),
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      return decodeChainResponse(value, 'updated chain draft');
    },
  };
}

/** Pseudo project id the editor uses for project-independent drafts. */
export const DRAFT_CATALOG_ID = '__global_drafts__';

export const globalDraftChainsApi = createGlobalDraftChainsApi();
