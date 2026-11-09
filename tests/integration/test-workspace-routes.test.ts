import Fastify from 'fastify';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CatalogService } from '../../src/server/catalog/merge.js';
import { createChainService } from '../../src/server/chains/service.js';
import { createGlobalDraftService } from '../../src/server/chains/drafts.js';
import { createConfigStore } from '../../src/server/config/store.js';
import { createProjectRegistry } from '../../src/server/projects/registry.js';
import { testWorkspaceRoutes } from '../../src/server/routes/test-workspaces.js';

let root: string;

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

describe('test-workspace routes', () => {
  it('creates a disposable workspace directly from a project-independent draft', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'loom-draft-workspace-')));
    const configStore = createConfigStore({
      env: { LOOM_CONFIG_DIR: join(root, 'config') },
      homeDirectory: () => join(root, 'home'),
    });
    const draftService = createGlobalDraftService(configStore.getConfigDir());
    const draft = await draftService.create(configStore.getConfigDir(), {
      name: 'Draft test',
      harness: 'opencode',
      sessionMode: 'fresh',
      steps: [{ id: 'step-1', kind: 'instruction', instruction: 'Produce a file.' }],
      inputs: [],
    });
    const catalogService: CatalogService = {
      defaultHarness: 'opencode',
      async getCatalog({ harness }) {
        return {
          harness,
          query: '',
          total: 0,
          counts: {
            total: 0,
            bySource: {
              project: 0, personal: 0, custom: 0, plugin: 0,
              builtin: 0, 'loom-extra': 0, remote: 0,
            },
          },
          groups: [],
          agents: [],
          warnings: [],
          elapsedMs: 0,
        };
      },
    };
    const app = Fastify({ logger: false });
    await app.register(testWorkspaceRoutes, { configStore, catalogService });

    const response = await app.inject({
      method: 'POST',
      url: '/api/test-workspaces',
      payload: { sourceDraftId: draft.id },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      workspace: { sourceDraftId: draft.id, chainId: expect.any(String) },
    });

    await app.close();
  });

  it('creates, lists, and removes a disposable chain project', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'loom-workspace-routes-')));
    const configStore = createConfigStore({
      env: { LOOM_CONFIG_DIR: join(root, 'config') },
      homeDirectory: () => join(root, 'home'),
    });
    const projectRegistry = createProjectRegistry({ configStore });
    const sourcePath = join(root, 'source');
    await mkdir(sourcePath);
    const source = await projectRegistry.openProject(sourcePath);
    const chainService = createChainService();
    const chain = await chainService.create(source.canonicalPath, {
      name: 'Test chain',
      harness: 'opencode',
      sessionMode: 'fresh',
      steps: [{ id: 'step-1', kind: 'instruction', instruction: 'Produce a file.' }],
      inputs: [],
    });
    const catalogService: CatalogService = {
      defaultHarness: 'opencode',
      async getCatalog({ harness }) {
        return {
          harness,
          query: '',
          total: 0,
          counts: {
            total: 0,
            bySource: {
              project: 0, personal: 0, custom: 0, plugin: 0,
              builtin: 0, 'loom-extra': 0, remote: 0,
            },
          },
          groups: [],
          agents: [],
          warnings: [],
          elapsedMs: 0,
        };
      },
    };
    const app = Fastify({ logger: false });
    await app.register(testWorkspaceRoutes, {
      configStore,
      projectRegistry,
      chainService,
      catalogService,
    });

    const create = await app.inject({
      method: 'POST',
      url: '/api/test-workspaces',
      payload: { sourceProjectId: source.id, sourceChainId: chain.id },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json<{ workspace: { id: string; projectId: string; chainId: string } }>();
    expect(created.workspace.projectId).not.toBe(source.id);

    const list = await app.inject({ method: 'GET', url: '/api/test-workspaces' });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ workspaces: Array<{ id: string }> }>().workspaces).toHaveLength(1);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/test-workspaces/${created.workspace.id}`,
    });
    expect(remove.statusCode).toBe(200);
    expect(remove.json()).toMatchObject({ id: created.workspace.id, removed: true });

    const empty = await app.inject({ method: 'GET', url: '/api/test-workspaces' });
    expect(empty.json<{ workspaces: unknown[] }>().workspaces).toEqual([]);
    await app.close();
  });

  it('rejects malformed create payloads before creating a workspace', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'loom-workspace-routes-invalid-')));
    const configStore = createConfigStore({
      env: { LOOM_CONFIG_DIR: join(root, 'config') },
      homeDirectory: () => join(root, 'home'),
    });
    const app = Fastify({ logger: false });
    await app.register(testWorkspaceRoutes, { configStore });

    const response = await app.inject({
      method: 'POST',
      url: '/api/test-workspaces',
      payload: { sourceProjectId: '../outside', sourceChainId: 'chain' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    await app.close();
  });
});
