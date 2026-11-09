import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CatalogService } from '../../src/server/catalog/merge.js';
import type { SkillEntry } from '../../src/server/catalog/types.js';
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
import { withWorkspaceLifecycleLock } from '../../src/server/runs/workspace-lock.js';
import { executePortableRequest } from '../../src/portable/runtime.js';
import { withProjectClaimTransaction, withProjectRetirementTransaction } from '../../src/shared/project-claim.js';
import { clearReviewedProjectClaim, enableReviewedProjectProtocol, reviewProjectCoordination } from '../../src/shared/project-coordination.js';

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
  return {
    configDirectory,
    configStore,
    projectRegistry,
    source,
    chain,
    chainService,
    catalogService,
    service,
  };
}

describe('managed test workspaces', () => {
  it.each(['legacy', 'enabled'] as const)('refuses removal of portable work and retained claims in %s mode', async (mode) => {
    const { source, chain, service } = await setup();
    const workspace = await service.create({ sourceProjectId: source.id, sourceChainId: chain.id });
    if (mode === 'enabled') {
      const review = await reviewProjectCoordination(workspace.path);
      await enableReviewedProjectProtocol(workspace.path, review.reviewDigest, true);
    }
    const bundlePath = join(root, 'portable.loom.json');
    await writeFile(bundlePath, JSON.stringify({
      format: 'skill-loom-chain', version: 1,
      chain: {
        name: 'Portable test', harness: 'opencode', sessionMode: 'shared',
        steps: [{ id: 'one', kind: 'instruction', instruction: 'Review.' }], inputs: [],
      },
      skills: [],
    }));
    const inspect = await executePortableRequest({ command: 'inspect', projectPath: workspace.path, bundlePath }) as { reviewDigest: string };
    const prepared = await executePortableRequest({
      command: 'prepare', projectPath: workspace.path, bundlePath,
      input: {
        reviewDigest: inspect.reviewDigest, installConfirmed: true, actualHost: 'opencode',
        progression: 'supervised', inputs: {},
        sessionDecision: {
          requested: 'shared', mechanism: 'current-conversation', description: 'Current conversation.', confirmed: true,
        },
      },
    }) as { runId: string; revision: number };
    await expect(service.remove(workspace.id)).rejects.toMatchObject({ code: TEST_WORKSPACE_ERROR_CODES.ACTIVE });
    await executePortableRequest({
      command: 'record', projectPath: workspace.path, runId: prepared.runId,
      input: { revision: prepared.revision, action: 'abort' },
    });
    if (mode === 'enabled') {
      await expect(service.remove(workspace.id)).rejects.toMatchObject({ code: TEST_WORKSPACE_ERROR_CODES.ACTIVE });
      const review = await reviewProjectCoordination(workspace.path);
      await clearReviewedProjectClaim(workspace.path, review.reviewDigest, true, true);
    }
    await expect(service.remove(workspace.id)).resolves.toEqual({ id: workspace.id, removed: true });
  });

  it('resumes removal after retirement or an interrupted rename', async () => {
    const { source, chain, service } = await setup();
    for (const move of [false, true]) {
      const workspace = await service.create({ sourceProjectId: source.id, sourceChainId: chain.id });
      await withProjectRetirementTransaction(workspace.path, async (tx) => tx.retire('2026-01-02T00:00:00.000Z'));
      await expect(reviewProjectCoordination(workspace.path)).rejects.toMatchObject({ code: 'PROJECT_CLAIM_RETIRED' });
      if (move) await rename(workspace.path, join(workspace.path, '..', `.retired-${workspace.id}`));
      await expect(service.remove(workspace.id)).resolves.toEqual({ id: workspace.id, removed: true });
    }
  });

  it('does not remove an unverified directory occupying a retired workspace path', async () => {
    const { source, chain, service } = await setup();
    const workspace = await service.create({ sourceProjectId: source.id, sourceChainId: chain.id });
    const retiredPath = join(workspace.path, '..', `.retired-${workspace.id}`);
    await mkdir(retiredPath);
    await writeFile(join(retiredPath, 'keep.txt'), 'Unrelated data.');
    await expect(service.remove(workspace.id)).rejects.toMatchObject({ code: TEST_WORKSPACE_ERROR_CODES.CLEANUP_FAILED });
    expect(await readFile(join(retiredPath, 'keep.txt'), 'utf8')).toBe('Unrelated data.');
    expect((await service.list())).toContainEqual(workspace);
  });

  it('serializes retirement behind an in-flight project claim', async () => {
    const { source, chain, service } = await setup();
    const workspace = await service.create({ sourceProjectId: source.id, sourceChainId: chain.id });
    const review = await reviewProjectCoordination(workspace.path);
    await enableReviewedProjectProtocol(workspace.path, review.reviewDigest, true);
    let entered!: () => void;
    let release!: () => void;
    const locked = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const operation = withProjectClaimTransaction(workspace.path, async (tx) => {
      entered();
      await gate;
      tx.acquire({
        version: 1, ...tx.identity, kind: 'managed', runId: 'run-competing',
        createdAt: '2026-01-02T00:00:00.000Z',
      });
    });
    await locked;
    const removal = service.remove(workspace.id);
    release();
    await operation;
    await expect(removal).rejects.toMatchObject({ code: TEST_WORKSPACE_ERROR_CODES.ACTIVE });
    expect((await reviewProjectCoordination(workspace.path)).claim).toMatchObject({ runId: 'run-competing' });
  });

  it('blocks a separate helper during and after workspace retirement', async () => {
    const { source, chain, service } = await setup();
    const workspace = await service.create({ sourceProjectId: source.id, sourceChainId: chain.id });
    const bundlePath = join(root, 'retirement.loom.json');
    await writeFile(bundlePath, JSON.stringify({
      format: 'skill-loom-chain', version: 1,
      chain: {
        name: 'Portable test', harness: 'opencode', sessionMode: 'shared',
        steps: [{ id: 'one', kind: 'instruction', instruction: 'Review.' }], inputs: [],
      },
      skills: [],
    }));
    const inspected = await executePortableRequest({
      command: 'inspect', projectPath: workspace.path, bundlePath,
    }) as { reviewDigest: string };
    const payload = JSON.stringify({
      reviewDigest: inspected.reviewDigest, installConfirmed: true, actualHost: 'opencode',
      progression: 'supervised', inputs: {},
      sessionDecision: {
        requested: 'shared', mechanism: 'current-conversation', description: 'Current conversation.', confirmed: true,
      },
    });
    const prepare = () => new Promise<{ code: number | null; error: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [
        '--disable-warning=ExperimentalWarning',
        join(process.cwd(), '.github', 'skills', 'loom-run-bundle', 'scripts', 'loom-bundle.mjs'),
        'prepare', '--project', workspace.path, '--bundle', bundlePath,
      ], { stdio: ['pipe', 'pipe', 'pipe'] });
      let error = '';
      child.stderr.on('data', (chunk: Buffer) => { error += chunk.toString(); });
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, error }));
      child.stdin.end(payload);
    });
    await withProjectRetirementTransaction(workspace.path, async (tx) => {
      const busy = await prepare();
      expect(busy.code).toBe(1);
      expect(JSON.parse(busy.error)).toMatchObject({ error: { code: 'PROJECT_CLAIM_BUSY' } });
      tx.retire('2026-01-02T00:00:00.000Z');
    });
    const retired = await prepare();
    expect(retired.code).toBe(1);
    expect(JSON.parse(retired.error)).toMatchObject({ error: { code: 'PROJECT_CLAIM_RETIRED' } });
    await expect(service.remove(workspace.id)).resolves.toEqual({ id: workspace.id, removed: true });
  });

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

  it('creates a self-contained workspace when a remote catalog skill has the same name', async () => {
    const { source, chain, chainService, catalogService, service } = await setup();
    const skillName = 'better-accessibility';
    const skillText = `---\nname: ${skillName}\ndescription: Accessibility guidance\n---\nUse accessible patterns.\n`;
    const projectPackage = join(source.canonicalPath, '.agents', 'skills', skillName);
    const remotePackage = join(root, 'remote', skillName);
    await mkdir(projectPackage, { recursive: true });
    await mkdir(remotePackage, { recursive: true });
    await writeFile(join(projectPackage, 'SKILL.md'), skillText);
    await writeFile(join(remotePackage, 'SKILL.md'), skillText);

    const projectSkill: SkillEntry = {
      id: 'copilot-project-better-accessibility',
      harness: 'copilot',
      source: 'project',
      name: skillName,
      description: 'Accessibility guidance',
      path: join(projectPackage, 'SKILL.md'),
      packagePath: projectPackage,
      enabled: true,
    };
    const remoteSkill: SkillEntry = {
      id: 'copilot-remote-better-accessibility',
      harness: 'copilot',
      source: 'remote',
      name: skillName,
      description: 'Accessibility guidance',
      path: join(remotePackage, 'SKILL.md'),
      packagePath: remotePackage,
      sourceId: 'remote-source',
      repository: 'example/skills',
      revision: 'a'.repeat(40),
      repositoryPath: `skills/${skillName}`,
      enabled: true,
    };
    catalogService.getCatalog = async ({ projectPath, harness }) => {
      const entries =
        projectPath === source.canonicalPath
          ? [projectSkill, remoteSkill]
          : [remoteSkill];
      const bySource = {
        project: 0,
        personal: 0,
        custom: 0,
        plugin: 0,
        builtin: 0,
        'loom-extra': 0,
        remote: 0,
      };
      for (const entry of entries) bySource[entry.source] += 1;
      const sources = [...new Set(entries.map(({ source: entrySource }) => entrySource))];
      return {
        harness,
        query: '',
        total: entries.length,
        counts: { total: entries.length, bySource },
        groups: sources.map((entrySource) => {
          const groupEntries = entries.filter(({ source: sourceLabel }) => sourceLabel === entrySource);
          return { source: entrySource, count: groupEntries.length, entries: groupEntries };
        }),
        agents: [],
        warnings: [],
        elapsedMs: 0,
      };
    };
    const skillChain = await chainService.update(source.canonicalPath, chain.id, {
      name: chain.name,
      harness: 'copilot',
      sessionMode: chain.sessionMode,
      steps: [{ id: 'step-1', skillName, instruction: 'Apply the selected skill.' }],
      inputs: [],
    });

    const workspace = await service.create({
      sourceProjectId: source.id,
      sourceChainId: skillChain.id,
    });

    expect(await readFile(join(workspace.path, '.agents', 'skills', skillName, 'SKILL.md'), 'utf8'))
      .toBe(skillText);
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

  it('waits for a concurrent run claim before checking whether cleanup is safe', async () => {
    const { configDirectory, source, chain, service } = await setup();
    const workspace = await service.create({ sourceProjectId: source.id, sourceChainId: chain.id });
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const locked = new Promise<void>((resolve) => { entered = resolve; });
    const claim = withWorkspaceLifecycleLock(workspace.projectId, async () => {
      entered();
      await gate;
      await writeFile(activeRunPathFor(configDirectory), `${JSON.stringify({
        version: ACTIVE_RUN_POINTER_VERSION, runId: 'run-test', projectId: workspace.projectId,
        projectPath: workspace.path, status: 'running',
        startedAt: '2026-01-02T03:04:05.000Z', updatedAt: '2026-01-02T03:04:05.000Z',
      })}\n`);
    });
    await locked;
    const removal = service.remove(workspace.id);
    release();
    await claim;
    await expect(removal).rejects.toMatchObject({ code: TEST_WORKSPACE_ERROR_CODES.ACTIVE });
    expect(await service.list()).toContainEqual(workspace);
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
