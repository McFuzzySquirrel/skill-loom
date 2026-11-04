import { spawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import {
  CATALOG_ERROR_CODES,
  CATALOG_WARNING_CODES,
  CatalogError,
  compareSkillEntries,
  createSkillId,
  type CatalogWarning,
  type CatalogWarningCode,
  type SkillDiscoveryResult,
  type SkillEntry,
  type SkillSource,
} from './types.js';

/**
 * Copilot CLI catalog adapter.
 *
 * Copilot exposes installed skills through `copilot skill list --json`. The
 * adapter never locates skill directories itself, never reads credential
 * files, and never treats a broken command as an empty catalog. Every command
 * failure becomes a warning entry so the catalog can show an error state next
 * to any entries that were still discovered.
 */

export const COPILOT_HARNESS = 'copilot' as const;

/** Default executable name. Slan config can override it through `executable`. */
export const COPILOT_EXECUTABLE = 'copilot';

/** Exact argument array for discovery. Never joined into a shell string. */
export const COPILOT_DISCOVERY_ARGS = ['skill', 'list', '--json'] as const;

/**
 * Discovery is metadata-only and must stay well inside the catalog request
 * budget. The bound is also applied to an injected runner by the adapter.
 */
export const DEFAULT_COPILOT_TIMEOUT_MS = 3_000;

/** Hard bounds accepted for a caller-supplied timeout. */
export const MIN_COPILOT_TIMEOUT_MS = 100;
export const MAX_COPILOT_TIMEOUT_MS = 60_000;

/** Per-stream capture cap for the default runner. */
export const MAX_COPILOT_CAPTURE_BYTES = 4 * 1024 * 1024;

/** The documented Copilot source labels. Any other label is unknown. */
export const COPILOT_SOURCE_LABELS = [
  'project',
  'personal',
  'plugin',
  'custom',
  'builtin',
] as const satisfies readonly SkillSource[];

/** One shell-free command request handed to an injected runner. */
export interface CopilotCommandRequest {
  /** Executable name or absolute path resolved by the caller. */
  executable: string;
  /** Argument array; the adapter never supplies a command string. */
  args: readonly string[];
  /** Canonical project directory used as the child process cwd. */
  cwd: string;
  /** Hard timeout in milliseconds. */
  timeoutMs: number;
}

/**
 * Captured outcome of one discovery command.
 *
 * A runner reports spawn failures through `errorCode` (for example `ENOENT`)
 * and a timeout through `timedOut`; it does not need to throw. A thrown error
 * is still handled defensively by the adapter.
 */
export interface CopilotCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Errno-style spawn failure such as `ENOENT` or `EACCES`. */
  errorCode?: string;
  /** Termination signal reported by the child process, if any. */
  signal?: NodeJS.Signals | null;
}

/**
 * Injection seam for command execution. Unit tests supply a deterministic
 * runner and never depend on an installed Copilot CLI.
 */
export type CopilotCommandRunner = (
  request: CopilotCommandRequest,
) => Promise<CopilotCommandResult>;

export interface CopilotScanOptions {
  /** Absolute project directory. It also becomes the child process cwd. */
  projectPath: string;
  /** Executable override from Slan config. Defaults to `copilot`. */
  executable?: string;
  /** Command timeout. Defaults to `DEFAULT_COPILOT_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Injected command runner. Defaults to the real spawn-based runner. */
  runner?: CopilotCommandRunner;
}

/** Build the exact executable/argument pair for discovery. */
export function buildCopilotDiscoveryCommand(executable = COPILOT_EXECUTABLE): {
  executable: string;
  args: string[];
} {
  return {
    executable: normalizeExecutable(executable),
    args: [...COPILOT_DISCOVERY_ARGS],
  };
}

/**
 * Discover Copilot skills through the CLI.
 *
 * The returned warnings are meaningful state: a command failure yields an
 * empty `entries` array *with* one or more warnings, which is distinct from a
 * successful empty catalog. Malformed individual entries are skipped with a
 * warning while every valid sibling entry is retained.
 */
export async function scanCopilotSkills(
  options: CopilotScanOptions,
): Promise<SkillDiscoveryResult> {
  const projectPath = await resolveProjectDirectory(options.projectPath);
  const executable = normalizeExecutable(options.executable);
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const runner = options.runner ?? runCopilotCommand;
  const command = formatCommand(executable);

  const request: CopilotCommandRequest = {
    executable,
    args: [...COPILOT_DISCOVERY_ARGS],
    cwd: projectPath,
    timeoutMs,
  };

  const warnings: CatalogWarning[] = [];
  const outcome = await runBounded(runner, request, timeoutMs);

  if (outcome.timedOut) {
    warnings.push(timeoutWarning(projectPath, command, timeoutMs));
    return { entries: [], warnings };
  }

  const result = outcome.result;

  if (result.timedOut) {
    warnings.push(timeoutWarning(projectPath, command, timeoutMs));
    return { entries: [], warnings };
  }

  if (result.errorCode !== undefined && result.errorCode !== '') {
    const unavailable = isMissingExecutable(result.errorCode);
    warnings.push(
      commandWarning({
        code: unavailable
          ? CATALOG_WARNING_CODES.COMMAND_UNAVAILABLE
          : CATALOG_WARNING_CODES.COMMAND_FAILED,
        message: unavailable
          ? `Copilot discovery could not start because the "${executable}" executable was not found.`
          : `Copilot discovery could not start (${result.errorCode}).`,
        projectPath,
        command,
        reason: result.errorCode,
        stderr: result.stderr,
      }),
    );
    return { entries: [], warnings };
  }

  if (result.exitCode !== 0) {
    warnings.push(
      commandWarning({
        code: CATALOG_WARNING_CODES.COMMAND_FAILED,
        message: commandFailureMessage(executable, result.exitCode, result.signal),
        projectPath,
        command,
        exitCode: result.exitCode,
        reason:
          result.exitCode === null
            ? `SIGNAL_${result.signal ?? 'UNKNOWN'}`
            : `EXIT_${String(result.exitCode)}`,
        stderr: result.stderr,
      }),
    );
    return { entries: [], warnings };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    warnings.push(
      commandWarning({
        code: CATALOG_WARNING_CODES.OUTPUT_INVALID,
        message: `Copilot discovery returned invalid JSON from "${command}"; no entries were read.`,
        projectPath,
        command,
        exitCode: result.exitCode,
        reason: 'JSON_INVALID',
      }),
    );
    return { entries: [], warnings };
  }

  if (!Array.isArray(parsed)) {
    warnings.push(
      commandWarning({
        code: CATALOG_WARNING_CODES.OUTPUT_INVALID,
        message: `Copilot discovery returned JSON that is not an array from "${command}"; no entries were read.`,
        projectPath,
        command,
        exitCode: result.exitCode,
        reason: 'OUTPUT_NOT_ARRAY',
      }),
    );
    return { entries: [], warnings };
  }

  const entries: SkillEntry[] = [];
  for (const raw of parsed) {
    const entry = await normalizeEntry(raw, projectPath, warnings);
    if (entry) {
      entries.push(entry);
    }
  }

  entries.sort(compareSkillEntries);
  return { entries, warnings };
}

/**
 * Default runner. It spawns an executable plus an argument array with
 * `shell: false`, captures bounded stdout/stderr, and enforces the timeout by
 * terminating and then killing the child.
 */
export const runCopilotCommand: CopilotCommandRunner = (request) =>
  new Promise<CopilotCommandResult>((resolvePromise) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let killHandle: NodeJS.Timeout | undefined;

    const finish = (result: CopilotCommandResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      if (killHandle !== undefined) {
        clearTimeout(killHandle);
      }
      resolvePromise(result);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(request.executable, [...request.args], {
        cwd: request.cwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });
    } catch (error) {
      resolvePromise({
        exitCode: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        errorCode: errnoCode(error),
      });
      return;
    }

    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (stdout.length < MAX_COPILOT_CAPTURE_BYTES) {
        stdout += chunk.toString();
      }
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      if (stderr.length < MAX_COPILOT_CAPTURE_BYTES) {
        stderr += chunk.toString();
      }
    });

    timeoutHandle = setTimeout(() => {
      if (settled) {
        return;
      }
      timedOut = true;
      child.kill('SIGTERM');
      killHandle = setTimeout(() => {
        if (!settled) {
          child.kill('SIGKILL');
        }
      }, 250);
      killHandle.unref();
    }, request.timeoutMs);
    timeoutHandle.unref();

    child.on('error', (error) => {
      finish({
        exitCode: null,
        stdout,
        stderr,
        timedOut,
        errorCode: errnoCode(error),
      });
    });

    child.on('close', (exitCode, signal) => {
      finish({
        exitCode,
        stdout,
        stderr,
        timedOut,
        signal: signal ?? null,
      });
    });
  });

async function normalizeEntry(
  raw: unknown,
  projectPath: string,
  warnings: CatalogWarning[],
): Promise<SkillEntry | undefined> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    warnings.push(
      entryWarning(
        CATALOG_WARNING_CODES.ENTRY_INVALID,
        'Copilot returned a catalog entry that is not an object; it was skipped.',
        projectPath,
        'ENTRY_NOT_OBJECT',
      ),
    );
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  const source = normalizeSource(record['source']);
  if (source === undefined) {
    warnings.push(
      entryWarning(
        CATALOG_WARNING_CODES.SOURCE_UNKNOWN,
        'Copilot returned a skill with an unknown source label; it was skipped.',
        projectPath,
        'SOURCE_UNKNOWN',
      ),
    );
    return undefined;
  }

  const reportedPath = typeof record['path'] === 'string' ? record['path'].trim() : '';
  const resolved = await resolveReportedPath(reportedPath, projectPath);
  if (resolved.warningReason !== undefined) {
    warnings.push(
      entryWarning(
        CATALOG_WARNING_CODES.PATH_UNRESOLVED,
        resolved.warningReason === 'PATH_MISSING'
          ? 'Copilot returned a skill without a path; the entry is kept without a canonical path.'
          : 'Copilot reported a skill path that could not be resolved; the lexical path was retained.',
        reportedPath === '' ? projectPath : resolved.path,
        resolved.warningReason,
        source,
      ),
    );
  }

  const explicitName = typeof record['name'] === 'string' ? record['name'].trim() : '';
  const fallbackName = basename(resolved.packagePath || resolved.path);
  const name = explicitName || fallbackName;
  if (name === '') {
    warnings.push(
      entryWarning(
        CATALOG_WARNING_CODES.ENTRY_INVALID,
        'Copilot returned a skill with no name and no usable path; it was skipped.',
        projectPath,
        'NAME_MISSING',
        source,
      ),
    );
    return undefined;
  }
  if (explicitName === '') {
    warnings.push(
      entryWarning(
        CATALOG_WARNING_CODES.NAME_MISSING,
        'Copilot returned a skill without a name; the package directory name was used.',
        resolved.path || projectPath,
        'NAME_MISSING',
        source,
      ),
    );
  }

  const description = typeof record['description'] === 'string' ? record['description'] : '';
  const enabled = typeof record['enabled'] === 'boolean' ? record['enabled'] : true;

  return {
    id: createSkillId({
      harness: COPILOT_HARNESS,
      source,
      path: resolved.path,
      name,
    }),
    harness: COPILOT_HARNESS,
    source,
    name,
    description,
    path: resolved.path,
    packagePath: resolved.packagePath,
    enabled,
  };
}

interface ResolvedPath {
  path: string;
  packagePath: string;
  warningReason?: string;
}

/**
 * Canonicalize a path reported by Copilot.
 *
 * Copilot reports the package directory, while the catalog contract records
 * the `SKILL.md` file. When a package directory contains `SKILL.md`, the file's
 * canonical path is used; otherwise the directory itself is retained. A
 * missing path yields an empty path with a warning instead of dropping an
 * otherwise valid entry.
 */
async function resolveReportedPath(
  reportedPath: string,
  projectPath: string,
): Promise<ResolvedPath> {
  if (reportedPath === '') {
    return { path: '', packagePath: '', warningReason: 'PATH_MISSING' };
  }

  const absolute = isAbsolute(reportedPath)
    ? reportedPath
    : resolve(projectPath, reportedPath);

  let canonical: string;
  try {
    canonical = await realpath(absolute);
  } catch (error) {
    return {
      path: absolute,
      packagePath: dirname(absolute),
      warningReason: errnoCode(error),
    };
  }

  let info;
  try {
    info = await stat(canonical);
  } catch (error) {
    return {
      path: canonical,
      packagePath: dirname(canonical),
      warningReason: errnoCode(error),
    };
  }

  if (info.isDirectory()) {
    const skillFile = join(canonical, 'SKILL.md');
    try {
      const canonicalFile = await realpath(skillFile);
      const fileInfo = await stat(canonicalFile);
      if (fileInfo.isFile()) {
        return { path: canonicalFile, packagePath: canonical };
      }
    } catch {
      // Some harness sources may expose a package directory without SKILL.md;
      // the directory remains the canonical path in that case.
    }
    return { path: canonical, packagePath: canonical };
  }

  return { path: canonical, packagePath: dirname(canonical) };
}

function normalizeSource(value: unknown): SkillSource | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return (COPILOT_SOURCE_LABELS as readonly string[]).includes(normalized)
    ? (normalized as SkillSource)
    : undefined;
}

function normalizeExecutable(value: string | undefined): string {
  const executable = typeof value === 'string' ? value.trim() : '';
  return executable === '' ? COPILOT_EXECUTABLE : executable;
}

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_COPILOT_TIMEOUT_MS;
  }
  return Math.min(
    MAX_COPILOT_TIMEOUT_MS,
    Math.max(MIN_COPILOT_TIMEOUT_MS, Math.floor(value)),
  );
}

async function resolveProjectDirectory(value: unknown): Promise<string> {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.includes('\0') ||
    !isAbsolute(value)
  ) {
    throw new CatalogError(
      CATALOG_ERROR_CODES.PROJECT_PATH_INVALID,
      'Copilot discovery requires an absolute project directory.',
      { path: typeof value === 'string' ? value : String(value) },
    );
  }

  let canonical: string;
  try {
    canonical = await realpath(value);
  } catch (error) {
    throw new CatalogError(
      CATALOG_ERROR_CODES.PROJECT_PATH_INVALID,
      'Copilot discovery requires an existing project directory.',
      { path: value, reason: errnoCode(error) },
      { cause: error },
    );
  }

  let info;
  try {
    info = await stat(canonical);
  } catch (error) {
    throw new CatalogError(
      CATALOG_ERROR_CODES.PROJECT_PATH_INVALID,
      'Copilot discovery requires a readable project directory.',
      { path: canonical, reason: errnoCode(error) },
      { cause: error },
    );
  }

  if (!info.isDirectory()) {
    throw new CatalogError(
      CATALOG_ERROR_CODES.PROJECT_PATH_INVALID,
      'Copilot discovery requires a project directory, not a file.',
      { path: canonical },
    );
  }

  return canonical;
}

/**
 * Guard an injected runner with the same bound as the real one. A runner that
 * hangs or ignores its timeout still yields a warning rather than blocking the
 * catalog request indefinitely.
 */
async function runBounded(
  runner: CopilotCommandRunner,
  request: CopilotCommandRequest,
  timeoutMs: number,
): Promise<
  { timedOut: true; result?: undefined } | { timedOut: false; result: CopilotCommandResult }
> {
  const grace = 250;
  let handle: NodeJS.Timeout | undefined;

  try {
    const result = await Promise.race([
      runner(request),
      new Promise<'__timeout__'>((resolveTimeout) => {
        handle = setTimeout(() => resolveTimeout('__timeout__'), timeoutMs + grace);
        handle.unref();
      }),
    ]);

    if (result === '__timeout__') {
      return { timedOut: true };
    }
    return { timedOut: false, result };
  } catch (error) {
    return { timedOut: false, result: failureResult(error) };
  } finally {
    if (handle !== undefined) {
      clearTimeout(handle);
    }
  }
}

function failureResult(error: unknown): CopilotCommandResult {
  const code = errnoCode(error);
  const timedOut =
    typeof error === 'object' &&
    error !== null &&
    'timedOut' in error &&
    (error as { timedOut?: unknown }).timedOut === true;
  const result: CopilotCommandResult = {
    exitCode: null,
    stdout: '',
    stderr: '',
    timedOut,
  };
  if (!(code === 'UNKNOWN' && timedOut)) {
    result.errorCode = code;
  }
  return result;
}

function isMissingExecutable(code: string): boolean {
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function timeoutWarning(
  projectPath: string,
  command: string,
  timeoutMs: number,
): CatalogWarning {
  return commandWarning({
    code: CATALOG_WARNING_CODES.COMMAND_TIMEOUT,
    message: `Copilot discovery timed out after ${String(timeoutMs)} ms; the catalog is incomplete.`,
    projectPath,
    command,
    reason: 'TIMEOUT',
  });
}

function commandFailureMessage(
  executable: string,
  exitCode: number | null,
  signal: NodeJS.Signals | null | undefined,
): string {
  if (exitCode === null) {
    return `Copilot discovery "${executable} skill list --json" ended without an exit code (signal ${signal ?? 'unknown'}); the catalog is incomplete.`;
  }
  return `Copilot discovery "${executable} skill list --json" exited with exit code ${String(exitCode)}; the catalog is incomplete.`;
}

function formatCommand(executable: string): string {
  return [executable, ...COPILOT_DISCOVERY_ARGS].join(' ');
}

interface CommandWarningInput {
  code: CatalogWarningCode;
  message: string;
  projectPath: string;
  command: string;
  reason: string;
  exitCode?: number | null;
  stderr?: string;
}

function commandWarning(input: CommandWarningInput): CatalogWarning {
  const warning: CatalogWarning = {
    code: input.code,
    message: input.message,
    harness: COPILOT_HARNESS,
    path: input.projectPath,
    reason: input.reason,
    command: input.command,
  };
  if (input.exitCode !== undefined) {
    warning.exitCode = input.exitCode;
  }
  const excerpt = redactStderrExcerpt(input.stderr);
  if (excerpt !== '') {
    warning.stderr = excerpt;
  }
  return warning;
}

function entryWarning(
  code: CatalogWarningCode,
  message: string,
  path: string,
  reason: string,
  source?: SkillSource,
): CatalogWarning {
  const warning: CatalogWarning = {
    code,
    message,
    harness: COPILOT_HARNESS,
    path,
    reason,
  };
  if (source !== undefined) {
    warning.source = source;
  }
  return warning;
}

/**
 * Keep a short, single-line stderr excerpt for the error state while removing
 * anything that looks like a credential. The raw stream is never persisted or
 * returned in full.
 */
export function redactStderrExcerpt(value: string | undefined, maxLength = 320): string {
  if (typeof value !== 'string' || value === '') {
    return '';
  }

  let text = value
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/gh[pousr]_[A-Za-z0-9]{16,}/g, '[REDACTED]')
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, '[REDACTED]')
    .replace(/(Bearer\s+)\S+/gi, '$1[REDACTED]')
    .replace(/((?:token|secret|password|api[_-]?key)\s*[:=]\s*)\S+/gi, '$1[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length > maxLength) {
    text = `${text.slice(0, maxLength - 1)}…`;
  }
  return text;
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
