import {
  ApiClientError,
  requestJson,
  type FetchLike,
  type RequestJsonOptions,
} from './client';

/**
 * Typed client for the run-start preflight and Copilot folder-trust API.
 *
 * The browser never starts a run and never spawns a harness. It sends the
 * selected chain, mode, input values, and explicit acknowledgement keys, then
 * renders the deterministic report the server returns. Trust start and verify
 * only address a registered project id; the server owns the PTY session.
 */

export const PREFLIGHT_STATUSES = ['pass', 'warn', 'blocked'] as const;
export type PreflightStatus = (typeof PREFLIGHT_STATUSES)[number];

export const PREFLIGHT_SEVERITIES = ['block', 'warning', 'info'] as const;
export type PreflightSeverity = (typeof PREFLIGHT_SEVERITIES)[number];

export const PREFLIGHT_CHECK_STATUSES = ['pass', 'warn', 'block', 'acknowledge'] as const;
export type PreflightCheckStatus = (typeof PREFLIGHT_CHECK_STATUSES)[number];

export const PREFLIGHT_RUN_MODES = ['supervised', 'automatic'] as const;
export type PreflightRunMode = (typeof PREFLIGHT_RUN_MODES)[number];

export type PreflightHarness = 'opencode' | 'copilot';
export type PreflightSessionMode = 'shared' | 'fresh' | 'fork';
export type PreflightForkMechanism = 'none' | 'native' | 'handoff';

const HARNESSES = ['opencode', 'copilot'] as const;
const SESSION_MODES = ['shared', 'fresh', 'fork'] as const;
const SESSION_SURFACES = ['interactive', 'headless'] as const;
const FORK_MECHANISMS = ['none', 'native', 'handoff'] as const;

/** One ordered finding inside a report. */
export interface PreflightCheck {
  id: string;
  key: string;
  severity: PreflightSeverity;
  status: PreflightCheckStatus;
  message: string;
  remediation: string | null;
  details: Record<string, unknown>;
  stepId?: string;
  stepIndex?: number;
  acknowledgementKey?: string;
  acknowledged?: boolean;
}

export interface PreflightAcknowledgements {
  required: string[];
  provided: string[];
  missing: string[];
}

export interface PreflightSessionPlan {
  sessionMode: PreflightSessionMode;
  surface: 'interactive' | 'headless';
  mechanism: PreflightForkMechanism;
  nativeFork: boolean;
  description: string;
}

export interface PreflightPermissions {
  mode: PreflightRunMode;
  automatic: boolean;
  required: boolean;
  optInRequired: boolean;
  optInSatisfied: boolean;
  optInField: string | null;
  flags: string[];
  scope: string;
}

export interface PreflightResolvedSkill {
  stepId: string;
  stepIndex: number;
  skillName: string;
  stepLabel: string;
  resolved: boolean;
  entryId: string | null;
  source: string | null;
  path: string | null;
  matchCount: number;
}

export interface PreflightCatalogWarning {
  code: string;
  message: string;
  path: string;
  reason?: string;
  source?: string;
}

export interface PreflightChainSummary {
  id: string;
  name: string;
  stepCount: number;
}

/** The structured report returned by `POST /api/projects/:projectId/preflight`. */
export interface PreflightReport {
  status: PreflightStatus;
  startAllowed: boolean;
  chain: PreflightChainSummary | null;
  harness: PreflightHarness | null;
  displayName: string | null;
  sessionMode: PreflightSessionMode | null;
  mode: PreflightRunMode | null;
  checks: PreflightCheck[];
  resolvedInputs: Record<string, string>;
  skills: PreflightResolvedSkill[];
  catalogWarnings: PreflightCatalogWarning[];
  sessionPlan: PreflightSessionPlan | null;
  permissions: PreflightPermissions | null;
  acknowledgements: PreflightAcknowledgements;
}

export interface PreflightRequest {
  chainId: string;
  harness?: PreflightHarness;
  mode?: PreflightRunMode;
  inputs?: Record<string, string | null>;
  acknowledgements?: string[];
}

export interface TrustCommand {
  harness: PreflightHarness;
  executable: string;
  args: string[];
  cwd: string;
}

export interface TrustStartResult {
  action: 'start';
  harness: PreflightHarness;
  displayName: string;
  projectPath: string;
  sessionId: string;
  terminalPath: string;
  manualCommandText: string;
  startedAt: string;
}

export interface TrustVerifyResult {
  action: 'verify';
  harness: PreflightHarness;
  displayName: string;
  projectPath: string;
  sessionId: string | null;
  closed: boolean;
  trusted: boolean;
  state: string;
  reason: string;
  configPath: string | null;
  manualCommandText: string | null;
  remediation: string;
}

export interface PreflightRequestOptions {
  signal?: AbortSignal;
}

export interface PreflightApi {
  runPreflight: (
    projectId: string,
    request: PreflightRequest,
    options?: PreflightRequestOptions,
  ) => Promise<PreflightReport>;
  startTrust: (
    projectId: string,
    harness: PreflightHarness,
    options?: PreflightRequestOptions,
  ) => Promise<TrustStartResult>;
  verifyTrust: (
    projectId: string,
    harness: PreflightHarness,
    sessionId?: string,
    options?: PreflightRequestOptions,
  ) => Promise<TrustVerifyResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function invalidResponse(what: string): ApiClientError {
  return new ApiClientError(
    `The Slan server returned an unexpected ${what} response.`,
    { code: 'INVALID_RESPONSE', status: 200 },
  );
}

function decodeEnum<T extends string>(
  value: unknown,
  supported: readonly T[],
  what: string,
): T {
  if (typeof value === 'string' && (supported as readonly string[]).includes(value)) {
    return value as T;
  }
  throw invalidResponse(what);
}

function decodeStringArray(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw invalidResponse(what);
  }
  return [...value];
}

function decodeCheck(value: unknown): PreflightCheck {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.key) ||
    !isNonEmptyString(value.message) ||
    !isRecord(value.details)
  ) {
    throw invalidResponse('preflight finding');
  }

  const decoded: PreflightCheck = {
    id: value.id,
    key: value.key,
    severity: decodeEnum(value.severity, PREFLIGHT_SEVERITIES, 'preflight severity'),
    status: decodeEnum(value.status, PREFLIGHT_CHECK_STATUSES, 'preflight finding status'),
    message: value.message,
    remediation: typeof value.remediation === 'string' ? value.remediation : null,
    details: value.details,
  };

  if (typeof value.stepId === 'string') {
    decoded.stepId = value.stepId;
  }
  if (typeof value.stepIndex === 'number' && Number.isInteger(value.stepIndex)) {
    decoded.stepIndex = value.stepIndex;
  }
  if (typeof value.acknowledgementKey === 'string') {
    decoded.acknowledgementKey = value.acknowledgementKey;
  }
  if (typeof value.acknowledged === 'boolean') {
    decoded.acknowledged = value.acknowledged;
  }

  return decoded;
}

function decodeSessionPlan(value: unknown): PreflightSessionPlan | null {
  if (value === null) {
    return null;
  }
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.description) ||
    typeof value.nativeFork !== 'boolean'
  ) {
    throw invalidResponse('preflight session plan');
  }

  return {
    sessionMode: decodeEnum(value.sessionMode, SESSION_MODES, 'session mode'),
    surface: decodeEnum(value.surface, SESSION_SURFACES, 'session surface'),
    mechanism: decodeEnum(value.mechanism, FORK_MECHANISMS, 'fork mechanism'),
    nativeFork: value.nativeFork,
    description: value.description,
  };
}

function decodePermissions(value: unknown): PreflightPermissions | null {
  if (value === null) {
    return null;
  }
  if (
    !isRecord(value) ||
    typeof value.automatic !== 'boolean' ||
    typeof value.required !== 'boolean' ||
    typeof value.optInRequired !== 'boolean' ||
    typeof value.optInSatisfied !== 'boolean' ||
    !isNonEmptyString(value.scope)
  ) {
    throw invalidResponse('preflight permissions');
  }

  return {
    mode: decodeEnum(value.mode, PREFLIGHT_RUN_MODES, 'run mode'),
    automatic: value.automatic,
    required: value.required,
    optInRequired: value.optInRequired,
    optInSatisfied: value.optInSatisfied,
    optInField: typeof value.optInField === 'string' ? value.optInField : null,
    flags: decodeStringArray(value.flags, 'permission flags'),
    scope: value.scope,
  };
}

function decodeSkill(value: unknown): PreflightResolvedSkill {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.stepId) ||
    typeof value.stepIndex !== 'number' ||
    !isNonEmptyString(value.skillName) ||
    !isNonEmptyString(value.stepLabel) ||
    typeof value.resolved !== 'boolean' ||
    typeof value.matchCount !== 'number'
  ) {
    throw invalidResponse('preflight skill resolution');
  }

  return {
    stepId: value.stepId,
    stepIndex: value.stepIndex,
    skillName: value.skillName,
    stepLabel: value.stepLabel,
    resolved: value.resolved,
    entryId: typeof value.entryId === 'string' ? value.entryId : null,
    source: typeof value.source === 'string' ? value.source : null,
    path: typeof value.path === 'string' ? value.path : null,
    matchCount: value.matchCount,
  };
}

function decodeCatalogWarning(value: unknown): PreflightCatalogWarning {
  if (!isRecord(value) || !isNonEmptyString(value.code) || !isNonEmptyString(value.message)) {
    throw invalidResponse('catalog warning');
  }

  const decoded: PreflightCatalogWarning = {
    code: value.code,
    message: value.message,
    path: typeof value.path === 'string' ? value.path : '',
  };
  if (typeof value.reason === 'string') {
    decoded.reason = value.reason;
  }
  if (typeof value.source === 'string') {
    decoded.source = value.source;
  }
  return decoded;
}

function decodeReport(value: unknown): PreflightReport {
  if (
    !isRecord(value) ||
    !Array.isArray(value.checks) ||
    !Array.isArray(value.skills) ||
    !Array.isArray(value.catalogWarnings) ||
    !isRecord(value.resolvedInputs) ||
    !isRecord(value.acknowledgements)
  ) {
    throw invalidResponse('preflight report');
  }

  const chain =
    value.chain === null
      ? null
      : isRecord(value.chain) &&
          isNonEmptyString(value.chain.id) &&
          isNonEmptyString(value.chain.name) &&
          typeof value.chain.stepCount === 'number'
        ? {
            id: value.chain.id,
            name: value.chain.name,
            stepCount: value.chain.stepCount,
          }
        : (() => {
            throw invalidResponse('preflight chain summary');
          })();

  const resolvedInputs: Record<string, string> = {};
  for (const [name, entry] of Object.entries(value.resolvedInputs)) {
    if (typeof entry !== 'string') {
      throw invalidResponse('resolved inputs');
    }
    resolvedInputs[name] = entry;
  }

  const acknowledgements = value.acknowledgements;
  if (
    !Array.isArray(acknowledgements.required) ||
    !Array.isArray(acknowledgements.provided) ||
    !Array.isArray(acknowledgements.missing)
  ) {
    throw invalidResponse('preflight acknowledgements');
  }

  return {
    status: decodeEnum(value.status, PREFLIGHT_STATUSES, 'preflight status'),
    startAllowed: value.startAllowed === true,
    chain,
    harness:
      value.harness === null
        ? null
        : decodeEnum(value.harness, HARNESSES, 'harness'),
    displayName: typeof value.displayName === 'string' ? value.displayName : null,
    sessionMode:
      value.sessionMode === null
        ? null
        : decodeEnum(value.sessionMode, SESSION_MODES, 'session mode'),
    mode: value.mode === null ? null : decodeEnum(value.mode, PREFLIGHT_RUN_MODES, 'run mode'),
    checks: value.checks.map(decodeCheck),
    resolvedInputs,
    skills: value.skills.map(decodeSkill),
    catalogWarnings: value.catalogWarnings.map(decodeCatalogWarning),
    sessionPlan: decodeSessionPlan(value.sessionPlan),
    permissions: decodePermissions(value.permissions),
    acknowledgements: {
      required: decodeStringArray(acknowledgements.required, 'required acknowledgements'),
      provided: decodeStringArray(acknowledgements.provided, 'provided acknowledgements'),
      missing: decodeStringArray(acknowledgements.missing, 'missing acknowledgements'),
    },
  };
}

function decodeTrustStart(value: unknown): TrustStartResult {
  if (
    !isRecord(value) ||
    value.action !== 'start' ||
    !isNonEmptyString(value.displayName) ||
    !isNonEmptyString(value.projectPath) ||
    !isNonEmptyString(value.sessionId) ||
    !isNonEmptyString(value.terminalPath) ||
    !isNonEmptyString(value.startedAt)
  ) {
    throw invalidResponse('trust session');
  }

  return {
    action: 'start',
    harness: decodeEnum(value.harness, HARNESSES, 'harness'),
    displayName: value.displayName,
    projectPath: value.projectPath,
    sessionId: value.sessionId,
    terminalPath: value.terminalPath,
    manualCommandText:
      typeof value.manualCommandText === 'string' ? value.manualCommandText : '',
    startedAt: value.startedAt,
  };
}

function decodeTrustVerify(value: unknown): TrustVerifyResult {
  if (
    !isRecord(value) ||
    value.action !== 'verify' ||
    !isNonEmptyString(value.displayName) ||
    !isNonEmptyString(value.projectPath) ||
    typeof value.trusted !== 'boolean' ||
    !isNonEmptyString(value.state) ||
    !isNonEmptyString(value.reason) ||
    !isNonEmptyString(value.remediation)
  ) {
    throw invalidResponse('trust verification');
  }

  return {
    action: 'verify',
    harness: decodeEnum(value.harness, ['opencode', 'copilot'], 'harness'),
    displayName: value.displayName,
    projectPath: value.projectPath,
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : null,
    closed: value.closed === true,
    trusted: value.trusted,
    state: value.state,
    reason: value.reason,
    configPath: typeof value.configPath === 'string' ? value.configPath : null,
    manualCommandText:
      typeof value.manualCommandText === 'string' ? value.manualCommandText : null,
    remediation: value.remediation,
  };
}

function optionsFor(signal: AbortSignal | undefined): RequestJsonOptions {
  return signal === undefined ? {} : { signal };
}

function preflightPath(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/preflight`;
}

function trustPath(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/trust`;
}

export function createPreflightApi(fetchImpl: FetchLike = fetch): PreflightApi {
  return {
    async runPreflight(projectId, request, options = {}): Promise<PreflightReport> {
      const value = await requestJson<unknown>(
        preflightPath(projectId),
        {
          method: 'POST',
          body: request,
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      return decodeReport(value);
    },

    async startTrust(projectId, harness, options = {}): Promise<TrustStartResult> {
      const value = await requestJson<unknown>(
        trustPath(projectId),
        {
          method: 'POST',
          body: { action: 'start', harness },
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      return decodeTrustStart(value);
    },

    async verifyTrust(projectId, harness, sessionId, options = {}): Promise<TrustVerifyResult> {
      const body: Record<string, unknown> = { action: 'verify', harness };
      if (sessionId !== undefined) {
        body.sessionId = sessionId;
      }
      const value = await requestJson<unknown>(
        trustPath(projectId),
        {
          method: 'POST',
          body,
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      return decodeTrustVerify(value);
    },
  };
}

/** Same-origin client; Vite proxies /api in development. */
export const preflightApi = createPreflightApi();
