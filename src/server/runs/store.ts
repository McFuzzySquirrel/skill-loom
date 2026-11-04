import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  stat,
  unlink,
} from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { z } from 'zod';
import {
  atomicWriteJson as writeJsonAtomically,
  resolveConfigDir,
  type AtomicWriteDependencies,
} from '../config/store.js';
import { SLAN_DIRECTORY_NAME } from '../projects/registry.js';
import {
  ACTIVE_RUN_STATUSES,
  RUN_VERSION,
  RunError,
  RunStatusSchema,
  RunUnsupportedVersionError,
  RunValidationError,
  isActiveRunStatus,
  markRunInterrupted,
  parseRun,
  parseRunDocument,
  type Run,
  type RunValidationIssue,
} from './model.js';

/** Project-local directory that holds one JSON document per run. */
export const RUNS_DIRECTORY_NAME = 'runs';

/** Extension used for every run document. */
export const RUN_FILE_EXTENSION = '.json';

/** Global pointer file that enforces EXEC-03 across every project. */
export const ACTIVE_RUN_FILE_NAME = 'active-run.json';
export const ACTIVE_RUN_POINTER_VERSION = 1;

/**
 * A run id is a single filename segment. Lowercase alphanumerics, `_`, and
 * `-` keep ids readable and make `../`, separators, NUL bytes, absolute paths,
 * URL-encoded separators, and Windows drive prefixes impossible by shape.
 */
export const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * Typed storage failures. Route code maps each code to one HTTP status; no
 * handler branches on a raw errno string or a filesystem message.
 */
export const RUN_STORE_ERROR_CODES = {
  ID_INVALID: 'RUN_ID_INVALID',
  PROJECT_INVALID: 'RUN_PROJECT_INVALID',
  PROJECT_NOT_FOUND: 'RUN_PROJECT_NOT_FOUND',
  PROJECT_NOT_DIRECTORY: 'RUN_PROJECT_NOT_DIRECTORY',
  PROJECT_UNREADABLE: 'RUN_PROJECT_UNREADABLE',
  STORE_SETUP_FAILED: 'RUN_STORE_SETUP_FAILED',
  PATH_ESCAPED: 'RUN_PATH_ESCAPED',
  NOT_FOUND: 'RUN_NOT_FOUND',
  ALREADY_EXISTS: 'RUN_ALREADY_EXISTS',
  READ_FAILED: 'RUN_READ_FAILED',
  WRITE_FAILED: 'RUN_WRITE_FAILED',
  LIST_FAILED: 'RUN_LIST_FAILED',
  FILE_CORRUPT: 'RUN_FILE_CORRUPT',
  FILE_UNREADABLE: 'RUN_FILE_UNREADABLE',
  FILE_ID_MISMATCH: 'RUN_FILE_ID_MISMATCH',
  UNSUPPORTED_VERSION: 'RUN_UNSUPPORTED_VERSION',
  ACTIVE_CONFLICT: 'RUN_ACTIVE_CONFLICT',
  ACTIVE_POINTER_CORRUPT: 'RUN_ACTIVE_POINTER_CORRUPT',
  ACTIVE_POINTER_READ_FAILED: 'RUN_ACTIVE_POINTER_READ_FAILED',
  ACTIVE_POINTER_WRITE_FAILED: 'RUN_ACTIVE_POINTER_WRITE_FAILED',
} as const;

export type RunStoreErrorCode =
  (typeof RUN_STORE_ERROR_CODES)[keyof typeof RUN_STORE_ERROR_CODES];

/**
 * List warnings use the same stable codes as read errors, so a corrupt file
 * reported by a list and then opened by id keeps one identity.
 */
export const RUN_STORE_WARNING_CODES = {
  FILE_CORRUPT: RUN_STORE_ERROR_CODES.FILE_CORRUPT,
  FILE_UNREADABLE: RUN_STORE_ERROR_CODES.FILE_UNREADABLE,
  FILE_ID_MISMATCH: RUN_STORE_ERROR_CODES.FILE_ID_MISMATCH,
  FILE_IGNORED: 'RUN_FILE_IGNORED',
  UNSUPPORTED_VERSION: RUN_STORE_ERROR_CODES.UNSUPPORTED_VERSION,
  ACTIVE_POINTER_CORRUPT: RUN_STORE_ERROR_CODES.ACTIVE_POINTER_CORRUPT,
  PROJECT_NOT_FOUND: RUN_STORE_ERROR_CODES.PROJECT_NOT_FOUND,
} as const;

export type RunStoreWarningCode =
  (typeof RUN_STORE_WARNING_CODES)[keyof typeof RUN_STORE_WARNING_CODES];

export type RunStoreErrorDetails = Record<string, unknown>;

/**
 * Typed run-storage failure. Details carry only paths, ids, stable codes, and
 * field paths; they never contain terminal output or file contents.
 */
export class RunStoreError extends Error {
  readonly code: RunStoreErrorCode;
  readonly details: RunStoreErrorDetails;

  constructor(
    code: RunStoreErrorCode,
    message: string,
    details: RunStoreErrorDetails = {},
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

/** A requested run document does not exist. Route code maps this to 404. */
export class RunNotFoundError extends RunStoreError {
  constructor(runId: string, path?: string) {
    super('RUN_NOT_FOUND', 'No run matches that id.', {
      runId,
      ...(path === undefined ? {} : { path }),
    });
  }
}

/** An id could not be a single safe filename segment. */
export class RunIdInvalidError extends RunStoreError {
  constructor(runId: unknown) {
    super('RUN_ID_INVALID', 'The run id is not a safe file name.', {
      runId: describeValue(runId),
      reason: runIdInvalidReason(runId),
    });
  }
}

/** Another run already owns the single global active-run slot. Mapped to 409. */
export class RunActiveConflictError extends RunStoreError {
  constructor(pointer: ActiveRunPointer) {
    super('RUN_ACTIVE_CONFLICT', 'Another run is already active.', {
      runId: pointer.runId,
      projectId: pointer.projectId,
      status: pointer.status,
    });
  }
}

/** A corrupt or unsupported run file surfaced as a non-blocking warning. */
export interface RunStoreWarning {
  code: RunStoreWarningCode;
  message: string;
  /** Absolute path of the offending file. */
  path: string;
  runId?: string;
  projectPath?: string;
  reason?: string;
  /** Zod/model issue paths for a schema-invalid document. */
  issues?: RunValidationIssue[];
  /** Present for an unsupported document version. */
  version?: unknown;
}

export interface RunListResult {
  /** Valid runs only, newest `updatedAt` first. */
  runs: Run[];
  /** Corrupt, unreadable, or ignored files, sorted by path. */
  warnings: RunStoreWarning[];
}

/** Recovery summary returned by the startup hook (NFR-REL-01). */
export interface RunRecoveryResult {
  /** Records durably marked interrupted by this call. */
  interrupted: Run[];
  /** True only when the global pointer was removed by this call. */
  clearedActiveRun: boolean;
  warnings: RunStoreWarning[];
}

/**
 * The single global active-run pointer. It lives in the Slan config directory
 * and stores just enough metadata for health reporting and startup recovery;
 * it never contains a prompt or terminal output.
 */
export const ActiveRunPointerSchema = z.strictObject({
  version: z.literal(ACTIVE_RUN_POINTER_VERSION),
  runId: z.string().regex(RUN_ID_PATTERN),
  projectId: z.string().trim().min(1),
  projectPath: z
    .string()
    .trim()
    .min(1)
    .refine((value) => isAbsolute(value) && !value.includes('\0'), {
      message: 'The active run project path must be an absolute path without NUL bytes.',
    }),
  status: RunStatusSchema,
  startedAt: z.iso.datetime({ offset: true }).nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type ActiveRunPointer = z.infer<typeof ActiveRunPointerSchema>;

/** Atomic write seam. The default serializes JSON through `atomicWriteRunJson`. */
export type RunFileWriter = (target: string, run: Run) => Promise<void>;

export type RealpathPath = (path: string) => Promise<string>;

export interface RunStorePathOptions {
  /** Slan config directory override. Defaults to `SLAN_CONFIG_DIR` or home. */
  configDirectory?: string;
  /** Environment source for `SLAN_CONFIG_DIR`. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Home directory seam for tests. Defaults to `os.homedir()`. */
  homeDirectory?: () => string;
}

export interface RunStoreOptions extends RunStorePathOptions {
  /**
   * Registered project directory. It is canonicalized with `realpath` before
   * any `.slan` path is derived, so a symlinked project root is handled once.
   */
  projectPath: string;
  /** Canonicalization seam for deterministic traversal tests. */
  realpathPath?: RealpathPath;
  /** Write seam for failure simulation. */
  atomicWrite?: RunFileWriter;
  /** Clock seam for recovery timestamps. */
  now?: () => Date;
}

export interface CreateRunOptions {
  /**
   * Acquire the global active-run pointer. Defaults to true for an active
   * status. Pass false only for fixtures or a deferred start.
   */
  activate?: boolean;
}

export interface UpdateRunOptions {
  /**
   * Keep the active pointer in sync with the saved run. Defaults to true:
   * active runs refresh the pointer, and terminal runs release it.
   */
  syncActiveRun?: boolean;
}

export interface RunStore {
  /** Valid runs, newest `updatedAt` first, plus corrupt-file warnings. */
  list(): Promise<RunListResult>;
  /** Read one run by safe id. A missing file raises `RUN_NOT_FOUND`. */
  read(runId: string): Promise<Run>;
  /**
   * Persist a new run. An active run also claims the global active-run slot
   * and a second active run is rejected with `RUN_ACTIVE_CONFLICT` (409).
   */
  create(run: Run, options?: CreateRunOptions): Promise<Run>;
  /** Replace an existing run document atomically and sync the active pointer. */
  update(run: Run, options?: UpdateRunOptions): Promise<Run>;
  /** Current global pointer, or null when no pointer file exists. */
  getActiveRun(): Promise<ActiveRunPointer | null>;
  /** Claim the global slot for an active run; idempotent for the same id. */
  activate(run: Run): Promise<ActiveRunPointer | null>;
  /** Release the global slot only when it points at `runId`. */
  releaseActiveRun(runId: string): Promise<boolean>;
  /** Remove the pointer regardless of its contents. Used only by recovery. */
  clearActiveRun(): Promise<boolean>;
  /**
   * Mark every record still `starting`, `running`, `paused`, or `awaiting-user`
   * as `interrupted`, then clear a stale pointer. Never replays a step.
   */
  recoverInterruptedRuns(): Promise<RunRecoveryResult>;
  /** Slan config directory that owns the active-run pointer. */
  getConfigDirectory(): string;
  /** Absolute path of the active-run pointer file. */
  getActiveRunPath(): string;
}

/** `<canonicalProject>/.slan/runs`; the input must already be canonical. */
export function runsDirectoryFor(projectPath: string): string {
  return join(projectPath, SLAN_DIRECTORY_NAME, RUNS_DIRECTORY_NAME);
}

/** `<configDirectory>/active-run.json`. */
export function activeRunPathFor(configDirectory: string): string {
  return join(configDirectory, ACTIVE_RUN_FILE_NAME);
}

/** True only for ids this store accepts as a filename segment. */
export function isSafeRunId(value: unknown): value is string {
  return typeof value === 'string' && RUN_ID_PATTERN.test(value);
}

/**
 * Reject an unsafe id before any filesystem call. The pattern excludes
 * separators, traversal segments, NUL bytes, absolute paths, and encoded
 * traversal, so the target filename can never leave the runs directory.
 */
export function assertSafeRunId(value: unknown): asserts value is string {
  if (!isSafeRunId(value)) {
    throw new RunIdInvalidError(value);
  }
}

/**
 * Write one run document atomically: same-directory temporary file, flush,
 * rename over the target, then fsync the directory. A failure removes the
 * temporary file and leaves the previous target untouched. `EXDEV` is surfaced
 * as a typed run write failure instead of a non-atomic copy fallback.
 */
export async function atomicWriteRunJson(
  target: string,
  run: Run,
  dependencies: AtomicWriteDependencies = {},
): Promise<void> {
  try {
    await writeJsonAtomically(target, run, dependencies);
  } catch (error) {
    if (error instanceof RunStoreError) {
      throw error;
    }
    throw new RunStoreError(
      RUN_STORE_ERROR_CODES.WRITE_FAILED,
      'The run file could not be written atomically.',
      { path: target, runId: run.id, reason: errorReason(error) },
      { cause: error },
    );
  }
}

/** Read the global active-run pointer without constructing a store. */
export async function readActiveRunPointerFile(
  options: RunStorePathOptions = {},
): Promise<ActiveRunPointer | null> {
  const configDirectory =
    options.configDirectory ?? resolveStoreConfigDir(options);
  return readActivePointerAt(activeRunPathFor(configDirectory));
}

/** Remove the global active-run pointer without constructing a store. */
export async function clearActiveRunPointerFile(
  options: RunStorePathOptions = {},
): Promise<boolean> {
  const configDirectory =
    options.configDirectory ?? resolveStoreConfigDir(options);
  return clearActivePointerAt(activeRunPathFor(configDirectory));
}

/**
 * Global startup recovery. Follows the active pointer to its project, marks
 * stale records interrupted, then clears the pointer. Optional known project
 * paths are scanned so records from completed work are reconciled too.
 */
export interface RunStartupRecoveryOptions extends RunStorePathOptions {
  now?: () => Date;
  realpathPath?: RealpathPath;
  atomicWrite?: RunFileWriter;
  knownProjectPaths?: readonly string[];
}

export interface RunStartupRecoveryResult {
  interrupted: Run[];
  clearedActiveRun: boolean;
  warnings: RunStoreWarning[];
  /** Projects that were scanned, in order. */
  projects: string[];
}

export async function recoverActiveRunOnStartup(
  options: RunStartupRecoveryOptions = {},
): Promise<RunStartupRecoveryResult> {
  const configDirectory =
    options.configDirectory ?? resolveStoreConfigDir(options);
  const warnings: RunStoreWarning[] = [];
  const interrupted: Run[] = [];
  const projects: string[] = [];
  const seen = new Set<string>();

  let pointer: ActiveRunPointer | null = null;
  let clearedActiveRun = false;
  try {
    pointer = await readActivePointerAt(activeRunPathFor(configDirectory));
  } catch (error) {
    if (error instanceof RunStoreError && error.code === RUN_STORE_ERROR_CODES.ACTIVE_POINTER_CORRUPT) {
      warnings.push({
        code: RUN_STORE_WARNING_CODES.ACTIVE_POINTER_CORRUPT,
        message: 'The active-run pointer was corrupt and has been removed.',
        path: activeRunPathFor(configDirectory),
        reason: 'CORRUPT',
      });
      clearedActiveRun = await clearActivePointerAt(activeRunPathFor(configDirectory));
    } else {
      throw error;
    }
  }

  const targets: string[] = [];
  if (pointer !== null) {
    targets.push(pointer.projectPath);
  }
  for (const projectPath of options.knownProjectPaths ?? []) {
    targets.push(projectPath);
  }

  for (const projectPath of targets) {
    if (seen.has(projectPath)) {
      continue;
    }
    seen.add(projectPath);
    projects.push(projectPath);

    const store = createRunStore({
      projectPath,
      configDirectory,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.realpathPath === undefined ? {} : { realpathPath: options.realpathPath }),
      ...(options.atomicWrite === undefined ? {} : { atomicWrite: options.atomicWrite }),
    });

    try {
      const result = await store.recoverInterruptedRuns();
      interrupted.push(...result.interrupted);
      warnings.push(...result.warnings);
      clearedActiveRun = clearedActiveRun || result.clearedActiveRun;
    } catch (error) {
      if (
        pointer !== null &&
        pointer.projectPath === projectPath &&
        error instanceof RunStoreError &&
        error.code === RUN_STORE_ERROR_CODES.PROJECT_NOT_FOUND
      ) {
        warnings.push({
          code: RUN_STORE_WARNING_CODES.PROJECT_NOT_FOUND,
          message: 'The project referenced by the active-run pointer no longer exists.',
          path: activeRunPathFor(configDirectory),
          runId: pointer.runId,
          projectPath,
          reason: 'PROJECT_NOT_FOUND',
        });
        clearedActiveRun = (await store.clearActiveRun()) || clearedActiveRun;
        continue;
      }
      throw error;
    }
  }

  return { interrupted, clearedActiveRun, warnings, projects };
}

type PathEntryState = 'missing' | 'file' | 'directory' | 'symlink' | 'other';

interface ResolvedRunsRoot {
  projectPath: string;
  runsDirectory: string;
  /** False when the runs directory does not exist yet and create is false. */
  exists: boolean;
}

type RunFileFailureKind =
  | 'missing'
  | 'unreadable'
  | 'corrupt'
  | 'unsupported'
  | 'id_mismatch';

interface RunFileFailure {
  kind: RunFileFailureKind;
  path: string;
  runId: string;
  reason?: string;
  issues?: RunValidationIssue[];
  version?: unknown;
}

type RunFileReadResult =
  | { ok: true; run: Run }
  | { ok: false; failure: RunFileFailure };

const pointerQueues = new Map<string, Promise<unknown>>();

/**
 * Serialize pointer reads and writes in this process. The pointer is also
 * created with an exclusive link, so a second process cannot overwrite it.
 */
function enqueuePointer<T>(path: string, task: () => Promise<T>): Promise<T> {
  const previous = pointerQueues.get(path) ?? Promise.resolve();
  const current = previous.then(task, task);
  const settled = current.then(
    () => undefined,
    () => undefined,
  );
  pointerQueues.set(path, settled);
  settled.then(() => {
    if (pointerQueues.get(path) === settled) {
      pointerQueues.delete(path);
    }
  }, () => undefined);
  return current;
}

class FileRunStore implements RunStore {
  private readonly options: RunStoreOptions;

  constructor(options: RunStoreOptions) {
    this.options = options;
  }

  getConfigDirectory(): string {
    return this.options.configDirectory ?? resolveStoreConfigDir(this.options);
  }

  getActiveRunPath(): string {
    return activeRunPathFor(this.getConfigDirectory());
  }

  async list(): Promise<RunListResult> {
    const root = await this.resolveRoot(false);
    if (!root.exists) {
      return { runs: [], warnings: [] };
    }

    let entries;
    try {
      entries = await readdir(root.runsDirectory, { withFileTypes: true });
    } catch (error) {
      if (errnoCode(error) === 'ENOENT') {
        return { runs: [], warnings: [] };
      }
      throw new RunStoreError(
        RUN_STORE_ERROR_CODES.LIST_FAILED,
        'The run directory could not be listed.',
        { path: root.runsDirectory, reason: errnoCode(error) },
        { cause: error },
      );
    }

    const runs: Run[] = [];
    const warnings: RunStoreWarning[] = [];

    for (const entry of entries) {
      // A symlink is not followed: `Dirent.isFile()` is false for it, so a run
      // file cannot be used to read outside the runs directory.
      if (!entry.isFile()) {
        continue;
      }
      if (!entry.name.endsWith(RUN_FILE_EXTENSION) || entry.name.startsWith('.')) {
        continue;
      }

      const runId = entry.name.slice(0, -RUN_FILE_EXTENSION.length);
      const path = join(root.runsDirectory, entry.name);

      if (!isSafeRunId(runId)) {
        warnings.push({
          code: RUN_STORE_WARNING_CODES.FILE_IGNORED,
          message: 'A JSON file in the run directory has an unsafe id and was ignored.',
          path,
          runId,
          reason: 'UNSAFE_ID',
        });
        continue;
      }

      const result = await this.readRunFile(path, runId);
      if (result.ok) {
        runs.push(result.run);
      } else {
        warnings.push(warningFromFailure(result.failure));
      }
    }

    runs.sort(compareRunsByUpdatedAt);
    warnings.sort((left, right) => left.path.localeCompare(right.path));
    return { runs, warnings };
  }

  async read(runId: string): Promise<Run> {
    // Validate before resolving the project: an unsafe id never reaches the
    // filesystem, even when the project path itself is invalid.
    assertSafeRunId(runId);

    const root = await this.resolveRoot(false);
    if (!root.exists) {
      throw new RunNotFoundError(runId);
    }

    const target = targetForId(root.runsDirectory, runId);
    const state = await this.inspectEntry(target);
    switch (state) {
      case 'missing':
        throw new RunNotFoundError(runId, target);
      case 'symlink':
        throw new RunStoreError(
          RUN_STORE_ERROR_CODES.PATH_ESCAPED,
          'The run file is a symbolic link and will not be followed.',
          { path: target, runId, reason: 'SYMLINK' },
        );
      case 'file':
        break;
      default:
        throw new RunStoreError(
          RUN_STORE_ERROR_CODES.READ_FAILED,
          'The run target is not a regular file.',
          { path: target, runId, reason: 'NOT_A_FILE' },
        );
    }

    const result = await this.readRunFile(target, runId);
    if (result.ok) {
      return result.run;
    }
    throw errorFromFailure(result.failure);
  }

  async create(run: Run, options: CreateRunOptions = {}): Promise<Run> {
    const validated = parseRun(run);
    assertSafeRunId(validated.id);

    const root = await this.resolveRoot(true);
    const target = targetForId(root.runsDirectory, validated.id);

    const state = await this.inspectEntry(target);
    if (state !== 'missing') {
      throw new RunStoreError(
        RUN_STORE_ERROR_CODES.ALREADY_EXISTS,
        'A run with that id already exists.',
        {
          path: target,
          runId: validated.id,
          reason: state === 'symlink' ? 'SYMLINK' : 'EXISTS',
        },
      );
    }

    await this.writeRunFile(target, validated);

    if (options.activate === false || !isActiveRunStatus(validated.status)) {
      return validated;
    }

    try {
      await this.activate(validated);
    } catch (error) {
      // A run that never claimed the active slot must not leave a record that
      // looks startable. Recovery would mark it interrupted later; remove it
      // now so the rejected request has no side effect.
      await unlink(target).catch(() => undefined);
      throw error;
    }

    return validated;
  }

  async update(run: Run, options: UpdateRunOptions = {}): Promise<Run> {
    const validated = parseRun(run);
    assertSafeRunId(validated.id);

    const root = await this.resolveRoot(false);
    if (!root.exists) {
      throw new RunNotFoundError(validated.id);
    }

    const target = targetForId(root.runsDirectory, validated.id);
    const state = await this.inspectEntry(target);
    switch (state) {
      case 'missing':
        throw new RunNotFoundError(validated.id, target);
      case 'symlink':
        throw new RunStoreError(
          RUN_STORE_ERROR_CODES.PATH_ESCAPED,
          'The run file is a symbolic link and will not be replaced.',
          { path: target, runId: validated.id, reason: 'SYMLINK' },
        );
      case 'file':
        break;
      default:
        throw new RunStoreError(
          RUN_STORE_ERROR_CODES.WRITE_FAILED,
          'The run target is not a regular file.',
          { path: target, runId: validated.id, reason: 'NOT_A_FILE' },
        );
    }

    await this.writeRunFile(target, validated);

    if (options.syncActiveRun !== false) {
      await this.syncActivePointer(validated, root.projectPath);
    }

    return validated;
  }

  async getActiveRun(): Promise<ActiveRunPointer | null> {
    return readActivePointerAt(this.getActiveRunPath());
  }

  async activate(run: Run): Promise<ActiveRunPointer | null> {
    const path = this.getActiveRunPath();
    return enqueuePointer(path, () => this.activateUnlocked(run));
  }

  async releaseActiveRun(runId: string): Promise<boolean> {
    assertSafeRunId(runId);
    const path = this.getActiveRunPath();
    return enqueuePointer(path, () => this.releaseActiveRunUnlocked(runId));
  }

  async clearActiveRun(): Promise<boolean> {
    const path = this.getActiveRunPath();
    return enqueuePointer(path, () => clearActivePointerAt(path));
  }

  async recoverInterruptedRuns(): Promise<RunRecoveryResult> {
    const root = await this.resolveRoot(false);
    const listed = root.exists ? await this.list() : { runs: [], warnings: [] as RunStoreWarning[] };
    const timestamp = this.timestamp();
    const interrupted: Run[] = [];

    for (const run of listed.runs) {
      if (!isActiveRunStatus(run.status)) {
        continue;
      }

      const record = markRunInterrupted(run, timestamp, 'SERVER_RESTART');
      const target = targetForId(root.runsDirectory, record.id);
      await this.writeRunFile(target, record);
      interrupted.push(record);
    }

    let warnings = listed.warnings;
    let clearedActiveRun = false;
    let pointer: ActiveRunPointer | null = null;

    try {
      pointer = await this.readActivePointer();
    } catch (error) {
      if (
        error instanceof RunStoreError &&
        error.code === RUN_STORE_ERROR_CODES.ACTIVE_POINTER_CORRUPT
      ) {
        warnings = [
          ...warnings,
          {
            code: RUN_STORE_WARNING_CODES.ACTIVE_POINTER_CORRUPT,
            message: 'The active-run pointer was corrupt and has been removed.',
            path: this.getActiveRunPath(),
            reason: 'CORRUPT',
          },
        ];
        clearedActiveRun = await this.clearActiveRun();
        return { interrupted, clearedActiveRun, warnings };
      }
      throw error;
    }

    if (pointer !== null) {
      const belongsHere = pointer.projectPath === root.projectPath;
      const recoveredIds = new Set(interrupted.map((run) => run.id));
      let stale = !isActiveRunStatus(pointer.status);

      if (!stale && belongsHere) {
        if (recoveredIds.has(pointer.runId)) {
          stale = true;
        } else {
          try {
            const targetRun = await this.read(pointer.runId);
            stale = !isActiveRunStatus(targetRun.status);
          } catch (error) {
            if (
              error instanceof RunStoreError &&
              isRecoverablePointerTargetError(error.code)
            ) {
              stale = true;
            } else {
              throw error;
            }
          }
        }
      }

      // Only this project may clear the pointer. A pointer owned by another
      // project is that project's recovery responsibility.
      if (belongsHere && stale) {
        clearedActiveRun = await this.clearActiveRun();
      }
    }

    return { interrupted, clearedActiveRun, warnings };
  }

  private async activateUnlocked(run: Run): Promise<ActiveRunPointer | null> {
    const validated = parseRun(run);
    assertSafeRunId(validated.id);

    if (!isActiveRunStatus(validated.status)) {
      await this.releaseActiveRunUnlocked(validated.id);
      return null;
    }

    const root = await this.resolveRoot(true);
    const target = targetForId(root.runsDirectory, validated.id);
    const state = await this.inspectEntry(target);
    if (state === 'missing') {
      throw new RunNotFoundError(validated.id, target);
    }
    if (state === 'symlink') {
      throw new RunStoreError(
        RUN_STORE_ERROR_CODES.PATH_ESCAPED,
        'The run file is a symbolic link and cannot own the active slot.',
        { path: target, runId: validated.id, reason: 'SYMLINK' },
      );
    }
    if (state !== 'file') {
      throw new RunStoreError(
        RUN_STORE_ERROR_CODES.READ_FAILED,
        'The run target is not a regular file.',
        { path: target, runId: validated.id, reason: 'NOT_A_FILE' },
      );
    }

    const pointer = pointerForRun(validated, root.projectPath);
    const pointerPath = this.getActiveRunPath();
    const created = await this.writePointerExclusive(pointerPath, pointer);
    if (created) {
      return pointer;
    }

    const existing = await this.readActivePointer();
    if (existing === null) {
      await this.writePointerAtomic(pointerPath, pointer);
      return pointer;
    }

    if (existing.runId === validated.id) {
      if (!samePointerState(existing, pointer)) {
        await this.writePointerAtomic(pointerPath, pointer);
      }
      return pointer;
    }

    if (await this.pointerOwnsActiveRun(existing, root.projectPath)) {
      throw new RunActiveConflictError(existing);
    }

    await this.writePointerAtomic(pointerPath, pointer);
    return pointer;
  }

  private async releaseActiveRunUnlocked(runId: string): Promise<boolean> {
    const pointer = await this.readActivePointer().catch((error: unknown) => {
      if (
        error instanceof RunStoreError &&
        error.code === RUN_STORE_ERROR_CODES.ACTIVE_POINTER_CORRUPT
      ) {
        return null;
      }
      throw error;
    });

    if (pointer === null || pointer.runId !== runId) {
      return false;
    }

    return clearActivePointerAt(this.getActiveRunPath());
  }

  /**
   * Keep the pointer aligned after an update. A terminal status releases the
   * slot; an active status refreshes its status and timestamp.
   */
  private async syncActivePointer(run: Run, canonicalProjectPath: string): Promise<void> {
    const path = this.getActiveRunPath();
    await enqueuePointer(path, async () => {
      let pointer: ActiveRunPointer | null;
      try {
        pointer = await this.readActivePointer();
      } catch (error) {
        if (
          error instanceof RunStoreError &&
          error.code === RUN_STORE_ERROR_CODES.ACTIVE_POINTER_CORRUPT
        ) {
          return;
        }
        throw error;
      }

      if (pointer === null || pointer.runId !== run.id) {
        return;
      }

      if (isActiveRunStatus(run.status)) {
        await this.writePointerAtomic(path, pointerForRun(run, canonicalProjectPath));
      } else {
        await this.releaseActiveRunUnlocked(run.id);
      }
    });
  }

  /**
   * Decide whether an existing pointer blocks a new activation. A pointer that
   * names this project is checked against its run document so a stale pointer
   * cannot block forever. A pointer from another project is trusted while its
   * recorded status is active.
   */
  private async pointerOwnsActiveRun(
    pointer: ActiveRunPointer,
    canonicalProjectPath: string,
  ): Promise<boolean> {
    if (!isActiveRunStatus(pointer.status)) {
      return false;
    }
    if (pointer.projectPath !== canonicalProjectPath) {
      return true;
    }

    try {
      const run = await this.read(pointer.runId);
      return isActiveRunStatus(run.status);
    } catch (error) {
      if (error instanceof RunStoreError && isRecoverablePointerTargetError(error.code)) {
        return false;
      }
      throw error;
    }
  }

  private async readActivePointer(): Promise<ActiveRunPointer | null> {
    return readActivePointerAt(this.getActiveRunPath());
  }

  /** Create the pointer atomically and exclusively; false when it exists. */
  private async writePointerExclusive(
    pointerPath: string,
    pointer: ActiveRunPointer,
  ): Promise<boolean> {
    const directory = dirname(pointerPath);
    await mkdir(directory, { recursive: true, mode: 0o700 });

    const temporary = join(
      directory,
      `.${basename(pointerPath)}.${process.pid}.${randomUUID()}.tmp`,
    );
    const body = `${JSON.stringify(pointer, null, 2)}\n`;

    let handle: FileHandle | undefined;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(body, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;

      try {
        // A hard link is atomic and refuses to clobber an existing pointer.
        await link(temporary, pointerPath);
      } catch (error) {
        if (errnoCode(error) === 'EEXIST') {
          return false;
        }
        throw error;
      }

      await syncDirectory(directory);
      return true;
    } catch (error) {
      if (error instanceof RunStoreError) {
        throw error;
      }
      throw new RunStoreError(
        RUN_STORE_ERROR_CODES.ACTIVE_POINTER_WRITE_FAILED,
        'The active-run pointer could not be created.',
        { path: pointerPath, reason: errnoCode(error) },
        { cause: error },
      );
    } finally {
      if (handle) {
        await handle.close().catch(() => undefined);
      }
      await unlink(temporary).catch(() => undefined);
    }
  }

  private async writePointerAtomic(
    pointerPath: string,
    pointer: ActiveRunPointer,
  ): Promise<void> {
    try {
      await writeJsonAtomically(pointerPath, pointer);
    } catch (error) {
      if (error instanceof RunStoreError) {
        throw error;
      }
      throw new RunStoreError(
        RUN_STORE_ERROR_CODES.ACTIVE_POINTER_WRITE_FAILED,
        'The active-run pointer could not be replaced.',
        { path: pointerPath, reason: errorReason(error) },
        { cause: error },
      );
    }
  }

  private async resolveRoot(create: boolean): Promise<ResolvedRunsRoot> {
    const canonicalProject = await canonicalizeProject(
      this.options.projectPath,
      this.options.realpathPath,
    );
    const slanDirectory = join(canonicalProject, SLAN_DIRECTORY_NAME);
    const runsDirectory = runsDirectoryFor(canonicalProject);

    const slanState = await this.inspectEntry(slanDirectory);
    assertNotSymlinkOrFile(slanState, slanDirectory, SLAN_DIRECTORY_NAME);

    const runsState =
      slanState === 'missing' ? 'missing' : await this.inspectEntry(runsDirectory);
    assertNotSymlinkOrFile(runsState, runsDirectory, RUNS_DIRECTORY_NAME);

    let exists = runsState === 'directory';
    if (!exists && create) {
      try {
        await mkdir(runsDirectory, { recursive: true, mode: 0o755 });
      } catch (error) {
        throw new RunStoreError(
          RUN_STORE_ERROR_CODES.STORE_SETUP_FAILED,
          'The project run directory could not be created.',
          { path: runsDirectory, reason: errnoCode(error) },
          { cause: error },
        );
      }
      exists = true;
    }

    if (exists) {
      // Canonicalize the directory itself and require exact equality. A
      // symlinked `.slan` or `runs` path resolves elsewhere and is rejected
      // before any run file is read or written.
      const canonical = await this.canonicalizeRunsDirectory(runsDirectory);
      if (canonical !== runsDirectory) {
        throw new RunStoreError(
          RUN_STORE_ERROR_CODES.PATH_ESCAPED,
          'The run directory resolves outside the project .slan directory.',
          {
            path: runsDirectory,
            resolvedPath: canonical,
            reason: 'SYMLINK_ESCAPE',
          },
        );
      }
    }

    return { projectPath: canonicalProject, runsDirectory, exists };
  }

  private async canonicalizeRunsDirectory(runsDirectory: string): Promise<string> {
    const realpathPath = this.options.realpathPath ?? ((path: string) => realpath(path));
    try {
      return await realpathPath(runsDirectory);
    } catch (error) {
      throw new RunStoreError(
        RUN_STORE_ERROR_CODES.STORE_SETUP_FAILED,
        'The project run directory could not be canonicalized.',
        { path: runsDirectory, reason: errnoCode(error) },
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
      throw new RunStoreError(
        RUN_STORE_ERROR_CODES.STORE_SETUP_FAILED,
        'A run storage path could not be inspected.',
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

  private async readRunFile(path: string, expectedId: string): Promise<RunFileReadResult> {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if (errnoCode(error) === 'ENOENT') {
        return { ok: false, failure: { kind: 'missing', path, runId: expectedId } };
      }
      return {
        ok: false,
        failure: {
          kind: 'unreadable',
          path,
          runId: expectedId,
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
          runId: expectedId,
          reason: 'INVALID_JSON',
        },
      };
    }

    let run: Run;
    try {
      run = parseRunDocument(decoded);
    } catch (error) {
      if (error instanceof RunUnsupportedVersionError) {
        return {
          ok: false,
          failure: {
            kind: 'unsupported',
            path,
            runId: expectedId,
            version: error.details.version,
          },
        };
      }
      if (error instanceof RunValidationError) {
        return {
          ok: false,
          failure: {
            kind: 'corrupt',
            path,
            runId: expectedId,
            reason: 'SCHEMA_INVALID',
            issues: error.issues,
          },
        };
      }
      if (error instanceof RunError) {
        return {
          ok: false,
          failure: {
            kind: 'corrupt',
            path,
            runId: expectedId,
            reason: error.code,
          },
        };
      }
      return {
        ok: false,
        failure: {
          kind: 'corrupt',
          path,
          runId: expectedId,
          reason: 'PARSE_FAILED',
        },
      };
    }

    if (run.id !== expectedId) {
      return {
        ok: false,
        failure: {
          kind: 'id_mismatch',
          path,
          runId: expectedId,
          reason: 'ID_MISMATCH',
        },
      };
    }

    return { ok: true, run };
  }

  private async writeRunFile(target: string, run: Run): Promise<void> {
    const writer = this.options.atomicWrite ?? atomicWriteRunJson;
    try {
      await writer(target, run);
    } catch (error) {
      if (error instanceof RunStoreError) {
        throw error;
      }
      throw new RunStoreError(
        RUN_STORE_ERROR_CODES.WRITE_FAILED,
        'The run file could not be written.',
        { path: target, runId: run.id, reason: errorReason(error) },
        { cause: error },
      );
    }
  }

  private timestamp(): string {
    const now = (this.options.now ?? (() => new Date()))();
    const date = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(date.getTime())) {
      throw new RunStoreError(
        RUN_STORE_ERROR_CODES.STORE_SETUP_FAILED,
        'The run clock returned an invalid date.',
      );
    }
    return date.toISOString();
  }
}

export function createRunStore(options: RunStoreOptions): RunStore {
  return new FileRunStore(options);
}

async function readActivePointerAt(path: string): Promise<ActiveRunPointer | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') {
      return null;
    }
    throw new RunStoreError(
      RUN_STORE_ERROR_CODES.ACTIVE_POINTER_READ_FAILED,
      'The active-run pointer could not be read.',
      { path, reason: errnoCode(error) },
      { cause: error },
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    throw new RunStoreError(
      RUN_STORE_ERROR_CODES.ACTIVE_POINTER_CORRUPT,
      'The active-run pointer is not valid JSON.',
      { path, reason: 'INVALID_JSON' },
    );
  }

  const parsed = ActiveRunPointerSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new RunStoreError(
      RUN_STORE_ERROR_CODES.ACTIVE_POINTER_CORRUPT,
      'The active-run pointer is not valid.',
      {
        path,
        reason: 'SCHEMA_INVALID',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.map((segment) => String(segment)).join('.'),
          code: issue.code,
          message: issue.message,
        })),
      },
    );
  }

  return parsed.data;
}

async function clearActivePointerAt(path: string): Promise<boolean> {
  try {
    await unlink(path);
    await syncDirectory(dirname(path));
    return true;
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') {
      return false;
    }
    throw new RunStoreError(
      RUN_STORE_ERROR_CODES.ACTIVE_POINTER_WRITE_FAILED,
      'The active-run pointer could not be removed.',
      { path, reason: errnoCode(error) },
      { cause: error },
    );
  }
}

function pointerForRun(run: Run, projectPath: string): ActiveRunPointer {
  return {
    version: ACTIVE_RUN_POINTER_VERSION,
    runId: run.id,
    projectId: run.projectId,
    projectPath,
    status: run.status,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
  };
}

function samePointerState(left: ActiveRunPointer, right: ActiveRunPointer): boolean {
  return (
    left.runId === right.runId &&
    left.projectId === right.projectId &&
    left.projectPath === right.projectPath &&
    left.status === right.status &&
    left.startedAt === right.startedAt &&
    left.updatedAt === right.updatedAt
  );
}

/** A pointer target that cannot prove an active run no longer blocks a start. */
function isRecoverablePointerTargetError(code: RunStoreErrorCode): boolean {
  return (
    code === RUN_STORE_ERROR_CODES.NOT_FOUND ||
    code === RUN_STORE_ERROR_CODES.READ_FAILED ||
    code === RUN_STORE_ERROR_CODES.FILE_CORRUPT ||
    code === RUN_STORE_ERROR_CODES.FILE_UNREADABLE ||
    code === RUN_STORE_ERROR_CODES.FILE_ID_MISMATCH ||
    code === RUN_STORE_ERROR_CODES.UNSUPPORTED_VERSION ||
    code === RUN_STORE_ERROR_CODES.PROJECT_NOT_FOUND
  );
}

/**
 * Resolve the Slan config directory without passing undefined values through
 * an exact-optional-property boundary.
 */
function resolveStoreConfigDir(options: RunStorePathOptions): string {
  return resolveConfigDir({
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.homeDirectory === undefined ? {} : { homeDirectory: options.homeDirectory }),
  });
}

/**
 * Canonicalize the project directory before deriving `.slan/runs`. The project
 * is never created here: a missing project is a typed 404 candidate, not an
 * invitation to scaffold the user's filesystem.
 */
async function canonicalizeProject(
  projectPath: unknown,
  realpathPath: RealpathPath | undefined,
): Promise<string> {
  if (typeof projectPath !== 'string' || projectPath.trim() === '') {
    throw new RunStoreError(
      RUN_STORE_ERROR_CODES.PROJECT_INVALID,
      'A project directory is required.',
      { reason: 'REQUIRED' },
    );
  }
  if (projectPath.includes('\0') || !isAbsolute(projectPath)) {
    throw new RunStoreError(
      RUN_STORE_ERROR_CODES.PROJECT_INVALID,
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
    throw projectErrorFromFs(error, projectPath, RUN_STORE_ERROR_CODES.PROJECT_NOT_FOUND);
  }

  if (!isAbsolute(canonical) || canonical.includes('\0')) {
    throw new RunStoreError(
      RUN_STORE_ERROR_CODES.PROJECT_INVALID,
      'The project directory did not resolve to a canonical absolute path.',
      { path: projectPath, resolvedPath: describeValue(canonical), reason: 'NON_CANONICAL' },
    );
  }

  let stats: Stats;
  try {
    stats = await stat(canonical);
  } catch (error) {
    throw projectErrorFromFs(error, canonical, RUN_STORE_ERROR_CODES.PROJECT_UNREADABLE);
  }

  if (!stats.isDirectory()) {
    throw new RunStoreError(
      RUN_STORE_ERROR_CODES.PROJECT_NOT_DIRECTORY,
      'The project path is not a directory.',
      { path: canonical },
    );
  }

  try {
    await access(canonical, constants.R_OK | constants.X_OK);
  } catch (error) {
    throw projectErrorFromFs(error, canonical, RUN_STORE_ERROR_CODES.PROJECT_UNREADABLE);
  }

  return canonical;
}

function targetForId(runsDirectory: string, runId: string): string {
  const target = join(runsDirectory, `${runId}${RUN_FILE_EXTENSION}`);
  if (dirname(target) !== runsDirectory) {
    // Defense in depth: the id pattern already excludes separators. This guard
    // keeps the containment invariant true if the pattern is ever loosened.
    throw new RunIdInvalidError(runId);
  }
  return target;
}

function assertNotSymlinkOrFile(
  state: PathEntryState,
  path: string,
  name: string,
): void {
  if (state === 'symlink') {
    throw new RunStoreError(
      RUN_STORE_ERROR_CODES.PATH_ESCAPED,
      'A run storage path is a symbolic link and will not be followed.',
      { path, name, reason: 'SYMLINK' },
    );
  }
  if (state === 'file' || state === 'other') {
    throw new RunStoreError(
      RUN_STORE_ERROR_CODES.STORE_SETUP_FAILED,
      'A run storage path is not a directory.',
      { path, name, reason: 'NOT_DIRECTORY' },
    );
  }
}

function warningFromFailure(failure: RunFileFailure): RunStoreWarning {
  switch (failure.kind) {
    case 'unsupported':
      return {
        code: RUN_STORE_WARNING_CODES.UNSUPPORTED_VERSION,
        message: 'A run file uses an unsupported version and was not listed.',
        path: failure.path,
        runId: failure.runId,
        ...(failure.version === undefined ? {} : { version: failure.version }),
      };
    case 'unreadable':
      return {
        code: RUN_STORE_WARNING_CODES.FILE_UNREADABLE,
        message: 'A run file could not be read and was not listed.',
        path: failure.path,
        runId: failure.runId,
        ...(failure.reason === undefined ? {} : { reason: failure.reason }),
      };
    case 'id_mismatch':
      return {
        code: RUN_STORE_WARNING_CODES.FILE_ID_MISMATCH,
        message: 'A run file id does not match its filename and was not listed.',
        path: failure.path,
        runId: failure.runId,
        reason: failure.reason ?? 'ID_MISMATCH',
      };
    case 'missing':
      return {
        code: RUN_STORE_WARNING_CODES.FILE_UNREADABLE,
        message: 'A run file disappeared while the directory was listed.',
        path: failure.path,
        runId: failure.runId,
        reason: 'ENOENT',
      };
    case 'corrupt':
    default:
      return {
        code: RUN_STORE_WARNING_CODES.FILE_CORRUPT,
        message: 'A run file is corrupt and was not listed.',
        path: failure.path,
        runId: failure.runId,
        ...(failure.reason === undefined ? {} : { reason: failure.reason }),
        ...(failure.issues === undefined ? {} : { issues: failure.issues }),
      };
  }
}

function errorFromFailure(failure: RunFileFailure): RunStoreError {
  const details: RunStoreErrorDetails = {
    path: failure.path,
    runId: failure.runId,
    ...(failure.reason === undefined ? {} : { reason: failure.reason }),
    ...(failure.issues === undefined ? {} : { issues: failure.issues }),
    ...(failure.version === undefined ? {} : { version: failure.version }),
  };

  switch (failure.kind) {
    case 'missing':
      return new RunNotFoundError(failure.runId, failure.path);
    case 'unsupported':
      return new RunStoreError(
        RUN_STORE_ERROR_CODES.UNSUPPORTED_VERSION,
        'The run file uses an unsupported version.',
        details,
      );
    case 'id_mismatch':
      return new RunStoreError(
        RUN_STORE_ERROR_CODES.FILE_ID_MISMATCH,
        'The run file id does not match its filename.',
        details,
      );
    case 'unreadable':
      return new RunStoreError(
        RUN_STORE_ERROR_CODES.FILE_UNREADABLE,
        'The run file could not be read.',
        details,
      );
    case 'corrupt':
    default:
      return new RunStoreError(
        RUN_STORE_ERROR_CODES.FILE_CORRUPT,
        'The run file is corrupt and was not loaded.',
        details,
      );
  }
}

/**
 * Order by `updatedAt` descending. Ties fall back to `createdAt` descending and
 * then id ascending so repeated lists are deterministic across filesystems.
 */
function compareRunsByUpdatedAt(left: Run, right: Run): number {
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
  fallback: RunStoreErrorCode,
): RunStoreError {
  const reason = errnoCode(error);
  switch (reason) {
    case 'ENOENT':
      return new RunStoreError(
        RUN_STORE_ERROR_CODES.PROJECT_NOT_FOUND,
        'The project directory does not exist.',
        { path, reason },
        { cause: error },
      );
    case 'ENOTDIR':
      return new RunStoreError(
        RUN_STORE_ERROR_CODES.PROJECT_NOT_DIRECTORY,
        'The project path is not a directory.',
        { path, reason },
        { cause: error },
      );
    case 'EACCES':
    case 'EPERM':
      return new RunStoreError(
        RUN_STORE_ERROR_CODES.PROJECT_UNREADABLE,
        'The project directory cannot be read.',
        { path, reason },
        { cause: error },
      );
    default:
      return new RunStoreError(
        fallback,
        'The project directory could not be resolved.',
        { path, reason },
        { cause: error },
      );
  }
}

function runIdInvalidReason(value: unknown): string {
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

async function syncDirectory(directory: string): Promise<void> {
  // Directory fsync is unsupported on some platforms; ignore the documented
  // benign errno values instead of failing an already-completed link.
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } catch (error) {
    const code = errnoCode(error);
    if (code !== 'EINVAL' && code !== 'EISDIR' && code !== 'EPERM' && code !== 'ENOTSUP') {
      throw error;
    }
  } finally {
    await handle.close();
  }
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

/** Re-exported so callers can build a pointer-shaped diagnostic safely. */
export type { Run, RunValidationIssue };
