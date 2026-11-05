import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { createConfigStore } from '../../src/server/config/store.js';
import type { ScenarioCatalog } from '../../src/shared/presets.js';

let root: string;
let configDirectory: string;
let apps: FastifyInstance[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loom-scenario-presets-'));
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

describe('scenario preset routes', () => {
  it('lists bundled examples without creating user state or contacting a registry', async () => {
    const app = await buildTestApp();
    expect(existsSync(configDirectory)).toBe(false);

    const first = await app.inject({ method: 'GET', url: '/api/chain-presets' });
    const second = await app.inject({ method: 'GET', url: '/api/chain-presets' });

    expect(first.statusCode).toBe(200);
    expect(first.json<ScenarioCatalog>().scenarios).toHaveLength(12);
    expect(second.json()).toEqual(first.json());
    expect(existsSync(configDirectory)).toBe(false);
  });

  it('copies a selected example as an ordinary editable project chain', async () => {
    const app = await buildTestApp();
    const projectPath = join(root, 'workspace', 'demo-project');
    await mkdir(projectPath, { recursive: true });
    const opened = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { mode: 'open', path: projectPath },
    });
    expect(opened.statusCode).toBe(200);
    const projectId = opened.json<{ project: { id: string } }>().project.id;

    const catalogResponse = await app.inject({
      method: 'GET',
      url: '/api/chain-presets',
    });
    const catalog = catalogResponse.json<ScenarioCatalog>();
    const example = catalog.scenarios.find(
      (scenario) => scenario.id === 'app-mvp',
    );
    expect(example).toBeDefined();
    const variant = example!.variants.find((candidate) => candidate.id === 'fastapi');
    expect(variant).toBeDefined();

    const payload = {
      name: `${example!.name} - ${variant!.name}`,
      harness: 'opencode',
      sessionMode: 'shared',
      steps: variant!.steps,
      inputs: variant!.inputs,
      automaticPermissionOptIn: false,
    };
    const first = await app.inject({
      method: 'POST',
      url: `/api/projects/${encodeURIComponent(projectId)}/chains`,
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: `/api/projects/${encodeURIComponent(projectId)}/chains`,
      payload,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const firstChain = first.json<{ chain: { id: string; harness: string; sessionMode: string; steps: unknown[]; automaticPermissionOptIn: boolean } }>().chain;
    const secondChain = second.json<{ chain: { id: string } }>().chain;
    expect(firstChain).toMatchObject({
      harness: 'opencode',
      sessionMode: 'shared',
      steps: variant!.steps,
      automaticPermissionOptIn: false,
    });
    expect(secondChain.id).not.toBe(firstChain.id);
  });

  it('copies a bundled skill only on request and verifies project discovery', async () => {
    const app = await buildTestApp();
    const projectPath = join(root, 'workspace', 'skill-project');
    await mkdir(projectPath, { recursive: true });
    const opened = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { mode: 'open', path: projectPath },
    });
    expect(opened.statusCode).toBe(200);
    const projectId = opened.json<{ project: { id: string } }>().project.id;
    const url = `/api/projects/${encodeURIComponent(projectId)}/catalog/scenario-skills/minimax-xlsx/copy`;

    const copied = await app.inject({
      method: 'POST',
      url,
      payload: { harness: 'opencode' },
    });
    expect(copied.statusCode).toBe(201);
    const result = copied.json<{
      name: string;
      harness: string;
      destinationPath: string;
      revision: string;
      catalogSkillId: string;
    }>();
    expect(result).toMatchObject({
      name: 'minimax-xlsx',
      harness: 'opencode',
      revision: '60aaae52bb2af8162732751a4332f62a5fef518b',
    });
    expect(result.catalogSkillId).not.toBe('');
    expect(
      await readFile(join(result.destinationPath, 'SKILL-LOOM-SOURCE.md'), 'utf8'),
    ).toContain(result.revision);

    const catalog = await app.inject({
      method: 'GET',
      url: `/api/projects/${encodeURIComponent(projectId)}/catalog?harness=opencode`,
    });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().groups).toContainEqual(
      expect.objectContaining({
        source: 'project',
        entries: expect.arrayContaining([
          expect.objectContaining({
            name: 'minimax-xlsx',
            enabled: true,
          }),
        ]),
      }),
    );

    const duplicate = await app.inject({ method: 'POST', url, payload: { harness: 'opencode' } });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({
      error: {
        code: 'SCENARIO_SKILL_ALREADY_AVAILABLE',
      },
    });
    expect(existsSync(`${result.destinationPath}-2`)).toBe(false);
  });
});
