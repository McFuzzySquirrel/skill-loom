import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  API_ERROR_CODES,
  createApiErrorEnvelope,
  type ApiValidationIssue,
} from '../../shared/api.js';
import {
  createGlobalChainService,
  type GlobalChainService,
} from '../chains/library.js';
import { createChainService, type ChainService } from '../chains/service.js';
import type { Chain } from '../chains/model.js';
import type { ChainListResult } from '../chains/store.js';
import type { ConfigStore } from '../config/store.js';
import {
  createProjectRegistry,
  type ProjectRegistry,
} from '../projects/registry.js';
import { resolveProjectPath, sendChainFailure } from './chains.js';

/**
 * Global chain template routes.
 *
 * A template is a snapshot copied out of a project chain. The browser names a
 * registered project and a saved chain; the server reads the authoritative
 * chain document and writes the template. No client-supplied chain body or
 * filesystem path is accepted.
 */

const saveTemplateBodySchema = z.strictObject({
  projectId: z.string().min(1).max(64),
  chainId: z.string().min(1).max(64),
  name: z.string().optional(),
});

interface TemplateParams {
  chainId: string;
}

interface TemplateResponse {
  chain: Chain;
}

export interface GlobalChainRoutesOptions {
  configStore: ConfigStore;
  projectRegistry?: ProjectRegistry;
  chainService?: ChainService;
  globalChainService?: GlobalChainService;
}

export const globalChainRoutes: FastifyPluginAsync<GlobalChainRoutesOptions> = async (
  app,
  options,
) => {
  const registry =
    options.projectRegistry ??
    createProjectRegistry({ configStore: options.configStore });
  const chainService = options.chainService ?? createChainService();
  const globalService = (): GlobalChainService =>
    options.globalChainService ??
    createGlobalChainService({ configDirectory: options.configStore.getConfigDir() });

  app.get('/api/chains', async (_request, reply) => {
    try {
      const result = await globalService().list();
      return reply.code(200).send({
        chains: result.chains,
        warnings: result.warnings,
      } satisfies ChainListResult);
    } catch (error) {
      return sendChainFailure(reply, error);
    }
  });

  app.post('/api/chains', async (request, reply) => {
    const parsed = saveTemplateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationFailure(
        reply,
        'The global chain request is not valid.',
        parsed.error.issues,
      );
    }

    try {
      const projectPath = await resolveProjectPath(registry, parsed.data.projectId);
      const source = await chainService.get(projectPath, parsed.data.chainId);
      const chain = await globalService().save(source, {
        ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
      });
      return reply.code(201).send({ chain } satisfies TemplateResponse);
    } catch (error) {
      return sendChainFailure(reply, error);
    }
  });

  app.delete<{ Params: TemplateParams }>('/api/chains/:chainId', async (request, reply) => {
    try {
      await globalService().remove(request.params.chainId);
      return reply.code(200).send({
        chainId: request.params.chainId,
        deleted: true,
      });
    } catch (error) {
      return sendChainFailure(reply, error);
    }
  });
};

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
