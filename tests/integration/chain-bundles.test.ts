import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { createCatalogService } from '../../src/server/catalog/merge.js';
import { scanOpenCodeSkills } from '../../src/server/catalog/opencode.js';
import { MAX_BUNDLE_BYTES, MAX_BUNDLE_REQUEST_BYTES, parseBundle } from '../../src/server/chains/bundle.js';
import { createChainService, type ChainService } from '../../src/server/chains/service.js';
import { createConfigStore } from '../../src/server/config/store.js';
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

const skillText = '---\nname: review\ndescription: Review changes\n---\nInspect the changes.\n';
const binary = Buffer.from([0, 1, 128, 255]);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loom-bundles-'));
  source = join(root, 'source');
  target = join(root, 'target');
  const packagePath = join(source, '.opencode', 'skills', 'review');
  await mkdir(join(packagePath, 'scripts'), { recursive: true });
  await mkdir(target);
  await writeFile(join(packagePath, 'SKILL.md'), skillText);
  await writeFile(join(packagePath, 'scripts', 'check.sh'), '#!/bin/sh\nexit 0\n');
  await chmod(join(packagePath, 'scripts', 'check.sh'), 0o755);
  await writeFile(join(packagePath, 'asset.bin'), binary);
  const configStore = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') }, homeDirectory: () => join(root, 'home') });
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
          discover: ({ projectPath }) => scanOpenCodeSkills({ projectPath, homeDirectory: join(root, 'home') }),
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

function request(action: 'preview' | 'import', bundle: unknown, extra: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: `/api/projects/${targetId}/chain-bundles/${action}`,
    payload: { bundle, ...extra },
  });
}

describe('portable chain bundles', () => {
  it('round-trips full packages, binary files and script modes with fresh identity and consent', async () => {
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
    const destination = join(target, '.opencode', 'skills', 'review');
    expect(await readFile(join(destination, 'SKILL.md'), 'utf8')).toBe(skillText);
    expect(await readFile(join(destination, 'asset.bin'))).toEqual(binary);
    expect((await lstat(join(destination, 'scripts', 'check.sh'))).mode & 0o111).not.toBe(0);
    expect((await chains.get(target, imported.id)).steps).toEqual(chain.steps);
  });

  it('requires explicit confirmation and never writes during preview', async () => {
    const response = await request('import', await exported());
    expect(response.statusCode).toBe(422);
    expect(await readdir(target)).toEqual(['.loom']);
  });

  it('installs Copilot bundles in the established project skill location', async () => {
    const bundle = await exported();
    bundle.chain.harness = 'copilot';
    const response = await request('import', bundle, { confirmed: true });
    expect(response.statusCode, response.body).toBe(201);
    expect(await readFile(join(target, '.github', 'skills', 'review', 'SKILL.md'), 'utf8')).toBe(skillText);
    expect(response.json<{ chain: Chain }>().chain.harness).toBe('copilot');
  });

  it('requires explicit reuse of conflicting skills and never overwrites', async () => {
    const bundle = await exported();
    expect((await request('import', bundle, { confirmed: true })).statusCode).toBe(201);
    const path = join(target, '.opencode', 'skills', 'review', 'SKILL.md');
    await writeFile(path, skillText + 'Local changes\n');
    const preview = await request('preview', bundle);
    expect(preview.json<BundlePreview>().skills[0]).toMatchObject({ conflict: true, directoryExists: true });
    expect((await request('import', bundle, { confirmed: true })).statusCode).toBe(409);
    const response = await request('import', bundle, { confirmed: true, reuseSkills: ['review'] });
    expect(response.statusCode, response.body).toBe(201);
    expect(await readFile(path, 'utf8')).toBe(skillText + 'Local changes\n');
    expect((await chains.list(target)).chains).toHaveLength(2);
  });

  it('rejects stale/invalid reuse choices and physical directory conflicts', async () => {
    const bundle = await exported();
    expect((await request('import', bundle, { confirmed: true, reuseSkills: ['review'] })).statusCode).toBe(422);
    await mkdir(join(target, '.opencode', 'skills', 'review'), { recursive: true });
    expect((await request('import', bundle, { confirmed: true })).statusCode).toBe(409);
  });

  it('rolls back only newly installed packages if saving the chain fails', async () => {
    vi.spyOn(chains, 'importChain').mockRejectedValueOnce(new Error('simulated store failure'));
    const response = await request('import', await exported(), { confirmed: true });
    expect(response.statusCode).toBe(500);
    expect(await readdir(join(target, '.opencode', 'skills'))).toEqual([]);
  });

  it('refuses symlinked destination ancestors', async () => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, join(target, '.opencode'));
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
