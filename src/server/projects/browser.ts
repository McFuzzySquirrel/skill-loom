import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  EXISTS_MODE,
  READABLE_DIRECTORY_MODE,
  defaultAccessPath,
  defaultStatPath,
  folderPathErrorFromFs,
  resolveCanonicalDirectory,
  type AccessPath,
  type FolderPathDependencies,
  type StatPath,
} from './paths.js';

/** Safety cap for one listing; the browser asks the user to narrow the path. */
export const DEFAULT_MAX_DIRECTORY_ENTRIES = 1_000;

/** The structural shape the browser needs from a `readdir` result. */
export interface DirectoryChild {
  name: string;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

export type ReadDirectory = (directory: string) => Promise<ReadonlyArray<DirectoryChild>>;

export interface DirectoryBrowserDependencies extends FolderPathDependencies {
  /** Directory reader seam. Defaults to `readdir(path, { withFileTypes: true })`. */
  readDirectory?: ReadDirectory;
  /** Maximum entries returned in one response. */
  maxEntries?: number;
}

/** One entry in a folder-browser listing. */
export interface DirectoryEntry {
  /** Base name, exactly as returned by the filesystem. */
  name: string;
  /** Canonical parent joined with the name; never a client-supplied path. */
  path: string;
  isDirectory: boolean;
  /** A `.git` marker exists (directory or worktree pointer file). */
  isGitRepo: boolean;
  /** A `.loom` data directory exists. */
  hasLoom: boolean;
}

/** The documented response shape of `GET /api/fs`. */
export interface DirectoryListing {
  /** Canonical path returned by `realpath`. */
  path: string;
  /** Canonical parent, or `null` at a filesystem root. */
  parent: string | null;
  /** Directories first, then files, each alphabetically case-insensitive. */
  entries: DirectoryEntry[];
  /** True when the directory held more entries than the cap. */
  truncated: boolean;
}

const defaultReadDirectory: ReadDirectory = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory(),
    isSymbolicLink: entry.isSymbolicLink(),
  }));
};

/**
 * List a readable absolute directory for the folder browser.
 *
 * The response contains metadata only. File contents are never opened, and
 * no shell process is involved. Children whose type cannot be resolved (for
 * example a dangling symlink) or whose directory cannot be read are omitted
 * instead of failing the whole listing.
 */
export async function listDirectory(
  requestedPath: unknown,
  dependencies: DirectoryBrowserDependencies = {},
): Promise<DirectoryListing> {
  const resolved = await resolveCanonicalDirectory(requestedPath, dependencies);
  const readDirectory = dependencies.readDirectory ?? defaultReadDirectory;
  const statPath = dependencies.statPath ?? defaultStatPath;
  const accessPath = dependencies.accessPath ?? defaultAccessPath;

  let children: ReadonlyArray<DirectoryChild>;
  try {
    children = await readDirectory(resolved.path);
  } catch (error) {
    throw folderPathErrorFromFs(error, resolved.path);
  }

  const discovered: DirectoryEntry[] = [];
  for (const child of children) {
    if (!isSafeEntryName(child.name)) {
      continue;
    }

    const childPath = join(resolved.path, child.name);
    const isDirectory = await resolveChildDirectory(child, childPath, statPath);
    if (isDirectory === null) {
      continue;
    }

    if (isDirectory) {
      try {
        await accessPath(childPath, READABLE_DIRECTORY_MODE);
      } catch {
        // An unreadable child is hidden; it must not break its parent.
        continue;
      }
    }

    discovered.push({
      name: child.name,
      path: childPath,
      isDirectory,
      isGitRepo: false,
      hasLoom: false,
    });
  }

  discovered.sort(compareDirectoryEntries);

  const limit = normalizeLimit(dependencies.maxEntries);
  const truncated = discovered.length > limit;
  const selected = discovered.slice(0, limit);

  const entries = await Promise.all(
    selected.map(async (entry) => {
      if (!entry.isDirectory) {
        return entry;
      }

      const [isGitRepo, hasLoom] = await Promise.all([
        pathExists(join(entry.path, '.git'), accessPath),
        pathExists(join(entry.path, '.loom'), accessPath),
      ]);

      return { ...entry, isGitRepo, hasLoom };
    }),
  );

  return {
    path: resolved.path,
    parent: resolved.parent,
    entries,
    truncated,
  };
}

/** Directories first, then case-insensitive name order with a stable tiebreak. */
export function compareDirectoryEntries(a: DirectoryEntry, b: DirectoryEntry): number {
  if (a.isDirectory !== b.isDirectory) {
    return a.isDirectory ? -1 : 1;
  }
  return compareNames(a.name, b.name);
}

function compareNames(a: string, b: string): number {
  const loweredA = a.toLowerCase();
  const loweredB = b.toLowerCase();
  if (loweredA !== loweredB) {
    return loweredA < loweredB ? -1 : 1;
  }
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

async function resolveChildDirectory(
  child: DirectoryChild,
  childPath: string,
  statPath: StatPath,
): Promise<boolean | null> {
  if (!child.isSymbolicLink) {
    return child.isDirectory;
  }

  try {
    return (await statPath(childPath)).isDirectory();
  } catch {
    // Dangling or inaccessible symlinks are omitted, never fatal.
    return null;
  }
}

async function pathExists(target: string, accessPath: AccessPath): Promise<boolean> {
  try {
    await accessPath(target, EXISTS_MODE);
    return true;
  } catch {
    return false;
  }
}

function isSafeEntryName(name: string): boolean {
  return (
    name !== '' &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !name.includes('\0')
  );
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_MAX_DIRECTORY_ENTRIES;
  }
  return Math.max(0, Math.trunc(value));
}
