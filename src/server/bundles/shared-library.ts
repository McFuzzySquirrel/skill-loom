import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, open, readdir, realpath, readFile, unlink } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { ChainBundle } from '../../shared/bundles.js';
import { MAX_BUNDLE_REQUEST_BYTES, parseBundle } from '../chains/bundle.js';
import type { ConfigStore } from '../config/store.js';
import { resolveCanonicalDirectory } from '../projects/paths.js';

const MAX_LIBRARY_ENTRIES = 500;
const BUNDLE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,120}$/;
const PUBLISH_ATTEMPTS = 5;

export const SHARED_LIBRARY_ERROR_CODES = {
  NOT_CONFIGURED: 'SHARED_LIBRARY_NOT_CONFIGURED',
  DIRECTORY_UNAVAILABLE: 'SHARED_LIBRARY_DIRECTORY_UNAVAILABLE',
  DIRECTORY_INVALID: 'SHARED_LIBRARY_DIRECTORY_INVALID',
  BUNDLE_NOT_FOUND: 'SHARED_LIBRARY_BUNDLE_NOT_FOUND',
  BUNDLE_INVALID: 'SHARED_LIBRARY_BUNDLE_INVALID',
  BUNDLE_TOO_LARGE: 'SHARED_LIBRARY_BUNDLE_TOO_LARGE',
  PUBLISH_FAILED: 'SHARED_LIBRARY_PUBLISH_FAILED',
  COLLISION: 'SHARED_LIBRARY_NAME_COLLISION',
  REVIEW_STALE: 'SHARED_LIBRARY_REVIEW_STALE',
} as const;

export type SharedLibraryErrorCode =
  (typeof SHARED_LIBRARY_ERROR_CODES)[keyof typeof SHARED_LIBRARY_ERROR_CODES];

export class SharedLibraryError extends Error {
  constructor(
    readonly code: SharedLibraryErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
  }
}

export interface SharedLibraryEntry {
  id: string;
  filename: string;
  status: 'available' | 'invalid' | 'unsafe' | 'unreadable';
  name?: string;
  version?: 1 | 2;
  skills?: number;
  agent?: string;
  message?: string;
}

export interface SharedLibrary {
  getDirectory(): Promise<string | null>;
  configure(directory: unknown): Promise<string>;
  list(): Promise<{ directory: string | null; entries: SharedLibraryEntry[]; truncated: boolean }>;
  read(bundleId: string): Promise<ChainBundle>;
  publish(bundle: unknown, displayName: string): Promise<SharedLibraryEntry>;
}

export function createSharedLibrary(configStore: ConfigStore): SharedLibrary {
  return {
    async getDirectory() {
      const config = await configStore.get();
      return config.sharedBundleDirectory ?? null;
    },
    async configure(directory) {
      let canonical;
      try {
        canonical = await resolveCanonicalDirectory(directory);
      } catch (error) {
        throw new SharedLibraryError(
          SHARED_LIBRARY_ERROR_CODES.DIRECTORY_INVALID,
          'Enter an existing absolute directory that can hold shared bundle files.',
          {},
          { cause: error },
        );
      }
      await configStore.update(() => ({ sharedBundleDirectory: canonical.path }));
      return canonical.path;
    },
    async list() {
      const directory = await this.getDirectory();
      if (directory === null) return { directory: null, entries: [], truncated: false };
      const root = await resolveLibraryRoot(directory);
      let filenames: string[];
      try {
        filenames = await readdir(root);
      } catch (error) {
        throw directoryUnavailable(root, error);
      }
      const candidates = filenames.filter((filename) => filename.endsWith('.loom.json')).sort();
      const entries: SharedLibraryEntry[] = [];
      for (const filename of candidates.slice(0, MAX_LIBRARY_ENTRIES)) {
        entries.push(await inspectEntry(root, filename));
      }
      return {
        directory: root,
        entries,
        truncated: candidates.length > MAX_LIBRARY_ENTRIES,
      };
    },
    async read(bundleId) {
      assertBundleId(bundleId);
      const directory = await this.getDirectory();
      if (directory === null) {
        throw new SharedLibraryError(
          SHARED_LIBRARY_ERROR_CODES.NOT_CONFIGURED,
          'Choose a shared bundle directory before browsing or importing bundles.',
        );
      }
      const root = await resolveLibraryRoot(directory);
      const path = join(root, `${bundleId}.loom.json`);
      try {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || await realpath(path) !== path) {
          throw new SharedLibraryError(
            SHARED_LIBRARY_ERROR_CODES.BUNDLE_INVALID,
            'The selected shared bundle is not a regular file.',
          );
        }
        if (info.size > MAX_BUNDLE_REQUEST_BYTES) {
          throw new SharedLibraryError(
            SHARED_LIBRARY_ERROR_CODES.BUNDLE_TOO_LARGE,
            'The shared bundle exceeds the supported size limit.',
          );
        }
        return parseBundle(JSON.parse(await readFile(path, 'utf8')));
      } catch (error) {
        if (error instanceof SharedLibraryError) throw error;
        if (isErrno(error, 'ENOENT')) {
          throw new SharedLibraryError(
            SHARED_LIBRARY_ERROR_CODES.BUNDLE_NOT_FOUND,
            'The shared bundle is no longer available.',
            { bundleId },
          );
        }
        if (error instanceof SyntaxError) {
          throw new SharedLibraryError(
            SHARED_LIBRARY_ERROR_CODES.BUNDLE_INVALID,
            'The shared bundle contains invalid JSON.',
            { bundleId },
            { cause: error },
          );
        }
        throw error;
      }
    },
    async publish(rawBundle, displayName) {
      let bundle: ChainBundle;
      try {
        bundle = parseBundle(rawBundle);
      } catch (error) {
        throw new SharedLibraryError(
          SHARED_LIBRARY_ERROR_CODES.BUNDLE_INVALID,
          'Only a valid reviewed chain bundle can be published.',
          {},
          { cause: error },
        );
      }
      const directory = await this.getDirectory();
      if (directory === null) {
        throw new SharedLibraryError(
          SHARED_LIBRARY_ERROR_CODES.NOT_CONFIGURED,
          'Choose a shared bundle directory before publishing.',
        );
      }
      const root = await resolveLibraryRoot(directory);
      const slug = safeSlug(displayName || bundle.chain.name);
      const content = Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
      if (content.byteLength > MAX_BUNDLE_REQUEST_BYTES) {
        throw new SharedLibraryError(
          SHARED_LIBRARY_ERROR_CODES.BUNDLE_TOO_LARGE,
          'The shared bundle exceeds the supported size limit.',
        );
      }

      for (let attempt = 0; attempt < PUBLISH_ATTEMPTS; attempt += 1) {
        const id = `${slug}-${randomUUID()}`;
        const filename = `${id}.loom.json`;
        const target = join(root, filename);
        const temporary = join(root, `.loom-publish-${randomUUID()}.tmp`);
        let targetCreated = false;
        try {
          const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
          try {
            await handle.writeFile(content);
            await handle.sync();
          } finally {
            await handle.close();
          }
          await link(temporary, target);
          targetCreated = true;
          await unlink(temporary);
          await syncDirectory(root);
          return entryForBundle(id, filename, bundle);
        } catch (error) {
          await unlink(temporary).catch(() => undefined);
          if (targetCreated) await unlink(target).catch(() => undefined);
          if (isErrno(error, 'EEXIST')) continue;
          throw new SharedLibraryError(
            SHARED_LIBRARY_ERROR_CODES.PUBLISH_FAILED,
            'The bundle could not be published atomically. Check that the shared directory supports atomic hard links and is writable.',
            { directory: root },
            { cause: error },
          );
        }
      }
      throw new SharedLibraryError(
        SHARED_LIBRARY_ERROR_CODES.COLLISION,
        'A unique shared bundle filename could not be created.',
      );
    },
  };
}

async function resolveLibraryRoot(configured: string): Promise<string> {
  const root = resolve(configured);
  try {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(root) !== root) {
      throw new SharedLibraryError(
        SHARED_LIBRARY_ERROR_CODES.DIRECTORY_INVALID,
        'The configured shared bundle directory is no longer a real directory.',
        { directory: root },
      );
    }
    return root;
  } catch (error) {
    if (error instanceof SharedLibraryError) throw error;
    throw directoryUnavailable(root, error);
  }
}

async function inspectEntry(root: string, filename: string): Promise<SharedLibraryEntry> {
  const id = filename.slice(0, -'.loom.json'.length);
  const path = join(root, filename);
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || await realpath(path) !== path) {
      return { id, filename, status: 'unsafe', message: 'Not a regular file.' };
    }
    if (info.size > MAX_BUNDLE_REQUEST_BYTES) {
      return { id, filename, status: 'invalid', message: 'File exceeds the bundle size limit.' };
    }
    const bundle = parseBundle(JSON.parse(await readFile(path, 'utf8')));
    return entryForBundle(id, filename, bundle);
  } catch (error) {
    if (isErrno(error, 'EACCES') || isErrno(error, 'EPERM')) {
      return { id, filename, status: 'unreadable', message: 'File is not readable.' };
    }
    return {
      id,
      filename,
      status: 'invalid',
      message: error instanceof SyntaxError ? 'Invalid JSON.' : 'Unsupported or invalid bundle.',
    };
  }
}

function entryForBundle(
  id: string,
  filename: string,
  bundle: ChainBundle,
): SharedLibraryEntry {
  return {
    id,
    filename,
    status: 'available',
    name: bundle.chain.name,
    version: bundle.version,
    skills: bundle.skills.length,
    ...(bundle.version === 2 && bundle.chain.agent !== undefined
      ? { agent: bundle.chain.agent.name }
      : {}),
  };
}

function safeSlug(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return slug || 'chain';
}

function assertBundleId(value: string): void {
  if (!BUNDLE_ID_PATTERN.test(value) || basename(value) !== value) {
    throw new SharedLibraryError(
      SHARED_LIBRARY_ERROR_CODES.BUNDLE_NOT_FOUND,
      'The shared bundle id is invalid.',
    );
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY);
  try {
    try {
      await handle.sync();
    } catch (error) {
      // Windows does not support fsync on this directory handle.
      if (process.platform !== 'win32' || !isErrno(error, 'EPERM')) throw error;
    }
  } finally {
    await handle.close();
  }
}

function directoryUnavailable(directory: string, cause: unknown): SharedLibraryError {
  return new SharedLibraryError(
    SHARED_LIBRARY_ERROR_CODES.DIRECTORY_UNAVAILABLE,
    'The shared bundle directory is unavailable or not writable.',
    { directory },
    { cause },
  );
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
