import type { FastifyPluginAsync } from 'fastify';
import type { ConfigStore } from '../config/store.js';
import { isActiveRunStatus } from '../runs/model.js';
import { readActiveRunPointerFile } from '../runs/store.js';
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
  /** Optional run-state seam for tests or alternate compositions. */
  getActiveRun?: () => ActiveRunSummary | Promise<ActiveRunSummary>;
}

/**
 * `GET /api/health` — liveness plus the local configuration identity.
 *
 * The handler reads the persisted run pointer, but never initializes run
 * recovery or reads the config file. An invalid pointer is an error.
 */
export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (app, options) => {
  app.get('/api/health', async (): Promise<HealthResponse> => {
    let activeRun: ActiveRunSummary;
    if (options.getActiveRun !== undefined) {
      activeRun = await options.getActiveRun();
    } else {
      const pointer = await readActiveRunPointerFile({
        configDirectory: options.configStore.getConfigDir(),
      });
      activeRun = pointer !== null && isActiveRunStatus(pointer.status)
        ? { active: true, runId: pointer.runId, status: pointer.status }
        : createInactiveRunSummary();
    }

    return {
      status: 'ok',
      version: options.version,
      configDirectory: options.configStore.getConfigDir(),
      port: options.port,
      activeRun,
    };
  });
};
