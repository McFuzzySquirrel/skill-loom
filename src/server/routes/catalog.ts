import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
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
  CatalogCopyError,
  copyBundledScenarioSkill,
  copySkillIntoProject,
  type CatalogCopyErrorCode,
} from '../catalog/copy.js';
import {
  copyNativeAgentIntoProject,
  NativeAgentCopyError,
} from '../catalog/agent-copy.js';
import {
  REMOTE_SOURCE_ERROR_CODES,
  RemoteSourceError,
  getRemoteCatalogSettings,
  listRemoteSkillSnapshots,
  listRemoteSnapshotPage,
  listRemoteSkillSources,
  refreshRemoteSkillSource,
  registerRemoteSkillSource,
  setRemoteCatalogLimits,
  setRemoteSourceName,
  setRemoteSourceLimits,
  unregisterRemoteSkillSource,
} from '../catalog/remote.js';
import {
  CATALOG_ERROR_CODES,
  CatalogError,
  SKILL_HARNESSES,
  createSkillId,
  type CatalogErrorCode,
  type SkillEntry,
} from '../catalog/types.js';
import {
  scenarioCatalog,
  scenarioSkillPackagePath,
} from '../chains/presets.js';
import { ConfigError } from '../config/store.js';
import { RemoteCatalogLimitOverridesSchema } from '../config/schema.js';
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

const remoteSourceBodySchema = z.strictObject({
  repository: z.string().min(1).max(2_048),
  ref: z.string().min(1).max(255).optional(),
});
const remoteSourceNameBodySchema = z.strictObject({
  name: z.string().trim().max(120),
});
const remoteLimitsBodySchema = z.strictObject({ limits: RemoteCatalogLimitOverridesSchema });
const remoteSourceLimitsBodySchema = z.strictObject({ limits: RemoteCatalogLimitOverridesSchema.nullable() });

const bundledSkillCopyBodySchema = z.strictObject({
  harness: z.enum(SKILL_HARNESSES),
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

/** HTTP status for a skill package copy failure. */
const STATUS_BY_COPY_CODE: Record<CatalogCopyErrorCode, number> = {
  SKILL_ALREADY_IN_PROJECT: 409,
  SKILL_SOURCE_UNAVAILABLE: 404,
  SKILL_SOURCE_NOT_DIRECTORY: 422,
  SKILL_SOURCE_UNSAFE: 422,
  SKILL_DESTINATION_UNAVAILABLE: 500,
  SKILL_SYMLINK_UNSUPPORTED: 422,
  SKILL_PACKAGE_TOO_LARGE: 413,
  SKILL_COPY_FAILED: 500,
};
const STATUS_BY_NATIVE_AGENT_COPY_CODE: Record<
  ConstructorParameters<typeof NativeAgentCopyError>[0],
  number
> = {
  NATIVE_AGENT_UNAVAILABLE: 404,
  NATIVE_AGENT_UNSUPPORTED: 422,
  NATIVE_AGENT_CONFLICT: 409,
  NATIVE_AGENT_PATH_INVALID: 422,
  NATIVE_AGENT_COPY_FAILED: 500,
};

const STATUS_BY_REMOTE_SOURCE_CODE: Record<string, number> = {
  [REMOTE_SOURCE_ERROR_CODES.INVALID]: 422,
  [REMOTE_SOURCE_ERROR_CODES.NOT_FOUND]: 404,
  [REMOTE_SOURCE_ERROR_CODES.DUPLICATE]: 409,
  [REMOTE_SOURCE_ERROR_CODES.CLONE_FAILED]: 502,
  [REMOTE_SOURCE_ERROR_CODES.TIMEOUT]: 504,
  [REMOTE_SOURCE_ERROR_CODES.CANCELLED]: 409,
  [REMOTE_SOURCE_ERROR_CODES.TOO_LARGE]: 413,
  [REMOTE_SOURCE_ERROR_CODES.INVALID_PACKAGE]: 422,
  [REMOTE_SOURCE_ERROR_CODES.SNAPSHOT_CORRUPT]: 500,
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
 * error envelope. Settings mutations are global Skill Loom configuration, never
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

  app.get<{
    Params: ProjectRouteParams & { skillId: string };
    Querystring: { harness?: string; q?: string };
  }>(
    '/api/projects/:projectId/catalog/skills/:skillId',
    async (request, reply) => {
      const parsed = catalogQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(422).send(
          createApiErrorEnvelope(
            API_ERROR_CODES.VALIDATION_ERROR,
            'The skill detail request is not valid.',
            { issues: toValidationIssues(parsed.error.issues) },
          ),
        );
      }

      try {
        const project = await resolveRegisteredProject(registry, request.params.projectId);
        // The id is matched against a freshly discovered entry; a client can
        // never supply a filesystem path to this route.
        const catalog = await service.getCatalog({
          projectPath: project.canonicalPath,
          harness: parsed.data.harness ?? service.defaultHarness,
        });
        const entry = catalog.groups
          .flatMap((group) => group.entries)
          .find((candidate) => candidate.id === request.params.skillId);

        if (entry === undefined) {
          return reply
            .code(404)
            .send(
              createApiErrorEnvelope(
                'CATALOG_SKILL_NOT_FOUND',
                'No catalog entry matches that skill id for the selected harness.',
                { skillId: request.params.skillId },
              ),
            );
        }

        let content: string;
        try {
          content = await readFile(entry.path, 'utf8');
        } catch (error) {
          return reply.code(404).send(
            createApiErrorEnvelope(
              'CATALOG_SKILL_CONTENT_UNAVAILABLE',
              'The SKILL.md file could not be read. Refresh the catalog and try again.',
              { skillId: entry.id, path: entry.path, reason: errnoCode(error) },
            ),
          );
        }

        return reply.code(200).send({
          id: entry.id,
          harness: entry.harness,
          name: entry.name,
          path: entry.path,
          content,
        });
      } catch (error) {
        return sendCatalogFailure(reply, error);
      }
    },
  );

  app.post<{
    Params: ProjectRouteParams & { skillId: string };
    Querystring: { harness?: string; q?: string };
  }>(
    '/api/projects/:projectId/catalog/skills/:skillId/copy',
    async (request, reply) => {
      const parsed = catalogQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(422).send(
          createApiErrorEnvelope(
            API_ERROR_CODES.VALIDATION_ERROR,
            'The skill copy request is not valid.',
            { issues: toValidationIssues(parsed.error.issues) },
          ),
        );
      }

      try {
        const project = await resolveRegisteredProject(registry, request.params.projectId);
        const harness = parsed.data.harness ?? service.defaultHarness;
        // Re-discover before copying so the source path is authoritative and
        // never supplied by the browser.
        const catalog = await service.getCatalog({
          projectPath: project.canonicalPath,
          harness,
        });
        const entry = catalog.groups
          .flatMap((group) => group.entries)
          .find((candidate) => candidate.id === request.params.skillId);

        if (entry === undefined) {
          return reply.code(404).send(
            createApiErrorEnvelope(
              'CATALOG_SKILL_NOT_FOUND',
              'No catalog entry matches that skill id for the selected harness.',
              { skillId: request.params.skillId, harness },
            ),
          );
        }

        const copied = await copySkillIntoProject({
          projectPath: project.canonicalPath,
          harness,
          entry,
        });
        return reply.code(201).send({
          ...copied,
          harness,
          skillId: entry.id,
        });
      } catch (error) {
        return sendCatalogFailure(reply, error);
      }
    },
  );

  app.post<{
    Params: ProjectRouteParams & { agentId: string };
    Querystring: { harness?: string; q?: string };
  }>(
    '/api/projects/:projectId/catalog/agents/:agentId/copy',
    async (request, reply) => {
      const parsed = catalogQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(422).send(
          createApiErrorEnvelope(
            API_ERROR_CODES.VALIDATION_ERROR,
            'The native agent copy request is not valid.',
            { issues: toValidationIssues(parsed.error.issues) },
          ),
        );
      }

      try {
        const project = await resolveRegisteredProject(registry, request.params.projectId);
        const harness = parsed.data.harness ?? service.defaultHarness;
        const catalog = await service.getCatalog({
          projectPath: project.canonicalPath,
          harness,
        });
        const entry = catalog.agents.find((candidate) => candidate.id === request.params.agentId);
        if (entry === undefined) {
          return reply.code(404).send(
            createApiErrorEnvelope(
              'NATIVE_AGENT_NOT_FOUND',
              'No native agent snapshot matches that id for the selected harness.',
              { agentId: request.params.agentId, harness },
            ),
          );
        }

        const copied = await copyNativeAgentIntoProject({
          projectPath: project.canonicalPath,
          entry,
        });
        return reply.code(201).send({ ...copied, agentId: entry.id });
      } catch (error) {
        return sendCatalogFailure(reply, error);
      }
    },
  );

  app.post<{
    Params: ProjectRouteParams & { skillName: string };
    Body: unknown;
  }>(
    '/api/projects/:projectId/catalog/scenario-skills/:skillName/copy',
    async (request, reply) => {
      const parsed = bundledSkillCopyBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send(
          createApiErrorEnvelope(
            API_ERROR_CODES.VALIDATION_ERROR,
            'The bundled skill copy request is not valid.',
            { issues: toValidationIssues(parsed.error.issues) },
          ),
        );
      }

      try {
        const project = await resolveRegisteredProject(registry, request.params.projectId);
        const source = scenarioCatalog.skills.find(
          (candidate) => candidate.name === request.params.skillName,
        );
        if (source === undefined || !source.bundled) {
          return reply.code(404).send(
            createApiErrorEnvelope(
              'SCENARIO_SKILL_NOT_FOUND',
              'No bundled scenario skill matches that name.',
              { skillName: request.params.skillName },
            ),
          );
        }

        const harness = parsed.data.harness;
        const beforeCopy = await service.getCatalog({
          projectPath: project.canonicalPath,
          harness,
        });
        const existing = beforeCopy.groups
          .flatMap((group) => group.entries)
          .filter(
            (entry) =>
              entry.name.toLocaleLowerCase('en-US') ===
              source.name.toLocaleLowerCase('en-US'),
          );
        if (existing.length > 0) {
          return reply.code(409).send(
            createApiErrorEnvelope(
              'SCENARIO_SKILL_ALREADY_AVAILABLE',
              `A skill named "${source.name}" already exists for this project and harness. Resolve or rename it before adding another copy.`,
              {
                skillName: source.name,
                harness,
                existing: existing.map((entry) => ({
                  source: entry.source,
                  enabled: entry.enabled,
                })),
              },
            ),
          );
        }

        const packagePath = scenarioSkillPackagePath(source.name);
        if (packagePath === undefined) {
          return reply.code(404).send(
            createApiErrorEnvelope(
              'SCENARIO_SKILL_NOT_FOUND',
              'The bundled scenario skill package is not available.',
              { skillName: source.name },
            ),
          );
        }
        const skillFilePath = join(packagePath, 'SKILL.md');
        const entry: SkillEntry = {
          id: createSkillId({
            harness,
            source: 'builtin',
            path: skillFilePath,
            name: source.name,
          }),
          harness,
          source: 'builtin',
          name: source.name,
          description: '',
          path: skillFilePath,
          packagePath,
          enabled: true,
        };
        const copied = await copyBundledScenarioSkill({
          projectPath: project.canonicalPath,
          harness,
          entry,
          source,
        });

        let afterCopy: Awaited<ReturnType<CatalogService['getCatalog']>>;
        try {
          afterCopy = await service.getCatalog({
            projectPath: project.canonicalPath,
            harness,
          });
        } catch (error) {
          await removeCopiedSkill(copied.destinationPath, entry.id);
          throw error;
        }
        const matches = afterCopy.groups
          .flatMap((group) => group.entries)
          .filter(
            (candidate) =>
              candidate.name.toLocaleLowerCase('en-US') ===
              source.name.toLocaleLowerCase('en-US'),
          );
        const installed = matches.find(
          (candidate) =>
            candidate.enabled &&
            candidate.source === 'project' &&
            candidate.packagePath === copied.destinationPath,
        );
        if (installed === undefined || matches.length !== 1) {
          await removeCopiedSkill(copied.destinationPath, entry.id);
          return reply.code(422).send(
            createApiErrorEnvelope(
              'SCENARIO_SKILL_NOT_DISCOVERABLE',
              `The ${harness} catalog did not discover the copied skill. The package was removed; this scenario skill cannot currently be added for this harness.`,
              { skillName: source.name, harness },
            ),
          );
        }

        return reply.code(201).send({
          name: copied.name,
          harness,
          destinationPath: copied.destinationPath,
          revision: source.revision,
          catalogSkillId: installed.id,
        });
      } catch (error) {
        return sendCatalogFailure(reply, error);
      }
    },
  );

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

    app.get('/api/settings/remote-catalog-limits', async (_request, reply) => {
      try {
        return reply.send(await getRemoteCatalogSettings(options.configStore));
      } catch (error) {
        return sendCatalogFailure(reply, error);
      }
    });

    app.put<{ Body: unknown }>('/api/settings/remote-catalog-limits', async (request, reply) => {
      const parsed = remoteLimitsBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send(createApiErrorEnvelope(
          API_ERROR_CODES.VALIDATION_ERROR,
          'The remote catalog limits are not valid.',
          { issues: toValidationIssues(parsed.error.issues) },
        ));
      }
      try {
        return reply.send(await setRemoteCatalogLimits(options.configStore, parsed.data.limits));
      } catch (error) {
        return sendCatalogFailure(reply, error);
      }
    });

    app.put<{ Params: { sourceId: string }; Body: unknown }>(
      '/api/settings/remote-skill-sources/:sourceId/name',
      async (request, reply) => {
        const parsed = remoteSourceNameBodySchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(422).send(createApiErrorEnvelope(
            API_ERROR_CODES.VALIDATION_ERROR,
            'The remote source name is not valid.',
            { issues: toValidationIssues(parsed.error.issues) },
          ));
        }
        try {
          return reply.send({ source: await setRemoteSourceName(
            options.configStore,
            request.params.sourceId,
            parsed.data.name,
          ) });
        } catch (error) {
          return sendCatalogFailure(reply, error);
        }
      },
    );

    app.put<{ Params: { sourceId: string }; Body: unknown }>(
      '/api/settings/remote-skill-sources/:sourceId/limits',
      async (request, reply) => {
        const parsed = remoteSourceLimitsBodySchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(422).send(createApiErrorEnvelope(
            API_ERROR_CODES.VALIDATION_ERROR,
            'The remote source limits are not valid.',
            { issues: toValidationIssues(parsed.error.issues) },
          ));
        }
        try {
          return reply.send({ source: await setRemoteSourceLimits(options.configStore, request.params.sourceId, parsed.data.limits) });
        } catch (error) {
          return sendCatalogFailure(reply, error);
        }
      },
    );

    app.get('/api/settings/remote-skill-sources', async (_request, reply) => {
      try {
        return reply.code(200).send({
          remoteSkillSources: await listRemoteSkillSources(options.configStore),
        });
      } catch (error) {
        return sendCatalogFailure(reply, error);
      }
    });

    app.post<{ Body: unknown }>('/api/settings/remote-skill-sources', async (request, reply) => {
      const parsed = remoteSourceBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send(
          createApiErrorEnvelope(
            API_ERROR_CODES.VALIDATION_ERROR,
            'The remote skill source request is not valid.',
            { issues: toValidationIssues(parsed.error.issues) },
          ),
        );
      }
      try {
        const source = await registerRemoteSkillSource(options.configStore, {
          repository: parsed.data.repository,
          ...(parsed.data.ref === undefined ? {} : { ref: parsed.data.ref }),
        });
        return reply.code(201).send({ source });
      } catch (error) {
        return sendCatalogFailure(reply, error);
      }
    });

    app.delete<{ Params: { sourceId: string } }>(
      '/api/settings/remote-skill-sources/:sourceId',
      async (request, reply) => {
        try {
          await unregisterRemoteSkillSource(options.configStore, request.params.sourceId);
          return reply.code(200).send({
            remoteSkillSources: await listRemoteSkillSources(options.configStore),
          });
        } catch (error) {
          return sendCatalogFailure(reply, error);
        }
      },
    );

    app.get<{ Params: { sourceId: string } }>(
      '/api/settings/remote-skill-sources/:sourceId/snapshots',
      async (request, reply) => {
        try {
          return reply.code(200).send({
            snapshots: await listRemoteSkillSnapshots(
              options.configStore.getConfigDir(),
              request.params.sourceId,
            ),
          });
        } catch (error) {
          return sendCatalogFailure(reply, error);
        }
      },
    );

    app.get<{
      Params: { sourceId: string; revision: string };
      Querystring: { kind?: string; search?: string; offset?: string; limit?: string };
    }>('/api/settings/remote-skill-sources/:sourceId/snapshots/:revision/entries', async (request, reply) => {
      const query = z.strictObject({
        kind: z.enum(['skill', 'agent']),
        search: z.string().max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      }).safeParse(request.query);
      if (!query.success) {
        return reply.code(422).send(createApiErrorEnvelope(API_ERROR_CODES.VALIDATION_ERROR, 'The remote snapshot page request is not valid.'));
      }
      try {
        return reply.send(await listRemoteSnapshotPage(
          options.configStore.getConfigDir(),
          request.params.sourceId,
          request.params.revision,
          query.data,
        ));
      } catch (error) {
        return sendCatalogFailure(reply, error);
      }
    });

    app.post<{ Params: { sourceId: string }; Body: unknown }>(
      '/api/settings/remote-skill-sources/:sourceId/refresh',
      async (request, reply) => {
        const parsed = z.strictObject({
          revision: z.string().regex(/^[a-f0-9]{40,64}$/).optional(),
        }).safeParse(request.body ?? {});
        if (!parsed.success) {
          return reply.code(422).send(createApiErrorEnvelope(API_ERROR_CODES.VALIDATION_ERROR, 'The remote snapshot refresh request is not valid.'));
        }
        const controller = new AbortController();
        const cancel = (): void => { controller.abort(); };
        const onClose = (): void => { if (!reply.raw.writableFinished) cancel(); };
        request.raw.once('aborted', cancel);
        reply.raw.once('close', onClose);
        if (request.raw.aborted || reply.raw.destroyed) cancel();
        try {
          const snapshot = await refreshRemoteSkillSource(
            options.configStore,
            request.params.sourceId,
            { signal: controller.signal, ...(parsed.data.revision === undefined ? {} : { revision: parsed.data.revision }) },
          );
          return reply.code(201).send({ snapshot });
        } catch (error) {
          return sendCatalogFailure(reply, error);
        } finally {
          request.raw.removeListener('aborted', cancel);
          reply.raw.removeListener('close', onClose);
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

async function removeCopiedSkill(path: string, skillId: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch (error) {
    throw new CatalogCopyError(
      'SKILL_COPY_FAILED',
      'The bundled skill could not be removed after discovery failed.',
      { skillId, path, reason: errnoCode(error) },
      { cause: error },
    );
  }
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

  if (error instanceof CatalogCopyError) {
    return reply
      .code(STATUS_BY_COPY_CODE[error.code] ?? 500)
      .send(createApiErrorEnvelope(error.code, error.message, error.details));
  }

  if (error instanceof NativeAgentCopyError) {
    return reply
      .code(STATUS_BY_NATIVE_AGENT_COPY_CODE[error.code] ?? 500)
      .send(createApiErrorEnvelope(error.code, error.message, error.details));
  }

  if (error instanceof RemoteSourceError) {
    return reply
      .code(STATUS_BY_REMOTE_SOURCE_CODE[error.code] ?? 500)
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

/** Errno-style reason for a file read failure, never file content. */
function errnoCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }
  return 'READ_FAILED';
}
