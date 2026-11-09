import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  API_ERROR_CODES,
  createApiErrorEnvelope,
  type ApiValidationIssue,
} from '../../shared/api.js';
import { BundleError } from '../chains/bundle.js';
import { createChainService } from '../chains/service.js';
import { createGlobalDraftService } from '../chains/drafts.js';
import { createCatalogService } from '../catalog/merge.js';
import { ConfigError } from '../config/store.js';
import { createProjectRegistry } from '../projects/registry.js';
import { sendChainFailure } from './chains.js';
import type { ChainRoutesOptions } from './chains.js';
import type { CatalogRoutesOptions } from './catalog.js';
import {
  createTestWorkspaceService,
  TEST_WORKSPACE_ERROR_CODES,
  TestWorkspaceError,
  type TestWorkspaceService,
} from '../runs/test-workspaces.js';
import { testWorkspaceCreateSchema } from '../runs/test-workspace-request.js';

export type TestWorkspaceRoutesOptions = ChainRoutesOptions & CatalogRoutesOptions & {
  testWorkspaceService?: TestWorkspaceService;
};

const workspaceIdSchema = z.uuid();

interface WorkspaceParams {
  workspaceId: string;
}

/**
 * Materialize a saved chain in Loom-owned disposable projects. Client requests
 * identify registered projects/chains only; they never provide filesystem paths.
 */
export const testWorkspaceRoutes: FastifyPluginAsync<TestWorkspaceRoutesOptions> = async (app, options) => {
  const projectRegistry =
    options.projectRegistry ?? createProjectRegistry({ configStore: options.configStore });
  const chainService = options.chainService ?? createChainService();
  const catalogService =
    options.catalogService ?? createCatalogService({ configStore: options.configStore });
  const service = options.testWorkspaceService ?? createTestWorkspaceService({
    configStore: options.configStore,
    projectRegistry,
    chainService,
    getDraftService: () =>
      createGlobalDraftService(options.configStore.getConfigDir()),
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
    const parsed = testWorkspaceCreateSchema.safeParse(request.body);
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

const STATUS_BY_WORKSPACE_CODE: Record<string, number> = {
  [TEST_WORKSPACE_ERROR_CODES.SOURCE_NOT_FOUND]: 404,
  [TEST_WORKSPACE_ERROR_CODES.SOURCE_INVALID]: 409,
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
