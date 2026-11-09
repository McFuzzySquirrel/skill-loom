import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { importReviewedBundle, reviewBundleImport } from '../../src/server/bundles/reviewed-import.js';
import { createCatalogService } from '../../src/server/catalog/merge.js';
import { scanOpenCodeSkills } from '../../src/server/catalog/opencode.js';
import { snapshotReviewFingerprint } from '../../src/server/catalog/snapshot-fingerprint.js';
import { treeFingerprint, packageFingerprint } from '../../src/portable/runtime.js';
import { readInstalledModeIndex } from '../../src/portable/installed-modes.js';
import { MAX_BUNDLE_BYTES, MAX_BUNDLE_REQUEST_BYTES, parseBundle } from '../../src/server/chains/bundle.js';
import { createChainService, type ChainService } from '../../src/server/chains/service.js';
import { createConfigStore } from '../../src/server/config/store.js';
import { callControl, startControlServer } from '../../src/server/control.js';
import { REMOTE_SNAPSHOT_CONTENT, type SkillEntry, type SkillDiscoveryResult } from '../../src/server/catalog/types.js';
import type { Chain } from '../../src/server/chains/model.js';
import type { BundlePreview, ChainBundle } from '../../src/shared/bundles.js';

let root: string;
let app: FastifyInstance;
let source: string;
let target: string;
let sourceId: string;
let targetId: string;
let chain: Chain;
let chains: ChainService;
let discoveryOverride: SkillDiscoveryResult | undefined;

const skillText = '---\nname: review\ndescription: Review changes\n---\nInspect the changes.\n';
const binary = Buffer.from([0, 1, 128, 255]);

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'loom-bundles-')));
  source = join(root, 'source');
  target = join(root, 'target');
  const packagePath = join(source, '.opencode', 'skills', 'review');
  await mkdir(join(packagePath, 'scripts'), { recursive: true });
  await mkdir(target);
  await writeFile(join(packagePath, 'SKILL.md'), skillText);
  await writeFile(join(packagePath, 'scripts', 'check.sh'), '#!/bin/sh\nexit 0\n');
  await chmod(join(packagePath, 'scripts', 'check.sh'), 0o755);
  await writeFile(join(packagePath, 'asset.bin'), binary);
  if (process.platform === 'win32') {
    execFileSync('git', ['-C', source, 'init', '--quiet']);
    execFileSync('git', ['-C', source, 'add', '--', '.opencode/skills/review']);
    execFileSync('git', ['-C', source, 'update-index', '--chmod=-x', '--', '.opencode/skills/review/scripts/check.sh']);
  }
  const configStore = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') }, homeDirectory: () => join(root, 'home') });
  discoveryOverride = undefined;
  chains = createChainService();
  app = await buildApp({
    env: {},
    serveStatic: false,
    configStore,
    chainService: chains,
    catalogService: createCatalogService({
      configStore,
      adapters: [
        {
          harness: 'opencode',
          usesExtraDirectories: false,
          discover: async ({ projectPath }) => discoveryOverride ??
            await scanOpenCodeSkills({ projectPath, homeDirectory: join(root, 'home') }),
        },
        { harness: 'copilot', usesExtraDirectories: false, discover: async () => ({ entries: [], warnings: [] }) },
      ],
    }),
  });
  for (const [path, assign] of [
    [source, (id: string) => { sourceId = id; }],
    [target, (id: string) => { targetId = id; }],
  ] as const) {
    const response = await app.inject({ method: 'POST', url: '/api/projects', payload: { mode: 'open', path } });
    expect(response.statusCode).toBe(200);
    assign(response.json<{ project: { id: string } }>().project.id);
  }
  chain = await chains.create(source, {
    name: 'Portable review',
    harness: 'opencode',
    sessionMode: 'shared',
    steps: [{ id: 'step-1', skillName: 'review', instruction: 'Review {{task}}.' }],
    inputs: [{ name: 'task', required: true, defaultValue: 'private default' }],
    automaticPermissionOptIn: true,
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app?.close();
  await rm(root, { recursive: true, force: true });
});

async function exported(): Promise<ChainBundle> {
  const response = await app.inject({ method: 'GET', url: `/api/projects/${sourceId}/chains/${chain.id}/bundle` });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ bundle: ChainBundle }>().bundle;
}

async function request(action: 'preview' | 'import', bundle: unknown, extra: Record<string, unknown> = {}) {
  if (action === 'import' && extra.confirmed === true && !('reviewDigest' in extra)) {
    const preview = await request('preview', bundle);
    if (preview.statusCode === 200) {
      extra = { ...extra, reviewDigest: preview.json<{ reviewDigest: string }>().reviewDigest };
    }
  }
  return app.inject({
    method: 'POST',
    url: `/api/projects/${targetId}/chain-bundles/${action}`,
    payload: { bundle, ...extra },
  });
}

function catalogEntry(overrides: Partial<SkillEntry> = {}): SkillEntry {
  const packagePath = join(source, '.opencode', 'skills', 'review');
  return {
    id: 'opencode-project-review',
    harness: 'opencode',
    source: 'project',
    name: 'review',
    description: 'Review changes',
    path: join(packagePath, 'SKILL.md'),
    packagePath,
    enabled: true,
    ...overrides,
  };
}

describe('portable chain bundles', () => {
  it.skipIf(process.platform !== 'win32')('exports tracked Windows files using Git executable intent and rejects untracked files', async () => {
    execFileSync('git', ['-C', source, 'update-index', '--chmod=+x', '--', '.opencode/skills/review/scripts/check.sh']);
    const result = await exported();
    expect(result.skills[0]!.files.find((file) => file.path === 'scripts/check.sh')?.executable).toBe(true);
    await writeFile(join(source, '.opencode', 'skills', 'review', 'new.sh'), 'untracked\n');
    const response = await app.inject({ method: 'GET', url: `/api/projects/${sourceId}/chains/${chain.id}/bundle` });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: 'BUNDLE_SOURCE_UNAVAILABLE', message: expect.stringContaining('untracked') },
    });
  });

  it('binds headless approval to the bundle, destination, and conflict state without reusing skills', async () => {
    const bundle = await exported();
    const bundlePath = join(root, 'review.loom.json');
    await writeFile(bundlePath, JSON.stringify(bundle));
    const review = await reviewBundleImport(app.loomServices, targetId, bundlePath);
    expect(review.evidence.skills[0]).toMatchObject({
      name: 'review', conflict: false, directoryExists: false,
      inventory: expect.arrayContaining([expect.objectContaining({ path: 'SKILL.md', fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) })]),
    });
    const request = { projectId: targetId, bundlePath, reviewDigest: review.reviewDigest, confirmed: true as const };
    await expect(importReviewedBundle(app.loomServices, { ...request, projectId: sourceId }))
      .rejects.toMatchObject({ code: process.platform === 'win32' ? 'BUNDLE_SOURCE_UNAVAILABLE' : 'BUNDLE_CONFLICT' });
    await mkdir(join(target, '.agents', 'skills', 'review'), { recursive: true });
    await expect(importReviewedBundle(app.loomServices, request)).rejects.toMatchObject({ code: 'BUNDLE_CONFLICT' });
    const conflicted = await reviewBundleImport(app.loomServices, targetId, bundlePath);
    await expect(importReviewedBundle(app.loomServices, { ...request, reviewDigest: conflicted.reviewDigest }))
      .rejects.toMatchObject({ code: 'BUNDLE_CONFLICT' });
    await rm(join(target, '.agents', 'skills', 'review'), { recursive: true });
    const imported = await importReviewedBundle(app.loomServices, request);
    expect(imported.name).toBe('Portable review copy');
    expect(await readFile(join(target, '.agents', 'skills', 'review', 'SKILL.md'), 'utf8')).toBe(skillText);
  });

  it('reviews matching and differing installed packages for headless reuse', async () => {
    const bundlePath = join(root, 'reuse.loom.json');
    await writeFile(bundlePath, JSON.stringify(await exported()));
    const first = await reviewBundleImport(app.loomServices, targetId, bundlePath);
    await importReviewedBundle(app.loomServices, {
      projectId: targetId, bundlePath, reviewDigest: first.reviewDigest, confirmed: true,
    });
    const matching = await reviewBundleImport(app.loomServices, targetId, bundlePath);
    expect(matching.evidence.reuseEvidence[0]).toMatchObject({
      name: 'review', differs: false, path: join(target, '.agents', 'skills', 'review'),
      inventory: expect.arrayContaining([
        expect.objectContaining({ path: 'SKILL.md', kind: 'file', bytes: Buffer.byteLength(skillText) }),
        expect.objectContaining({ path: 'scripts', kind: 'directory' }),
      ]),
    });
    await importReviewedBundle(app.loomServices, {
      projectId: targetId, bundlePath, reviewDigest: matching.reviewDigest, confirmed: true, reuseSkills: ['review'],
    });
    const installed = join(target, '.agents', 'skills', 'review', 'SKILL.md');
    await writeFile(installed, `${skillText}Local changes\n`);
    const changed = await reviewBundleImport(app.loomServices, targetId, bundlePath);
    expect(changed.evidence.reuseEvidence[0]?.differs).toBe(true);
    const request = {
      projectId: targetId, bundlePath, reviewDigest: changed.reviewDigest, confirmed: true as const, reuseSkills: ['review'],
    };
    await expect(importReviewedBundle(app.loomServices, request)).rejects.toMatchObject({ code: 'BUNDLE_CONFLICT' });
    await writeFile(installed, `${skillText}Changed again\n`);
    await expect(importReviewedBundle(app.loomServices, { ...request, differingReuseConfirmed: true }))
      .rejects.toMatchObject({ code: 'BUNDLE_CONFLICT' });
    const latest = await reviewBundleImport(app.loomServices, targetId, bundlePath);
    await importReviewedBundle(app.loomServices, {
      ...request, reviewDigest: latest.reviewDigest, differingReuseConfirmed: true,
    });
    expect(await readFile(installed, 'utf8')).toBe(`${skillText}Changed again\n`);
  });

  it.skipIf(process.platform === 'win32')('accepts reviewed differing reuse through the local CLI control protocol', async () => {
    const bundle = await exported();
    const bundlePath = join(root, 'control-reuse.loom.json');
    await writeFile(bundlePath, JSON.stringify(bundle));
    expect((await request('import', bundle, { confirmed: true })).statusCode).toBe(201);
    await writeFile(join(target, '.agents', 'skills', 'review', 'SKILL.md'), `${skillText}Local version\n`);
    const control = await startControlServer(app.loomServices.configStore, { services: app.loomServices });
    try {
      const input = { projectId: targetId, bundlePath };
      const review = await callControl(app.loomServices.configStore.getConfigDir(), 'bundle.review', input);
      expect(review).toMatchObject({ ok: true, result: { evidence: {
        reuseEvidence: [expect.objectContaining({ name: 'review', differs: true })],
      } } });
      if (!review.ok) throw new Error('Review failed.');
      const request = {
        ...input, reviewDigest: (review.result as { reviewDigest: string }).reviewDigest,
        confirmed: true, reuseSkills: ['review'],
      };
      expect(await callControl(app.loomServices.configStore.getConfigDir(), 'bundle.import', request))
        .toMatchObject({ ok: false, error: { code: 'BUNDLE_CONFLICT' } });
      expect(await callControl(app.loomServices.configStore.getConfigDir(), 'bundle.import', {
        ...request, differingReuseConfirmed: true,
      })).toMatchObject({ ok: true });
    } finally {
      await control.close();
    }
  });

  it('refuses ambiguous or unsafe installed packages during reuse review', async () => {
    const bundle = await exported();
    expect((await request('import', bundle, { confirmed: true })).statusCode).toBe(201);
    const second = join(target, '.opencode', 'skills', 'review');
    await mkdir(second, { recursive: true });
    await writeFile(join(second, 'SKILL.md'), skillText);
    expect((await request('preview', bundle)).json()).toMatchObject({ error: { code: 'BUNDLE_CONFLICT' } });
    await rm(second, { recursive: true });
    const installed = join(target, '.agents', 'skills', 'review');
    await symlink(join(root, 'outside'), join(installed, 'unsafe'));
    expect((await request('preview', bundle)).json()).toMatchObject({ error: { code: 'BUNDLE_SOURCE_UNAVAILABLE' } });
  });

  it('rechecks approved reused package contents immediately before saving the chain', async () => {
    const bundlePath = join(root, 'race.loom.json');
    await writeFile(bundlePath, JSON.stringify(await exported()));
    const initial = await reviewBundleImport(app.loomServices, targetId, bundlePath);
    await importReviewedBundle(app.loomServices, {
      projectId: targetId, bundlePath, reviewDigest: initial.reviewDigest, confirmed: true,
    });
    const review = await reviewBundleImport(app.loomServices, targetId, bundlePath);
    const installed = join(target, '.agents', 'skills', 'review', 'SKILL.md');
    const catalog = app.loomServices.catalogService;
    const getCatalog = catalog.getCatalog.bind(catalog);
    let calls = 0;
    vi.spyOn(catalog, 'getCatalog').mockImplementation(async (input) => {
      calls += 1;
      if (calls === 3) await writeFile(installed, `${skillText}Changed during import\n`);
      return getCatalog(input);
    });
    await expect(importReviewedBundle(app.loomServices, {
      projectId: targetId, bundlePath, reviewDigest: review.reviewDigest, confirmed: true, reuseSkills: ['review'],
    })).rejects.toMatchObject({ code: 'BUNDLE_CONFLICT' });
    expect(calls).toBe(3);
    expect((await chains.list(target)).chains).toHaveLength(1);
  });

  it('rolls back newly installed packages if reused contents change during import', async () => {
    const newSource = join(source, '.opencode', 'skills', 'new-skill');
    await mkdir(newSource, { recursive: true });
    await writeFile(join(newSource, 'SKILL.md'), '---\nname: new-skill\ndescription: New fixture\n---\nInspect the result.\n');
    if (process.platform === 'win32') {
      execFileSync('git', ['-C', source, 'add', '--', '.opencode/skills/new-skill']);
    }
    const multi = await chains.create(source, {
      name: 'Two packages', harness: 'opencode', sessionMode: 'shared',
      steps: [
        { id: 'one', skillName: 'review', instruction: 'Review.' },
        { id: 'two', skillName: 'new-skill', instruction: 'Inspect.' },
      ],
      inputs: [], automaticPermissionOptIn: false,
    });
    const exportedResponse = await app.inject({ method: 'GET', url: `/api/projects/${sourceId}/chains/${multi.id}/bundle` });
    expect(exportedResponse.statusCode, exportedResponse.body).toBe(200);
    const bundle = exportedResponse.json<{ bundle: ChainBundle }>().bundle;
    expect((await request('import', await exported(), { confirmed: true })).statusCode).toBe(201);
    const newTarget = join(target, '.agents', 'skills', 'new-skill');
    const bundlePath = join(root, 'rollback-race.loom.json');
    await writeFile(bundlePath, JSON.stringify(bundle));
    const review = await reviewBundleImport(app.loomServices, targetId, bundlePath);
    const installed = join(target, '.agents', 'skills', 'review', 'SKILL.md');
    const catalog = app.loomServices.catalogService;
    const getCatalog = catalog.getCatalog.bind(catalog);
    let calls = 0;
    vi.spyOn(catalog, 'getCatalog').mockImplementation(async (input) => {
      calls += 1;
      if (calls === 3) await writeFile(installed, `${skillText}Changed during import\n`);
      return getCatalog(input);
    });
    await expect(importReviewedBundle(app.loomServices, {
      projectId: targetId, bundlePath, reviewDigest: review.reviewDigest, confirmed: true, reuseSkills: ['review'],
    })).rejects.toMatchObject({ code: 'BUNDLE_CONFLICT' });
    expect(await readFile(installed, 'utf8')).toBe(`${skillText}Changed during import\n`);
    await expect(lstat(newTarget)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await chains.list(target)).chains).toHaveLength(1);
  });

  it('refuses headless review when project discovery is incomplete', async () => {
    const bundle = await exported();
    const bundlePath = join(root, 'review.loom.json');
    await writeFile(bundlePath, JSON.stringify(bundle));
    discoveryOverride = {
      entries: [],
      warnings: [{
        code: 'SKILL_DIRECTORY_UNREADABLE', message: 'Cannot read project skills.',
        harness: 'opencode', source: 'project',
      }],
    };
    await expect(reviewBundleImport(app.loomServices, targetId, bundlePath))
      .rejects.toMatchObject({ code: 'BUNDLE_SOURCE_UNAVAILABLE' });
  });

  it('rejects a replaced destination and symbolic-link bundle paths', async () => {
    const bundlePath = join(root, 'review.loom.json');
    await writeFile(bundlePath, JSON.stringify(await exported()));
    const review = await reviewBundleImport(app.loomServices, targetId, bundlePath);
    await symlink(bundlePath, join(root, 'linked.loom.json'));
    await expect(reviewBundleImport(app.loomServices, targetId, join(root, 'linked.loom.json')))
      .rejects.toMatchObject({ code: 'BUNDLE_INVALID' });
    await rename(target, join(root, 'original-target'));
    await mkdir(target);
    await expect(importReviewedBundle(app.loomServices, {
      projectId: targetId, bundlePath, reviewDigest: review.reviewDigest, confirmed: true,
    })).rejects.toMatchObject({ code: 'BUNDLE_CONFLICT' });
    expect(await readdir(target)).toEqual([]);
  });

  it('rejects a directory supplied as a bundle before attempting to read it', async () => {
    await expect(reviewBundleImport(app.loomServices, targetId, root))
      .rejects.toMatchObject({ code: 'BUNDLE_INVALID' });
  });

  it('round-trips the selected native agent in a version 2 bundle', async () => {
    const agentText = '---\nname: team/reviewer\ndescription: Review changes\n---\nReview the task.\n';
    const agentPath = 'team/reviewer.md';
    const agentFile = join(source, '.opencode', 'agents', agentPath);
    await mkdir(join(source, '.opencode', 'agents', 'team'), { recursive: true });
    await writeFile(agentFile, agentText);
    const agentFingerprint = createHash('sha256').update(agentText).digest('hex');
    const withAgent = await chains.create(source, {
      name: 'Portable agent review',
      harness: 'opencode',
      sessionMode: 'shared',
      steps: [{ id: 'step-1', skillName: 'review', instruction: 'Review {{task}}.' }],
      inputs: [{ name: 'task', required: true }],
      agent: {
        harness: 'opencode',
        name: 'team/reviewer',
        sourceId: 'remote-source',
        revision: 'a'.repeat(40),
        repositoryPath: '.opencode/agents/team/reviewer.md',
        agentPath,
        fingerprint: agentFingerprint,
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${sourceId}/chains/${withAgent.id}/bundle`,
    });

    expect(response.statusCode, response.body).toBe(200);
    const bundle = response.json<{ bundle: ChainBundle }>().bundle;
    expect(bundle.version).toBe(2);
    expect(JSON.stringify(bundle)).not.toContain(root);
    if (bundle.version !== 2) throw new Error('Expected bundle format version 2.');
    expect(bundle.chain.agent?.fingerprint).toBe(agentFingerprint);
    expect(bundle.agents).toHaveLength(1);

    const tampered = structuredClone(bundle);
    if (tampered.version !== 2) throw new Error('Expected bundle format version 2.');
    tampered.agents[0]!.content = Buffer.from('tampered').toString('base64');
    expect((await request('preview', tampered)).statusCode).toBe(422);
    expect(await readdir(target)).toEqual(['.loom']);

    const preview = await request('preview', bundle);
    expect(preview.statusCode).toBe(200);
    expect(preview.json<BundlePreview>().agents).toEqual([{
      name: 'team/reviewer',
      harness: 'opencode',
      agentPath,
      conflict: false,
      bytes: Buffer.byteLength(agentText),
    }]);

    const importedResponse = await request('import', bundle, { confirmed: true });
    expect(importedResponse.statusCode, importedResponse.body).toBe(201);
    const imported = importedResponse.json<{ chain: Chain }>().chain;
    expect(imported.agent).toEqual(withAgent.agent);
    expect(await readFile(join(target, '.opencode', 'agents', agentPath), 'utf8')).toBe(agentText);
  });

  it('round-trips full packages and supported script modes with fresh identity and consent', async () => {
    const bundle = await exported();
    expect(bundle.chain.inputs).toEqual([{ name: 'task', required: true }]);
    expect(JSON.stringify(bundle)).not.toContain(root);
    expect(bundle.chain).not.toHaveProperty('automaticPermissionOptIn');
    expect(bundle.chain).not.toHaveProperty('id');
    expect(bundle.chain).not.toHaveProperty('createdAt');
    const preview = await request('preview', bundle);
    expect(preview.statusCode).toBe(200);
    expect(preview.json<BundlePreview>().skills[0]).toMatchObject({ name: 'review', conflict: false, directoryExists: false, files: 3 });
    expect(await readdir(target)).toEqual(['.loom']);
    const response = await request('import', bundle, { confirmed: true });
    expect(response.statusCode, response.body).toBe(201);
    const imported = response.json<{ chain: Chain }>().chain;
    expect(imported.id).not.toBe(chain.id);
    expect(imported.automaticPermissionOptIn).toBe(false);
    expect(imported.steps).toEqual(chain.steps);
    const destination = join(target, '.agents', 'skills', 'review');
    expect(await readFile(join(destination, 'SKILL.md'), 'utf8')).toBe(skillText);
    expect(await readFile(join(destination, 'asset.bin'))).toEqual(binary);
    const executableBits = (await lstat(join(destination, 'scripts', 'check.sh'))).mode & 0o111;
    if (process.platform === 'win32') {
      expect(executableBits).toBe(0);
      expect(bundle.skills[0]?.files.find((file) => file.path === 'scripts/check.sh')?.executable).toBe(false);
    } else {
      expect(executableBits).not.toBe(0);
    }
    expect((await chains.get(target, imported.id)).steps).toEqual(chain.steps);
    expect(await scanOpenCodeSkills({ projectPath: target, homeDirectory: join(root, 'home') }).then(
      (result) => result.entries.some((entry) => entry.name === 'review' && entry.packagePath === destination),
    )).toBe(true);
  });

  it('installs, reviews, reuses and re-exports executable bundles without losing intent', async () => {
    const bundle = await exported();
    const script = bundle.skills[0]?.files.find((file) => file.path === 'scripts/check.sh');
    expect(script).toBeDefined();
    if (script === undefined) throw new Error('Expected the bundled script.');
    script.executable = true;
    const response = await request('import', bundle, { confirmed: true });
    expect(response.statusCode, response.body).toBe(201);
    const destination = join(target, '.agents', 'skills', 'review');
    expect(await treeFingerprint(destination)).toBe(packageFingerprint(bundle.skills[0]!.files));
    if (process.platform === 'win32') expect(await readInstalledModeIndex(destination)).not.toBeNull();
    expect((await request('import', bundle, { confirmed: true, reuseSkills: ['review'] })).statusCode).toBe(201);
    const imported = response.json<{ chain: Chain }>().chain;
    const roundTrip = await app.inject({ method: 'GET', url: `/api/projects/${targetId}/chains/${imported.id}/bundle` });
    expect(roundTrip.statusCode, roundTrip.body).toBe(200);
    const reexported = roundTrip.json<{ bundle: ChainBundle }>().bundle;
    expect(reexported.skills).toEqual(bundle.skills);
    if (process.platform === 'win32') {
      execFileSync('git', ['-C', target, 'init', '--quiet']);
      execFileSync('git', ['-C', target, 'config', 'core.filemode', 'false']);
      execFileSync('git', ['-C', target, 'add', '--', '.agents', '.loom/package-modes']);
      const stagedBefore = execFileSync('git', [
        '-C', target, 'ls-files', '--stage', '--', '.agents/skills/review/scripts/check.sh',
      ], { encoding: 'utf8' });
      expect(stagedBefore).toMatch(/^100644 /);
      const despiteIndex = await app.inject({ method: 'GET', url: `/api/projects/${targetId}/chains/${imported.id}/bundle` });
      expect(despiteIndex.json<{ bundle: ChainBundle }>().bundle.skills).toEqual(bundle.skills);
      execFileSync('git', ['-C', target, 'update-index', '--chmod=+x', '--', '.agents/skills/review/scripts/check.sh']);
      expect(execFileSync('git', [
        '-C', target, 'ls-files', '--stage', '--', '.agents/skills/review/scripts/check.sh',
      ], { encoding: 'utf8' })).toMatch(/^100755 /);
    }
    await writeFile(join(destination, 'scripts', 'check.sh'), '#!/bin/sh\nexit 1\n');
    const edited = await app.inject({ method: 'GET', url: `/api/projects/${targetId}/chains/${imported.id}/bundle` });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json<{ bundle: ChainBundle }>().bundle.skills[0]?.files.find(
      (file) => file.path === 'scripts/check.sh',
    )).toMatchObject({ executable: true, content: Buffer.from('#!/bin/sh\nexit 1\n').toString('base64') });
  });

  it.runIf(process.platform === 'win32')('blocks installed export when both mode records are deleted, even with staged files', async () => {
    const bundle = await exported();
    const response = await request('import', bundle, { confirmed: true });
    expect(response.statusCode).toBe(201);
    const installed = response.json<{ chain: Chain }>().chain;
    execFileSync('git', ['-C', target, 'init', '--quiet']);
    execFileSync('git', ['-C', target, 'add', '--', '.agents']);
    await rm(join(target, '.agents', 'skills', 'review', '.loom'), { recursive: true });
    await rm(join(target, '.loom', 'package-modes'), { recursive: true });
    const result = await app.inject({ method: 'GET', url: `/api/projects/${targetId}/chains/${installed.id}/bundle` });
    expect(result.statusCode).toBe(422);
    expect(result.json()).toMatchObject({ error: { code: 'BUNDLE_SOURCE_UNAVAILABLE' } });
  });

  it('reuses the reviewed package path even when the bundle names another directory', async () => {
    const bundle = await exported();
    const renamed = structuredClone(bundle);
    renamed.skills[0]!.directory = 'local-review';
    expect((await request('import', renamed, { confirmed: true })).statusCode).toBe(201);
    const reused = await request('import', bundle, { confirmed: true, reuseSkills: ['review'] });
    expect(reused.statusCode, reused.body).toBe(201);
    expect(await readFile(join(target, '.agents', 'skills', 'local-review', 'SKILL.md'), 'utf8')).toBe(skillText);
    await expect(lstat(join(target, '.agents', 'skills', 'review'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('exports a nested installed skill using its parent mode record, not staged Windows mode bits', async () => {
    const bundle = await exported();
    const nestedFiles = [
      { path: 'nested/SKILL.md', executable: false, content: Buffer.from('---\nname: nested\n---\nNested instructions.\n').toString('base64') },
      { path: 'nested/run.sh', executable: true, content: Buffer.from('#!/bin/sh\nexit 0\n').toString('base64') },
    ];
    bundle.skills[0]!.files.push(...nestedFiles);
    const response = await request('import', bundle, { confirmed: true });
    expect(response.statusCode, response.body).toBe(201);
    const packagePath = join(target, '.agents', 'skills', 'review', 'nested');
    discoveryOverride = {
      entries: [catalogEntry({ name: 'nested', packagePath, path: join(packagePath, 'SKILL.md') })],
      warnings: [],
    };
    const nestedChain = await chains.create(target, {
      name: 'Nested review', harness: 'opencode', sessionMode: 'shared',
      steps: [{ id: 'one', skillName: 'nested', instruction: 'Review.' }], inputs: [],
    });
    if (process.platform === 'win32') {
      execFileSync('git', ['-C', target, 'init', '--quiet']);
      execFileSync('git', ['-C', target, 'add', '--', '.agents']);
    }
    const result = await app.inject({ method: 'GET', url: `/api/projects/${targetId}/chains/${nestedChain.id}/bundle` });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json<{ bundle: ChainBundle }>().bundle.skills[0]?.files).toEqual(
      nestedFiles.map((file) => ({ ...file, path: file.path.slice('nested/'.length) })).sort((a, b) => a.path.localeCompare(b.path)),
    );
  });

  it('requires explicit confirmation and never writes during preview', async () => {
    const response = await request('import', await exported());
    expect(response.statusCode).toBe(422);
    expect(await readdir(target)).toEqual(['.loom']);
  });

  it('requires the exact reviewed bundle and destination for HTTP import', async () => {
    const bundle = await exported();
    const url = `/api/projects/${targetId}/chain-bundles/import`;
    const missing = await app.inject({ method: 'POST', url, payload: { bundle, confirmed: true } });
    expect(missing.statusCode).toBe(409);
    const preview = await request('preview', bundle);
    const changed = structuredClone(bundle);
    changed.chain.name = 'Changed after review';
    const stale = await app.inject({
      method: 'POST', url,
      payload: { bundle: changed, confirmed: true, reviewDigest: preview.json<{ reviewDigest: string }>().reviewDigest },
    });
    expect(stale.statusCode).toBe(409);
    expect(await readdir(target)).toEqual(['.loom']);
  });

  it('installs Copilot bundles in the shared project skill location', async () => {
    const bundle = await exported();
    bundle.chain.harness = 'copilot';
    const response = await request('import', bundle, { confirmed: true });
    expect(response.statusCode, response.body).toBe(201);
    expect(await readFile(join(target, '.agents', 'skills', 'review', 'SKILL.md'), 'utf8')).toBe(skillText);
    expect(response.json<{ chain: Chain }>().chain.harness).toBe('copilot');
  });

  it('binds explicit reuse to installed contents and never overwrites', async () => {
    const bundle = await exported();
    expect((await request('import', bundle, { confirmed: true })).statusCode).toBe(201);
    const path = join(target, '.agents', 'skills', 'review', 'SKILL.md');
    await writeFile(path, skillText + 'Local changes\n');
    const preview = await request('preview', bundle);
    expect(preview.json<BundlePreview>().skills[0]).toMatchObject({ conflict: true, directoryExists: true });
    expect((await request('import', bundle, { confirmed: true })).statusCode).toBe(409);
    const reviewDigest = preview.json<{ reviewDigest: string }>().reviewDigest;
    const selection = { confirmed: true, reuseSkills: ['review'], reviewDigest };
    expect((await request('import', bundle, selection)).statusCode).toBe(409);
    await writeFile(path, skillText + 'Changed again\n');
    expect((await request('import', bundle, { ...selection, differingReuseConfirmed: true })).statusCode).toBe(409);
    const response = await request('import', bundle, {
      confirmed: true, reuseSkills: ['review'], differingReuseConfirmed: true,
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(await readFile(path, 'utf8')).toBe(skillText + 'Changed again\n');
    expect((await chains.list(target)).chains).toHaveLength(2);
  });

  it('rejects stale/invalid reuse choices and physical directory conflicts', async () => {
    const bundle = await exported();
    expect((await request('import', bundle, { confirmed: true, reuseSkills: ['review'] })).statusCode).toBe(422);
    await mkdir(join(target, '.agents', 'skills', 'review'), { recursive: true });
    expect((await request('import', bundle, { confirmed: true })).statusCode).toBe(409);
  });

  it('rolls back only newly installed packages if saving the chain fails', async () => {
    vi.spyOn(chains, 'importChain').mockRejectedValueOnce(new Error('simulated store failure'));
    const response = await request('import', await exported(), { confirmed: true });
    expect(response.statusCode).toBe(500);
    expect(await readdir(join(target, '.agents', 'skills'))).toEqual([]);
  });

  it('refuses symlinked destination ancestors', async () => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, join(target, '.agents'));
    const response = await request('import', await exported(), { confirmed: true });
    expect(response.statusCode).toBe(422);
    expect(await readdir(outside)).toEqual([]);
  });

  it('refuses source symlinks, excluded credential paths and unavailable skills', async () => {
    const packagePath = join(source, '.opencode', 'skills', 'review');
    await symlink(join(packagePath, 'SKILL.md'), join(packagePath, 'linked.md'));
    let response = await app.inject({ method: 'GET', url: `/api/projects/${sourceId}/chains/${chain.id}/bundle` });
    expect(response.statusCode).toBe(422);
    await rm(join(packagePath, 'linked.md'));
    await writeFile(join(packagePath, '.env'), 'TOKEN=private');
    response = await app.inject({ method: 'GET', url: `/api/projects/${sourceId}/chains/${chain.id}/bundle` });
    expect(response.statusCode).toBe(422);
    expect(response.body).not.toContain('TOKEN');
    await rm(join(packagePath, '.env'));
    await rm(join(packagePath, 'SKILL.md'));
    response = await app.inject({ method: 'GET', url: `/api/projects/${sourceId}/chains/${chain.id}/bundle` });
    expect(response.statusCode).toBe(422);
    expect(response.json<{ error: { code: string; message: string } }>().error.message).toContain('not present');
  });

  it('imports the unique project package despite a same-name personal package', async () => {
    const personal = join(root, 'home', '.config', 'opencode', 'skills', 'review');
    await mkdir(personal, { recursive: true });
    await writeFile(join(personal, 'SKILL.md'), '---\nname: review\n---\nPersonal copy.\n');

    const response = await app.inject({ method: 'GET', url: `/api/projects/${sourceId}/chains/${chain.id}/bundle` });
    expect(response.statusCode, response.body).toBe(200);
    const bundle = response.json<{ bundle: ChainBundle }>().bundle;
    expect(Buffer.from(bundle.skills[0]!.files.find((file) => file.path === 'SKILL.md')!.content, 'base64').toString()).toBe(skillText);

    const preview = await request('preview', bundle);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json<BundlePreview>().skills[0]).toMatchObject({
      name: 'review',
      conflict: false,
      directoryExists: false,
    });

    const imported = await request('import', bundle, { confirmed: true });
    expect(imported.statusCode, imported.body).toBe(201);
    expect(await readFile(join(target, '.agents', 'skills', 'review', 'SKILL.md'), 'utf8'))
      .toBe(skillText);
  });

  it('rejects multiple distinct project packages with an actionable ambiguity error', async () => {
    const shared = join(source, '.agents', 'skills', 'review');
    await mkdir(shared, { recursive: true });
    await writeFile(join(shared, 'SKILL.md'), skillText);

    const response = await app.inject({ method: 'GET', url: `/api/projects/${sourceId}/chains/${chain.id}/bundle` });
    expect(response.statusCode).toBe(422);
    expect(response.json<{ error: { code: string; message: string } }>().error).toMatchObject({
      code: 'BUNDLE_SOURCE_UNAVAILABLE',
      message: expect.stringContaining('multiple project packages'),
    });
  });

  it('exports the exact remote snapshot bound to a skill step', async () => {
    const firstPackage = join(root, 'remote-first', 'review');
    const selectedPackage = join(root, 'remote-selected', 'review');
    const firstRevision = 'a'.repeat(40);
    const selectedRevision = 'b'.repeat(40);
    const firstText = '---\nname: review\n---\nFirst revision.\n';
    const selectedText = '---\nname: review\n---\nSelected revision.\n';
    await mkdir(firstPackage, { recursive: true });
    await mkdir(selectedPackage, { recursive: true });
    await writeFile(join(firstPackage, 'SKILL.md'), firstText);
    await writeFile(join(selectedPackage, 'SKILL.md'), selectedText);
    discoveryOverride = {
      entries: [
        catalogEntry({
          id: 'remote-first',
          source: 'remote',
          path: join(firstPackage, 'SKILL.md'),
          packagePath: firstPackage,
          sourceId: 'repo-one',
          revision: firstRevision,
          repositoryPath: 'skills/review',
          [REMOTE_SNAPSHOT_CONTENT]: {
            fingerprint: createHash('sha256').update('SKILL.md\0-\0').update(firstText).digest('hex'),
            reviewFingerprint: snapshotReviewFingerprint([{ path: 'SKILL.md', executable: false, content: Buffer.from(firstText) }]),
            executablePaths: [],
          },
        }),
        catalogEntry({
          id: 'remote-selected',
          source: 'remote',
          path: join(selectedPackage, 'SKILL.md'),
          packagePath: selectedPackage,
          sourceId: 'repo-one',
          revision: selectedRevision,
          repositoryPath: 'skills/review',
          [REMOTE_SNAPSHOT_CONTENT]: {
            fingerprint: createHash('sha256').update('SKILL.md\0-\0').update(selectedText).digest('hex'),
            reviewFingerprint: snapshotReviewFingerprint([{ path: 'SKILL.md', executable: false, content: Buffer.from(selectedText) }]),
            executablePaths: [],
          },
        }),
      ],
      warnings: [],
    };
    chain = await chains.update(source, chain.id, {
      ...chain,
      inputs: [],
      steps: [
        {
          id: 'step-1',
          kind: 'skill',
          skillName: 'review',
          skillBinding: {
            sourceId: 'repo-one',
            revision: selectedRevision,
            repositoryPath: 'skills/review',
          },
          instruction: 'Review the project.',
        },
      ],
    });

    const bundle = await exported();
    expect(bundle.skills).toHaveLength(1);
    expect(
      Buffer.from(
        bundle.skills[0]!.files.find((file) => file.path === 'SKILL.md')!.content,
        'base64',
      ).toString(),
    ).toBe(selectedText);
  });

  it('deduplicates repeated observations of one canonical project package', async () => {
    const entry = catalogEntry();
    discoveryOverride = {
      entries: [entry, { ...entry, id: 'duplicate-observation' }],
      warnings: [],
    };

    const response = await app.inject({ method: 'GET', url: `/api/projects/${sourceId}/chains/${chain.id}/bundle` });
    expect(response.statusCode, response.body).toBe(200);
  });

  it('distinguishes disabled, unavailable, and ambiguous non-project packages', async () => {
    discoveryOverride = { entries: [catalogEntry({ enabled: false })], warnings: [] };
    let response = await app.inject({ method: 'GET', url: `/api/projects/${sourceId}/chains/${chain.id}/bundle` });
    expect(response.statusCode).toBe(422);
    expect(response.json<{ error: { message: string } }>().error.message).toContain('disabled');

    discoveryOverride = { entries: [catalogEntry({ packagePath: '' })], warnings: [] };
    response = await app.inject({ method: 'GET', url: `/api/projects/${sourceId}/chains/${chain.id}/bundle` });
    expect(response.statusCode).toBe(422);
    expect(response.json<{ error: { message: string } }>().error.message).toContain('package directory is unavailable');

    discoveryOverride = {
      entries: [
        catalogEntry({ id: 'personal-review', source: 'personal', packagePath: join(root, 'personal') }),
        catalogEntry({ id: 'extra-review', source: 'loom-extra', packagePath: join(root, 'extra') }),
      ],
      warnings: [],
    };
    response = await app.inject({ method: 'GET', url: `/api/projects/${sourceId}/chains/${chain.id}/bundle` });
    expect(response.statusCode).toBe(422);
    expect(response.json<{ error: { message: string } }>().error.message).toContain('multiple non-project packages');
  });

  it.each(['../escape', '/absolute', 'x\\escape', '.env', 'a/.git/config', 'a//b', 'CON', 'a/../b', 'space.'])(
    'rejects unsafe package path %s before writing', async (path) => {
      const bundle = await exported();
      bundle.skills[0]!.files.push({ path, content: '', executable: false });
      expect((await request('import', bundle, { confirmed: true })).statusCode).toBe(422);
      expect(await readdir(target)).toEqual(['.loom']);
    },
  );

  it('rejects unsupported versions, missing/extra packages, name mismatch and invalid base64', async () => {
    const bundle = await exported();
    expect((await request('preview', { ...bundle, version: 99 })).statusCode).toBe(422);
    expect((await request('preview', { ...bundle, skills: [] })).statusCode).toBe(422);
    expect((await request('preview', { ...bundle, skills: [...bundle.skills, bundle.skills[0]] })).statusCode).toBe(422);
    const skill = bundle.skills[0]!;
    expect((await request('preview', { ...bundle, skills: [{ ...skill, name: 'other' }] })).statusCode).toBe(422);
    skill.files.push({ path: 'bad.txt', content: 'not base64', executable: false });
    expect((await request('preview', bundle)).statusCode).toBe(422);
  });

  it('rejects case-folded and file/directory collisions', async () => {
    const bundle = await exported();
    const skill = bundle.skills[0]!;
    skill.files.push({ path: 'skill.md', content: '', executable: false });
    expect(() => parseBundle(bundle)).toThrow('duplicate');
    skill.files.pop();
    skill.files.push({ path: 'scripts', content: '', executable: false });
    expect(() => parseBundle(bundle)).toThrow('directory');
  });

  it('enforces total decoded bytes and file count', async () => {
    const bundle = await exported();
    const existingBytes = bundle.skills[0]!.files.reduce((sum, file) => sum + Buffer.from(file.content, 'base64').length, 0);
    const largeFile = { path: 'large.bin', content: Buffer.alloc(MAX_BUNDLE_BYTES - existingBytes).toString('base64'), executable: false };
    bundle.skills[0]!.files.push(largeFile);
    expect(() => parseBundle(bundle)).not.toThrow();
    largeFile.content = Buffer.alloc(MAX_BUNDLE_BYTES - existingBytes + 1).toString('base64');
    expect(() => parseBundle(bundle)).toThrow('20 MiB');
    bundle.skills[0]!.files.pop();
    bundle.skills[0]!.files.push(...Array.from({ length: 1_997 }, (_, i) => ({ path: `f-${i}`, content: '', executable: false })));
    expect(() => parseBundle(bundle)).not.toThrow();
    bundle.skills[0]!.files.push({ path: 'one-too-many', content: '', executable: false });
    expect(() => parseBundle(bundle)).toThrow();
  });

  it('enforces the 30 MiB JSON request boundary before decoding the bundle', async () => {
    const payload = '{}' + ' '.repeat(MAX_BUNDLE_REQUEST_BYTES - 2);
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/projects/${targetId}/chain-bundles/preview`,
      headers: { 'content-type': 'application/json' },
      payload,
    });
    expect(accepted.statusCode).toBe(422);
    expect(accepted.json<{ error: { code: string } }>().error.code).toBe('BUNDLE_INVALID');
    const oversized = await app.inject({
      method: 'POST',
      url: `/api/projects/${targetId}/chain-bundles/preview`,
      headers: { 'content-type': 'application/json' },
      payload: payload + ' ',
    });
    expect(oversized.statusCode).toBe(413);
  });

  it('supports instruction-only sharing without skill packages', async () => {
    chain = await chains.create(source, {
      name: 'Instructions',
      harness: 'opencode',
      sessionMode: 'fresh',
      steps: [{ id: 'note', kind: 'instruction', instruction: 'Inspect the repository.' }],
      inputs: [],
    });
    const bundle = await exported();
    expect(bundle.skills).toEqual([]);
    const result = await request('import', bundle, { confirmed: true });
    expect(result.statusCode, result.body).toBe(201);
    expect(result.json<{ chain: Chain }>().chain.steps).toEqual(chain.steps);
    expect(await readdir(join(target, '.loom', 'chains'))).toHaveLength(1);
    await expect(lstat(join(target, '.opencode'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects unregistered projects without accessing supplied contents', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects/not-registered/chain-bundles/import',
      payload: { bundle: await exported(), confirmed: true },
    });
    expect(response.statusCode).toBe(404);
  });
});
