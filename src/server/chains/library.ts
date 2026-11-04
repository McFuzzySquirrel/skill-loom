import { CHAIN_VERSION, parseChain, type Chain } from './model.js';
import {
  CHAIN_SERVICE_ERROR_CODES,
  ChainServiceError,
  defaultChainId,
  type ChainDraft,
} from './service.js';
import {
  CHAIN_ID_PATTERN,
  ChainStoreError,
  createChainStore,
  globalChainsDirectoryFor,
  type ChainListResult,
  type ChainStore,
  type ChainFileWriter,
} from './store.js';

/**
 * Global chain template library.
 *
 * Templates are snapshots stored outside any project, under the Skill Loom config
 * directory. Importing one copies it into a project with a new id; there is no
 * live link back to the template. The store reuses the same schema, safe-id
 * rules, atomic writes, and corrupt-file warnings as project chains.
 */

export interface GlobalChainServiceOptions {
  /** Skill Loom config directory that owns `chains/`. */
  configDirectory: string;
  /** Store factory seam for tests. Defaults to a directory-backed store. */
  createStore?: (directory: string) => ChainStore;
  /** Clock seam for deterministic timestamps. */
  now?: () => Date;
  /** Id seam for deterministic documents in tests. */
  generateId?: (name: string) => string;
  /** Write seam for failure simulation. */
  atomicWrite?: ChainFileWriter;
}

export interface SaveGlobalChainOptions {
  /** Optional display name for the template. Defaults to the source name. */
  name?: string;
}

export interface GlobalChainService {
  list(): Promise<ChainListResult>;
  read(chainId: string): Promise<Chain>;
  /** Save a validated chain as a new global template snapshot. */
  save(source: Chain, options?: SaveGlobalChainOptions): Promise<Chain>;
  remove(chainId: string): Promise<void>;
}

const MAX_ID_ATTEMPTS = 8;

class FileGlobalChainService implements GlobalChainService {
  private readonly options: GlobalChainServiceOptions;
  private storePromise: ChainStore | null = null;

  constructor(options: GlobalChainServiceOptions) {
    this.options = options;
  }

  async list(): Promise<ChainListResult> {
    return this.store().list();
  }

  async read(chainId: string): Promise<Chain> {
    return this.store().read(chainId);
  }

  async save(source: Chain, options: SaveGlobalChainOptions = {}): Promise<Chain> {
    const store = this.store();
    const name = await this.uniqueName(
      store,
      typeof options.name === 'string' && options.name.trim() !== ''
        ? options.name
        : source.name,
    );
    const timestamp = this.timestamp();
    const draft: ChainDraft = {
      name,
      harness: source.harness,
      sessionMode: source.sessionMode,
      steps: source.steps,
      inputs: source.inputs,
      automaticPermissionOptIn: source.automaticPermissionOptIn,
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
      'A unique global chain id could not be generated.',
      { attempts: MAX_ID_ATTEMPTS },
    );
  }

  async remove(chainId: string): Promise<void> {
    await this.store().delete(chainId);
  }

  private store(): ChainStore {
    if (this.storePromise !== null) {
      return this.storePromise;
    }
    const directory = globalChainsDirectoryFor(this.options.configDirectory);
    this.storePromise =
      this.options.createStore?.(directory) ??
      createChainStore({
        chainsDirectory: directory,
        ...(this.options.atomicWrite === undefined
          ? {}
          : { atomicWrite: this.options.atomicWrite }),
      });
    return this.storePromise;
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
        'A unique global chain id could not be generated.',
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
      createdAt,
      updatedAt,
    });
  }

  /**
   * Global names are display labels, not ids. Auto-suffix a collision so two
   * templates from different projects never look identical in the library.
   */
  private async uniqueName(store: ChainStore, preferred: string): Promise<string> {
    const { chains } = await store.list();
    const taken = new Set(chains.map((chain) => chain.name.trim().toLowerCase()));
    const base = preferred.trim();
    if (!taken.has(base.toLowerCase())) {
      return base;
    }
    for (let copy = 2; copy < 10_000; copy += 1) {
      const candidate = `${base} ${String(copy)}`;
      if (!taken.has(candidate.toLowerCase())) {
        return candidate;
      }
    }
    return `${base} ${String(Date.now())}`;
  }

  private nextId(name: string): string {
    return (this.options.generateId ?? defaultChainId)(name);
  }

  private timestamp(): string {
    return (this.options.now ?? (() => new Date()))().toISOString();
  }
}

export function createGlobalChainService(
  options: GlobalChainServiceOptions,
): GlobalChainService {
  return new FileGlobalChainService(options);
}

function isAlreadyExists(error: unknown): error is ChainStoreError {
  return error instanceof ChainStoreError && error.code === 'CHAIN_ALREADY_EXISTS';
}
