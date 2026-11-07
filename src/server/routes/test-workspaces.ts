import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  API_ERROR_CODES,
  createApiErrorEnvelope,
  type ApiValidationIssue,
} from '../../shared/api.js';
import { BundleError, exportBundle } from '../chains/bundle.js';
import { ChainSchema, CHAIN_VERSION } from '../chains/model.js';
import { parseBundle } from '../../portable/bundle.js';
import { saveDraftBundle } from '../chains/draft-bundles.js';
import { createChainService } from '../chains/service.js';
import { createGlobalDraftService } from '../chains/drafts.js';
import { createCatalogService, type CatalogService } from '../catalog/merge.js';
import type { ChainBundleV1 } from '../../shared/bundles.js';
import { ConfigError } from '../config/store.js';
import { createProjectRegistry, isProjectId } from '../projects/registry.js';
import { isSafeChainId } from '../chains/store.js';
import { sendChainFailure } from './chains.js';
import type { ChainRoutesOptions } from './chains.js';
import type { CatalogRoutesOptions } from './catalog.js';
import {
  createTestWorkspaceService,
  TEST_WORKSPACE_ERROR_CODES,
  TestWorkspaceError,
  type TestWorkspace,
} from '../runs/test-workspaces.js';

const createBodySchema = z.union([
  z.strictObject({
    sourceProjectId: z.string().min(1).max(128).refine(isProjectId),
    sourceChainId: z.string().min(1).max(64).refine(isSafeChainId),
  }),
  z.strictObject({
    sourceDraftId: z.string().min(1).max(64).refine(isSafeChainId),
  }),
]);

const createDiscoveryBodySchema = z.strictObject({
  goal: z.string().trim().min(1).max(1_000),
  harness: z.enum(['opencode', 'copilot']),
  skillIds: z.array(z.string().trim().min(1).max(256)).min(1).max(20),
  sourceProjectId: z.string().min(1).max(128).refine(isProjectId).optional(),
});

const workspaceIdSchema = z.uuid();
const acceptProposalBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(100).optional(),
});

interface WorkspaceParams {
  workspaceId: string;
}

/**
 * Materialize a saved chain in Loom-owned disposable projects. Client requests
 * identify registered projects/chains only; they never provide filesystem paths.
 */
export const testWorkspaceRoutes: FastifyPluginAsync<
  ChainRoutesOptions & CatalogRoutesOptions
> = async (app, options) => {
  const projectRegistry =
    options.projectRegistry ?? createProjectRegistry({ configStore: options.configStore });
  const chainService = options.chainService ?? createChainService();
  const catalogService =
    options.catalogService ?? createCatalogService({ configStore: options.configStore });
  const getDraftService = () =>
    createGlobalDraftService(options.configStore.getConfigDir());
  const service = createTestWorkspaceService({
    configStore: options.configStore,
    projectRegistry,
    chainService,
    getDraftService,
    catalogService,
  });

  app.get('/api/test-workspaces', async (_request, reply) => {
    try {
      return reply.code(200).send({ workspaces: await service.list() });
    } catch (error) {
      return sendWorkspaceFailure(reply, error);
    }
  });

  app.post('/api/test-workspaces', async (request, reply) => {
    const parsed = createBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send(
        createApiErrorEnvelope(
          API_ERROR_CODES.VALIDATION_ERROR,
          'The test-workspace request is not valid.',
          { issues: toValidationIssues(parsed.error.issues) },
        ),
      );
    }
    try {
      const workspace = await service.create(parsed.data);
      return reply.code(201).send({ workspace });
    } catch (error) {
      return sendWorkspaceFailure(reply, error);
    }
  });

  app.post('/api/test-workspaces/discovery', async (request, reply) => {
    const parsed = createDiscoveryBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send(
        createApiErrorEnvelope(
          API_ERROR_CODES.VALIDATION_ERROR,
          'The scenario-discovery workspace request is not valid.',
          { issues: toValidationIssues(parsed.error.issues) },
        ),
      );
    }
    try {
      const workspace = await service.createDiscovery({
        goal: parsed.data.goal,
        harness: parsed.data.harness,
        skillIds: parsed.data.skillIds,
        ...(parsed.data.sourceProjectId === undefined
          ? {}
          : { sourceProjectId: parsed.data.sourceProjectId }),
      });
      return reply.code(201).send({ workspace });
    } catch (error) {
      return sendWorkspaceFailure(reply, error);
    }
  });

  app.get<{ Params: WorkspaceParams }>(
    '/api/test-workspaces/:workspaceId/proposal',
    async (request, reply) => {
      if (!workspaceIdSchema.safeParse(request.params.workspaceId).success) {
        return reply.code(422).send(
          createApiErrorEnvelope(API_ERROR_CODES.VALIDATION_ERROR, 'The test-workspace id is not valid.'),
        );
      }
      try {
        const proposal = await loadWorkspaceProposal(
          request.params.workspaceId,
          await service.list(),
          catalogService,
          options.configStore.getConfigDir(),
        );
        if (proposal === null) {
          return reply.code(200).send({ proposal: null });
        }
        return reply.code(200).send({
          proposal: {
            name: proposal.bundle.chain.name,
            harness: proposal.bundle.chain.harness,
            sessionMode: proposal.bundle.chain.sessionMode,
            steps: proposal.bundle.chain.steps,
            inputs: proposal.bundle.chain.inputs,
            skills: proposal.bundle.skills.map((skill) => ({
              name: skill.name,
              directory: skill.directory,
              files: skill.files.length,
              bytes: skill.files.reduce((sum, file) =>
                sum + Buffer.from(file.content, 'base64').length, 0),
            })),
          },
        });
      } catch (error) {
        return sendWorkspaceFailure(reply, error);
      }
    },
  );

  app.post<{ Params: WorkspaceParams }>(
    '/api/test-workspaces/:workspaceId/proposal/accept',
    async (request, reply) => {
      if (!workspaceIdSchema.safeParse(request.params.workspaceId).success) {
        return reply.code(422).send(
          createApiErrorEnvelope(API_ERROR_CODES.VALIDATION_ERROR, 'The test-workspace id is not valid.'),
        );
      }
      const parsed = acceptProposalBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(422).send(
          createApiErrorEnvelope(
            API_ERROR_CODES.VALIDATION_ERROR,
            'The proposal acceptance request is not valid.',
            { issues: toValidationIssues(parsed.error.issues) },
          ),
        );
      }
      try {
        const workspace = (await service.list()).find(
          (entry) => entry.id === request.params.workspaceId,
        );
        if (workspace === undefined || workspace.purpose !== 'discovery') {
          return reply.code(404).send(
            createApiErrorEnvelope(TEST_WORKSPACE_ERROR_CODES.NOT_FOUND, 'The scenario-discovery workspace was not found.'),
          );
        }
        const proposal = await loadWorkspaceProposal(
          workspace.id,
          [workspace],
          catalogService,
          options.configStore.getConfigDir(),
        );
        if (proposal === null) {
          return reply.code(404).send(
            createApiErrorEnvelope('DISCOVERY_PROPOSAL_NOT_FOUND', 'No scenario proposal has been created in this workspace.'),
          );
        }
        const draftService = getDraftService();
        const configDirectory = options.configStore.getConfigDir();
        const chainDraft = {
          name: parsed.data.name ?? proposal.bundle.chain.name,
          harness: proposal.bundle.chain.harness,
          sessionMode: proposal.bundle.chain.sessionMode,
          steps: proposal.bundle.chain.steps,
          inputs: proposal.bundle.chain.inputs,
          automaticPermissionOptIn: false,
        };
        const chain = await draftService.create(configDirectory, chainDraft, { uniqueName: true });
        const acceptedBundle = {
          ...proposal.bundle,
          chain: { ...proposal.bundle.chain, name: chain.name },
        };
        try {
          await saveDraftBundle(configDirectory, chain.id, chain, acceptedBundle);
        } catch (error) {
          await draftService.remove(configDirectory, chain.id).catch(() => undefined);
          throw error;
        }
        return reply.code(201).send({ chain, proposalAccepted: true });
      } catch (error) {
        return sendWorkspaceFailure(reply, error);
      }
    },
  );

  app.delete<{ Params: WorkspaceParams }>(
    '/api/test-workspaces/:workspaceId',
    async (request, reply) => {
      if (!workspaceIdSchema.safeParse(request.params.workspaceId).success) {
        return reply.code(422).send(
          createApiErrorEnvelope(
            API_ERROR_CODES.VALIDATION_ERROR,
            'The test-workspace id is not valid.',
            { workspaceId: request.params.workspaceId },
          ),
        );
      }
      try {
        return reply.code(200).send(await service.remove(request.params.workspaceId));
      } catch (error) {
        return sendWorkspaceFailure(reply, error);
      }
    },
  );
};

const MAX_PROPOSAL_BYTES = 30 * 1024 * 1024;

async function loadWorkspaceProposal(
  workspaceId: string,
  workspaces: TestWorkspace[],
  catalog: CatalogService,
  configDirectory: string,
): Promise<{ bundle: ChainBundleV1 } | null> {
  const workspace = workspaces.find((entry) => entry.id === workspaceId);
  if (workspace === undefined || workspace.purpose !== 'discovery') return null;

  const workspaceRoot = await realpath(join(resolve(configDirectory), 'test-workspaces'));
  const expectedWorkspace = join(workspaceRoot, workspace.id);
  if (
    workspace.path !== expectedWorkspace ||
    await realpath(workspace.path) !== expectedWorkspace
  ) {
    throw new TestWorkspaceError(
      TEST_WORKSPACE_ERROR_CODES.PATH_INVALID,
      'The discovery workspace path is not inside the managed workspace directory.',
    );
  }
  const loomDirectory = join(expectedWorkspace, '.loom');
  const loomInfo = await lstat(loomDirectory).catch(() => null);
  if (
    loomInfo === null ||
    !loomInfo.isDirectory() ||
    loomInfo.isSymbolicLink() ||
    await realpath(loomDirectory) !== loomDirectory
  ) {
    throw new TestWorkspaceError(
      TEST_WORKSPACE_ERROR_CODES.PATH_INVALID,
      'The discovery workspace metadata directory is not safe.',
    );
  }

  const artifact = join(loomDirectory, 'scenario-proposal.loom.json');
  let artifactHandle;
  let raw: unknown;
  try {
    artifactHandle = await open(artifact, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return null;
    throw error;
  }
  try {
    const artifactInfo = await artifactHandle.stat();
    if (
      !artifactInfo.isFile() ||
      artifactInfo.size > MAX_PROPOSAL_BYTES ||
      await realpath(artifact) !== artifact
    ) {
      throw new TestWorkspaceError(
        TEST_WORKSPACE_ERROR_CODES.SOURCE_INVALID,
        'The scenario proposal artifact is not a safe, supported regular file.',
      );
    }
    const contents = Buffer.alloc(artifactInfo.size + 1);
    const { bytesRead } = await artifactHandle.read(contents, 0, contents.length, 0);
    if (bytesRead !== artifactInfo.size) {
      throw new TestWorkspaceError(
        TEST_WORKSPACE_ERROR_CODES.SOURCE_INVALID,
        'The scenario proposal artifact changed while it was being reviewed.',
      );
    }
    raw = JSON.parse(contents.subarray(0, bytesRead).toString('utf8'));
  } catch (error) {
    if (error instanceof TestWorkspaceError) throw error;
    throw new TestWorkspaceError(
      TEST_WORKSPACE_ERROR_CODES.SOURCE_INVALID,
      'The scenario proposal artifact is not valid JSON.',
      {},
      { cause: error },
    );
  } finally {
    await artifactHandle.close();
  }
  const bundle = parseBundle(raw);
  if (
    bundle.version !== 1 ||
    bundle.skills.some((skill) => !workspace.discoverySkillNames?.includes(skill.name))
  ) {
    throw new TestWorkspaceError(
      TEST_WORKSPACE_ERROR_CODES.SOURCE_INVALID,
      'The proposal must be a version 1 chain using only packages staged for this discovery workspace.',
    );
  }

  const timestamp = new Date().toISOString();
  const chain = ChainSchema.parse({
    version: CHAIN_VERSION,
    id: 'scenario-discovery-proposal',
    name: bundle.chain.name,
    harness: bundle.chain.harness,
    sessionMode: bundle.chain.sessionMode,
    steps: bundle.chain.steps,
    inputs: bundle.chain.inputs,
    automaticPermissionOptIn: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const stagedBundle = await exportBundle(chain, expectedWorkspace, catalog);
  if (!sameSkillPackages(stagedBundle.skills, bundle.skills)) {
    throw new TestWorkspaceError(
      TEST_WORKSPACE_ERROR_CODES.SOURCE_INVALID,
      'The proposal packages do not match the reviewed skill packages staged in this workspace.',
    );
  }
  return { bundle };
}

function sameSkillPackages(
  left: ChainBundleV1['skills'],
  right: ChainBundleV1['skills'],
): boolean {
  const normalize = (skills: ChainBundleV1['skills']) =>
    skills.map((skill) => ({
      name: skill.name,
      directory: skill.directory,
      files: [...skill.files]
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((file) => ({
          path: file.path,
          content: file.content,
          executable: file.executable,
        })),
    })).sort((a, b) => a.name.localeCompare(b.name));
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    error.code === code;
}

const STATUS_BY_WORKSPACE_CODE: Record<string, number> = {
  [TEST_WORKSPACE_ERROR_CODES.SOURCE_NOT_FOUND]: 404,
  [TEST_WORKSPACE_ERROR_CODES.SOURCE_INVALID]: 409,
  [TEST_WORKSPACE_ERROR_CODES.DISCOVERY_SELECTION_INVALID]: 422,
  [TEST_WORKSPACE_ERROR_CODES.NOT_FOUND]: 404,
  [TEST_WORKSPACE_ERROR_CODES.ACTIVE]: 409,
  [TEST_WORKSPACE_ERROR_CODES.PATH_INVALID]: 422,
  [TEST_WORKSPACE_ERROR_CODES.CREATE_FAILED]: 500,
  [TEST_WORKSPACE_ERROR_CODES.CLEANUP_FAILED]: 500,
};

function sendWorkspaceFailure(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof TestWorkspaceError) {
    return reply
      .code(STATUS_BY_WORKSPACE_CODE[error.code] ?? 500)
      .send(createApiErrorEnvelope(error.code, error.message, error.details));
  }
  if (error instanceof BundleError) {
    return reply
      .code(error.code === 'BUNDLE_CONFLICT' ? 409 : 422)
      .send(createApiErrorEnvelope(error.code, error.message));
  }
  if (error instanceof ConfigError) {
    return reply
      .code(500)
      .send(createApiErrorEnvelope(error.code, error.message, error.details));
  }
  return sendChainFailure(reply, error);
}

function toValidationIssues(
  issues: ReadonlyArray<{ path: PropertyKey[]; code: string; message: string }>,
): ApiValidationIssue[] {
  return issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    code: issue.code,
    message: issue.message,
  }));
}
