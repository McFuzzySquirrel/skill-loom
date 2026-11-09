import { mkdir, mkdtemp, realpath, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogService } from '../../src/server/catalog/merge.js';
import { ProjectCatalogPages } from '../../src/server/catalog/project-pages.js';
import type { CatalogWarning, SkillEntry } from '../../src/server/catalog/types.js';

let root: string;
let project: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loom-catalog-pages-'));
  project = join(await realpath(root), 'project');
  await mkdir(project);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function entry(name: string): SkillEntry {
  return {
    id: name, harness: 'opencode', source: 'project', name, description: name,
    path: `/skills/${name}/SKILL.md`, packagePath: `/skills/${name}`, enabled: true,
  };
}

function service(entries: SkillEntry[], warnings: CatalogWarning[] = []) {
  const getCatalog = vi.fn<CatalogService['getCatalog']>(async (request) => ({
    harness: request.harness, query: (request.query ?? '').trim(), total: entries.length,
    counts: { total: entries.length, bySource: {
      project: entries.length, personal: 0, custom: 0, plugin: 0, builtin: 0, 'loom-extra': 0, remote: 0,
    } },
    groups: [{ source: 'project', count: entries.length, entries: [...entries] }],
    agents: [], warnings: [...warnings], elapsedMs: 1,
  }));
  return { defaultHarness: 'opencode' as const, getCatalog };
}

const request = () => ({
  projectId: 'project-id', projectPath: project, harness: 'opencode' as const,
  query: '', offset: 0, limit: 1, warningsOffset: 0,
});

describe('project catalog page snapshots', () => {
  it('keeps pages and warning cursors stable without rediscovery', async () => {
    const entries = [entry('one'), entry('two')];
    const warnings: CatalogWarning[] = Array.from({ length: 101 }, (_, index) => ({
      code: 'CATALOG_DISCOVERY_SLOW', message: `warning ${String(index)}`, harness: 'opencode',
    }));
    const catalog = service(entries, warnings);
    const pages = new ProjectCatalogPages(catalog);
    const first = await pages.page(request());
    expect(first).toMatchObject({ total: 2, nextOffset: 1, warningsNextOffset: 100, snapshotId: expect.any(String) });
    entries.splice(0, entries.length, entry('replacement'));
    warnings.splice(0, warnings.length);
    const second = await pages.page({
      ...request(), snapshotId: first.snapshotId!, offset: 1, warningsOffset: 100,
    });
    expect(second.entries.map((item) => item.name)).toEqual(['two']);
    expect(second.warnings).toHaveLength(1);
    expect(second.nextOffset).toBeNull();
    expect(catalog.getCatalog).toHaveBeenCalledTimes(1);
    expect((await pages.page(request())).entries[0]?.name).toBe('replacement');
  });

  it('rejects mismatched, expired, evicted, and replaced project snapshots', async () => {
    let time = 0;
    const pages = new ProjectCatalogPages(service([entry('one')]), () => time, 1024 * 1024, 2);
    const first = await pages.page(request());
    await expect(pages.page({ ...request(), query: 'other', snapshotId: first.snapshotId! }))
      .rejects.toMatchObject({ code: 'CATALOG_PAGE_MISMATCH' });
    await pages.page(request());
    await pages.page(request());
    await expect(pages.page({ ...request(), snapshotId: first.snapshotId! }))
      .rejects.toMatchObject({ code: 'CATALOG_PAGE_EXPIRED' });
    const next = await pages.page(request());
    time += 120_000;
    await expect(pages.page({ ...request(), snapshotId: next.snapshotId! }))
      .rejects.toMatchObject({ code: 'CATALOG_PAGE_EXPIRED' });
    const current = await pages.page(request());
    await rename(project, join(root, 'old-project'));
    await mkdir(project);
    await expect(pages.page({ ...request(), snapshotId: current.snapshotId! }))
      .rejects.toMatchObject({ code: 'CATALOG_PAGE_MISMATCH' });
  });

  it('reports an uncached fallback instead of truncating oversized results', async () => {
    const catalog = service([entry('one'), entry('two')]);
    const pages = new ProjectCatalogPages(catalog, Date.now, 1);
    const first = await pages.page(request());
    expect(first).toMatchObject({
      total: 2, snapshotId: null, nextOffset: 1,
      paginationWarning: { code: 'CATALOG_PAGE_NOT_CACHED' },
    });
    expect((await pages.page({ ...request(), offset: 1 })).entries[0]?.name).toBe('two');
    expect(catalog.getCatalog).toHaveBeenCalledTimes(2);
  });
});
