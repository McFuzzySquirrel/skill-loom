import type { FastifyPluginAsync } from 'fastify';
import { chainRoutes, type ChainRoutesOptions } from './chains.js';
import { draftRoutes, type DraftRoutesOptions } from './drafts.js';
import { healthRoutes, type HealthRouteOptions } from './health.js';
import { serverRoutes, type ServerRoutesOptions } from './server.js';

export type RouteRegistrationOptions = HealthRouteOptions &
  ServerRoutesOptions &
  ChainRoutesOptions &
  DraftRoutesOptions;

/**
 * Single registration point for the HTTP surface. The chain editor is the only
 * browser client, so only chain and draft persistence, health, and lifecycle
 * are exposed; every other operation goes through the CLI control channel.
 */
export const routes: FastifyPluginAsync<RouteRegistrationOptions> = async (app, options) => {
  await app.register(healthRoutes, options);
  await app.register(serverRoutes, options);
  await app.register(chainRoutes, options);
  await app.register(draftRoutes, options);
};
