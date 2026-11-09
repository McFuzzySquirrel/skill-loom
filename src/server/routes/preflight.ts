import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  API_ERROR_CODES,
  createApiErrorEnvelope,
  type ApiValidationIssue,
} from '../../shared/api.js';
import { createCatalogService, type CatalogService } from '../catalog/merge.js';
import { ChainValidationError } from '../chains/model.js';
import { createChainService, type ChainService } from '../chains/service.js';
import {
  ChainStoreError,
  type ChainStoreErrorCode,
} from '../chains/store.js';
import { HARNESS_IDS } from '../config/schema.js';
import { ConfigError } from '../config/store.js';
import type { ConfigStore } from '../config/store.js';
import type { HarnessRegistry } from '../harness/registry.js';
import { HarnessError } from '../harness/types.js';
import type {
  HarnessAuthStrategy,
  LocalCommandRunner,
} from '../preflight/auth.js';
import type { PreflightEngine } from '../preflight/engine.js';
import { createPreflightProvider, type PreflightProvider } from '../preflight/provider.js';
import { preflightRequestBodySchema } from '../preflight/request.js';
import {
  createTrustSessionService,
  TRUST_SESSION_ERROR_CODES,
  TrustSessionError,
  type TrustSessionErrorCode,
  type TrustSessionService,
} from '../preflight/trust-session.js';
import {
  createProjectRegistry,
  isProjectId,
  type ProjectRegistry,
} from '../projects/registry.js';
import type { TerminalManager } from '../terminal/pty.js';

/**
 * Preflight and folder-trust HTTP surface.
 *
 * The route accepts a registered project id, never a filesystem path. It
 * resolves the canonical project directory, loads the chain by id, and hands
 * the decoded chain to the deterministic preflight engine. Trust start and
 * verify delegate to the adapter-driven trust-session service, which owns the
 * unseeded interactive PTY and read-only config inspection.
 *
 * No handler spawns a harness prompt. Authentication, trust, and git evidence
 * come from the engine's injected, non-prompt seams.
 */

const trustRequestBodySchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('start'),
    harness: z.enum(HARNESS_IDS),
  }),
  z.strictObject({
    action: z.literal('verify'),
    harness: z.enum(HARNESS_IDS),
    sessionId: z.string().min(1).optional(),
  }),
]);

export interface PreflightRoutesOptions {
  /** Global configuration store that owns recent projects and harness overrides. */
  configStore: ConfigStore;
  /** Injected project registry. Defaults to the config-backed registry. */
  projectRegistry?: ProjectRegistry;
  /** Injected chain service. Defaults to the filesystem-backed service. */
  chainService?: ChainService;
  /** Injected catalog service shared with the catalog routes. */
  catalogService?: CatalogService;
  /** Injected harness registry. Defaults to the configured adapter registry. */
  harnessRegistry?: HarnessRegistry;
  /** Injected PTY registry; trust sessions are created through it. */
  terminalManager: TerminalManager;
  /** Injected command runner for static auth probes and git status. */
  preflightCommandRunner?: LocalCommandRunner;
  /** Injected trust-config reader. Only the trusted-folder key is inspected. */
  preflightReadFileText?: (path: string) => Promise<string>;
  /** Injected home directory for trust-config and auth-file resolution. */
  preflightHomeDirectory?: string;
  /** Injected environment for auth evidence, trust, and harness PATH lookup. */
  preflightEnv?: NodeJS.ProcessEnv;
  /** Override auth evidence strategies in tests or for a future harness. */
  preflightAuthStrategies?: readonly HarnessAuthStrategy[];
  /** Pre-built engine seam. The default composes the live adapters. */
  preflightEngine?: PreflightEngine;
  preflightProvider?: PreflightProvider;
  /** Pre-built trust-session service seam. */
  trustSessionService?: TrustSessionService;
}

interface ProjectRouteParams {
  projectId: string;
}

export const PREFLIGHT_ROUTE_ERROR_CODES = {
  PROJECT_ID_INVALID: 'PREFLIGHT_PROJECT_ID_INVALID',
  PROJECT_NOT_FOUND: 'PREFLIGHT_PROJECT_NOT_FOUND',
} as const;
export type PreflightRouteErrorCode =
  (typeof PREFLIGHT_ROUTE_ERROR_CODES)[keyof typeof PREFLIGHT_ROUTE_ERROR_CODES];

/** Typed route failure for project resolution before any domain work. */
export class PreflightRouteError extends Error {
  readonly code: PreflightRouteErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: PreflightRouteErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

const STATUS_BY_ROUTE_CODE: Record<PreflightRouteErrorCode, number> = {
  PREFLIGHT_PROJECT_ID_INVALID: 422,
  PREFLIGHT_PROJECT_NOT_FOUND: 404,
};

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

const STATUS_BY_TRUST_CODE: Record<TrustSessionErrorCode, number> = {
  TRUST_NOT_SUPPORTED: 422,
  TRUST_START_FAILED: 500,
};

/**
 * `POST /api/projects/:projectId/preflight`
 *
 * Body: `{ chainId, harness?, mode?, inputs?, acknowledgements? }`.
 * The response is the structured preflight report, including ordered checks,
 * resolved inputs and skills, session plan, permission scope, and required
 * acknowledgement keys.
 */
export const preflightRoutes: FastifyPluginAsync<PreflightRoutesOptions> = async (
  app,
  options,
) => {
  const projectRegistry =
    options.projectRegistry ??
    createProjectRegistry({ configStore: options.configStore });
  const chainService = options.chainService ?? createChainService();
  const catalogService =
    options.catalogService ?? createCatalogService({ configStore: options.configStore });

  const provider = options.preflightProvider ?? createPreflightProvider({ ...options, catalogService });
  const harnessRegistry = provider.harnessRegistry;

  const trustService =
    options.trustSessionService ??
    createTrustSessionService({
      terminalManager: options.terminalManager,
      harnessRegistry: harnessRegistry,
      ...(options.preflightHomeDirectory === undefined
        ? {}
        : { homeDirectory: options.preflightHomeDirectory }),
      ...(options.preflightEnv === undefined ? {} : { env: options.preflightEnv }),
      ...(options.preflightReadFileText === undefined
        ? {}
        : { readFileText: options.preflightReadFileText }),
    });

  app.addHook('onClose', async () => {
    trustService.closeAll();
  });

  app.post<{ Params: ProjectRouteParams; Body: unknown }>(
    '/api/projects/:projectId/preflight',
    async (request, reply) => {
      const parsed = preflightRequestBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendValidationFailure(
          reply,
          'The preflight request is not valid.',
          parsed.error.issues,
        );
      }

      try {
        const projectPath = await resolveProjectPath(projectRegistry, request.params.projectId);
        const chain = await chainService.get(projectPath, parsed.data.chainId);
        const engine = await provider.preflightEngine();

        const report = await engine.run({
          chain,
          projectPath,
          ...(parsed.data.harness === undefined ? {} : { harness: parsed.data.harness }),
          ...(parsed.data.mode === undefined ? {} : { mode: parsed.data.mode }),
          ...(parsed.data.inputs === undefined ? {} : { inputs: parsed.data.inputs }),
          ...(parsed.data.acknowledgements === undefined
            ? {}
            : { acknowledgements: parsed.data.acknowledgements }),
        });

        return reply.code(200).send(report);
      } catch (error) {
        return sendFailure(reply, error);
      }
    },
  );

  app.post<{ Params: ProjectRouteParams; Body: unknown }>(
    '/api/projects/:projectId/trust',
    async (request, reply) => {
      const parsed = trustRequestBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendValidationFailure(
          reply,
          'The trust request is not valid.',
          parsed.error.issues,
        );
      }

      try {
        const projectPath = await resolveProjectPath(projectRegistry, request.params.projectId);
        if (parsed.data.action === 'start') {
          const result = await trustService.start({
            projectPath,
            harness: parsed.data.harness,
          });
          return reply.code(200).send(result);
        }

        const result = await trustService.verify({
          projectPath,
          harness: parsed.data.harness,
          ...(parsed.data.sessionId === undefined
            ? {}
            : { sessionId: parsed.data.sessionId }),
        });
        return reply.code(200).send(result);
      } catch (error) {
        return sendFailure(reply, error);
      }
    },
  );
};

/**
 * Resolve a project id to its canonical directory. The id must be registered;
 * the route never accepts or derives a path from the client.
 */
async function resolveProjectPath(
  registry: ProjectRegistry,
  projectId: string,
): Promise<string> {
  if (!isProjectId(projectId)) {
    throw new PreflightRouteError(
      PREFLIGHT_ROUTE_ERROR_CODES.PROJECT_ID_INVALID,
      'The project id is not valid.',
      { projectId },
    );
  }

  const project = await registry.findRecentProject(projectId);
  if (project === undefined) {
    throw new PreflightRouteError(
      PREFLIGHT_ROUTE_ERROR_CODES.PROJECT_NOT_FOUND,
      'No registered project matches that id.',
      { projectId },
    );
  }

  return project.canonicalPath;
}

function sendFailure(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof PreflightRouteError) {
    return reply
      .code(STATUS_BY_ROUTE_CODE[error.code] ?? 500)
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

  if (error instanceof TrustSessionError) {
    return reply
      .code(STATUS_BY_TRUST_CODE[error.code] ?? 500)
      .send(createApiErrorEnvelope(error.code, error.message, error.details));
  }

  if (error instanceof HarnessError) {
    // The route validated the harness enum, so this is a registry gap rather
    // than a client error. Report it as a stable 422 with the supported list.
    return reply
      .code(422)
      .send(createApiErrorEnvelope(error.code, error.message, error.details));
  }

  if (error instanceof ConfigError) {
    return reply
      .code(500)
      .send(createApiErrorEnvelope(error.code, error.message, error.details));
  }

  throw error;
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
