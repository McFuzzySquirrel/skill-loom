import { createHash } from 'node:crypto';

/**
 * Catalog domain types shared by every harness adapter.
 *
 * A discovery adapter only reads metadata. It never executes a skill, never
 * invokes a model, and never invents a description. Every field below either
 * came from the harness or was derived mechanically from a path, a directory
 * name, or a configured source label.
 */

/** Harnesses supported by the v1 adapter registry. */
export const SKILL_HARNESSES = ['opencode', 'copilot'] as const;
export type SkillHarness = (typeof SKILL_HARNESSES)[number];

/**
 * Source labels rendered as badges by the catalog. `loom-extra` is the global
 * extra-directory source owned by Skill Loom; the remaining labels come from the
 * harness (project-local, personal, plugin, custom, builtin).
 */
export const SKILL_SOURCES = [
  'project',
  'personal',
  'custom',
  'plugin',
  'builtin',
  'loom-extra',
  'remote',
] as const;
export type SkillSource = (typeof SKILL_SOURCES)[number];
/** Internal verification data; symbol keys are omitted from catalog JSON. */
export const REMOTE_SNAPSHOT_CONTENT = Symbol('remote-snapshot-content');

/** Display and grouping order from the skill-catalog feature document. */
export const SKILL_SOURCE_ORDER: readonly SkillSource[] = SKILL_SOURCES;

/**
 * Ranked retrieval metadata supplied by the derived capability index. A plain
 * catalog scan omits it because a scan does not rank or excerpt candidates.
 */
export interface SkillMatch {
  /** Ranking score; higher is better for the token table and lower for BM25. */
  score: number;
  /** Bounded excerpt around the best matching field. */
  snippet: string;
}

/** One discovered skill package. */
export interface SkillEntry {
  /**
   * Stable id derived from harness, source, canonical path, and name. The
   * digest makes collisions across sources and duplicate names impossible.
   */
  id: string;
  harness: SkillHarness;
  source: SkillSource;
  /** Frontmatter `name`, or the package directory basename as a fallback. */
  name: string;
  /** Frontmatter `description`, or an empty string when absent. */
  description: string;
  /** Canonical absolute path to the package's `SKILL.md` file. */
  path: string;
  /** Canonical absolute path to the skill package directory. */
  packagePath: string;
  /** Canonical Loom-configured root for entries discovered from an extra directory. */
  sourceDirectory?: string;
  /** Credential-free origin metadata for an immutable remote package snapshot. */
  sourceId?: string;
  repository?: string;
  revision?: string;
  repositoryPath?: string;
  [REMOTE_SNAPSHOT_CONTENT]?: {
    fingerprint: string;
    reviewFingerprint: string;
    executablePaths?: string[];
  };
  /** Copilot can report disabled entries; filesystem discovery is enabled. */
  enabled: boolean;
  /**
   * Verified package fingerprint from indexed retrieval. A remote entry also
   * carries it internally in `REMOTE_SNAPSHOT_CONTENT`; the explicit field makes
   * the exact binding identity available to CLI and skill consumers.
   */
  fingerprint?: string;
  /** Ranked match metadata from the derived capability index. */
  match?: SkillMatch;
}

/** A pinned harness-native agent definition from a verified remote snapshot. */
export interface NativeAgentEntry {
  id: string;
  harness: SkillHarness;
  source: 'remote';
  name: string;
  description: string;
  path: string;
  agentPath: string;
  sourceId: string;
  repository: string;
  revision: string;
  repositoryPath: string;
  fingerprint: string;
  status: 'available' | 'disabled' | 'invalid' | 'unsupported';
  statusReason: string | null;
}

/** Warning codes are stable API values, never user-facing prose. */
export const CATALOG_WARNING_CODES = {
  FRONTMATTER_MISSING: 'SKILL_FRONTMATTER_MISSING',
  FRONTMATTER_INVALID: 'SKILL_FRONTMATTER_INVALID',
  NAME_MISSING: 'SKILL_NAME_MISSING',
  FILE_UNREADABLE: 'SKILL_FILE_UNREADABLE',
  DIRECTORY_UNREADABLE: 'SKILL_DIRECTORY_UNREADABLE',
  DIRECTORY_NOT_FOUND: 'SKILL_DIRECTORY_NOT_FOUND',
  DIRECTORY_NOT_A_DIRECTORY: 'SKILL_DIRECTORY_NOT_A_DIRECTORY',
  DIRECTORY_PATH_INVALID: 'SKILL_DIRECTORY_PATH_INVALID',
  DEPTH_EXCEEDED: 'SKILL_DEPTH_EXCEEDED',
  COMMAND_UNAVAILABLE: 'SKILL_COMMAND_UNAVAILABLE',
  COMMAND_FAILED: 'SKILL_COMMAND_FAILED',
  COMMAND_TIMEOUT: 'SKILL_COMMAND_TIMEOUT',
  OUTPUT_INVALID: 'SKILL_OUTPUT_INVALID',
  ENTRY_INVALID: 'SKILL_ENTRY_INVALID',
  SOURCE_UNKNOWN: 'SKILL_SOURCE_UNKNOWN',
  PATH_UNRESOLVED: 'SKILL_PATH_UNRESOLVED',
  DISCOVERY_SLOW: 'CATALOG_DISCOVERY_SLOW',
  REMOTE_SOURCE_UNAVAILABLE: 'REMOTE_SOURCE_UNAVAILABLE',
  CAPABILITY_INDEX_FALLBACK: 'CAPABILITY_INDEX_FALLBACK',
} as const;
export type CatalogWarningCode =
  (typeof CATALOG_WARNING_CODES)[keyof typeof CATALOG_WARNING_CODES];

/**
 * A non-fatal discovery problem. A warning never suppresses entries that were
 * discovered successfully, and it never turns a broken source into an empty
 * catalog.
 */
export interface CatalogWarning {
  code: CatalogWarningCode;
  message: string;
  harness: SkillHarness;
  source?: SkillSource;
  /** Canonical path of the package, file, or directory the warning is about. */
  path?: string;
  /** Errno-style reason such as `EACCES` or `ENOENT`, never file content. */
  reason?: string;
  /** Executable plus argument array rendered for diagnostics; never a shell string. */
  command?: string;
  /** Exit code of a failed discovery command, when one actually ran. */
  exitCode?: number | null;
  /**
   * Bounded, redacted stderr excerpt for a failed discovery command. Credential
   * values are removed before the excerpt reaches a warning.
   */
  stderr?: string;
}

/** The normalized output of one harness discovery pass. */
export interface SkillDiscoveryResult {
  entries: SkillEntry[];
  warnings: CatalogWarning[];
}

/** Alias used by merged catalog code. */
export type CatalogDiscoveryResult = SkillDiscoveryResult;

/** Inputs that identify an entry for stable-id derivation. */
export type SkillIdInput = Pick<SkillEntry, 'harness' | 'source' | 'path' | 'name'>;

/**
 * Build a stable, URL-safe id. Including the name keeps a package that is
 * renamed through frontmatter distinct from its previous identity, while the
 * canonical path keeps same-named packages from different sources separate.
 */
export function createSkillId(input: SkillIdInput): string {
  const digest = createHash('sha256')
    .update(input.harness, 'utf8')
    .update('\0')
    .update(input.source, 'utf8')
    .update('\0')
    .update(input.path, 'utf8')
    .update('\0')
    .update(input.name, 'utf8')
    .digest('hex')
    .slice(0, 16);
  return `${input.harness}-${input.source}-${digest}`;
}

export function createNativeAgentId(input: Pick<
  NativeAgentEntry,
  'harness' | 'sourceId' | 'revision' | 'repositoryPath' | 'fingerprint'
>): string {
  const digest = createHash('sha256')
    .update(input.harness)
    .update('\0')
    .update(input.sourceId)
    .update('\0')
    .update(input.revision)
    .update('\0')
    .update(input.repositoryPath)
    .update('\0')
    .update(input.fingerprint)
    .digest('hex')
    .slice(0, 16);
  return `${input.harness}-remote-agent-${digest}`;
}

/** Deterministic catalog order: source group, then case-insensitive name, then path. */
export function compareSkillEntries(a: SkillEntry, b: SkillEntry): number {
  const sourceDelta = sourceRank(a.source) - sourceRank(b.source);
  if (sourceDelta !== 0) {
    return sourceDelta;
  }

  const nameA = a.name.toLocaleLowerCase('en-US');
  const nameB = b.name.toLocaleLowerCase('en-US');
  if (nameA < nameB) {
    return -1;
  }
  if (nameA > nameB) {
    return 1;
  }
  if (a.name !== b.name) {
    return a.name < b.name ? -1 : 1;
  }
  if (a.path === b.path) {
    return 0;
  }
  return a.path < b.path ? -1 : 1;
}

function sourceRank(source: SkillSource): number {
  const index = SKILL_SOURCE_ORDER.indexOf(source);
  return index === -1 ? SKILL_SOURCE_ORDER.length : index;
}

/** Typed failure for invalid scanner input, not for a broken skills directory. */
export const CATALOG_ERROR_CODES = {
  PROJECT_PATH_INVALID: 'CATALOG_PROJECT_PATH_INVALID',
  PROJECT_ID_INVALID: 'CATALOG_PROJECT_ID_INVALID',
  PROJECT_NOT_FOUND: 'CATALOG_PROJECT_NOT_FOUND',
  HARNESS_UNSUPPORTED: 'CATALOG_HARNESS_UNSUPPORTED',
} as const;
export type CatalogErrorCode = (typeof CATALOG_ERROR_CODES)[keyof typeof CATALOG_ERROR_CODES];

export class CatalogError extends Error {
  readonly code: CatalogErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: CatalogErrorCode,
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
