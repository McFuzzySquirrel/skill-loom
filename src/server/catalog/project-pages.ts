import { randomBytes } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import {
  CAPABILITY_MAX_RESULTS,
  hasMetadataFilters,
  normalizeCapabilityFilters,
  type CapabilityCandidate,
  type CapabilityMetadataCoverage,
  type CapabilitySearchResponse,
  type CapabilitySearchService,
  type NormalizedCapabilityFilters,
} from './capability-index.js';
import type { CatalogService } from './merge.js';
import {
  REMOTE_SNAPSHOT_CONTENT,
  type CatalogWarning,
  type SkillEntry,
  type SkillHarness,
  type SkillSource,
} from './types.js';

const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_SNAPSHOTS = 4;
const SNAPSHOT_TTL_MS = 2 * 60 * 1000;
/**
 * The indexed path builds a page snapshot in fixed-size pages. A larger result
 * set uses the fresh scan so that paging never truncates or hides a skill.
 */
const MAX_INDEXED_SNAPSHOT_ENTRIES = 500;

export class ProjectCatalogPageError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ProjectCatalogPageError';
  }
}

interface PageRequest {
  projectId: string;
  projectPath: string;
  harness: SkillHarness;
  query?: string | undefined;
  snapshotId?: string | undefined;
  offset: number;
  limit: number;
  warningsOffset: number;
  sources?: SkillSource[] | undefined;
  enabled?: boolean | undefined;
  tags?: string[] | undefined;
  tools?: string[] | undefined;
  inputs?: string[] | undefined;
  outputs?: string[] | undefined;
}

/** How the first page was produced. Cached snapshots retain the same value. */
export interface PageRetrieval {
  mode: 'index' | 'scan';
  /** Capability fallback reason when the indexed path was unavailable. */
  reason?: string;
  /** Ranking implementation reported by the capability index. */
  ranking?: 'fts5' | 'tokens';
  elapsedMs: number;
}

interface Snapshot {
  projectId: string;
  projectPath: string;
  projectDevice: string;
  projectInode: string;
  harness: SkillHarness;
  query: string;
  filtersKey: string;
  entries: SkillEntry[];
  warnings: CatalogWarning[];
  retrieval: PageRetrieval;
  coverage?: CapabilityMetadataCoverage;
  size: number;
  expiresAt: number;
}

interface DiscoveryResult {
  entries: SkillEntry[];
  warnings: CatalogWarning[];
  retrieval: PageRetrieval;
  coverage?: CapabilityMetadataCoverage;
}

/** The subset of the capability service the page cache needs. */
export type CatalogPageSearch = Pick<CapabilitySearchService, 'enabled' | 'search'>;

async function projectIdentity(path: string): Promise<{ device: string; inode: string }> {
  try {
    const info = await stat(path, { bigint: true });
    if (!info.isDirectory() || await realpath(path) !== path) throw new Error('Project is not a canonical directory.');
    return { device: String(info.dev), inode: String(info.ino) };
  } catch {
    throw new ProjectCatalogPageError('CATALOG_PAGE_PROJECT_CHANGED', 'The catalog project is unavailable or no longer canonical.');
  }
}

export class ProjectCatalogPages {
  private readonly snapshots = new Map<string, Snapshot>();
  private bytes = 0;

  constructor(
    private readonly catalog: CatalogService,
    private readonly now: () => number = Date.now,
    private readonly maxCacheBytes = MAX_CACHE_BYTES,
    private readonly maxSnapshots = MAX_SNAPSHOTS,
    private readonly capability?: CatalogPageSearch,
  ) {}

  async page(request: PageRequest) {
    const query = (request.query ?? '').trim();
    const filters = normalizeCapabilityFilters(request);
    const filtersKey = pageFiltersKey(filters);
    const project = await projectIdentity(request.projectPath);
    this.expire();
    let snapshot: Snapshot;
    let snapshotId = request.snapshotId ?? null;
    if (snapshotId !== null) {
      const found = this.snapshots.get(snapshotId);
      if (found === undefined) {
        throw new ProjectCatalogPageError('CATALOG_PAGE_EXPIRED', 'The catalog page snapshot expired or is unavailable. Start a new search.');
      }
      if (found.projectId !== request.projectId || found.projectPath !== request.projectPath ||
          found.harness !== request.harness || found.query !== query ||
          found.filtersKey !== filtersKey ||
          found.projectDevice !== project.device || found.projectInode !== project.inode) {
        throw new ProjectCatalogPageError('CATALOG_PAGE_MISMATCH', 'The catalog page snapshot belongs to a different project, harness, query, or filter set.');
      }
      snapshot = found;
      this.snapshots.delete(snapshotId);
      this.snapshots.set(snapshotId, snapshot);
    } else {
      const discovery = await this.discover(request, query, filters);
      const after = await projectIdentity(request.projectPath);
      if (project.device !== after.device || project.inode !== after.inode) {
        throw new ProjectCatalogPageError('CATALOG_PAGE_PROJECT_CHANGED', 'The catalog project changed during discovery; start a new search.');
      }
      const entries = discovery.entries;
      let size = 0;
      for (const values of [entries, discovery.warnings]) {
        for (const value of values) {
          size += Buffer.byteLength(JSON.stringify(value), 'utf8');
          if (size > this.maxCacheBytes) break;
        }
        if (size > this.maxCacheBytes) break;
      }
      snapshot = {
        projectId: request.projectId, projectPath: request.projectPath, harness: request.harness,
        projectDevice: project.device, projectInode: project.inode,
        query, filtersKey, entries, warnings: discovery.warnings, retrieval: discovery.retrieval,
        ...(discovery.coverage === undefined ? {} : { coverage: discovery.coverage }),
        size, expiresAt: this.now() + SNAPSHOT_TTL_MS,
      };
      if (size <= this.maxCacheBytes) {
        this.expire();
        while (this.snapshots.size >= this.maxSnapshots || this.bytes + size > this.maxCacheBytes) {
          this.remove(this.snapshots.keys().next().value!);
        }
        do {
          snapshotId = randomBytes(24).toString('base64url');
        } while (this.snapshots.has(snapshotId));
        this.snapshots.set(snapshotId, snapshot);
        this.bytes += size;
      }
    }
    const page = snapshot.entries.slice(request.offset, request.offset + request.limit);
    const warnings = snapshot.warnings.slice(request.warningsOffset, request.warningsOffset + 100);
    return {
      harness: snapshot.harness, query: snapshot.query, total: snapshot.entries.length,
      offset: request.offset, limit: request.limit, entries: page,
      nextOffset: request.offset + page.length < snapshot.entries.length ? request.offset + page.length : null,
      warnings, warningsTotal: snapshot.warnings.length,
      warningsNextOffset: request.warningsOffset + warnings.length < snapshot.warnings.length
        ? request.warningsOffset + warnings.length : null,
      retrieval: snapshot.retrieval,
      metadataCoverage: snapshot.coverage ?? null,
      snapshotId,
      snapshotExpiresAt: snapshotId === null ? null : new Date(snapshot.expiresAt).toISOString(),
      ...(snapshotId === null ? {
        paginationWarning: {
          code: 'CATALOG_PAGE_NOT_CACHED',
          message: 'This catalog is too large to retain; later pages rediscover it and may change. Narrow the query for stable paging.',
        },
      } : {}),
    };
  }

  private async discover(
    request: PageRequest,
    query: string,
    filters: NormalizedCapabilityFilters,
  ): Promise<DiscoveryResult> {
    if (this.capability?.enabled === true) {
      try {
        return await this.discoverIndexed(request, query, filters);
      } catch {
        // A surprising indexed failure must never hide skills: the scan below is
        // authoritative and reports its own warnings.
      }
    }
    return this.discoverScan(request, query, filters);
  }

  private async discoverScan(
    request: PageRequest,
    query: string,
    filters: NormalizedCapabilityFilters,
  ): Promise<DiscoveryResult> {
    const catalog = await this.catalog.getCatalog({
      projectPath: request.projectPath, harness: request.harness, query,
    });
    const warnings = [...catalog.warnings];
    if (hasMetadataFilters(filters)) {
      warnings.push({
        code: 'METADATA_FILTER_UNSUPPORTED',
        message: 'Metadata filters were not applied because the fresh catalog scan answered this request.',
        harness: request.harness,
        reason: 'SCAN_ONLY',
      });
    }
    return {
      entries: catalog.groups.flatMap((group) => group.entries)
        .filter((entry) => (filters.sources.length === 0 || filters.sources.includes(entry.source)) &&
          entry.enabled === filters.enabled)
        .map(scanEntry),
      warnings,
      retrieval: { mode: 'scan', elapsedMs: catalog.elapsedMs },
    };
  }

  private async discoverIndexed(
    request: PageRequest,
    query: string,
    filters: NormalizedCapabilityFilters,
  ): Promise<DiscoveryResult> {
    const capability = this.capability;
    if (capability === undefined) return this.discoverScan(request, query, filters);
    const started = performance.now();
    const searchRequest = {
      harness: request.harness, projectPath: request.projectPath, query,
      ...filters,
    };
    const first = await capability.search({
      ...searchRequest,
      offset: 0, limit: CAPABILITY_MAX_RESULTS,
    });
    if (first.mode === 'scan') {
      // The service already fell back. Use the catalog once so the page has the
      // complete unranked entry list instead of one sliced fallback page.
      const scan = await this.discoverScan(request, query, filters);
      return {
        ...scan,
        warnings: first.warnings,
        retrieval: {
          mode: 'scan',
          ...(first.reason === undefined ? {} : { reason: first.reason }),
          elapsedMs: Math.round((performance.now() - started) * 100) / 100,
        },
      };
    }
    if (first.total > MAX_INDEXED_SNAPSHOT_ENTRIES) return this.discoverScan(request, query, filters);

    const candidates: CapabilityCandidate[] = [...first.candidates];
    const seen = new Set(candidates.map((candidate) => candidate.id));
    let nextOffset = first.nextOffset;
    while (nextOffset !== null && candidates.length < MAX_INDEXED_SNAPSHOT_ENTRIES) {
      const requestedOffset = nextOffset;
      const next: CapabilitySearchResponse = await capability.search({
        ...searchRequest,
        offset: requestedOffset, limit: CAPABILITY_MAX_RESULTS,
      });
      if (next.mode !== 'index') return this.discoverScan(request, query, filters);
      for (const candidate of next.candidates) {
        if (seen.has(candidate.id)) continue;
        seen.add(candidate.id);
        candidates.push(candidate);
      }
      if (next.candidates.length === 0) break;
      nextOffset = next.nextOffset;
      if (nextOffset !== null && nextOffset <= requestedOffset) {
        // A validated query must move forward; otherwise use the complete scan.
        return this.discoverScan(request, query, filters);
      }
    }
    if (nextOffset !== null) return this.discoverScan(request, query, filters);

    return {
      entries: candidates.map(candidateToEntry),
      warnings: first.warnings,
      retrieval: {
        mode: 'index',
        ...(first.ranking === undefined ? {} : { ranking: first.ranking }),
        elapsedMs: Math.round((performance.now() - started) * 100) / 100,
      },
      ...(first.coverage === undefined ? {} : { coverage: first.coverage }),
    };
  }

  private expire(): void {
    const now = this.now();
    for (const [id, snapshot] of this.snapshots) {
      if (snapshot.expiresAt <= now) this.remove(id);
    }
  }

  private remove(id: string): void {
    const snapshot = this.snapshots.get(id);
    if (snapshot === undefined) return;
    this.snapshots.delete(id);
    this.bytes -= snapshot.size;
  }
}

/**
 * A scan entry already carries its remote fingerprint internally. Surface it
 * explicitly so consumers get the same binding field from both retrieval paths.
 */
function scanEntry(entry: SkillEntry): SkillEntry {
  const remote = entry[REMOTE_SNAPSHOT_CONTENT];
  if (entry.fingerprint !== undefined || remote === undefined) return entry;
  return { ...entry, fingerprint: remote.fingerprint };
}

/**
 * Preserve provenance and exact remote binding identity while adding the
 * bounded match snippet and score. Consumers still read every selected package
 * in full; a snippet is never package review.
 */
function candidateToEntry(candidate: CapabilityCandidate): SkillEntry {
  return {
    id: candidate.id,
    harness: candidate.harness,
    source: candidate.source,
    name: candidate.name,
    description: candidate.description,
    path: candidate.path,
    packagePath: candidate.packagePath,
    ...(candidate.sourceDirectory === undefined ? {} : { sourceDirectory: candidate.sourceDirectory }),
    enabled: candidate.enabled,
    ...(candidate.sourceId === undefined ? {} : { sourceId: candidate.sourceId }),
    ...(candidate.repository === undefined ? {} : { repository: candidate.repository }),
    ...(candidate.revision === undefined ? {} : { revision: candidate.revision }),
    ...(candidate.repositoryPath === undefined ? {} : { repositoryPath: candidate.repositoryPath }),
    ...(candidate.fingerprint === '' ? {} : { fingerprint: candidate.fingerprint }),
    ...(candidate.metadata === undefined ? {} : { metadata: candidate.metadata }),
    match: { score: candidate.score, snippet: candidate.snippet },
  };
}

/** Canonical snapshot identity for a filter set. */
function pageFiltersKey(filters: NormalizedCapabilityFilters): string {
  return JSON.stringify({
    sources: [...filters.sources].sort(),
    enabled: filters.enabled,
    tags: [...filters.tags].sort(),
    tools: [...filters.tools].sort(),
    inputs: [...filters.inputs].sort(),
    outputs: [...filters.outputs].sort(),
  });
}
