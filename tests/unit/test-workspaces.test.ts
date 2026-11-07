import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CatalogService } from '../../src/server/catalog/merge.js';
import { createConfigStore } from '../../src/server/config/store.js';
import { createChainService } from '../../src/server/chains/service.js';
import { createProjectRegistry } from '../../src/server/projects/registry.js';
import {
  activeRunPathFor,
  ACTIVE_RUN_POINTER_VERSION,
} from '../../src/server/runs/store.js';
import {
  createTestWorkspaceService,
  TEST_WORKSPACE_ERROR_CODES,
} from '../../src/server/runs/test-workspaces.js';

let root: string;

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

async function setup() {
  root = await mkdtemp(join(tmpdir(), 'loom-test-workspace-'));
  const configDirectory = join(root, 'config');
  const projectPath = join(root, 'source-project');
  await mkdir(projectPath);
  const configStore = createConfigStore({
    env: { LOOM_CONFIG_DIR: configDirectory },
    homeDirectory: () => join(root, 'home'),
  });
  const projectRegistry = createProjectRegistry({ configStore });
  const source = await projectRegistry.openProject(projectPath);
  const chainService = createChainService();
  const chain = await chainService.create(source.canonicalPath, {
    name: 'Disposable test',
    harness: 'opencode',
    sessionMode: 'fresh',
    steps: [{ id: 'step-1', kind: 'instruction', instruction: 'Write a result file.' }],
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
  const service = createTestWorkspaceService({
    configStore,
    projectRegistry,
    chainService,
    catalogService,
    now: () => new Date('2026-01-02T03:04:05.000Z'),
  });
  return { configDirectory, configStore, projectRegistry, source, chain, chainService, service };
}

describe('managed test workspaces', () => {
  it('creates a hidden, self-contained project copy and removes only that workspace', async () => {
    const { configStore, projectRegistry, source, chain, chainService, service } = await setup();

    const workspace = await service.create({
      sourceProjectId: source.id,
      sourceChainId: chain.id,
    });

    expect(workspace.path).not.toBe(source.canonicalPath);
    expect((await projectRegistry.listRecentProjects()).map(({ id }) => id)).toEqual([source.id]);
    expect((await projectRegistry.listKnownProjects()).map(({ id }) => id)).toContain(
      workspace.projectId,
    );
    const copiedChain = await chainService.get(workspace.path, workspace.chainId);
    expect(copiedChain.name).toBe(chain.name);
    expect(copiedChain.steps).toEqual(chain.steps);
    expect((await service.list())).toEqual([workspace]);

    await service.remove(workspace.id);

    expect(await service.list()).toEqual([]);
    expect((await projectRegistry.findRecentProject(workspace.projectId))).toBeUndefined();
    expect(await readFile(join(source.canonicalPath, '.loom', 'chains', `${chain.id}.json`), 'utf8'))
      .toContain('"name": "Disposable test"');
    expect((await configStore.get()).testWorkspaces).toEqual([]);
  });

  it('refuses cleanup while the managed project owns the active run pointer', async () => {
    const { configDirectory, source, chain, service } = await setup();
    const workspace = await service.create({
      sourceProjectId: source.id,
      sourceChainId: chain.id,
    });

    await writeFile(activeRunPathFor(configDirectory), `${JSON.stringify({
      version: ACTIVE_RUN_POINTER_VERSION,
      runId: 'run-test',
      projectId: workspace.projectId,
      projectPath: workspace.path,
      status: 'running',
      startedAt: '2026-01-02T03:04:05.000Z',
      updatedAt: '2026-01-02T03:04:05.000Z',
    })}\n`);

    await expect(service.remove(workspace.id)).rejects.toMatchObject({
      code: TEST_WORKSPACE_ERROR_CODES.ACTIVE,
    });
    expect((await service.list()).some(({ id }) => id === workspace.id)).toBe(true);
  });

  it('rejects a managed workspace as the source for another workspace', async () => {
    const { source, chain, service } = await setup();
    const workspace = await service.create({
      sourceProjectId: source.id,
      sourceChainId: chain.id,
    });

    await expect(service.create({
      sourceProjectId: workspace.projectId,
      sourceChainId: workspace.chainId,
    })).rejects.toMatchObject({
      code: TEST_WORKSPACE_ERROR_CODES.SOURCE_INVALID,
    });
  });

  it('copies the exact installed native-agent bytes into a test workspace', async () => {
    const { source, chain, chainService, service } = await setup();
    const agentText = '---\nname: reviewer\ndescription: Review\n---\nReview the task.\n';
    const agentPath = 'reviewer.md';
    const sourceAgentPath = join(source.canonicalPath, '.opencode', 'agents', agentPath);
    await mkdir(join(source.canonicalPath, '.opencode', 'agents'), { recursive: true });
    await writeFile(sourceAgentPath, agentText);
    const agent = {
      harness: 'opencode' as const,
      name: 'reviewer',
      sourceId: 'source',
      revision: 'a'.repeat(40),
      repositoryPath: '.opencode/agents/reviewer.md',
      agentPath,
      fingerprint: createHash('sha256').update(agentText).digest('hex'),
    };
    const selectedChain = await chainService.update(source.canonicalPath, chain.id, {
      name: chain.name,
      harness: chain.harness,
      sessionMode: chain.sessionMode,
      steps: chain.steps,
      inputs: chain.inputs,
      agent,
    });

    const workspace = await service.create({
      sourceProjectId: source.id,
      sourceChainId: selectedChain.id,
    });

    expect(await readFile(join(workspace.path, '.opencode', 'agents', agentPath), 'utf8'))
      .toBe(agentText);
    expect((await chainService.get(workspace.path, workspace.chainId)).agent).toEqual(agent);
  });
});
