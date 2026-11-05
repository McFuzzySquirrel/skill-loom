import type { FastifyPluginAsync } from 'fastify';
import { catalogRoutes, type CatalogRoutesOptions } from './catalog.js';
import { chainRoutes, type ChainRoutesOptions } from './chains.js';
import { chainBundleRoutes } from './chain-bundles.js';
import { fsRoutes, type FsRouteOptions } from './fs.js';
import {
  globalChainRoutes,
  type GlobalChainRoutesOptions,
} from './global-chains.js';
import { healthRoutes, type HealthRouteOptions } from './health.js';
import { preflightRoutes, type PreflightRoutesOptions } from './preflight.js';
import { portableSkillRoutes } from './portable-skill.js';
import { projectRoutes, type ProjectRoutesOptions } from './projects.js';
import { scenarioPresetRoutes } from './presets.js';
import { runRoutes, type RunRoutesOptions } from './runs.js';
import { terminalRoutes, type TerminalRouteOptions } from './terminal.js';

export type RouteRegistrationOptions = HealthRouteOptions &
  TerminalRouteOptions &
  FsRouteOptions &
  ProjectRoutesOptions &
  CatalogRoutesOptions &
  ChainRoutesOptions &
  GlobalChainRoutesOptions &
  PreflightRoutesOptions &
  RunRoutesOptions;

/**
 * Single registration point for the HTTP and WebSocket surface. Every feature
 * route plugin is mounted here and this plugin is mounted by `app.ts`, which
 * keeps ARCH-05 true as the API grows.
 */
export const routes: FastifyPluginAsync<RouteRegistrationOptions> = async (app, options) => {
  await app.register(healthRoutes, options);
  await app.register(fsRoutes, options);
  await app.register(projectRoutes, options);
  await app.register(catalogRoutes, options);
  await app.register(chainRoutes, options);
  await app.register(chainBundleRoutes, options);
  await app.register(portableSkillRoutes);
  await app.register(globalChainRoutes, options);
  await app.register(preflightRoutes, options);
  await app.register(runRoutes, options);
  await app.register(scenarioPresetRoutes);
  await app.register(terminalRoutes, options);
};
