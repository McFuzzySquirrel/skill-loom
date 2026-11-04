import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, resolve } from 'node:path';
import { CHAIN_SESSION_MODES, type ChainSessionMode } from '../chains/model.js';
import type { HarnessId } from '../config/schema.js';
import type { SkillSource } from '../catalog/types.js';

/**
 * Harness adapter contract.
 *
 * Every harness-specific command, flag, discovery strategy, trust behavior,
 * and advancement signal lives behind this module. Route, preflight, runner,
 * and UI code consume the descriptor as data and never compare a harness name
 * themselves (NFR-COMPAT-01).
 *
 * The adapter reports *how* an executable is resolved but does not spawn one:
 * executable resolution is a filesystem probe, and command builders only
 * return an executable plus an argument array. Actual process and PTY creation
 * remains the run layer's responsibility.
 */

/** How a harness exposes its installed skills. */
export type HarnessDiscoveryStrategy = 'filesystem' | 'cli-json';

/** Whether the CLI gates work behind a per-folder trust dialog. */
export type HarnessTrustBehavior = 'none' | 'folder-dialog';

/** The only signal an automatic run may consume to advance a step. */
export type HarnessAdvancementSignal = 'osc-working-idle' | 'process-exit';

/** Supervised steps only advance when the user explicitly marks them. */
export type HarnessSupervisedAdvancement = 'user-only';

/**
 * How skill firing can be observed in a harness's terminal output (RUN-FR-10).
 *
 * `log-lines` means the CLI may print `skill(name)` lines that Slan can report
 * best-effort. `unobservable` means the harness exposes no equivalent visible
 * signal, so the run records `not-observable` instead of guessing.
 */
export const HARNESS_SKILL_OBSERVATIONS = ['log-lines', 'unobservable'] as const;
export type HarnessSkillObservation = (typeof HARNESS_SKILL_OBSERVATIONS)[number];

/**
 * Fork mechanism for one command surface.
 *
 * `handoff` means the caller starts a new session and supplies a deterministic
 * handoff note in the prompt; it is not a native copy of the previous session.
 */
export type ForkMechanism = 'none' | 'native' | 'handoff';

export type HarnessExecutableResolutionStrategy = 'config-then-path';

export interface HarnessDiscoveryRoot {
  /** Catalog source label. */
  readonly source: SkillSource;
  /**
   * Display-form location. `<project>`, `~`, and `<slan-config>` are
   * placeholders resolved by the discovery implementation, never by the UI.
   */
  readonly location: string;
}

export interface HarnessDiscoveryCommand {
  /** Argument array appended to the resolved executable. Never a shell string. */
  readonly args: readonly string[];
}

export interface HarnessDiscoveryDescriptor {
  readonly strategy: HarnessDiscoveryStrategy;
  /** Filesystem roots for `filesystem`; an empty array for `cli-json`. */
  readonly roots: readonly HarnessDiscoveryRoot[];
  /** Discovery command for `cli-json`; `null` for `filesystem`. */
  readonly command: HarnessDiscoveryCommand | null;
}

export interface HarnessForkMechanisms {
  readonly interactive: ForkMechanism;
  readonly headless: ForkMechanism;
}

export interface HarnessTrustDescriptor {
  readonly behavior: HarnessTrustBehavior;
  /** Configuration file read for persistent trust evidence; never written by Slan. */
  readonly configPath: string | null;
  /** Key inside the configuration file that lists trusted folders. */
  readonly trustedFoldersKey: string | null;
}

/** Serializable capability descriptor shared by every adapter. */
export interface HarnessDescriptor {
  readonly id: HarnessId;
  readonly displayName: string;
  /** Default command name searched on PATH when no config override exists. */
  readonly executableName: string;
  readonly executableResolution: HarnessExecutableResolutionStrategy;
  /** Install/remediation hint returned with a missing-executable block. */
  readonly installHint: string;
  readonly discovery: HarnessDiscoveryDescriptor;
  readonly supportedSessionModes: readonly ChainSessionMode[];
  /** True only when at least one command surface exposes a real fork flag. */
  readonly nativeFork: boolean;
  readonly forkMechanisms: HarnessForkMechanisms;
  readonly trust: HarnessTrustDescriptor;
  readonly automaticAdvancement: HarnessAdvancementSignal;
  readonly supervisedAdvancement: HarnessSupervisedAdvancement;
  /** Best-effort skill-firing evidence available on the terminal stream. */
  readonly skillObservation: HarnessSkillObservation;
  /** Exact broad flags used by an automatic run; empty when none are needed. */
  readonly automaticPermissions: readonly string[];
  /** True when `automaticPermissions` require a per-chain opt-in. */
  readonly requiresAutomaticPermissionOptIn: boolean;
  /** Chain field that records the opt-in, or `null` when none is required. */
  readonly permissionOptInField: 'automaticPermissionOptIn' | null;
}

export interface ResolvedExecutable {
  readonly harness: HarnessId;
  /** Absolute path selected for spawning. */
  readonly executable: string;
  readonly source: 'config' | 'path';
  /** Raw configured override when `source` is `config`. */
  readonly configuredOverride: string | null;
}

export interface ExecutableResolutionOptions {
  /** PATH value. Defaults to `env.PATH`, then `process.env.PATH`. */
  pathEnv?: string | undefined;
  /** PATH separator. Defaults to the platform delimiter. */
  pathDelimiter?: string | undefined;
  /** Executable probe seam. Defaults to a stat + `X_OK` check. */
  isExecutable?: ((candidate: string) => boolean) | undefined;
  /** Base directory for relative PATH segments. Defaults to `process.cwd()`. */
  cwd?: string | undefined;
  /** Environment source for the default PATH. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv | undefined;
}

export interface HarnessAdapterOptions extends ExecutableResolutionOptions {
  /** Slan config `harnessCommands[id]` override. */
  executableOverride?: string | undefined;
}

/** One step invocation handed to an argument builder. Never a shell string. */
export interface StepInvocation {
  /** Fully assembled prompt. It is passed as exactly one argument. */
  prompt: string;
  /**
   * Session id for the step. For `shared`, the same id is reused; for `fresh`
   * and handoff forks the caller generates a new id.
   */
  sessionId: string;
  /** Canonical absolute project directory. */
  projectPath: string;
  sessionMode: ChainSessionMode;
  /**
   * Parent session for a native fork. Only meaningful for `sessionMode: fork`
   * on a surface whose mechanism is `native`. When absent, the fork starts a
   * new session and must carry a handoff note in the prompt.
   */
  forkFromSessionId?: string | undefined;
  /** Per-chain opt-in for broad automatic permissions. Defaults to false. */
  automaticPermissionOptIn?: boolean | undefined;
}

/** A shell-free executable-plus-array command. */
export interface HarnessCommand {
  readonly harness: HarnessId;
  /** Absolute executable path. */
  readonly executable: string;
  readonly args: string[];
  readonly cwd: string;
  readonly sessionMode: ChainSessionMode;
  readonly forkMechanism: ForkMechanism;
}

export interface HarnessTrustCommand {
  readonly harness: HarnessId;
  readonly executable: string;
  readonly args: string[];
  readonly cwd: string;
}

export interface HarnessAdapter extends HarnessDescriptor {
  /** Resolve the executable from Slan config, then PATH, without a shell. */
  resolveExecutable(): ResolvedExecutable;
  supportsSessionMode(mode: string): mode is ChainSessionMode;
  /** Throw a typed error before a spawn when the mode is unsupported. */
  assertSessionMode(mode: string): ChainSessionMode;
  buildInteractiveCommand(invocation: StepInvocation): HarnessCommand;
  buildHeadlessCommand(invocation: StepInvocation): HarnessCommand;
  /**
   * Unseeded interactive command used to establish folder trust. Present only
   * for adapters with a folder-dialog trust behavior.
   */
  buildTrustCommand?: ((options: { projectPath: string }) => HarnessTrustCommand) | undefined;
}

export const HARNESS_ERROR_CODES = {
  UNAVAILABLE: 'HARNESS_UNAVAILABLE',
  UNSUPPORTED: 'HARNESS_UNSUPPORTED',
  SESSION_MODE_UNSUPPORTED: 'HARNESS_SESSION_MODE_UNSUPPORTED',
  PERMISSION_OPT_IN_REQUIRED: 'HARNESS_PERMISSION_OPT_IN_REQUIRED',
  INVOCATION_INVALID: 'HARNESS_INVOCATION_INVALID',
} as const;
export type HarnessErrorCode = (typeof HARNESS_ERROR_CODES)[keyof typeof HARNESS_ERROR_CODES];

/**
 * Typed harness failure. Details contain only stable codes, the harness id,
 * attempted executable paths, and field names: never prompts or credentials.
 */
export class HarnessError extends Error {
  readonly code: HarnessErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: HarnessErrorCode,
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

export class HarnessUnavailableError extends HarnessError {
  constructor(message: string, details: Record<string, unknown>) {
    super(HARNESS_ERROR_CODES.UNAVAILABLE, message, details);
  }
}

export class HarnessUnsupportedError extends HarnessError {
  constructor(harness: unknown, supported: readonly string[]) {
    super(
      HARNESS_ERROR_CODES.UNSUPPORTED,
      `Harness "${describeValue(harness)}" is not supported.`,
      { harness: describeValue(harness), supported: [...supported] },
    );
  }
}

export class HarnessSessionModeError extends HarnessError {
  constructor(harness: HarnessId, mode: unknown, supported: readonly string[]) {
    super(
      HARNESS_ERROR_CODES.SESSION_MODE_UNSUPPORTED,
      `Session mode "${describeValue(mode)}" is not supported by ${harness}.`,
      { harness, sessionMode: describeValue(mode), supported: [...supported] },
    );
  }
}

export class HarnessPermissionOptInError extends HarnessError {
  constructor(harness: HarnessId, permissions: readonly string[]) {
    super(
      HARNESS_ERROR_CODES.PERMISSION_OPT_IN_REQUIRED,
      `Automatic ${harness} runs require the per-chain automatic permission opt-in.`,
      {
        harness,
        permissions: [...permissions],
        optInField: 'automaticPermissionOptIn',
      },
    );
  }
}

export class HarnessInvocationError extends HarnessError {
  constructor(harness: HarnessId, field: string, message: string) {
    super(
      HARNESS_ERROR_CODES.INVOCATION_INVALID,
      message,
      { harness, field },
    );
  }
}

/** True when `value` is one of the chain session modes. */
export function isChainSessionMode(value: unknown): value is ChainSessionMode {
  return (
    typeof value === 'string' &&
    (CHAIN_SESSION_MODES as readonly string[]).includes(value)
  );
}

/**
 * Validate the parts of an invocation that every adapter shares.
 *
 * A prompt is validated but never trimmed: the caller's text is passed through
 * unchanged as a single argument. The returned mode has already been checked
 * against the chain model.
 */
export function assertStepInvocation(
  harness: HarnessId,
  invocation: StepInvocation,
): ChainSessionMode {
  if (typeof invocation !== 'object' || invocation === null) {
    throw new HarnessInvocationError(harness, 'invocation', 'The step invocation is missing.');
  }

  if (
    typeof invocation.prompt !== 'string' ||
    invocation.prompt.trim() === '' ||
    invocation.prompt.includes('\0')
  ) {
    throw new HarnessInvocationError(
      harness,
      'prompt',
      'The step prompt must be a nonempty string without NUL characters.',
    );
  }

  if (
    typeof invocation.sessionId !== 'string' ||
    invocation.sessionId.trim() === '' ||
    invocation.sessionId.includes('\0')
  ) {
    throw new HarnessInvocationError(
      harness,
      'sessionId',
      'The step session id must be a nonempty string without NUL characters.',
    );
  }

  if (
    typeof invocation.projectPath !== 'string' ||
    invocation.projectPath.includes('\0') ||
    !isAbsolute(invocation.projectPath)
  ) {
    throw new HarnessInvocationError(
      harness,
      'projectPath',
      'The project directory must be an absolute path without NUL characters.',
    );
  }

  if (!isChainSessionMode(invocation.sessionMode)) {
    throw new HarnessSessionModeError(harness, invocation.sessionMode, CHAIN_SESSION_MODES);
  }

  if (
    invocation.forkFromSessionId !== undefined &&
    (typeof invocation.forkFromSessionId !== 'string' ||
      invocation.forkFromSessionId.trim() === '' ||
      invocation.forkFromSessionId.includes('\0'))
  ) {
    throw new HarnessInvocationError(
      harness,
      'forkFromSessionId',
      'A fork parent session id must be a nonempty string without NUL characters.',
    );
  }

  if (
    invocation.automaticPermissionOptIn !== undefined &&
    typeof invocation.automaticPermissionOptIn !== 'boolean'
  ) {
    throw new HarnessInvocationError(
      harness,
      'automaticPermissionOptIn',
      'The automatic permission opt-in must be a boolean.',
    );
  }

  return invocation.sessionMode;
}

/** Validate a mode against one adapter's supported list. */
export function assertSupportedSessionMode(
  harness: HarnessId,
  supported: readonly ChainSessionMode[],
  mode: string,
): ChainSessionMode {
  if (!isChainSessionMode(mode) || !supported.includes(mode)) {
    throw new HarnessSessionModeError(harness, mode, supported);
  }
  return mode;
}

/** Build the shared executable-not-found error for a resolution attempt. */
export function createHarnessUnavailableError(input: {
  harness: HarnessId;
  executableName: string;
  override: string | null;
  reason: string;
  attempted: readonly string[];
  installHint: string;
}): HarnessUnavailableError {
  const target =
    input.override === null
      ? `the "${input.executableName}" executable`
      : `the configured ${input.harness} executable "${input.override}"`;
  const message =
    input.override === null
      ? `Slan could not find ${target} on PATH.`
      : `Slan could not use ${target}.`;

  return new HarnessUnavailableError(message, {
    harness: input.harness,
    executableName: input.executableName,
    override: input.override,
    reason: input.reason,
    attempted: [...input.attempted],
    installHint: input.installHint,
  });
}

/**
 * Resolve an executable from a configured override first, then PATH.
 *
 * The implementation performs stat/access probes only. It never runs `which`,
 * `exec`, or a shell, and it never falls back to another harness. A configured
 * override that cannot be used is a block even when the default name exists on
 * PATH, because silently ignoring a user's configuration is worse than failing
 * with the exact path.
 */
export function resolveHarnessExecutable(
  input: {
    harness: HarnessId;
    executableName: string;
    installHint: string;
    override?: string | undefined;
  },
  options: ExecutableResolutionOptions = {},
): ResolvedExecutable {
  const cwd = options.cwd ?? process.cwd();
  const probe = options.isExecutable ?? isExecutableFile;
  // An injected environment is authoritative: do not mix it with the
  // developer's real environment when PATH is absent from the seam.
  const pathEnv =
    options.pathEnv ??
    options.env?.PATH ??
    (options.env === undefined ? process.env.PATH ?? '' : '');
  const pathDelimiter = options.pathDelimiter ?? delimiter;
  const attempted: string[] = [];
  const override = typeof input.override === 'string' ? input.override.trim() : '';

  if (override !== '') {
    if (override.includes('\0')) {
      throw createHarnessUnavailableError({
        harness: input.harness,
        executableName: input.executableName,
        override,
        reason: 'OVERRIDE_INVALID',
        attempted,
        installHint: input.installHint,
      });
    }

    const pathLike =
      isAbsolute(override) || override.includes('/') || override.includes('\\');

    if (pathLike) {
      if (!isAbsolute(override)) {
        throw createHarnessUnavailableError({
          harness: input.harness,
          executableName: input.executableName,
          override,
          reason: 'OVERRIDE_NOT_ABSOLUTE',
          attempted,
          installHint: input.installHint,
        });
      }

      attempted.push(override);
      if (probe(override)) {
        return {
          harness: input.harness,
          executable: resolve(override),
          source: 'config',
          configuredOverride: override,
        };
      }

      throw createHarnessUnavailableError({
        harness: input.harness,
        executableName: input.executableName,
        override,
        reason: 'OVERRIDE_NOT_EXECUTABLE',
        attempted,
        installHint: input.installHint,
      });
    }

    const found = searchPath(override, pathEnv, pathDelimiter, cwd, probe, attempted);
    if (found !== undefined) {
      return {
        harness: input.harness,
        executable: found,
        source: 'config',
        configuredOverride: override,
      };
    }

    throw createHarnessUnavailableError({
      harness: input.harness,
      executableName: input.executableName,
      override,
      reason: 'OVERRIDE_NOT_FOUND',
      attempted,
      installHint: input.installHint,
    });
  }

  const found = searchPath(
    input.executableName,
    pathEnv,
    pathDelimiter,
    cwd,
    probe,
    attempted,
  );
  if (found !== undefined) {
    return {
      harness: input.harness,
      executable: found,
      source: 'path',
      configuredOverride: null,
    };
  }

  throw createHarnessUnavailableError({
    harness: input.harness,
    executableName: input.executableName,
    override: null,
    reason: 'NOT_ON_PATH',
    attempted,
    installHint: input.installHint,
  });
}

function searchPath(
  name: string,
  pathEnv: string,
  pathDelimiter: string,
  cwd: string,
  probe: (candidate: string) => boolean,
  attempted: string[],
): string | undefined {
  for (const segment of pathEnv.split(pathDelimiter)) {
    // An empty PATH segment would mean "current directory" in a POSIX shell.
    // Slan deliberately skips it so resolution never depends on cwd contents.
    if (segment === '') {
      continue;
    }
    const candidate = resolve(cwd, segment, name);
    attempted.push(candidate);
    if (probe(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/** Default probe: a regular file that the current user can execute. */
export function isExecutableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) {
      return false;
    }
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function describeValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') {
    return String(value);
  }
  return type;
}
