import { mkdir, mkdtemp, realpath, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CapabilityCandidate,
  CapabilityFallbackReason,
  CapabilityIndexQuery,
  CapabilityMetadataCoverage,
  CapabilityMetadataFacets,
  CapabilitySearchResponse,
} from '../../src/server/catalog/capability-index.js';
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

function candidate(name: string, extra: Partial<CapabilityCandidate> = {}): CapabilityCandidate {
  return {
    id: `opencode-project-${name}`,
    harness: 'opencode',
    source: 'project',
    name,
    description: `${name} description`,
    path: `/skills/${name}/SKILL.md`,
    packagePath: `/skills/${name}`,
    rootPath: '/skills',
    enabled: true,
    score: 1,
    snippet: `${name} snippet`,
    fingerprint: '',
    ...extra,
  };
}

function capability(candidates: CapabilityCandidate[], options: {
  mode?: 'index' | 'scan';
  reason?: CapabilityFallbackReason;
  total?: number;
  coverage?: CapabilityMetadataCoverage;
  facets?: CapabilityMetadataFacets;
  warnings?: CapabilitySearchResponse['warnings'];
} = {}) {
  const search = vi.fn(async (input: CapabilityIndexQuery): Promise<CapabilitySearchResponse> => ({
    mode: options.mode ?? 'index',
    ...(options.reason === undefined ? {} : { reason: options.reason }),
    harness: input.harness ?? 'opencode',
    query: input.query ?? '',
    total: options.total ?? candidates.length,
    offset: input.offset ?? 0,
    limit: input.limit ?? 10,
    nextOffset: null,
    candidates,
    warnings: options.warnings ?? [],
    elapsedMs: 1,
    ...(options.mode === 'scan' ? {} : { ranking: 'fts5' as const }),
    ...(options.coverage === undefined ? {} : { coverage: options.coverage }),
    ...(options.facets === undefined ? {} : { facets: options.facets }),
  }));
  return { enabled: true as const, search };
}

const facets: CapabilityMetadataFacets = {
  tags: [{ value: 'release', count: 1 }],
  tools: [{ value: 'Grep', count: 1 }, { value: 'Read', count: 1 }],
  inputs: [{ value: 'release_manifest', count: 1 }],
  outputs: [{ value: 'attestation_bundle', count: 1 }],
};

const coverage: CapabilityMetadataCoverage = {
  total: 2,
  withDescription: 2,
  withHeadings: 2,
  withTags: 1,
  withTools: 1,
  withInputs: 0,
  withOutputs: 0,
  withWhenToUse: 1,
  withIssues: 0,
  withoutStructuredMetadata: 1,
};

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

  it('serves indexed candidates with snippets and exact remote binding under the page contract', async () => {
    const catalog = service([entry('scanned-only')]);
    const indexed = capability([
      candidate('local-review', { score: 4.2, snippet: '…authorization checks…' }),
      candidate('remote-review', {
        source: 'remote', score: 2.1, snippet: '…remote binding…',
        sourceId: 'team-skills', revision: 'a'.repeat(40),
        repositoryPath: 'collection/remote-review', repository: 'https://example.invalid/team.git',
        fingerprint: 'b'.repeat(64),
      }),
    ]);
    const pages = new ProjectCatalogPages(catalog, Date.now, undefined, undefined, indexed);
    const first = await pages.page({ ...request(), query: 'review' });
    expect(first).toMatchObject({
      total: 2,
      retrieval: { mode: 'index', ranking: 'fts5' },
      entries: [
        {
          name: 'local-review', match: { score: 4.2, snippet: '…authorization checks…' },
        },
      ],
      nextOffset: 1,
      snapshotId: expect.any(String),
    });
    const second = await pages.page({
      ...request(), query: 'review', offset: 1, snapshotId: first.snapshotId!,
    });
    expect(second.entries[0]).toMatchObject({
      name: 'remote-review', source: 'remote',
      sourceId: 'team-skills', revision: 'a'.repeat(40),
      repositoryPath: 'collection/remote-review', repository: 'https://example.invalid/team.git',
      fingerprint: 'b'.repeat(64),
    });
    expect(indexed.search).toHaveBeenCalledTimes(1);
    expect(catalog.getCatalog).not.toHaveBeenCalled();
  });

  it('passes metadata filters through the index and keeps them in the snapshot identity', async () => {
    const catalog = service([entry('scanned-only')]);
    const indexed = capability([
      candidate('release-audit', {
        metadata: {
          tags: ['release', 'remote'],
          tools: ['Read', 'Grep'],
          inputs: ['release_manifest'],
          outputs: ['attestation_bundle'],
          whenToUse: 'Use before a remote release.',
        },
      }),
    ], { coverage, facets });
    const pages = new ProjectCatalogPages(catalog, Date.now, undefined, undefined, indexed);
    const first = await pages.page({
      ...request(), query: 'attestation', sources: ['project'], tags: ['release'], tools: ['grep'],
      hasTools: true,
    });
    expect(indexed.search).toHaveBeenCalledWith(expect.objectContaining({
      sources: ['project'], enabled: true, tags: ['release'], tools: ['grep'], hasTools: true,
    }));
    expect(first).toMatchObject({
      metadataCoverage: coverage,
      metadataFacets: facets,
      entries: [{
        name: 'release-audit',
        metadata: {
          tags: ['release', 'remote'],
          tools: ['Read', 'Grep'],
          inputs: ['release_manifest'],
          outputs: ['attestation_bundle'],
          whenToUse: 'Use before a remote release.',
        },
      }],
    });
    await expect(pages.page({
      ...request(), query: 'attestation', sources: ['project'], tags: ['different'],
      snapshotId: first.snapshotId!,
    })).rejects.toMatchObject({ code: 'CATALOG_PAGE_MISMATCH' });
    await expect(pages.page({
      ...request(), query: 'attestation', sources: ['project'], tags: ['release'], tools: ['grep'],
      hasTools: false, snapshotId: first.snapshotId!,
    })).rejects.toMatchObject({ code: 'CATALOG_PAGE_MISMATCH' });
    expect((await pages.page({
      ...request(), query: 'attestation', sources: ['project'], tags: ['release'], tools: ['grep'],
      hasTools: true, snapshotId: first.snapshotId!,
    })).entries[0]?.name).toBe('release-audit');
    expect(indexed.search).toHaveBeenCalledTimes(1);
  });

  it('warns when metadata filters reach the scan fallback', async () => {
    const catalog = service([entry('scanned-entry')]);
    const pages = new ProjectCatalogPages(
      catalog, Date.now, undefined, undefined,
      capability([], { mode: 'scan', reason: 'disabled', warnings: [{
        code: 'METADATA_FILTER_UNSUPPORTED',
        message: 'Metadata filters were not applied.',
        harness: 'opencode',
      }] }),
    );
    const result = await pages.page({ ...request(), query: 'review', tags: ['release'] });
    expect(result.warnings.map((warning) => warning.code)).toContain('METADATA_FILTER_UNSUPPORTED');
    expect(result.metadataCoverage).toBeNull();
    expect(result.metadataFacets).toBeNull();
  });

  it('uses the fresh scan when the indexed path fails or reports a fallback', async () => {
    const catalog = service([entry('scanned-entry')]);

    const scanMode = new ProjectCatalogPages(
      catalog, Date.now, undefined, undefined,
      capability([], { mode: 'scan', reason: 'disabled' }),
    );
    expect(await scanMode.page({ ...request(), query: 'review' })).toMatchObject({
      entries: [{ name: 'scanned-entry' }],
      retrieval: { mode: 'scan', reason: 'disabled' },
    });

    const failing = new ProjectCatalogPages(catalog, Date.now, undefined, undefined, {
      enabled: true,
      search: vi.fn(async () => { throw new Error('index exploded'); }),
    });
    expect(await failing.page({ ...request(), query: 'review' })).toMatchObject({
      entries: [{ name: 'scanned-entry' }],
      retrieval: { mode: 'scan' },
    });
    expect(catalog.getCatalog).toHaveBeenCalledTimes(2);
  });

  it('uses the fresh scan instead of truncating an oversized indexed result set', async () => {
    const catalog = service([entry('scanned-entry')]);
    const indexed = capability([candidate('one')], { total: 501 });
    const pages = new ProjectCatalogPages(catalog, Date.now, undefined, undefined, indexed);
    const result = await pages.page({ ...request(), query: 'review' });
    expect(result).toMatchObject({
      total: 1,
      entries: [{ name: 'scanned-entry' }],
      retrieval: { mode: 'scan' },
    });
    expect(catalog.getCatalog).toHaveBeenCalledTimes(1);
  });
});
