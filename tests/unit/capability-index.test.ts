import { createHash } from 'node:crypto';
import { cp, link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CAPABILITY_BODY_EXCERPT_BYTES,
  CAPABILITY_DEFAULT_RESULTS,
  CAPABILITY_INDEX_FILE_NAME,
  CAPABILITY_MAX_RESULTS,
  CAPABILITY_MAX_SNIPPET_CHARS,
  CAPABILITY_QUERY_BUDGET_MS,
  CapabilityIndex,
  CapabilityIndexError,
  capabilityIndexEnabled,
  catalogCapabilityFallback,
  collectCapabilityPackages,
  collectRemoteCapabilityPackages,
  createCapabilitySearchService,
  defaultCapabilitySourceRoots,
  type CapabilityCollection,
  type CapabilityFallback,
  type CapabilitySearchResponse,
  type CapabilitySourceRoot,
} from '../../src/server/catalog/capability-index.js';
import type { CatalogService } from '../../src/server/catalog/merge.js';
import {
  snapshotPackageFingerprint,
  snapshotReviewFingerprint,
} from '../../src/server/catalog/snapshot-fingerprint.js';
import type { SkillEntry, SkillHarness } from '../../src/server/catalog/types.js';

const testDirectory = dirname(fileURLToPath(import.meta.url));

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot(prefix = 'loom-capability-'): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

async function writeSkill(
  packagePath: string,
  options: { name?: string; description?: string; body?: string } = {},
): Promise<void> {
  await mkdir(packagePath, { recursive: true });
  const name = options.name ?? packagePath.split('/').at(-1) ?? 'skill';
  const description = options.description ?? `${name} description`;
  const body = options.body ?? `# ${name}\n\nUse ${name}.`;
  await writeFile(
    join(packagePath, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`,
    'utf8',
  );
}

async function projectRoot(): Promise<{ project: string; skills: string }> {
  const project = join(await makeRoot(), 'project');
  const skills = join(project, '.agents', 'skills');
  await mkdir(skills, { recursive: true });
  return { project, skills };
}

function projectSource(project: string, skills: string): CapabilitySourceRoot {
  return {
    directory: skills,
    harness: 'opencode',
    source: 'project',
    projectPath: project,
  };
}

async function collect(sources: CapabilitySourceRoot[]): Promise<CapabilityCollection> {
  return collectCapabilityPackages(sources);
}

function indexOptions(directory: string, extra: Record<string, unknown> = {}) {
  return { directory, ...extra };
}

function fallbackResponse(
  request: { harness: SkillHarness; query: string; offset: number; limit: number },
  names: string[] = [],
): CapabilitySearchResponse {
  const candidates = names.slice(request.offset, request.offset + request.limit).map((name) => ({
    id: name,
    harness: request.harness,
    source: 'project' as const,
    name,
    description: name,
    path: `/fallback/${name}/SKILL.md`,
    packagePath: `/fallback/${name}`,
    rootPath: '/fallback',
    enabled: true,
    score: 0,
    snippet: name,
    fingerprint: '',
  }));
  return {
    mode: 'scan',
    harness: request.harness,
    query: request.query,
    total: names.length,
    offset: request.offset,
    limit: request.limit,
    nextOffset: null,
    candidates,
    warnings: [],
    elapsedMs: 1,
  };
}

describe('capability index', () => {
  it('requires an explicit opt-in flag', () => {
    expect(capabilityIndexEnabled({})).toBe(false);
    expect(capabilityIndexEnabled({ LOOM_CAPABILITY_INDEX: '0' })).toBe(false);
    expect(capabilityIndexEnabled({ LOOM_CAPABILITY_INDEX: '1' })).toBe(true);
  });

  it('indexes headings and body text and returns ranked provenance', async () => {
    const { project, skills } = await projectRoot();
    await writeSkill(join(skills, 'api-security-review'), {
      description: 'Review an API for security issues.',
      body: [
        '# API security review',
        '',
        '## Authentication',
        'Check sessions and token expiry.',
        '',
        '## Authorization',
        'Check project scope and indirect object references.',
        '',
        '## Input validation',
        'Check size limits and injection surfaces.',
      ].join('\n'),
    });
    const source = projectSource(project, skills);
    const collection = await collect([source]);
    const index = new CapabilityIndex(indexOptions(join(project, '.loom-index')));
    await index.rebuild(collection);

    const result = await index.search({ harness: 'opencode', projectPath: project, query: 'authorization' });
    expect(result.mode).toBe('index');
    expect(result.ranking).toBe('fts5');
    expect(result.total).toBe(1);
    expect(result.candidates[0]).toMatchObject({
      name: 'api-security-review',
      source: 'project',
      projectPath: project,
      path: join(skills, 'api-security-review', 'SKILL.md'),
      packagePath: join(skills, 'api-security-review'),
    });
    expect(result.candidates[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.candidates[0]?.snippet.toLowerCase()).toContain('authorization');

    const bodyOnly = await index.search({ harness: 'opencode', projectPath: project, query: 'injection surfaces' });
    expect(bodyOnly.candidates.map((candidate) => candidate.name)).toEqual(['api-security-review']);

    const missing = await index.search({ harness: 'opencode', projectPath: project, query: 'quantum entanglement' });
    expect(missing.total).toBe(0);
    await index.dispose({ deleteIndex: true });
  });

  it('refreshes a changed SKILL.md and keeps unchanged rows through the stat fast path', async () => {
    const { project, skills } = await projectRoot();
    const packagePath = join(skills, 'release-checklist');
    await writeSkill(packagePath, { body: '# Release\n\nPrepare a release.' });
    const source = projectSource(project, skills);
    const index = new CapabilityIndex(indexOptions(join(project, '.loom-index')));
    await index.rebuild(await collect([source]));

    const before = await index.search({ harness: 'opencode', projectPath: project, query: 'release' });
    expect(before.total).toBe(1);
    const firstFingerprint = before.candidates[0]?.fingerprint;
    expect(firstFingerprint).toMatch(/^[a-f0-9]{64}$/);

    await index.refresh(await collect([source]));
    const unchanged = await index.search({ harness: 'opencode', projectPath: project, query: 'release' });
    expect(unchanged.candidates[0]?.fingerprint).toBe(firstFingerprint);

    await writeSkill(packagePath, {
      body: '# Release\n\nPrepare a release.\n\n## Rollback\n\nUse the emergency rollback procedure.',
    });
    await index.refresh(await collect([source]));
    const changed = await index.search({ harness: 'opencode', projectPath: project, query: 'emergency rollback' });
    expect(changed.total).toBe(1);
    expect(changed.candidates[0]?.fingerprint).not.toBe(firstFingerprint);
    await index.dispose({ deleteIndex: true });
  });

  it('falls back to the fresh scan for a disabled, missing, corrupt, or unsafe index', async () => {
    const { project, skills } = await projectRoot();
    await writeSkill(join(skills, 'incident-triage'));
    const source = projectSource(project, skills);
    const indexDirectory = join(project, '.loom-index');
    const sources = async () => collect([source]);
    const fallback: CapabilityFallback = async (request) => fallbackResponse(request, ['incident-triage']);

    const disabled = createCapabilitySearchService({
      enabled: false,
      index: indexOptions(indexDirectory),
      sources,
      fallback,
    });
    const disabledResult = await disabled.search({ harness: 'opencode', projectPath: project, query: 'triage' });
    expect(disabledResult).toMatchObject({ mode: 'scan', reason: 'disabled' });
    expect(disabledResult.candidates[0]?.name).toBe('incident-triage');
    await disabled.dispose();

    const missing = createCapabilitySearchService({
      enabled: true,
      index: indexOptions(indexDirectory),
      sources,
      fallback,
    });
    const missingResult = await missing.search({ harness: 'opencode', projectPath: project, query: 'triage' });
    expect(missingResult).toMatchObject({ mode: 'scan', reason: 'missing' });
    expect(missingResult.candidates[0]?.name).toBe('incident-triage');
    expect(missingResult.warnings.some((warning) => warning.code === 'CAPABILITY_INDEX_FALLBACK')).toBe(true);
    const rebuilt = await missing.search({ harness: 'opencode', projectPath: project, query: 'incident' });
    expect(rebuilt.mode).toBe('index');
    await missing.dispose();

    await writeFile(join(indexDirectory, CAPABILITY_INDEX_FILE_NAME), 'not a database', 'utf8');
    const corrupt = createCapabilitySearchService({
      enabled: true,
      index: indexOptions(indexDirectory),
      sources,
      fallback,
    });
    const corruptResult = await corrupt.search({ harness: 'opencode', projectPath: project, query: 'triage' });
    expect(corruptResult).toMatchObject({ mode: 'scan', reason: 'corrupt' });
    expect(corruptResult.candidates[0]?.name).toBe('incident-triage');
    const afterCorrupt = await corrupt.search({ harness: 'opencode', projectPath: project, query: 'incident' });
    expect(afterCorrupt.mode).toBe('index');
    await corrupt.dispose();

    const outside = join(await makeRoot(), 'outside.sqlite');
    await writeFile(outside, 'placeholder', 'utf8');
    await rm(join(indexDirectory, CAPABILITY_INDEX_FILE_NAME), { force: true });
    await symlink(outside, join(indexDirectory, CAPABILITY_INDEX_FILE_NAME));
    const unsafe = createCapabilitySearchService({
      enabled: true,
      index: indexOptions(indexDirectory),
      sources,
      fallback,
    });
    const unsafeResult = await unsafe.search({ harness: 'opencode', projectPath: project, query: 'triage' });
    expect(unsafeResult).toMatchObject({ mode: 'scan', reason: 'unsafe' });
    expect(unsafeResult.candidates[0]?.name).toBe('incident-triage');
    await unsafe.dispose();
  });

  it('rejects unsafe roots, package symlinks, and hard-linked index files', async () => {
    const root = await makeRoot();
    const outsidePackage = join(root, 'outside', 'nested-skill');
    await writeSkill(outsidePackage);
    const { project, skills } = await projectRoot();
    await symlink(outsidePackage, join(skills, 'linked-skill'));
    const source = projectSource(project, skills);
    const collection = await collect([source]);
    expect(collection.packages).toHaveLength(0);

    const symlinkedRoot = join(root, 'linked-root');
    await symlink(skills, symlinkedRoot);
    const linkedCollection = await collect([{ ...source, directory: symlinkedRoot }]);
    expect(linkedCollection.packages).toHaveLength(0);

    const indexDirectory = join(project, '.loom-index');
    await mkdir(indexDirectory, { recursive: true, mode: 0o700 });
    const index = new CapabilityIndex(indexOptions(indexDirectory));
    await index.rebuild(await collect([source, { ...source, directory: join(project, '.agents', 'missing') }]));
    const indexPath = join(indexDirectory, CAPABILITY_INDEX_FILE_NAME);
    const hardLink = join(root, 'hard-linked-index.sqlite');
    await link(indexPath, hardLink);
    const validation = await index.validate();
    expect(validation).toMatchObject({ ok: false, reason: 'unsafe' });
    await index.dispose();
  });

  it('handles unicode, punctuation, and bounded queries without FTS syntax errors', async () => {
    const { project, skills } = await projectRoot();
    await writeSkill(join(skills, 'unicode-skill'), {
      body: '# Café résumé\n\nNaïve approach for 日本語のスキル and a café menu.',
    });
    const source = projectSource(project, skills);
    const index = new CapabilityIndex(indexOptions(join(project, '.loom-index')));
    await index.rebuild(await collect([source]));

    for (const query of ['cafe', 'CAFÉ', '日本語', 'AND OR ( ) *', '"quoted"', 'naive']) {
      const result = await index.search({ harness: 'opencode', projectPath: project, query });
      expect(result.query.length).toBeLessThanOrEqual(500);
      expect(Array.isArray(result.candidates)).toBe(true);
    }
    const accented = await index.search({ harness: 'opencode', projectPath: project, query: 'cafe' });
    expect(accented.candidates.map((candidate) => candidate.name)).toEqual(['unicode-skill']);
    await index.dispose({ deleteIndex: true });
  });

  it('bounds result counts, snippet lengths, and stored body excerpts', async () => {
    const { project, skills } = await projectRoot();
    const longBody = `# Long\n\n${'capability '.repeat(20_000)}`;
    for (let index = 0; index < 60; index += 1) {
      await writeSkill(join(skills, `skill-${String(index).padStart(2, '0')}`), {
        body: index === 0 ? longBody : `# Skill\n\ncapability text ${String(index)}`,
      });
    }
    const source = projectSource(project, skills);
    const indexDirectory = join(project, '.loom-index');
    const index = new CapabilityIndex(indexOptions(indexDirectory));
    await index.rebuild(await collect([source]));

    const result = await index.search({ harness: 'opencode', projectPath: project, query: 'capability', limit: 999 });
    expect(result.limit).toBe(CAPABILITY_MAX_RESULTS);
    expect(result.candidates.length).toBe(CAPABILITY_MAX_RESULTS);
    for (const candidate of result.candidates) {
      expect(candidate.snippet.length).toBeLessThanOrEqual(CAPABILITY_MAX_SNIPPET_CHARS + 2);
    }

    const defaultResult = await index.search({ harness: 'opencode', projectPath: project, query: 'capability' });
    expect(defaultResult.limit).toBe(CAPABILITY_DEFAULT_RESULTS);

    const database = new DatabaseSync(join(indexDirectory, CAPABILITY_INDEX_FILE_NAME), { readOnly: true });
    try {
      const row = database.prepare('SELECT length(body_excerpt) AS length FROM skills WHERE name = ?').get('skill-00') as
        | { length: number }
        | undefined;
      expect(row?.length).toBeLessThanOrEqual(CAPABILITY_BODY_EXCERPT_BYTES);
    } finally {
      database.close();
    }
    await index.dispose({ deleteIndex: true });
  });

  it('returns the exact remote binding identity and validates remote rows before serving', async () => {
    const root = await makeRoot();
    const packagePath = join(root, 'snapshot', 'packages', 'remote-demo');
    await writeSkill(packagePath, { description: 'Remote demonstration skill.', body: '# Remote\n\nremoteonly marker' });
    const descriptor = {
      harness: 'opencode' as const,
      source: 'remote' as const,
      path: join(packagePath, 'SKILL.md'),
      packagePath,
      rootPath: join(root, 'snapshot'),
      fallbackName: 'remote-demo',
      remote: {
        sourceId: 'team-skills',
        revision: 'a'.repeat(40),
        repositoryPath: 'collection/remote-demo',
        repository: 'https://example.invalid/team.git',
        fingerprint: 'b'.repeat(64),
      },
    };
    const collection = { roots: [], packages: [descriptor], warnings: [] };
    const index = new CapabilityIndex(indexOptions(join(root, 'config'), {
      validateRemote: (candidate: { repositoryPath?: string }) => candidate.repositoryPath === 'collection/remote-demo',
    }));
    await index.rebuild(collection);
    const result = await index.search({ harness: 'opencode', projectPath: join(root, 'project'), query: 'remoteonly' });
    expect(result.candidates[0]).toMatchObject({
      source: 'remote',
      sourceId: 'team-skills',
      revision: 'a'.repeat(40),
      repositoryPath: 'collection/remote-demo',
      repository: 'https://example.invalid/team.git',
      fingerprint: 'b'.repeat(64),
    });
    await index.dispose({ deleteIndex: true });
  });

  it('collects verified remote snapshot packages with their exact binding', async () => {
    const root = await makeRoot();
    const configDirectory = join(root, 'config');
    const sourceId = 'team-skills';
    const revision = 'a'.repeat(40);
    const directory = 'b'.repeat(64);
    const packagePath = join(configDirectory, 'catalog-sources', sourceId, revision, 'packages', directory);
    await writeSkill(packagePath, {
      name: 'remote-demo',
      description: 'Remote demonstration skill.',
      body: '# Remote\n\nsnapshotonly capability',
    });
    const content = await readFile(join(packagePath, 'SKILL.md'));
    const fingerprint = snapshotPackageFingerprint([{ path: 'SKILL.md', content, executable: false }]);
    const reviewFingerprint = snapshotReviewFingerprint([{ path: 'SKILL.md', content, executable: false }]);
    const snapshotRoot = join(configDirectory, 'catalog-sources', sourceId, revision);
    await writeFile(join(snapshotRoot, 'snapshot.json'), `${JSON.stringify({
      version: 1,
      sourceId,
      repository: 'https://example.invalid/team.git',
      revision,
      packages: [{
        name: 'remote-demo',
        description: 'Remote demonstration skill.',
        repositoryPath: 'collection/remote-demo',
        directory,
        files: 1,
        bytes: content.byteLength,
        fingerprint,
      }],
      agents: [],
    }, null, 2)}\n`, 'utf8');
    await mkdir(join(snapshotRoot, 'modes'), { recursive: true });
    await writeFile(join(snapshotRoot, 'modes', `${directory}.json`), `${JSON.stringify({
      version: 1,
      executablePaths: [],
    })}\n`, 'utf8');
    await writeFile(join(snapshotRoot, 'modes', `${directory}.review.json`), `${JSON.stringify({
      version: 1,
      fingerprint: reviewFingerprint,
    })}\n`, 'utf8');

    const collection = await collectRemoteCapabilityPackages({
      configDirectory,
      sources: [{ id: sourceId, repository: 'https://example.invalid/team.git' }],
      harness: 'opencode',
    });
    expect(collection.warnings).toEqual([]);
    expect(collection.packages).toHaveLength(1);
    expect(collection.packages[0]).toMatchObject({
      source: 'remote',
      remote: {
        sourceId,
        revision,
        repositoryPath: 'collection/remote-demo',
        repository: 'https://example.invalid/team.git',
        fingerprint,
      },
    });

    const index = new CapabilityIndex(indexOptions(join(root, 'index-config')));
    await index.rebuild({ roots: [], packages: collection.packages, warnings: collection.warnings });
    const result = await index.search({ harness: 'opencode', projectPath: join(root, 'project'), query: 'snapshotonly' });
    expect(result.candidates[0]).toMatchObject({
      name: 'remote-demo',
      source: 'remote',
      sourceId,
      revision,
      repositoryPath: 'collection/remote-demo',
      fingerprint,
    });
    await index.dispose({ deleteIndex: true });
  });

  it('drops a remote row when a pinned snapshot is no longer verified', async () => {
    const root = await makeRoot();
    const configDirectory = join(root, 'config');
    const sourceId = 'team-skills';
    const revision = 'c'.repeat(40);
    const packagePath = join(configDirectory, 'catalog-sources', sourceId, revision, 'packages', 'd'.repeat(64));
    await writeSkill(packagePath, { name: 'gone-remote', body: '# Gone\n\ntemporary remote' });
    const index = new CapabilityIndex(indexOptions(join(root, 'index-config')));
    await index.rebuild({
      roots: [],
      packages: [{
        harness: 'opencode',
        source: 'remote',
        path: join(packagePath, 'SKILL.md'),
        packagePath,
        rootPath: join(configDirectory, 'catalog-sources', sourceId, revision),
        remote: {
          sourceId,
          revision,
          repositoryPath: 'collection/gone',
          fingerprint: 'e'.repeat(64),
        },
      }],
      warnings: [],
    });
    expect((await index.search({ harness: 'opencode', projectPath: join(root, 'project'), query: 'temporary' })).total).toBe(1);
    await rm(join(configDirectory, 'catalog-sources'), { recursive: true, force: true });
    const collection = await collectRemoteCapabilityPackages({
      configDirectory,
      sources: [{ id: sourceId, repository: 'https://example.invalid/team.git' }],
      harness: 'opencode',
    });
    await index.refresh({ roots: [], packages: collection.packages, warnings: collection.warnings });
    expect((await index.search({ harness: 'opencode', projectPath: join(root, 'project'), query: 'temporary' })).total).toBe(0);
    await index.dispose({ deleteIndex: true });
  });

  it('keeps project rows scoped while shared sources remain visible', async () => {
    const root = await makeRoot();
    const firstProject = join(root, 'first');
    const secondProject = join(root, 'second');
    const firstSkills = join(firstProject, '.agents', 'skills');
    const secondSkills = join(secondProject, '.agents', 'skills');
    const personalSkills = join(root, 'home', '.agents', 'skills');
    await writeSkill(join(firstSkills, 'first-only'));
    await writeSkill(join(secondSkills, 'second-only'));
    await writeSkill(join(personalSkills, 'shared-skill'));
    const firstRoots: CapabilitySourceRoot[] = [
      projectSource(firstProject, firstSkills),
      { directory: personalSkills, harness: 'opencode', source: 'personal' },
    ];
    const secondRoots: CapabilitySourceRoot[] = [
      projectSource(secondProject, secondSkills),
      { directory: personalSkills, harness: 'opencode', source: 'personal' },
    ];
    const index = new CapabilityIndex(indexOptions(join(root, 'config')));
    await index.rebuild(await collect(firstRoots));
    await index.refresh(await collect(secondRoots));

    const first = await index.search({ harness: 'opencode', projectPath: firstProject, query: 'first-only' });
    expect(first.candidates.map((candidate) => candidate.name)).toEqual(['first-only']);
    const second = await index.search({ harness: 'opencode', projectPath: secondProject, query: 'second-only' });
    expect(second.candidates.map((candidate) => candidate.name)).toEqual(['second-only']);
    const shared = await index.search({ harness: 'opencode', projectPath: secondProject, query: 'shared-skill' });
    expect(shared.candidates.map((candidate) => candidate.name)).toEqual(['shared-skill']);
    await index.dispose({ deleteIndex: true });
  });

  it('uses the deterministic token table when FTS5 is not selected', async () => {
    const { project, skills } = await projectRoot();
    await writeSkill(join(skills, 'token-skill'), { body: '# Token\n\ndeterministic token searching' });
    const source = projectSource(project, skills);
    const index = new CapabilityIndex(indexOptions(join(project, '.loom-index'), { forceTokenSearch: true }));
    await index.rebuild(await collect([source]));
    const result = await index.search({ harness: 'opencode', projectPath: project, query: 'deterministic searching' });
    expect(result.ranking).toBe('tokens');
    expect(result.candidates.map((candidate) => candidate.name)).toEqual(['token-skill']);
    await index.dispose({ deleteIndex: true });
  });

  it('fails closed when the configured index size cannot hold the derived data', async () => {
    const { project, skills } = await projectRoot();
    await writeSkill(join(skills, 'too-large'), { body: `# Large\n\n${'content '.repeat(5000)}` });
    const source = projectSource(project, skills);
    const index = new CapabilityIndex(indexOptions(join(project, '.loom-index'), { maxBytes: 1024 }));
    await expect(index.rebuild(await collect([source]))).rejects.toMatchObject({ code: 'too_large' });
    await index.dispose({ deleteIndex: true });
  });

  it('finds body-only corpus skills and stays within the query budget', async () => {
    const { project, skills } = await projectRoot();
    const repositoryRoot = join(testDirectory, '..', '..');
    const corpus = JSON.parse(await readFile(
      join(repositoryRoot, 'tests', 'fixtures', 'retrieval', 'chain-authoring-corpus.json'),
      'utf8',
    )) as { candidates: Array<{ name: string; source: string }>; tasks: Array<{
      id: string; category: string; query: string; expectedSkills: string[];
    }> };
    for (const candidate of corpus.candidates) {
      await cp(join(repositoryRoot, candidate.source), join(skills, candidate.name), { recursive: true });
    }
    const source = projectSource(project, skills);
    const index = new CapabilityIndex(indexOptions(join(project, '.loom-index')));
    await index.rebuild(await collect([source]));

    const bodyOnly = corpus.tasks.filter((task) => task.category === 'body-only');
    for (const task of bodyOnly) {
      const result = await index.search({ harness: 'opencode', projectPath: project, query: task.query, limit: 10 });
      const names = result.candidates.map((candidate) => candidate.name);
      expect(names, task.id).toContain(task.expectedSkills[0]);
    }

    const samples: number[] = [];
    for (let round = 0; round < 3; round += 1) {
      for (const task of corpus.tasks) {
        const started = performance.now();
        await index.search({ harness: 'opencode', projectPath: project, query: task.query });
        samples.push(performance.now() - started);
      }
    }
    const sorted = [...samples].sort((left, right) => left - right);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
    expect(p95).toBeLessThan(CAPABILITY_QUERY_BUDGET_MS);
    await index.dispose({ deleteIndex: true });
  });

  it('adapts the catalog service into a truthful scan fallback', async () => {
    const { project } = await projectRoot();
    const entry: SkillEntry = {
      id: 'opencode-project-demo',
      harness: 'opencode',
      source: 'project',
      name: 'demo',
      description: 'A demo skill.',
      path: join(project, '.agents', 'skills', 'demo', 'SKILL.md'),
      packagePath: join(project, '.agents', 'skills', 'demo'),
      enabled: true,
    };
    const catalog: CatalogService = {
      defaultHarness: 'opencode',
      async getCatalog(request) {
        return {
          harness: request.harness,
          query: (request.query ?? '').trim(),
          total: 1,
          counts: {
            total: 1,
            bySource: { project: 1, personal: 0, custom: 0, plugin: 0, builtin: 0, 'loom-extra': 0, remote: 0 },
          },
          groups: [{ source: 'project', count: 1, entries: [entry] }],
          agents: [],
          warnings: [],
          elapsedMs: 1,
        };
      },
    };
    const fallback = catalogCapabilityFallback(catalog);
    const response = await fallback({
      projectPath: project,
      harness: 'opencode',
      query: 'demo',
      offset: 0,
      limit: 1,
    });
    expect(response).toMatchObject({
      mode: 'scan',
      total: 1,
      nextOffset: null,
      candidates: [expect.objectContaining({ name: 'demo', snippet: 'A demo skill.' })],
    });
  });

  it('builds for the repository local roots and packaged scenario skills', async () => {
    const root = await makeRoot();
    const sources = defaultCapabilitySourceRoots({
      projectPath: join(root, 'project'),
      harness: 'opencode',
      homeDirectory: join(root, 'home'),
      includeBundled: true,
    });
    const bundled = sources.find((source) => source.source === 'builtin');
    expect(bundled).toBeDefined();
    const collection = await collect(sources);
    expect(collection.packages.some((packageInfo) => packageInfo.source === 'builtin')).toBe(true);

    const index = new CapabilityIndex(indexOptions(join(root, 'config')));
    await index.rebuild(collection);
    const result = await index.search({
      harness: 'opencode',
      projectPath: join(root, 'project'),
      query: 'scientific method',
      limit: 10,
    });
    expect(result.mode).toBe('index');
    expect(result.candidates.length).toBeGreaterThan(0);
    await index.dispose({ deleteIndex: true });
  });

  it('reports a typed error when the index is closed or missing', async () => {
    const root = await makeRoot();
    const index = new CapabilityIndex(indexOptions(join(root, 'config')));
    await expect(index.search({ harness: 'opencode', projectPath: root, query: 'x' }))
      .rejects.toBeInstanceOf(CapabilityIndexError);
    await index.dispose();
    await expect(index.validate()).rejects.toMatchObject({ code: 'error' });
  });
});
