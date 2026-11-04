import { isAbsolute } from 'node:path';
import { z } from 'zod';
import type { CatalogService } from '../catalog/merge.js';
import type { CatalogWarning, SkillEntry } from '../catalog/types.js';
import {
  ChainError,
  validateChain,
  type Chain,
  type ChainSessionMode,
  type ChainValidationWarning,
} from '../chains/model.js';
import { HARNESS_IDS, type HarnessId } from '../config/schema.js';
import type { HarnessRegistry } from '../harness/registry.js';
import type {
  ForkMechanism,
  HarnessAdapter,
  HarnessTrustCommand,
} from '../harness/types.js';
import {
  AUTH_EVIDENCE_REASONS,
  collectAuthEvidence,
  redactSecrets,
  runLocalCommand,
  type AuthEvidenceResult,
  type HarnessAuthStrategy,
  type LocalCommandRunner,
} from './auth.js';
import {
  checkFolderTrust,
  TRUST_REASONS,
  type TrustCheckResult,
} from './trust.js';

/**
 * Deterministic preflight engine.
 *
 * The engine validates a chain, resolves inputs and skills, inspects local
 * executable/authentication/trust evidence, and reports a stable list of
 * ordered findings. It deliberately has no route or UI concern: PRE-03 owns
 * the HTTP surface and PRE-04 owns the screen.
 *
 * Hard blocks are the only findings that disable a run. Warnings (including a
 * dirty git tree) never block. Ambiguous authentication or trust evidence is
 * an explicit acknowledgement-required finding, never a silent pass.
 */

export const PREFLIGHT_STATUSES = ['pass', 'warn', 'blocked'] as const;
export type PreflightStatus = (typeof PREFLIGHT_STATUSES)[number];

export const PREFLIGHT_SEVERITIES = ['block', 'warning', 'info'] as const;
export type PreflightSeverity = (typeof PREFLIGHT_SEVERITIES)[number];

export const PREFLIGHT_CHECK_STATUSES = ['pass', 'warn', 'block', 'acknowledge'] as const;
export type PreflightCheckStatus = (typeof PREFLIGHT_CHECK_STATUSES)[number];

export const PREFLIGHT_RUN_MODES = ['supervised', 'automatic'] as const;
export type PreflightRunMode = (typeof PREFLIGHT_RUN_MODES)[number];

export const PREFLIGHT_CHECK_IDS = [
  'chain',
  'request',
  'project',
  'harness',
  'inputs',
  'cli',
  'catalog',
  'skill',
  'authentication',
  'trust',
  'session-mode',
  'fork',
  'permissions',
  'git',
] as const;
export type PreflightCheckId = (typeof PREFLIGHT_CHECK_IDS)[number];

/** Stable acknowledgement keys used by the POST /preflight body. */
export const PREFLIGHT_WARNINGS_ACKNOWLEDGEMENT = 'warnings';
export function authenticationAcknowledgementKey(harness: HarnessId): string {
  return `authentication:${harness}`;
}
export function trustAcknowledgementKey(harness: HarnessId): string {
  return `trust:${harness}`;
}

export interface PreflightCheck {
  /** Stable category; several checks may share one (for example, per step). */
  readonly id: PreflightCheckId;
  /** Unique within a report. */
  readonly key: string;
  readonly severity: PreflightSeverity;
  readonly status: PreflightCheckStatus;
  readonly message: string;
  readonly remediation: string | null;
  readonly details: Record<string, unknown>;
  readonly stepId?: string;
  readonly stepIndex?: number;
  /** Present only on acknowledgement-required findings. */
  readonly acknowledgementKey?: string;
  /** Present only on acknowledgement-required findings. */
  readonly acknowledged?: boolean;
}

export interface PreflightAcknowledgements {
  /** Stable keys needed before a run may start, in check order. */
  readonly required: string[];
  /** Keys the caller supplied as explicitly acknowledged. */
  readonly provided: string[];
  /** Required keys that were not supplied. */
  readonly missing: string[];
}

export interface PreflightSessionPlan {
  readonly sessionMode: ChainSessionMode;
  /** Which command surface the selected run mode uses. */
  readonly surface: 'interactive' | 'headless';
  /** `none` for shared/fresh; native or handoff for a fork chain. */
  readonly mechanism: ForkMechanism;
  readonly nativeFork: boolean;
  readonly description: string;
}

export interface PreflightPermissions {
  readonly mode: PreflightRunMode;
  /** True when the selected run mode uses the automatic command surface. */
  readonly automatic: boolean;
  /** True when broad flags would be passed for this mode. */
  readonly required: boolean;
  readonly optInRequired: boolean;
  readonly optInSatisfied: boolean;
  readonly optInField: string | null;
  /** Exact flags from the adapter descriptor. */
  readonly flags: string[];
  readonly scope: string;
}

export interface PreflightResolvedSkill {
  readonly stepId: string;
  readonly stepIndex: number;
  readonly skillName: string;
  readonly stepLabel: string;
  readonly resolved: boolean;
  readonly entryId: string | null;
  readonly source: string | null;
  readonly path: string | null;
  /** Number of catalog entries sharing the requested name. */
  readonly matchCount: number;
}

export interface PreflightReport {
  readonly status: PreflightStatus;
  /** Convenience gate: no blocks and every required acknowledgement supplied. */
  readonly startAllowed: boolean;
  readonly chain: {
    readonly id: string;
    readonly name: string;
    readonly stepCount: number;
  } | null;
  readonly harness: HarnessId | null;
  readonly displayName: string | null;
  readonly sessionMode: ChainSessionMode | null;
  readonly mode: PreflightRunMode | null;
  /** Ordered findings. Stable for the same inputs. */
  readonly checks: PreflightCheck[];
  readonly resolvedInputs: Record<string, string>;
  readonly skills: PreflightResolvedSkill[];
  readonly catalogWarnings: CatalogWarning[];
  readonly sessionPlan: PreflightSessionPlan | null;
  readonly permissions: PreflightPermissions | null;
  readonly acknowledgements: PreflightAcknowledgements;
}

export interface PreflightRequest {
  /** Decoded chain document. It is validated again at this boundary. */
  readonly chain: unknown;
  /** Canonical project directory resolved from a registered project id. */
  readonly projectPath: string;
  /** Optional selected harness; must match the chain's bound harness. */
  readonly harness?: string | undefined;
  /** Run mode; defaults to supervised. */
  readonly mode?: string | undefined;
  /** Input values keyed by declared input name. */
  readonly inputs?: unknown;
  /** Acknowledgement keys as an array or a `{ key: true }` record. */
  readonly acknowledgements?: unknown;
}

export interface PreflightEngineDependencies {
  readonly catalogService: CatalogService;
  readonly harnessRegistry: HarnessRegistry;
  /** Injected command runner for git and auth evidence. */
  readonly commandRunner?: LocalCommandRunner | undefined;
  /** Injected config reader for trust evidence. */
  readonly readFileText?: ((path: string) => Promise<string>) | undefined;
  /** Injected file-presence probe for auth file evidence. */
  readonly fileExists?: ((path: string) => Promise<boolean>) | undefined;
  readonly homeDirectory?: string | (() => string) | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  /** Override static auth strategies in tests or for a future harness. */
  readonly authStrategies?: readonly HarnessAuthStrategy[] | undefined;
  readonly authTimeoutMs?: number | undefined;
  readonly gitTimeoutMs?: number | undefined;
  /** Git executable name or absolute path. Defaults to `git`. */
  readonly gitExecutable?: string | undefined;
}

export interface PreflightEngine {
  run(request: PreflightRequest): Promise<PreflightReport>;
}

const InputValuesSchema = z.record(z.string(), z.string().nullable());
const AcknowledgementSchema = z.union([
  z.array(z.string().min(1)),
  z.record(z.string(), z.boolean()),
]);
const RunModeSchema = z.enum(PREFLIGHT_RUN_MODES);
const HarnessSchema = z.enum(HARNESS_IDS);

const DEFAULT_GIT_TIMEOUT_MS = 2_000;
const MAX_GIT_STATUS_BYTES = 256 * 1024;
const MAX_REPORTED_GIT_FILES = 50;

/**
 * Create an engine bound to the catalog, harness registry, and injected
 * external seams. Creating an engine performs no I/O.
 */
export function createPreflightEngine(
  dependencies: PreflightEngineDependencies,
): PreflightEngine {
  return {
    run: (request) => executePreflight(request, dependencies),
  };
}

/** One-shot convenience wrapper. */
export function runPreflight(
  request: PreflightRequest,
  dependencies: PreflightEngineDependencies,
): Promise<PreflightReport> {
  return executePreflight(request, dependencies);
}

async function executePreflight(
  request: PreflightRequest,
  dependencies: PreflightEngineDependencies,
): Promise<PreflightReport> {
  const checks: PreflightCheck[] = [];
  const acknowledgementInput = normalizeAcknowledgements(request.acknowledgements);
  if (acknowledgementInput.invalid) {
    checks.push({
      id: 'request',
      key: 'request:acknowledgements',
      severity: 'block',
      status: 'block',
      message: 'The acknowledgement flags are not valid.',
      remediation: 'Send acknowledgement keys as a string array or a boolean record.',
      details: { acknowledgementField: 'acknowledgements' },
    });
  }
  const providedAcknowledgements = acknowledgementInput.provided;

  const requestedMode = request.mode === undefined ? undefined : request.mode;
  const modeResult = requestedMode === undefined ? undefined : RunModeSchema.safeParse(requestedMode);
  let mode: PreflightRunMode | null = requestedMode === undefined ? 'supervised' : null;
  if (modeResult !== undefined) {
    if (modeResult.success) {
      mode = modeResult.data;
    } else {
      checks.push({
        id: 'request',
        key: 'request:mode',
        severity: 'block',
        status: 'block',
        message: 'The run mode is not valid.',
        remediation: 'Use "supervised" or "automatic".',
        details: { field: 'mode', supported: [...PREFLIGHT_RUN_MODES] },
      });
    }
  }

  const projectResult = validateProjectPath(request.projectPath);
  if (!projectResult.ok) {
    checks.push({
      id: 'project',
      key: 'project',
      severity: 'block',
      status: 'block',
      message: projectResult.message,
      remediation: 'Pass the canonical absolute project directory resolved from the project id.',
      details: { field: 'projectPath' },
    });
  }

  const chainResult = parseChain(request.chain);
  if (!chainResult.ok) {
    checks.push({
      id: 'chain',
      key: 'chain',
      severity: 'block',
      status: 'block',
      message: chainResult.message,
      remediation: 'Fix the chain in the builder and run preflight again.',
      details: chainResult.details,
    });

    return finalizeReport({
      checks,
      chain: null,
      harness: null,
      displayName: null,
      sessionMode: null,
      mode,
      resolvedInputs: {},
      skills: [],
      catalogWarnings: [],
      sessionPlan: null,
      permissions: null,
      providedAcknowledgements,
    });
  }

  const chain = chainResult.chain;
  const harness = chain.harness;
  // Accept the short `authentication` / `trust` acknowledgements as aliases for
  // the per-harness keys the report publishes.
  if (providedAcknowledgements.has('authentication')) {
    providedAcknowledgements.add(authenticationAcknowledgementKey(harness));
  }
  if (providedAcknowledgements.has('trust')) {
    providedAcknowledgements.add(trustAcknowledgementKey(harness));
  }
  const adapter = resolveAdapter(dependencies.harnessRegistry, harness, checks);
  const displayName = adapter?.displayName ?? null;

  checks.push({
    id: 'chain',
    key: 'chain',
    severity: 'info',
    status: 'pass',
    message: `Chain "${chain.name}" is valid.`,
    remediation: null,
    details: {
      chainId: chain.id,
      name: chain.name,
      harness,
      sessionMode: chain.sessionMode,
      stepCount: chain.steps.length,
      inputCount: chain.inputs.length,
    },
  });

  appendChainWarnings(checks, chainResult.warnings);

  if (request.harness !== undefined) {
    const requestedHarness = HarnessSchema.safeParse(request.harness);
    if (!requestedHarness.success) {
      checks.push({
        id: 'harness',
        key: 'harness:request',
        severity: 'block',
        status: 'block',
        message: 'The selected harness is not supported.',
        remediation: `Use one of: ${HARNESS_IDS.join(', ')}.`,
        details: { field: 'harness', supported: [...HARNESS_IDS] },
      });
    } else if (requestedHarness.data !== chain.harness) {
      checks.push({
        id: 'harness',
        key: 'harness:mismatch',
        severity: 'block',
        status: 'block',
        message: `The chain is bound to ${chain.harness}, not ${requestedHarness.data}.`,
        remediation:
          'A chain is bound to one harness. Duplicate the chain to run it with another harness.',
        details: {
          field: 'harness',
          chainHarness: chain.harness,
          requestedHarness: requestedHarness.data,
        },
      });
    } else if (adapter !== null) {
      checks.push({
        id: 'harness',
        key: 'harness',
        severity: 'info',
        status: 'pass',
        message: `${adapter.displayName} is the selected harness.`,
        remediation: null,
        details: { harness, displayName: adapter.displayName },
      });
    }
  }

  const inputResult = resolveInputs(chain, request.inputs);
  checks.push(...inputResult.checks);
  const resolvedInputs = inputResult.resolvedInputs;

  const executableResult = resolveExecutable(adapter, checks);

  let catalogWarnings: CatalogWarning[] = [];
  let resolvedSkills: PreflightResolvedSkill[] = [];
  let authResult: AuthEvidenceResult | null = null;
  let trustResult: TrustCheckResult | null = null;
  let gitResult: GitStatusResult | null = null;

  if (projectResult.ok && adapter !== null) {
    const commandRunner = dependencies.commandRunner ?? runLocalCommand;
    const homeDirectory = resolveHomeDirectory(dependencies.homeDirectory);
    const env = dependencies.env ?? process.env;
    const strategy = findStrategy(dependencies.authStrategies ?? [], harness);

    const [catalogOutcome, authOutcome, trustOutcome, gitOutcome] = await Promise.all([
      settle(
        dependencies.catalogService.getCatalog({
          projectPath: projectResult.path,
          harness,
        }),
      ),
      settle(
        collectAuthEvidence({
          harness,
          executable: executableResult.executable,
          cwd: projectResult.path,
          env,
          runner: commandRunner,
          ...(dependencies.authStrategies === undefined
            ? {}
            : { strategy: strategy ?? null }),
          ...(dependencies.authTimeoutMs === undefined
            ? {}
            : { timeoutMs: dependencies.authTimeoutMs }),
          ...(dependencies.fileExists === undefined
            ? {}
            : { fileExists: dependencies.fileExists }),
          ...(homeDirectory === undefined ? {} : { homeDirectory }),
        }),
      ),
      settle(
        checkFolderTrust({
          descriptor: adapter.trust,
          projectPath: projectResult.path,
          ...(homeDirectory === undefined ? {} : { homeDirectory }),
          env,
          ...(dependencies.readFileText === undefined
            ? {}
            : { readFileText: dependencies.readFileText }),
        }),
      ),
      settle(
        inspectGitStatus({
          projectPath: projectResult.path,
          runner: commandRunner,
          executable: dependencies.gitExecutable ?? 'git',
          timeoutMs: dependencies.gitTimeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
          env,
        }),
      ),
    ]);

    if (catalogOutcome.ok) {
      const catalogResult = evaluateCatalog(catalogOutcome.value, chain.steps);
      catalogWarnings = catalogResult.catalogWarnings;
      resolvedSkills = catalogResult.skills;
      checks.push(...catalogResult.checks);
    } else {
      checks.push(catalogFailureCheck(catalogOutcome.error, harness));
    }

    if (authOutcome.ok) {
      authResult = authOutcome.value;
    } else {
      authResult = {
        harness,
        state: 'unknown',
        reason: AUTH_EVIDENCE_REASONS.COMMAND_FAILED,
        evidence: [],
        loginHint: 'Authenticate the harness locally, then re-run preflight.',
      };
    }

    if (trustOutcome.ok) {
      trustResult = trustOutcome.value;
    } else {
      trustResult = {
        behavior: adapter.trust.behavior,
        state: 'unknown',
        trusted: false,
        configPath: adapter.trust.configPath,
        projectPath: projectResult.path,
        reason: TRUST_REASONS.CONFIG_UNREADABLE,
        evidence: [],
      };
    }

    if (gitOutcome.ok) {
      gitResult = gitOutcome.value;
    } else {
      gitResult = {
        state: 'unavailable',
        changedFiles: [],
        count: 0,
        reason: 'GIT_STATUS_FAILED',
      };
    }
  }

  const sessionPlan =
    adapter === null ? null : describeSessionPlan(adapter, chain, mode);

  if (adapter !== null && sessionPlan !== null) {
    checks.push(authenticationCheck(adapter, authResult, providedAcknowledgements));
    checks.push(trustCheck(adapter, trustResult, projectResult.ok ? projectResult.path : null, providedAcknowledgements));
    checks.push(sessionModeCheck(adapter, chain));
    checks.push(forkCheck(sessionPlan, chain));
    checks.push(...permissionChecks(adapter, chain, mode));
  }

  if (gitResult !== null) {
    checks.push(gitCheck(gitResult));
  } else if (projectResult.ok && adapter !== null) {
    checks.push({
      id: 'git',
      key: 'git',
      severity: 'warning',
      status: 'warn',
      message: 'The git working tree could not be inspected.',
      remediation: 'Check the project manually; this warning never blocks a run.',
      details: { state: 'unavailable' },
    });
  }

  return finalizeReport({
    checks,
    chain: {
      id: chain.id,
      name: chain.name,
      stepCount: chain.steps.length,
    },
    harness,
    displayName,
    sessionMode: chain.sessionMode,
    mode,
    resolvedInputs,
    skills: resolvedSkills,
    catalogWarnings,
    sessionPlan,
    permissions:
      adapter === null ? null : describePermissions(adapter, chain, mode),
    providedAcknowledgements,
  });
}

interface FinalizeInput {
  checks: PreflightCheck[];
  chain: { id: string; name: string; stepCount: number } | null;
  harness: HarnessId | null;
  displayName: string | null;
  sessionMode: ChainSessionMode | null;
  mode: PreflightRunMode | null;
  resolvedInputs: Record<string, string>;
  skills: PreflightResolvedSkill[];
  catalogWarnings: CatalogWarning[];
  sessionPlan: PreflightSessionPlan | null;
  permissions: PreflightPermissions | null;
  providedAcknowledgements: ReadonlySet<string>;
}

function finalizeReport(input: FinalizeInput): PreflightReport {
  const hasBlock = input.checks.some((check) => check.status === 'block');
  const hasWarning =
    input.checks.some((check) => check.status === 'warn' || check.status === 'acknowledge') ||
    input.catalogWarnings.length > 0;
  const status: PreflightStatus = hasBlock ? 'blocked' : hasWarning ? 'warn' : 'pass';

  const required: string[] = [];
  for (const check of input.checks) {
    if (check.acknowledgementKey !== undefined && check.status === 'acknowledge') {
      required.push(check.acknowledgementKey);
    }
  }

  const hasPlainWarning =
    input.checks.some((check) => check.status === 'warn') ||
    input.catalogWarnings.length > 0;
  if (hasPlainWarning) {
    required.push(PREFLIGHT_WARNINGS_ACKNOWLEDGEMENT);
  }

  const uniqueRequired = [...new Set(required)];
  const provided = [...input.providedAcknowledgements].sort();
  const missing = uniqueRequired.filter((key) => !input.providedAcknowledgements.has(key));

  return {
    status,
    startAllowed: status !== 'blocked' && missing.length === 0,
    chain: input.chain,
    harness: input.harness,
    displayName: input.displayName,
    sessionMode: input.sessionMode,
    mode: input.mode,
    checks: input.checks,
    resolvedInputs: input.resolvedInputs,
    skills: input.skills,
    catalogWarnings: input.catalogWarnings,
    sessionPlan: input.sessionPlan,
    permissions: input.permissions,
    acknowledgements: {
      required: uniqueRequired,
      provided,
      missing,
    },
  };
}

function parseChain(value: unknown):
  | { ok: true; chain: Chain; warnings: ChainValidationWarning[] }
  | { ok: false; message: string; details: Record<string, unknown> } {
  try {
    const result = validateChain(value);
    return { ok: true, chain: result.chain, warnings: result.warnings };
  } catch (error) {
    if (error instanceof ChainError) {
      return {
        ok: false,
        message: error.message,
        details: { code: error.code, ...error.details },
      };
    }
    return {
      ok: false,
      message: 'The chain could not be validated.',
      details: { code: 'CHAIN_UNREADABLE' },
    };
  }
}

function validateProjectPath(value: unknown):
  | { ok: true; path: string }
  | { ok: false; message: string } {
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: false, message: 'A project directory is required.' };
  }
  if (value.includes('\0') || !isAbsolute(value)) {
    return { ok: false, message: 'The project directory must be an absolute path.' };
  }
  return { ok: true, path: value };
}

function resolveAdapter(
  registry: HarnessRegistry,
  harness: HarnessId,
  checks: PreflightCheck[],
): HarnessAdapter | null {
  try {
    return registry.get(harness);
  } catch (error) {
    checks.push({
      id: 'harness',
      key: 'harness:adapter',
      severity: 'block',
      status: 'block',
      message: 'No harness adapter is registered for the chain harness.',
      remediation: 'Update Slan or choose a supported harness when creating the chain.',
      details: { harness, reason: errorCode(error) },
    });
    return null;
  }
}

function resolveExecutable(
  adapter: HarnessAdapter | null,
  checks: PreflightCheck[],
): { executable: string | null } {
  if (adapter === null) {
    return { executable: null };
  }

  try {
    const resolved = adapter.resolveExecutable();
    checks.push({
      id: 'cli',
      key: 'cli',
      severity: 'info',
      status: 'pass',
      message: `${adapter.displayName} was found at ${resolved.executable}.`,
      remediation: null,
      details: {
        harness: adapter.id,
        executable: resolved.executable,
        source: resolved.source,
        configuredOverride: resolved.configuredOverride,
      },
    });
    return { executable: resolved.executable };
  } catch (error) {
    const details = errorDetails(error);
    checks.push({
      id: 'cli',
      key: 'cli',
      severity: 'block',
      status: 'block',
      message:
        error instanceof Error
          ? error.message
          : `${adapter.displayName} could not be found.`,
      remediation:
        typeof details.installHint === 'string'
          ? details.installHint
          : `Install ${adapter.displayName} and ensure it is on PATH.`,
      details: { harness: adapter.id, ...details },
    });
    return { executable: null };
  }
}

function appendChainWarnings(
  checks: PreflightCheck[],
  warnings: readonly ChainValidationWarning[],
): void {
  warnings.forEach((warning, index) => {
    checks.push({
      id: 'chain',
      key: `chain:warning:${String(index)}`,
      severity: 'warning',
      status: 'warn',
      message: redactSecrets(warning.message),
      remediation: 'Review the chain input declarations.',
      details: { path: warning.path, code: warning.code },
    });
  });
}

interface InputResolution {
  checks: PreflightCheck[];
  resolvedInputs: Record<string, string>;
}

function resolveInputs(chain: Chain, rawInputs: unknown): InputResolution {
  const checks: PreflightCheck[] = [];
  const resolvedInputs: Record<string, string> = {};

  let values: Record<string, string | null> = {};
  if (rawInputs !== undefined && rawInputs !== null) {
    const parsed = InputValuesSchema.safeParse(rawInputs);
    if (!parsed.success) {
      checks.push({
        id: 'inputs',
        key: 'inputs:values',
        severity: 'block',
        status: 'block',
        message: 'The input values are not valid.',
        remediation: 'Send input values as a record of string values.',
        details: {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.map((segment) => String(segment)).join('.'),
            code: issue.code,
            message: issue.message,
          })),
        },
      });
      return { checks, resolvedInputs };
    }
    values = parsed.data;
  }

  const declaredNames = new Set(chain.inputs.map((input) => input.name));
  const unknownNames = Object.keys(values)
    .filter((name) => !declaredNames.has(name))
    .sort();

  const missing: string[] = [];
  for (const input of chain.inputs) {
    const supplied = values[input.name];
    const value =
      supplied !== undefined && supplied !== null
        ? supplied
        : input.defaultValue ?? '';
    resolvedInputs[input.name] = value;

    if (input.required && value.trim() === '') {
      missing.push(input.name);
    }
  }

  if (unknownNames.length > 0) {
    checks.push({
      id: 'inputs',
      key: 'inputs:unknown',
      severity: 'warning',
      status: 'warn',
      message: `Unknown input value(s): ${unknownNames.join(', ')}.`,
      remediation: 'Remove values that the chain does not declare.',
      details: { unknown: unknownNames },
    });
  }

  if (missing.length > 0) {
    checks.push({
      id: 'inputs',
      key: 'inputs:required',
      severity: 'block',
      status: 'block',
      message: `Required input(s) are unresolved: ${missing.join(', ')}.`,
      remediation: 'Provide a nonempty value for every required input.',
      details: { missing },
    });
  }

  checks.push({
    id: 'inputs',
    key: 'inputs',
    severity: missing.length > 0 ? 'block' : 'info',
    status: missing.length > 0 ? 'block' : 'pass',
    message:
      missing.length > 0
        ? 'The chain inputs are not fully resolved.'
        : 'The chain inputs are resolved.',
    remediation: missing.length > 0 ? 'Provide the missing input values.' : null,
    details: {
      declared: [...declaredNames],
      resolved: Object.keys(resolvedInputs),
      missing,
      unknown: unknownNames,
    },
  });

  return { checks, resolvedInputs };
}

interface CatalogEvaluation {
  checks: PreflightCheck[];
  skills: PreflightResolvedSkill[];
  catalogWarnings: CatalogWarning[];
}

interface CatalogStepView {
  readonly id: string;
  readonly skillName: string;
  readonly label?: string | undefined;
}

function evaluateCatalog(
  catalog: Awaited<ReturnType<CatalogService['getCatalog']>>,
  steps: readonly CatalogStepView[],
): CatalogEvaluation {
  const checks: PreflightCheck[] = [];
  const entries = catalog.groups.flatMap((group) => group.entries);

  if (catalog.warnings.length > 0) {
    checks.push({
      id: 'catalog',
      key: 'catalog',
      severity: 'warning',
      status: 'warn',
      message: `Catalog discovery reported ${String(catalog.warnings.length)} warning(s).`,
      remediation: 'Review the catalog warnings; valid entries are still used.',
      details: {
        harness: catalog.harness,
        warningCount: catalog.warnings.length,
        codes: catalog.warnings.map((warning) => warning.code),
      },
    });
  } else {
    checks.push({
      id: 'catalog',
      key: 'catalog',
      severity: 'info',
      status: 'pass',
      message: `Catalog discovery found ${String(entries.length)} skill(s).`,
      remediation: null,
      details: { harness: catalog.harness, total: entries.length },
    });
  }

  const skills: PreflightResolvedSkill[] = [];
  for (const [stepIndex, step] of steps.entries()) {
    const matches = findSkillMatches(entries, step.skillName);
    const first = matches[0];
    const stepLabel = step.label ?? step.skillName;

    skills.push({
      stepId: step.id,
      stepIndex,
      skillName: step.skillName,
      stepLabel,
      resolved: first !== undefined,
      entryId: first?.id ?? null,
      source: first?.source ?? null,
      path: first?.path ?? null,
      matchCount: matches.length,
    });

    if (first === undefined) {
      checks.push({
        id: 'skill',
        key: `skill:${step.id}`,
        severity: 'block',
        status: 'block',
        message: `Step ${String(stepIndex + 1)} "${stepLabel}" references skill "${step.skillName}", which is not in the ${catalog.harness} catalog.`,
        remediation: `Install or add the "${step.skillName}" skill for ${catalog.harness}, or edit the step to use an available skill.`,
        details: {
          harness: catalog.harness,
          stepId: step.id,
          stepIndex,
          stepLabel,
          skillName: step.skillName,
        },
        stepId: step.id,
        stepIndex,
      });
    } else {
      checks.push({
        id: 'skill',
        key: `skill:${step.id}`,
        severity: 'info',
        status: 'pass',
        message: `Step ${String(stepIndex + 1)} "${stepLabel}" resolves to skill "${first.name}".`,
        remediation: null,
        details: {
          harness: catalog.harness,
          stepId: step.id,
          stepIndex,
          stepLabel,
          skillName: step.skillName,
          resolvedName: first.name,
          entryId: first.id,
          source: first.source,
          path: first.path,
          matchCount: matches.length,
        },
        stepId: step.id,
        stepIndex,
      });
    }
  }

  return { checks, skills, catalogWarnings: [...catalog.warnings] };
}

function findSkillMatches(entries: readonly SkillEntry[], skillName: string): SkillEntry[] {
  // A disabled catalog entry cannot be loaded by the harness, so it does not
  // resolve the step.
  const usable = entries.filter((entry) => entry.enabled !== false);
  const exact = usable.filter((entry) => entry.name === skillName);
  if (exact.length > 0) {
    return exact;
  }
  const lowered = skillName.toLocaleLowerCase('en-US');
  return usable.filter((entry) => entry.name.toLocaleLowerCase('en-US') === lowered);
}

function catalogFailureCheck(error: unknown, harness: HarnessId): PreflightCheck {
  return {
    id: 'catalog',
    key: 'catalog',
    severity: 'block',
    status: 'block',
    message: 'The skill catalog could not be read for this harness.',
    remediation:
      'Fix the catalog discovery error and run preflight again; an empty catalog is not assumed.',
    details: {
      harness,
      code: errorCode(error),
      ...safeErrorDetails(error),
    },
  };
}

function authenticationCheck(
  adapter: HarnessAdapter,
  result: AuthEvidenceResult | null,
  provided: ReadonlySet<string>,
): PreflightCheck {
  if (result === null) {
    return {
      id: 'authentication',
      key: 'authentication',
      severity: 'block',
      status: 'block',
      message: `Authentication evidence for ${adapter.displayName} could not be inspected.`,
      remediation: 'Authenticate the harness locally and run preflight again.',
      details: { harness: adapter.id, state: 'unknown' },
    };
  }

  if (result.state === 'authenticated') {
    return {
      id: 'authentication',
      key: 'authentication',
      severity: 'info',
      status: 'pass',
      message: `Local authentication evidence was found for ${adapter.displayName}.`,
      remediation: null,
      details: {
        harness: adapter.id,
        state: result.state,
        reason: result.reason,
        evidence: result.evidence,
      },
    };
  }

  if (result.state === 'unauthenticated') {
    return {
      id: 'authentication',
      key: 'authentication',
      severity: 'block',
      status: 'block',
      message: `${adapter.displayName} reported that it is not authenticated.`,
      remediation: result.loginHint,
      details: {
        harness: adapter.id,
        state: result.state,
        reason: result.reason,
        evidence: result.evidence,
      },
    };
  }

  const key = authenticationAcknowledgementKey(adapter.id);
  return {
    id: 'authentication',
    key: 'authentication',
    severity: 'warning',
    status: 'acknowledge',
    message: `Authentication for ${adapter.displayName} could not be verified automatically.`,
    remediation: `${result.loginHint} If you have already authenticated, acknowledge this finding explicitly.`,
    details: {
      harness: adapter.id,
      state: result.state,
      reason: result.reason,
      evidence: result.evidence,
      acknowledgementKey: key,
    },
    acknowledgementKey: key,
    acknowledged: provided.has(key),
  };
}

function trustCheck(
  adapter: HarnessAdapter,
  result: TrustCheckResult | null,
  projectPath: string | null,
  provided: ReadonlySet<string>,
): PreflightCheck {
  if (adapter.trust.behavior === 'none') {
    return {
      id: 'trust',
      key: 'trust',
      severity: 'info',
      status: 'pass',
      message: `${adapter.displayName} does not require folder trust.`,
      remediation: null,
      details: { harness: adapter.id, behavior: adapter.trust.behavior, state: 'not-required' },
    };
  }

  const manualFallback = buildManualTrustFallback(adapter, projectPath);
  const baseDetails = {
    harness: adapter.id,
    behavior: adapter.trust.behavior,
    configPath: result?.configPath ?? adapter.trust.configPath,
    projectPath,
    reason: result?.reason ?? TRUST_REASONS.CONFIG_UNREADABLE,
    evidence: result?.evidence ?? [],
    ...(manualFallback === null ? {} : { manualCommand: manualFallback }),
  };

  if (result === null) {
    const key = trustAcknowledgementKey(adapter.id);
    return {
      id: 'trust',
      key: 'trust',
      severity: 'warning',
      status: 'acknowledge',
      message: `Folder trust for ${adapter.displayName} could not be inspected.`,
      remediation:
        'Open the trust terminal in the project, accept the dialog, then verify trust. If the CLI cannot persist trust, acknowledge the manual fallback.',
      details: { ...baseDetails, state: 'unknown', acknowledgementKey: key },
      acknowledgementKey: key,
      acknowledged: provided.has(key),
    };
  }

  if (result.state === 'trusted') {
    return {
      id: 'trust',
      key: 'trust',
      severity: 'info',
      status: 'pass',
      message: `The project folder is trusted by ${adapter.displayName}.`,
      remediation: null,
      details: { ...baseDetails, state: result.state },
    };
  }

  if (result.state === 'untrusted') {
    return {
      id: 'trust',
      key: 'trust',
      severity: 'block',
      status: 'block',
      message: `The project folder is not trusted by ${adapter.displayName}.`,
      remediation:
        'Open the trust terminal in the project, accept the folder-trust dialog, then verify trust before starting the run.',
      details: { ...baseDetails, state: result.state },
    };
  }

  const key = trustAcknowledgementKey(adapter.id);
  return {
    id: 'trust',
    key: 'trust',
    severity: 'warning',
    status: 'acknowledge',
    message: `Folder trust for ${adapter.displayName} could not be verified automatically.`,
    remediation:
      'Accept the folder-trust dialog in the trust terminal and verify trust. If trust cannot be persisted, acknowledge the manual fallback explicitly.',
    details: { ...baseDetails, state: result.state, acknowledgementKey: key },
    acknowledgementKey: key,
    acknowledged: provided.has(key),
  };
}

function buildManualTrustFallback(
  adapter: HarnessAdapter,
  projectPath: string | null,
): HarnessTrustCommand | null {
  if (projectPath === null || adapter.buildTrustCommand === undefined) {
    return null;
  }
  try {
    return adapter.buildTrustCommand({ projectPath });
  } catch {
    return null;
  }
}

function sessionModeCheck(adapter: HarnessAdapter, chain: Chain): PreflightCheck {
  if (!adapter.supportsSessionMode(chain.sessionMode)) {
    return {
      id: 'session-mode',
      key: 'session-mode',
      severity: 'block',
      status: 'block',
      message: `${adapter.displayName} does not support the "${chain.sessionMode}" session mode.`,
      remediation: `Change the chain session mode to one of: ${adapter.supportedSessionModes.join(', ')}.`,
      details: {
        harness: adapter.id,
        sessionMode: chain.sessionMode,
        supported: [...adapter.supportedSessionModes],
      },
    };
  }

  return {
    id: 'session-mode',
    key: 'session-mode',
    severity: 'info',
    status: 'pass',
    message: `${adapter.displayName} supports the "${chain.sessionMode}" session mode.`,
    remediation: null,
    details: {
      harness: adapter.id,
      sessionMode: chain.sessionMode,
      supported: [...adapter.supportedSessionModes],
    },
  };
}

function describeSessionPlan(
  adapter: HarnessAdapter,
  chain: Chain,
  mode: PreflightRunMode | null,
): PreflightSessionPlan {
  const surface: 'interactive' | 'headless' = mode === 'automatic' ? 'headless' : 'interactive';
  const availableMechanism = adapter.forkMechanisms[surface];
  const mechanism: ForkMechanism =
    chain.sessionMode === 'fork' ? availableMechanism : 'none';

  let description: string;
  if (chain.sessionMode === 'shared') {
    description = 'One session id is reused for every step.';
  } else if (chain.sessionMode === 'fresh') {
    description = 'A new session id is created for every step.';
  } else if (mechanism === 'native') {
    description = `${adapter.displayName} will create a native fork of the previous session.`;
  } else if (mechanism === 'handoff') {
    description = `${adapter.displayName} has no native fork on the ${surface} surface; Slan will start a new session with a deterministic handoff note.`;
  } else {
    description = `${adapter.displayName} cannot fork a session on the ${surface} surface.`;
  }

  return {
    sessionMode: chain.sessionMode,
    surface,
    mechanism,
    nativeFork: adapter.nativeFork,
    description,
  };
}

function forkCheck(plan: PreflightSessionPlan, chain: Chain): PreflightCheck {
  if (chain.sessionMode === 'fork' && plan.mechanism === 'none') {
    return {
      id: 'fork',
      key: 'fork',
      severity: 'block',
      status: 'block',
      message: 'The selected harness cannot fork a session for this run mode.',
      remediation: 'Choose the shared or fresh session mode, or use a harness with fork support.',
      details: {
        sessionMode: chain.sessionMode,
        surface: plan.surface,
        mechanism: plan.mechanism,
      },
    };
  }

  return {
    id: 'fork',
    key: 'fork',
    severity: 'info',
    status: 'pass',
    message: plan.description,
    remediation: null,
    details: {
      sessionMode: plan.sessionMode,
      surface: plan.surface,
      mechanism: plan.mechanism,
      nativeFork: plan.nativeFork,
    },
  };
}

function describePermissions(
  adapter: HarnessAdapter,
  chain: Chain,
  mode: PreflightRunMode | null,
): PreflightPermissions {
  const automatic = mode === 'automatic';
  const flags = [...adapter.automaticPermissions];
  const optInRequired = adapter.requiresAutomaticPermissionOptIn;
  const optInSatisfied = !optInRequired || chain.automaticPermissionOptIn === true;

  return {
    mode: mode ?? 'supervised',
    automatic,
    required: automatic && flags.length > 0,
    optInRequired,
    optInSatisfied,
    optInField: adapter.permissionOptInField,
    flags,
    scope:
      flags.length === 0
        ? 'No broad permission flags are required.'
        : `Broad access granted by ${flags.join(' ')} for automatic steps.`,
  };
}

function permissionChecks(
  adapter: HarnessAdapter,
  chain: Chain,
  mode: PreflightRunMode | null,
): PreflightCheck[] {
  const permissions = describePermissions(adapter, chain, mode);
  const checks: PreflightCheck[] = [];

  if (permissions.automatic && permissions.optInRequired && !permissions.optInSatisfied) {
    checks.push({
      id: 'permissions',
      key: 'permissions',
      severity: 'block',
      status: 'block',
      message: `Automatic ${adapter.displayName} runs require the per-chain permission opt-in.`,
      remediation:
        'Enable automatic permissions on this chain after reviewing the exact flags and scope shown in this report.',
      details: { ...permissions },
    });
    return checks;
  }

  checks.push({
    id: 'permissions',
    key: 'permissions',
    severity: 'info',
    status: 'pass',
    message: permissions.automatic
      ? permissions.flags.length > 0
        ? `Automatic mode will pass ${permissions.flags.join(' ')}.`
        : 'Automatic mode requires no broad permission flags.'
      : 'Supervised mode does not use automatic permission flags.',
    remediation: null,
    details: { ...permissions },
  });

  return checks;
}

interface GitStatusResult {
  readonly state: 'clean' | 'dirty' | 'not-repository' | 'unavailable';
  readonly changedFiles: string[];
  readonly count: number;
  readonly reason?: string;
}

interface GitStatusOptions {
  readonly projectPath: string;
  readonly executable: string;
  readonly runner: LocalCommandRunner;
  readonly timeoutMs: number;
  readonly env: NodeJS.ProcessEnv;
}

async function inspectGitStatus(options: GitStatusOptions): Promise<GitStatusResult> {
  const result = await options.runner({
    executable: options.executable,
    args: ['status', '--porcelain'],
    cwd: options.projectPath,
    timeoutMs: options.timeoutMs,
    env: options.env,
    maxOutputBytes: MAX_GIT_STATUS_BYTES,
  });

  if (result.timedOut) {
    return { state: 'unavailable', changedFiles: [], count: 0, reason: 'GIT_TIMEOUT' };
  }
  if (result.spawnError !== null) {
    return {
      state: 'unavailable',
      changedFiles: [],
      count: 0,
      reason: result.spawnError,
    };
  }
  if (result.exitCode !== 0) {
    if (/not a git repository/i.test(result.stderr) || /not a git repository/i.test(result.stdout)) {
      return { state: 'not-repository', changedFiles: [], count: 0 };
    }
    return {
      state: 'unavailable',
      changedFiles: [],
      count: 0,
      reason: `GIT_EXIT_${String(result.exitCode ?? 'NULL')}`,
    };
  }

  const lines = result.stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '');

  if (lines.length === 0) {
    return { state: 'clean', changedFiles: [], count: 0 };
  }

  return {
    state: 'dirty',
    changedFiles: lines.slice(0, MAX_REPORTED_GIT_FILES),
    count: lines.length,
  };
}

function gitCheck(result: GitStatusResult): PreflightCheck {
  if (result.state === 'dirty') {
    return {
      id: 'git',
      key: 'git',
      severity: 'warning',
      status: 'warn',
      message: `The project has ${String(result.count)} uncommitted change(s).`,
      remediation: 'Commit or stash the changes if you want a clean starting point. This warning never blocks a run.',
      details: {
        state: result.state,
        count: result.count,
        files: result.changedFiles,
        truncated: result.count > result.changedFiles.length,
      },
    };
  }

  if (result.state === 'not-repository') {
    return {
      id: 'git',
      key: 'git',
      severity: 'info',
      status: 'pass',
      message: 'The project is not a git repository; the dirty-tree check was skipped.',
      remediation: null,
      details: { state: result.state },
    };
  }

  if (result.state === 'unavailable') {
    return {
      id: 'git',
      key: 'git',
      severity: 'warning',
      status: 'warn',
      message: 'The git working tree could not be inspected.',
      remediation: 'Check the project manually; this warning never blocks a run.',
      details: { state: result.state, reason: result.reason ?? null },
    };
  }

  return {
    id: 'git',
    key: 'git',
    severity: 'info',
    status: 'pass',
    message: 'The git working tree is clean.',
    remediation: null,
    details: { state: result.state },
  };
}

function normalizeAcknowledgements(value: unknown): {
  provided: Set<string>;
  invalid: boolean;
} {
  if (value === undefined || value === null) {
    return { provided: new Set(), invalid: false };
  }

  const parsed = AcknowledgementSchema.safeParse(value);
  if (!parsed.success) {
    return { provided: new Set(), invalid: true };
  }

  if (Array.isArray(parsed.data)) {
    return { provided: new Set(parsed.data), invalid: false };
  }

  const provided = new Set<string>();
  for (const [key, acknowledged] of Object.entries(parsed.data)) {
    if (acknowledged) {
      provided.add(key);
    }
  }
  return { provided, invalid: false };
}

function findStrategy(
  strategies: readonly HarnessAuthStrategy[],
  harness: HarnessId,
): HarnessAuthStrategy | undefined {
  return strategies.find((strategy) => strategy.harness === harness);
}

function resolveHomeDirectory(
  value: string | (() => string) | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'function' ? value() : value;
}

async function settle<T>(
  promise: Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}

function errorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }
  return 'UNKNOWN';
}

function errorDetails(error: unknown): Record<string, unknown> {
  if (
    typeof error === 'object' &&
    error !== null &&
    'details' in error &&
    typeof (error as { details?: unknown }).details === 'object' &&
    (error as { details?: unknown }).details !== null
  ) {
    return redactRecord((error as { details: Record<string, unknown> }).details);
  }
  return {};
}

function safeErrorDetails(error: unknown): Record<string, unknown> {
  return errorDetails(error);
}

function redactRecord(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      output[key] = redactSecrets(entry);
    } else if (Array.isArray(entry)) {
      output[key] = entry.map((item) =>
        typeof item === 'string' ? redactSecrets(item) : item,
      );
    } else {
      output[key] = entry;
    }
  }
  return output;
}
