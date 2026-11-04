import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  API_ERROR_CODES,
  createApiErrorEnvelope,
  type ApiValidationIssue,
} from '../../shared/api.js';
import { CHAIN_VERSION, ChainValidationError, type Chain } from '../chains/model.js';
import {
  CHAIN_SERVICE_ERROR_CODES,
  ChainServiceError,
  createChainService,
  type ChainDraft,
  type ChainService,
} from '../chains/service.js';
import {
  CHAIN_STORE_ERROR_CODES,
  ChainStoreError,
  type ChainListResult,
  type ChainStoreErrorCode,
} from '../chains/store.js';
import { ConfigError } from '../config/store.js';
import type { ConfigStore } from '../config/store.js';
import {
  createProjectRegistry,
  isProjectId,
  type ProjectRegistry,
} from '../projects/registry.js';

/**
 * Editable chain payload. `steps` and `inputs` stay `unknown` so the chain
 * model, not the route, reports field-specific issues such as
 * `steps.1.instruction` or `inputs.0.name`.
 *
 * `id`, `version`, `createdAt`, and `updatedAt` are accepted so a client can
 * round-trip a chain returned by `GET`. They are never trusted: the server
 * generates ids and timestamps and preserves the stored `createdAt`.
 */
const chainPayloadSchema = z.strictObject({
  name: z.string(),
  harness: z.string(),
  sessionMode: z.string(),
  steps: z.array(z.unknown()),
  inputs: z.array(z.unknown()).optional(),
  automaticPermissionOptIn: z.boolean().optional(),
  /** Optional uniqueness request carried in the body (query is also accepted). */
  uniqueName: z.boolean().optional(),
  id: z.string().optional(),
  version: z.number().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const duplicatePayloadSchema = z.strictObject({
  name: z.string().optional(),
  uniqueName: z.boolean().optional(),
});

const uniqueNameQuerySchema = z.object({
  uniqueName: z.enum(['true', 'false', '1', '0']).optional(),
});

export interface ChainRoutesOptions {
  /** Global configuration store that owns the recent-project list. */
  configStore: ConfigStore;
  /** Injected project registry. Defaults to the config-backed registry. */
  projectRegistry?: ProjectRegistry;
  /** Injected chain service. Defaults to the filesystem-backed service. */
  chainService?: ChainService;
}

interface ProjectRouteParams {
  projectId: string;
}

interface ChainRouteParams extends ProjectRouteParams {
  chainId: string;
}

type ChainListResponse = ChainListResult;

interface ChainResponse {
  chain: Chain;
}

interface ChainDeletedResponse {
  chainId: string;
  deleted: true;
}

/** HTTP status for each typed chain-storage failure. */
const STATUS_BY_STORE_CODE: Record<ChainStoreErrorCode, number> = {
  CHAIN_ID_INVALID: 422,
  CHAIN_PROJECT_INVALID: 422,
  CHAIN_PROJECT_NOT_FOUND: 404,
  CHAIN_PROJECT_NOT_DIRECTORY: 400,
  CHAIN_PROJECT_UNREADABLE: 403,
  CHAIN_STORE_SETUP_FAILED: 500,
  CHAIN_PATH_ESCAPED: 400,
  CHAIN_NOT_FOUND: 404,
  CHAIN_ALREADY_EXISTS: 409,
  CHAIN_READ_FAILED: 500,
  CHAIN_WRITE_FAILED: 500,
  CHAIN_DELETE_FAILED: 500,
  CHAIN_LIST_FAILED: 500,
  CHAIN_FILE_CORRUPT: 422,
  CHAIN_FILE_UNREADABLE: 422,
  CHAIN_FILE_ID_MISMATCH: 422,
  CHAIN_UNSUPPORTED_VERSION: 422,
};

/**
 * Chain CRUD and duplicate routes.
 *
 * Every operation takes a registered project id (never a filesystem path),
 * resolves it to the canonical project directory, and lets the chain service
 * derive `<project>/.slan/chains`. Handlers only validate input, resolve the
 * project, call the service, and map typed errors to the shared envelope.
 */
export const chainRoutes: FastifyPluginAsync<ChainRoutesOptions> = async (
  app,
  options,
) => {
  const registry =
    options.projectRegistry ??
    createProjectRegistry({ configStore: options.configStore });
  const service = options.chainService ?? createChainService();

  app.get<{ Params: ProjectRouteParams }>(
    '/api/projects/:projectId/chains',
    async (request, reply) => {
      try {
        const projectPath = await resolveProjectPath(registry, request.params.projectId);
        const result = await service.list(projectPath);
        return reply.code(200).send({
          chains: result.chains,
          warnings: result.warnings,
        } satisfies ChainListResponse);
      } catch (error) {
        return sendChainFailure(reply, error);
      }
    },
  );

  app.get<{ Params: ChainRouteParams }>(
    '/api/projects/:projectId/chains/:chainId',
    async (request, reply) => {
      try {
        const projectPath = await resolveProjectPath(registry, request.params.projectId);
        const chain = await service.get(projectPath, request.params.chainId);
        return reply.code(200).send({ chain } satisfies ChainResponse);
      } catch (error) {
        return sendChainFailure(reply, error);
      }
    },
  );

  app.post<{ Params: ProjectRouteParams; Querystring: { uniqueName?: string } }>(
    '/api/projects/:projectId/chains',
    async (request, reply) => {
      const query = uniqueNameQuerySchema.safeParse(request.query);
      if (!query.success) {
        return sendValidationFailure(reply, 'The chain request is not valid.', query.error.issues);
      }

      const parsed = chainPayloadSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendValidationFailure(
          reply,
          'The chain request is not valid.',
          parsed.error.issues,
        );
      }

      const serverFieldIssues = createdChainServerFieldIssues(parsed.data);
      if (serverFieldIssues.length > 0) {
        return reply.code(422).send(
          createApiErrorEnvelope(
            API_ERROR_CODES.VALIDATION_ERROR,
            'The chain request is not valid.',
            { issues: serverFieldIssues },
          ),
        );
      }

      try {
        const projectPath = await resolveProjectPath(registry, request.params.projectId);
        const chain = await service.create(projectPath, toDraft(parsed.data), {
          uniqueName: wantsUniqueName(query.data.uniqueName, parsed.data.uniqueName),
        });
        return reply.code(201).send({ chain } satisfies ChainResponse);
      } catch (error) {
        return sendChainFailure(reply, error);
      }
    },
  );

  app.put<{ Params: ChainRouteParams; Querystring: { uniqueName?: string } }>(
    '/api/projects/:projectId/chains/:chainId',
    async (request, reply) => {
      const query = uniqueNameQuerySchema.safeParse(request.query);
      if (!query.success) {
        return sendValidationFailure(reply, 'The chain request is not valid.', query.error.issues);
      }

      const parsed = chainPayloadSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendValidationFailure(
          reply,
          'The chain request is not valid.',
          parsed.error.issues,
        );
      }

      const mismatch = updateServerFieldIssue(parsed.data, request.params.chainId);
      if (mismatch !== undefined) {
        return reply.code(422).send(
          createApiErrorEnvelope(
            API_ERROR_CODES.VALIDATION_ERROR,
            'The chain request is not valid.',
            { issues: [mismatch] },
          ),
        );
      }

      try {
        const projectPath = await resolveProjectPath(registry, request.params.projectId);
        const chain = await service.update(
          projectPath,
          request.params.chainId,
          toDraft(parsed.data),
          { uniqueName: wantsUniqueName(query.data.uniqueName, parsed.data.uniqueName) },
        );
        return reply.code(200).send({ chain } satisfies ChainResponse);
      } catch (error) {
        return sendChainFailure(reply, error);
      }
    },
  );

  app.post<{
    Params: ChainRouteParams;
    Querystring: { uniqueName?: string };
  }>(
    '/api/projects/:projectId/chains/:chainId/duplicate',
    async (request, reply) => {
      const query = uniqueNameQuerySchema.safeParse(request.query);
      if (!query.success) {
        return sendValidationFailure(reply, 'The chain request is not valid.', query.error.issues);
      }

      const parsed = duplicatePayloadSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return sendValidationFailure(
          reply,
          'The chain request is not valid.',
          parsed.error.issues,
        );
      }

      try {
        const projectPath = await resolveProjectPath(registry, request.params.projectId);
        const chain = await service.duplicate(projectPath, request.params.chainId, {
          ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
          uniqueName: wantsUniqueName(query.data.uniqueName, parsed.data.uniqueName),
        });
        return reply.code(201).send({ chain } satisfies ChainResponse);
      } catch (error) {
        return sendChainFailure(reply, error);
      }
    },
  );

  app.delete<{ Params: ChainRouteParams }>(
    '/api/projects/:projectId/chains/:chainId',
    async (request, reply) => {
      try {
        const projectPath = await resolveProjectPath(registry, request.params.projectId);
        await service.remove(projectPath, request.params.chainId);
        return reply.code(200).send({
          chainId: request.params.chainId,
          deleted: true,
        } satisfies ChainDeletedResponse);
      } catch (error) {
        return sendChainFailure(reply, error);
      }
    },
  );
};

/**
 * Resolve a project id to its canonical directory. The id must be in the
 * registry; the route never accepts or derives a path from the client.
 */
async function resolveProjectPath(
  registry: ProjectRegistry,
  projectId: string,
): Promise<string> {
  const project = isProjectId(projectId)
    ? await registry.findRecentProject(projectId)
    : undefined;
  if (!project) {
    throw new ChainStoreError(
      CHAIN_STORE_ERROR_CODES.PROJECT_NOT_FOUND,
      'No registered project matches that id.',
      { projectId },
    );
  }
  return project.canonicalPath;
}

/** A truthy query value or body flag requests name uniqueness. */
function wantsUniqueName(queryValue: string | undefined, bodyValue: unknown): boolean {
  return queryValue === 'true' || queryValue === '1' || bodyValue === true;
}

function toDraft(body: z.infer<typeof chainPayloadSchema>): ChainDraft {
  return {
    name: body.name,
    harness: body.harness,
    sessionMode: body.sessionMode,
    steps: body.steps,
    ...(body.inputs === undefined ? {} : { inputs: body.inputs }),
    ...(body.automaticPermissionOptIn === undefined
      ? {}
      : { automaticPermissionOptIn: body.automaticPermissionOptIn }),
  };
}

/** On create, identity and timestamps are server-owned. */
function createdChainServerFieldIssues(
  body: z.infer<typeof chainPayloadSchema>,
): ApiValidationIssue[] {
  const issues: ApiValidationIssue[] = [];
  if (body.id !== undefined) {
    issues.push({
      path: 'id',
      code: 'server_generated',
      message: 'Chain ids are generated by the server.',
    });
  }
  if (body.version !== undefined && body.version !== CHAIN_VERSION) {
    issues.push({
      path: 'version',
      code: 'invalid_value',
      message: `Only chain version ${String(CHAIN_VERSION)} is supported.`,
    });
  }
  return issues;
}

/** On update, a supplied id must address the same chain; version must be current. */
function updateServerFieldIssue(
  body: z.infer<typeof chainPayloadSchema>,
  chainId: string,
): ApiValidationIssue | undefined {
  if (body.id !== undefined && body.id !== chainId) {
    return {
      path: 'id',
      code: 'id_mismatch',
      message: 'The chain id in the body must match the chain id in the path.',
    };
  }
  if (body.version !== undefined && body.version !== CHAIN_VERSION) {
    return {
      path: 'version',
      code: 'invalid_value',
      message: `Only chain version ${String(CHAIN_VERSION)} is supported.`,
    };
  }
  return undefined;
}

function sendChainFailure(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof ChainValidationError) {
    return reply.code(422).send(
      createApiErrorEnvelope(API_ERROR_CODES.VALIDATION_ERROR, error.message, {
        issues: error.issues,
      }),
    );
  }

  if (error instanceof ChainStoreError) {
    return reply
      .code(STATUS_BY_STORE_CODE[error.code] ?? 500)
      .send(createApiErrorEnvelope(error.code, error.message, error.details));
  }

  if (error instanceof ChainServiceError) {
    const status = error.code === CHAIN_SERVICE_ERROR_CODES.NAME_EXISTS ? 409 : 500;
    return reply
      .code(status)
      .send(createApiErrorEnvelope(error.code, error.message, error.details));
  }

  if (error instanceof ConfigError) {
    // A corrupt or unwritable configuration is a typed failure, not an empty
    // chain library and not a silent reset.
    return reply
      .code(500)
      .send(createApiErrorEnvelope(error.code, error.message, error.details));
  }

  throw error;
}

function sendValidationFailure(
  reply: FastifyReply,
  message: string,
  issues: ReadonlyArray<{ path: PropertyKey[]; code: string; message: string }>,
): FastifyReply {
  return reply.code(422).send(
    createApiErrorEnvelope(API_ERROR_CODES.VALIDATION_ERROR, message, {
      issues: issues.map(
        (issue): ApiValidationIssue => ({
          path: issue.path.map((segment) => String(segment)).join('.'),
          code: issue.code,
          message: issue.message,
        }),
      ),
    }),
  );
}
