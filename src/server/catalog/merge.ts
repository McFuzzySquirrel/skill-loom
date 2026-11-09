import { readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import type { RemoteSkillSource } from '../config/schema.js';
import type { ConfigStore } from '../config/store.js';
import {
  PathInvalidError,
  PathNotAbsoluteError,
  PathRequiredError,
  resolveCanonicalDirectory,
} from '../projects/paths.js';
import {
  scanCopilotSkills,
  type CopilotCommandRunner,
} from './copilot.js';
import { scanOpenCodeSkills } from './opencode.js';
import { frontmatterString, parseSkillFrontmatter } from './frontmatter.js';
import {
  RemoteSourceError,
  listRemoteSkillSnapshots,
  resolveSnapshotAgentPath,
  resolveSnapshotPackage,
} from './remote.js';
import {
  CATALOG_ERROR_CODES,
  CATALOG_WARNING_CODES,
  CatalogError,
  REMOTE_SNAPSHOT_CONTENT,
  SKILL_HARNESSES,
  SKILL_SOURCE_ORDER,
  SKILL_SOURCES,
  compareSkillEntries,
  createNativeAgentId,
  createSkillId,
  type CatalogWarning,
  type NativeAgentEntry,
  type SkillDiscoveryResult,
  type SkillEntry,
  type SkillHarness,
  type SkillSource,
} from './types.js';

/**
 * Catalog merge and search.
 *
 * Adapters own harness-specific discovery; this module owns the harness-neutral
 * contract around it: one registry of adapters, deterministic merge order,
 * case-insensitive search, source grouping and counts, the performance budget,
 * and the global extra-directory settings. Duplicate skill names are never
 * collapsed: every entry keeps its own source badge and stable id.
 */

/** The documented performance budget for one discovery and merge pass. */
export const CATALOG_PERF_BUDGET_MS = 3_000;

/** One harness adapter, registered without the route knowing the harness name. */
export interface CatalogAdapter {
  harness: SkillHarness;
  /** True when Loom-configured extra directories belong in this harness catalog. */
  usesExtraDirectories: boolean;
  discover(request: CatalogDiscoveryRequest): Promise<SkillDiscoveryResult>;
}

export interface CatalogDiscoveryRequest {
  /** Canonical project directory. */
  projectPath: string;
  /** Canonical global extra directories; empty for adapters that do not use them. */
  extraDirectories: readonly string[];
}

export interface CatalogAdaptersOptions {
  /** Home directory seam for OpenCode personal skills. Defaults to `os.homedir()`. */
  homeDirectory?: string;
  /** Executable override for Copilot discovery. Defaults to `copilot`. */
  copilotExecutable?: string;
  /** Inject a deterministic Copilot runner; unit and integration tests do. */
  copilotRunner?: CopilotCommandRunner;
  /** Copilot discovery timeout. */
  copilotTimeoutMs?: number;
  /** Defensive OpenCode recursion cap. */
  openCodeMaxDepth?: number;
}

/**
 * Build the v1 adapter registry. Harness-specific options live here and in the
 * adapters themselves; routes and merge logic never inspect a harness name.
 */
export function createDefaultCatalogAdapters(
  options: CatalogAdaptersOptions = {},
): CatalogAdapter[] {
  return [
    {
      harness: 'opencode',
      usesExtraDirectories: true,
      discover: (request) =>
        scanOpenCodeSkills({
          projectPath: request.projectPath,
          extraDirectories: request.extraDirectories,
          ...(options.homeDirectory === undefined
            ? {}
            : { homeDirectory: options.homeDirectory }),
          ...(options.openCodeMaxDepth === undefined
            ? {}
            : { maxDepth: options.openCodeMaxDepth }),
        }),
    },
    {
      harness: 'copilot',
      usesExtraDirectories: false,
      discover: (request) =>
        scanCopilotSkills({
          projectPath: request.projectPath,
          ...(options.copilotExecutable === undefined
            ? {}
            : { executable: options.copilotExecutable }),
          ...(options.copilotTimeoutMs === undefined
            ? {}
            : { timeoutMs: options.copilotTimeoutMs }),
          ...(options.copilotRunner === undefined ? {} : { runner: options.copilotRunner }),
        }),
    },
  ];
}

export interface CatalogRequest {
  /** Canonical project directory resolved from a registered project id. */
  projectPath: string;
  harness: SkillHarness;
  /** Case-insensitive substring search over name and description. */
  query?: string;
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

export interface CatalogResponse {
  harness: SkillHarness;
  /** Trimmed search text echoed back for a truthful empty-state message. */
  query: string;
  total: number;
  counts: CatalogCounts;
  /** Nonempty source groups, in the documented badge order. */
  groups: CatalogGroup[];
  agents: NativeAgentEntry[];
  warnings: CatalogWarning[];
  /** Observed discovery and merge duration. Never used to hide entries. */
  elapsedMs: number;
}

export interface CatalogService {
  /** Harness selected when a request omits `harness`. */
  readonly defaultHarness: SkillHarness;
  getCatalog(request: CatalogRequest): Promise<CatalogResponse>;
}

export interface CatalogServiceOptions {
  configStore: ConfigStore;
  /** Registered adapters. Defaults to the v1 OpenCode and Copilot adapters. */
  adapters?: readonly CatalogAdapter[];
  /** Default harness. Defaults to the first registered adapter. */
  defaultHarness?: SkillHarness;
  /** Clock seam in milliseconds. Defaults to `Date.now`. */
  now?: () => number;
  /** Performance budget. Defaults to `CATALOG_PERF_BUDGET_MS`. */
  slowThresholdMs?: number;
}

/**
 * Create the catalog service. The service re-reads global configuration and
 * re-runs discovery on every request, so project changes, extra-directory
 * changes, and external skill changes are visible on the next refresh.
 */
export function createCatalogService(options: CatalogServiceOptions): CatalogService {
  const adapters = [...(options.adapters ?? createDefaultCatalogAdapters())];
  const byHarness = new Map<SkillHarness, CatalogAdapter>();

  for (const adapter of adapters) {
    if (byHarness.has(adapter.harness)) {
      throw new CatalogError(
        CATALOG_ERROR_CODES.HARNESS_UNSUPPORTED,
        `More than one catalog adapter is registered for "${adapter.harness}".`,
        { harness: adapter.harness },
      );
    }
    byHarness.set(adapter.harness, adapter);
  }

  const defaultHarness = options.defaultHarness ?? adapters[0]?.harness ?? SKILL_HARNESSES[0];
  const now = options.now ?? Date.now;
  const slowThresholdMs = normalizeBudget(options.slowThresholdMs);

  return {
    defaultHarness,
    async getCatalog(request: CatalogRequest): Promise<CatalogResponse> {
      const adapter = byHarness.get(request.harness);
      if (!adapter) {
        throw new CatalogError(
          CATALOG_ERROR_CODES.HARNESS_UNSUPPORTED,
          `No catalog adapter is registered for "${request.harness}".`,
          { harness: request.harness },
        );
      }

      const config = await options.configStore.get();
      const extraDirectories = adapter.usesExtraDirectories
        ? config.extraSkillDirectories
        : [];
      const query = (request.query ?? '').trim();

      const startedAt = now();
      const discovery = await adapter.discover({
        projectPath: request.projectPath,
        extraDirectories,
      });
      const elapsedMs = Math.max(0, Math.round(now() - startedAt));

      const remote = await discoverRemoteSkillEntries({
        configDirectory: options.configStore.getConfigDir(),
        sources: config.remoteSkillSources,
        harness: adapter.harness,
      });
      const agents = await discoverRemoteNativeAgents({
        configDirectory: options.configStore.getConfigDir(),
        sources: config.remoteSkillSources,
        harness: adapter.harness,
      });
      const merged = [...discovery.entries, ...remote.entries]
        .map((entry) => normalizeEntry(adapter.harness, entry))
        .sort(compareSkillEntries);
      const filtered = query === '' ? merged : merged.filter((entry) => matchesQuery(entry, query));

      const bySource = emptySourceCounts();
      for (const entry of filtered) {
        bySource[entry.source] += 1;
      }

      const groups: CatalogGroup[] = [];
      for (const source of SKILL_SOURCE_ORDER) {
        const entries = filtered.filter((entry) => entry.source === source);
        if (entries.length > 0) {
          groups.push({ source, count: entries.length, entries });
        }
      }

      const warnings = [...discovery.warnings, ...remote.warnings];
      warnings.push(...agents.warnings);
      if (elapsedMs > slowThresholdMs) {
        warnings.push({
          code: CATALOG_WARNING_CODES.DISCOVERY_SLOW,
          message: `Catalog discovery took ${String(elapsedMs)} ms, exceeding the ${String(slowThresholdMs)} ms budget; every discovered entry is still returned.`,
          harness: adapter.harness,
          reason: 'PERF_BUDGET',
        });
      }

      async function discoverRemoteSkillEntries(options: {
        configDirectory: string;
        sources: readonly RemoteSkillSource[];
        harness: SkillHarness;
      }): Promise<{ entries: SkillEntry[]; warnings: CatalogWarning[] }> {
        const entries: SkillEntry[] = [];
        const warnings: CatalogWarning[] = [];
        for (const source of options.sources) {
          try {
            const snapshots = await listRemoteSkillSnapshots(options.configDirectory, source.id);
            for (const snapshot of snapshots) {
              for (const packageInfo of snapshot.packages) {
                try {
                  const resolved = await resolveSnapshotPackage(
                    options.configDirectory,
                    snapshot,
                    packageInfo,
                  );
                  const packagePath = resolved.path;
                  const skillPath = join(packagePath, 'SKILL.md');
                  const metadata = parseSkillFrontmatter(await readFile(skillPath, 'utf8'));
                  const name = frontmatterString(metadata.data, 'name') ?? packageInfo.name;
                  const description =
                    frontmatterString(metadata.data, 'description') ?? packageInfo.description;
                  entries.push({
                    id: createSkillId({
                      harness: options.harness,
                      source: 'remote',
                      path: skillPath,
                      name,
                    }),
                    harness: options.harness,
                    source: 'remote',
                    name,
                    description,
                    path: skillPath,
                    packagePath,
                    sourceId: source.id,
                    repository: snapshot.repository,
                    revision: snapshot.revision,
                    repositoryPath: packageInfo.repositoryPath,
                    [REMOTE_SNAPSHOT_CONTENT]: {
                      fingerprint: packageInfo.fingerprint,
                      reviewFingerprint: resolved.reviewFingerprint,
                      ...(resolved.executablePaths === undefined ? {} : { executablePaths: resolved.executablePaths }),
                    },
                    enabled: true,
                  });
                } catch (error) {
                  warnings.push(remoteWarning(options.harness, source.id, error));
                }
              }
            }
          } catch (error) {
            warnings.push(remoteWarning(options.harness, source.id, error));
          }
        }
        return { entries, warnings };
      }

      async function discoverRemoteNativeAgents(options: {
        configDirectory: string;
        sources: readonly RemoteSkillSource[];
        harness: SkillHarness;
      }): Promise<{ entries: NativeAgentEntry[]; warnings: CatalogWarning[] }> {
        const entries: NativeAgentEntry[] = [];
        const warnings: CatalogWarning[] = [];
        for (const source of options.sources) {
          try {
            const snapshots = await listRemoteSkillSnapshots(options.configDirectory, source.id);
            for (const snapshot of snapshots) {
              for (const agent of snapshot.agents.filter((item) => item.harness === options.harness)) {
                try {
                  const path = await resolveSnapshotAgentPath(options.configDirectory, snapshot, agent);
                  entries.push({
                    id: createNativeAgentId({
                      harness: agent.harness,
                      sourceId: source.id,
                      revision: snapshot.revision,
                      repositoryPath: agent.repositoryPath,
                      fingerprint: agent.fingerprint,
                    }),
                    harness: agent.harness,
                    source: 'remote',
                    name: agent.name,
                    description: agent.description,
                    path,
                    agentPath: agent.agentPath,
                    sourceId: source.id,
                    repository: snapshot.repository,
                    revision: snapshot.revision,
                    repositoryPath: agent.repositoryPath,
                    fingerprint: agent.fingerprint,
                    status: agent.status,
                    statusReason: agent.statusReason,
                  });
                } catch (error) {
                  warnings.push(remoteWarning(options.harness, source.id, error));
                }
              }
            }
          } catch (error) {
            warnings.push(remoteWarning(options.harness, source.id, error));
          }
        }
        return { entries, warnings };
      }

      function remoteWarning(harness: SkillHarness, sourceId: string, error: unknown): CatalogWarning {
        return {
          code: CATALOG_WARNING_CODES.REMOTE_SOURCE_UNAVAILABLE,
          message: 'A saved remote skill snapshot could not be verified and was omitted. Refresh or remove the source.',
          harness,
          source: 'remote',
          reason: error instanceof RemoteSourceError ? error.code : 'READ_FAILED',
          path: sourceId,
        };
      }

      return {
        harness: adapter.harness,
        query,
        total: filtered.length,
        counts: { total: filtered.length, bySource },
        groups,
        agents: query === ''
          ? agents.entries
          : agents.entries.filter((entry) =>
              `${entry.name} ${entry.description}`.toLocaleLowerCase('en-US')
                .includes(query.toLocaleLowerCase('en-US'))),
        warnings,
        elapsedMs,
      };
    },
  };
}

/**
 * Apply the stable-id contract at the merge boundary. The adapter ids are
 * already derived the same way, but recomputing here makes the catalog id
 * authoritative even when an adapter or a test fixture supplies another value.
 */
function normalizeEntry(harness: SkillHarness, entry: SkillEntry): SkillEntry {
  return {
    ...entry,
    harness,
    id: createSkillId({
      harness,
      source: entry.source,
      path: entry.path,
      name: entry.name,
    }),
  };
}

function matchesQuery(entry: SkillEntry, query: string): boolean {
  const needle = query.toLocaleLowerCase('en-US');
  return (
    entry.name.toLocaleLowerCase('en-US').includes(needle) ||
    entry.description.toLocaleLowerCase('en-US').includes(needle)
  );
}

function emptySourceCounts(): Record<SkillSource, number> {
  const counts = {} as Record<SkillSource, number>;
  for (const source of SKILL_SOURCES) {
    counts[source] = 0;
  }
  return counts;
}

function normalizeBudget(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return CATALOG_PERF_BUDGET_MS;
  }
  return Math.floor(value);
}

/** A settings failure that is not a filesystem problem. */
export const EXTRA_DIRECTORY_ERROR_CODES = {
  DUPLICATE: 'EXTRA_SKILL_DIRECTORY_DUPLICATE',
  NOT_FOUND: 'EXTRA_SKILL_DIRECTORY_NOT_FOUND',
} as const;

export type ExtraDirectoryErrorCode =
  (typeof EXTRA_DIRECTORY_ERROR_CODES)[keyof typeof EXTRA_DIRECTORY_ERROR_CODES];

export class ExtraDirectoryError extends Error {
  readonly code: ExtraDirectoryErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: ExtraDirectoryErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

export interface ExtraDirectoriesResult {
  /** Directories persisted after the operation. */
  extraSkillDirectories: string[];
  /** Canonical directory the operation referred to. */
  directory: string;
}

/** Read the global extra skill directories. */
export async function listExtraSkillDirectories(configStore: ConfigStore): Promise<string[]> {
  const config = await configStore.get();
  return [...config.extraSkillDirectories];
}

/**
 * Add one canonical extra skill directory to the global configuration.
 *
 * The input is validated and resolved with `realpath` before it is persisted,
 * so a relative path, a file, an unreadable directory, or a symlink alias is
 * rejected or normalized. A duplicate, including a symlink alias of an already
 * configured directory, is a typed conflict rather than a silent no-op.
 */
export async function addExtraSkillDirectory(
  configStore: ConfigStore,
  input: unknown,
): Promise<ExtraDirectoriesResult> {
  const canonical = await resolveCanonicalDirectory(input);
  let extraSkillDirectories: string[] = [];

  await configStore.update((current) => {
    if (current.extraSkillDirectories.some((entry) => samePath(entry, canonical.path))) {
      throw new ExtraDirectoryError(
        EXTRA_DIRECTORY_ERROR_CODES.DUPLICATE,
        'That directory is already configured as an extra skill directory.',
        { path: canonical.path },
      );
    }

    extraSkillDirectories = [...current.extraSkillDirectories, canonical.path];
    return { extraSkillDirectories };
  });

  return { directory: canonical.path, extraSkillDirectories };
}

/**
 * Remove one extra skill directory from the global configuration.
 *
 * Removal stays possible after the directory has been deleted: existence is
 * canonicalized when available but a vanished directory still matches its
 * stored absolute path. The project filesystem is never touched.
 */
export async function removeExtraSkillDirectory(
  configStore: ConfigStore,
  input: unknown,
): Promise<ExtraDirectoriesResult> {
  const requested = validateRemovalPath(input);
  const candidate = await canonicalizeIfPossible(requested);
  let directory = candidate;
  let extraSkillDirectories: string[] = [];

  await configStore.update((current) => {
    const remaining = current.extraSkillDirectories.filter(
      (entry) => !samePath(entry, candidate) && !samePath(entry, requested),
    );

    if (remaining.length === current.extraSkillDirectories.length) {
      throw new ExtraDirectoryError(
        EXTRA_DIRECTORY_ERROR_CODES.NOT_FOUND,
        'No configured extra skill directory matches that path.',
        { path: candidate },
      );
    }

    const removed = current.extraSkillDirectories.find(
      (entry) => samePath(entry, candidate) || samePath(entry, requested),
    );
    if (removed !== undefined) {
      directory = removed;
    }

    extraSkillDirectories = remaining;
    return { extraSkillDirectories };
  });

  return { directory, extraSkillDirectories };
}

function validateRemovalPath(input: unknown): string {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new PathRequiredError();
  }
  if (input.includes('\0')) {
    throw new PathInvalidError(input, 'NUL_BYTE');
  }
  if (!isAbsolute(input)) {
    throw new PathNotAbsoluteError(input);
  }
  return input;
}

async function canonicalizeIfPossible(input: string): Promise<string> {
  let candidate = resolve(input);
  const missing: string[] = [];
  for (;;) {
    try {
      return join(await realpath(candidate), ...missing);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error &&
          (error.code === 'ENOENT' || error.code === 'ENOTDIR'))) throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      missing.unshift(basename(candidate));
      candidate = parent;
    }
  }
}

function samePath(a: string, b: string): boolean {
  return resolve(a) === resolve(b);
}
