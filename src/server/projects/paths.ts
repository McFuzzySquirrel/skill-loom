import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';

/**
 * Typed failures for the server-side folder browser. Every code maps to one
 * HTTP status in `routes/fs.ts`; the route never guesses from an errno string.
 */
export const FOLDER_PATH_ERROR_CODES = {
  PATH_REQUIRED: 'PATH_REQUIRED',
  PATH_NOT_ABSOLUTE: 'PATH_NOT_ABSOLUTE',
  PATH_INVALID: 'PATH_INVALID',
  PATH_NOT_FOUND: 'PATH_NOT_FOUND',
  PATH_NOT_DIRECTORY: 'PATH_NOT_DIRECTORY',
  PATH_UNREADABLE: 'PATH_UNREADABLE',
} as const;

export type FolderPathErrorCode =
  (typeof FOLDER_PATH_ERROR_CODES)[keyof typeof FOLDER_PATH_ERROR_CODES];

/** Mode used to prove a directory can be listed and traversed. */
export const READABLE_DIRECTORY_MODE = constants.R_OK | constants.X_OK;

/** Existence-only probe mode used for `.git` and `.slan` markers. */
export const EXISTS_MODE = constants.F_OK;

export type RealpathPath = (path: string) => Promise<string>;
export type StatPath = (path: string) => Promise<{ isDirectory(): boolean }>;
export type AccessPath = (path: string, mode: number) => Promise<void>;

/**
 * Injection seams keep path canonicalization deterministic in unit tests and
 * let the browser simulate permission and metadata failures without touching
 * the developer's real home directory.
 */
export interface FolderPathDependencies {
  realpathPath?: RealpathPath;
  statPath?: StatPath;
  accessPath?: AccessPath;
}

export const defaultRealpathPath: RealpathPath = (path) => realpath(path);
export const defaultStatPath: StatPath = (path) => stat(path);
export const defaultAccessPath: AccessPath = (path, mode) => access(path, mode);

/** A canonical directory and the parent the folder browser should offer. */
export interface CanonicalDirectory {
  /** Absolute path returned by `realpath` (symlinks fully resolved). */
  path: string;
  /** Canonical parent, or `null` when the directory is a filesystem root. */
  parent: string | null;
}

/** Typed folder-browser failure; details never include file contents. */
export class FolderPathError extends Error {
  readonly code: FolderPathErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: FolderPathErrorCode,
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

export class PathRequiredError extends FolderPathError {
  constructor() {
    super('PATH_REQUIRED', 'A folder path is required.');
  }
}

export class PathNotAbsoluteError extends FolderPathError {
  constructor(path: unknown) {
    super('PATH_NOT_ABSOLUTE', 'Folder paths must be absolute.', {
      path: typeof path === 'string' ? path : String(path),
    });
  }
}

export class PathInvalidError extends FolderPathError {
  constructor(path: string, reason?: string) {
    super('PATH_INVALID', 'The folder path is not valid.', {
      path,
      ...(reason === undefined ? {} : { reason }),
    });
  }
}

export class PathNotFoundError extends FolderPathError {
  constructor(path: string, reason?: string) {
    super('PATH_NOT_FOUND', 'The folder does not exist.', {
      path,
      ...(reason === undefined ? {} : { reason }),
    });
  }
}

export class PathNotDirectoryError extends FolderPathError {
  constructor(path: string, reason?: string) {
    super('PATH_NOT_DIRECTORY', 'The path is not a directory.', {
      path,
      ...(reason === undefined ? {} : { reason }),
    });
  }
}

export class PathUnreadableError extends FolderPathError {
  constructor(path: string, reason?: string) {
    super('PATH_UNREADABLE', 'The folder cannot be read.', {
      path,
      ...(reason === undefined ? {} : { reason }),
    });
  }
}

/**
 * Validate a client-supplied path and resolve it through `realpath`.
 *
 * Any readable absolute directory is allowed: PROJ-FR-01 deliberately has no
 * browse root. Relative input is rejected instead of being silently resolved
 * against the process working directory, and canonicalization happens before
 * the caller touches entries so a symlink escape cannot be hidden from the
 * returned path.
 */
export async function resolveCanonicalDirectory(
  input: unknown,
  dependencies: FolderPathDependencies = {},
): Promise<CanonicalDirectory> {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new PathRequiredError();
  }

  const requested = input;
  if (requested.includes('\0')) {
    throw new PathInvalidError(requested, 'NUL_BYTE');
  }
  if (!isAbsolute(requested)) {
    throw new PathNotAbsoluteError(requested);
  }

  const realpathPath = dependencies.realpathPath ?? defaultRealpathPath;
  const statPath = dependencies.statPath ?? defaultStatPath;
  const accessPath = dependencies.accessPath ?? defaultAccessPath;

  let canonical: string;
  try {
    canonical = await realpathPath(requested);
  } catch (error) {
    throw folderPathErrorFromFs(error, requested);
  }

  if (!isAbsolute(canonical) || canonical.includes('\0')) {
    throw new PathInvalidError(requested, 'NON_CANONICAL_RESULT');
  }

  let stats: { isDirectory(): boolean };
  try {
    stats = await statPath(canonical);
  } catch (error) {
    throw folderPathErrorFromFs(error, canonical);
  }

  if (!stats.isDirectory()) {
    throw new PathNotDirectoryError(canonical);
  }

  try {
    await accessPath(canonical, READABLE_DIRECTORY_MODE);
  } catch (error) {
    throw folderPathErrorFromFs(error, canonical);
  }

  return { path: canonical, parent: parentOf(canonical) };
}

/**
 * Translate a Node filesystem failure into a typed folder-browser error.
 * Unknown failures become `PATH_UNREADABLE` rather than leaking raw errno
 * text through the API envelope.
 */
export function folderPathErrorFromFs(error: unknown, path: string): FolderPathError {
  if (error instanceof FolderPathError) {
    return error;
  }

  const reason = errnoCode(error);
  switch (reason) {
    case 'ENOENT':
      return new PathNotFoundError(path, reason);
    case 'ENOTDIR':
      return new PathNotDirectoryError(path, reason);
    case 'EACCES':
    case 'EPERM':
      return new PathUnreadableError(path, reason);
    case 'ELOOP':
    case 'ENAMETOOLONG':
    case 'EINVAL':
      return new PathInvalidError(path, reason);
    default:
      return new PathUnreadableError(path, reason);
  }
}

/** Parent of a canonical directory, or `null` for a filesystem root. */
export function parentOf(canonicalPath: string): string | null {
  const parent = dirname(canonicalPath);
  return parent === canonicalPath ? null : parent;
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
