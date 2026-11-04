import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { HARNESS_IDS, type HarnessId } from '../config/schema.js';

/**
 * Local authentication evidence.
 *
 * Preflight never asks a harness to answer a prompt and never makes a paid
 * model call. It may inspect only:
 *
 * - environment-variable *presence* (never the value),
 * - local credential/config file *presence* (never the contents), and
 * - bounded output from a static, non-prompt CLI status command.
 *
 * Ambiguous evidence is reported as `unknown`. The engine turns `unknown` into
 * an acknowledgement-requiring finding instead of silently passing. A command
 * that explicitly reports a signed-out state is the only path to the
 * `unauthenticated` block.
 *
 * SEC-02: evidence objects never contain environment values, token values, raw
 * credential-file contents, or unredacted CLI output.
 */

export const DEFAULT_AUTH_TIMEOUT_MS = 2_500;
export const MAX_AUTH_OUTPUT_BYTES = 64 * 1024;
export const MAX_EVIDENCE_EXCERPT_LENGTH = 240;

/** A shell-free local command request. The executable and args are separate. */
export interface LocalCommandRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly maxOutputBytes?: number;
}

export interface LocalCommandResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  /** Stable spawn failure code such as `ENOENT`, never raw output. */
  readonly spawnError: string | null;
}

export type LocalCommandRunner = (
  request: LocalCommandRequest,
) => Promise<LocalCommandResult>;

/**
 * Default command runner. It uses `spawn` with an argument array and
 * `shell: false`; no user-controlled string is ever interpreted by a shell.
 * Output is bounded and the child is killed on timeout.
 */
export const runLocalCommand: LocalCommandRunner = (request) =>
  new Promise<LocalCommandResult>((resolvePromise) => {
    const maxOutputBytes = Math.max(
      1_024,
      Math.min(request.maxOutputBytes ?? MAX_AUTH_OUTPUT_BYTES, 4 * 1024 * 1024),
    );
    const timeoutMs = Math.max(100, request.timeoutMs);
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;

    const finish = (result: Omit<LocalCommandResult, 'stdout' | 'stderr' | 'timedOut'>): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        exitCode: result.exitCode,
        signal: result.signal,
        stdout,
        stderr,
        timedOut,
        spawnError: result.spawnError,
      });
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(request.executable, [...request.args], {
        cwd: request.cwd,
        env: request.env ?? process.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      resolvePromise({
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        spawnError: errnoCode(error),
      });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // The child may have exited between the timer firing and the kill.
      }
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (stdoutBytes >= maxOutputBytes) {
        return;
      }
      const text = chunk.toString();
      const remaining = maxOutputBytes - stdoutBytes;
      const appended = text.slice(0, remaining);
      stdout += appended;
      stdoutBytes += Buffer.byteLength(appended);
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      if (stderrBytes >= maxOutputBytes) {
        return;
      }
      const text = chunk.toString();
      const remaining = maxOutputBytes - stderrBytes;
      const appended = text.slice(0, remaining);
      stderr += appended;
      stderrBytes += Buffer.byteLength(appended);
    });

    child.once('error', (error) => {
      finish({
        exitCode: null,
        signal: null,
        spawnError: errnoCode(error),
      });
    });

    child.once('close', (code, signal) => {
      finish({ exitCode: code, signal, spawnError: null });
    });
  });

export type AuthParseMode = 'credential-list-json' | 'status-text';

export interface AuthCommandEvidenceSpec {
  readonly args: readonly string[];
  readonly parse: AuthParseMode;
  readonly description: string;
  readonly timeoutMs?: number;
  /** Used by `status-text`; never applied to raw output stored in the report. */
  readonly authenticatedPattern?: RegExp;
  readonly unauthenticatedPattern?: RegExp;
}

export interface AuthFileEvidenceSpec {
  /** Absolute path, or a path starting with `~`. Only existence is checked. */
  readonly path: string;
  readonly description: string;
}

export interface HarnessAuthStrategy {
  readonly harness: HarnessId;
  /** Names only. Values are never read, copied, or reported. */
  readonly environmentVariables: readonly string[];
  readonly commands: readonly AuthCommandEvidenceSpec[];
  readonly files: readonly AuthFileEvidenceSpec[];
  readonly loginHint: string;
}

/**
 * Static, non-prompt evidence strategies. They are data consumed by the
 * engine; no route or runner compares a harness name.
 *
 * OpenCode exposes `auth list --format json`, which reports provider and
 * connection metadata but not credential values. Copilot has no non-prompt
 * account probe, so its evidence is environment-token presence; when that is
 * absent the engine requires an explicit acknowledgement.
 */
export const HARNESS_AUTH_STRATEGIES: readonly HarnessAuthStrategy[] = Object.freeze([
  Object.freeze({
    harness: 'opencode',
    environmentVariables: Object.freeze([
      'OPENCODE_API_KEY',
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'DEEPSEEK_API_KEY',
      'GOOGLE_GENERATIVE_AI_API_KEY',
      'OPENROUTER_API_KEY',
    ]),
    commands: Object.freeze([
      Object.freeze({
        args: Object.freeze(['auth', 'list', '--format', 'json']),
        parse: 'credential-list-json' as const,
        description: 'opencode auth list --format json',
      }),
    ]),
    files: Object.freeze([]),
    loginHint: 'Run "opencode auth login" in a terminal, then re-run preflight.',
  }),
  Object.freeze({
    harness: 'copilot',
    environmentVariables: Object.freeze([
      'COPILOT_GITHUB_TOKEN',
      'GH_TOKEN',
      'GITHUB_TOKEN',
    ]),
    commands: Object.freeze([]),
    files: Object.freeze([]),
    loginHint:
      'Run "copilot login" in a terminal, or set COPILOT_GITHUB_TOKEN, GH_TOKEN, or GITHUB_TOKEN, then re-run preflight.',
  }),
]);

export const AUTH_EVIDENCE_REASONS = {
  ENVIRONMENT_TOKEN: 'ENVIRONMENT_TOKEN',
  CLI_CREDENTIALS: 'CLI_CREDENTIALS',
  CONFIG_FILE: 'CONFIG_FILE',
  CLI_REPORTED_UNAUTHENTICATED: 'CLI_REPORTED_UNAUTHENTICATED',
  NO_EVIDENCE: 'NO_EVIDENCE',
  NO_STRATEGY: 'NO_STRATEGY',
  NO_EXECUTABLE: 'NO_EXECUTABLE',
  COMMAND_UNAVAILABLE: 'COMMAND_UNAVAILABLE',
  COMMAND_FAILED: 'COMMAND_FAILED',
  COMMAND_TIMEOUT: 'COMMAND_TIMEOUT',
  OUTPUT_INVALID: 'OUTPUT_INVALID',
  UNSAFE_ARGUMENTS: 'UNSAFE_ARGUMENTS',
  FILE_EVIDENCE: 'FILE_EVIDENCE',
} as const;
export type AuthEvidenceReason =
  (typeof AUTH_EVIDENCE_REASONS)[keyof typeof AUTH_EVIDENCE_REASONS];

export type AuthState = 'authenticated' | 'unauthenticated' | 'unknown';

export type AuthEvidenceItem =
  | {
      readonly kind: 'environment';
      readonly name: string;
      readonly present: boolean;
    }
  | {
      readonly kind: 'file';
      readonly path: string;
      readonly description: string;
      readonly present: boolean;
    }
  | {
      readonly kind: 'command';
      readonly command: string;
      readonly description: string;
      readonly exitCode: number | null;
      readonly timedOut: boolean;
      readonly state: AuthState;
      readonly reason: AuthEvidenceReason;
      /** Bounded, redacted excerpt. Never raw output. */
      readonly outputExcerpt?: string;
    };

export interface AuthEvidenceResult {
  readonly harness: HarnessId;
  readonly state: AuthState;
  readonly reason: AuthEvidenceReason;
  readonly evidence: AuthEvidenceItem[];
  readonly loginHint: string;
}

export interface CollectAuthEvidenceOptions {
  readonly harness: HarnessId;
  /** Resolved executable, or null when the CLI is missing. */
  readonly executable: string | null;
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly runner?: LocalCommandRunner;
  /** `null` explicitly disables the default strategy lookup. */
  readonly strategy?: HarnessAuthStrategy | null;
  readonly timeoutMs?: number;
  /** Presence probe for file evidence. Defaults to `access(path, F_OK)`. */
  readonly fileExists?: (path: string) => Promise<boolean>;
  readonly homeDirectory?: string;
}

/**
 * Run every allowed evidence probe and reduce it to one of three states.
 *
 * `authenticated` requires positive evidence. `unauthenticated` requires an
 * explicit signed-out signal. Everything else is `unknown`, which the engine
 * converts into an acknowledgement-required finding.
 */
export async function collectAuthEvidence(
  options: CollectAuthEvidenceOptions,
): Promise<AuthEvidenceResult> {
  const strategy =
    options.strategy === null ? undefined : options.strategy ?? findAuthStrategy(options.harness);
  const env = options.env ?? process.env;
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const evidence: AuthEvidenceItem[] = [];
  let transientReason: AuthEvidenceReason = AUTH_EVIDENCE_REASONS.NO_EVIDENCE;

  if (strategy === undefined) {
    return {
      harness: options.harness,
      state: 'unknown',
      reason: AUTH_EVIDENCE_REASONS.NO_STRATEGY,
      evidence,
      loginHint: 'Authenticate the harness locally, then re-run preflight.',
    };
  }

  if (strategy.environmentVariables.length === 0 && strategy.commands.length === 0 && strategy.files.length === 0) {
    transientReason = AUTH_EVIDENCE_REASONS.NO_EVIDENCE;
  }

  for (const name of strategy.environmentVariables) {
    const value = env[name];
    const present = typeof value === 'string' && value.trim() !== '';
    evidence.push({ kind: 'environment', name, present });
    if (present) {
      return {
        harness: options.harness,
        state: 'authenticated',
        reason: AUTH_EVIDENCE_REASONS.ENVIRONMENT_TOKEN,
        evidence,
        loginHint: strategy.loginHint,
      };
    }
  }

  const fileExists = options.fileExists ?? defaultFileExists;
  for (const file of strategy.files) {
    const path = expandHomePath(file.path, options.homeDirectory);
    let present = false;
    try {
      present = await fileExists(path);
    } catch {
      present = false;
    }
    evidence.push({ kind: 'file', path, description: file.description, present });
    if (present) {
      return {
        harness: options.harness,
        state: 'authenticated',
        reason: AUTH_EVIDENCE_REASONS.FILE_EVIDENCE,
        evidence,
        loginHint: strategy.loginHint,
      };
    }
  }

  if (strategy.commands.length === 0) {
    return {
      harness: options.harness,
      state: 'unknown',
      reason: transientReason,
      evidence,
      loginHint: strategy.loginHint,
    };
  }

  if (options.executable === null || options.executable.trim() === '') {
    return {
      harness: options.harness,
      state: 'unknown',
      reason: AUTH_EVIDENCE_REASONS.NO_EXECUTABLE,
      evidence,
      loginHint: strategy.loginHint,
    };
  }

  const runner = options.runner ?? runLocalCommand;

  for (const command of strategy.commands) {
    const commandTimeoutMs = normalizeTimeout(command.timeoutMs ?? timeoutMs);
    const args = [...command.args];

    let unsafe = false;
    try {
      assertLocalEvidenceArgs(args);
    } catch {
      unsafe = true;
    }

    if (unsafe) {
      evidence.push({
        kind: 'command',
        command: renderCommand(options.executable, args),
        description: command.description,
        exitCode: null,
        timedOut: false,
        state: 'unknown',
        reason: AUTH_EVIDENCE_REASONS.UNSAFE_ARGUMENTS,
      });
      transientReason = AUTH_EVIDENCE_REASONS.UNSAFE_ARGUMENTS;
      continue;
    }

    let result: LocalCommandResult;
    try {
      result = await runner({
        executable: options.executable,
        args,
        cwd: options.cwd,
        timeoutMs: commandTimeoutMs,
        env,
      });
    } catch (error) {
      evidence.push({
        kind: 'command',
        command: renderCommand(options.executable, args),
        description: command.description,
        exitCode: null,
        timedOut: false,
        state: 'unknown',
        reason: AUTH_EVIDENCE_REASONS.COMMAND_FAILED,
        outputExcerpt: redactSecrets(errnoCode(error)),
      });
      transientReason = AUTH_EVIDENCE_REASONS.COMMAND_FAILED;
      continue;
    }

    const classification = classifyCommandResult(command, result);
    const item: AuthEvidenceItem = {
      kind: 'command',
      command: renderCommand(options.executable, args),
      description: command.description,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      state: classification.state,
      reason: classification.reason,
      ...(classification.excerpt === undefined
        ? {}
        : { outputExcerpt: classification.excerpt }),
    };
    evidence.push(item);

    if (classification.state === 'authenticated') {
      return {
        harness: options.harness,
        state: 'authenticated',
        reason: classification.reason,
        evidence,
        loginHint: strategy.loginHint,
      };
    }
    if (classification.state === 'unauthenticated') {
      return {
        harness: options.harness,
        state: 'unauthenticated',
        reason: classification.reason,
        evidence,
        loginHint: strategy.loginHint,
      };
    }
    transientReason = classification.reason;
  }

  return {
    harness: options.harness,
    state: 'unknown',
    reason: transientReason,
    evidence,
    loginHint: strategy.loginHint,
  };
}

/** Look up the static strategy for a harness. */
export function findAuthStrategy(harness: HarnessId): HarnessAuthStrategy | undefined {
  return HARNESS_AUTH_STRATEGIES.find((strategy) => strategy.harness === harness);
}

/** True when `value` is one of the configured v1 harness ids. */
export function isKnownHarness(value: unknown): value is HarnessId {
  return typeof value === 'string' && (HARNESS_IDS as readonly string[]).includes(value);
}

const PROMPT_FLAGS = new Set([
  '-p',
  '--prompt',
  '-i',
  '--interactive',
  '--session',
  '--session-id',
  '--fork',
  '--continue',
  '--resume',
  '--message',
]);

const PROMPT_SUBCOMMANDS = new Set(['run', 'prompt', 'chat']);

/**
 * Reject any static status command that could start a prompt session or make
 * a model call. Preflight's no-paid-call rule is enforced structurally, not by
 * convention.
 */
export function assertLocalEvidenceArgs(args: readonly string[]): void {
  if (args.length === 0) {
    throw new Error('A local evidence command must include an argument array.');
  }
  for (const arg of args) {
    if (PROMPT_FLAGS.has(arg)) {
      throw new Error(`Unsafe prompt flag in local evidence command: ${arg}`);
    }
    if (arg.includes('\0')) {
      throw new Error('Unsafe NUL byte in local evidence command.');
    }
  }
  const first = args[0];
  if (first !== undefined && PROMPT_SUBCOMMANDS.has(first)) {
    throw new Error(`Unsafe prompt subcommand in local evidence command: ${first}`);
  }
}

function classifyCommandResult(
  command: AuthCommandEvidenceSpec,
  result: LocalCommandResult,
): { state: AuthState; reason: AuthEvidenceReason; excerpt?: string | undefined } {
  if (result.timedOut) {
    return {
      state: 'unknown',
      reason: AUTH_EVIDENCE_REASONS.COMMAND_TIMEOUT,
      ...(excerptFor(result) === undefined ? {} : { excerpt: excerptFor(result) }),
    };
  }

  if (result.spawnError !== null) {
    return {
      state: 'unknown',
      reason: AUTH_EVIDENCE_REASONS.COMMAND_UNAVAILABLE,
      excerpt: redactSecrets(result.spawnError),
    };
  }

  const combined = `${result.stdout}\n${result.stderr}`;

  if (
    command.unauthenticatedPattern !== undefined &&
    command.unauthenticatedPattern.test(combined)
  ) {
    return {
      state: 'unauthenticated',
      reason: AUTH_EVIDENCE_REASONS.CLI_REPORTED_UNAUTHENTICATED,
      ...(excerptFor(result) === undefined ? {} : { excerpt: excerptFor(result) }),
    };
  }

  if (
    command.authenticatedPattern !== undefined &&
    command.authenticatedPattern.test(combined)
  ) {
    return { state: 'authenticated', reason: AUTH_EVIDENCE_REASONS.CLI_CREDENTIALS };
  }

  if (result.exitCode === 0) {
    if (command.parse === 'credential-list-json') {
      const parsed = parseCredentialList(result.stdout);
      if (parsed === undefined) {
        return {
          state: 'unknown',
          reason: AUTH_EVIDENCE_REASONS.OUTPUT_INVALID,
          ...(excerptFor(result) === undefined ? {} : { excerpt: excerptFor(result) }),
        };
      }
      if (parsed.connections > 0) {
        return { state: 'authenticated', reason: AUTH_EVIDENCE_REASONS.CLI_CREDENTIALS };
      }
      // An empty credential list is not proof of a signed-out CLI: providers
      // may be configured through the environment or a local provider. This is
      // ambiguous and must be acknowledged rather than silently called a pass.
      return { state: 'unknown', reason: AUTH_EVIDENCE_REASONS.NO_EVIDENCE };
    }

    return {
      state: 'unknown',
      reason: AUTH_EVIDENCE_REASONS.OUTPUT_INVALID,
      ...(excerptFor(result) === undefined ? {} : { excerpt: excerptFor(result) }),
    };
  }

  return {
    state: 'unknown',
    reason: AUTH_EVIDENCE_REASONS.COMMAND_FAILED,
    ...(excerptFor(result) === undefined ? {} : { excerpt: excerptFor(result) }),
  };
}

interface ParsedCredentialList {
  credentials: number;
  connections: number;
}

function parseCredentialList(stdout: string): ParsedCredentialList | undefined {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return undefined;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  let connections = 0;
  for (const entry of value) {
    if (isRecord(entry) && Array.isArray(entry.connections)) {
      connections += entry.connections.length;
    }
  }

  return { credentials: value.length, connections };
}

function excerptFor(result: LocalCommandResult): string | undefined {
  const text = result.stderr.trim() !== '' ? result.stderr : result.stdout;
  const trimmed = text.trim();
  if (trimmed === '') {
    return undefined;
  }
  return redactSecrets(trimmed).slice(0, MAX_EVIDENCE_EXCERPT_LENGTH);
}

function renderCommand(executable: string, args: readonly string[]): string {
  return [executable, ...args].map(quoteArgument).join(' ');
}

function quoteArgument(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function expandHomePath(value: string, homeDirectory: string | undefined): string {
  if (value === '~') {
    return homeDirectory ?? homedir();
  }
  if (value.startsWith('~/')) {
    return join(homeDirectory ?? homedir(), value.slice(2));
  }
  if (isAbsolute(value)) {
    return value;
  }
  return join(homeDirectory ?? homedir(), value);
}

async function defaultFileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 100) {
    return DEFAULT_AUTH_TIMEOUT_MS;
  }
  return Math.floor(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errnoCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }
  return 'COMMAND_FAILED';
}

const REDACTED = '[REDACTED]';

/**
 * Remove credential-shaped values from any diagnostic text that could reach a
 * report or a log. This is defence in depth: callers should still avoid
 * collecting secret output in the first place.
 */
export function redactSecrets(value: string): string {
  let output = value;

  const patterns: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
    // Authorization headers and bearer tokens.
    {
      pattern: /(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s"',}]+/gi,
      replacement: `$1${REDACTED}`,
    },
    {
      pattern: /\b(bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
      replacement: `$1${REDACTED}`,
    },
    // Common provider token prefixes.
    { pattern: /\bsk-[A-Za-z0-9_-]{8,}/g, replacement: REDACTED },
    { pattern: /\bgh[pousr]_[A-Za-z0-9_]{8,}/g, replacement: REDACTED },
    { pattern: /\bgithub_pat_[A-Za-z0-9_]{8,}/g, replacement: REDACTED },
    { pattern: /\bxox[baprs]-[A-Za-z0-9-]{8,}/g, replacement: REDACTED },
    { pattern: /\bAKIA[0-9A-Z]{12,}/g, replacement: REDACTED },
    {
      pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
      replacement: REDACTED,
    },
    // key=value / key: value forms for common secret names.
    {
      pattern:
        /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|password|passwd|secret|token)\s*[:=]\s*["']?)[^\s"',}]+/gi,
      replacement: `$1${REDACTED}`,
    },
  ];

  for (const { pattern, replacement } of patterns) {
    output = output.replace(pattern, replacement);
  }

  return output;
}
