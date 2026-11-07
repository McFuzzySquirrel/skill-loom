import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import {
  API_ERROR_CODES,
  createApiErrorEnvelope,
  type ApiValidationIssue,
} from '../../shared/api.js';
import { BundleError, exportBundle } from '../chains/bundle.js';
import type { Chain } from '../chains/model.js';
import { createGlobalDraftService } from '../chains/drafts.js';
import type { ChainDraft, ChainService } from '../chains/service.js';
import {
  DraftBundleStoreError,
  draftBundleMatchesChain,
  readDraftBundle,
  removeDraftBundle,
  saveDraftBundle,
  updateDraftBundleChain,
} from '../chains/draft-bundles.js';
import {
  createCatalogService,
  type CatalogService,
} from '../catalog/merge.js';
import { SKILL_SOURCE_ORDER, type SkillHarness } from '../catalog/types.js';
import {
  CHAIN_ID_PATTERN,
  type ChainListResult,
} from '../chains/store.js';
import type { ConfigStore } from '../config/store.js';
import { createProjectRegistry, isProjectId } from '../projects/registry.js';
import { sendChainFailure } from './chains.js';

const draftPayloadSchema = z.strictObject({
  name: z.string(),
  harness: z.string(),
  sessionMode: z.string(),
  steps: z.array(z.unknown()),
  inputs: z.array(z.unknown()).optional(),
  automaticPermissionOptIn: z.boolean().optional(),
  agent: z.unknown().optional(),
});

const catalogQuerySchema = z.strictObject({
  harness: z.enum(['opencode', 'copilot']),
  query: z.string().max(200).optional(),
  sourceProjectId: z.string().min(1).max(128).refine(isProjectId).optional(),
});

export interface DraftRoutesOptions {
  configStore: ConfigStore;
  draftService?: ChainService;
  catalogService?: CatalogService;
}

interface DraftParams {
  draftId: string;
}

export const draftRoutes: FastifyPluginAsync<DraftRoutesOptions> = async (
  app,
  options,
) => {
  let service = options.draftService;
  const getConfigDirectory = () => options.configStore.getConfigDir();
  const getDraftService = () => {
    service ??= createGlobalDraftService(getConfigDirectory());
    return service;
  };
  const catalogService =
    options.catalogService ??
    createCatalogService({ configStore: options.configStore });
  const projectRegistry = createProjectRegistry({ configStore: options.configStore });

  app.get('/api/drafts', async (_request, reply) => {
    try {
      const configDirectory = getConfigDirectory();
      const result = await getDraftService().list(configDirectory);
      return reply.code(200).send({
        chains: result.chains,
        warnings: result.warnings,
      } satisfies ChainListResult);
    } catch (error) {
      return sendChainFailure(reply, error);
    }
  });

  app.get<{ Params: DraftParams }>('/api/drafts/:draftId', async (request, reply) => {
    try {
      const configDirectory = getConfigDirectory();
      const chain = await getDraftService().get(configDirectory, request.params.draftId);
      return reply.code(200).send({ chain } satisfies { chain: Chain });
    } catch (error) {
      return sendChainFailure(reply, error);
    }
  });

  app.get<{ Params: DraftParams }>('/api/drafts/:draftId/bundle', async (request, reply) => {
    try {
      const configDirectory = getConfigDirectory();
      const chain = await getDraftService().get(configDirectory, request.params.draftId);
      const frozenBundle = await readDraftBundle(configDirectory, chain.id);
      if (frozenBundle !== null) {
        if (!draftBundleMatchesChain(frozenBundle, chain)) {
          throw new DraftBundleStoreError(
            'The saved global draft no longer matches its frozen package bundle.',
          );
        }
        return reply.code(200).send({
          bundle: updateDraftBundleChain(frozenBundle, chain),
        });
      }
      return reply.code(200).send({
        bundle: await exportBundle(chain, configDirectory, catalogService),
      });
    } catch (error) {
      if (error instanceof BundleError) {
        const status =
          error.code === 'BUNDLE_TOO_LARGE'
            ? 413
            : error.code === 'BUNDLE_CONFLICT'
              ? 409
              : 422;
        return reply.code(status).send(createApiErrorEnvelope(error.code, error.message));
      }
      return sendChainFailure(reply, error);
    }
  });

  app.get('/api/drafts/catalog', async (request, reply) => {
    const parsed = catalogQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendValidationFailure(reply, 'The draft catalog request is not valid.', parsed.error.issues);
    }

    try {
      const configDirectory = getConfigDirectory();
      const sourceCatalog = await catalogService.getCatalog({
        projectPath: configDirectory,
        harness: parsed.data.harness as SkillHarness,
        ...(parsed.data.query === undefined ? {} : { query: parsed.data.query }),
      });
      const entriesBySource = new Map(
        SKILL_SOURCE_ORDER.map((source) => [source, new Map<string, (typeof sourceCatalog.groups)[number]['entries'][number]>()]),
      );
      for (const group of sourceCatalog.groups) {
        if (group.source === 'project') continue;
        const entries = entriesBySource.get(group.source);
        for (const entry of group.entries) entries?.set(entry.id, entry);
      }
      let warnings = sourceCatalog.warnings;
      if (parsed.data.sourceProjectId !== undefined) {
        const project = await projectRegistry.findRecentProject(parsed.data.sourceProjectId);
        if (project === undefined || project.managedWorkspace === true) {
          return reply.code(404).send(
            createApiErrorEnvelope('PROJECT_NOT_FOUND', 'The selected source project is not available.'),
          );
        }
        const projectCatalog = await catalogService.getCatalog({
          projectPath: project.canonicalPath,
          harness: parsed.data.harness as SkillHarness,
          ...(parsed.data.query === undefined ? {} : { query: parsed.data.query }),
        });
        const projectEntries = entriesBySource.get('project');
        for (const group of projectCatalog.groups) {
          if (group.source !== 'project') continue;
          for (const entry of group.entries) projectEntries?.set(entry.id, entry);
        }
        warnings = [...warnings, ...projectCatalog.warnings];
      }
      const groups = [...entriesBySource.entries()]
        .map(([source, entries]) => ({
          source,
          entries: [...entries.values()],
          count: entries.size,
        }))
        .filter((group) => group.count > 0);
      const skills = groups.flatMap((group) => group.entries);
      const bySource = Object.fromEntries(
        SKILL_SOURCE_ORDER.map((source) => [
          source,
          entriesBySource.get(source)?.size ?? 0,
        ]),
      );
      return reply.code(200).send({
        harness: sourceCatalog.harness,
        query: sourceCatalog.query,
        total: skills.length,
        counts: { total: skills.length, bySource },
        groups,
        agents: sourceCatalog.agents,
        warnings,
        elapsedMs: sourceCatalog.elapsedMs,
      });
    } catch (error) {
      return sendChainFailure(reply, error);
    }
  });

  app.get<{ Params: { skillId: string }; Querystring: { harness?: string } }>(
    '/api/drafts/catalog/skills/:skillId',
    async (request, reply) => {
      const parsed = catalogQuerySchema.safeParse({
        harness: request.query.harness,
        sourceProjectId: (request.query as Record<string, unknown>).sourceProjectId,
      });
      if (!parsed.success) {
        return sendValidationFailure(
          reply,
          'The draft catalog request is not valid.',
          parsed.error.issues,
        );
      }
      try {
        const configDirectory = getConfigDirectory();
        const catalogs = [await catalogService.getCatalog({
          projectPath: configDirectory,
          harness: parsed.data.harness as SkillHarness,
        })];
        if (parsed.data.sourceProjectId !== undefined) {
          const project = await projectRegistry.findRecentProject(parsed.data.sourceProjectId);
          if (project === undefined || project.managedWorkspace === true) {
            return reply.code(404).send({
              error: { code: 'PROJECT_NOT_FOUND', message: 'The selected source project is not available.' },
            });
          }
          catalogs.push(await catalogService.getCatalog({
            projectPath: project.canonicalPath,
            harness: parsed.data.harness as SkillHarness,
          }));
        }
        const skill = catalogs
          .flatMap((catalog) => catalog.groups)
          .filter((group) => group.source !== 'project' || parsed.data.sourceProjectId !== undefined)
          .flatMap((group) => group.entries)
          .find((entry) => entry.id === request.params.skillId);
        if (skill === undefined) {
          return reply.code(404).send({
            error: { code: 'SKILL_NOT_FOUND', message: 'The skill is not available in the selected catalogs.' },
          });
        }
        const content = await readFile(skill.path, 'utf8');
        return reply.code(200).send({
          id: skill.id,
          harness: skill.harness,
          name: skill.name,
          path: skill.path,
          content,
        });
      } catch (error) {
        return sendChainFailure(reply, error);
      }
    },
  );

  app.post('/api/drafts', async (request, reply) => {
    const parsed = draftPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationFailure(reply, 'The draft request is not valid.', parsed.error.issues);
    }

    try {
      const configDirectory = getConfigDirectory();
      const chain = await getDraftService().create(configDirectory, toDraft(parsed.data));
      return reply.code(201).send({ chain } satisfies { chain: Chain });
    } catch (error) {
      return sendChainFailure(reply, error);
    }
  });

  app.put<{ Params: DraftParams }>('/api/drafts/:draftId', async (request, reply) => {
    if (!CHAIN_ID_PATTERN.test(request.params.draftId)) {
      return reply.code(422).send(
        createApiErrorEnvelope(API_ERROR_CODES.VALIDATION_ERROR, 'The draft id is not valid.'),
      );
    }
    const parsed = draftPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationFailure(reply, 'The draft request is not valid.', parsed.error.issues);
    }

    try {
      const configDirectory = getConfigDirectory();
      const currentBundle = await readDraftBundle(configDirectory, request.params.draftId);
      const nextNames = uniqueSkillNames(parsed.data.steps);
      const availableNames = new Set(currentBundle?.skills.map((skill) => skill.name) ?? []);
      if (
        currentBundle !== null &&
        nextNames.some((name) => !availableNames.has(name))
      ) {
        return reply.code(409).send(
          createApiErrorEnvelope(
            'DRAFT_PACKAGE_SET_FIXED',
            'This accepted discovery draft contains a frozen package set. Create a new draft from the current catalog to add different packages.',
          ),
        );
      }
      const previous = await getDraftService().get(configDirectory, request.params.draftId);
      const chain = await getDraftService().update(
        configDirectory,
        request.params.draftId,
        toDraft(parsed.data),
      );
      if (currentBundle !== null) {
        const retainedNames = new Set(nextNames);
        const updatedBundle = {
          ...updateDraftBundleChain(currentBundle, chain),
          skills: currentBundle.skills.filter((skill) => retainedNames.has(skill.name)),
        };
        try {
          await saveDraftBundle(configDirectory, chain.id, chain, updatedBundle);
        } catch (error) {
          await getDraftService().update(
            configDirectory,
            previous.id,
            toDraft({
              name: previous.name,
              harness: previous.harness,
              sessionMode: previous.sessionMode,
              steps: previous.steps,
              inputs: previous.inputs,
              automaticPermissionOptIn: previous.automaticPermissionOptIn,
              ...(previous.agent === undefined ? {} : { agent: previous.agent }),
            }),
          );
          throw error;
        }
      }
      return reply.code(200).send({ chain } satisfies { chain: Chain });
    } catch (error) {
      return sendChainFailure(reply, error);
    }
  });

  app.delete<{ Params: DraftParams }>('/api/drafts/:draftId', async (request, reply) => {
    try {
      const configDirectory = getConfigDirectory();
      await getDraftService().remove(configDirectory, request.params.draftId);
      await removeDraftBundle(configDirectory, request.params.draftId);
      return reply.code(200).send({ draftId: request.params.draftId, deleted: true });
    } catch (error) {
      return sendChainFailure(reply, error);
    }
  });
};

function toDraft(body: z.infer<typeof draftPayloadSchema>): ChainDraft {
  return {
    name: body.name,
    harness: body.harness,
    sessionMode: body.sessionMode,
    steps: body.steps,
    inputs: body.inputs ?? [],
    automaticPermissionOptIn: body.automaticPermissionOptIn ?? false,
    ...(body.agent === undefined ? {} : { agent: body.agent }),
  };
}

function uniqueSkillNames(steps: unknown[]): string[] {
  const names: string[] = [];
  for (const step of steps) {
    if (
      typeof step === 'object' &&
      step !== null &&
      'skillName' in step &&
      typeof step.skillName === 'string' &&
      !names.includes(step.skillName)
    ) {
      names.push(step.skillName);
    }
  }
  return names;
}

function sendValidationFailure(
  reply: FastifyReply,
  message: string,
  issues: ReadonlyArray<{ path: PropertyKey[]; code: string; message: string }>,
): FastifyReply {
  const validationIssues: ApiValidationIssue[] = issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    code: issue.code,
    message: issue.message,
  }));
  return reply.code(422).send(
    createApiErrorEnvelope(API_ERROR_CODES.VALIDATION_ERROR, message, {
      issues: validationIssues,
    }),
  );
}
