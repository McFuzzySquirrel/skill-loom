import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createApiErrorEnvelope } from '../../shared/api.js';
import { createCatalogService } from '../catalog/merge.js';
import {
  BundleError, exportBundle, importBundle, MAX_BUNDLE_REQUEST_BYTES, previewBundle,
} from '../chains/bundle.js';
import { createChainService } from '../chains/service.js';
import { createProjectRegistry } from '../projects/registry.js';
import type { CatalogRoutesOptions } from './catalog.js';
import { resolveProjectPath, sendChainFailure, type ChainRoutesOptions } from './chains.js';

const payloadSchema = z.strictObject({
  bundle: z.unknown(),
  reuseSkills: z.array(z.string()).max(100).default([]),
  confirmed: z.boolean().default(false),
});

export const chainBundleRoutes: FastifyPluginAsync<ChainRoutesOptions & CatalogRoutesOptions> = async (app, options) => {
  const registry = options.projectRegistry ?? createProjectRegistry({ configStore: options.configStore });
  const chains = options.chainService ?? createChainService();
  const catalog = options.catalogService ?? createCatalogService({ configStore: options.configStore });
  const failure = (reply: Parameters<typeof sendChainFailure>[0], error: unknown) => {
    if (error instanceof BundleError) {
      const status = error.code === 'BUNDLE_CONFLICT' ? 409 : error.code === 'BUNDLE_TOO_LARGE' ? 413 : 422;
      return reply.code(status).send(createApiErrorEnvelope(error.code, error.message));
    }
    return sendChainFailure(reply, error);
  };

  app.get<{ Params: { projectId: string; chainId: string } }>(
    '/api/projects/:projectId/chains/:chainId/bundle',
    async (request, reply) => {
      try {
        const path = await resolveProjectPath(registry, request.params.projectId);
        const chain = await chains.get(path, request.params.chainId);
        return reply.send({ bundle: await exportBundle(chain, path, catalog) });
      } catch (error) {
        return failure(reply, error);
      }
    },
  );
  for (const action of ['preview', 'import'] as const) {
    app.post<{ Params: { projectId: string } }>(
      `/api/projects/:projectId/chain-bundles/${action}`,
      { bodyLimit: MAX_BUNDLE_REQUEST_BYTES },
      async (request, reply) => {
        try {
          const parsed = payloadSchema.safeParse(request.body);
          if (!parsed.success) throw new BundleError('BUNDLE_INVALID', 'The bundle request is not valid.');
          const path = await resolveProjectPath(registry, request.params.projectId);
          if (action === 'preview') return reply.send(await previewBundle(parsed.data.bundle, path, catalog));
          if (!parsed.data.confirmed) throw new BundleError('BUNDLE_INVALID', 'Review the bundle and explicitly confirm import first.');
          const chain = await importBundle(parsed.data.bundle, path, catalog, chains, parsed.data.reuseSkills);
          return reply.code(201).send({ chain });
        } catch (error) {
          return failure(reply, error);
        }
      },
    );
  }
};
