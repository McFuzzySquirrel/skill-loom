import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  API_ERROR_CODES,
  createApiErrorEnvelope,
  type ApiValidationIssue,
} from '../../shared/api.js';
import { ConfigError } from '../config/store.js';
import type { ConfigStore } from '../config/store.js';
import type { RecentProject } from '../config/schema.js';
import {
  FolderPathError,
  type FolderPathErrorCode,
} from '../projects/paths.js';
import {
  MAX_PROJECT_NAME_LENGTH,
  ProjectRegistryError,
  createProjectRegistry,
  type GitInitRunner,
  type ProjectErrorCode,
  type ProjectRegistration,
  type ProjectRegistry,
} from '../projects/registry.js';

const MAX_PATH_LENGTH = 4_096;

const openProjectSchema = z.strictObject({
  mode: z.literal('open').optional(),
  path: z.string().min(1).max(MAX_PATH_LENGTH),
});

const createProjectSchema = z.strictObject({
  mode: z.literal('create'),
  parentPath: z.string().min(1).max(MAX_PATH_LENGTH),
  name: z.string().min(1).max(MAX_PROJECT_NAME_LENGTH),
  gitInit: z.boolean().optional(),
});

export interface ProjectRoutesOptions {
  /** Global configuration store that owns recent projects. */
  configStore: ConfigStore;
  /** Injected registry; defaults to the filesystem-backed implementation. */
  projectRegistry?: ProjectRegistry;
  /** Git initializer seam forwarded to the default registry. */
  gitInit?: GitInitRunner;
  /** Clock seam forwarded to the default registry. */
  now?: () => Date;
}

interface ProjectRouteParams {
  projectId: string;
}

interface ProjectRegistrationResponse {
  project: ProjectRegistration;
}

interface RecentProjectsResponse {
  projects: RecentProject[];
}

/** HTTP status for each typed registry failure. */
const STATUS_BY_PROJECT_CODE: Record<ProjectErrorCode, number> = {
  PROJECT_CREATE_TARGET_EXISTS: 409,
  PROJECT_CREATE_FAILED: 500,
  PROJECT_NAME_INVALID: 422,
  PROJECT_ID_INVALID: 422,
  PROJECT_PARENT_NOT_FOUND: 404,
  PROJECT_PARENT_NOT_DIRECTORY: 400,
  PROJECT_PARENT_UNREADABLE: 403,
  RECENT_PROJECT_NOT_FOUND: 404,
  PROJECT_LOOM_SETUP_FAILED: 500,
  GIT_UNAVAILABLE: 503,
  GIT_INIT_FAILED: 500,
};

/** HTTP status for the shared folder-path failures reused by project routes. */
const STATUS_BY_FOLDER_CODE: Record<FolderPathErrorCode, number> = {
  PATH_REQUIRED: 422,
  PATH_NOT_ABSOLUTE: 422,
  PATH_INVALID: 422,
  PATH_NOT_FOUND: 404,
  PATH_NOT_DIRECTORY: 400,
  PATH_UNREADABLE: 403,
};

/**
 * Project registration, recent-list, and recent-removal routes.
 *
 * Handlers only validate input, delegate to the registry, and translate typed
 * failures into the shared envelope. The registry owns every filesystem and
 * configuration write; a client-supplied path is only ever an open/create
 * input, never an id.
 */
export const projectRoutes: FastifyPluginAsync<ProjectRoutesOptions> = async (
  app,
  options,
) => {
  const registry =
    options.projectRegistry ??
    createProjectRegistry({
      configStore: options.configStore,
      ...(options.gitInit === undefined ? {} : { gitInit: options.gitInit }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });

  app.post('/api/projects', async (request, reply) => {
    const mode = requestMode(request.body);
    const parsed =
      mode === 'create'
        ? createProjectSchema.safeParse(request.body)
        : openProjectSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(422).send(
        createApiErrorEnvelope(
          API_ERROR_CODES.VALIDATION_ERROR,
          'The project request is not valid.',
          { issues: toValidationIssues(parsed.error.issues) },
        ),
      );
    }

    try {
      if (mode === 'create') {
        const body = parsed.data as z.infer<typeof createProjectSchema>;
        const project = await registry.createProject({
          parentPath: body.parentPath,
          name: body.name,
          ...(body.gitInit === undefined ? {} : { gitInit: body.gitInit }),
        });
        return reply.code(201).send({ project } satisfies ProjectRegistrationResponse);
      }

      const body = parsed.data as z.infer<typeof openProjectSchema>;
      const project = await registry.openProject(body.path);
      return reply.code(200).send({ project } satisfies ProjectRegistrationResponse);
    } catch (error) {
      return sendProjectFailure(reply, error);
    }
  });

  app.get('/api/projects/recent', async (_request, reply) => {
    try {
      const projects = await registry.listRecentProjects();
      return reply.code(200).send({ projects } satisfies RecentProjectsResponse);
    } catch (error) {
      return sendProjectFailure(reply, error);
    }
  });

  app.delete<{ Params: ProjectRouteParams }>(
    '/api/projects/recent/:projectId',
    async (request, reply) => {
      try {
        const removed = await registry.removeRecentProject(request.params.projectId);
        return reply.code(200).send(removed);
      } catch (error) {
        return sendProjectFailure(reply, error);
      }
    },
  );
};

function requestMode(body: unknown): 'open' | 'create' {
  return isRecord(body) && body.mode === 'create' ? 'create' : 'open';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sendProjectFailure(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof ProjectRegistryError) {
    return reply
      .code(STATUS_BY_PROJECT_CODE[error.code] ?? 500)
      .send(createApiErrorEnvelope(error.code, error.message, error.details));
  }

  if (error instanceof FolderPathError) {
    return reply
      .code(STATUS_BY_FOLDER_CODE[error.code] ?? 500)
      .send(createApiErrorEnvelope(error.code, error.message, error.details));
  }

  if (error instanceof ConfigError) {
    // A corrupt or unwritable configuration must be visible as a typed
    // failure, not silently replaced with defaults or hidden behind a 200.
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
