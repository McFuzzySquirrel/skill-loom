import { createHash } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  API_ERROR_CODES,
  createApiErrorEnvelope,
  type ApiValidationIssue,
} from '../../shared/api.js';
import { BundleError, exportBundle } from '../chains/bundle.js';
import { createGlobalDraftService } from '../chains/drafts.js';
import { createChainService, type ChainService } from '../chains/service.js';
import { createCatalogService, type CatalogService } from '../catalog/merge.js';
import { createProjectRegistry, type ProjectRegistry } from '../projects/registry.js';
import { resolveProjectPath, sendChainFailure } from './chains.js';
import {
  createSharedLibrary,
  SHARED_LIBRARY_ERROR_CODES,
  SharedLibraryError,
  type SharedLibrary,
} from '../bundles/shared-library.js';
import type { ConfigStore } from '../config/store.js';

const configureSchema = z.strictObject({
  directory: z.string().min(1).max(4_096).nullable(),
});

const publishSchema = z.strictObject({
  source: z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('project'),
      projectId: z.string().min(1).max(128),
      chainId: z.string().min(1).max(64),
    }),
    z.strictObject({
      type: z.literal('draft'),
      draftId: z.string().min(1).max(64),
    }),
  ]),
  displayName: z.string().trim().min(1).max(100),
  contentsReviewed: z.literal(true),
  redistributionReviewed: z.literal(true),
  reviewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});

export interface SharedBundleRoutesOptions {
  configStore: ConfigStore;
  projectRegistry?: ProjectRegistry;
  chainService?: ChainService;
  draftService?: ChainService;
  catalogService?: CatalogService;
  sharedLibrary?: SharedLibrary;
}

export const sharedBundleRoutes: FastifyPluginAsync<SharedBundleRoutesOptions> = async (
  app,
  options,
) => {
  const registry = options.projectRegistry ??
    createProjectRegistry({ configStore: options.configStore });
  const projectChains = options.chainService ?? createChainService();
  let drafts = options.draftService;
  const getDraftService = () => {
    drafts ??= createGlobalDraftService(options.configStore.getConfigDir());
    return drafts;
  };
  const catalog = options.catalogService ??
    createCatalogService({ configStore: options.configStore });
  const library = options.sharedLibrary ?? createSharedLibrary(options.configStore);

  app.get('/api/shared-bundles', async (_request, reply) => {
    try {
      return reply.code(200).send(await library.list());
    } catch (error) {
      return sendSharedFailure(reply, error);
    }
  });

  app.put('/api/shared-bundles/config', async (request, reply) => {
    const parsed = configureSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationFailure(reply, 'The shared-directory setting is not valid.', parsed.error.issues);
    }
    try {
      if (parsed.data.directory === null) {
        await options.configStore.update(() => ({ sharedBundleDirectory: null }));
        return reply.code(200).send({ directory: null });
      }
      const directory = await library.configure(parsed.data.directory);
      return reply.code(200).send({ directory });
    } catch (error) {
      return sendSharedFailure(reply, error);
    }
  });

  app.get<{ Params: { bundleId: string } }>(
    '/api/shared-bundles/:bundleId',
    async (request, reply) => {
      try {
        return reply.code(200).send({ bundle: await library.read(request.params.bundleId) });
      } catch (error) {
        return sendSharedFailure(reply, error);
      }
    },
  );

  app.post('/api/shared-bundles/publish', async (request, reply) => {
    const parsed = publishSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationFailure(
        reply,
        'Publishing requires review of bundle contents and redistribution rights.',
        parsed.error.issues,
      );
    }
    try {
      const chain = parsed.data.source.type === 'draft'
        ? await getDraftService().get(options.configStore.getConfigDir(), parsed.data.source.draftId)
        : await projectChains.get(
            await resolveProjectPath(registry, parsed.data.source.projectId),
            parsed.data.source.chainId,
          );
      const sourcePath = parsed.data.source.type === 'draft'
        ? options.configStore.getConfigDir()
        : await resolveProjectPath(registry, parsed.data.source.projectId);
      const bundle = await exportBundle(chain, sourcePath, catalog);
      const currentFingerprint = createHash('sha256')
        .update(JSON.stringify(bundle), 'utf8')
        .digest('hex');
      if (currentFingerprint !== parsed.data.reviewFingerprint) {
        throw new SharedLibraryError(
          SHARED_LIBRARY_ERROR_CODES.REVIEW_STALE,
          'The reviewed bundle changed before publication. Review the current contents again.',
        );
      }
      const entry = await library.publish(bundle, parsed.data.displayName);
      return reply.code(201).send({ entry });
    } catch (error) {
      return sendSharedFailure(reply, error);
    }
  });
};

const STATUS_BY_SHARED_CODE: Record<string, number> = {
  [SHARED_LIBRARY_ERROR_CODES.NOT_CONFIGURED]: 409,
  [SHARED_LIBRARY_ERROR_CODES.DIRECTORY_UNAVAILABLE]: 503,
  [SHARED_LIBRARY_ERROR_CODES.DIRECTORY_INVALID]: 422,
  [SHARED_LIBRARY_ERROR_CODES.BUNDLE_NOT_FOUND]: 404,
  [SHARED_LIBRARY_ERROR_CODES.BUNDLE_INVALID]: 422,
  [SHARED_LIBRARY_ERROR_CODES.BUNDLE_TOO_LARGE]: 413,
  [SHARED_LIBRARY_ERROR_CODES.PUBLISH_FAILED]: 503,
  [SHARED_LIBRARY_ERROR_CODES.COLLISION]: 503,
  [SHARED_LIBRARY_ERROR_CODES.REVIEW_STALE]: 409,
};

function sendSharedFailure(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof SharedLibraryError) {
    return reply.code(STATUS_BY_SHARED_CODE[error.code] ?? 500).send(
      createApiErrorEnvelope(error.code, error.message, error.details),
    );
  }
  if (error instanceof BundleError) {
    return reply
      .code(error.code === 'BUNDLE_TOO_LARGE' ? 413 : 422)
      .send(createApiErrorEnvelope(error.code, error.message));
  }
  return sendChainFailure(reply, error);
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
