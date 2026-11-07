import {
  ApiClientError,
  requestJson,
  type FetchLike,
  type RequestJsonOptions,
} from './client';

export interface TestWorkspace {
  id: string;
  projectId: string;
  sourceProjectId?: string;
  sourceChainId?: string;
  sourceDraftId?: string;
  chainId: string;
  createdAt: string;
  path: string;
}

export interface TestWorkspacesApi {
  create(
    input:
      | { sourceProjectId: string; sourceChainId: string }
      | { sourceDraftId: string },
    options?: { signal?: AbortSignal },
  ): Promise<TestWorkspace>;
  list(options?: { signal?: AbortSignal }): Promise<TestWorkspace[]>;
  remove(id: string, options?: { signal?: AbortSignal }): Promise<{ id: string; removed: true }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function invalidResponse(what: string): ApiClientError {
  return new ApiClientError(
    `The Skill Loom server returned an unexpected ${what} response.`,
    { code: 'INVALID_RESPONSE', status: 200 },
  );
}

function decodeWorkspace(value: unknown): TestWorkspace {
  if (!isRecord(value)) {
    throw invalidResponse('test workspace');
  }
  const projectSource = isNonEmptyString(value.sourceProjectId) &&
    isNonEmptyString(value.sourceChainId);
  const partialProjectSource =
    (value.sourceProjectId !== undefined || value.sourceChainId !== undefined) &&
    !projectSource;
  const draftSource = isNonEmptyString(value.sourceDraftId);
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.projectId) ||
    projectSource === draftSource ||
    partialProjectSource ||
    !isNonEmptyString(value.chainId) ||
    !isNonEmptyString(value.createdAt) ||
    !isNonEmptyString(value.path)
  ) {
    throw invalidResponse('test workspace');
  }
  return {
    id: value.id,
    projectId: value.projectId,
    ...(isNonEmptyString(value.sourceProjectId) ? { sourceProjectId: value.sourceProjectId } : {}),
    ...(isNonEmptyString(value.sourceChainId) ? { sourceChainId: value.sourceChainId } : {}),
    ...(isNonEmptyString(value.sourceDraftId) ? { sourceDraftId: value.sourceDraftId } : {}),
    chainId: value.chainId,
    createdAt: value.createdAt,
    path: value.path,
  };
}

function optionsFor(signal?: AbortSignal): RequestJsonOptions {
  return signal === undefined ? {} : { signal };
}

export function createTestWorkspacesApi(
  fetchImpl: FetchLike = fetch,
): TestWorkspacesApi {
  return {
    async create(input, options = {}) {
      const value = await requestJson<unknown>(
        '/api/test-workspaces',
        {
          method: 'POST',
          body: input,
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      if (!isRecord(value) || value.workspace === undefined) {
        throw invalidResponse('test-workspace creation');
      }
      return decodeWorkspace(value.workspace);
    },

    async list(options = {}) {
      const value = await requestJson<unknown>(
        '/api/test-workspaces',
        optionsFor(options.signal),
        fetchImpl,
      );
      if (!isRecord(value) || !Array.isArray(value.workspaces)) {
        throw invalidResponse('test-workspace list');
      }
      return value.workspaces.map(decodeWorkspace);
    },

    async remove(id, options = {}) {
      const value = await requestJson<unknown>(
        `/api/test-workspaces/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      if (!isRecord(value) || value.id !== id || value.removed !== true) {
        throw invalidResponse('test-workspace removal');
      }
      return { id, removed: true };
    },
  };
}

export const testWorkspacesApi = createTestWorkspacesApi();
