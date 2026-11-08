import { existsSync } from 'node:fs';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  API_ERROR_CODES,
  createApiErrorEnvelope,
  type ApiValidationIssue,
} from '../../shared/api.js';
import type { CatalogService } from '../catalog/merge.js';
import { createCatalogService } from '../catalog/merge.js';
import { ChainValidationError } from '../chains/model.js';
import { createChainService, type ChainService } from '../chains/service.js';
import {
  ChainStoreError,
  type ChainStoreErrorCode,
} from '../chains/store.js';
import { HARNESS_IDS } from '../config/schema.js';
import { ConfigError } from '../config/store.js';
import type { ConfigStore } from '../config/store.js';
import { createHarnessRegistry, type HarnessRegistry } from '../harness/registry.js';
import { HarnessError } from '../harness/types.js';
import type {
  HarnessAuthStrategy,
  LocalCommandRunner,
} from '../preflight/auth.js';
import { createPreflightEngine, type PreflightEngine } from '../preflight/engine.js';
import {
  createProjectRegistry,
  type ProjectRegistry,
} from '../projects/registry.js';
import {
  RUN_ORCHESTRATOR_ERROR_CODES,
  RunOrchestratorError,
  createRunOrchestrator,
  type CreateRunRequest,
  type RunActionResult,
  type RunActionRequest,
  type RunActiveState,
  type RunAutomaticSpawnerContext,
  type RunOrchestrator,
  type RunStreamError,
  type RunStreamMessage,
  type RunStreamServerMessage,
  type RunSupervisedPtyContext,
  type RunView,
} from '../runs/orchestrator.js';
import { AutomaticRunnerError, type AutomaticSpawner } from '../runs/automatic.js';
import { RunError, type Run } from '../runs/model.js';
import { RunPromptError } from '../runs/prompts.js';
import { SupervisedRunnerError } from '../runs/supervised.js';
import type { SupervisedPty } from '../runs/supervised.js';
import {
  RunStoreError,
  type RunStoreErrorCode,
} from '../runs/store.js';
import type { TerminalManager } from '../terminal/pty.js';
import {
  createDiscoveryWorkspaceService,
  DISCOVERY_WORKSPACE_ERROR_CODES,
  DiscoveryWorkspaceError,
  withDiscoveryWorkspaceLock,
} from '../runs/discovery-workspaces.js';

/**
 * Run orchestration HTTP and WebSocket surface.
 *
 * The route is deliberately thin. It validates the request with Zod, calls one
 * orchestrator method, and maps a typed failure to the shared error envelope.
 * It never resolves a filesystem path supplied by the client, never spawns a
 * process, and never contains harness-specific branching.
 */

const MAX_CHAIN_ID_LENGTH = 64;
const MAX_ACTION_LENGTH = 32;
const MAX_REASON_LENGTH = 2_000;

const WS_OPEN = 1;

const inputValuesSchema = z.record(z.string(), z.string().nullable());

const acknowledgementSchema = z.union([
  z.array(z.string().min(1)),
  z.record(z.string(), z.boolean()),
]);

const createRunBodySchema = z.strictObject({
  chainId: z.string().min(1).max(MAX_CHAIN_ID_LENGTH),
  harness: z.enum(HARNESS_IDS).optional(),
  mode: z.enum(['supervised', 'automatic']).optional(),
  inputs: inputValuesSchema.optional(),
  acknowledgements: acknowledgementSchema.optional(),
});

const actionBodySchema = z.strictObject({
  action: z.string().trim().min(1).max(MAX_ACTION_LENGTH),
  reason: z.string().max(MAX_REASON_LENGTH).optional(),
});

const runParamsSchema = z.object({
  runId: z.string().min(1).max(64),
});

export interface RunRoutesOptions {
  /** Global configuration store that owns recent projects and harness overrides. */
  configStore: ConfigStore;
  /** Injected project registry. Defaults to the config-backed registry. */
  projectRegistry?: ProjectRegistry;
  /** Injected chain service. Defaults to the filesystem-backed service. */
  chainService?: ChainService;
  /** Injected catalog service used only by the default preflight engine. */
  catalogService?: CatalogService;
  /** Injected harness registry. Defaults to the configured adapter registry. */
  harnessRegistry?: HarnessRegistry;
  /** Injected PTY registry shared with the terminal route. */
  terminalManager: TerminalManager;
  /** Injected command runner for preflight auth evidence and git status. */
  preflightCommandRunner?: LocalCommandRunner;
  /** Injected trust-config reader used by preflight. */
  preflightReadFileText?: (path: string) => Promise<string>;
  /** Injected home directory used by preflight. */
  preflightHomeDirectory?: string;
  /** Injected environment for auth evidence, trust, and PATH lookup. */
  preflightEnv?: NodeJS.ProcessEnv;
  /** Override auth evidence strategies in tests or for a future harness. */
  preflightAuthStrategies?: readonly HarnessAuthStrategy[];
  /** Pre-built preflight engine seam. */
  preflightEngine?: PreflightEngine;
  /** Pre-built orchestrator seam. When supplied, the other run seams are ignored. */
  runOrchestrator?: RunOrchestrator;
  /** Run startup recovery. Defaults to true. */
  runRecoverOnStartup?: boolean;
  /** Clock seam forwarded to a default orchestrator. */
  runNow?: () => Date;
  /** Session id seam forwarded to a default orchestrator. */
  runCreateSessionId?: () => string;
  /** Run id seam forwarded to a default orchestrator. */
  runCreateRunId?: () => string;
  /** Production PTY seam forwarded to a default orchestrator. */
  runCreateSupervisedPty?: (context: RunSupervisedPtyContext) => SupervisedPty;
  /** Automatic process/PTY seam forwarded to a default orchestrator. */
  runCreateAutomaticSpawner?: (context: RunAutomaticSpawnerContext) => AutomaticSpawner;
  /** Automatic step timeout forwarded to a default orchestrator. */
  runStepTimeoutMs?: number;
}

/** The minimal WebSocket surface the event route needs, kept structural. */
interface RunEventSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', listener: (data: unknown, isBinary: boolean) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'error', listener: (error: unknown) => void): unknown;
}

interface RunRouteParams {
  runId: string;
}

interface CreateRunResponse {
  run: Run;
  terminalId: string | null;
  actions: RunView['actions'];
  recovery: RunView['recovery'];
}

interface RunResponse extends RunView {}

interface ActiveRunResponse extends RunActiveState {}

interface ActionResultResponse {
  run: Run;
  terminalId: string | null;
  actions: RunView['actions'];
  recovery: RunView['recovery'];
  restartedFrom: string | null;
  discoveryDraftId?: string;
  discoveryImportError?: { code: string; message: string };
}

/** HTTP status for each typed run-storage failure. */
const STATUS_BY_STORE_CODE: Record<RunStoreErrorCode, number> = {
  RUN_ID_INVALID: 422,
  RUN_PROJECT_INVALID: 422,
  RUN_PROJECT_NOT_FOUND: 404,
  RUN_PROJECT_NOT_DIRECTORY: 400,
  RUN_PROJECT_UNREADABLE: 403,
  RUN_STORE_SETUP_FAILED: 500,
  RUN_PATH_ESCAPED: 400,
  RUN_NOT_FOUND: 404,
  RUN_ALREADY_EXISTS: 409,
  RUN_READ_FAILED: 500,
  RUN_WRITE_FAILED: 500,
  RUN_LIST_FAILED: 500,
  RUN_FILE_CORRUPT: 422,
  RUN_FILE_UNREADABLE: 422,
  RUN_FILE_ID_MISMATCH: 422,
  RUN_UNSUPPORTED_VERSION: 422,
  RUN_ACTIVE_CONFLICT: 409,
  RUN_ACTIVE_POINTER_CORRUPT: 500,
  RUN_ACTIVE_POINTER_READ_FAILED: 500,
  RUN_ACTIVE_POINTER_WRITE_FAILED: 500,
};

/** HTTP status for each typed orchestrator failure. */
const STATUS_BY_ORCHESTRATOR_CODE: Record<
  (typeof RUN_ORCHESTRATOR_ERROR_CODES)[keyof typeof RUN_ORCHESTRATOR_ERROR_CODES],
  number
> = {
  RUN_PROJECT_ID_INVALID: 422,
  RUN_PROJECT_NOT_FOUND: 404,
  RUN_ID_INVALID: 422,
  RUN_NOT_FOUND: 404,
  RUN_ACTIVE_CONFLICT: 409,
  RUN_PREFLIGHT_BLOCKED: 409,
  RUN_MODE_INVALID: 422,
  RUN_ACTION_INVALID: 422,
  RUN_ACTION_MODE_MISMATCH: 409,
  RUN_ACTION_NOT_ALLOWED: 409,
  RUN_NOT_LIVE: 409,
  RUN_RECOVERY_REQUIRED: 409,
  RUN_RECOVERY_NOT_AVAILABLE: 409,
  RUN_RECOVERY_STEP_INVALID: 409,
  RUN_RECOVERY_NO_PENDING: 409,
  RUN_START_FAILED: 500,
};

/** Chain storage failures can surface while resolving the saved chain. */
const STATUS_BY_CHAIN_CODE: Record<ChainStoreErrorCode, number> = {
  CHAIN_ID_INVALID: 422,
  CHAIN_PROJECT_INVALID: 422,
  CHAIN_PROJECT_NOT_FOUND: 404,
  CHAIN_PROJECT_NOT_DIRECTORY: 400,
  CHAIN_PROJECT_UNREADABLE: 403,
  CHAIN_STORE_SETUP_FAILED: 500,
  CHAIN_PATH_ESCAPED: 400,
  CHAIN_NOT_FOUND: 404,
  CHAIN_ALREADY_EXISTS: 409,
  CHAIN_READ_FAILED: 500,
  CHAIN_WRITE_FAILED: 500,
  CHAIN_DELETE_FAILED: 500,
  CHAIN_LIST_FAILED: 500,
  CHAIN_FILE_CORRUPT: 422,
  CHAIN_FILE_UNREADABLE: 422,
  CHAIN_FILE_ID_MISMATCH: 422,
  CHAIN_UNSUPPORTED_VERSION: 422,
};

/**
 * `POST /api/projects/:projectId/runs` — start a run.
 *
 * Creation re-runs the blocking preflight, freezes the chain snapshot, resolves
 * inputs, claims the single active-run slot, and starts the selected runner.
 */
export const runRoutes: FastifyPluginAsync<RunRoutesOptions> = async (
  app,
  options,
) => {
  const projectRegistry =
    options.projectRegistry ??
    createProjectRegistry({ configStore: options.configStore });
  const chainService = options.chainService ?? createChainService();
  const catalogService =
    options.catalogService ?? createCatalogService({ configStore: options.configStore });
  const discoveryWorkspaces = createDiscoveryWorkspaceService({
    configStore: options.configStore,
    projectRegistry,
    chainService,
  });

  const harnessRegistry = async (): Promise<HarnessRegistry> => {
    if (options.harnessRegistry !== undefined) {
      return options.harnessRegistry;
    }
    const config = await options.configStore.get();
    return createHarnessRegistry({
      commands: config.harnessCommands,
      ...(options.preflightEnv === undefined ? {} : { env: options.preflightEnv }),
    });
  };

  const preflightEngine = async (): Promise<PreflightEngine> => {
    if (options.preflightEngine !== undefined) {
      return options.preflightEngine;
    }
    return buildPreflightEngine(await harnessRegistry(), catalogService, options);
  };

  // Building the orchestrator and running startup recovery both read the
  // global config. That must stay lazy: merely starting the server, or serving
  // health, must not create a config file or touch the user's projects.
  let orchestratorPromise: Promise<RunOrchestrator> | null = null;
  const getOrchestrator = (): Promise<RunOrchestrator> => {
    if (orchestratorPromise !== null) {
      return orchestratorPromise;
    }

    const created = (async (): Promise<RunOrchestrator> => {
      const orchestrator =
        options.runOrchestrator ??
        createRunOrchestrator({
          configDirectory: options.configStore.getConfigDir(),
          projectRegistry,
          chainService,
          harnessRegistry,
          preflightEngine,
          terminalManager: options.terminalManager,
          ...(options.runNow === undefined ? {} : { now: options.runNow }),
          ...(options.runCreateSessionId === undefined
            ? {}
            : { createSessionId: options.runCreateSessionId }),
          ...(options.runCreateRunId === undefined
            ? {}
            : { createRunId: options.runCreateRunId }),
          ...(options.runCreateSupervisedPty === undefined
            ? {}
            : { createSupervisedPty: options.runCreateSupervisedPty }),
          ...(options.runCreateAutomaticSpawner === undefined
            ? {}
            : { createAutomaticSpawner: options.runCreateAutomaticSpawner }),
          ...(options.runStepTimeoutMs === undefined
            ? {}
            : { stepTimeoutMs: options.runStepTimeoutMs }),
        });

      if (options.runRecoverOnStartup ?? true) {
        await orchestrator.recoverOnStartup();
      }
      return orchestrator;
    })();

    const guarded = created.catch((error: unknown) => {
      if (orchestratorPromise === guarded) {
        orchestratorPromise = null;
      }
      throw error;
    });
    orchestratorPromise = guarded;
    return guarded;
  };

  app.addHook('onClose', async () => {
    const pending = orchestratorPromise;
    if (pending === null) {
      return;
    }
    const orchestrator = await pending.catch(() => null);
    if (orchestrator !== null) {
      await orchestrator.shutdown();
    }
  });

  // Run startup recovery eagerly when a configuration already exists, so a real
  // restart marks stale records before the first run request. An untouched
  // install has no config file yet: recovery stays lazy so merely starting the
  // server never creates one.
  if ((options.runRecoverOnStartup ?? true) && configFileExists(options.configStore)) {
    await getOrchestrator().catch(() => undefined);
  }

  app.post<{ Params: { projectId: string }; Body: unknown }>(
    '/api/projects/:projectId/runs',
    async (request, reply) => {
      const parsed = createRunBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendValidationFailure(
          reply,
          'The run request is not valid.',
          parsed.error.issues,
        );
      }

      const body = parsed.data;
      const config = await options.configStore.get();
      const discoveryWorkspace = config.discoveryWorkspaces.find(
        (workspace) =>
          workspace.projectId === request.params.projectId &&
          workspace.chainId === body.chainId,
      );
      if (discoveryWorkspace !== undefined && body.mode === 'automatic') {
        return reply.code(409).send(createApiErrorEnvelope(
          'DISCOVERY_SUPERVISED_ONLY',
          'Managed scenario discovery must use the supervised interactive runner.',
        ));
      }
      const createRequest: CreateRunRequest = {
        projectId: request.params.projectId,
        chainId: body.chainId,
        ...(body.harness === undefined ? {} : { harness: body.harness }),
        ...(discoveryWorkspace !== undefined
          ? { mode: 'supervised' as const }
          : body.mode === undefined ? {} : { mode: body.mode }),
        ...(body.inputs === undefined ? {} : { inputs: body.inputs }),
        ...(body.acknowledgements === undefined
          ? {}
          : { acknowledgements: body.acknowledgements }),
      };

      try {
        const startRun = async () => {
          const orchestrator = await getOrchestrator();
          const run = await orchestrator.createRun(createRequest);
          if (discoveryWorkspace !== undefined) {
            try {
              await options.configStore.update((current) => ({
                discoveryWorkspaces: current.discoveryWorkspaces.map((workspace) =>
                  workspace.id === discoveryWorkspace.id
                    ? { ...workspace, runId: run.id }
                    : workspace,
                ),
              }));
            } catch (error) {
              try {
                await orchestrator.applyAction(run.id, {
                  action: 'abort',
                  reason: 'The discovery run could not be associated with its retained workspace.',
                });
              } catch (abortError) {
                request.log.error(
                  { err: abortError, runId: run.id, workspaceId: discoveryWorkspace.id },
                  'Could not abort a discovery run after workspace association failed.',
                );
              }
              throw error;
            }
          }
          return orchestrator.getRunView(run.id);
        };
        const view = discoveryWorkspace === undefined
          ? await startRun()
          : await withDiscoveryWorkspaceLock(discoveryWorkspace.projectId, startRun);
        return reply.code(201).send({
          run: view.run,
          terminalId: view.terminalId,
          actions: view.actions,
          recovery: view.recovery,
        } satisfies CreateRunResponse);
      } catch (error) {
        return sendFailure(reply, error);
      }
    },
  );

  app.get('/api/runs/active', async (_request, reply) => {
    try {
      const orchestrator = await getOrchestrator();
      const active = await orchestrator.getActiveRun();
      return reply.code(200).send(active satisfies ActiveRunResponse);
    } catch (error) {
      return sendFailure(reply, error);
    }
  });

  app.get<{ Params: RunRouteParams }>(
    '/api/runs/:runId',
    async (request, reply) => {
      const params = runParamsSchema.safeParse(request.params);
      if (!params.success) {
        return sendValidationFailure(
          reply,
          'The run id is not valid.',
          params.error.issues,
        );
      }

      try {
        const orchestrator = await getOrchestrator();
        const view = await orchestrator.getRunView(params.data.runId);
        return reply.code(200).send({
          run: view.run,
          projectPath: view.projectPath,
          terminalId: view.terminalId,
          actions: view.actions,
          recovery: view.recovery,
        } satisfies RunResponse);
      } catch (error) {
        return sendFailure(reply, error);
      }
    },
  );

  app.post<{ Params: RunRouteParams; Body: unknown }>(
    '/api/runs/:runId/actions',
    async (request, reply) => {
      const params = runParamsSchema.safeParse(request.params);
      if (!params.success) {
        return sendValidationFailure(
          reply,
          'The run id is not valid.',
          params.error.issues,
        );
      }

      const parsed = actionBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendValidationFailure(
          reply,
          'The run action is not valid.',
          parsed.error.issues,
        );
      }

      const actionRequest: RunActionRequest = {
        action: parsed.data.action,
        ...(parsed.data.reason === undefined ? {} : { reason: parsed.data.reason }),
      };

      try {
        const orchestrator = await getOrchestrator();
        const before = await orchestrator.getRunView(params.data.runId);
        const workspace = (await options.configStore.get()).discoveryWorkspaces.find(
          (candidate) =>
            candidate.projectId === before.run.projectId &&
            candidate.chainId === before.run.chainId,
        );
        if (workspace !== undefined && actionRequest.action === 'done') {
          await discoveryWorkspaces.assertResultReviewed(workspace.id);
        }
        const result: RunActionResult = await orchestrator.applyAction(
          params.data.runId,
          actionRequest,
        );
        let discoveryDraftId: string | undefined;
        let discoveryImportError: { code: string; message: string } | undefined;
        if (
          workspace?.autoImport === true &&
          actionRequest.action === 'next' &&
          result.run.status === 'completed'
        ) {
          try {
            discoveryDraftId = (await discoveryWorkspaces.importResult(workspace.id)).draftId;
          } catch (error) {
            if (!(error instanceof DiscoveryWorkspaceError)) throw error;
            discoveryImportError = { code: error.code, message: error.message };
            request.log.error({ err: error, workspaceId: workspace.id }, 'Automatic discovery result import failed.');
          }
        }
        const view = await orchestrator.getRunView(result.run.id);
        return reply.code(200).send({
          run: view.run,
          terminalId: view.terminalId,
          actions: view.actions,
          recovery: view.recovery,
          restartedFrom: result.restartedFrom,
          ...(discoveryDraftId === undefined ? {} : { discoveryDraftId }),
          ...(discoveryImportError === undefined ? {} : { discoveryImportError }),
        } satisfies ActionResultResponse);
      } catch (error) {
        if (error instanceof DiscoveryWorkspaceError) {
          const status = error.code === DISCOVERY_WORKSPACE_ERROR_CODES.NOT_FOUND
            ? 404
            : error.code === DISCOVERY_WORKSPACE_ERROR_CODES.RESULT_REVIEW_STALE
              ? 409
              : error.code === DISCOVERY_WORKSPACE_ERROR_CODES.RESULT_UNAVAILABLE
                ? 404
                : 422;
          return reply.code(status).send(createApiErrorEnvelope(error.code, error.message, error.details));
        }
        return sendFailure(reply, error);
      }
    },
  );

  app.get<{ Params: RunRouteParams }>(
    '/api/runs/:runId/events',
    { websocket: true },
    (rawSocket, request) => {
      void attachEventStream(app, getOrchestrator, rawSocket, request.params.runId);
    },
  );
};

async function attachEventStream(
  app: { log: { warn: (details: Record<string, unknown>, message: string) => void } },
  getOrchestrator: () => Promise<RunOrchestrator>,
  rawSocket: unknown,
  runId: string,
): Promise<void> {
  const socket = rawSocket as RunEventSocket;

  let unsubscribe: (() => void) | null = null;
  let closed = false;
  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    unsubscribe?.();
  };

  socket.on('close', close);
  socket.on('error', close);

  try {
    const orchestrator = await getOrchestrator();
    const attached = await orchestrator.subscribe(runId, (message: RunStreamMessage) => {
      sendSocket(socket, message);
    });
    if (closed) {
      attached();
      return;
    }
    unsubscribe = attached;
  } catch (error) {
    if (closed) {
      return;
    }
    if (error instanceof RunOrchestratorError) {
      sendSocket(socket, {
        type: 'error',
        code: error.code,
        message: error.message,
      });
      socket.close(1008, error.code);
      return;
    }
    app.log.warn({ err: error, runId }, 'Run event stream failed');
    sendSocket(socket, {
      type: 'error',
      code: API_ERROR_CODES.INTERNAL_ERROR,
      message: 'The run event stream could not be attached.',
    });
    socket.close(1011, API_ERROR_CODES.INTERNAL_ERROR);
  }
}

function sendSocket(socket: RunEventSocket, message: unknown): void {
  if (socket.readyState !== WS_OPEN) {
    return;
  }
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // The socket can close between the readyState check and the send.
  }
}

function configFileExists(configStore: ConfigStore): boolean {
  try {
    return existsSync(configStore.getConfigPath());
  } catch {
    return false;
  }
}

function buildPreflightEngine(
  registry: HarnessRegistry,
  catalogService: CatalogService,
  options: RunRoutesOptions,
): PreflightEngine {
  return createPreflightEngine({
    catalogService,
    harnessRegistry: registry,
    ...(options.preflightCommandRunner === undefined
      ? {}
      : { commandRunner: options.preflightCommandRunner }),
    ...(options.preflightReadFileText === undefined
      ? {}
      : { readFileText: options.preflightReadFileText }),
    ...(options.preflightHomeDirectory === undefined
      ? {}
      : { homeDirectory: options.preflightHomeDirectory }),
    ...(options.preflightAuthStrategies === undefined
      ? {}
      : { authStrategies: options.preflightAuthStrategies }),
    env: options.preflightEnv ?? process.env,
  });
}

function sendFailure(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof RunOrchestratorError) {
    return reply
      .code(STATUS_BY_ORCHESTRATOR_CODE[error.code] ?? 500)
      .send(createApiErrorEnvelope(error.code, error.message, error.details));
  }

  if (error instanceof RunStoreError) {
    return reply
      .code(STATUS_BY_STORE_CODE[error.code] ?? 500)
      .send(createApiErrorEnvelope(error.code, error.message, error.details));
  }

  if (error instanceof ChainValidationError) {
    return reply.code(422).send(
      createApiErrorEnvelope(API_ERROR_CODES.VALIDATION_ERROR, error.message, {
        issues: error.issues,
      }),
    );
  }

  if (error instanceof ChainStoreError) {
    return reply
      .code(STATUS_BY_CHAIN_CODE[error.code] ?? 500)
      .send(createApiErrorEnvelope(error.code, error.message, error.details));
  }

  if (error instanceof SupervisedRunnerError || error instanceof AutomaticRunnerError) {
    return reply
      .code(runnerStatus(error.code))
      .send(createApiErrorEnvelope(error.code, error.message, error.details));
  }

  if (error instanceof RunPromptError) {
    return reply
      .code(422)
      .send(createApiErrorEnvelope(error.code, error.message, error.details));
  }

  if (error instanceof HarnessError) {
    return reply
      .code(422)
      .send(createApiErrorEnvelope(error.code, error.message, error.details));
  }

  if (error instanceof ConfigError) {
    // A corrupt global configuration is a typed server failure, never an empty
    // run list or a silent reset.
    return reply
      .code(500)
      .send(createApiErrorEnvelope(error.code, error.message, error.details));
  }

  if (error instanceof RunError) {
    return reply
      .code(422)
      .send(createApiErrorEnvelope(error.code, error.message, error.details));
  }

  throw error;
}

const RUNNER_STATE_CODES: ReadonlySet<string> = new Set([
  'SUPERVISED_ALREADY_STARTED',
  'SUPERVISED_NOT_STARTED',
  'SUPERVISED_DISPOSED',
  'SUPERVISED_START_STATE_INVALID',
  'SUPERVISED_STEP_NOT_ACTIVE',
  'SUPERVISED_STEP_ALREADY_FINAL',
  'SUPERVISED_NEXT_NOT_READY',
  'SUPERVISED_RETRY_NOT_AVAILABLE',
  'SUPERVISED_FINAL_RUN',
  'AUTOMATIC_ALREADY_STARTED',
  'AUTOMATIC_NOT_STARTED',
  'AUTOMATIC_DISPOSED',
  'AUTOMATIC_START_STATE_INVALID',
  'AUTOMATIC_STEP_NOT_ACTIVE',
  'AUTOMATIC_FINAL_RUN',
  'AUTOMATIC_RUN_NEXT_NOT_READY',
  'AUTOMATIC_PROCESS_STILL_RUNNING',
  'AUTOMATIC_RETRY_NOT_AVAILABLE',
  'AUTOMATIC_ADVANCEMENT_UNSUPPORTED',
]);

const RUNNER_SERVER_CODES: ReadonlySet<string> = new Set([
  'SUPERVISED_PTY_FAILED',
  'SUPERVISED_PERSIST_FAILED',
  'AUTOMATIC_PERSIST_FAILED',
  'AUTOMATIC_SPAWN_FAILED',
]);

function runnerStatus(code: string): number {
  if (RUNNER_SERVER_CODES.has(code)) {
    return 500;
  }
  if (RUNNER_STATE_CODES.has(code)) {
    return 409;
  }
  return 422;
}

function sendValidationFailure(
  reply: FastifyReply,
  message: string,
  issues: ReadonlyArray<{ path: PropertyKey[]; code: string; message: string }>,
): FastifyReply {
  return reply.code(422).send(
    createApiErrorEnvelope(API_ERROR_CODES.VALIDATION_ERROR, message, {
      issues: issues.map(
        (issue): ApiValidationIssue => ({
          path: issue.path.map((segment) => String(segment)).join('.'),
          code: issue.code,
          message: issue.message,
        }),
      ),
    }),
  );
}

/** Re-exported contract types for the web client and future route tests. */
export type {
  CreateRunRequest,
  RunActionRequest,
  RunActionResult,
  RunActiveState,
  RunStreamError,
  RunStreamMessage,
  RunStreamServerMessage,
  RunView,
};
