import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ConfigStore } from '../config/store.js';
import {
  DiscoveryHandoffError,
  prepareDiscoveryHandoff,
} from '../catalog/discovery-handoff.js';
import { createApiErrorEnvelope } from '../../shared/api.js';
import { createChainService } from '../chains/service.js';
import { createProjectRegistry } from '../projects/registry.js';
import {
  createDiscoveryWorkspaceService,
  DISCOVERY_WORKSPACE_ERROR_CODES,
  DiscoveryWorkspaceError,
} from '../runs/discovery-workspaces.js';
import {
  DiscoveryHandoffSchema,
  MAX_HANDOFF_PACKAGES,
} from '../../shared/discovery-handoff.js';

export interface DiscoveryRoutesOptions {
  configStore: ConfigStore;
}

const workspaceCreateSchema = z.strictObject({
  goal: z.string().trim().min(1).max(1_000),
  harness: DiscoveryHandoffSchema.shape.harness,
  createdAt: DiscoveryHandoffSchema.shape.createdAt,
  reviewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  candidates: z.array(DiscoveryHandoffSchema.shape.candidates.element.pick({
    sourceId: true,
    revision: true,
    repositoryPath: true,
    fingerprint: true,
  })).min(1).max(MAX_HANDOFF_PACKAGES),
  contentsReviewed: z.literal(true),
  redistributionReviewed: z.literal(true),
  autoImport: z.boolean(),
});
const resultReviewSchema = z.strictObject({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  contentsReviewed: z.literal(true),
  redistributionReviewed: z.literal(true),
});

export const discoveryRoutes: FastifyPluginAsync<DiscoveryRoutesOptions> = async (
  app,
  options,
) => {
  const projectRegistry = createProjectRegistry({ configStore: options.configStore });
  const chainService = createChainService();
  const workspaceService = createDiscoveryWorkspaceService({
    configStore: options.configStore,
    projectRegistry,
    chainService,
  });

  app.post('/api/discovery/handoffs', async (request, reply) => {
    try {
      const handoff = await prepareDiscoveryHandoff(options.configStore, request.body);
      return reply.code(200).send(handoff);
    } catch (error) {
      return sendDiscoveryFailure(reply, error);
    }
  });

  app.get('/api/discovery/workspaces', async (_request, reply) => {
    try {
      return reply.code(200).send({ workspaces: await workspaceService.list() });
    } catch (error) {
      return sendDiscoveryFailure(reply, error);
    }
  });

  app.post('/api/discovery/workspaces', async (request, reply) => {
    const parsed = workspaceCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send(
        createApiErrorEnvelope(
          'DISCOVERY_WORKSPACE_INVALID',
          'Review the complete candidate contents and redistribution rights before preparing a discovery workspace.',
        ),
      );
    }
    try {
      const { reviewFingerprint, ...input } = parsed.data;
      const result = await workspaceService.create({
        ...input,
        reviewFingerprint,
      });
      return reply.code(201).send(result);
    } catch (error) {
      return sendDiscoveryFailure(reply, error);
    }
  });

  app.delete<{ Params: { workspaceId: string } }>(
    '/api/discovery/workspaces/:workspaceId',
    async (request, reply) => {
      if (!z.uuid().safeParse(request.params.workspaceId).success) {
        return reply.code(422).send(createApiErrorEnvelope(
          'DISCOVERY_WORKSPACE_INVALID',
          'The discovery workspace id is not valid.',
        ));
      }
      try {
        return reply.code(200).send(await workspaceService.remove(request.params.workspaceId));
      } catch (error) {
        return sendDiscoveryFailure(reply, error);
      }
    },
  );

  app.get<{ Params: { workspaceId: string } }>(
    '/api/discovery/workspaces/:workspaceId/result',
    async (request, reply) => {
      if (!z.uuid().safeParse(request.params.workspaceId).success) {
        return reply.code(422).send(createApiErrorEnvelope(
          'DISCOVERY_WORKSPACE_INVALID',
          'The discovery workspace id is not valid.',
        ));
      }
      try {
        return reply.code(200).send(await workspaceService.previewResult(request.params.workspaceId));
      } catch (error) {
        return sendDiscoveryFailure(reply, error);
      }
    },
  );

  app.post<{ Params: { workspaceId: string } }>(
    '/api/discovery/workspaces/:workspaceId/result-review',
    async (request, reply) => {
      if (!z.uuid().safeParse(request.params.workspaceId).success) {
        return reply.code(422).send(createApiErrorEnvelope(
          'DISCOVERY_WORKSPACE_INVALID',
          'The discovery workspace id is not valid.',
        ));
      }
      const parsed = resultReviewSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send(createApiErrorEnvelope(
          DISCOVERY_WORKSPACE_ERROR_CODES.RESULT_REVIEW_REQUIRED,
          'Review the complete result and redistribution rights before continuing.',
        ));
      }
      try {
        return reply.code(200).send(await workspaceService.reviewResult(
          request.params.workspaceId,
          parsed.data.fingerprint,
          parsed.data.contentsReviewed,
          parsed.data.redistributionReviewed,
        ));
      } catch (error) {
        return sendDiscoveryFailure(reply, error);
      }
    },
  );

  app.post<{ Params: { workspaceId: string } }>(
    '/api/discovery/workspaces/:workspaceId/import',
    async (request, reply) => {
      if (!z.uuid().safeParse(request.params.workspaceId).success) {
        return reply.code(422).send(createApiErrorEnvelope(
          'DISCOVERY_WORKSPACE_INVALID',
          'The discovery workspace id is not valid.',
        ));
      }
      try {
        return reply.code(200).send(await workspaceService.importResult(request.params.workspaceId));
      } catch (error) {
        return sendDiscoveryFailure(reply, error);
      }
    },
  );
};

function sendDiscoveryFailure(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof DiscoveryHandoffError) {
    return reply.code(error.status).send(
      createApiErrorEnvelope(error.code, error.message),
    );
  }
  if (error instanceof DiscoveryWorkspaceError) {
    const status = error.code === DISCOVERY_WORKSPACE_ERROR_CODES.NOT_FOUND
      ? 404
      : error.code === DISCOVERY_WORKSPACE_ERROR_CODES.ACTIVE ||
          error.code === DISCOVERY_WORKSPACE_ERROR_CODES.RESULT_REVIEW_STALE ||
          error.code === DISCOVERY_WORKSPACE_ERROR_CODES.RUN_INCOMPLETE ||
          (error.code === DISCOVERY_WORKSPACE_ERROR_CODES.INVALID &&
            error.details.code === 'DISCOVERY_REVIEW_STALE')
        ? 409
        : error.code === DISCOVERY_WORKSPACE_ERROR_CODES.RESULT_UNAVAILABLE
          ? 404
          : error.code === DISCOVERY_WORKSPACE_ERROR_CODES.RESULT_INVALID ||
              error.code === DISCOVERY_WORKSPACE_ERROR_CODES.RESULT_REVIEW_REQUIRED
            ? 422
        : error.code === DISCOVERY_WORKSPACE_ERROR_CODES.INVALID
          ? 422
          : 500;
    return reply.code(status).send(createApiErrorEnvelope(error.code, error.message, error.details));
  }
  throw error;
}
