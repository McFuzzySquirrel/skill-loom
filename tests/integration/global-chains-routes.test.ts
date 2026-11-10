import { mkdir, mkdtemp, readdir, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { Chain } from '../../src/server/chains/model.js';
import { globalChainsDirectoryFor } from '../../src/server/chains/store.js';
import { createConfigStore } from '../../src/server/config/store.js';
import { isApiErrorEnvelope } from '../../src/shared/api.js';

let root: string;
let configDirectory: string;
let apps: FastifyInstance[];

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'loom-global-chains-')));
  configDirectory = join(root, 'config');
  apps = [];
});

afterEach(async () => {
  for (const app of apps.splice(0)) {
    await app.close();
  }
  await rm(root, { recursive: true, force: true });
});

async function buildTestApp(): Promise<FastifyInstance> {
  const app = await buildApp({
    env: {},
    serveStatic: false,
    configStore: createConfigStore({
      env: { LOOM_CONFIG_DIR: configDirectory },
      homeDirectory: () => join(root, 'home'),
    }),
  });
  apps.push(app);
  return app;
}

async function registerProject(app: FastifyInstance, name: string): Promise<string> {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  const response = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { mode: 'open', path: directory },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ project: { id: string } }>().project.id;
}

async function createChain(
  app: FastifyInstance,
  projectId: string,
  agent?: Chain['agent'],
): Promise<Chain> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/projects/${encodeURIComponent(projectId)}/chains`,
    payload: {
      name: 'Release chain',
      harness: 'opencode',
      sessionMode: 'shared',
      steps: [
        {
          id: 'step-1',
          skillName: 'deploy-helper',
          instruction: 'Deploy {{release}}.',
        },
      ],
      inputs: [{ name: 'release', required: true }],
      ...(agent === undefined ? {} : { agent }),
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ chain: Chain }>().chain;
}

function chainOf(body: unknown): Chain {
  expect(body).toMatchObject({ chain: expect.any(Object) });
  return (body as { chain: Chain }).chain;
}

describe('global chain template routes', () => {
  it.each(['canonical', 'alias'] as const)('saves and imports a global template using a %s config path', async (pathKind) => {
    if (pathKind === 'alias') {
      const alias = join(root, 'alias');
      await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
      configDirectory = join(alias, 'config');
    }
    const app = await buildTestApp();
    const sourceProject = await registerProject(app, 'source-project');
    const targetProject = await registerProject(app, 'target-project');
    const source = await createChain(app, sourceProject, {
      harness: 'opencode',
      name: 'team/reviewer',
      sourceId: 'remote-source',
      revision: 'a'.repeat(40),
      repositoryPath: '.opencode/agents/team/reviewer.md',
      agentPath: 'team/reviewer.md',
      fingerprint: 'b'.repeat(64),
    });

    const savedResponse = await app.inject({
      method: 'POST',
      url: '/api/chains',
      payload: { projectId: sourceProject, chainId: source.id },
    });
    expect(savedResponse.statusCode).toBe(201);
    const template = chainOf(savedResponse.json<unknown>());
    expect(template.id).not.toBe(source.id);
    expect(template.name).toBe(source.name);
    expect(template.agent).toEqual(source.agent);

    const listResponse = await app.inject({ method: 'GET', url: '/api/chains' });
    expect(listResponse.statusCode).toBe(200);
    const list = listResponse.json<{ chains: Chain[]; warnings: unknown[] }>();
    expect(list.chains.map((chain) => chain.id)).toEqual([template.id]);
    expect(list.warnings).toEqual([]);

    const files = await readdir(globalChainsDirectoryFor(configDirectory));
    expect(files).toEqual([`${template.id}.json`]);

    const importResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${encodeURIComponent(targetProject)}/chains/import`,
      payload: { libraryChainId: template.id },
    });
    expect(importResponse.statusCode).toBe(201);
    const imported = chainOf(importResponse.json<unknown>());
    expect(imported.id).not.toBe(template.id);
    expect(imported.steps).toEqual(template.steps);
    expect(imported.inputs).toEqual(template.inputs);
    expect(imported.agent).toEqual(template.agent);

    const targetList = await app.inject({
      method: 'GET',
      url: `/api/projects/${encodeURIComponent(targetProject)}/chains`,
    });
    expect(targetList.statusCode).toBe(200);
    expect(
      targetList.json<{ chains: Chain[] }>().chains.map((chain) => chain.id),
    ).toEqual([imported.id]);
  });

  it('resolves template name collisions and leaves copies independent', async () => {
    const app = await buildTestApp();
    const sourceProject = await registerProject(app, 'collision-project');
    const targetProject = await registerProject(app, 'collision-target');
    const source = await createChain(app, sourceProject);

    const first = chainOf(
      (
        await app.inject({
          method: 'POST',
          url: '/api/chains',
          payload: { projectId: sourceProject, chainId: source.id },
        })
      ).json<unknown>(),
    );
    const second = chainOf(
      (
        await app.inject({
          method: 'POST',
          url: '/api/chains',
          payload: { projectId: sourceProject, chainId: source.id },
        })
      ).json<unknown>(),
    );
    expect(second.id).not.toBe(first.id);
    expect(second.name).not.toBe(first.name);

    const imported = chainOf(
      (
        await app.inject({
          method: 'POST',
          url: `/api/projects/${encodeURIComponent(targetProject)}/chains/import`,
          payload: { libraryChainId: first.id },
        })
      ).json<unknown>(),
    );

    // Importing a second copy into the same project also resolves its name.
    const importedAgain = chainOf(
      (
        await app.inject({
          method: 'POST',
          url: `/api/projects/${encodeURIComponent(targetProject)}/chains/import`,
          payload: { libraryChainId: first.id },
        })
      ).json<unknown>(),
    );
    expect(importedAgain.id).not.toBe(imported.id);
    expect(importedAgain.name).not.toBe(imported.name);
  });

  it('deletes a template without touching project chains', async () => {
    const app = await buildTestApp();
    const projectId = await registerProject(app, 'delete-project');
    const source = await createChain(app, projectId);
    const template = chainOf(
      (
        await app.inject({
          method: 'POST',
          url: '/api/chains',
          payload: { projectId, chainId: source.id },
        })
      ).json<unknown>(),
    );

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/chains/${encodeURIComponent(template.id)}`,
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ chainId: template.id, deleted: true });

    const projectChain = await app.inject({
      method: 'GET',
      url: `/api/projects/${encodeURIComponent(projectId)}/chains/${encodeURIComponent(source.id)}`,
    });
    expect(projectChain.statusCode).toBe(200);
  });

  it('rejects unknown and unsafe template ids with typed errors', async () => {
    const app = await buildTestApp();
    const projectId = await registerProject(app, 'error-project');

    const unknown = await app.inject({
      method: 'POST',
      url: `/api/projects/${encodeURIComponent(projectId)}/chains/import`,
      payload: { libraryChainId: 'missing-template' },
    });
    expect(unknown.statusCode).toBe(404);
    expect(isApiErrorEnvelope(unknown.json())).toBe(true);

    const unsafe = await app.inject({
      method: 'POST',
      url: `/api/projects/${encodeURIComponent(projectId)}/chains/import`,
      payload: { libraryChainId: '../escape' },
    });
    expect(unsafe.statusCode).toBe(422);
    expect(isApiErrorEnvelope(unsafe.json())).toBe(true);

    const missingDelete = await app.inject({
      method: 'DELETE',
      url: '/api/chains/missing-template',
    });
    expect(missingDelete.statusCode).toBe(404);
  });

  it('rejects a save request for an unregistered project', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/chains',
      payload: {
        projectId: 'missing-000000000000',
        chainId: 'missing-chain',
      },
    });
    expect(response.statusCode).toBe(404);
    expect(isApiErrorEnvelope(response.json())).toBe(true);
  });
});
