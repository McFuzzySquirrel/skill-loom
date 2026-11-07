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
export const DRAFT_CATALOG_ID = '__global_drafts__';

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
  /** Canonical Loom-configured root for entries discovered from an extra directory. */
  sourceDirectory?: string;
  sourceId?: string;
  repository?: string;
  revision?: string;
  repositoryPath?: string;
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

export interface NativeAgentEntry {
  id: string;
  harness: CatalogHarness;
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

export interface NativeAgentCopyResult {
  agentId: string;
  name: string;
  harness: CatalogHarness;
  destinationPath: string;
  fingerprint: string;
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
  agents: NativeAgentEntry[];
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

export interface RemoteSkillSource {
  id: string;
  repository: string;
  ref?: string;
}

export interface RemoteSkillPackage {
  name: string;
  description: string;
  repositoryPath: string;
  directory: string;
  files: number;
  bytes: number;
  fingerprint: string;
}

export interface RemoteNativeAgent {
  harness: CatalogHarness;
  name: string;
  description: string;
  repositoryPath: string;
  agentPath: string;
  directory: string;
  bytes: number;
  fingerprint: string;
  status: 'available' | 'disabled' | 'invalid' | 'unsupported';
  statusReason: string | null;
}

export interface RemoteSkillSnapshot {
  version: 1;
  sourceId: string;
  repository: string;
  revision: string;
  packages: RemoteSkillPackage[];
  agents: RemoteNativeAgent[];
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
  copyAgentToProject: (
    projectId: string,
    agentId: string,
    options: { harness: CatalogHarness; signal?: AbortSignal },
  ) => Promise<NativeAgentCopyResult>;
  listExtraDirectories: (options?: { signal?: AbortSignal }) => Promise<ExtraDirectories>;
  addExtraDirectory: (
    path: string,
    options?: { signal?: AbortSignal },
  ) => Promise<ExtraDirectoryMutation>;
  removeExtraDirectory: (
    path: string,
    options?: { signal?: AbortSignal },
  ) => Promise<ExtraDirectoryMutation>;
  listRemoteSources: (options?: { signal?: AbortSignal }) => Promise<RemoteSkillSource[]>;
  addRemoteSource: (
    repository: string,
    ref?: string,
    options?: { signal?: AbortSignal },
  ) => Promise<RemoteSkillSource>;
  removeRemoteSource: (
    sourceId: string,
    options?: { signal?: AbortSignal },
  ) => Promise<RemoteSkillSource[]>;
  listRemoteSnapshots: (
    sourceId: string,
    options?: { signal?: AbortSignal },
  ) => Promise<RemoteSkillSnapshot[]>;
  refreshRemoteSource: (
    sourceId: string,
    options?: { signal?: AbortSignal },
  ) => Promise<RemoteSkillSnapshot>;
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
    value === 'loom-extra' ||
    value === 'remote'
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

  const source = decodeSource(value.source);
  const sourceId = optionalString(value.sourceId);
  const revision = optionalString(value.revision);
  const repositoryPath = optionalString(value.repositoryPath);
  if (
    source === 'remote' &&
    (sourceId === undefined ||
      !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(sourceId) ||
      revision === undefined ||
      !/^[a-f0-9]{40,64}$/.test(revision) ||
      repositoryPath === undefined ||
      repositoryPath.trim() === '')
  ) {
    throw invalidResponse('remote skill snapshot identity');
  }

  return {
    id: value.id,
    harness: decodeHarness(value.harness),
    source,
    name: value.name,
    description: value.description,
    path: value.path,
    packagePath: value.packagePath,
    ...(typeof value.sourceDirectory === 'string'
      ? { sourceDirectory: value.sourceDirectory }
      : {}),
    ...(sourceId === undefined ? {} : { sourceId }),
    ...(typeof value.repository === 'string' ? { repository: value.repository } : {}),
    ...(revision === undefined ? {} : { revision }),
    ...(repositoryPath === undefined ? {} : { repositoryPath }),
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

function isAgentStatus(value: unknown): value is NativeAgentEntry['status'] {
  return value === 'available' || value === 'disabled' || value === 'invalid' || value === 'unsupported';
}

function decodeNativeAgentEntry(value: unknown): NativeAgentEntry {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    value.source !== 'remote' ||
    !isNonEmptyString(value.name) ||
    typeof value.description !== 'string' ||
    !isNonEmptyString(value.path) ||
    !isNonEmptyString(value.agentPath) ||
    !isNonEmptyString(value.sourceId) ||
    !isNonEmptyString(value.repository) ||
    !/^[a-f0-9]{40,64}$/.test(String(value.revision)) ||
    !isNonEmptyString(value.repositoryPath) ||
    typeof value.fingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.fingerprint) ||
    !isAgentStatus(value.status) ||
    (value.statusReason !== null && typeof value.statusReason !== 'string')
  ) {
    throw invalidResponse('native agent catalog entry');
  }
  return {
    id: value.id,
    harness: decodeHarness(value.harness),
    source: 'remote',
    name: value.name,
    description: value.description,
    path: value.path,
    agentPath: value.agentPath,
    sourceId: value.sourceId,
    repository: value.repository,
    revision: String(value.revision),
    repositoryPath: value.repositoryPath,
    fingerprint: value.fingerprint,
    status: value.status,
    statusReason: value.statusReason,
  };
}

function decodeCatalogResponse(value: unknown): CatalogResponse {
  if (
    !isRecord(value) ||
    typeof value.query !== 'string' ||
    typeof value.total !== 'number' ||
    !Array.isArray(value.groups) ||
    !Array.isArray(value.agents) ||
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
    agents: value.agents.map(decodeNativeAgentEntry),
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

function decodeNativeAgentCopyResult(value: unknown): NativeAgentCopyResult {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.agentId) ||
    !isNonEmptyString(value.name) ||
    !isNonEmptyString(value.destinationPath) ||
    typeof value.fingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.fingerprint)
  ) {
    throw invalidResponse('native agent copy');
  }
  return {
    agentId: value.agentId,
    name: value.name,
    harness: decodeHarness(value.harness),
    destinationPath: value.destinationPath,
    fingerprint: value.fingerprint,
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

function decodeRemoteSource(value: unknown): RemoteSkillSource {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.repository) ||
    (value.ref !== undefined && !isNonEmptyString(value.ref))
  ) {
    throw invalidResponse('remote skill source');
  }
  return {
    id: value.id,
    repository: value.repository,
    ...(typeof value.ref === 'string' ? { ref: value.ref } : {}),
  };
}

function decodeRemoteSnapshot(value: unknown): RemoteSkillSnapshot {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isNonEmptyString(value.sourceId) ||
    !isNonEmptyString(value.repository) ||
    !/^[a-f0-9]{40,64}$/.test(String(value.revision)) ||
    !Array.isArray(value.packages) ||
    !Array.isArray(value.agents)
  ) {
    throw invalidResponse('remote skill snapshot');
  }
  const packages = value.packages.map((item): RemoteSkillPackage => {
    if (
      !isRecord(item) ||
      !isNonEmptyString(item.name) ||
      typeof item.description !== 'string' ||
      !isNonEmptyString(item.repositoryPath) ||
      typeof item.directory !== 'string' ||
      !/^[a-f0-9]{64}$/.test(item.directory) ||
      typeof item.files !== 'number' ||
      !Number.isInteger(item.files) ||
      typeof item.bytes !== 'number' ||
      !Number.isInteger(item.bytes) ||
      typeof item.fingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(item.fingerprint)
    ) {
      throw invalidResponse('remote skill package');
    }
    return {
      name: item.name,
      description: item.description,
      repositoryPath: item.repositoryPath,
      directory: item.directory,
      files: item.files,
      bytes: item.bytes,
      fingerprint: item.fingerprint,
    };
  });
  const agents = value.agents.map((item): RemoteNativeAgent => {
    if (
      !isRecord(item) ||
      !isNonEmptyString(item.name) ||
      typeof item.description !== 'string' ||
      !isNonEmptyString(item.repositoryPath) ||
      !isNonEmptyString(item.agentPath) ||
      typeof item.directory !== 'string' ||
      !/^[a-f0-9]{64}$/.test(item.directory) ||
      typeof item.bytes !== 'number' ||
      !Number.isInteger(item.bytes) ||
      typeof item.fingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(item.fingerprint) ||
      !['available', 'disabled', 'invalid', 'unsupported'].includes(String(item.status)) ||
      (item.statusReason !== null && typeof item.statusReason !== 'string')
    ) {
      throw invalidResponse('remote native agent');
    }
    return {
      harness: decodeHarness(item.harness),
      name: item.name,
      description: item.description,
      repositoryPath: item.repositoryPath,
      agentPath: item.agentPath,
      directory: item.directory,
      bytes: item.bytes,
      fingerprint: item.fingerprint,
      status: item.status as RemoteNativeAgent['status'],
      statusReason: item.statusReason as string | null,
    };
  });
  return {
    version: 1,
    sourceId: value.sourceId,
    repository: value.repository,
    revision: String(value.revision),
    packages,
    agents,
  };
}

function decodeRemoteSourceList(value: unknown): RemoteSkillSource[] {
  if (!isRecord(value) || !Array.isArray(value.remoteSkillSources)) {
    throw invalidResponse('remote skill source list');
  }
  return value.remoteSkillSources.map(decodeRemoteSource);
}

function optionsFor(signal: AbortSignal | undefined): RequestJsonOptions {
  return signal === undefined ? {} : { signal };
}

function catalogPath(projectId: string): string {
  if (projectId === DRAFT_CATALOG_ID) {
    return '/api/drafts/catalog';
  }
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
        search.set(projectId === DRAFT_CATALOG_ID ? 'query' : 'q', options.query);
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
      const detailPath =
        projectId === DRAFT_CATALOG_ID
          ? `/api/drafts/catalog/skills/${encodeURIComponent(skillId)}`
          : `${catalogPath(projectId)}/skills/${encodeURIComponent(skillId)}`;
      const value = await requestJson<unknown>(
        `${detailPath}${suffix === '' ? '' : `?${suffix}`}`,
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

    async copyAgentToProject(
      projectId,
      agentId,
      options,
    ): Promise<NativeAgentCopyResult> {
      const search = new URLSearchParams({ harness: options.harness });
      const value = await requestJson<unknown>(
        `${catalogPath(projectId)}/agents/${encodeURIComponent(agentId)}/copy?${search.toString()}`,
        { method: 'POST', ...optionsFor(options.signal) },
        fetchImpl,
      );
      return decodeNativeAgentCopyResult(value);
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

    async listRemoteSources(options = {}): Promise<RemoteSkillSource[]> {
      return decodeRemoteSourceList(await requestJson<unknown>(
        '/api/settings/remote-skill-sources',
        optionsFor(options.signal),
        fetchImpl,
      ));
    },

    async addRemoteSource(repository, ref, options = {}): Promise<RemoteSkillSource> {
      const value = await requestJson<unknown>(
        '/api/settings/remote-skill-sources',
        {
          method: 'POST',
          body: { repository, ...(ref === undefined ? {} : { ref }) },
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      if (!isRecord(value) || !isRecord(value.source)) {
        throw invalidResponse('remote skill source update');
      }
      return decodeRemoteSource(value.source);
    },

    async removeRemoteSource(sourceId, options = {}): Promise<RemoteSkillSource[]> {
      return decodeRemoteSourceList(await requestJson<unknown>(
        `/api/settings/remote-skill-sources/${encodeURIComponent(sourceId)}`,
        { method: 'DELETE', ...optionsFor(options.signal) },
        fetchImpl,
      ));
    },

    async listRemoteSnapshots(sourceId, options = {}): Promise<RemoteSkillSnapshot[]> {
      const value = await requestJson<unknown>(
        `/api/settings/remote-skill-sources/${encodeURIComponent(sourceId)}/snapshots`,
        optionsFor(options.signal),
        fetchImpl,
      );
      if (!isRecord(value) || !Array.isArray(value.snapshots)) {
        throw invalidResponse('remote skill snapshots');
      }
      return value.snapshots.map(decodeRemoteSnapshot);
    },

    async refreshRemoteSource(sourceId, options = {}): Promise<RemoteSkillSnapshot> {
      const value = await requestJson<unknown>(
        `/api/settings/remote-skill-sources/${encodeURIComponent(sourceId)}/refresh`,
        { method: 'POST', ...optionsFor(options.signal) },
        fetchImpl,
      );
      if (!isRecord(value)) throw invalidResponse('remote skill refresh');
      return decodeRemoteSnapshot(value.snapshot);
    },
  };
}

/** Convert an unknown thrown value into the typed client error. */
export { toApiClientError } from './projects';

/** Same-origin client; Vite proxies /api in development. */
export const catalogApi = createCatalogApi();
