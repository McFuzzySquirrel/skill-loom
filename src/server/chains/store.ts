import { constants } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  unlink,
} from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import {
  atomicWriteJson as writeJsonAtomically,
  type AtomicWriteDependencies,
} from '../config/store.js';
import { SLAN_DIRECTORY_NAME } from '../projects/registry.js';
import {
  ChainError,
  ChainUnsupportedVersionError,
  ChainValidationError,
  parseChain,
  parseChainDocument,
  type Chain,
  type ChainValidationIssue,
} from './model.js';

/** Project-local directory that holds one JSON document per saved chain. */
export const CHAINS_DIRECTORY_NAME = 'chains';

/** Extension used for every chain document. */
export const CHAIN_FILE_EXTENSION = '.json';

/**
 * A chain id is a single filename segment. Lowercase alphanumerics, `_`, and
 * `-` keep ids readable and make `../`, separators, NUL bytes, absolute paths,
 * URL-encoded separators, and Windows drive prefixes impossible by shape.
 */
export const CHAIN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * Typed storage failures. Route code maps each code to one HTTP status; no
 * handler branches on a raw errno string or a filesystem message.
 */
export const CHAIN_STORE_ERROR_CODES = {
  ID_INVALID: 'CHAIN_ID_INVALID',
  PROJECT_INVALID: 'CHAIN_PROJECT_INVALID',
  PROJECT_NOT_FOUND: 'CHAIN_PROJECT_NOT_FOUND',
  PROJECT_NOT_DIRECTORY: 'CHAIN_PROJECT_NOT_DIRECTORY',
  PROJECT_UNREADABLE: 'CHAIN_PROJECT_UNREADABLE',
  STORE_SETUP_FAILED: 'CHAIN_STORE_SETUP_FAILED',
  PATH_ESCAPED: 'CHAIN_PATH_ESCAPED',
  NOT_FOUND: 'CHAIN_NOT_FOUND',
  ALREADY_EXISTS: 'CHAIN_ALREADY_EXISTS',
  READ_FAILED: 'CHAIN_READ_FAILED',
  WRITE_FAILED: 'CHAIN_WRITE_FAILED',
  DELETE_FAILED: 'CHAIN_DELETE_FAILED',
  LIST_FAILED: 'CHAIN_LIST_FAILED',
  FILE_CORRUPT: 'CHAIN_FILE_CORRUPT',
  FILE_UNREADABLE: 'CHAIN_FILE_UNREADABLE',
  FILE_ID_MISMATCH: 'CHAIN_FILE_ID_MISMATCH',
  UNSUPPORTED_VERSION: 'CHAIN_UNSUPPORTED_VERSION',
} as const;

export type ChainStoreErrorCode =
  (typeof CHAIN_STORE_ERROR_CODES)[keyof typeof CHAIN_STORE_ERROR_CODES];

/**
 * List warnings use the same stable codes as read errors, so a corrupt file
 * reported by a list and then opened by id keeps one identity.
 */
export const CHAIN_STORE_WARNING_CODES = {
  FILE_CORRUPT: CHAIN_STORE_ERROR_CODES.FILE_CORRUPT,
  FILE_UNREADABLE: CHAIN_STORE_ERROR_CODES.FILE_UNREADABLE,
  FILE_ID_MISMATCH: CHAIN_STORE_ERROR_CODES.FILE_ID_MISMATCH,
  FILE_IGNORED: 'CHAIN_FILE_IGNORED',
  UNSUPPORTED_VERSION: CHAIN_STORE_ERROR_CODES.UNSUPPORTED_VERSION,
} as const;

export type ChainStoreWarningCode =
  (typeof CHAIN_STORE_WARNING_CODES)[keyof typeof CHAIN_STORE_WARNING_CODES];

export type ChainStoreErrorDetails = Record<string, unknown>;

/**
 * Typed chain-storage failure. Details carry only paths, ids, stable codes, and
 * field paths; they never contain chain file contents.
 */
export class ChainStoreError extends Error {
  readonly code: ChainStoreErrorCode;
  readonly details: ChainStoreErrorDetails;

  constructor(
    code: ChainStoreErrorCode,
    message: string,
    details: ChainStoreErrorDetails = {},
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

/** A requested chain document does not exist. Route code maps this to 404. */
export class ChainNotFoundError extends ChainStoreError {
  constructor(chainId: string, path?: string) {
    super('CHAIN_NOT_FOUND', 'No chain matches that id.', {
      chainId,
      ...(path === undefined ? {} : { path }),
    });
  }
}

/** An id could not be a single safe filename segment. */
export class ChainIdInvalidError extends ChainStoreError {
  constructor(chainId: unknown) {
    super('CHAIN_ID_INVALID', 'The chain id is not a safe file name.', {
      chainId: describeValue(chainId),
      reason: chainIdInvalidReason(chainId),
    });
  }
}

/** A corrupt or unsupported chain file surfaced as a non-blocking warning. */
export interface ChainStoreWarning {
  code: ChainStoreWarningCode;
  message: string;
  /** Absolute path of the offending file. */
  path: string;
  chainId: string;
  reason?: string;
  /** Zod/model issue paths for a schema-invalid document. */
  issues?: ChainValidationIssue[];
  /** Present for an unsupported document version. */
  version?: unknown;
}

export interface ChainListResult {
  /** Valid chains only, newest `updatedAt` first. */
  chains: Chain[];
  /** Corrupt or unreadable files, sorted by path. */
  warnings: ChainStoreWarning[];
}

/** Atomic write seam. The default serializes JSON through `atomicWriteChainJson`. */
export type ChainFileWriter = (target: string, chain: Chain) => Promise<void>;

export type RealpathPath = (path: string) => Promise<string>;

export interface ChainStoreOptions {
  /**
   * Registered project directory. It is canonicalized with `realpath` before
   * any `.slan` path is derived, so a symlinked project root is handled once.
   * Exactly one of `projectPath` and `chainsDirectory` is required.
   */
  projectPath?: string;
  /**
   * Explicit chain directory for stores that are not tied to a project, such
   * as the global template library under the Slan config directory.
   */
  chainsDirectory?: string;
  /** Canonicalization seam for deterministic traversal tests. */
  realpathPath?: RealpathPath;
  /** Write seam for failure simulation. */
  atomicWrite?: ChainFileWriter;
}

export interface ChainStore {
  /** Valid chains, newest `updatedAt` first, plus corrupt-file warnings. */
  list(): Promise<ChainListResult>;
  /** Read one chain by safe id. A missing file raises `CHAIN_NOT_FOUND`. */
  read(chainId: string): Promise<Chain>;
  /** Create a new chain document. An existing id raises `CHAIN_ALREADY_EXISTS`. */
  create(chain: Chain): Promise<Chain>;
  /** Replace an existing chain document atomically. */
  update(chain: Chain): Promise<Chain>;
  /** Delete one valid chain document. The rest of the directory is untouched. */
  delete(chainId: string): Promise<void>;
}

/** `<canonicalProject>/.slan/chains`; the input must already be canonical. */
export function chainsDirectoryFor(projectPath: string): string {
  return join(projectPath, SLAN_DIRECTORY_NAME, CHAINS_DIRECTORY_NAME);
}

/** Global chain template directory under the Slan config directory. */
export const GLOBAL_CHAINS_DIRECTORY_NAME = 'chains';

/** `<slanConfig>/chains`; the input must already be an absolute path. */
export function globalChainsDirectoryFor(configDirectory: string): string {
  return join(configDirectory, GLOBAL_CHAINS_DIRECTORY_NAME);
}

/** True only for ids this store accepts as a filename segment. */
export function isSafeChainId(value: unknown): value is string {
  return typeof value === 'string' && CHAIN_ID_PATTERN.test(value);
}

/**
 * Reject an unsafe id before any filesystem call. The pattern excludes
 * separators, traversal segments, NUL bytes, absolute paths, and encoded
 * traversal, so the target filename can never leave the chains directory.
 */
export function assertSafeChainId(value: unknown): asserts value is string {
  if (!isSafeChainId(value)) {
    throw new ChainIdInvalidError(value);
  }
}

/**
 * Write one chain document atomically: same-directory temporary file, flush,
 * rename over the target, then fsync the directory. A failure removes the
 * temporary file and leaves the previous target untouched. `EXDEV` is surfaced
 * as a typed chain write failure instead of a non-atomic copy fallback.
 */
export async function atomicWriteChainJson(
  target: string,
  chain: Chain,
  dependencies: AtomicWriteDependencies = {},
): Promise<void> {
  try {
    await writeJsonAtomically(target, chain, dependencies);
  } catch (error) {
    if (error instanceof ChainStoreError) {
      throw error;
    }
    throw new ChainStoreError(
      CHAIN_STORE_ERROR_CODES.WRITE_FAILED,
      'The chain file could not be written atomically.',
      { path: target, chainId: chain.id, reason: errorReason(error) },
      { cause: error },
    );
  }
}

type PathEntryState = 'missing' | 'file' | 'directory' | 'symlink' | 'other';

interface ResolvedChainsRoot {
  projectPath: string;
  chainsDirectory: string;
  /** False when the chains directory does not exist yet and create is false. */
  exists: boolean;
}

type ChainFileFailureKind =
  | 'missing'
  | 'unreadable'
  | 'corrupt'
  | 'unsupported'
  | 'id_mismatch';

interface ChainFileFailure {
  kind: ChainFileFailureKind;
  path: string;
  chainId: string;
  reason?: string;
  issues?: ChainValidationIssue[];
  version?: unknown;
}

type ChainFileReadResult =
  | { ok: true; chain: Chain }
  | { ok: false; failure: ChainFileFailure };

class FileChainStore implements ChainStore {
  private readonly options: ChainStoreOptions;

  constructor(options: ChainStoreOptions) {
    this.options = options;
  }

  async list(): Promise<ChainListResult> {
    const root = await this.resolveRoot(false);
    if (!root.exists) {
      return { chains: [], warnings: [] };
    }

    let entries;
    try {
      entries = await readdir(root.chainsDirectory, { withFileTypes: true });
    } catch (error) {
      if (errnoCode(error) === 'ENOENT') {
        return { chains: [], warnings: [] };
      }
      throw new ChainStoreError(
        CHAIN_STORE_ERROR_CODES.LIST_FAILED,
        'The chain directory could not be listed.',
        { path: root.chainsDirectory, reason: errnoCode(error) },
        { cause: error },
      );
    }

    const chains: Chain[] = [];
    const warnings: ChainStoreWarning[] = [];

    for (const entry of entries) {
      // A symlink is not followed: `Dirent.isFile()` is false for it, so a
      // chain file cannot be used to read outside the chains directory.
      if (!entry.isFile()) {
        continue;
      }
      if (!entry.name.endsWith(CHAIN_FILE_EXTENSION) || entry.name.startsWith('.')) {
        continue;
      }

      const chainId = entry.name.slice(0, -CHAIN_FILE_EXTENSION.length);
      const path = join(root.chainsDirectory, entry.name);

      if (!isSafeChainId(chainId)) {
        warnings.push({
          code: CHAIN_STORE_WARNING_CODES.FILE_IGNORED,
          message: 'A JSON file in the chain directory has an unsafe id and was ignored.',
          path,
          chainId,
          reason: 'UNSAFE_ID',
        });
        continue;
      }

      const result = await this.readChainFile(path, chainId);
      if (result.ok) {
        chains.push(result.chain);
      } else {
        warnings.push(warningFromFailure(result.failure));
      }
    }

    chains.sort(compareChainsByUpdatedAt);
    warnings.sort((left, right) => left.path.localeCompare(right.path));
    return { chains, warnings };
  }

  async read(chainId: string): Promise<Chain> {
    // Validate before resolving the project: an unsafe id never reaches the
    // filesystem, even when the project path itself is invalid.
    assertSafeChainId(chainId);

    const root = await this.resolveRoot(false);
    if (!root.exists) {
      throw new ChainNotFoundError(chainId);
    }

    const target = targetForId(root.chainsDirectory, chainId);
    const state = await this.inspectEntry(target);
    switch (state) {
      case 'missing':
        throw new ChainNotFoundError(chainId, target);
      case 'symlink':
        throw new ChainStoreError(
          CHAIN_STORE_ERROR_CODES.PATH_ESCAPED,
          'The chain file is a symbolic link and will not be followed.',
          { path: target, chainId, reason: 'SYMLINK' },
        );
      case 'file':
        break;
      default:
        throw new ChainStoreError(
          CHAIN_STORE_ERROR_CODES.READ_FAILED,
          'The chain target is not a regular file.',
          { path: target, chainId, reason: 'NOT_A_FILE' },
        );
    }

    const result = await this.readChainFile(target, chainId);
    if (result.ok) {
      return result.chain;
    }
    throw errorFromFailure(result.failure);
  }

  async create(chain: Chain): Promise<Chain> {
    const validated = parseChain(chain);
    assertSafeChainId(validated.id);

    const root = await this.resolveRoot(true);
    const target = targetForId(root.chainsDirectory, validated.id);

    const state = await this.inspectEntry(target);
    if (state !== 'missing') {
      throw new ChainStoreError(
        CHAIN_STORE_ERROR_CODES.ALREADY_EXISTS,
        'A chain with that id already exists.',
        {
          path: target,
          chainId: validated.id,
          reason: state === 'symlink' ? 'SYMLINK' : 'EXISTS',
        },
      );
    }

    await this.writeChainFile(target, validated);
    return validated;
  }

  async update(chain: Chain): Promise<Chain> {
    const validated = parseChain(chain);
    assertSafeChainId(validated.id);

    const root = await this.resolveRoot(false);
    if (!root.exists) {
      throw new ChainNotFoundError(validated.id);
    }

    const target = targetForId(root.chainsDirectory, validated.id);
    const state = await this.inspectEntry(target);
    switch (state) {
      case 'missing':
        throw new ChainNotFoundError(validated.id, target);
      case 'symlink':
        throw new ChainStoreError(
          CHAIN_STORE_ERROR_CODES.PATH_ESCAPED,
          'The chain file is a symbolic link and will not be replaced.',
          { path: target, chainId: validated.id, reason: 'SYMLINK' },
        );
      case 'file':
        break;
      default:
        throw new ChainStoreError(
          CHAIN_STORE_ERROR_CODES.WRITE_FAILED,
          'The chain target is not a regular file.',
          { path: target, chainId: validated.id, reason: 'NOT_A_FILE' },
        );
    }

    await this.writeChainFile(target, validated);
    return validated;
  }

  async delete(chainId: string): Promise<void> {
    assertSafeChainId(chainId);

    const root = await this.resolveRoot(false);
    if (!root.exists) {
      throw new ChainNotFoundError(chainId);
    }

    const target = targetForId(root.chainsDirectory, chainId);
    const state = await this.inspectEntry(target);
    switch (state) {
      case 'missing':
        throw new ChainNotFoundError(chainId, target);
      case 'symlink':
        throw new ChainStoreError(
          CHAIN_STORE_ERROR_CODES.PATH_ESCAPED,
          'The chain file is a symbolic link and will not be removed.',
          { path: target, chainId, reason: 'SYMLINK' },
        );
      case 'file':
        break;
      default:
        throw new ChainStoreError(
          CHAIN_STORE_ERROR_CODES.DELETE_FAILED,
          'The chain target is not a regular file.',
          { path: target, chainId, reason: 'NOT_A_FILE' },
        );
    }

    try {
      await unlink(target);
    } catch (error) {
      if (errnoCode(error) === 'ENOENT') {
        throw new ChainNotFoundError(chainId, target);
      }
      throw new ChainStoreError(
        CHAIN_STORE_ERROR_CODES.DELETE_FAILED,
        'The chain file could not be deleted.',
        { path: target, chainId, reason: errnoCode(error) },
        { cause: error },
      );
    }
  }

  private async resolveRoot(create: boolean): Promise<ResolvedChainsRoot> {
    if (this.options.chainsDirectory !== undefined) {
      return this.resolveDirectoryRoot(this.options.chainsDirectory, create);
    }

    const canonicalProject = await canonicalizeProject(
      this.options.projectPath,
      this.options.realpathPath,
    );
    const slanDirectory = join(canonicalProject, SLAN_DIRECTORY_NAME);
    const chainsDirectory = chainsDirectoryFor(canonicalProject);

    const slanState = await this.inspectEntry(slanDirectory);
    assertNotSymlinkOrFile(slanState, slanDirectory, SLAN_DIRECTORY_NAME);

    const chainsState =
      slanState === 'missing' ? 'missing' : await this.inspectEntry(chainsDirectory);
    assertNotSymlinkOrFile(chainsState, chainsDirectory, CHAINS_DIRECTORY_NAME);

    let exists = chainsState === 'directory';
    if (!exists && create) {
      try {
        await mkdir(chainsDirectory, { recursive: true, mode: 0o755 });
      } catch (error) {
        throw new ChainStoreError(
          CHAIN_STORE_ERROR_CODES.STORE_SETUP_FAILED,
          'The project chain directory could not be created.',
          { path: chainsDirectory, reason: errnoCode(error) },
          { cause: error },
        );
      }
      exists = true;
    }

    if (exists) {
      // Canonicalize the directory itself and require exact equality. A
      // symlinked `.slan` or `chains` path resolves elsewhere and is rejected
      // before any chain file is read or written.
      const canonical = await this.canonicalizeChainsDirectory(chainsDirectory);
      if (canonical !== chainsDirectory) {
        throw new ChainStoreError(
          CHAIN_STORE_ERROR_CODES.PATH_ESCAPED,
          'The chain directory resolves outside the project .slan directory.',
          {
            path: chainsDirectory,
            resolvedPath: canonical,
            reason: 'SYMLINK_ESCAPE',
          },
        );
      }
    }

    return { projectPath: canonicalProject, chainsDirectory, exists };
  }

  /**
   * Resolve an explicit chain directory that is not derived from a project.
   *
   * The directory is validated like a project chain directory: it must be an
   * absolute path, cannot be a symlink, cannot be a file, and is canonicalized
   * before use. Creating it is limited to `create: true` so a list or read
   * never scaffolds the user's config directory.
   */
  private async resolveDirectoryRoot(
    chainsDirectory: string,
    create: boolean,
  ): Promise<ResolvedChainsRoot> {
    if (
      typeof chainsDirectory !== 'string' ||
      chainsDirectory.trim() === '' ||
      chainsDirectory.includes('\0') ||
      !isAbsolute(chainsDirectory)
    ) {
      throw new ChainStoreError(
        CHAIN_STORE_ERROR_CODES.PROJECT_INVALID,
        'An absolute chain directory is required.',
        {
          path: chainsDirectory,
          reason: chainsDirectory.includes('\0') ? 'NUL_BYTE' : 'NOT_ABSOLUTE',
        },
      );
    }

    const state = await this.inspectEntry(chainsDirectory);
    assertNotSymlinkOrFile(state, chainsDirectory, CHAINS_DIRECTORY_NAME);

    let exists = state === 'directory';
    if (!exists && create) {
      try {
        await mkdir(chainsDirectory, { recursive: true, mode: 0o700 });
      } catch (error) {
        throw new ChainStoreError(
          CHAIN_STORE_ERROR_CODES.STORE_SETUP_FAILED,
          'The chain directory could not be created.',
          { path: chainsDirectory, reason: errnoCode(error) },
          { cause: error },
        );
      }
      exists = true;
    }

    if (exists) {
      const canonical = await this.canonicalizeChainsDirectory(chainsDirectory);
      if (canonical !== chainsDirectory) {
        throw new ChainStoreError(
          CHAIN_STORE_ERROR_CODES.PATH_ESCAPED,
          'The chain directory resolves to a different path.',
          {
            path: chainsDirectory,
            resolvedPath: canonical,
            reason: 'SYMLINK_ESCAPE',
          },
        );
      }
    }

    return {
      projectPath: chainsDirectory,
      chainsDirectory,
      exists,
    };
  }

  private async canonicalizeChainsDirectory(chainsDirectory: string): Promise<string> {
    const realpathPath = this.options.realpathPath ?? ((path: string) => realpath(path));
    try {
      return await realpathPath(chainsDirectory);
    } catch (error) {
      throw new ChainStoreError(
        CHAIN_STORE_ERROR_CODES.STORE_SETUP_FAILED,
        'The project chain directory could not be canonicalized.',
        { path: chainsDirectory, reason: errnoCode(error) },
        { cause: error },
      );
    }
  }

  private async inspectEntry(path: string): Promise<PathEntryState> {
    let stats: Stats;
    try {
      stats = await lstat(path);
    } catch (error) {
      if (errnoCode(error) === 'ENOENT') {
        return 'missing';
      }
      throw new ChainStoreError(
        CHAIN_STORE_ERROR_CODES.STORE_SETUP_FAILED,
        'A chain storage path could not be inspected.',
        { path, reason: errnoCode(error) },
        { cause: error },
      );
    }

    if (stats.isSymbolicLink()) {
      return 'symlink';
    }
    if (stats.isDirectory()) {
      return 'directory';
    }
    if (stats.isFile()) {
      return 'file';
    }
    return 'other';
  }

  private async readChainFile(path: string, expectedId: string): Promise<ChainFileReadResult> {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if (errnoCode(error) === 'ENOENT') {
        return { ok: false, failure: { kind: 'missing', path, chainId: expectedId } };
      }
      return {
        ok: false,
        failure: {
          kind: 'unreadable',
          path,
          chainId: expectedId,
          reason: errnoCode(error),
        },
      };
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      return {
        ok: false,
        failure: {
          kind: 'corrupt',
          path,
          chainId: expectedId,
          reason: 'INVALID_JSON',
        },
      };
    }

    let chain: Chain;
    try {
      chain = parseChainDocument(decoded).chain;
    } catch (error) {
      if (error instanceof ChainUnsupportedVersionError) {
        return {
          ok: false,
          failure: {
            kind: 'unsupported',
            path,
            chainId: expectedId,
            version: error.details.version,
          },
        };
      }
      if (error instanceof ChainValidationError) {
        return {
          ok: false,
          failure: {
            kind: 'corrupt',
            path,
            chainId: expectedId,
            reason: 'SCHEMA_INVALID',
            issues: error.issues,
          },
        };
      }
      if (error instanceof ChainError) {
        return {
          ok: false,
          failure: {
            kind: 'corrupt',
            path,
            chainId: expectedId,
            reason: error.code,
          },
        };
      }
      return {
        ok: false,
        failure: {
          kind: 'corrupt',
          path,
          chainId: expectedId,
          reason: 'PARSE_FAILED',
        },
      };
    }

    if (chain.id !== expectedId) {
      return {
        ok: false,
        failure: {
          kind: 'id_mismatch',
          path,
          chainId: expectedId,
          reason: 'ID_MISMATCH',
        },
      };
    }

    return { ok: true, chain };
  }

  private async writeChainFile(target: string, chain: Chain): Promise<void> {
    const writer = this.options.atomicWrite ?? atomicWriteChainJson;
    try {
      await writer(target, chain);
    } catch (error) {
      if (error instanceof ChainStoreError) {
        throw error;
      }
      throw new ChainStoreError(
        CHAIN_STORE_ERROR_CODES.WRITE_FAILED,
        'The chain file could not be written.',
        { path: target, chainId: chain.id, reason: errorReason(error) },
        { cause: error },
      );
    }
  }
}

export function createChainStore(options: ChainStoreOptions): ChainStore {
  return new FileChainStore(options);
}

/**
 * Canonicalize the project directory before deriving `.slan/chains`. The
 * project is never created here: a missing project is a typed 404 candidate,
 * not an invitation to scaffold the user's filesystem.
 */
async function canonicalizeProject(
  projectPath: unknown,
  realpathPath: RealpathPath | undefined,
): Promise<string> {
  if (typeof projectPath !== 'string' || projectPath.trim() === '') {
    throw new ChainStoreError(
      CHAIN_STORE_ERROR_CODES.PROJECT_INVALID,
      'A project directory is required.',
      { reason: 'REQUIRED' },
    );
  }
  if (projectPath.includes('\0') || !isAbsolute(projectPath)) {
    throw new ChainStoreError(
      CHAIN_STORE_ERROR_CODES.PROJECT_INVALID,
      'The project directory must be an absolute path without NUL bytes.',
      {
        path: projectPath,
        reason: projectPath.includes('\0') ? 'NUL_BYTE' : 'NOT_ABSOLUTE',
      },
    );
  }

  const resolvePath = realpathPath ?? ((path: string) => realpath(path));

  let canonical: string;
  try {
    canonical = await resolvePath(projectPath);
  } catch (error) {
    throw projectErrorFromFs(error, projectPath, CHAIN_STORE_ERROR_CODES.PROJECT_NOT_FOUND);
  }

  if (!isAbsolute(canonical) || canonical.includes('\0')) {
    throw new ChainStoreError(
      CHAIN_STORE_ERROR_CODES.PROJECT_INVALID,
      'The project directory did not resolve to a canonical absolute path.',
      { path: projectPath, resolvedPath: describeValue(canonical), reason: 'NON_CANONICAL' },
    );
  }

  let stats: Stats;
  try {
    stats = await stat(canonical);
  } catch (error) {
    throw projectErrorFromFs(error, canonical, CHAIN_STORE_ERROR_CODES.PROJECT_UNREADABLE);
  }

  if (!stats.isDirectory()) {
    throw new ChainStoreError(
      CHAIN_STORE_ERROR_CODES.PROJECT_NOT_DIRECTORY,
      'The project path is not a directory.',
      { path: canonical },
    );
  }

  try {
    await access(canonical, constants.R_OK | constants.X_OK);
  } catch (error) {
    throw projectErrorFromFs(error, canonical, CHAIN_STORE_ERROR_CODES.PROJECT_UNREADABLE);
  }

  return canonical;
}

function targetForId(chainsDirectory: string, chainId: string): string {
  const target = join(chainsDirectory, `${chainId}${CHAIN_FILE_EXTENSION}`);
  if (dirname(target) !== chainsDirectory) {
    // Defense in depth: the id pattern already excludes separators. This guard
    // keeps the containment invariant true if the pattern is ever loosened.
    throw new ChainIdInvalidError(chainId);
  }
  return target;
}

function assertNotSymlinkOrFile(
  state: PathEntryState,
  path: string,
  name: string,
): void {
  if (state === 'symlink') {
    throw new ChainStoreError(
      CHAIN_STORE_ERROR_CODES.PATH_ESCAPED,
      'A chain storage path is a symbolic link and will not be followed.',
      { path, name, reason: 'SYMLINK' },
    );
  }
  if (state === 'file' || state === 'other') {
    throw new ChainStoreError(
      CHAIN_STORE_ERROR_CODES.STORE_SETUP_FAILED,
      'A chain storage path is not a directory.',
      { path, name, reason: 'NOT_DIRECTORY' },
    );
  }
}

function warningFromFailure(failure: ChainFileFailure): ChainStoreWarning {
  switch (failure.kind) {
    case 'unsupported':
      return {
        code: CHAIN_STORE_WARNING_CODES.UNSUPPORTED_VERSION,
        message: 'A chain file uses an unsupported version and was not listed.',
        path: failure.path,
        chainId: failure.chainId,
        ...(failure.version === undefined ? {} : { version: failure.version }),
      };
    case 'unreadable':
      return {
        code: CHAIN_STORE_WARNING_CODES.FILE_UNREADABLE,
        message: 'A chain file could not be read and was not listed.',
        path: failure.path,
        chainId: failure.chainId,
        ...(failure.reason === undefined ? {} : { reason: failure.reason }),
      };
    case 'id_mismatch':
      return {
        code: CHAIN_STORE_WARNING_CODES.FILE_ID_MISMATCH,
        message: 'A chain file id does not match its filename and was not listed.',
        path: failure.path,
        chainId: failure.chainId,
        reason: failure.reason ?? 'ID_MISMATCH',
      };
    case 'missing':
      return {
        code: CHAIN_STORE_WARNING_CODES.FILE_UNREADABLE,
        message: 'A chain file disappeared while the directory was listed.',
        path: failure.path,
        chainId: failure.chainId,
        reason: 'ENOENT',
      };
    case 'corrupt':
    default:
      return {
        code: CHAIN_STORE_WARNING_CODES.FILE_CORRUPT,
        message: 'A chain file is corrupt and was not listed.',
        path: failure.path,
        chainId: failure.chainId,
        ...(failure.reason === undefined ? {} : { reason: failure.reason }),
        ...(failure.issues === undefined ? {} : { issues: failure.issues }),
      };
  }
}

function errorFromFailure(failure: ChainFileFailure): ChainStoreError {
  const details: ChainStoreErrorDetails = {
    path: failure.path,
    chainId: failure.chainId,
    ...(failure.reason === undefined ? {} : { reason: failure.reason }),
    ...(failure.issues === undefined ? {} : { issues: failure.issues }),
    ...(failure.version === undefined ? {} : { version: failure.version }),
  };

  switch (failure.kind) {
    case 'missing':
      return new ChainNotFoundError(failure.chainId, failure.path);
    case 'unsupported':
      return new ChainStoreError(
        CHAIN_STORE_ERROR_CODES.UNSUPPORTED_VERSION,
        'The chain file uses an unsupported version.',
        details,
      );
    case 'id_mismatch':
      return new ChainStoreError(
        CHAIN_STORE_ERROR_CODES.FILE_ID_MISMATCH,
        'The chain file id does not match its filename.',
        details,
      );
    case 'unreadable':
      return new ChainStoreError(
        CHAIN_STORE_ERROR_CODES.FILE_UNREADABLE,
        'The chain file could not be read.',
        details,
      );
    case 'corrupt':
    default:
      return new ChainStoreError(
        CHAIN_STORE_ERROR_CODES.FILE_CORRUPT,
        'The chain file is corrupt and was not loaded.',
        details,
      );
  }
}

/**
 * Order by `updatedAt` descending. Ties fall back to `createdAt` descending and
 * then id ascending so repeated lists are deterministic across filesystems.
 */
function compareChainsByUpdatedAt(left: Chain, right: Chain): number {
  const updated = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  if (updated !== 0) {
    return updated;
  }
  const created = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  if (created !== 0) {
    return created;
  }
  return left.id.localeCompare(right.id);
}

function projectErrorFromFs(
  error: unknown,
  path: string,
  fallback: ChainStoreErrorCode,
): ChainStoreError {
  const reason = errnoCode(error);
  switch (reason) {
    case 'ENOENT':
      return new ChainStoreError(
        CHAIN_STORE_ERROR_CODES.PROJECT_NOT_FOUND,
        'The project directory does not exist.',
        { path, reason },
        { cause: error },
      );
    case 'ENOTDIR':
      return new ChainStoreError(
        CHAIN_STORE_ERROR_CODES.PROJECT_NOT_DIRECTORY,
        'The project path is not a directory.',
        { path, reason },
        { cause: error },
      );
    case 'EACCES':
    case 'EPERM':
      return new ChainStoreError(
        CHAIN_STORE_ERROR_CODES.PROJECT_UNREADABLE,
        'The project directory cannot be read.',
        { path, reason },
        { cause: error },
      );
    default:
      return new ChainStoreError(
        fallback,
        'The project directory could not be resolved.',
        { path, reason },
        { cause: error },
      );
  }
}

function chainIdInvalidReason(value: unknown): string {
  if (typeof value !== 'string') {
    return 'NOT_A_STRING';
  }
  if (value === '') {
    return 'EMPTY';
  }
  if (value.length > 64) {
    return 'TOO_LONG';
  }
  if (value.includes('\0')) {
    return 'NUL_BYTE';
  }
  if (
    value.includes('/') ||
    value.includes('\\') ||
    value === '.' ||
    value === '..' ||
    value.includes('..')
  ) {
    return 'TRAVERSAL';
  }
  if (!/^[a-z0-9]/.test(value)) {
    return 'INVALID_START';
  }
  return 'INVALID_CHARACTER';
}

function errorReason(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const details = (error as { details?: unknown }).details;
    if (isRecord(details) && typeof details.reason === 'string') {
      return details.reason;
    }
  }
  return errnoCode(error);
}

function errnoCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') {
      return code;
    }
  }
  return 'UNKNOWN';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeValue(value: unknown): unknown {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    return value;
  }
  return Array.isArray(value) ? 'array' : typeof value;
}
