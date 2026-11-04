import type { FastifyPluginAsync } from 'fastify';
import { fsRoutes, type FsRouteOptions } from './fs.js';
import { healthRoutes, type HealthRouteOptions } from './health.js';
import { terminalRoutes, type TerminalRouteOptions } from './terminal.js';

export type RouteRegistrationOptions = HealthRouteOptions &
  TerminalRouteOptions &
  FsRouteOptions;

/**
 * Single registration point for the HTTP and WebSocket surface. Every feature
 * route plugin is mounted here and this plugin is mounted by `app.ts`, which
 * keeps ARCH-05 true as the API grows.
 */
export const routes: FastifyPluginAsync<RouteRegistrationOptions> = async (app, options) => {
  await app.register(healthRoutes, options);
  await app.register(fsRoutes, options);
  await app.register(terminalRoutes, options);
};
