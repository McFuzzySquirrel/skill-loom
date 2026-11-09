import { randomBytes } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import type { CatalogService } from './merge.js';
import type { CatalogWarning, SkillEntry, SkillHarness } from './types.js';

const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_SNAPSHOTS = 4;
const SNAPSHOT_TTL_MS = 2 * 60 * 1000;

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
}

interface Snapshot {
  projectId: string;
  projectPath: string;
  projectDevice: string;
  projectInode: string;
  harness: SkillHarness;
  query: string;
  entries: SkillEntry[];
  warnings: CatalogWarning[];
  size: number;
  expiresAt: number;
}

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
  ) {}

  async page(request: PageRequest) {
    const query = (request.query ?? '').trim();
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
          found.projectDevice !== project.device || found.projectInode !== project.inode) {
        throw new ProjectCatalogPageError('CATALOG_PAGE_MISMATCH', 'The catalog page snapshot belongs to a different project, harness, or query.');
      }
      snapshot = found;
      this.snapshots.delete(snapshotId);
      this.snapshots.set(snapshotId, snapshot);
    } else {
      const catalog = await this.catalog.getCatalog({
        projectPath: request.projectPath, harness: request.harness, query,
      });
      const after = await projectIdentity(request.projectPath);
      if (project.device !== after.device || project.inode !== after.inode) {
        throw new ProjectCatalogPageError('CATALOG_PAGE_PROJECT_CHANGED', 'The catalog project changed during discovery; start a new search.');
      }
      const entries = catalog.groups.flatMap((group) => group.entries);
      let size = 0;
      for (const values of [entries, catalog.warnings]) {
        for (const value of values) {
          size += Buffer.byteLength(JSON.stringify(value), 'utf8');
          if (size > this.maxCacheBytes) break;
        }
        if (size > this.maxCacheBytes) break;
      }
      snapshot = {
        projectId: request.projectId, projectPath: request.projectPath, harness: request.harness,
        projectDevice: project.device, projectInode: project.inode,
        query: catalog.query, entries, warnings: catalog.warnings, size, expiresAt: this.now() + SNAPSHOT_TTL_MS,
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
