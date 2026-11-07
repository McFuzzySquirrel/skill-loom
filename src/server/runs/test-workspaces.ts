import { randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ChainAgentSelection } from '../../shared/chain.js';
import { copySkillIntoProject } from '../catalog/copy.js';
import {
  copyNativeAgentIntoProject,
  inspectInstalledNativeAgent,
  installedNativeAgentPath,
} from '../catalog/agent-copy.js';
import type { CatalogService } from '../catalog/merge.js';
import type { SkillEntry, SkillHarness } from '../catalog/types.js';
import { scenarioDiscoverySkillPackagePath } from '../chains/discovery-skill.js';
import type { Chain } from '../chains/model.js';
import type { ChainService } from '../chains/service.js';
import type { ConfigStore } from '../config/store.js';
import type { TestWorkspaceRecord } from '../config/schema.js';
import type { ProjectRegistry } from '../projects/registry.js';
import { readActiveRunPointerFile } from './store.js';
import { exportBundle, importBundle } from '../chains/bundle.js';
import { draftBundleMatchesChain, readDraftBundle } from '../chains/draft-bundles.js';

const WORKSPACE_DIRECTORY = 'test-workspaces';

export const TEST_WORKSPACE_ERROR_CODES = {
  SOURCE_NOT_FOUND: 'TEST_WORKSPACE_SOURCE_NOT_FOUND',
  SOURCE_INVALID: 'TEST_WORKSPACE_SOURCE_INVALID',
  DISCOVERY_SELECTION_INVALID: 'TEST_WORKSPACE_DISCOVERY_SELECTION_INVALID',
  NOT_FOUND: 'TEST_WORKSPACE_NOT_FOUND',
  ACTIVE: 'TEST_WORKSPACE_ACTIVE',
  PATH_INVALID: 'TEST_WORKSPACE_PATH_INVALID',
  CREATE_FAILED: 'TEST_WORKSPACE_CREATE_FAILED',
  CLEANUP_FAILED: 'TEST_WORKSPACE_CLEANUP_FAILED',
} as const;

export type TestWorkspaceErrorCode =
  (typeof TEST_WORKSPACE_ERROR_CODES)[keyof typeof TEST_WORKSPACE_ERROR_CODES];

export class TestWorkspaceError extends Error {
  constructor(
    readonly code: TestWorkspaceErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
  }
}

export interface TestWorkspace extends TestWorkspaceRecord {
  path: string;
}

export interface TestWorkspaceService {
  create(
    input:
      | { sourceProjectId: string; sourceChainId: string }
      | { sourceDraftId: string },
  ): Promise<TestWorkspace>;
  createDiscovery(input: CreateDiscoveryWorkspaceInput): Promise<TestWorkspace>;
  list(): Promise<TestWorkspace[]>;
  remove(id: string): Promise<{ id: string; removed: true }>;
}

export interface CreateDiscoveryWorkspaceInput {
  goal: string;
  harness: SkillHarness;
  skillIds: string[];
  sourceProjectId?: string;
}

export interface TestWorkspaceServiceOptions {
  configStore: ConfigStore;
  projectRegistry: ProjectRegistry;
  chainService: ChainService;
  draftService?: ChainService;
  getDraftService?: () => ChainService;
  catalogService: CatalogService;
  discoverySkillPackagePath?: string;
  now?: () => Date;
}

export function createTestWorkspaceService(
  options: TestWorkspaceServiceOptions,
): TestWorkspaceService {
  return {
    create: (input) => createWorkspace(input, options),
    createDiscovery: (input) => createDiscoveryWorkspace(input, options),
    list: () => listWorkspaces(options),
    remove: (id) => removeWorkspace(id, options),
  };
}

async function createDiscoveryWorkspace(
  input: CreateDiscoveryWorkspaceInput,
  options: TestWorkspaceServiceOptions,
): Promise<TestWorkspace> {
  const goal = input.goal.trim();
  if (
    goal === '' ||
    goal.length > 1_000 ||
    input.skillIds.length === 0 ||
    input.skillIds.length > 20 ||
    new Set(input.skillIds).size !== input.skillIds.length
  ) {
    throw new TestWorkspaceError(
      TEST_WORKSPACE_ERROR_CODES.DISCOVERY_SELECTION_INVALID,
      'Choose a goal and between 1 and 20 distinct skill packages for discovery.',
    );
  }

  const configDirectory = resolve(options.configStore.getConfigDir());
  const catalogs = [await options.catalogService.getCatalog({
    projectPath: configDirectory,
    harness: input.harness,
  })];
  let sourceProjectId: string | undefined;
  if (input.sourceProjectId !== undefined) {
    const sourceProject = await options.projectRegistry.findRecentProject(input.sourceProjectId);
    if (sourceProject === undefined || sourceProject.managedWorkspace === true) {
      throw new TestWorkspaceError(
        TEST_WORKSPACE_ERROR_CODES.SOURCE_NOT_FOUND,
        'The optional source project is no longer available for discovery.',
        { sourceProjectId: input.sourceProjectId },
      );
    }
    sourceProjectId = sourceProject.id;
    catalogs.push(await options.catalogService.getCatalog({
      projectPath: sourceProject.canonicalPath,
      harness: input.harness,
    }));
  }

  const selected: SkillEntry[] = [];
  const names = new Set<string>();
  for (const id of input.skillIds) {
    const matches = [
      ...new Map(catalogs.flatMap((catalog) =>
        catalog.groups.flatMap((group) => group.entries),
      ).filter((entry) => entry.id === id).map((entry) => [entry.id, entry])).values(),
    ];
    if (matches.length !== 1 || matches[0]?.enabled !== true) {
      throw new TestWorkspaceError(
        TEST_WORKSPACE_ERROR_CODES.DISCOVERY_SELECTION_INVALID,
        matches.length === 0
          ? 'A selected package is no longer available in the chosen catalog.'
          : matches.length > 1
            ? 'A selected package id is ambiguous across the chosen catalogs.'
            : 'A selected package is disabled in the chosen catalog.',
        { skillId: id },
      );
    }
    const entry = matches[0]!;
    const key = entry.name.toLocaleLowerCase('en-US');
    if (key === 'scenario-discovery' || names.has(key)) {
      throw new TestWorkspaceError(
        TEST_WORKSPACE_ERROR_CODES.DISCOVERY_SELECTION_INVALID,
        key === 'scenario-discovery'
          ? 'The reserved scenario-discovery package cannot also be selected as a candidate.'
          : `The selected packages contain more than one skill named "${entry.name}". Remove the duplicate before continuing.`,
        { skillName: entry.name },
      );
    }
    names.add(key);
    selected.push(entry);
  }

  const workspaceRoot = await ensureWorkspaceRoot(configDirectory);
  const id = randomUUID();
  const workspacePath = join(workspaceRoot, id);
  let registeredProjectId: string | null = null;
  let workspaceCreated = false;
  try {
    await mkdir(workspacePath, { mode: 0o700 });
    workspaceCreated = true;
    const canonicalWorkspace = await realpath(workspacePath);
    if (canonicalWorkspace !== workspacePath || !isWithin(workspaceRoot, canonicalWorkspace)) {
      throw new TestWorkspaceError(
        TEST_WORKSPACE_ERROR_CODES.PATH_INVALID,
        'The disposable discovery workspace resolved outside its managed root.',
      );
    }

    const registration = await options.projectRegistry.registerManagedWorkspace(canonicalWorkspace);
    registeredProjectId = registration.id;
    for (const entry of selected) {
      await copySkillIntoProject({
        projectPath: canonicalWorkspace,
        harness: input.harness,
        entry,
        allowProjectSource: entry.source === 'project',
      });
    }

    const discoveryPackagePath =
      options.discoverySkillPackagePath ?? scenarioDiscoverySkillPackagePath();
    const discoverySkill: SkillEntry = {
      id: 'loom-managed-scenario-discovery',
      harness: input.harness,
      source: 'builtin',
      name: 'scenario-discovery',
      description: 'Propose user-reviewed workflows from the staged discovery inventory.',
      path: join(discoveryPackagePath, 'SKILL.md'),
      packagePath: discoveryPackagePath,
      enabled: true,
    };
    await copySkillIntoProject({
      projectPath: canonicalWorkspace,
      harness: input.harness,
      entry: discoverySkill,
      allowNameSuffix: false,
    });

    const chain = await options.chainService.create(canonicalWorkspace, {
      name: `Scenario discovery: ${goal.slice(0, 60)}`.trim(),
      harness: input.harness,
      sessionMode: 'shared',
      steps: [{
        id: 'discover-scenarios',
        skillName: 'scenario-discovery',
        label: 'Propose scenarios from reviewed packages',
        instruction: [
          'Use the Skill Loom managed-workspace mode of scenario-discovery.',
          'Use the user-provided goal in the {{goal}} input.',
          'Inspect only skill packages staged in this workspace. Propose, explain, and obtain my confirmation before creating the proposal bundle. Do not execute candidate packages or proposed chains.',
        ].join('\n\n'),
      }],
      inputs: [{
        name: 'goal',
        label: 'Discovery goal',
        required: true,
        defaultValue: goal,
      }],
      automaticPermissionOptIn: false,
    }, { uniqueName: true });

    const record: TestWorkspaceRecord = {
      id,
      projectId: registration.id,
      purpose: 'discovery',
      discoveryGoal: goal,
      ...(sourceProjectId === undefined ? {} : { discoverySourceProjectId: sourceProjectId }),
      discoverySkillNames: selected.map((entry) => entry.name),
      chainId: chain.id,
      createdAt: getTimestamp(options.now),
    };
    await options.configStore.update((current) => ({
      testWorkspaces: [...current.testWorkspaces, record],
    }));
    return { ...record, path: canonicalWorkspace };
  } catch (error) {
    const cleanupOperations: Promise<unknown>[] = [];
    if (registeredProjectId !== null) {
      cleanupOperations.push(options.projectRegistry.removeRecentProject(registeredProjectId));
    }
    if (workspaceCreated) {
      cleanupOperations.push(rm(workspacePath, { recursive: true, force: true }));
    }
    const cleanupResults = await Promise.allSettled(cleanupOperations);
    const cleanupFailures = cleanupResults.filter((result) => result.status === 'rejected');
    if (cleanupFailures.length > 0) {
      throw new TestWorkspaceError(
        TEST_WORKSPACE_ERROR_CODES.CLEANUP_FAILED,
        'The scenario-discovery workspace could not be created and its temporary state could not be fully cleaned up.',
        { cleanupFailureCount: cleanupFailures.length },
        { cause: error },
      );
    }
    if (error instanceof TestWorkspaceError) throw error;
    throw new TestWorkspaceError(
      TEST_WORKSPACE_ERROR_CODES.CREATE_FAILED,
      'The disposable scenario-discovery workspace could not be created.',
      {
        skillCount: selected.length,
        ...(sourceProjectId === undefined ? {} : { sourceProjectId }),
      },
      { cause: error },
    );
  }
}

async function createWorkspace(
  input:
    | { sourceProjectId: string; sourceChainId: string }
    | { sourceDraftId: string },
  options: TestWorkspaceServiceOptions,
): Promise<TestWorkspace> {
  const configDirectory = resolve(options.configStore.getConfigDir());
  const projectSource = 'sourceProjectId' in input;
  let sourceProjectPath = configDirectory;
  let chain: Chain;
  if (projectSource) {
    const source = await options.projectRegistry.findRecentProject(input.sourceProjectId);
    if (source === undefined) {
      throw new TestWorkspaceError(
        TEST_WORKSPACE_ERROR_CODES.SOURCE_NOT_FOUND,
        'The source project is no longer registered.',
        { sourceProjectId: input.sourceProjectId },
      );
    }
    if (source.managedWorkspace === true) {
      throw new TestWorkspaceError(
        TEST_WORKSPACE_ERROR_CODES.SOURCE_INVALID,
        'A test workspace cannot be used as the source for another test workspace.',
        { sourceProjectId: input.sourceProjectId },
      );
    }
    sourceProjectPath = source.canonicalPath;
    chain = await options.chainService.get(sourceProjectPath, input.sourceChainId);
  } else {
    const draftService = options.draftService ?? options.getDraftService?.();
    if (draftService === undefined) {
      throw new TestWorkspaceError(
        TEST_WORKSPACE_ERROR_CODES.SOURCE_INVALID,
        'Project-independent draft testing is not configured.',
      );
    }
    chain = await draftService.get(configDirectory, input.sourceDraftId);
  }
  const workspaceRoot = await ensureWorkspaceRoot(configDirectory);
  const id = randomUUID();
  const workspacePath = join(workspaceRoot, id);
  const timestamp = getTimestamp(options.now);
  let registeredProjectId: string | null = null;
  let workspaceCreated = false;

  try {
    await mkdir(workspacePath, { mode: 0o700 });
    workspaceCreated = true;
    const canonicalWorkspace = await realpath(workspacePath);
    if (canonicalWorkspace !== workspacePath || !isWithin(workspaceRoot, canonicalWorkspace)) {
      throw new TestWorkspaceError(
        TEST_WORKSPACE_ERROR_CODES.PATH_INVALID,
        'The disposable workspace path resolved outside its managed root.',
      );
    }

    const registration = await options.projectRegistry.registerManagedWorkspace(canonicalWorkspace);
    registeredProjectId = registration.id;

    const storedDraftBundle = 'sourceDraftId' in input
      ? await readDraftBundle(configDirectory, input.sourceDraftId)
      : null;
    if (
      storedDraftBundle !== null &&
      !draftBundleMatchesChain(storedDraftBundle, chain)
    ) {
      throw new TestWorkspaceError(
        TEST_WORKSPACE_ERROR_CODES.SOURCE_INVALID,
        'The saved draft no longer matches its frozen package bundle.',
        { sourceDraftId: 'sourceDraftId' in input ? input.sourceDraftId : undefined },
      );
    }
    const { agent, ...bundleChain } = chain;
    const bundle = storedDraftBundle ??
      await exportBundle(bundleChain, sourceProjectPath, options.catalogService);
    const imported = await importBundle(bundle, canonicalWorkspace, options.catalogService, options.chainService, []);
    const draft: {
      name: string;
      harness: Chain['harness'];
      sessionMode: Chain['sessionMode'];
      steps: Chain['steps'];
      inputs: Chain['inputs'];
      automaticPermissionOptIn: boolean;
      agent?: ChainAgentSelection;
    } = {
      name: chain.name,
      harness: chain.harness,
      sessionMode: chain.sessionMode,
      steps: chain.steps,
      inputs: chain.inputs,
      automaticPermissionOptIn: chain.automaticPermissionOptIn,
    };

    if (agent !== undefined) {
      const sourceAgentPath = await resolveAgentPath(
        sourceProjectPath,
        agent,
        projectSource,
        options,
      );
      await copyNativeAgentIntoProject({
        projectPath: canonicalWorkspace,
        entry: {
          id: agent.name,
          name: agent.name,
          harness: agent.harness,
          path: sourceAgentPath,
          agentPath: agent.agentPath,
          fingerprint: agent.fingerprint,
          status: 'available',
        },
      });
      draft.agent = agent;
    }

    const testChain = await options.chainService.update(canonicalWorkspace, imported.id, draft);
    const record: TestWorkspaceRecord = {
      id,
      projectId: registration.id,
      ...(projectSource
        ? { sourceProjectId: input.sourceProjectId, sourceChainId: input.sourceChainId }
        : { sourceDraftId: input.sourceDraftId }),
      chainId: testChain.id,
      createdAt: timestamp,
    };
    await options.configStore.update((current) => ({
      testWorkspaces: [...current.testWorkspaces, record],
    }));

    return { ...record, path: canonicalWorkspace };
  } catch (error) {
    if (registeredProjectId !== null) {
      await options.projectRegistry.removeRecentProject(registeredProjectId).catch(() => undefined);
    }
    if (workspaceCreated) {
      await rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
    }
    if (error instanceof TestWorkspaceError) throw error;
    throw new TestWorkspaceError(
      TEST_WORKSPACE_ERROR_CODES.CREATE_FAILED,
      'The disposable chain workspace could not be created.',
      projectSource
        ? { sourceProjectId: input.sourceProjectId, sourceChainId: input.sourceChainId }
        : { sourceDraftId: input.sourceDraftId },
      { cause: error },
    );
  }
}

async function resolveAgentPath(
  sourceProjectPath: string,
  selection: ChainAgentSelection,
  projectSource: boolean,
  options: TestWorkspaceServiceOptions,
): Promise<string> {
  if (projectSource) {
    const sourceStatus = await inspectInstalledNativeAgent({
      projectPath: sourceProjectPath,
      selection,
    });
    const sourceAgentPath = installedNativeAgentPath(sourceProjectPath, selection);
    if (sourceStatus !== 'available' || sourceAgentPath === null) {
      throw new TestWorkspaceError(
        TEST_WORKSPACE_ERROR_CODES.SOURCE_INVALID,
        `The selected native agent is ${sourceStatus} in the source project.`,
        { agentName: selection.name, status: sourceStatus },
      );
    }
    return sourceAgentPath;
  }

  const catalog = await options.catalogService.getCatalog({
    projectPath: sourceProjectPath,
    harness: selection.harness,
  });
  const agent = catalog.agents.find(
    (candidate) =>
      candidate.sourceId === selection.sourceId &&
      candidate.revision === selection.revision &&
      candidate.repositoryPath === selection.repositoryPath &&
      candidate.agentPath === selection.agentPath &&
      candidate.fingerprint === selection.fingerprint,
  );
  if (agent === undefined || agent.status !== 'available') {
    throw new TestWorkspaceError(
      TEST_WORKSPACE_ERROR_CODES.SOURCE_INVALID,
      'The selected remote native agent is unavailable or has changed.',
      { agentName: selection.name, status: agent?.status ?? 'missing' },
    );
  }
  return agent.path;
}

async function listWorkspaces(options: TestWorkspaceServiceOptions): Promise<TestWorkspace[]> {
  const configDirectory = resolve(options.configStore.getConfigDir());
  const root = join(configDirectory, WORKSPACE_DIRECTORY);
  const config = await options.configStore.get();
  return config.testWorkspaces.map((record) => ({
    ...record,
    path: join(root, record.id),
  }));
}

async function removeWorkspace(
  id: string,
  options: TestWorkspaceServiceOptions,
): Promise<{ id: string; removed: true }> {
  const configDirectory = resolve(options.configStore.getConfigDir());
  const config = await options.configStore.get();
  const record = config.testWorkspaces.find((candidate) => candidate.id === id);
  if (record === undefined) {
    throw new TestWorkspaceError(
      TEST_WORKSPACE_ERROR_CODES.NOT_FOUND,
      'No managed test workspace matches that id.',
      { id },
    );
  }
  const project = await options.projectRegistry.findRecentProject(record.projectId);
  if (project?.managedWorkspace !== true) {
    throw new TestWorkspaceError(
      TEST_WORKSPACE_ERROR_CODES.PATH_INVALID,
      'The test workspace ownership record does not match a managed project.',
      { id },
    );
  }
  const active = await readActiveRunPointerFile({ configDirectory });
  if (active?.projectPath === project.canonicalPath) {
    throw new TestWorkspaceError(
      TEST_WORKSPACE_ERROR_CODES.ACTIVE,
      'The test workspace cannot be removed while it owns the active run.',
      { id, runId: active.runId },
    );
  }

  const workspaceRoot = await ensureWorkspaceRoot(configDirectory);
  const expectedPath = join(workspaceRoot, id);
  if (
    !isAbsolute(project.canonicalPath) ||
    project.canonicalPath !== expectedPath ||
    !isWithin(workspaceRoot, project.canonicalPath)
  ) {
    throw new TestWorkspaceError(
      TEST_WORKSPACE_ERROR_CODES.PATH_INVALID,
      'The test workspace path is unsafe and was not removed.',
      { id },
    );
  }

  try {
    const info = await lstat(expectedPath);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(expectedPath) !== expectedPath) {
      throw new Error('unsafe workspace');
    }
    await rm(expectedPath, { recursive: true });
    await options.configStore.update((current) => ({
      testWorkspaces: current.testWorkspaces.filter((candidate) => candidate.id !== id),
      recentProjects: current.recentProjects.filter((candidate) => candidate.id !== record.projectId),
    }));
    return { id, removed: true };
  } catch (error) {
    if (error instanceof TestWorkspaceError) throw error;
    throw new TestWorkspaceError(
      TEST_WORKSPACE_ERROR_CODES.CLEANUP_FAILED,
      'The managed test workspace could not be safely removed.',
      { id },
      { cause: error },
    );
  }
}

async function ensureWorkspaceRoot(configDirectory: string): Promise<string> {
  try {
    await mkdir(configDirectory, { recursive: true, mode: 0o700 });
    const configInfo = await lstat(configDirectory);
    if (
      !configInfo.isDirectory() ||
      configInfo.isSymbolicLink() ||
      await realpath(configDirectory) !== configDirectory
    ) {
      throw new Error('unsafe config directory');
    }
    const root = join(configDirectory, WORKSPACE_DIRECTORY);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(root) !== root) {
      throw new Error('unsafe workspace root');
    }
    return root;
  } catch (error) {
    throw new TestWorkspaceError(
      TEST_WORKSPACE_ERROR_CODES.PATH_INVALID,
      'The managed test-workspace storage directory is unavailable or unsafe.',
      {},
      { cause: error },
    );
  }
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function getTimestamp(now: (() => Date) | undefined): string {
  const value = (now ?? (() => new Date()))();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TestWorkspaceError(
      TEST_WORKSPACE_ERROR_CODES.CREATE_FAILED,
      'The workspace clock returned an invalid timestamp.',
    );
  }
  return date.toISOString();
}
