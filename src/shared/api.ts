/**
 * Shared JSON API contracts for the Skill Loom server and web client.
 *
 * Every API failure uses a single envelope so the browser never has to infer
 * an error shape from a status code:
 *
 *   { "error": { "code": "...", "message": "...", "details": { ... } } }
 *
 * `details` is optional and deliberately typed as `unknown`: later features
 * attach field-specific validation issues, conflicting resource ids, or
 * preflight reports without changing the envelope.
 */

/** Stable error codes used by the v1 API surface. */
export const API_ERROR_CODES = {
  NOT_FOUND: 'NOT_FOUND',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

/** A field-specific validation issue used by 422 responses. */
export interface ApiValidationIssue {
  /** Dot-separated path to the invalid field, or an empty string for the body. */
  path: string;
  /** Stable machine-readable issue code, for example `invalid_type`. */
  code: string;
  /** Human-readable explanation when one is available. */
  message?: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiErrorEnvelope {
  error: ApiError;
}

/** Build the shared failure envelope. */
export function createApiErrorEnvelope(
  code: string,
  message: string,
  details?: unknown,
): ApiErrorEnvelope {
  const error: ApiError = { code, message };
  if (details !== undefined) {
    error.details = details;
  }
  return { error };
}

/**
 * Narrow an unknown decoded JSON value to the shared error envelope. The web
 * client uses this instead of trusting that a failed request returned JSON.
 */
export function isApiErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (!isRecord(value) || !isRecord(value.error)) {
    return false;
  }

  const { code, message } = value.error;
  return typeof code === 'string' && code !== '' && typeof message === 'string';
}

/** Active-run summary from the existing owner or its persisted pointer. */
export interface ActiveRunSummary {
  active: boolean;
  runId: string | null;
  status: string | null;
}

/** The documented `GET /api/health` response. */
export interface HealthResponse {
  status: 'ok';
  /** Package version from the root package.json. */
  version: string;
  /** Resolved global Skill Loom config directory (never the file contents). */
  configDirectory: string;
  /** Port the server is configured to use. */
  port: number;
  activeRun: ActiveRunSummary;
}

/** Empty summary when there is no active-run pointer. */
export function createInactiveRunSummary(): ActiveRunSummary {
  return { active: false, runId: null, status: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
