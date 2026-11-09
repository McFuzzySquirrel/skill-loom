import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rm, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  DiscoveryHandoffSchema,
  MAX_HANDOFF_JSON_BYTES,
  type DiscoveryHandoff,
} from '../../shared/discovery-handoff.js';
import type { ChainBundle } from '../../shared/bundles.js';
import { parseBundle, MAX_BUNDLE_REQUEST_BYTES } from '../chains/bundle.js';
import { createGlobalDraftService } from '../chains/drafts.js';
import type { DiscoveryWorkspaceRecord } from '../config/schema.js';
import type { ConfigStore } from '../config/store.js';
import type { ChainService } from '../chains/service.js';
import { prepareDiscoveryHandoff } from '../catalog/discovery-handoff.js';
import { projectSkillRootFor } from '../catalog/copy.js';
import type { ProjectRegistry } from '../projects/registry.js';
import { createRunStore } from './store.js';
import { readActiveRunPointerFile } from './store.js';

const WORKSPACE_DIRECTORY = 'discovery-workspaces';
const SKILL_DIRECTORY = 'scenario-discovery';
const MAX_SKILL_BYTES = 10 * 1024 * 1024;
const MAX_SKILL_FILES = 1_000;

export const DISCOVERY_WORKSPACE_ERROR_CODES = {
  NOT_FOUND: 'DISCOVERY_WORKSPACE_NOT_FOUND',
  INVALID: 'DISCOVERY_WORKSPACE_INVALID',
  ACTIVE: 'DISCOVERY_WORKSPACE_ACTIVE',
  PREPARE_FAILED: 'DISCOVERY_WORKSPACE_PREPARE_FAILED',
  CLEANUP_FAILED: 'DISCOVERY_WORKSPACE_CLEANUP_FAILED',
  RESULT_UNAVAILABLE: 'DISCOVERY_RESULT_UNAVAILABLE',
  RESULT_REVIEW_REQUIRED: 'DISCOVERY_RESULT_REVIEW_REQUIRED',
  RESULT_REVIEW_STALE: 'DISCOVERY_RESULT_REVIEW_STALE',
  RESULT_INVALID: 'DISCOVERY_RESULT_INVALID',
  IMPORT_FAILED: 'DISCOVERY_IMPORT_FAILED',
  RUN_INCOMPLETE: 'DISCOVERY_RUN_INCOMPLETE',
} as const;

export class DiscoveryWorkspaceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
  }
}

export interface DiscoveryWorkspace extends DiscoveryWorkspaceRecord {
  path: string;
}

export interface DiscoveryWorkspaceService {
  create(input: {
    goal: string;
    harness: 'opencode' | 'copilot';
    candidates: Array<{
      sourceId: string;
      revision: string;
      repositoryPath: string;
      fingerprint: string;
    }>;
    createdAt: string;
    reviewFingerprint: string;
    contentsReviewed: true;
    redistributionReviewed: true;
    autoImport: boolean;
  }): Promise<{ workspace: DiscoveryWorkspace; handoff: DiscoveryHandoff }>;
  list(): Promise<DiscoveryWorkspace[]>;
  prepareForRun(id: string): Promise<void>;
  previewResult(id: string): Promise<{ bundle: ChainBundle; fingerprint: string }>;
  reviewResult(
    id: string,
    fingerprint: string,
    contentsReviewed: true,
    redistributionReviewed: true,
  ): Promise<{ fingerprint: string; reviewed: true }>;
  assertResultReviewed(id: string): Promise<void>;
  importResult(id: string): Promise<{ draftId: string; imported: true }>;
  remove(id: string): Promise<{ id: string; removed: true }>;
}

export interface DiscoveryWorkspaceServiceOptions {
  configStore: ConfigStore;
  projectRegistry: ProjectRegistry;
  chainService: ChainService;
  now?: () => Date;
  scenarioSkillDirectory?: string;
}

export function createDiscoveryWorkspaceService(
  options: DiscoveryWorkspaceServiceOptions,
): DiscoveryWorkspaceService {
  return {
    create: (input) => createWorkspace(input, options),
    list: () => listWorkspaces(options),
    prepareForRun: (id) => prepareWorkspaceForRun(id, options),
    previewResult: (id) => previewResult(id, options),
    reviewResult: (id, fingerprint, contentsReviewed, redistributionReviewed) =>
      reviewResult(id, fingerprint, contentsReviewed, redistributionReviewed, options),
    assertResultReviewed: (id) => assertResultReviewed(id, options),
    importResult: (id) => importResult(id, options),
    remove: (id) => removeWorkspace(id, options),
  };
}

const importQueues = new Map<string, Promise<{ draftId: string; imported: true }>>();
export { withWorkspaceLifecycleLock as withDiscoveryWorkspaceLock } from './workspace-lock.js';
import { withWorkspaceLifecycleLock as withDiscoveryWorkspaceLock } from './workspace-lock.js';

async function createWorkspace(
  input: Parameters<DiscoveryWorkspaceService['create']>[0],
  options: DiscoveryWorkspaceServiceOptions,
): Promise<{ workspace: DiscoveryWorkspace; handoff: DiscoveryHandoff }> {
  const handoff = await prepareDiscoveryHandoff(options.configStore, {
    goal: input.goal,
    harness: input.harness,
    candidates: input.candidates,
    createdAt: input.createdAt,
  });
  if (handoff.fingerprint !== input.reviewFingerprint) {
    throw new DiscoveryWorkspaceError(
      DISCOVERY_WORKSPACE_ERROR_CODES.INVALID,
      'The selected package contents changed after review. Review the refreshed handoff before preparing a workspace.',
      { code: 'DISCOVERY_REVIEW_STALE' },
    );
  }
  const configDirectory = resolve(options.configStore.getConfigDir());
  const workspaceRoot = await ensureWorkspaceRoot(configDirectory);
  const id = randomUUID();
  const workspacePath = join(workspaceRoot, id);
  let projectId: string | null = null;
  let workspaceCreated = false;

  try {
    await mkdir(workspacePath, { mode: 0o700 });
    workspaceCreated = true;
    const canonicalWorkspace = await realpath(workspacePath);
    if (canonicalWorkspace !== workspacePath || !isWithin(workspaceRoot, canonicalWorkspace)) {
      throw new Error('workspace path escaped managed root');
    }

    const registration = await options.projectRegistry.registerManagedWorkspace(canonicalWorkspace);
    projectId = registration.id;
    const skillSource = await resolveScenarioSkill(options.scenarioSkillDirectory);
    await copySkill(skillSource, canonicalWorkspace, input.harness);
    const handoffPath = join(canonicalWorkspace, 'skill-loom-discovery.loom-discovery.json');
    const handoffHandle = await open(handoffPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      await handoffHandle.writeFile(`${JSON.stringify(handoff, null, 2)}\n`, 'utf8');
      await handoffHandle.sync();
    } finally {
      await handoffHandle.close();
    }
    const outputDirectory = join(canonicalWorkspace, 'discovery-output');
    await mkdir(outputDirectory, { mode: 0o700 });
    const chain = await options.chainService.create(canonicalWorkspace, {
      name: 'Interactive scenario discovery',
      harness: input.harness,
      sessionMode: 'shared',
      steps: [{
        id: 'scenario-discovery',
        skillName: SKILL_DIRECTORY,
        instruction: [
          'Use scenario-discovery with the reviewed discovery handoff.',
          `Read and validate ${handoffPath} with its standalone helper.`,
          `Write the approved skill-loom-chain v1 bundle to ${join(outputDirectory, 'approved-result.loom.json')}.`,
          'Do not execute the resulting chain or import it. Keep following the skill instructions to obtain explicit approval before packaging.',
        ].join(' '),
      }],
      inputs: [],
    });

    const createdAt = (options.now ?? (() => new Date()))().toISOString();
    const record: DiscoveryWorkspaceRecord = {
      id,
      projectId: registration.id,
      chainId: chain.id,
      harness: input.harness,
      createdAt,
      handoffFingerprint: handoff.fingerprint,
      autoImport: input.autoImport,
    };
    await options.configStore.update((current) => ({
      discoveryWorkspaces: [...current.discoveryWorkspaces, record],
    }));
    return { workspace: { ...record, path: canonicalWorkspace }, handoff };
  } catch (error) {
    if (projectId !== null) {
      await options.projectRegistry.removeRecentProject(projectId).catch(() => undefined);
    }
    if (workspaceCreated) {
      await rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
    }
    if (error instanceof DiscoveryWorkspaceError) throw error;
    throw new DiscoveryWorkspaceError(
      DISCOVERY_WORKSPACE_ERROR_CODES.PREPARE_FAILED,
      'The managed discovery workspace could not be prepared.',
      {},
      { cause: error },
    );
  }
}

async function previewResult(
  id: string,
  options: DiscoveryWorkspaceServiceOptions,
): Promise<{ bundle: ChainBundle; fingerprint: string }> {
  const { record, path } = await ownedWorkspace(id, options);
  const handoff = await readVerifiedHandoff(path, record, options);
  const resultPath = join(path, 'discovery-output', 'approved-result.loom.json');
  let raw: unknown;
  let resultText: string;
  try {
    const info = await lstat(resultPath);
    if (!info.isFile() || info.isSymbolicLink() || await realpath(resultPath) !== resultPath ||
        !isWithin(path, resultPath) || info.size > MAX_BUNDLE_REQUEST_BYTES) {
      throw new Error('unsafe result path');
    }
    const handle = await open(resultPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.size > MAX_BUNDLE_REQUEST_BYTES) throw new Error('invalid result file');
      const content = Buffer.alloc(opened.size + 1);
      const { bytesRead } = await handle.read(content, 0, content.length, 0);
      if (bytesRead !== opened.size) throw new Error('result changed while reading');
      resultText = content.subarray(0, bytesRead).toString('utf8');
      raw = JSON.parse(resultText) as unknown;
    } finally {
      await handle.close();
    }
  } catch (error) {
    throw new DiscoveryWorkspaceError(
      DISCOVERY_WORKSPACE_ERROR_CODES.RESULT_UNAVAILABLE,
      'The approved discovery result is missing, unsafe, or too large to review.',
      { id },
      { cause: error },
    );
  }

  try {
    const bundle = parseBundle(raw);
    if (bundle.version !== 1 || bundle.chain.harness !== record.harness) {
      throw new Error('unsupported result version or harness');
    }
    validateResultPackages(bundle, handoff);
    if (bundle.chain.inputs.some((input) => input.defaultValue !== undefined)) {
      throw new Error('chain inputs must not include defaults');
    }
    const fingerprint = createHash('sha256').update(resultText!, 'utf8').digest('hex');
    return { bundle, fingerprint };
  } catch (error) {
    throw new DiscoveryWorkspaceError(
      DISCOVERY_WORKSPACE_ERROR_CODES.RESULT_INVALID,
      'The discovery result is not a supported v1 bundle made only from the reviewed candidates.',
      { id },
      { cause: error },
    );
  }
}

async function prepareWorkspaceForRun(
  id: string,
  options: DiscoveryWorkspaceServiceOptions,
): Promise<void> {
  const { path } = await ownedWorkspace(id, options);
  const outputDirectory = join(path, 'discovery-output');
  const resultPath = join(outputDirectory, 'approved-result.loom.json');
  try {
    const directoryInfo = await lstat(outputDirectory);
    if (
      !directoryInfo.isDirectory() ||
      directoryInfo.isSymbolicLink() ||
      await realpath(outputDirectory) !== outputDirectory ||
      !isWithin(path, outputDirectory)
    ) {
      throw new Error('unsafe discovery output directory');
    }
    const resultInfo = await lstatIfPresent(resultPath);
    if (resultInfo !== undefined) {
      if (
        !resultInfo.isFile() ||
        resultInfo.isSymbolicLink() ||
        await realpath(resultPath) !== resultPath ||
        !isWithin(path, resultPath)
      ) {
        throw new Error('unsafe discovery result path');
      }
    }
    await options.configStore.update((current) => ({
      discoveryWorkspaces: current.discoveryWorkspaces.map((candidate) => {
        if (candidate.id !== id) return candidate;
        const reset = { ...candidate };
        delete reset.runId;
        delete reset.resultFingerprint;
        delete reset.importedDraftId;
        return reset;
      }),
    }));
    if (resultInfo !== undefined) await unlink(resultPath);
  } catch (error) {
    if (error instanceof DiscoveryWorkspaceError) throw error;
    throw new DiscoveryWorkspaceError(
      DISCOVERY_WORKSPACE_ERROR_CODES.PREPARE_FAILED,
      'The retained discovery workspace could not be reset for a new run.',
      { id },
      { cause: error },
    );
  }
}

async function reviewResult(
  id: string,
  fingerprint: string,
  contentsReviewed: true,
  redistributionReviewed: true,
  options: DiscoveryWorkspaceServiceOptions,
): Promise<{ fingerprint: string; reviewed: true }> {
  if (contentsReviewed !== true || redistributionReviewed !== true) {
    throw new DiscoveryWorkspaceError(
      DISCOVERY_WORKSPACE_ERROR_CODES.RESULT_REVIEW_REQUIRED,
      'Review the complete result and redistribution rights before marking discovery Done.',
      { id },
    );
  }
  const preview = await previewResult(id, options);
  if (preview.fingerprint !== fingerprint) {
    throw new DiscoveryWorkspaceError(
      DISCOVERY_WORKSPACE_ERROR_CODES.RESULT_REVIEW_STALE,
      'The discovery result changed after review. Review the current result again.',
      { id },
    );
  }
  const config = await options.configStore.get();
  if (!config.discoveryWorkspaces.some((candidate) => candidate.id === id)) {
    throw new DiscoveryWorkspaceError(
      DISCOVERY_WORKSPACE_ERROR_CODES.NOT_FOUND,
      'No retained discovery workspace matches that id.',
      { id },
    );
  }
  await options.configStore.update((current) => ({
    discoveryWorkspaces: current.discoveryWorkspaces.map((candidate) =>
      candidate.id === id ? { ...candidate, resultFingerprint: fingerprint } : candidate,
    ),
  }));
  return { fingerprint, reviewed: true };
}

async function importResult(
  id: string,
  options: DiscoveryWorkspaceServiceOptions,
): Promise<{ draftId: string; imported: true }> {
  const queued = importQueues.get(id);
  if (queued !== undefined) return queued;
  const operation = importResultOnce(id, options);
  importQueues.set(id, operation);
  try {
    return await operation;
  } finally {
    if (importQueues.get(id) === operation) importQueues.delete(id);
  }
}

async function assertResultReviewed(
  id: string,
  options: DiscoveryWorkspaceServiceOptions,
): Promise<void> {
  const { record } = await ownedWorkspace(id, options);
  if (record.resultFingerprint === undefined) {
    throw new DiscoveryWorkspaceError(
      DISCOVERY_WORKSPACE_ERROR_CODES.RESULT_REVIEW_REQUIRED,
      'Review the complete discovery result and redistribution rights before marking the step Done.',
      { id },
    );
  }
  const current = await previewResult(id, options);
  if (current.fingerprint !== record.resultFingerprint) {
    throw new DiscoveryWorkspaceError(
      DISCOVERY_WORKSPACE_ERROR_CODES.RESULT_REVIEW_STALE,
      'The discovery result changed after review. Review the current result again before marking the step Done.',
      { id },
    );
  }
}

async function importResultOnce(
  id: string,
  options: DiscoveryWorkspaceServiceOptions,
): Promise<{ draftId: string; imported: true }> {
  const { record, path } = await ownedWorkspace(id, options);
  if (record.importedDraftId !== undefined) {
    return { draftId: record.importedDraftId, imported: true };
  }
  if (record.resultFingerprint === undefined) {
    throw new DiscoveryWorkspaceError(
      DISCOVERY_WORKSPACE_ERROR_CODES.RESULT_REVIEW_REQUIRED,
      'Review the exact discovery result before importing it.',
      { id },
    );
  }
  const { bundle, fingerprint } = await previewResult(id, options);
  if (record.resultFingerprint !== fingerprint) {
    throw new DiscoveryWorkspaceError(
      DISCOVERY_WORKSPACE_ERROR_CODES.RESULT_REVIEW_STALE,
      'The discovery result changed after review. Review the current result before importing.',
      { id },
    );
  }
  const runs = await createRunStore({
    projectPath: path,
    configDirectory: options.configStore.getConfigDir(),
  }).list();
  if (
    record.runId === undefined ||
    !runs.runs.some((run) =>
      run.id === record.runId &&
      run.chainId === record.chainId &&
      run.status === 'completed' &&
      run.steps.length === 1 &&
      run.steps[0]?.status === 'done')
  ) {
    throw new DiscoveryWorkspaceError(
      DISCOVERY_WORKSPACE_ERROR_CODES.RUN_INCOMPLETE,
      'Mark the reviewed discovery step Done and finish its supervised run before importing.',
      { id },
    );
  }

  const handoff = await readVerifiedHandoff(path, record, options);
  const boundSteps = bundle.chain.steps.map((step) => {
    if (step.kind === 'instruction') return step;
    const matches = handoff.candidates.filter((candidate) => candidate.name === step.skillName);
    if (matches.length !== 1) {
      throw new DiscoveryWorkspaceError(
        DISCOVERY_WORKSPACE_ERROR_CODES.RESULT_INVALID,
        `The approved skill "${step.skillName}" is missing or ambiguous in the reviewed handoff.`,
        { id },
      );
    }
    const candidate = matches[0]!;
    return {
      ...step,
      skillBinding: {
        sourceId: candidate.sourceId,
        revision: candidate.revision,
        repositoryPath: candidate.repositoryPath,
      },
    };
  });
  const name = `${bundle.chain.name} · Discovery ${id.slice(0, 8)}`;
  const configDirectory = resolve(options.configStore.getConfigDir());
  const draftService = createGlobalDraftService(configDirectory);
  const existing = (await draftService.list(configDirectory)).chains
    .find((chain) => chain.name === name);
  let draftId: string;
  if (existing !== undefined) {
    const expected = {
      harness: bundle.chain.harness,
      sessionMode: bundle.chain.sessionMode,
      steps: boundSteps,
      inputs: bundle.chain.inputs,
    };
    const actual = {
      harness: existing.harness,
      sessionMode: existing.sessionMode,
      steps: existing.steps,
      inputs: existing.inputs,
    };
    if (!isDeepStrictEqual(actual, expected)) {
      throw new DiscoveryWorkspaceError(
        DISCOVERY_WORKSPACE_ERROR_CODES.IMPORT_FAILED,
        'A different draft already uses this discovery import identity.',
        { id },
      );
    }
    draftId = existing.id;
  } else {
    try {
      const draft = await draftService.create(configDirectory, {
        name,
        harness: bundle.chain.harness,
        sessionMode: bundle.chain.sessionMode,
        steps: boundSteps,
        inputs: bundle.chain.inputs,
      }, { uniqueName: true });
      draftId = draft.id;
    } catch (error) {
      throw new DiscoveryWorkspaceError(
        DISCOVERY_WORKSPACE_ERROR_CODES.IMPORT_FAILED,
        'The approved discovery result could not be created as a new Chain draft.',
        { id },
        { cause: error },
      );
    }
  }

  await options.configStore.update((current) => ({
    discoveryWorkspaces: current.discoveryWorkspaces.map((candidate) =>
      candidate.id === id
        ? { ...candidate, importedDraftId: draftId, resultFingerprint: fingerprint }
        : candidate,
    ),
  }));
  return { draftId, imported: true };
}

async function ownedWorkspace(
  id: string,
  options: DiscoveryWorkspaceServiceOptions,
): Promise<{ record: DiscoveryWorkspaceRecord; path: string }> {
  const configDirectory = resolve(options.configStore.getConfigDir());
  const record = (await options.configStore.get()).discoveryWorkspaces
    .find((candidate) => candidate.id === id);
  if (record === undefined) {
    throw new DiscoveryWorkspaceError(
      DISCOVERY_WORKSPACE_ERROR_CODES.NOT_FOUND,
      'No retained discovery workspace matches that id.',
      { id },
    );
  }
  const project = await options.projectRegistry.findRecentProject(record.projectId);
  const root = await ensureWorkspaceRoot(configDirectory);
  const path = join(root, record.id);
  if (
    project?.managedWorkspace !== true ||
    project.canonicalPath !== path ||
    !isWithin(root, path)
  ) {
    throw new DiscoveryWorkspaceError(
      DISCOVERY_WORKSPACE_ERROR_CODES.INVALID,
      'The discovery workspace ownership record does not match a managed project.',
      { id },
    );
  }
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) {
    throw new DiscoveryWorkspaceError(
      DISCOVERY_WORKSPACE_ERROR_CODES.INVALID,
      'The discovery workspace path is unsafe.',
      { id },
    );
  }
  return { record, path };
}

async function readVerifiedHandoff(
  path: string,
  record: DiscoveryWorkspaceRecord,
  options: DiscoveryWorkspaceServiceOptions,
): Promise<DiscoveryHandoff> {
  const handoffPath = join(path, 'skill-loom-discovery.loom-discovery.json');
  try {
    const info = await lstat(handoffPath);
    if (!info.isFile() || info.isSymbolicLink() || await realpath(handoffPath) !== handoffPath ||
        info.size > MAX_HANDOFF_JSON_BYTES) throw new Error('unsafe handoff path');
    const handle = await open(handoffPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    let text: string;
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.size > MAX_HANDOFF_JSON_BYTES) throw new Error('invalid handoff file');
      const content = Buffer.alloc(opened.size + 1);
      const { bytesRead } = await handle.read(content, 0, content.length, 0);
      if (bytesRead !== opened.size) throw new Error('handoff changed while reading');
      text = content.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
    const handoff = DiscoveryHandoffSchema.parse(JSON.parse(text));
    const { fingerprint, ...body } = handoff;
    const actualFingerprint = createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex');
    if (fingerprint !== actualFingerprint || fingerprint !== record.handoffFingerprint) {
      throw new Error('handoff fingerprint mismatch');
    }
    const verified = await prepareDiscoveryHandoff(options.configStore, {
      goal: handoff.goal,
      harness: handoff.harness,
      createdAt: handoff.createdAt,
      candidates: handoff.candidates.map((candidate) => ({
        sourceId: candidate.sourceId,
        revision: candidate.revision,
        repositoryPath: candidate.repositoryPath,
        fingerprint: candidate.fingerprint,
      })),
    }, { allowUnregisteredSources: true });
    if (verified.fingerprint !== fingerprint) throw new Error('pinned packages changed');
    return verified;
  } catch (error) {
    throw new DiscoveryWorkspaceError(
      DISCOVERY_WORKSPACE_ERROR_CODES.INVALID,
      'The reviewed handoff is missing, modified, or no longer matches its pinned snapshots.',
      { id: record.id },
      { cause: error },
    );
  }
}

function validateResultPackages(bundle: ChainBundle, handoff: DiscoveryHandoff): void {
  if (bundle.version !== 1) throw new Error('only version 1 bundles are supported');
  const candidatesByName = new Map<string, DiscoveryHandoff['candidates']>();
  for (const candidate of handoff.candidates) {
    candidatesByName.set(candidate.name, [
      ...(candidatesByName.get(candidate.name) ?? []),
      candidate,
    ]);
  }
  const referenced = new Set(bundle.chain.steps
    .filter((step) => step.kind !== 'instruction')
    .map((step) => step.skillName));
  if (referenced.size !== bundle.skills.length) throw new Error('bundle has unreferenced or duplicate packages');
  const seen = new Set<string>();
  for (const skill of bundle.skills) {
    if (seen.has(skill.name) || !referenced.has(skill.name)) throw new Error('duplicate or unreferenced package');
    seen.add(skill.name);
    const matches = candidatesByName.get(skill.name) ?? [];
    if (matches.length !== 1) throw new Error('candidate package name is ambiguous');
    const candidate = matches[0]!;
    const expected = [...candidate.files].sort((a, b) => a.path.localeCompare(b.path));
    const actual = [...skill.files].sort((a, b) => a.path.localeCompare(b.path));
    if (expected.length !== actual.length) throw new Error('package file inventory differs from handoff');
    for (let index = 0; index < expected.length; index += 1) {
      const expectedFile = expected[index]!;
      const actualFile = actual[index]!;
      if (
        expectedFile.path !== actualFile.path ||
        expectedFile.content !== actualFile.content ||
        expectedFile.executable !== actualFile.executable
      ) throw new Error('package file content differs from handoff');
    }
  }
}

async function listWorkspaces(
  options: DiscoveryWorkspaceServiceOptions,
): Promise<DiscoveryWorkspace[]> {
  const configDirectory = resolve(options.configStore.getConfigDir());
  const root = join(configDirectory, WORKSPACE_DIRECTORY);
  const config = await options.configStore.get();
  return config.discoveryWorkspaces.map((record) => ({
    ...record,
    path: join(root, record.id),
  }));
}

async function removeWorkspace(
  id: string,
  options: DiscoveryWorkspaceServiceOptions,
): Promise<{ id: string; removed: true }> {
  const initial = (await options.configStore.get()).discoveryWorkspaces
    .find((candidate) => candidate.id === id);
  if (initial === undefined) {
    throw new DiscoveryWorkspaceError(
      DISCOVERY_WORKSPACE_ERROR_CODES.NOT_FOUND,
      'No retained discovery workspace matches that id.',
      { id },
    );
  }
  return withDiscoveryWorkspaceLock(
    initial.projectId,
    () => removeWorkspaceLocked(id, options),
  );
}

async function removeWorkspaceLocked(
  id: string,
  options: DiscoveryWorkspaceServiceOptions,
): Promise<{ id: string; removed: true }> {
  const configDirectory = resolve(options.configStore.getConfigDir());
  const config = await options.configStore.get();
  const record = config.discoveryWorkspaces.find((candidate) => candidate.id === id);
  if (record === undefined) {
    throw new DiscoveryWorkspaceError(
      DISCOVERY_WORKSPACE_ERROR_CODES.NOT_FOUND,
      'No retained discovery workspace matches that id.',
      { id },
    );
  }
  const workspaceRoot = await ensureWorkspaceRoot(configDirectory);
  const expectedPath = join(workspaceRoot, id);
  const project = await options.projectRegistry.findRecentProject(record.projectId);
  let workspaceExists = true;
  if (
    (project !== undefined && (
      project.managedWorkspace !== true ||
      !isAbsolute(project.canonicalPath) ||
      project.canonicalPath !== expectedPath ||
      !isWithin(workspaceRoot, project.canonicalPath)
    )) ||
    (project === undefined && (await lstatIfPresent(expectedPath)) !== undefined)
  ) {
    throw new DiscoveryWorkspaceError(
      DISCOVERY_WORKSPACE_ERROR_CODES.INVALID,
      'The discovery workspace ownership record does not match a managed project.',
      { id },
    );
  }
  const active = await readActiveRunPointerFile({ configDirectory });
  if (active?.projectPath === expectedPath) {
    throw new DiscoveryWorkspaceError(
      DISCOVERY_WORKSPACE_ERROR_CODES.ACTIVE,
      'The discovery workspace cannot be removed while it owns the active run.',
      { id, runId: active.runId },
    );
  }

  try {
    const info = await lstatIfPresent(expectedPath);
    workspaceExists = info !== undefined;
    if (info !== undefined) {
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(expectedPath) !== expectedPath) {
        throw new Error('unsafe workspace');
      }
      await rm(expectedPath, { recursive: true });
      workspaceExists = false;
    }
    await options.configStore.update((current) => ({
      discoveryWorkspaces: current.discoveryWorkspaces.filter((candidate) => candidate.id !== id),
      recentProjects: current.recentProjects.filter((candidate) => candidate.id !== record.projectId),
    }));
    return { id, removed: true };
  } catch (error) {
    if (error instanceof DiscoveryWorkspaceError) throw error;
    throw new DiscoveryWorkspaceError(
      DISCOVERY_WORKSPACE_ERROR_CODES.CLEANUP_FAILED,
      workspaceExists
        ? 'The retained discovery workspace could not be safely removed.'
        : 'The missing discovery workspace could not be removed from its retained records.',
      { id },
      { cause: error },
    );
  }
}

async function lstatIfPresent(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return undefined;
    throw error;
  }
}

async function resolveScenarioSkill(explicit?: string): Promise<string> {
  const cwd = process.cwd();
  const sourceDirectory = fileURLToPath(new URL('../../../', import.meta.url));
  const candidates = explicit === undefined
    ? [
        join(sourceDirectory, 'skills', SKILL_DIRECTORY),
        join(cwd, 'dist', 'skills', SKILL_DIRECTORY),
        join(cwd, '.github', 'skills', SKILL_DIRECTORY),
        join(cwd, 'skill', SKILL_DIRECTORY),
      ]
    : [resolve(explicit)];
  for (const candidate of candidates) {
    try {
      const info = await lstat(candidate);
      if (!info.isDirectory() || info.isSymbolicLink()) continue;
      const canonical = await realpath(candidate);
      if (canonical !== candidate) continue;
      const skill = await lstat(join(canonical, 'SKILL.md'));
      if (skill.isFile() && !skill.isSymbolicLink()) return canonical;
    } catch (error) {
      if (isErrno(error, 'ENOENT')) continue;
      throw error;
    }
  }
  throw new DiscoveryWorkspaceError(
    DISCOVERY_WORKSPACE_ERROR_CODES.PREPARE_FAILED,
    'The application-shipped scenario-discovery skill package is unavailable.',
  );
}

async function copySkill(source: string, projectPath: string, harness: 'opencode' | 'copilot'): Promise<void> {
  const root = projectSkillRootFor(harness, projectPath);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const destination = join(root, SKILL_DIRECTORY);
  await mkdir(destination, { mode: 0o700 });
  let bytes = 0;
  let files = 0;

  async function copyDirectory(from: string, to: string): Promise<void> {
    const entries = await readdir(from, { withFileTypes: true });
    for (const entry of entries) {
      const sourcePath = join(from, entry.name);
      const targetPath = join(to, entry.name);
      const info = await lstat(sourcePath);
      if (info.isSymbolicLink()) throw new Error('Skill package contains a symbolic link.');
      if (entry.isDirectory()) {
        await mkdir(targetPath, { mode: 0o700 });
        await copyDirectory(sourcePath, targetPath);
      } else if (entry.isFile()) {
        bytes += info.size;
        files += 1;
        if (bytes > MAX_SKILL_BYTES || files > MAX_SKILL_FILES) {
          throw new Error('The bundled discovery skill exceeds package limits.');
        }
        const sourceHandle = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
        const targetHandle = await open(targetPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
        try {
          const content = Buffer.alloc(info.size + 1);
          const { bytesRead } = await sourceHandle.read(content, 0, content.length, 0);
          if (bytesRead !== info.size) throw new Error('Skill package changed while copying.');
          await targetHandle.writeFile(content.subarray(0, bytesRead));
          await targetHandle.chmod((info.mode & 0o111) !== 0 ? 0o700 : 0o600);
        } finally {
          await sourceHandle.close();
          await targetHandle.close();
        }
      } else {
        throw new Error('Skill package contains a special file.');
      }
    }
  }

  try {
    await copyDirectory(source, destination);
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

async function ensureWorkspaceRoot(configDirectory: string): Promise<string> {
  await mkdir(configDirectory, { recursive: true, mode: 0o700 });
  const configInfo = await lstat(configDirectory);
  if (!configInfo.isDirectory() || configInfo.isSymbolicLink() || await realpath(configDirectory) !== configDirectory) {
    throw new DiscoveryWorkspaceError(
      DISCOVERY_WORKSPACE_ERROR_CODES.INVALID,
      'The managed discovery storage directory is unavailable or unsafe.',
    );
  }
  const root = join(configDirectory, WORKSPACE_DIRECTORY);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || await realpath(root) !== root) {
    throw new DiscoveryWorkspaceError(
      DISCOVERY_WORKSPACE_ERROR_CODES.INVALID,
      'The managed discovery storage directory is unavailable or unsafe.',
    );
  }
  return root;
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
