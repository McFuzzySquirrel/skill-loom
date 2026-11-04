import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  link,
  lstat,
  mkdir,
  readdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { ConfigStore } from '../config/store.js';
import type { RecentProject } from '../config/schema.js';
import {
  EXISTS_MODE,
  resolveCanonicalDirectory,
  type CanonicalDirectory,
} from './paths.js';

/** Relative directory holding every project-local Skill Loom file. */
export const LOOM_DIRECTORY_NAME = '.loom';

/** Ignore file created exactly once per project. */
export const LOOM_GITIGNORE_NAME = '.gitignore';

/**
 * The only rule Skill Loom itself needs ignored. `runs/` holds noisy per-run records
 * that must never be committed; chains stay tracked because they are recipes.
 */
export const LOOM_GITIGNORE_CONTENT = 'runs/\n';

/** Safety cap for one project name, matching common filesystem limits. */
export const MAX_PROJECT_NAME_LENGTH = 255;

/** Stable, traversal-safe ids are `<slug>-<12 hex characters>`. */
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}-[0-9a-f]{12}$/;

/**
 * Typed project failures. The route maps each code to one HTTP status; no
 * handler branches on raw errno strings or filesystem messages.
 */
export const PROJECT_ERROR_CODES = {
  CREATE_TARGET_EXISTS: 'PROJECT_CREATE_TARGET_EXISTS',
  CREATE_FAILED: 'PROJECT_CREATE_FAILED',
  NAME_INVALID: 'PROJECT_NAME_INVALID',
  ID_INVALID: 'PROJECT_ID_INVALID',
  PARENT_NOT_FOUND: 'PROJECT_PARENT_NOT_FOUND',
  PARENT_NOT_DIRECTORY: 'PROJECT_PARENT_NOT_DIRECTORY',
  PARENT_UNREADABLE: 'PROJECT_PARENT_UNREADABLE',
  RECENT_NOT_FOUND: 'RECENT_PROJECT_NOT_FOUND',
  LOOM_SETUP_FAILED: 'PROJECT_LOOM_SETUP_FAILED',
  GIT_UNAVAILABLE: 'GIT_UNAVAILABLE',
  GIT_INIT_FAILED: 'GIT_INIT_FAILED',
} as const;

export type ProjectErrorCode =
  (typeof PROJECT_ERROR_CODES)[keyof typeof PROJECT_ERROR_CODES];

export type ProjectErrorDetails = Record<string, unknown>;

/** Typed registry failure; details only carry paths, ids, and reason codes. */
export class ProjectRegistryError extends Error {
  readonly code: ProjectErrorCode;
  readonly details: ProjectErrorDetails;

  constructor(
    code: ProjectErrorCode,
    message: string,
    details: ProjectErrorDetails = {},
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

/** Run `git init` in a directory without a shell. Injected in tests. */
export type GitInitRunner = (directory: string) => Promise<void>;

/** State of the project's `.loom` directory after registration. */
export interface ProjectLoomState {
  /** Absolute `<project>/.loom` directory. */
  directory: string;
  /** True only when this call created `.loom/.gitignore`. */
  gitignoreCreated: boolean;
  /** Number of chain JSON files already present under `.loom/chains`. */
  chainCount: number;
  /** Convenience flag for the UI; true when `chainCount > 0`. */
  hasChains: boolean;
}

/** The registered project returned by open and create. */
export interface ProjectRegistration {
  /** Stable id derived from the canonical path. */
  id: string;
  /** Canonical path returned by `realpath`. */
  canonicalPath: string;
  /** Folder basename used as the human-readable name. */
  displayName: string;
  /** ISO timestamp of this registration. */
  lastOpenedAt: string;
  /** A `.git` marker exists after registration. */
  isGitRepo: boolean;
  /** True only when this call ran a successful `git init`. */
  gitInitialized: boolean;
  loom: ProjectLoomState;
}

export interface CreateProjectInput {
  /** Existing, readable parent directory; canonicalized before use. */
  parentPath: string;
  /** Single path segment for the new empty directory. */
  name: string;
  /** Run `git init` after creating the directory. Defaults to false. */
  gitInit?: boolean;
}

export interface ProjectRegistryOptions {
  /** Global configuration store that owns the recent-project list. */
  configStore: ConfigStore;
  /** Git initializer seam. Defaults to `git init` with an argument array. */
  gitInit?: GitInitRunner;
  /** Clock seam for deterministic timestamps in tests. */
  now?: () => Date;
}

export interface ProjectRegistry {
  openProject(path: string): Promise<ProjectRegistration>;
  createProject(input: CreateProjectInput): Promise<ProjectRegistration>;
  /** Recent projects, newest first. */
  listRecentProjects(): Promise<RecentProject[]>;
  /** Remove one recent entry. Never touches the project filesystem. */
  removeRecentProject(projectId: string): Promise<{ projectId: string; removed: true }>;
  /** Look up a recent entry without touching the filesystem. */
  findRecentProject(projectId: string): Promise<RecentProject | undefined>;
}

/**
 * Derive a stable project id from the canonical path alone. The slug keeps
 * logs and URLs readable; the digest makes the id collision-resistant and
 * independent of the current display name or registration order.
 */
export function projectIdForPath(canonicalPath: string): string {
  const digest = createHash('sha256').update(canonicalPath, 'utf8').digest('hex').slice(0, 12);
  return `${projectSlug(canonicalPath)}-${digest}`;
}

/** True only for ids this registry can have produced. */
export function isProjectId(value: string): boolean {
  return PROJECT_ID_PATTERN.test(value);
}

/** Human-readable name from the canonical path; root falls back to itself. */
export function projectDisplayName(canonicalPath: string): string {
  return basename(canonicalPath) || canonicalPath;
}

/**
 * Default `git init` runner. It spawns an executable plus an argument array
 * with `shell: false`, so no user-controlled string can become a shell command.
 */
export async function runGitInit(directory: string): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn('git', ['init'], {
      cwd: directory,
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: process.env,
    });

    let settled = false;
    let stderr = '';
    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        rejectPromise(error);
      } else {
        resolvePromise();
      }
    };

    child.stderr?.on('data', (chunk: Buffer | string) => {
      // Keep a bounded diagnostic. It is never persisted or returned verbatim.
      if (stderr.length < 4_096) {
        stderr += chunk.toString();
      }
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (code === 0) {
        finish();
        return;
      }
      finish(
        Object.assign(new Error(`git init exited with code ${String(code)}`), {
          code: 'GIT_INIT_EXIT',
          exitCode: code ?? -1,
          stderr,
        }),
      );
    });
  });
}

class FileProjectRegistry implements ProjectRegistry {
  private readonly options: ProjectRegistryOptions;

  constructor(options: ProjectRegistryOptions) {
    this.options = options;
  }

  async openProject(path: string): Promise<ProjectRegistration> {
    const canonical = await resolveCanonicalDirectory(path);
    return this.register(canonical.path, false);
  }

  async createProject(input: CreateProjectInput): Promise<ProjectRegistration> {
    const name = validateProjectName(input.name);
    const parent = await resolveCanonicalDirectory(input.parentPath);
    const target = join(parent.path, name);

    await assertTargetDoesNotExist(target);
    await createDirectory(target);

    // Re-resolve so the registered path is canonical even if another process
    // raced us or the filesystem returned a non-normalized path.
    const canonical = await resolveCanonicalDirectory(target);

    let gitInitialized = false;
    if (input.gitInit === true) {
      await this.initializeGit(canonical.path);
      gitInitialized = true;
    }

    return this.register(canonical.path, gitInitialized);
  }

  async listRecentProjects(): Promise<RecentProject[]> {
    const config = await this.options.configStore.get();
    return [...config.recentProjects].sort(compareRecentProjects);
  }

  async removeRecentProject(
    projectId: string,
  ): Promise<{ projectId: string; removed: true }> {
    assertProjectId(projectId);

    let removed = false;
    await this.options.configStore.update((current) => {
      const remaining = current.recentProjects.filter((entry) => entry.id !== projectId);
      removed = remaining.length !== current.recentProjects.length;
      return { recentProjects: remaining };
    });

    if (!removed) {
      throw new ProjectRegistryError(
        PROJECT_ERROR_CODES.RECENT_NOT_FOUND,
        'No recent project matches that id.',
        { projectId },
      );
    }

    return { projectId, removed: true };
  }

  async findRecentProject(projectId: string): Promise<RecentProject | undefined> {
    if (!isProjectId(projectId)) {
      return undefined;
    }
    const config = await this.options.configStore.get();
    return config.recentProjects.find((entry) => entry.id === projectId);
  }

  private async register(
    canonicalPath: string,
    gitInitialized: boolean,
  ): Promise<ProjectRegistration> {
    const id = projectIdForPath(canonicalPath);
    const displayName = projectDisplayName(canonicalPath);
    const loom = await ensureLoomData(canonicalPath);
    const isGitRepo = await pathExists(join(canonicalPath, '.git'));
    const lastOpenedAt = this.timestamp();

    await this.options.configStore.update((current) => {
      const withoutDuplicate = current.recentProjects.filter(
        (entry) => entry.id !== id && entry.canonicalPath !== canonicalPath,
      );
      return {
        recentProjects: [
          { id, canonicalPath, displayName, lastOpenedAt },
          ...withoutDuplicate,
        ],
      };
    });

    return {
      id,
      canonicalPath,
      displayName,
      lastOpenedAt,
      isGitRepo,
      gitInitialized,
      loom,
    };
  }

  private timestamp(): string {
    const now = (this.options.now ?? (() => new Date()))();
    const date = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(date.getTime())) {
      throw new ProjectRegistryError(
        PROJECT_ERROR_CODES.LOOM_SETUP_FAILED,
        'The project clock returned an invalid date.',
      );
    }
    return date.toISOString();
  }

  private async initializeGit(directory: string): Promise<void> {
    const run = this.options.gitInit ?? runGitInit;
    try {
      await run(directory);
    } catch (error) {
      const reason = errnoCode(error);
      if (reason === 'ENOENT') {
        throw new ProjectRegistryError(
          PROJECT_ERROR_CODES.GIT_UNAVAILABLE,
          'git is not installed or not available on PATH.',
          { path: directory, reason },
          { cause: error },
        );
      }

      const details: ProjectErrorDetails = { path: directory };
      if (reason !== 'UNKNOWN') {
        details.reason = reason;
      }
      const exitCode = numericField(error, 'exitCode');
      if (exitCode !== undefined) {
        details.exitCode = exitCode;
      }
      throw new ProjectRegistryError(
        PROJECT_ERROR_CODES.GIT_INIT_FAILED,
        'git init failed; the project folder was created without a repository.',
        details,
        { cause: error },
      );
    }
  }
}

export function createProjectRegistry(options: ProjectRegistryOptions): ProjectRegistry {
  return new FileProjectRegistry(options);
}

/**
 * Create `.loom` and its ignore file exactly once. An existing `.gitignore` is
 * never rewritten, and no `chains/` or `runs/` directory is created here.
 */
export async function ensureLoomData(projectPath: string): Promise<ProjectLoomState> {
  const directory = join(projectPath, LOOM_DIRECTORY_NAME);

  try {
    await mkdir(directory, { recursive: true, mode: 0o755 });
    const gitignoreCreated = await createGitignoreIfAbsent(directory);
    const chainCount = await countExistingChains(join(directory, 'chains'));

    return {
      directory,
      gitignoreCreated,
      chainCount,
      hasChains: chainCount > 0,
    };
  } catch (error) {
    if (error instanceof ProjectRegistryError) {
      throw error;
    }
    throw new ProjectRegistryError(
      PROJECT_ERROR_CODES.LOOM_SETUP_FAILED,
      'The project .loom directory could not be prepared.',
      { path: directory, reason: errnoCode(error) },
      { cause: error },
    );
  }
}

async function createGitignoreIfAbsent(directory: string): Promise<boolean> {
  const target = join(directory, LOOM_GITIGNORE_NAME);
  const temporary = join(
    directory,
    `.${LOOM_GITIGNORE_NAME}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(temporary, LOOM_GITIGNORE_CONTENT, {
      encoding: 'utf8',
      mode: 0o644,
      flag: 'wx',
    });

    try {
      // A hard link is atomic and refuses to clobber an existing ignore file,
      // unlike rename. Both paths live in the same directory.
      await link(temporary, target);
      return true;
    } catch (error) {
      if (errnoCode(error) === 'EEXIST') {
        return false;
      }
      throw error;
    }
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function countExistingChains(chainsDirectory: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(chainsDirectory, { withFileTypes: true });
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') {
      return 0;
    }
    throw error;
  }

  return entries.filter(
    (entry) => entry.isFile() && entry.name.endsWith('.json') && isSafeEntryName(entry.name),
  ).length;
}

function validateProjectName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ProjectRegistryError(
      PROJECT_ERROR_CODES.NAME_INVALID,
      'A project folder name is required.',
      { reason: 'REQUIRED' },
    );
  }

  const name = value;
  let reason: string | undefined;
  if (name.trim() === '') {
    reason = 'REQUIRED';
  } else if (name !== name.trim()) {
    reason = 'SURROUNDING_WHITESPACE';
  } else if (name.length > MAX_PROJECT_NAME_LENGTH) {
    reason = 'TOO_LONG';
  } else if (name === '.' || name === '..') {
    reason = 'RESERVED';
  } else if (
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0')
  ) {
    reason = 'SEPARATOR';
  }

  if (reason !== undefined) {
    throw new ProjectRegistryError(
      PROJECT_ERROR_CODES.NAME_INVALID,
      'The project folder name is not a single safe path segment.',
      { name, reason },
    );
  }

  return name;
}

async function assertTargetDoesNotExist(target: string): Promise<void> {
  try {
    await lstat(target);
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') {
      return;
    }
    throw new ProjectRegistryError(
      PROJECT_ERROR_CODES.CREATE_FAILED,
      'The project target could not be inspected.',
      { path: target, reason: errnoCode(error) },
      { cause: error },
    );
  }

  throw new ProjectRegistryError(
    PROJECT_ERROR_CODES.CREATE_TARGET_EXISTS,
    'The project folder already exists; open it instead.',
    { path: target },
  );
}

async function createDirectory(target: string): Promise<void> {
  try {
    await mkdir(target, { mode: 0o755 });
  } catch (error) {
    const reason = errnoCode(error);
    if (reason === 'EEXIST') {
      throw new ProjectRegistryError(
        PROJECT_ERROR_CODES.CREATE_TARGET_EXISTS,
        'The project folder already exists; open it instead.',
        { path: target },
      );
    }
    if (reason === 'ENOENT') {
      throw new ProjectRegistryError(
        PROJECT_ERROR_CODES.PARENT_NOT_FOUND,
        'The selected parent directory no longer exists.',
        { path: target, reason },
      );
    }
    if (reason === 'ENOTDIR') {
      throw new ProjectRegistryError(
        PROJECT_ERROR_CODES.PARENT_NOT_DIRECTORY,
        'The selected parent is not a directory.',
        { path: target, reason },
      );
    }
    if (reason === 'EACCES' || reason === 'EPERM') {
      throw new ProjectRegistryError(
        PROJECT_ERROR_CODES.PARENT_UNREADABLE,
        'The selected parent directory is not writable.',
        { path: target, reason },
      );
    }
    throw new ProjectRegistryError(
      PROJECT_ERROR_CODES.CREATE_FAILED,
      'The project folder could not be created.',
      { path: target, reason },
      { cause: error },
    );
  }
}

function assertProjectId(projectId: unknown): asserts projectId is string {
  if (typeof projectId !== 'string' || !isProjectId(projectId)) {
    throw new ProjectRegistryError(
      PROJECT_ERROR_CODES.ID_INVALID,
      'The project id is not valid.',
      { projectId: typeof projectId === 'string' ? projectId : String(projectId) },
    );
  }
}

function projectSlug(canonicalPath: string): string {
  const name = basename(canonicalPath);
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  return slug === '' ? 'project' : slug;
}

function compareRecentProjects(a: RecentProject, b: RecentProject): number {
  const left = Date.parse(a.lastOpenedAt);
  const right = Date.parse(b.lastOpenedAt);
  if (Number.isNaN(left) || Number.isNaN(right) || left === right) {
    // Array order is already newest-first; a stable sort keeps it on ties.
    return 0;
  }
  return right - left;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target, EXISTS_MODE);
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

function errnoCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') {
      return code;
    }
  }
  return 'UNKNOWN';
}

function numericField(value: unknown, key: string): number | undefined {
  if (typeof value === 'object' && value !== null && key in value) {
    const field = (value as Record<string, unknown>)[key];
    if (typeof field === 'number' && Number.isFinite(field)) {
      return field;
    }
  }
  return undefined;
}

/** Re-exported for callers that only need the canonical directory shape. */
export type { CanonicalDirectory };
