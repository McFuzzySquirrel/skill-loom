import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { ConfigStore } from '../config/store.js';
import {
  DiscoveryHandoffError,
  prepareDiscoveryHandoff,
} from '../catalog/discovery-handoff.js';
import { createApiErrorEnvelope } from '../../shared/api.js';

export interface DiscoveryRoutesOptions {
  configStore: ConfigStore;
}

export const discoveryRoutes: FastifyPluginAsync<DiscoveryRoutesOptions> = async (
  app,
  options,
) => {
  app.post('/api/discovery/handoffs', async (request, reply) => {
    try {
      const handoff = await prepareDiscoveryHandoff(options.configStore, request.body);
      return reply.code(200).send(handoff);
    } catch (error) {
      return sendDiscoveryFailure(reply, error);
    }
  });
};

function sendDiscoveryFailure(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof DiscoveryHandoffError) {
    return reply.code(error.status).send(
      createApiErrorEnvelope(error.code, error.message),
    );
  }
  throw error;
}
