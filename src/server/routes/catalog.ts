import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  API_ERROR_CODES,
  createApiErrorEnvelope,
  type ApiValidationIssue,
} from '../../shared/api.js';
import {
  createCatalogService,
  addExtraSkillDirectory,
  listExtraSkillDirectories,
  removeExtraSkillDirectory,
  ExtraDirectoryError,
  type CatalogService,
  type ExtraDirectoryErrorCode,
} from '../catalog/merge.js';
import {
  CATALOG_ERROR_CODES,
  CatalogError,
  SKILL_HARNESSES,
  type CatalogErrorCode,
} from '../catalog/types.js';
import { ConfigError } from '../config/store.js';
import type { ConfigStore } from '../config/store.js';
import {
  FolderPathError,
  type FolderPathErrorCode,
} from '../projects/paths.js';
import {
  createProjectRegistry,
  isProjectId,
  type ProjectRegistry,
} from '../projects/registry.js';

const MAX_PATH_LENGTH = 4_096;
const MAX_QUERY_LENGTH = 500;

/**
 * An empty `harness=` is treated as "use the service default". Every other
 * value must be one of the registered harness ids; the route never inspects
 * the value itself.
 */
const catalogQuerySchema = z.object({
  harness: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.enum(SKILL_HARNESSES).optional(),
  ),
  q: z.string().max(MAX_QUERY_LENGTH).optional(),
});

const extraDirectoryBodySchema = z.strictObject({
  path: z.string().min(1).max(MAX_PATH_LENGTH),
});

const extraDirectoryDeleteSchema = z.object({
  path: z.string().min(1).max(MAX_PATH_LENGTH),
});

export interface CatalogRoutesOptions {
  /** Global configuration store that owns extra skill directories. */
  configStore: ConfigStore;
  /** Injected catalog service. Defaults to the v1 adapter registry. */
  catalogService?: CatalogService;
  /** Injected project registry. Defaults to the config-backed registry. */
  projectRegistry?: ProjectRegistry;
}

interface ProjectRouteParams {
  projectId: string;
}

interface ExtraDirectoryResponse {
  extraSkillDirectories: string[];
}

interface ExtraDirectoryMutationResponse extends ExtraDirectoryResponse {
  directory: string;
}

/** HTTP status for each harness-neutral catalog failure. */
const STATUS_BY_CATALOG_CODE: Record<CatalogErrorCode, number> = {
  CATALOG_PROJECT_PATH_INVALID: 422,
  CATALOG_PROJECT_ID_INVALID: 422,
  CATALOG_PROJECT_NOT_FOUND: 404,
  CATALOG_HARNESS_UNSUPPORTED: 422,
};

/** HTTP status for an extra-directory conflict. */
const STATUS_BY_EXTRA_CODE: Record<ExtraDirectoryErrorCode, number> = {
  EXTRA_SKILL_DIRECTORY_DUPLICATE: 409,
  EXTRA_SKILL_DIRECTORY_NOT_FOUND: 404,
};

/** HTTP status for the folder-path failures reused by directory validation. */
const STATUS_BY_FOLDER_CODE: Record<FolderPathErrorCode, number> = {
  PATH_REQUIRED: 422,
  PATH_NOT_ABSOLUTE: 422,
  PATH_INVALID: 422,
  PATH_NOT_FOUND: 404,
  PATH_NOT_DIRECTORY: 400,
  PATH_UNREADABLE: 403,
};

/**
 * Catalog and extra-directory settings routes.
 *
 * The catalog route accepts a project id and never a filesystem path. It maps
 * the id to a registered canonical project directory, delegates discovery and
 * merge to the catalog service, and translates typed failures into the shared
 * error envelope. Settings mutations are global Slan configuration, never
 * project data.
 */
export const catalogRoutes: FastifyPluginAsync<CatalogRoutesOptions> = async (
  app,
  options,
) => {
  const service = options.catalogService ?? createCatalogService({
    configStore: options.configStore,
  });
  const registry =
    options.projectRegistry ??
    createProjectRegistry({ configStore: options.configStore });

  app.get<{
    Params: ProjectRouteParams;
    Querystring: { harness?: string; q?: string };
  }>('/api/projects/:projectId/catalog', async (request, reply) => {
    const parsed = catalogQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(422).send(
        createApiErrorEnvelope(
          API_ERROR_CODES.VALIDATION_ERROR,
          'The catalog request is not valid.',
          { issues: toValidationIssues(parsed.error.issues) },
        ),
      );
    }

    try {
      const project = await resolveRegisteredProject(registry, request.params.projectId);
      const catalog = await service.getCatalog({
        projectPath: project.canonicalPath,
        harness: parsed.data.harness ?? service.defaultHarness,
        ...(parsed.data.q === undefined ? {} : { query: parsed.data.q }),
      });
      return reply.code(200).send(catalog);
    } catch (error) {
      return sendCatalogFailure(reply, error);
    }
  });

  app.get('/api/settings/extra-skill-directories', async (_request, reply) => {
    try {
      const extraSkillDirectories = await listExtraSkillDirectories(options.configStore);
      return reply.code(200).send({ extraSkillDirectories } satisfies ExtraDirectoryResponse);
    } catch (error) {
      return sendCatalogFailure(reply, error);
    }
  });

  app.post<{ Body: unknown }>(
    '/api/settings/extra-skill-directories',
    async (request, reply) => {
      const parsed = extraDirectoryBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send(
          createApiErrorEnvelope(
            API_ERROR_CODES.VALIDATION_ERROR,
            'The extra directory request is not valid.',
            { issues: toValidationIssues(parsed.error.issues) },
          ),
        );
      }

      try {
        const result = await addExtraSkillDirectory(options.configStore, parsed.data.path);
        return reply.code(201).send(result satisfies ExtraDirectoryMutationResponse);
      } catch (error) {
        return sendCatalogFailure(reply, error);
      }
    },
  );

  app.delete<{ Querystring: { path?: string } }>(
    '/api/settings/extra-skill-directories',
    async (request, reply) => {
      const parsed = extraDirectoryDeleteSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(422).send(
          createApiErrorEnvelope(
            API_ERROR_CODES.VALIDATION_ERROR,
            'The extra directory request is not valid.',
            { issues: toValidationIssues(parsed.error.issues) },
          ),
        );
      }

      try {
        const result = await removeExtraSkillDirectory(options.configStore, parsed.data.path);
        return reply.code(200).send(result satisfies ExtraDirectoryMutationResponse);
      } catch (error) {
        return sendCatalogFailure(reply, error);
      }
    },
  );
};

async function resolveRegisteredProject(
  registry: ProjectRegistry,
  projectId: string,
): Promise<{ canonicalPath: string }> {
  if (!isProjectId(projectId)) {
    throw new CatalogError(
      CATALOG_ERROR_CODES.PROJECT_ID_INVALID,
      'The project id is not valid.',
      { projectId },
    );
  }

  const project = await registry.findRecentProject(projectId);
  if (!project) {
    throw new CatalogError(
      CATALOG_ERROR_CODES.PROJECT_NOT_FOUND,
      'No registered project matches that id.',
      { projectId },
    );
  }

  return { canonicalPath: project.canonicalPath };
}

function sendCatalogFailure(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof CatalogError) {
    return reply
      .code(STATUS_BY_CATALOG_CODE[error.code] ?? 500)
      .send(createApiErrorEnvelope(error.code, error.message, error.details));
  }

  if (error instanceof ExtraDirectoryError) {
    return reply
      .code(STATUS_BY_EXTRA_CODE[error.code] ?? 500)
      .send(createApiErrorEnvelope(error.code, error.message, error.details));
  }

  if (error instanceof FolderPathError) {
    return reply
      .code(STATUS_BY_FOLDER_CODE[error.code] ?? 500)
      .send(createApiErrorEnvelope(error.code, error.message, error.details));
  }

  if (error instanceof ConfigError) {
    // Corrupt or unwritable global configuration is a typed failure, never a
    // silent reset and never an empty catalog.
    return reply
      .code(500)
      .send(createApiErrorEnvelope(error.code, error.message, error.details));
  }

  throw error;
}

function toValidationIssues(
  issues: ReadonlyArray<{ path: PropertyKey[]; code: string; message: string }>,
): ApiValidationIssue[] {
  return issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join('.'),
    code: issue.code,
    message: issue.message,
  }));
}
