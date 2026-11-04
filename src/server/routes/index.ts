import type { FastifyPluginAsync } from 'fastify';
import { healthRoutes, type HealthRouteOptions } from './health.js';

export type RouteRegistrationOptions = HealthRouteOptions;

/**
 * Single registration point for the HTTP and WebSocket surface. Every feature
 * route plugin is mounted here and this plugin is mounted by `app.ts`, which
 * keeps ARCH-05 true as the API grows.
 */
export const routes: FastifyPluginAsync<RouteRegistrationOptions> = async (app, options) => {
  await app.register(healthRoutes, options);
};
