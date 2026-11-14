import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { atomicWriteJson, type AtomicWriteDependencies } from '../config/store.js';
import type { Chain } from '../chains/model.js';
import {
  chainRevision,
  createChainService,
  type ChainService,
  type ChainServiceOptions,
} from '../chains/service.js';
import {
  ChainStoreError,
  createChainStore,
  isSafeChainId,
  type ChainFileWriter,
  type ChainListResult,
} from '../chains/store.js';

export const REPO_CHAIN_DIRECTORY_NAME = 'chains';
export const REPO_PUBLICATION_VERSION = 1;

export const RepoChainPublicationSchema = z.strictObject({
  version: z.literal(REPO_PUBLICATION_VERSION),
  repoChainId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  hostedChainId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  hostedRevision: z.string().regex(/^[a-f0-9]{64}$/),
});

export type RepoChainPublication = z.infer<typeof RepoChainPublicationSchema>;

export type RepoPublicationErrorCode =
  | 'REPO_PUBLICATION_CORRUPT'
  | 'REPO_PUBLICATION_UNSUPPORTED_VERSION'
  | 'REPO_PUBLICATION_ID_MISMATCH'
  | 'REPO_PUBLICATION_PATH_UNSAFE'
  | 'REPO_PUBLICATION_READ_FAILED'
  | 'REPO_PUBLICATION_WRITE_FAILED';

export class RepoPublicationError extends Error {
  constructor(
    readonly code: RepoPublicationErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'RepoPublicationError';
  }
}

export interface RepoChainRepositoryOptions {
  chainService?: ChainService;
  chainServiceOptions?: ChainServiceOptions;
  chainWriter?: ChainFileWriter;
  publicationWriter?: (target: string, value: unknown, dependencies?: AtomicWriteDependencies) => Promise<void>;
  publicationWriterDependencies?: AtomicWriteDependencies;
}

export interface RepoChainListWarning {
  code: string;
  path: string;
  chainId: string;
  message: string;
}

export interface RepoChainListResult {
  chains: Chain[];
  revisions: Record<string, string>;
  publications: Record<string, RepoChainPublication | null>;
  warnings: Array<ChainListResult['warnings'][number] | RepoChainListWarning>;
}

export interface RepoChainRepository {
  readonly root: string;
  readonly chainsDirectory: string;
  readonly service: ChainService;
  list(): Promise<RepoChainListResult>;
  readPublication(chainId: string): Promise<RepoChainPublication | null>;
  writePublication(chainId: string, publication: RepoChainPublication): Promise<void>;
}

const publicationQueues = new Map<string, Promise<void>>();

function errnoCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error &&
      typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }
  return 'UNKNOWN';
}

function enqueuePublicationWrite<T>(target: string, task: () => Promise<T>): Promise<T> {
  const previous = publicationQueues.get(target) ?? Promise.resolve();
  const current = previous.then(task, task);
  const settled = current.then(() => undefined, () => undefined);
  publicationQueues.set(target, settled);
  void settled.then(() => {
    if (publicationQueues.get(target) === settled) publicationQueues.delete(target);
  });
  return current;
}

function publicationPath(directory: string, chainId: string): string {
  if (!isSafeChainId(chainId)) {
    throw new RepoPublicationError(
      'REPO_PUBLICATION_PATH_UNSAFE',
      'The repository chain id is not a safe file name.',
      { chainId },
    );
  }
  const target = join(directory, `${chainId}.publish.json`);
  if (dirname(target) !== directory) {
    throw new RepoPublicationError(
      'REPO_PUBLICATION_PATH_UNSAFE',
      'The publication sidecar path is outside the chain directory.',
      { chainId },
    );
  }
  return target;
}

export async function createRepoChainRepository(
  projectPath: string,
  options: RepoChainRepositoryOptions = {},
): Promise<RepoChainRepository> {
  let root: string;
  try {
    root = await realpath(resolve(projectPath));
    if (!(await stat(root)).isDirectory()) throw new Error('NOT_A_DIRECTORY');
  } catch (error) {
    throw new ChainStoreError(
      'CHAIN_PROJECT_NOT_FOUND',
      'The repository directory could not be opened.',
      { path: resolve(projectPath), reason: errnoCode(error) },
      { cause: error },
    );
  }

  const chainsDirectory = join(root, REPO_CHAIN_DIRECTORY_NAME);
  const service = options.chainService ?? createChainService({
    ...options.chainServiceOptions,
    createStore: () => createChainStore({
      chainsDirectory,
      ...(options.chainWriter === undefined ? {} : { atomicWrite: options.chainWriter }),
    }),
  });

  const readPublication = async (chainId: string): Promise<RepoChainPublication | null> => {
    await service.get(root, chainId);
    const target = publicationPath(chainsDirectory, chainId);
    let info;
    try {
      info = await lstat(target);
    } catch (error) {
      if (errnoCode(error) === 'ENOENT') return null;
      throw new RepoPublicationError(
        'REPO_PUBLICATION_READ_FAILED',
        'The repository publication sidecar could not be inspected.',
        { path: target, chainId, reason: errnoCode(error) },
        { cause: error },
      );
    }
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 16_384) {
      throw new RepoPublicationError(
        'REPO_PUBLICATION_PATH_UNSAFE',
        'The repository publication sidecar is not a safe regular file.',
        { path: target, chainId },
      );
    }

    let text: string;
    try {
      text = await readFile(target, 'utf8');
    } catch (error) {
      throw new RepoPublicationError(
        'REPO_PUBLICATION_READ_FAILED',
        'The repository publication sidecar could not be read.',
        { path: target, chainId, reason: errnoCode(error) },
        { cause: error },
      );
    }
    if (Buffer.byteLength(text, 'utf8') > 16_384) {
      throw new RepoPublicationError(
        'REPO_PUBLICATION_PATH_UNSAFE',
        'The repository publication sidecar exceeds the supported size.',
        { path: target, chainId },
      );
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch (error) {
      throw new RepoPublicationError(
        'REPO_PUBLICATION_CORRUPT',
        'The repository publication sidecar is invalid; its contents were left unchanged.',
        { path: target, chainId, reason: 'INVALID_JSON' },
        { cause: error },
      );
    }
    if (typeof raw === 'object' && raw !== null && 'version' in raw &&
        (raw as { version?: unknown }).version !== REPO_PUBLICATION_VERSION) {
      throw new RepoPublicationError(
        'REPO_PUBLICATION_UNSUPPORTED_VERSION',
        'The repository publication sidecar uses an unsupported version.',
        { path: target, chainId, version: (raw as { version?: unknown }).version },
      );
    }
    const parsed = RepoChainPublicationSchema.safeParse(raw);
    if (!parsed.success) {
      throw new RepoPublicationError(
        'REPO_PUBLICATION_CORRUPT',
        'The repository publication sidecar is invalid; its contents were left unchanged.',
        {
          path: target,
          chainId,
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            code: issue.code,
          })),
        },
      );
    }
    if (parsed.data.repoChainId !== chainId) {
      throw new RepoPublicationError(
        'REPO_PUBLICATION_ID_MISMATCH',
        'The repository publication sidecar belongs to a different chain.',
        { path: target, chainId, repoChainId: parsed.data.repoChainId },
      );
    }
    return parsed.data;
  };

  const writePublication = async (
    chainId: string,
    publication: RepoChainPublication,
  ): Promise<void> => {
    await service.get(root, chainId);
    const parsed = RepoChainPublicationSchema.safeParse(publication);
    if (!parsed.success || parsed.data.repoChainId !== chainId) {
      throw new RepoPublicationError(
        'REPO_PUBLICATION_CORRUPT',
        'The hosted publication identity does not match the repository chain.',
        { chainId },
      );
    }
    const target = publicationPath(chainsDirectory, chainId);
    await enqueuePublicationWrite(target, async () => {
      await readPublication(chainId);
      try {
        await (options.publicationWriter ?? atomicWriteJson)(
          target,
          parsed.data,
          options.publicationWriterDependencies,
        );
      } catch (error) {
        throw new RepoPublicationError(
          'REPO_PUBLICATION_WRITE_FAILED',
          'The hosted chain was published, but its local publication sidecar could not be written.',
          { path: target, chainId, reason: errnoCode(error) },
          { cause: error },
        );
      }
    });
  };

  return {
    root,
    chainsDirectory,
    service,
    async list() {
      const result = await service.list(root);
      const publications: Record<string, RepoChainPublication | null> = {};
      const warnings: RepoChainListResult['warnings'] = [...result.warnings];
      for (const chain of result.chains) {
        try {
          publications[chain.id] = await readPublication(chain.id);
        } catch (error) {
          if (!(error instanceof RepoPublicationError)) throw error;
          warnings.push({
            code: error.code,
            path: typeof error.details.path === 'string' ? error.details.path : publicationPath(chainsDirectory, chain.id),
            chainId: chain.id,
            message: error.message,
          });
        }
      }
      return {
        chains: result.chains,
        revisions: Object.fromEntries(result.chains.map((chain) => [chain.id, chainRevision(chain)])),
        publications,
        warnings,
      };
    },
    readPublication,
    writePublication,
  };
}
