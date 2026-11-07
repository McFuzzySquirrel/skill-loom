import { randomUUID } from 'node:crypto';
import { CHAIN_VERSION, parseChain, type Chain } from './model.js';
import {
  CHAIN_ID_PATTERN,
  ChainStoreError,
  createChainStore,
  type ChainListResult,
  type ChainStore,
} from './store.js';

/** Stable service failure codes mapped to HTTP statuses by the route layer. */
export const CHAIN_SERVICE_ERROR_CODES = {
  NAME_EXISTS: 'CHAIN_NAME_EXISTS',
  ID_GENERATION_FAILED: 'CHAIN_ID_GENERATION_FAILED',
} as const;

export type ChainServiceErrorCode =
  (typeof CHAIN_SERVICE_ERROR_CODES)[keyof typeof CHAIN_SERVICE_ERROR_CODES];

/**
 * Typed service failure for conflicts the storage layer cannot detect on its
 * own (names are not filenames). Details carry only the conflicting name.
 */
export class ChainServiceError extends Error {
  readonly code: ChainServiceErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: ChainServiceErrorCode,
    message: string,
    details: Record<string, unknown> = {},
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

/**
 * Editable chain content accepted from a client. Identity and timestamps are
 * never part of this shape: the server owns them.
 */
export interface ChainDraft {
  name: unknown;
  harness: unknown;
  sessionMode: unknown;
  steps: unknown;
  inputs?: unknown;
  automaticPermissionOptIn?: unknown;
  agent?: unknown;
}

export interface CreateChainOptions {
  /** Reject a name already used by another chain in the same project (409). */
  uniqueName?: boolean;
}

export interface UpdateChainOptions {
  /** Reject a name already used by a different chain in the same project (409). */
  uniqueName?: boolean;
}

export interface DuplicateChainOptions {
  /** Optional explicit name for the copy; defaults to "<source> copy". */
  name?: string;
  /** Reject an explicit copy name that already exists (409). */
  uniqueName?: boolean;
}

export interface ImportChainOptions {
  /** Optional explicit name for the imported copy. */
  name?: string;
}

export interface ChainService {
  list(projectPath: string): Promise<ChainListResult>;
  get(projectPath: string, chainId: string): Promise<Chain>;
  create(projectPath: string, draft: ChainDraft, options?: CreateChainOptions): Promise<Chain>;
  update(
    projectPath: string,
    chainId: string,
    draft: ChainDraft,
    options?: UpdateChainOptions,
  ): Promise<Chain>;
  duplicate(
    projectPath: string,
    chainId: string,
    options?: DuplicateChainOptions,
  ): Promise<Chain>;
  /**
   * Copy a validated chain from another source into a project. The imported
   * copy always receives a new id and timestamps; name collisions are resolved
   * with the same deterministic copy naming used by `duplicate`.
   */
  importChain(
    projectPath: string,
    source: Chain,
    options?: ImportChainOptions,
  ): Promise<Chain>;
  remove(projectPath: string, chainId: string): Promise<void>;
}

export type ChainStoreFactory = (projectPath: string) => ChainStore;

export interface ChainServiceOptions {
  /** Store factory seam. Defaults to the filesystem-backed project store. */
  createStore?: ChainStoreFactory;
  /** Clock seam for deterministic timestamps. */
  now?: () => Date;
  /** Id seam for deterministic documents in tests. */
  generateId?: (name: string) => string;
}

const MAX_ID_ATTEMPTS = 8;
const MAX_ID_SLUG_LENGTH = 40;

class ProjectChainService implements ChainService {
  private readonly options: ChainServiceOptions;

  constructor(options: ChainServiceOptions) {
    this.options = options;
  }

  async list(projectPath: string): Promise<ChainListResult> {
    return this.storeFor(projectPath).list();
  }

  async get(projectPath: string, chainId: string): Promise<Chain> {
    return this.storeFor(projectPath).read(chainId);
  }

  async create(
    projectPath: string,
    draft: ChainDraft,
    options: CreateChainOptions = {},
  ): Promise<Chain> {
    const store = this.storeFor(projectPath);
    const timestamp = this.timestamp();

    if (options.uniqueName === true) {
      await this.assertNameAvailable(store, draft.name, undefined);
    }

    // Validate the editable content before touching the filesystem so an
    // invalid payload is a 422 even when the project has no chains directory.
    const candidate = this.buildChain(draft, this.nextId(draft.name), timestamp, timestamp);

    for (let attempt = 1; attempt <= MAX_ID_ATTEMPTS; attempt += 1) {
      try {
        return await store.create(candidate);
      } catch (error) {
        if (!isAlreadyExists(error) || attempt === MAX_ID_ATTEMPTS) {
          throw error;
        }
        candidate.id = this.nextId(typeof draft.name === 'string' ? draft.name : '');
      }
    }

    // Unreachable: the loop either returns or throws.
    throw new ChainServiceError(
      CHAIN_SERVICE_ERROR_CODES.ID_GENERATION_FAILED,
      'A unique chain id could not be generated.',
      { attempts: MAX_ID_ATTEMPTS },
    );
  }

  async update(
    projectPath: string,
    chainId: string,
    draft: ChainDraft,
    options: UpdateChainOptions = {},
  ): Promise<Chain> {
    const store = this.storeFor(projectPath);
    // Reading first keeps 404 semantics authoritative and gives us the stored
    // createdAt, which a client can never change.
    const existing = await store.read(chainId);

    if (options.uniqueName === true) {
      await this.assertNameAvailable(store, draft.name, chainId);
    }

    const chain = this.buildChain(draft, existing.id, existing.createdAt, this.timestamp());
    return store.update(chain);
  }

  async duplicate(
    projectPath: string,
    chainId: string,
    options: DuplicateChainOptions = {},
  ): Promise<Chain> {
    const store = this.storeFor(projectPath);
    const source = await store.read(chainId);
    const name = await this.duplicateName(store, source, options);
    const timestamp = this.timestamp();
    const draft: ChainDraft = {
      name,
      harness: source.harness,
      sessionMode: source.sessionMode,
      steps: source.steps,
      inputs: source.inputs,
      automaticPermissionOptIn: source.automaticPermissionOptIn,
      ...(source.agent === undefined ? {} : { agent: source.agent }),
    };

    const candidate = this.buildChain(draft, this.nextId(name), timestamp, timestamp);

    for (let attempt = 1; attempt <= MAX_ID_ATTEMPTS; attempt += 1) {
      try {
        return await store.create(candidate);
      } catch (error) {
        if (!isAlreadyExists(error) || attempt === MAX_ID_ATTEMPTS) {
          throw error;
        }
        candidate.id = this.nextId(name);
      }
    }

    throw new ChainServiceError(
      CHAIN_SERVICE_ERROR_CODES.ID_GENERATION_FAILED,
      'A unique chain id could not be generated.',
      { attempts: MAX_ID_ATTEMPTS },
    );
  }

  async importChain(
    projectPath: string,
    source: Chain,
    options: ImportChainOptions = {},
  ): Promise<Chain> {
    const store = this.storeFor(projectPath);
    const name = await this.duplicateName(store, source, options);
    const timestamp = this.timestamp();
    const draft: ChainDraft = {
      name,
      harness: source.harness,
      sessionMode: source.sessionMode,
      steps: source.steps,
      inputs: source.inputs,
      automaticPermissionOptIn: source.automaticPermissionOptIn,
      ...(source.agent === undefined ? {} : { agent: source.agent }),
    };

    const candidate = this.buildChain(draft, this.nextId(name), timestamp, timestamp);

    for (let attempt = 1; attempt <= MAX_ID_ATTEMPTS; attempt += 1) {
      try {
        return await store.create(candidate);
      } catch (error) {
        if (!isAlreadyExists(error) || attempt === MAX_ID_ATTEMPTS) {
          throw error;
        }
        candidate.id = this.nextId(name);
      }
    }

    throw new ChainServiceError(
      CHAIN_SERVICE_ERROR_CODES.ID_GENERATION_FAILED,
      'A unique chain id could not be generated.',
      { attempts: MAX_ID_ATTEMPTS },
    );
  }

  async remove(projectPath: string, chainId: string): Promise<void> {
    await this.storeFor(projectPath).delete(chainId);
  }

  private storeFor(projectPath: string): ChainStore {
    const factory =
      this.options.createStore ?? ((path: string) => createChainStore({ projectPath: path }));
    return factory(projectPath);
  }

  private buildChain(
    draft: ChainDraft,
    id: string,
    createdAt: string,
    updatedAt: string,
  ): Chain {
    if (!CHAIN_ID_PATTERN.test(id)) {
      throw new ChainServiceError(
        CHAIN_SERVICE_ERROR_CODES.ID_GENERATION_FAILED,
        'A unique chain id could not be generated.',
        { reason: 'UNSAFE_ID' },
      );
    }

    return parseChain({
      version: CHAIN_VERSION,
      id,
      name: draft.name,
      harness: draft.harness,
      sessionMode: draft.sessionMode,
      steps: draft.steps,
      inputs: draft.inputs ?? [],
      automaticPermissionOptIn: draft.automaticPermissionOptIn ?? false,
      ...(draft.agent === undefined ? {} : { agent: draft.agent }),
      createdAt,
      updatedAt,
    });
  }

  /**
   * Reject a name already used in the same project. Comparison is
   * case-insensitive and whitespace-trimmed so "Alpha" and "alpha " cannot
   * coexist as visually identical entries when uniqueness is requested.
   */
  private async assertNameAvailable(
    store: ChainStore,
    name: unknown,
    ignoreChainId: string | undefined,
  ): Promise<void> {
    const normalized = normalizeName(name);
    if (normalized === '') {
      // Structural validation reports the empty/missing name with a 422.
      return;
    }

    const { chains } = await store.list();
    const conflict = chains.find(
      (chain) =>
        chain.id !== ignoreChainId && normalizeName(chain.name) === normalized,
    );
    if (conflict !== undefined) {
      throw new ChainServiceError(
        CHAIN_SERVICE_ERROR_CODES.NAME_EXISTS,
        'A chain with that name already exists in this project.',
        { name: typeof name === 'string' ? name.trim() : name, chainId: conflict.id },
      );
    }
  }

  /**
   * Default copy names are always unique: "<name> copy", then "<name> copy 2",
   * and so on. An explicit name is honored, and only checked for uniqueness
   * when the caller asked for it.
   */
  private async duplicateName(
    store: ChainStore,
    source: Chain,
    options: DuplicateChainOptions,
  ): Promise<string> {
    if (options.name !== undefined) {
      if (options.uniqueName === true) {
        await this.assertNameAvailable(store, options.name, undefined);
      }
      return options.name;
    }

    const { chains } = await store.list();
    const taken = new Set(chains.map((chain) => normalizeName(chain.name)));
    const base = `${source.name} copy`;
    if (!taken.has(normalizeName(base))) {
      return base;
    }

    for (let copy = 2; copy < 10_000; copy += 1) {
      const candidate = `${base} ${String(copy)}`;
      if (!taken.has(normalizeName(candidate))) {
        return candidate;
      }
    }

    return `${base} ${String(Date.now())}`;
  }

  private nextId(name: unknown): string {
    const generator = this.options.generateId ?? defaultChainId;
    return generator(typeof name === 'string' ? name : '');
  }

  private timestamp(): string {
    return (this.options.now ?? (() => new Date()))().toISOString();
  }
}

/** Create the project-scoped chain service consumed by the HTTP routes. */
export function createChainService(options: ChainServiceOptions = {}): ChainService {
  return new ProjectChainService(options);
}

/**
 * Readable, path-safe id: a bounded slug of the name plus a random hex suffix.
 * The shape matches `CHAIN_ID_PATTERN` so no generated id can traverse.
 */
export function defaultChainId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ID_SLUG_LENGTH)
    .replace(/-+$/g, '');
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  return `${slug === '' ? 'chain' : slug}-${suffix}`;
}

function normalizeName(name: unknown): string {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof ChainStoreError && error.code === 'CHAIN_ALREADY_EXISTS';
}
