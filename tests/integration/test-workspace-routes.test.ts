import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChainBundle } from '../../src/shared/bundles.js';
import type { CatalogService } from '../../src/server/catalog/merge.js';
import type { SkillEntry } from '../../src/server/catalog/types.js';
import type { Chain } from '../../src/server/chains/model.js';
import { exportBundle } from '../../src/server/chains/bundle.js';
import { readDraftBundle } from '../../src/server/chains/draft-bundles.js';
import { createChainService } from '../../src/server/chains/service.js';
import { createGlobalDraftService } from '../../src/server/chains/drafts.js';
import { createConfigStore } from '../../src/server/config/store.js';
import { createProjectRegistry } from '../../src/server/projects/registry.js';
import { sharedBundleRoutes } from '../../src/server/routes/shared-bundles.js';
import { testWorkspaceRoutes } from '../../src/server/routes/test-workspaces.js';
import { draftRoutes } from '../../src/server/routes/drafts.js';

let root: string;

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

describe('test-workspace routes', () => {
  it('creates a goal-driven workspace, reviews a staged proposal, and freezes it as a global draft', async () => {
    root = await mkdtemp(join(tmpdir(), 'loom-discovery-workspace-route-'));
    const configDirectory = join(root, 'config');
    const sharedDirectory = join(root, 'shared');
    await mkdir(sharedDirectory);
    const configStore = createConfigStore({
      env: { LOOM_CONFIG_DIR: configDirectory },
      homeDirectory: () => join(root, 'home'),
    });
    const packagePath = join(root, 'remote', 'goal-planning');
    await mkdir(packagePath, { recursive: true });
    const skillText = '---\nname: goal-planning\ndescription: Plans a goal.\n---\nReview the goal.\n';
    await writeFile(join(packagePath, 'SKILL.md'), skillText);
    const remoteSkill: SkillEntry = {
      id: 'remote-goal-planning',
      harness: 'copilot',
      source: 'remote',
      name: 'goal-planning',
      description: 'Plans a goal.',
      path: join(packagePath, 'SKILL.md'),
      packagePath,
      sourceId: 'goal-source',
      repository: 'example/skills',
      revision: 'a'.repeat(40),
      repositoryPath: 'skills/goal-planning',
      enabled: true,
    };
    const catalogService: CatalogService = {
      defaultHarness: 'opencode',
      async getCatalog({ projectPath, harness }) {
        let entries: SkillEntry[] = [];
        if (projectPath === configDirectory) {
          entries = [remoteSkill];
        } else {
          const stagedPackage = join(projectPath, '.agents', 'skills', 'goal-planning');
          try {
            await readFile(join(stagedPackage, 'SKILL.md'), 'utf8');
            entries = [{
              ...remoteSkill,
              id: 'project-goal-planning',
              source: 'project',
              path: join(stagedPackage, 'SKILL.md'),
              packagePath: stagedPackage,
            }];
          } catch {
            entries = [];
          }
        }
        const bySource = {
          project: 0, personal: 0, custom: 0, plugin: 0, builtin: 0,
          'loom-extra': 0, remote: 0,
        };
        for (const entry of entries) bySource[entry.source] += 1;
        const groups = [...new Set(entries.map((entry) => entry.source))].map((source) => ({
          source,
          entries: entries.filter((entry) => entry.source === source),
          count: entries.filter((entry) => entry.source === source).length,
        }));
        return {
          harness,
          query: '',
          total: entries.length,
          counts: { total: entries.length, bySource },
          groups,
          agents: [],
          warnings: [],
          elapsedMs: 0,
        };
      },
    };
    const chainService = createChainService();
    const app = Fastify({ logger: false });
    await app.register(testWorkspaceRoutes, { configStore, catalogService, chainService });
    await app.register(draftRoutes, { configStore, catalogService });
    await app.register(sharedBundleRoutes, { configStore, catalogService });
    const configuredLibrary = await app.inject({
      method: 'PUT',
      url: '/api/shared-bundles/config',
      payload: { directory: sharedDirectory },
    });
    expect(configuredLibrary.statusCode).toBe(200);

    const create = await app.inject({
      method: 'POST',
      url: '/api/test-workspaces/discovery',
      payload: {
        goal: 'Create a release checklist.',
        harness: 'copilot',
        skillIds: [remoteSkill.id],
      },
    });
    expect(create.statusCode).toBe(201);
    const workspace = create.json<{ workspace: { id: string; path: string; projectId: string } }>().workspace;
    expect(await readFile(
      join(workspace.path, '.agents', 'skills', 'goal-planning', 'SKILL.md'),
      'utf8',
    )).toBe(skillText);

    const proposalChain = await chainService.create(workspace.path, {
      name: 'Release checklist',
      harness: 'copilot',
      sessionMode: 'shared',
      steps: [{
        id: 'plan-release',
        skillName: 'goal-planning',
        instruction: 'Create a release checklist for the goal.',
      }],
      inputs: [],
    });
    const bundle = await exportBundle(proposalChain, workspace.path, catalogService);
    const proposalPath = join(workspace.path, '.loom', 'scenario-proposal.loom.json');
    await writeFile(proposalPath, JSON.stringify(bundle));

    const preview = await app.inject({
      method: 'GET',
      url: `/api/test-workspaces/${workspace.id}/proposal`,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      proposal: { name: 'Release checklist', skills: [{ name: 'goal-planning', files: 1 }] },
    });

    const accepted = await app.inject({
      method: 'POST',
      url: `/api/test-workspaces/${workspace.id}/proposal/accept`,
      payload: { name: 'Approved release checklist' },
    });
    expect(accepted.statusCode).toBe(201);
    const draftId = accepted.json<{ chain: { id: string; name: string } }>().chain.id;
    const reviewed = await app.inject({
      method: 'GET',
      url: `/api/drafts/${draftId}/bundle`,
    });
    expect(reviewed.statusCode, reviewed.body).toBe(200);
    const reviewedBundle = reviewed.json<{ bundle: ChainBundle }>().bundle;
    const reviewFingerprint = createHash('sha256')
      .update(JSON.stringify(reviewedBundle), 'utf8')
      .digest('hex');
    const published = await app.inject({
      method: 'POST',
      url: '/api/shared-bundles/publish',
      payload: {
        source: { type: 'draft', draftId },
        displayName: reviewedBundle.chain.name,
        contentsReviewed: true,
        redistributionReviewed: true,
        reviewFingerprint,
      },
    });
    expect(published.statusCode, published.body).toBe(201);

    const updatedDraft = await app.inject({
      method: 'PUT',
      url: `/api/drafts/${draftId}`,
      payload: {
        name: 'Edited approved checklist',
        harness: 'copilot',
        sessionMode: 'shared',
        steps: [{
          id: 'plan-release',
          skillName: 'goal-planning',
          instruction: 'Create a checklist with owner and due date.',
        }],
        inputs: [{ name: 'scope', required: true, defaultValue: 'release readiness' }],
      },
    });
    expect(updatedDraft.statusCode, updatedDraft.body).toBe(200);
    const updatedReview = await app.inject({
      method: 'GET',
      url: `/api/drafts/${draftId}/bundle`,
    });
    expect(updatedReview.statusCode, updatedReview.body).toBe(200);
    const updatedBundle = updatedReview.json<{ bundle: ChainBundle }>().bundle;
    const updatedChain = updatedDraft.json<{ chain: Chain }>().chain;
    const regeneratedBundle = await exportBundle(updatedChain, configDirectory, catalogService);
    expect(updatedBundle).toEqual(regeneratedBundle);
    const updatedFingerprint = createHash('sha256')
      .update(JSON.stringify(updatedBundle), 'utf8')
      .digest('hex');
    const publishedUpdatedDraft = await app.inject({
      method: 'POST',
      url: '/api/shared-bundles/publish',
      payload: {
        source: { type: 'draft', draftId },
        displayName: updatedBundle.chain.name,
        contentsReviewed: true,
        redistributionReviewed: true,
        reviewFingerprint: updatedFingerprint,
      },
    });
    expect(publishedUpdatedDraft.statusCode, publishedUpdatedDraft.body).toBe(201);
    const frozenBundle = await readDraftBundle(configDirectory, draftId);
    expect(frozenBundle?.chain.name).toBe('Edited approved checklist');
    expect(frozenBundle?.chain.inputs).toEqual([{ name: 'scope', required: true }]);
    expect(frozenBundle?.skills[0]?.name).toBe('goal-planning');
    const unavailablePackage = await app.inject({
      method: 'PUT',
      url: `/api/drafts/${draftId}`,
      payload: {
        name: 'Edited approved checklist',
        harness: 'copilot',
        sessionMode: 'shared',
        steps: [{
          id: 'new-skill',
          skillName: 'not-staged',
          instruction: 'Use another package.',
        }],
        inputs: [],
      },
    });
    expect(unavailablePackage.statusCode).toBe(409);
    expect(unavailablePackage.json()).toMatchObject({
      error: { code: 'DRAFT_PACKAGE_SET_FIXED' },
    });

    const cleanup = await app.inject({
      method: 'DELETE',
      url: `/api/test-workspaces/${workspace.id}`,
    });
    expect(cleanup.statusCode).toBe(200);
    const testCopy = await app.inject({
      method: 'POST',
      url: '/api/test-workspaces',
      payload: { sourceDraftId: draftId },
    });
    expect(testCopy.statusCode).toBe(201);
    const copyPath = testCopy.json<{ workspace: { path: string } }>().workspace.path;
    expect(await readFile(
      join(copyPath, '.agents', 'skills', 'goal-planning', 'SKILL.md'),
      'utf8',
    )).toBe(skillText);

    await app.close();
  });

  it('creates a disposable workspace directly from a project-independent draft', async () => {
    root = await mkdtemp(join(tmpdir(), 'loom-draft-workspace-'));
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
    root = await mkdtemp(join(tmpdir(), 'loom-workspace-routes-'));
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
    root = await mkdtemp(join(tmpdir(), 'loom-workspace-routes-invalid-'));
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
