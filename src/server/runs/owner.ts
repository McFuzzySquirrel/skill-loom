import { existsSync } from 'node:fs';
import { createCatalogService, type CatalogService } from '../catalog/merge.js';
import { createChainService, type ChainService } from '../chains/service.js';
import type { ConfigStore } from '../config/store.js';
import type { HarnessRegistry } from '../harness/registry.js';
import type { HarnessAuthStrategy, LocalCommandRunner } from '../preflight/auth.js';
import type { PreflightEngine } from '../preflight/engine.js';
import { createPreflightProvider, type PreflightProvider } from '../preflight/provider.js';
import { createProjectRegistry, type ProjectRegistry } from '../projects/registry.js';
import type { TerminalManager } from '../terminal/pty.js';
import type { AutomaticSpawner } from './automatic.js';
import {
  createRunOrchestrator,
  type RunAutomaticSpawnerContext,
  type RunOrchestrator,
  type RunSupervisedPtyContext,
} from './orchestrator.js';
import type { SupervisedPty } from './supervised.js';
import type { RunStoreWarning } from './store.js';

export interface RunOwnerOptions {
  configStore: ConfigStore;
  projectRegistry?: ProjectRegistry;
  chainService?: ChainService;
  catalogService?: CatalogService;
  harnessRegistry?: HarnessRegistry;
  terminalManager: TerminalManager;
  preflightCommandRunner?: LocalCommandRunner;
  preflightReadFileText?: (path: string) => Promise<string>;
  preflightHomeDirectory?: string;
  preflightEnv?: NodeJS.ProcessEnv;
  preflightAuthStrategies?: readonly HarnessAuthStrategy[];
  preflightEngine?: PreflightEngine;
  preflightProvider?: PreflightProvider;
  runOrchestrator?: RunOrchestrator;
  runRecoverOnStartup?: boolean;
  runNow?: () => Date;
  runCreateSessionId?: () => string;
  runCreateRunId?: () => string;
  runCreateSupervisedPty?: (context: RunSupervisedPtyContext) => SupervisedPty;
  runCreateAutomaticSpawner?: (context: RunAutomaticSpawnerContext) => AutomaticSpawner;
  runStepTimeoutMs?: number;
  onRunRecoveryWarning?: (warning: RunStoreWarning) => void;
}

export interface RunOwner {
  get(): Promise<RunOrchestrator>;
  recoverIfConfigured(): Promise<void>;
  withMutation<T>(task: () => Promise<T>): Promise<T>;
  blockMutations(): boolean;
  unblockMutations(): void;
  shutdown(): Promise<void>;
}

export class RunOwnerError extends Error {
  readonly code = 'RUN_OWNER_STOPPING';
  constructor() {
    super('Skill Loom is stopping and cannot start or change a run.');
    this.name = 'RunOwnerError';
  }
}

export function reportRunRecoveryWarning(warning: RunStoreWarning): void {
  console.warn(`Run startup recovery warning: ${JSON.stringify(warning)}`);
}

/**
 * One lazy orchestrator and one recovery/shutdown lifecycle per application.
 * The owner can be shared by transports without creating a second runner.
 */
export function createRunOwner(options: RunOwnerOptions): RunOwner {
  const projectRegistry = options.projectRegistry ?? createProjectRegistry({ configStore: options.configStore });
  const chainService = options.chainService ?? createChainService();
  const catalogService = options.catalogService ?? createCatalogService({ configStore: options.configStore });
  const { harnessRegistry, preflightEngine } = options.preflightProvider ??
    createPreflightProvider({ ...options, catalogService });

  let orchestratorPromise: Promise<RunOrchestrator> | null = null;
  let failedOrchestrator: RunOrchestrator | null = null;
  let failedRecoveryError: unknown;
  let shutdownPromise: Promise<void> | null = null;
  let closing = false;
  let blocked = false;
  let mutations = 0;
  let mutationsDrained: (() => void) | null = null;
  const get = (): Promise<RunOrchestrator> => {
    if (closing) {
      return Promise.reject(new Error('The run owner is shutting down.'));
    }
    if (orchestratorPromise !== null) return orchestratorPromise;
    const created = (async (): Promise<RunOrchestrator> => {
      if (failedOrchestrator !== null) {
        if (options.runOrchestrator !== undefined) {
          throw failedRecoveryError;
        }
        try {
          await failedOrchestrator.shutdown();
        } catch (cleanupError) {
          throw new AggregateError([failedRecoveryError, cleanupError], 'Run recovery failed and its orchestrator could not be shut down.');
        }
        failedOrchestrator = null;
        failedRecoveryError = undefined;
      }
      const orchestrator = options.runOrchestrator ?? createRunOrchestrator({
        configDirectory: options.configStore.getConfigDir(),
        projectRegistry,
        chainService,
        harnessRegistry,
        preflightEngine,
        terminalManager: options.terminalManager,
        ...(options.runNow === undefined ? {} : { now: options.runNow }),
        ...(options.runCreateSessionId === undefined ? {} : { createSessionId: options.runCreateSessionId }),
        ...(options.runCreateRunId === undefined ? {} : { createRunId: options.runCreateRunId }),
        ...(options.runCreateSupervisedPty === undefined ? {} : { createSupervisedPty: options.runCreateSupervisedPty }),
        ...(options.runCreateAutomaticSpawner === undefined ? {} : { createAutomaticSpawner: options.runCreateAutomaticSpawner }),
        ...(options.runStepTimeoutMs === undefined ? {} : { stepTimeoutMs: options.runStepTimeoutMs }),
      });
      try {
        if (options.runRecoverOnStartup ?? true) {
          const recovery = await orchestrator.recoverOnStartup();
          for (const warning of recovery.warnings) options.onRunRecoveryWarning?.(warning);
        }
      } catch (error) {
        failedOrchestrator = orchestrator;
        failedRecoveryError = error;
        throw error;
      }
      return orchestrator;
    })();
    const guarded = created.catch((error: unknown) => {
      if (orchestratorPromise === guarded) orchestratorPromise = null;
      throw error;
    });
    orchestratorPromise = guarded;
    return guarded;
  };

  return {
    get,
    async recoverIfConfigured() {
      if ((options.runRecoverOnStartup ?? true) && existsSync(options.configStore.getConfigPath())) {
        await get();
      }
    },
    async withMutation<T>(task: () => Promise<T>): Promise<T> {
      if (blocked || closing) throw new RunOwnerError();
      mutations += 1;
      try {
        return await task();
      } finally {
        mutations -= 1;
        if (mutations === 0 && mutationsDrained !== null) {
          mutationsDrained();
          mutationsDrained = null;
        }
      }
    },
    blockMutations() {
      if (blocked || mutations !== 0 || closing) return false;
      blocked = true;
      return true;
    },
    unblockMutations() {
      if (!closing) blocked = false;
    },
    shutdown() {
      if (shutdownPromise !== null) return shutdownPromise;
      closing = true;
      const attempt = (async () => {
        if (mutations !== 0) {
          await new Promise<void>((resolve) => { mutationsDrained = resolve; });
        }
        const pending = orchestratorPromise;
        const orchestrator = pending === null ? null : await pending.catch(() => null);
        if (orchestrator !== null) await orchestrator.shutdown();
        if (failedOrchestrator !== null) {
          await failedOrchestrator.shutdown();
          failedOrchestrator = null;
          failedRecoveryError = undefined;
        }
      })().catch((error: unknown) => {
        if (shutdownPromise === attempt) shutdownPromise = null;
        throw error;
      });
      shutdownPromise = attempt;
      return shutdownPromise;
    },
  };
}
