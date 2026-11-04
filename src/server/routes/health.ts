import type { FastifyPluginAsync } from 'fastify';
import type { ConfigStore } from '../config/store.js';
import {
  createInactiveRunSummary,
  type ActiveRunSummary,
  type HealthResponse,
} from '../../shared/api.js';

export interface HealthRouteOptions {
  /** Injected config store; the route only asks for the resolved directory. */
  configStore: ConfigStore;
  /** Package version exposed by the health response. */
  version: string;
  /** Configured port exposed by the health response. */
  port: number;
  /**
   * Run-state seam. Run orchestration replaces this later; until then the
   * server reports an honest inactive placeholder.
   */
  getActiveRun?: () => ActiveRunSummary;
}

/**
 * `GET /api/health` — liveness plus the local configuration identity.
 *
 * The handler never reads the config file, so a corrupt configuration cannot
 * make the health check fail or overwrite user data.
 */
export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (app, options) => {
  app.get('/api/health', async (): Promise<HealthResponse> => {
    const activeRun = options.getActiveRun?.() ?? createInactiveRunSummary();

    return {
      status: 'ok',
      version: options.version,
      configDirectory: options.configStore.getConfigDir(),
      port: options.port,
      activeRun,
    };
  });
};
