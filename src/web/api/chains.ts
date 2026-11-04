import {
  ApiClientError,
  requestJson,
  type FetchLike,
  type RequestJsonOptions,
} from './client';

/**
 * Typed client for the project chain library and authoring API.
 *
 * Every chain document is decoded before it reaches a component. The browser
 * never derives a filesystem path, never deletes a chain file directly, and
 * never invents fields the server does not return. Duplicate names and
 * reordered steps stay keyed by the server-generated chain and step ids.
 */

export const CHAIN_HARNESSES = ['opencode', 'copilot'] as const;
export type ChainHarness = (typeof CHAIN_HARNESSES)[number];

export const CHAIN_SESSION_MODES = ['shared', 'fresh', 'fork'] as const;
export type ChainSessionMode = (typeof CHAIN_SESSION_MODES)[number];

/**
 * Reserved route segment for a chain that exists only as an editor draft.
 * It can never collide with a generated chain id, which always carries a
 * random suffix after the name slug.
 */
export const NEW_CHAIN_ID = 'new';

/** One ordered step inside a chain. */
export interface ChainStep {
  /** Stable within the chain; reordering never changes it. */
  id: string;
  skillName: string;
  instruction: string;
  label?: string;
}

/** One declared placeholder input. */
export interface ChainInput {
  name: string;
  label?: string;
  required: boolean;
  defaultValue?: string;
}

/** A saved chain document returned by the server. */
export interface Chain {
  version: number;
  id: string;
  name: string;
  harness: ChainHarness;
  sessionMode: ChainSessionMode;
  steps: ChainStep[];
  inputs: ChainInput[];
  automaticPermissionOptIn: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A non-fatal problem with one chain file. Valid sibling chains are always
 * returned alongside these warnings.
 */
export interface ChainStoreWarning {
  code: string;
  message: string;
  /** Absolute path of the offending file. */
  path: string;
  chainId: string;
  reason?: string;
  version?: string | number | boolean | null;
  issues?: unknown[];
}

export interface ChainListResult {
  chains: Chain[];
  warnings: ChainStoreWarning[];
}

/** Editable chain content; identity and timestamps stay server-owned. */
export interface ChainDraft {
  name: string;
  harness: ChainHarness;
  sessionMode: ChainSessionMode;
  steps: ChainStep[];
  inputs?: ChainInput[];
  automaticPermissionOptIn?: boolean;
}

/**
 * Update payload that can round-trip a chain returned by `GET`. The server
 * still preserves `createdAt`, regenerates `updatedAt`, and rejects a mismatched
 * id, so this is convenience rather than authority.
 */
export interface ChainUpdateDraft extends ChainDraft {
  id?: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ChainRequestOptions {
  signal?: AbortSignal;
  /** Ask the server to reject another chain with the same name (409). */
  uniqueName?: boolean;
}

export interface DuplicateChainOptions extends ChainRequestOptions {
  /** Optional explicit copy name; the server otherwise uses "<name> copy". */
  name?: string;
}

export interface DeleteChainResult {
  chainId: string;
  deleted: true;
}

export interface ChainsApi {
  listChains: (
    projectId: string,
    options?: Pick<ChainRequestOptions, 'signal'>,
  ) => Promise<ChainListResult>;
  getChain: (
    projectId: string,
    chainId: string,
    options?: Pick<ChainRequestOptions, 'signal'>,
  ) => Promise<Chain>;
  createChain: (
    projectId: string,
    draft: ChainDraft,
    options?: ChainRequestOptions,
  ) => Promise<Chain>;
  updateChain: (
    projectId: string,
    chainId: string,
    draft: ChainUpdateDraft,
    options?: ChainRequestOptions,
  ) => Promise<Chain>;
  duplicateChain: (
    projectId: string,
    chainId: string,
    options?: DuplicateChainOptions,
  ) => Promise<Chain>;
  deleteChain: (
    projectId: string,
    chainId: string,
    options?: Pick<ChainRequestOptions, 'signal'>,
  ) => Promise<DeleteChainResult>;
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

function decodeHarness(value: unknown): ChainHarness {
  if (value === 'opencode' || value === 'copilot') {
    return value;
  }
  throw invalidResponse('chain harness');
}

function decodeSessionMode(value: unknown): ChainSessionMode {
  if (value === 'shared' || value === 'fresh' || value === 'fork') {
    return value;
  }
  throw invalidResponse('chain session mode');
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function decodeStep(value: unknown): ChainStep {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.skillName) ||
    typeof value.instruction !== 'string' ||
    value.instruction.trim() === ''
  ) {
    throw invalidResponse('chain step');
  }

  const label = optionalString(value.label);
  return {
    id: value.id,
    skillName: value.skillName,
    instruction: value.instruction,
    ...(label === undefined ? {} : { label }),
  };
}

function decodeInput(value: unknown): ChainInput {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.name) ||
    typeof value.required !== 'boolean'
  ) {
    throw invalidResponse('chain input');
  }

  const label = optionalString(value.label);
  const defaultValue = optionalString(value.defaultValue);
  return {
    name: value.name,
    required: value.required,
    ...(label === undefined ? {} : { label }),
    ...(defaultValue === undefined ? {} : { defaultValue }),
  };
}

function decodeChain(value: unknown): Chain {
  if (
    !isRecord(value) ||
    typeof value.version !== 'number' ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.name) ||
    !Array.isArray(value.steps) ||
    !Array.isArray(value.inputs) ||
    typeof value.automaticPermissionOptIn !== 'boolean' ||
    !isNonEmptyString(value.createdAt) ||
    !isNonEmptyString(value.updatedAt)
  ) {
    throw invalidResponse('chain');
  }

  return {
    version: value.version,
    id: value.id,
    name: value.name,
    harness: decodeHarness(value.harness),
    sessionMode: decodeSessionMode(value.sessionMode),
    steps: value.steps.map(decodeStep),
    inputs: value.inputs.map(decodeInput),
    automaticPermissionOptIn: value.automaticPermissionOptIn,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function decodeWarning(value: unknown): ChainStoreWarning {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.code) ||
    !isNonEmptyString(value.message) ||
    !isNonEmptyString(value.path) ||
    !isNonEmptyString(value.chainId)
  ) {
    throw invalidResponse('chain warning');
  }

  const reason = optionalString(value.reason);
  const version =
    value.version === undefined ||
    value.version === null ||
    typeof value.version === 'string' ||
    typeof value.version === 'number' ||
    typeof value.version === 'boolean'
      ? value.version
      : undefined;
  const issues = Array.isArray(value.issues) ? value.issues : undefined;

  return {
    code: value.code,
    message: value.message,
    path: value.path,
    chainId: value.chainId,
    ...(reason === undefined ? {} : { reason }),
    ...(version === undefined ? {} : { version }),
    ...(issues === undefined ? {} : { issues }),
  };
}

function decodeChainList(value: unknown): ChainListResult {
  if (!isRecord(value) || !Array.isArray(value.chains) || !Array.isArray(value.warnings)) {
    throw invalidResponse('chain library');
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

function chainsPath(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/chains`;
}

function chainPath(projectId: string, chainId: string): string {
  return `${chainsPath(projectId)}/${encodeURIComponent(chainId)}`;
}

function withUniqueName(path: string, uniqueName: boolean | undefined): string {
  return uniqueName === true ? `${path}?uniqueName=true` : path;
}

function toDraftBody(draft: ChainDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: draft.name,
    harness: draft.harness,
    sessionMode: draft.sessionMode,
    steps: draft.steps,
  };
  if (draft.inputs !== undefined) {
    body.inputs = draft.inputs;
  }
  if (draft.automaticPermissionOptIn !== undefined) {
    body.automaticPermissionOptIn = draft.automaticPermissionOptIn;
  }
  return body;
}

function toUpdateBody(draft: ChainUpdateDraft): Record<string, unknown> {
  const body = toDraftBody(draft);
  if (draft.id !== undefined) {
    body.id = draft.id;
  }
  if (draft.version !== undefined) {
    body.version = draft.version;
  }
  if (draft.createdAt !== undefined) {
    body.createdAt = draft.createdAt;
  }
  if (draft.updatedAt !== undefined) {
    body.updatedAt = draft.updatedAt;
  }
  return body;
}

/** Browser route for an existing chain's builder screen. */
export function chainBuilderPath(projectId: string, chainId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/chains/${encodeURIComponent(chainId)}`;
}

export interface NewChainDraftRoute {
  name: string;
  harness: ChainHarness;
  sessionMode: ChainSessionMode;
}

/**
 * Browser route that opens the builder on an unsaved draft. The builder owns
 * persistence so an abandoned New Chain dialog never leaves an empty document
 * in the project's `.slan/chains` directory.
 */
export function newChainBuilderPath(
  projectId: string,
  draft: NewChainDraftRoute,
): string {
  const search = new URLSearchParams({
    name: draft.name,
    harness: draft.harness,
    sessionMode: draft.sessionMode,
  });
  return `${chainBuilderPath(projectId, NEW_CHAIN_ID)}?${search.toString()}`;
}

export function createChainsApi(fetchImpl: FetchLike = fetch): ChainsApi {
  return {
    async listChains(projectId, options = {}): Promise<ChainListResult> {
      const value = await requestJson<unknown>(
        chainsPath(projectId),
        optionsFor(options.signal),
        fetchImpl,
      );
      return decodeChainList(value);
    },

    async getChain(projectId, chainId, options = {}): Promise<Chain> {
      const value = await requestJson<unknown>(
        chainPath(projectId, chainId),
        optionsFor(options.signal),
        fetchImpl,
      );
      return decodeChainResponse(value, 'chain');
    },

    async createChain(projectId, draft, options = {}): Promise<Chain> {
      const value = await requestJson<unknown>(
        withUniqueName(chainsPath(projectId), options.uniqueName),
        {
          method: 'POST',
          body: toDraftBody(draft),
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      return decodeChainResponse(value, 'created chain');
    },

    async updateChain(projectId, chainId, draft, options = {}): Promise<Chain> {
      const value = await requestJson<unknown>(
        withUniqueName(chainPath(projectId, chainId), options.uniqueName),
        {
          method: 'PUT',
          body: toUpdateBody(draft),
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      return decodeChainResponse(value, 'updated chain');
    },

    async duplicateChain(projectId, chainId, options = {}): Promise<Chain> {
      const body: Record<string, unknown> = {};
      if (options.name !== undefined) {
        body.name = options.name;
      }
      const value = await requestJson<unknown>(
        withUniqueName(`${chainPath(projectId, chainId)}/duplicate`, options.uniqueName),
        {
          method: 'POST',
          body,
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      return decodeChainResponse(value, 'duplicated chain');
    },

    async deleteChain(projectId, chainId, options = {}): Promise<DeleteChainResult> {
      const value = await requestJson<unknown>(
        chainPath(projectId, chainId),
        {
          method: 'DELETE',
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      if (
        !isRecord(value) ||
        !isNonEmptyString(value.chainId) ||
        value.deleted !== true
      ) {
        throw invalidResponse('chain deletion');
      }
      return { chainId: value.chainId, deleted: true };
    },
  };
}

/** Convert an unknown thrown value into the typed client error. */
export { toApiClientError } from './projects';

/** Same-origin client; Vite proxies /api in development. */
export const chainsApi = createChainsApi();
