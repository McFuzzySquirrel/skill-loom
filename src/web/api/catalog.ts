import {
  ApiClientError,
  requestJson,
  type FetchLike,
  type RequestJsonOptions,
} from './client';

/**
 * Typed client for the skill catalog and global extra-directory settings.
 *
 * Catalog rows are rendered exactly as the harness reported them. Skill Loom adds no
 * summaries, and the full `SKILL.md` body is fetched only when the user expands
 * one entry. Every response is decoded here so a server shape change becomes a
 * typed `ApiClientError` instead of a render crash.
 */

export const CATALOG_HARNESSES = ['opencode', 'copilot'] as const;
export type CatalogHarness = (typeof CATALOG_HARNESSES)[number];

export const SKILL_SOURCES = [
  'project',
  'personal',
  'custom',
  'plugin',
  'builtin',
  'loom-extra',
] as const;
export type SkillSource = (typeof SKILL_SOURCES)[number];

/** One discovered skill package. */
export interface SkillEntry {
  /** Stable server id; never derived from the skill name. */
  id: string;
  harness: CatalogHarness;
  source: SkillSource;
  name: string;
  description: string;
  /** Canonical absolute path to the package `SKILL.md`. */
  path: string;
  /** Canonical absolute path to the package directory. */
  packagePath: string;
  /** Copilot can report disabled entries; filesystem discovery is enabled. */
  enabled: boolean;
}

/** A non-fatal discovery problem. Warnings never hide successful entries. */
export interface CatalogWarning {
  code: string;
  message: string;
  harness: CatalogHarness;
  source?: SkillSource;
  path?: string;
  reason?: string;
  command?: string;
  exitCode?: number | null;
  stderr?: string;
}

export interface CatalogGroup {
  source: SkillSource;
  count: number;
  entries: SkillEntry[];
}

export interface CatalogCounts {
  total: number;
  bySource: Record<SkillSource, number>;
}

/** The documented `GET /api/projects/:projectId/catalog` response. */
export interface CatalogResponse {
  harness: CatalogHarness;
  /** Trimmed search text echoed back for a truthful empty state. */
  query: string;
  total: number;
  counts: CatalogCounts;
  groups: CatalogGroup[];
  warnings: CatalogWarning[];
  elapsedMs: number;
}

/** Full `SKILL.md` text for one expanded row. */
export interface SkillDetail {
  id: string;
  harness: CatalogHarness;
  name: string;
  path: string;
  content: string;
}

/** Result of copying a non-project skill package into the project. */
export interface SkillCopyResult {
  skillId: string;
  harness: CatalogHarness;
  name: string;
  source: SkillSource;
  destinationPath: string;
}

export interface ExtraDirectories {
  extraSkillDirectories: string[];
}

export interface ExtraDirectoryMutation extends ExtraDirectories {
  directory: string;
}

export interface CatalogListOptions {
  harness?: CatalogHarness;
  query?: string;
  signal?: AbortSignal;
}

export interface CatalogApi {
  getCatalog: (projectId: string, options?: CatalogListOptions) => Promise<CatalogResponse>;
  getSkillDetail: (
    projectId: string,
    skillId: string,
    options?: Pick<CatalogListOptions, 'harness' | 'signal'>,
  ) => Promise<SkillDetail>;
  copySkillToProject: (
    projectId: string,
    skillId: string,
    options: { harness: CatalogHarness; signal?: AbortSignal },
  ) => Promise<SkillCopyResult>;
  listExtraDirectories: (options?: { signal?: AbortSignal }) => Promise<ExtraDirectories>;
  addExtraDirectory: (
    path: string,
    options?: { signal?: AbortSignal },
  ) => Promise<ExtraDirectoryMutation>;
  removeExtraDirectory: (
    path: string,
    options?: { signal?: AbortSignal },
  ) => Promise<ExtraDirectoryMutation>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function invalidResponse(what: string): ApiClientError {
  return new ApiClientError(
    `The Skill Loom server returned an unexpected ${what} response.`,
    { code: 'INVALID_RESPONSE', status: 200 },
  );
}

function decodeHarness(value: unknown): CatalogHarness {
  if (value === 'opencode' || value === 'copilot') {
    return value;
  }
  throw invalidResponse('catalog harness');
}

function decodeSource(value: unknown): SkillSource {
  if (
    value === 'project' ||
    value === 'personal' ||
    value === 'custom' ||
    value === 'plugin' ||
    value === 'builtin' ||
    value === 'loom-extra'
  ) {
    return value;
  }
  throw invalidResponse('skill source');
}

function decodeSkillEntry(value: unknown): SkillEntry {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.name) ||
    typeof value.description !== 'string' ||
    !isNonEmptyString(value.path) ||
    !isNonEmptyString(value.packagePath) ||
    typeof value.enabled !== 'boolean'
  ) {
    throw invalidResponse('catalog entry');
  }

  return {
    id: value.id,
    harness: decodeHarness(value.harness),
    source: decodeSource(value.source),
    name: value.name,
    description: value.description,
    path: value.path,
    packagePath: value.packagePath,
    enabled: value.enabled,
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function decodeWarning(value: unknown): CatalogWarning {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.code) ||
    !isNonEmptyString(value.message)
  ) {
    throw invalidResponse('catalog warning');
  }

  const source =
    value.source === undefined ? undefined : decodeSource(value.source);
  const path = optionalString(value.path);
  const reason = optionalString(value.reason);
  const command = optionalString(value.command);
  const stderr = optionalString(value.stderr);

  return {
    code: value.code,
    message: value.message,
    harness: decodeHarness(value.harness),
    ...(source === undefined ? {} : { source }),
    ...(path === undefined ? {} : { path }),
    ...(reason === undefined ? {} : { reason }),
    ...(command === undefined ? {} : { command }),
    ...(typeof value.exitCode === 'number' || value.exitCode === null
      ? { exitCode: value.exitCode }
      : {}),
    ...(stderr === undefined ? {} : { stderr }),
  };
}

function decodeCounts(value: unknown): CatalogCounts {
  if (!isRecord(value) || typeof value.total !== 'number' || !isRecord(value.bySource)) {
    throw invalidResponse('catalog counts');
  }

  const bySource = {} as Record<SkillSource, number>;
  for (const source of SKILL_SOURCES) {
    const count = value.bySource[source];
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
      throw invalidResponse('catalog source counts');
    }
    bySource[source] = count;
  }

  return { total: value.total, bySource };
}

function decodeGroup(value: unknown): CatalogGroup {
  if (
    !isRecord(value) ||
    typeof value.count !== 'number' ||
    !Array.isArray(value.entries)
  ) {
    throw invalidResponse('catalog group');
  }

  const entries = value.entries.map(decodeSkillEntry);
  if (entries.length !== value.count) {
    throw invalidResponse('catalog group count');
  }

  return {
    source: decodeSource(value.source),
    count: value.count,
    entries,
  };
}

function decodeCatalogResponse(value: unknown): CatalogResponse {
  if (
    !isRecord(value) ||
    typeof value.query !== 'string' ||
    typeof value.total !== 'number' ||
    !Array.isArray(value.groups) ||
    !Array.isArray(value.warnings) ||
    typeof value.elapsedMs !== 'number'
  ) {
    throw invalidResponse('skill catalog');
  }

  return {
    harness: decodeHarness(value.harness),
    query: value.query,
    total: value.total,
    counts: decodeCounts(value.counts),
    groups: value.groups.map(decodeGroup),
    warnings: value.warnings.map(decodeWarning),
    elapsedMs: value.elapsedMs,
  };
}

function decodeSkillDetail(value: unknown): SkillDetail {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.name) ||
    !isNonEmptyString(value.path) ||
    typeof value.content !== 'string'
  ) {
    throw invalidResponse('skill detail');
  }

  return {
    id: value.id,
    harness: decodeHarness(value.harness),
    name: value.name,
    path: value.path,
    content: value.content,
  };
}

function decodeSkillCopyResult(value: unknown): SkillCopyResult {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.skillId) ||
    !isNonEmptyString(value.name) ||
    !isNonEmptyString(value.destinationPath)
  ) {
    throw invalidResponse('skill copy result');
  }
  return {
    skillId: value.skillId,
    harness: decodeHarness(value.harness),
    name: value.name,
    source: decodeSource(value.source),
    destinationPath: value.destinationPath,
  };
}

function decodeDirectoryList(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.extraSkillDirectories)) {
    throw invalidResponse('extra skill directories');
  }
  return value.extraSkillDirectories.map((entry) => {
    if (!isNonEmptyString(entry)) {
      throw invalidResponse('extra skill directory');
    }
    return entry;
  });
}

function decodeMutation(value: unknown): ExtraDirectoryMutation {
  const extraSkillDirectories = decodeDirectoryList(value);
  if (!isRecord(value) || !isNonEmptyString(value.directory)) {
    throw invalidResponse('extra skill directory update');
  }
  return { extraSkillDirectories, directory: value.directory };
}

function optionsFor(signal: AbortSignal | undefined): RequestJsonOptions {
  return signal === undefined ? {} : { signal };
}

function catalogPath(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/catalog`;
}

export function createCatalogApi(fetchImpl: FetchLike = fetch): CatalogApi {
  return {
    async getCatalog(
      projectId: string,
      options: CatalogListOptions = {},
    ): Promise<CatalogResponse> {
      const search = new URLSearchParams();
      if (options.harness !== undefined) {
        search.set('harness', options.harness);
      }
      if (options.query !== undefined) {
        search.set('q', options.query);
      }
      const suffix = search.toString();
      const value = await requestJson<unknown>(
        `${catalogPath(projectId)}${suffix === '' ? '' : `?${suffix}`}`,
        optionsFor(options.signal),
        fetchImpl,
      );
      return decodeCatalogResponse(value);
    },

    async getSkillDetail(
      projectId: string,
      skillId: string,
      options: Pick<CatalogListOptions, 'harness' | 'signal'> = {},
    ): Promise<SkillDetail> {
      const search = new URLSearchParams();
      if (options.harness !== undefined) {
        search.set('harness', options.harness);
      }
      const suffix = search.toString();
      const value = await requestJson<unknown>(
        `${catalogPath(projectId)}/skills/${encodeURIComponent(skillId)}${
          suffix === '' ? '' : `?${suffix}`
        }`,
        optionsFor(options.signal),
        fetchImpl,
      );
      return decodeSkillDetail(value);
    },

    async copySkillToProject(
      projectId,
      skillId,
      options,
    ): Promise<SkillCopyResult> {
      const search = new URLSearchParams({ harness: options.harness });
      const value = await requestJson<unknown>(
        `${catalogPath(projectId)}/skills/${encodeURIComponent(skillId)}/copy?${search.toString()}`,
        {
          method: 'POST',
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      return decodeSkillCopyResult(value);
    },

    async listExtraDirectories(
      options: { signal?: AbortSignal } = {},
    ): Promise<ExtraDirectories> {
      const value = await requestJson<unknown>(
        '/api/settings/extra-skill-directories',
        optionsFor(options.signal),
        fetchImpl,
      );
      return { extraSkillDirectories: decodeDirectoryList(value) };
    },

    async addExtraDirectory(
      path: string,
      options: { signal?: AbortSignal } = {},
    ): Promise<ExtraDirectoryMutation> {
      const value = await requestJson<unknown>(
        '/api/settings/extra-skill-directories',
        {
          method: 'POST',
          body: { path },
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      return decodeMutation(value);
    },

    async removeExtraDirectory(
      path: string,
      options: { signal?: AbortSignal } = {},
    ): Promise<ExtraDirectoryMutation> {
      const value = await requestJson<unknown>(
        `/api/settings/extra-skill-directories?path=${encodeURIComponent(path)}`,
        {
          method: 'DELETE',
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      return decodeMutation(value);
    },
  };
}

/** Convert an unknown thrown value into the typed client error. */
export { toApiClientError } from './projects';

/** Same-origin client; Vite proxies /api in development. */
export const catalogApi = createCatalogApi();
