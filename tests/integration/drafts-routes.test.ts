import { mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { createGlobalDraftService, globalDraftsDirectoryFor } from '../../src/server/chains/drafts.js';
import { globalChainsDirectoryFor } from '../../src/server/chains/store.js';
import { createConfigStore } from '../../src/server/config/store.js';
import type { Chain } from '../../src/server/chains/model.js';

let root: string;
let configDirectory: string;
let app: FastifyInstance;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loom-drafts-'));
  configDirectory = join(root, 'config');
  app = await buildApp({
    env: {},
    serveStatic: false,
    configStore: createConfigStore({
      env: { LOOM_CONFIG_DIR: configDirectory },
      homeDirectory: () => join(root, 'home'),
    }),
  });
});

afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

const draftPayload = {
  name: 'Remote review',
  harness: 'opencode',
  sessionMode: 'shared',
  steps: [
    {
      id: 'step-1',
      skillName: 'reviewer',
      instruction: 'Review {{scope}}.',
    },
  ],
  inputs: [{ name: 'scope', required: true }],
};

describe('project-independent chain drafts', () => {
  it.each(['config', 'drafts'] as const)('rejects a symbolic link at the %s storage boundary', async (boundary) => {
    const target = join(root, 'outside');
    await mkdir(target);
    if (boundary === 'drafts') await mkdir(configDirectory);
    const link = boundary === 'config' ? configDirectory : join(configDirectory, 'drafts');
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    const service = createGlobalDraftService(configDirectory);
    await expect(service.create(configDirectory, draftPayload)).rejects.toMatchObject({
      code: 'CHAIN_PATH_ESCAPED',
    });
    expect(await readdir(target)).toEqual([]);
  });

  it('requires a current revision for HTTP update and deletion', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/drafts', payload: draftPayload });
    const { chain, revision } = created.json<{ chain: Chain; revision: string }>();
    const url = `/api/drafts/${encodeURIComponent(chain.id)}`;
    for (const method of ['PUT', 'DELETE'] as const) {
      const response = await app.inject({
        method, url, ...(method === 'PUT' ? { payload: { ...draftPayload, name: 'Unexpected' } } : {}),
      });
      expect(response.statusCode).toBe(428);
      expect(response.json()).toMatchObject({ error: { code: 'CHAIN_REVISION_REQUIRED' } });
    }
    const updated = await app.inject({
      method: 'PUT', url, headers: { 'x-loom-chain-revision': revision },
      payload: { ...draftPayload, name: 'Reviewed change' },
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

  it('creates, updates, lists, and deletes drafts outside project chains and templates', async () => {
    const createdResponse = await app.inject({
      method: 'POST',
      url: '/api/drafts',
      payload: draftPayload,
    });
    expect(createdResponse.statusCode).toBe(201);
    const created = createdResponse.json<{ chain: Chain }>().chain;

    expect(await readdir(globalDraftsDirectoryFor(configDirectory))).toEqual([
      `${created.id}.json`,
    ]);
    await expect(readdir(globalChainsDirectoryFor(configDirectory))).rejects.toMatchObject({
      code: 'ENOENT',
    });

    const listed = await app.inject({ method: 'GET', url: '/api/drafts' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ chains: Chain[] }>().chains.map((chain) => chain.id)).toEqual([
      created.id,
    ]);

    const updatedResponse = await app.inject({
      method: 'PUT',
      url: `/api/drafts/${encodeURIComponent(created.id)}`,
      headers: { 'x-loom-chain-revision': createdResponse.json<{ revision: string }>().revision },
      payload: { ...draftPayload, name: 'Updated remote review' },
    });
    expect(updatedResponse.statusCode).toBe(200);
    expect(updatedResponse.json<{ chain: Chain }>().chain.name).toBe(
      'Updated remote review',
    );

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/drafts/${encodeURIComponent(created.id)}`,
      headers: { 'x-loom-chain-revision': updatedResponse.json<{ revision: string }>().revision },
    });
    expect(deleted.statusCode).toBe(200);
    expect(await readdir(globalDraftsDirectoryFor(configDirectory))).toEqual([]);
  });

  it('rejects invalid chain drafts without creating a stored record', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/drafts',
      payload: { ...draftPayload, sessionMode: 'unsupported' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    await expect(readdir(globalDraftsDirectoryFor(configDirectory))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
