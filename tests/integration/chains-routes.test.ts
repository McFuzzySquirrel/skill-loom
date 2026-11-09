import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { CHAIN_VERSION, type Chain } from '../../src/server/chains/model.js';
import { createChainService, type ChainService } from '../../src/server/chains/service.js';
import { CHAIN_ID_PATTERN, chainsDirectoryFor } from '../../src/server/chains/store.js';
import { createConfigStore } from '../../src/server/config/store.js';
import {
  isApiErrorEnvelope,
  type ApiErrorEnvelope,
  type ApiValidationIssue,
} from '../../src/shared/api.js';

const CREATED_AT = '2026-11-04T10:00:00.000Z';
const UPDATED_AT = '2026-11-04T11:30:00.000Z';

let root: string;
let configDirectory: string;
let apps: FastifyInstance[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loom-chain-routes-'));
  configDirectory = join(root, 'config');
  apps = [];
});

afterEach(async () => {
  for (const app of apps.splice(0)) {
    await app.close();
  }
  await rm(root, { recursive: true, force: true });
});

function baseDraft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Release chain',
    harness: 'opencode',
    sessionMode: 'shared',
    steps: [
      {
        id: 'step-1',
        skillName: 'brainstorm',
        instruction: 'Plan the release for {{task}}.',
      },
    ],
    inputs: [{ name: 'task', required: true }],
    automaticPermissionOptIn: false,
    ...overrides,
  };
}

async function buildTestApp(chainService?: ChainService): Promise<FastifyInstance> {
  const app = await buildApp({
    env: {},
    serveStatic: false,
    configStore: createConfigStore({
      env: { LOOM_CONFIG_DIR: configDirectory },
      homeDirectory: () => join(root, 'home'),
    }),
    ...(chainService === undefined ? {} : { chainService }),
  });
  apps.push(app);
  return app;
}

async function registerProject(app: FastifyInstance, directory: string): Promise<string> {
  await mkdir(directory, { recursive: true });
  const response = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { mode: 'open', path: directory },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ project: { id: string } }>().project.id;
}

function chainUrl(projectId: string, chainId?: string, suffix = ''): string {
  const base = `/api/projects/${encodeURIComponent(projectId)}/chains`;
  return chainId === undefined ? base : `${base}/${encodeURIComponent(chainId)}${suffix}`;
}

async function listChains(
  app: FastifyInstance,
  projectId: string,
): Promise<{ statusCode: number; body: unknown }> {
  const response = await app.inject({ method: 'GET', url: chainUrl(projectId) });
  return { statusCode: response.statusCode, body: response.json<unknown>() };
}

async function getChain(
  app: FastifyInstance,
  projectId: string,
  chainId: string,
): Promise<{ statusCode: number; body: unknown }> {
  const response = await app.inject({
    method: 'GET',
    url: chainUrl(projectId, chainId),
  });
  return { statusCode: response.statusCode, body: response.json<unknown>() };
}

async function createChain(
  app: FastifyInstance,
  projectId: string,
  payload: unknown,
  query = '',
): Promise<{ statusCode: number; body: unknown }> {
  const response = await app.inject({
    method: 'POST',
    url: `${chainUrl(projectId)}${query}`,
    payload: payload as Record<string, unknown>,
  });
  return { statusCode: response.statusCode, body: response.json<unknown>() };
}

async function updateChain(
  app: FastifyInstance,
  projectId: string,
  chainId: string,
  payload: unknown,
  query = '',
): Promise<{ statusCode: number; body: unknown }> {
  const current = await app.inject({ method: 'GET', url: chainUrl(projectId, chainId) });
  const revision = current.statusCode === 200
    ? current.json<{ revision: string }>().revision : '0'.repeat(64);
  const response = await app.inject({
    method: 'PUT',
    url: `${chainUrl(projectId, chainId)}${query}`,
    headers: { 'x-loom-chain-revision': revision },
    payload: payload as Record<string, unknown>,
  });
  return { statusCode: response.statusCode, body: response.json<unknown>() };
}

async function duplicateChain(
  app: FastifyInstance,
  projectId: string,
  chainId: string,
  payload?: unknown,
  query = '',
): Promise<{ statusCode: number; body: unknown }> {
  const response = await app.inject({
    method: 'POST',
    url: `${chainUrl(projectId, chainId, '/duplicate')}${query}`,
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
  return { statusCode: response.statusCode, body: response.json<unknown>() };
}

async function deleteChain(
  app: FastifyInstance,
  projectId: string,
  chainId: string,
): Promise<{ statusCode: number; body: unknown }> {
  const current = await app.inject({ method: 'GET', url: chainUrl(projectId, chainId) });
  const revision = current.statusCode === 200
    ? current.json<{ revision: string }>().revision : '0'.repeat(64);
  const response = await app.inject({
    method: 'DELETE',
    url: chainUrl(projectId, chainId),
    headers: { 'x-loom-chain-revision': revision },
  });
  return { statusCode: response.statusCode, body: response.json<unknown>() };
}

function chainOf(body: unknown): Chain {
  expect(body).toMatchObject({ chain: expect.any(Object) });
  return (body as { chain: Chain }).chain;
}

function chainsOf(body: unknown): Chain[] {
  expect(body).toMatchObject({ chains: expect.any(Array) });
  return (body as { chains: Chain[] }).chains;
}

function warningsOf(body: unknown): Array<{ code: string; chainId: string }> {
  expect(body).toMatchObject({ warnings: expect.any(Array) });
  return (body as { warnings: Array<{ code: string; chainId: string }> }).warnings;
}

function envelope(body: unknown): ApiErrorEnvelope {
  expect(isApiErrorEnvelope(body)).toBe(true);
  if (!isApiErrorEnvelope(body)) {
    throw new Error('Expected the shared API error envelope.');
  }
  expect(body.error.message.length).toBeGreaterThan(0);
  expect(body.error.message).not.toContain('stack');
  return body;
}

function issuesOf(body: unknown): ApiValidationIssue[] {
  const error = envelope(body);
  const details = error.error.details as { issues?: ApiValidationIssue[] } | undefined;
  return details?.issues ?? [];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function fixedClock(times: string[]): () => Date {
  let index = 0;
  return () => new Date(times[Math.min(index++, times.length - 1)]!);
}

function sequenceIds(prefix = 'chain'): (name: string) => string {
  let next = 0;
  return () => {
    next += 1;
    return `${prefix}-${String(next)}`;
  };
}

describe('chain CRUD through src/server/app.ts', () => {
  it('requires a current revision for HTTP update and deletion', async () => {
    const app = await buildTestApp();
    const projectId = await registerProject(app, join(root, 'revision-project'));
    const created = await createChain(app, projectId, baseDraft());
    const chain = chainOf(created.body);
    const url = chainUrl(projectId, chain.id);
    const original = await app.inject({ method: 'GET', url });
    const revision = original.json<{ revision: string }>().revision;
    for (const method of ['PUT', 'DELETE'] as const) {
      const response = await app.inject({
        method, url, ...(method === 'PUT' ? { payload: baseDraft({ name: 'Unexpected' }) } : {}),
      });
      expect(response.statusCode).toBe(428);
      expect(response.json()).toMatchObject({ error: { code: 'CHAIN_REVISION_REQUIRED' } });
    }
    const updated = await app.inject({
      method: 'PUT', url, headers: { 'x-loom-chain-revision': revision },
      payload: baseDraft({ name: 'Reviewed change' }),
    });
    expect(updated.statusCode).toBe(200);
    const stale = await app.inject({
      method: 'DELETE', url, headers: { 'x-loom-chain-revision': revision },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: 'CHAIN_STALE' } });
    const current = await app.inject({ method: 'GET', url });
    expect(current.json<{ chain: Chain }>().chain.name).toBe('Reviewed change');
  });

  it('persists and duplicates an exact native-agent selection', async () => {
    const app = await buildTestApp();
    const projectId = await registerProject(app, join(root, 'project-agent-chain'));
    const agent = {
      harness: 'opencode',
      name: 'team/reviewer',
      sourceId: 'remote-source',
      revision: 'a'.repeat(40),
      repositoryPath: '.opencode/agents/team/reviewer.md',
      agentPath: 'team/reviewer.md',
      fingerprint: 'b'.repeat(64),
    };

    const created = await createChain(app, projectId, baseDraft({ agent }));
    expect(created.statusCode).toBe(201);
    const chain = chainOf(created.body);
    expect(chain.agent).toEqual(agent);

    const duplicated = await duplicateChain(app, projectId, chain.id);
    expect(duplicated.statusCode).toBe(201);
    expect(chainOf(duplicated.body).agent).toEqual(agent);

    const sameHarness = await duplicateChain(app, projectId, chain.id, { harness: 'opencode' });
    expect(sameHarness.statusCode).toBe(201);
    expect(chainOf(sameHarness.body).agent).toEqual(agent);

    const differentHarness = await duplicateChain(app, projectId, chain.id, { harness: 'copilot' });
    expect(differentHarness.statusCode).toBe(201);
    const copy = chainOf(differentHarness.body);
    expect(copy).toMatchObject({ harness: 'copilot', steps: chain.steps, inputs: chain.inputs });
    expect(copy).not.toHaveProperty('agent');
    expect(chainOf((await getChain(app, projectId, chain.id)).body).agent).toEqual(agent);

    const invalidHarness = await duplicateChain(app, projectId, chain.id, { harness: 'unknown' });
    expect(invalidHarness.statusCode).toBe(422);
    expect(chainsOf((await listChains(app, projectId)).body)).toHaveLength(4);

    const updated = await updateChain(app, projectId, chain.id, {
      ...chain,
      harness: 'copilot',
    });
    expect(updated.statusCode).toBe(422);
  });

  it('creates, reads, lists, updates, duplicates, and deletes a chain', async () => {
    const app = await buildTestApp();
    const project = join(root, 'project-crud');
    const projectId = await registerProject(app, project);

    const created = await createChain(app, projectId, baseDraft());
    expect(created.statusCode).toBe(201);
    const chain = chainOf(created.body);
    expect(chain.id).toMatch(CHAIN_ID_PATTERN);
    expect(chain.version).toBe(CHAIN_VERSION);
    expect(chain.name).toBe('Release chain');
    expect(chain.harness).toBe('opencode');
    expect(chain.sessionMode).toBe('shared');
    expect(chain.steps).toHaveLength(1);
    expect(chain.inputs).toEqual([{ name: 'task', required: true }]);
    expect(Number.isNaN(Date.parse(chain.createdAt))).toBe(false);
    expect(Number.isNaN(Date.parse(chain.updatedAt))).toBe(false);

    const storedPath = join(chainsDirectoryFor(project), `${chain.id}.json`);
    const stored = JSON.parse(await readFile(storedPath, 'utf8')) as Chain;
    expect(stored.id).toBe(chain.id);
    expect(stored.version).toBe(CHAIN_VERSION);

    const fetched = await getChain(app, projectId, chain.id);
    expect(fetched.statusCode).toBe(200);
    expect(chainOf(fetched.body)).toEqual(chain);

    const listed = await listChains(app, projectId);
    expect(listed.statusCode).toBe(200);
    expect(chainsOf(listed.body)).toEqual([chain]);
    expect(warningsOf(listed.body)).toEqual([]);

    const updated = await updateChain(app, projectId, chain.id, {
      ...chain,
      name: 'Renamed release chain',
      steps: [
        {
          id: 'step-1',
          skillName: 'brainstorm',
          instruction: 'Plan the renamed release for {{task}}.',
        },
      ],
    });
    expect(updated.statusCode).toBe(200);
    const updatedChain = chainOf(updated.body);
    expect(updatedChain.id).toBe(chain.id);
    expect(updatedChain.name).toBe('Renamed release chain');
    expect(updatedChain.steps[0]?.instruction).toContain('renamed release');
    expect(updatedChain.createdAt).toBe(chain.createdAt);
    expect(Date.parse(updatedChain.updatedAt)).toBeGreaterThanOrEqual(
      Date.parse(chain.updatedAt),
    );

    const duplicated = await duplicateChain(app, projectId, chain.id);
    expect(duplicated.statusCode).toBe(201);
    const copy = chainOf(duplicated.body);
    expect(copy.id).not.toBe(chain.id);
    expect(copy.id).toMatch(CHAIN_ID_PATTERN);
    expect(copy.name).toBe('Renamed release chain copy');
    expect(copy.harness).toBe(chain.harness);
    expect(copy.sessionMode).toBe(chain.sessionMode);
    expect(copy.steps).toEqual(updatedChain.steps);
    expect(copy.inputs).toEqual(updatedChain.inputs);

    const afterDuplicate = await getChain(app, projectId, chain.id);
    expect(afterDuplicate.statusCode).toBe(200);
    expect(chainOf(afterDuplicate.body)).toEqual(updatedChain);

    const removed = await deleteChain(app, projectId, chain.id);
    expect(removed.statusCode).toBe(200);
    expect(removed.body).toEqual({ chainId: chain.id, deleted: true });
    expect(await exists(storedPath)).toBe(false);

    const afterDelete = await listChains(app, projectId);
    expect(chainsOf(afterDelete.body).map((entry) => entry.id)).toEqual([copy.id]);

    const missing = await getChain(app, projectId, chain.id);
    expect(missing.statusCode).toBe(404);
    expect(envelope(missing.body).error.code).toBe('CHAIN_NOT_FOUND');
  });

  it('preserves createdAt and sets a new updatedAt on update', async () => {
    const service = createChainService({
      now: fixedClock([CREATED_AT, UPDATED_AT, UPDATED_AT]),
      generateId: sequenceIds(),
    });
    const app = await buildTestApp(service);
    const projectId = await registerProject(app, join(root, 'project-clock'));

    const created = chainOf((await createChain(app, projectId, baseDraft())).body);
    expect(created.createdAt).toBe(CREATED_AT);
    expect(created.updatedAt).toBe(CREATED_AT);

    const updated = await updateChain(app, projectId, created.id, {
      ...baseDraft({ name: 'Edited chain' }),
    });
    expect(updated.statusCode).toBe(200);
    expect(chainOf(updated.body).createdAt).toBe(CREATED_AT);
    expect(chainOf(updated.body).updatedAt).toBe(UPDATED_AT);
  });

  it('generates deterministic ids and lists newest updated first', async () => {
    const service = createChainService({
      now: fixedClock([
        '2026-11-04T09:00:00.000Z',
        '2026-11-04T10:00:00.000Z',
        '2026-11-04T11:00:00.000Z',
      ]),
      generateId: sequenceIds('ordered'),
    });
    const app = await buildTestApp(service);
    const projectId = await registerProject(app, join(root, 'project-order'));

    await createChain(app, projectId, baseDraft({ name: 'First' }));
    await createChain(app, projectId, baseDraft({ name: 'Second' }));
    await createChain(app, projectId, baseDraft({ name: 'Third' }));

    const listed = chainsOf((await listChains(app, projectId)).body);
    expect(listed.map((chain) => chain.name)).toEqual(['Third', 'Second', 'First']);
    expect(listed.map((chain) => chain.id)).toEqual(['ordered-3', 'ordered-2', 'ordered-1']);
  });

  it('duplicates with a distinct name and leaves the source untouched', async () => {
    const app = await buildTestApp();
    const project = join(root, 'project-duplicate');
    const projectId = await registerProject(app, project);
    const source = chainOf((await createChain(app, projectId, baseDraft())).body);
    const sourcePath = join(chainsDirectoryFor(project), `${source.id}.json`);
    const sourceBytes = await readFile(sourcePath, 'utf8');

    const first = chainOf((await duplicateChain(app, projectId, source.id)).body);
    const second = chainOf((await duplicateChain(app, projectId, source.id)).body);
    expect(first.name).toBe('Release chain copy');
    expect(second.name).toBe('Release chain copy 2');
    expect(new Set([source.id, first.id, second.id]).size).toBe(3);

    const named = await duplicateChain(app, projectId, source.id, { name: 'Variant' });
    expect(named.statusCode).toBe(201);
    expect(chainOf(named.body).name).toBe('Variant');

    expect(await readFile(sourcePath, 'utf8')).toBe(sourceBytes);
    expect(chainOf((await getChain(app, projectId, source.id)).body)).toEqual(source);
  });

  it('returns 409 when uniqueness is requested for an existing name', async () => {
    const app = await buildTestApp();
    const projectId = await registerProject(app, join(root, 'project-unique'));
    const first = chainOf((await createChain(app, projectId, baseDraft({ name: 'Shared' }))).body);

    const conflict = await createChain(
      app,
      projectId,
      baseDraft({ name: 'shared ' }),
      '?uniqueName=true',
    );
    expect(conflict.statusCode).toBe(409);
    expect(envelope(conflict.body).error.code).toBe('CHAIN_NAME_EXISTS');

    const bodyConflict = await createChain(
      app,
      projectId,
      baseDraft({ name: 'SHARED', uniqueName: true }),
    );
    expect(bodyConflict.statusCode).toBe(409);
    expect(envelope(bodyConflict.body).error.code).toBe('CHAIN_NAME_EXISTS');

    const allowed = await createChain(app, projectId, baseDraft({ name: 'shared ' }));
    expect(allowed.statusCode).toBe(201);
    const second = chainOf(allowed.body);
    expect(second.name).toBe('shared');

    const updateConflict = await updateChain(
      app,
      projectId,
      second.id,
      baseDraft({ name: first.name }),
      '?uniqueName=true',
    );
    expect(updateConflict.statusCode).toBe(409);
    expect(envelope(updateConflict.body).error.code).toBe('CHAIN_NAME_EXISTS');

    const duplicateConflict = await duplicateChain(
      app,
      projectId,
      second.id,
      { name: first.name },
      '?uniqueName=true',
    );
    expect(duplicateConflict.statusCode).toBe(409);
    expect(envelope(duplicateConflict.body).error.code).toBe('CHAIN_NAME_EXISTS');

    expect(chainsOf((await listChains(app, projectId)).body)).toHaveLength(2);
  });

  it('returns 409 when a generated id already exists', async () => {
    const project = join(root, 'project-id-conflict');
    const service = createChainService({ generateId: () => 'fixed-chain' });
    const app = await buildTestApp(service);
    const projectId = await registerProject(app, project);

    const existing = chainOf((await createChain(app, projectId, baseDraft({ name: 'Existing' }))).body);
    expect(existing.id).toBe('fixed-chain');

    const conflict = await createChain(app, projectId, baseDraft({ name: 'Another' }));

    expect(conflict.statusCode).toBe(409);
    expect(envelope(conflict.body).error.code).toBe('CHAIN_ALREADY_EXISTS');
    expect(chainsOf((await listChains(app, projectId)).body)).toHaveLength(1);
  });
});

describe('chain project scoping', () => {
  it('never exposes a chain through another project id', async () => {
    const app = await buildTestApp();
    const projectA = join(root, 'project-a');
    const projectB = join(root, 'project-b');
    const projectAId = await registerProject(app, projectA);
    const projectBId = await registerProject(app, projectB);

    const chain = chainOf((await createChain(app, projectAId, baseDraft())).body);

    expect(chainsOf((await listChains(app, projectBId)).body)).toEqual([]);

    const crossRead = await getChain(app, projectBId, chain.id);
    expect(crossRead.statusCode).toBe(404);
    expect(envelope(crossRead.body).error.code).toBe('CHAIN_NOT_FOUND');

    const crossUpdate = await updateChain(
      app,
      projectBId,
      chain.id,
      baseDraft({ name: 'Stolen' }),
    );
    expect(crossUpdate.statusCode).toBe(404);
    expect(envelope(crossUpdate.body).error.code).toBe('CHAIN_NOT_FOUND');

    const crossDuplicate = await duplicateChain(app, projectBId, chain.id);
    expect(crossDuplicate.statusCode).toBe(404);

    const crossDelete = await deleteChain(app, projectBId, chain.id);
    expect(crossDelete.statusCode).toBe(404);

    expect(await exists(join(chainsDirectoryFor(projectA), `${chain.id}.json`))).toBe(true);
    expect(await exists(chainsDirectoryFor(projectB))).toBe(false);
    expect(chainOf((await getChain(app, projectAId, chain.id)).body).name).toBe(
      'Release chain',
    );
  });

  it('returns 404 for an unknown, malformed, or unregistered project id', async () => {
    const app = await buildTestApp();

    for (const projectId of [
      'missing-000000000000',
      'not-a-valid-id',
      'Traversal Project',
    ]) {
      const listed = await listChains(app, projectId);
      expect(listed.statusCode).toBe(404);
      expect(envelope(listed.body).error.code).toBe('CHAIN_PROJECT_NOT_FOUND');

      const created = await createChain(app, projectId, baseDraft());
      expect(created.statusCode).toBe(404);
      expect(envelope(created.body).error.code).toBe('CHAIN_PROJECT_NOT_FOUND');
    }
  });
});

describe('chain request validation', () => {
  it('returns 422 with field details for invalid create payloads', async () => {
    const app = await buildTestApp();
    const project = join(root, 'project-validation');
    const projectId = await registerProject(app, project);

    const cases: Array<{ payload: unknown; path: string; code?: string }> = [
      { payload: {}, path: 'name' },
      { payload: baseDraft({ name: '   ' }), path: 'name' },
      { payload: baseDraft({ harness: 'unknown-harness' }), path: 'harness' },
      { payload: baseDraft({ sessionMode: 'sometimes' }), path: 'sessionMode' },
      { payload: baseDraft({ steps: [] }), path: 'steps' },
      { payload: baseDraft({ steps: 'not-an-array' }), path: 'steps' },
      {
        payload: baseDraft({
          steps: [
            { id: 'duplicate', skillName: 'one', instruction: 'First.' },
            { id: 'duplicate', skillName: 'two', instruction: 'Second.' },
          ],
        }),
        path: 'steps.1.id',
        code: 'chain_duplicate_step_id',
      },
      {
        payload: baseDraft({
          steps: [{ id: 's1', skillName: 'one', instruction: 'Use {{missing}}.' }],
        }),
        path: 'steps.0.instruction',
        code: 'chain_placeholder_unknown',
      },
      {
        payload: baseDraft({
          steps: [{ id: 's1', skillName: 'one', instruction: '   ' }],
        }),
        path: 'steps.0.instruction',
      },
      {
        payload: baseDraft({ inputs: [{ name: '1bad' }], steps: [{ id: 's1', skillName: 'one', instruction: 'Go.' }] }),
        path: 'inputs.0.name',
      },
      { payload: { ...baseDraft(), id: 'client-supplied' }, path: 'id', code: 'server_generated' },
      { payload: { ...baseDraft(), version: CHAIN_VERSION - 1 }, path: 'version' },
    ];

    for (const testCase of cases) {
      const response = await createChain(app, projectId, testCase.payload);
      expect(response.statusCode).toBe(422);
      expect(envelope(response.body).error.code).toBe('VALIDATION_ERROR');
      expect(issuesOf(response.body)).toContainEqual(
        expect.objectContaining({ path: testCase.path }),
      );
      if (testCase.code !== undefined) {
        expect(issuesOf(response.body)).toContainEqual(
          expect.objectContaining({ path: testCase.path, code: testCase.code }),
        );
      }
    }

    const unknownField = await createChain(app, projectId, {
      ...baseDraft(),
      path: '/etc/passwd',
    });
    expect(unknownField.statusCode).toBe(422);

    const requiredInput = await createChain(
      app,
      projectId,
      baseDraft({
        inputs: [],
        steps: [{ id: 's1', skillName: 'one', instruction: 'Use {{task}}.' }],
      }),
    );
    expect(requiredInput.statusCode).toBe(422);
    expect(issuesOf(requiredInput.body)).toContainEqual(
      expect.objectContaining({ path: 'steps.0.instruction', code: 'chain_placeholder_unknown' }),
    );

    expect(chainsOf((await listChains(app, projectId)).body)).toEqual([]);
  });

  it('returns 422 for invalid update payloads and leaves the stored chain intact', async () => {
    const app = await buildTestApp();
    const projectId = await registerProject(app, join(root, 'project-update-validation'));
    const chain = chainOf((await createChain(app, projectId, baseDraft())).body);

    const invalid = await updateChain(app, projectId, chain.id, {
      ...baseDraft(),
      name: '',
    });
    expect(invalid.statusCode).toBe(422);
    expect(issuesOf(invalid.body)).toContainEqual(expect.objectContaining({ path: 'name' }));

    const idMismatch = await updateChain(app, projectId, chain.id, {
      ...baseDraft(),
      id: 'different-id',
    });
    expect(idMismatch.statusCode).toBe(422);
    expect(issuesOf(idMismatch.body)).toContainEqual(
      expect.objectContaining({ path: 'id', code: 'id_mismatch' }),
    );

    const versionMismatch = await updateChain(app, projectId, chain.id, {
      ...baseDraft(),
      version: 99,
    });
    expect(versionMismatch.statusCode).toBe(422);
    expect(issuesOf(versionMismatch.body)).toContainEqual(
      expect.objectContaining({ path: 'version' }),
    );

    expect(chainOf((await getChain(app, projectId, chain.id)).body)).toEqual(chain);
  });

  it('rejects malformed query and duplicate payloads with 422', async () => {
    const app = await buildTestApp();
    const projectId = await registerProject(app, join(root, 'project-query-validation'));
    const chain = chainOf((await createChain(app, projectId, baseDraft())).body);

    const badQuery = await createChain(app, projectId, baseDraft(), '?uniqueName=maybe');
    expect(badQuery.statusCode).toBe(422);
    expect(issuesOf(badQuery.body)).toContainEqual(
      expect.objectContaining({ path: 'uniqueName' }),
    );

    const badDuplicateName = await duplicateChain(app, projectId, chain.id, { name: 42 });
    expect(badDuplicateName.statusCode).toBe(422);
    expect(issuesOf(badDuplicateName.body)).toContainEqual(
      expect.objectContaining({ path: 'name' }),
    );
  });

  it('rejects an unsafe chain id before touching another project directory', async () => {
    const app = await buildTestApp();
    const project = join(root, 'project-traversal');
    const projectId = await registerProject(app, project);

    for (const chainId of ['..%2Fescape', 'UPPER-CASE', 'with%20space']) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/projects/${encodeURIComponent(projectId)}/chains/${chainId}`,
      });
      expect(response.statusCode).toBe(422);
      expect(envelope(response.json<unknown>()).error.code).toBe('CHAIN_ID_INVALID');
    }

    expect(await exists(join(root, 'escape.json'))).toBe(false);
    expect(await exists(chainsDirectoryFor(project))).toBe(false);
  });
});

describe('chain listing warnings', () => {
  it('returns corrupt files as warnings without hiding valid chains', async () => {
    const app = await buildTestApp();
    const project = join(root, 'project-warnings');
    const projectId = await registerProject(app, project);
    const chain = chainOf((await createChain(app, projectId, baseDraft())).body);

    const chainsDirectory = chainsDirectoryFor(project);
    await writeFile(join(chainsDirectory, 'broken.json'), '{not json', 'utf8');
    await writeFile(
      join(chainsDirectory, 'future.json'),
      JSON.stringify({ version: 99, id: 'future' }),
      'utf8',
    );

    const listed = await listChains(app, projectId);
    expect(listed.statusCode).toBe(200);
    expect(chainsOf(listed.body)).toEqual([chain]);
    expect(warningsOf(listed.body)).toContainEqual(
      expect.objectContaining({ code: 'CHAIN_FILE_CORRUPT', chainId: 'broken' }),
    );
    expect(warningsOf(listed.body)).toContainEqual(
      expect.objectContaining({ code: 'CHAIN_UNSUPPORTED_VERSION', chainId: 'future' }),
    );

    const corruptRead = await getChain(app, projectId, 'broken');
    expect(corruptRead.statusCode).toBe(422);
    expect(envelope(corruptRead.body).error.code).toBe('CHAIN_FILE_CORRUPT');
  });
});
