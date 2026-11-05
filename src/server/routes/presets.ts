import type { FastifyPluginAsync } from 'fastify';
import { scenarioCatalog } from '../chains/presets.js';

/**
 * Read-only, bundled example recipes.
 *
 * Listing curated examples never installs skills, creates project chains, or
 * writes to a user's global library.
 */
export const scenarioPresetRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/chain-presets', async (_request, reply) => {
    return reply.code(200).send(scenarioCatalog);
  });
};
