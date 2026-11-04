import { existsSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import packageManifest from '../../package.json' with { type: 'json' };
import {
  API_ERROR_CODES,
  createApiErrorEnvelope,
  type ActiveRunSummary,
} from '../shared/api.js';
import type { CatalogService } from './catalog/merge.js';
import type { GlobalChainService } from './chains/library.js';
import type { ChainService } from './chains/service.js';
import { createConfigStore, type ConfigStore } from './config/store.js';
import type { HarnessRegistry } from './harness/registry.js';
import type {
  HarnessAuthStrategy,
  LocalCommandRunner,
} from './preflight/auth.js';
import type { PreflightEngine } from './preflight/engine.js';
import type { TrustSessionService } from './preflight/trust-session.js';
import type { GitInitRunner } from './projects/registry.js';
import type { AutomaticSpawner } from './runs/automatic.js';
import type {
  RunAutomaticSpawnerContext,
  RunOrchestrator,
  RunSupervisedPtyContext,
} from './runs/orchestrator.js';
import type { SupervisedPty } from './runs/supervised.js';
import { routes } from './routes/index.js';
import {
  createTerminalManager,
  type TerminalManager,
} from './terminal/pty.js';

/** Loopback-only defaults. SEC-04/ARCH-01 make these non-negotiable. */
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 7373;

/** Server version reported by the health endpoint. */
export const LOOM_VERSION: string = packageManifest.version;

export type ServerConfigErrorCode = 'HOST_NOT_LOOPBACK' | 'INVALID_PORT';

/** Typed process-configuration failure; never exposed as an HTTP response. */
export class ServerConfigError extends Error {
  readonly code: ServerConfigErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: ServerConfigErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

export class NonLoopbackHostError extends ServerConfigError {
  constructor(host: string) {
    super(
      'HOST_NOT_LOOPBACK',
      `Refusing to bind Skill Loom to non-loopback host "${host}". Skill Loom is local-only.`,
      { host },
    );
  }
}

export class InvalidPortError extends ServerConfigError {
  constructor(value: unknown) {
    super('INVALID_PORT', `Invalid Skill Loom port "${String(value)}". Use an integer from 1 to 65535.`, {
      value: typeof value === 'string' || typeof value === 'number' ? value : String(value),
    });
  }
}

export interface ServerSettings {
  host: string;
  port: number;
}

export interface BuildAppOptions {
  /** Loopback host. Defaults to `LOOM_HOST` or `127.0.0.1`. */
  host?: string;
  /** TCP port. Defaults to `LOOM_PORT` or 7373. */
  port?: number;
  /** Environment seam for tests. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Injected config store. Defaults to the process-wide store. */
  configStore?: ConfigStore;
  /** Injected catalog service. Defaults to the v1 adapter registry. */
  catalogService?: CatalogService;
  /** Injected chain service. Defaults to the filesystem-backed service. */
  chainService?: ChainService;
  /** Injected global chain template service. */
  globalChainService?: GlobalChainService;
  /** Injected package version. Defaults to the root package.json version. */
  version?: string;
  /** Fastify logger configuration. Tests pass `false`. */
  logger?: FastifyServerOptions['logger'];
  /** Register static UI serving. Defaults to true; skipped when no build exists. */
  serveStatic?: boolean;
  /** Overrides the resolved `dist/web` directory. Used by integration tests. */
  webRoot?: string;
  /** Run-state seam consumed by the health endpoint. */
  getActiveRun?: () => ActiveRunSummary;
  /** Injected PTY registry. Defaults to a fresh manager owned by this app. */
  terminalManager?: TerminalManager;
  /** Git initializer seam used by the project registry. */
  projectGitInit?: GitInitRunner;
  /** Injected harness adapter registry shared by preflight and trust routes. */
  harnessRegistry?: HarnessRegistry;
  /** Injected command runner for static auth probes and git status. */
  preflightCommandRunner?: LocalCommandRunner;
  /** Injected trust-config reader for preflight and trust verification. */
  preflightReadFileText?: (path: string) => Promise<string>;
  /** Injected home directory for trust-config and auth-file resolution. */
  preflightHomeDirectory?: string;
  /** Injected environment for auth evidence, trust, and harness PATH lookup. */
  preflightEnv?: NodeJS.ProcessEnv;
  /** Override auth evidence strategies in tests or for a future harness. */
  preflightAuthStrategies?: readonly HarnessAuthStrategy[];
  /** Pre-built preflight engine seam. */
  preflightEngine?: PreflightEngine;
  /** Pre-built Copilot trust-session service seam. */
  trustSessionService?: TrustSessionService;
  /** Pre-built run orchestrator seam. */
  runOrchestrator?: RunOrchestrator;
  /** Run startup recovery. Defaults to true. */
  runRecoverOnStartup?: boolean;
  /** Clock seam forwarded to the default run orchestrator. */
  runNow?: () => Date;
  /** Session id seam forwarded to the default run orchestrator. */
  runCreateSessionId?: () => string;
  /** Run id seam forwarded to the default run orchestrator. */
  runCreateRunId?: () => string;
  /** Production PTY seam forwarded to the default run orchestrator. */
  runCreateSupervisedPty?: (context: RunSupervisedPtyContext) => SupervisedPty;
  /** Automatic process/PTY seam forwarded to the default run orchestrator. */
  runCreateAutomaticSpawner?: (context: RunAutomaticSpawnerContext) => AutomaticSpawner;
  /** Automatic step timeout forwarded to the default run orchestrator. */
  runStepTimeoutMs?: number;
}

/** Strip IPv6 brackets and compare case-insensitively. */
function normalizeHost(host: string): string {
  let value = host.trim();
  if (value.startsWith('[') && value.endsWith(']')) {
    value = value.slice(1, -1);
  }
  return value.toLowerCase();
}

/** True for `127.0.0.0/8`, `::1`, and the `localhost` alias. */
export function isLoopbackHost(host: string): boolean {
  const value = normalizeHost(host);
  if (value === '' || value.includes('%')) {
    return false;
  }
  if (value === 'localhost') {
    return true;
  }

  const family = isIP(value);
  if (family === 4) {
    return value.startsWith('127.');
  }
  if (family === 6) {
    return value === '::1' || value === '0:0:0:0:0:0:0:1';
  }
  return false;
}

/**
 * Reject any bind host that is not loopback. Resolution maps `localhost` to
 * the literal IPv4 loopback so the process always listens on 127.0.0.1.
 */
export function assertLoopbackHost(host: string): string {
  if (!isLoopbackHost(host)) {
    throw new NonLoopbackHostError(host);
  }
  return normalizeHost(host) === 'localhost' ? DEFAULT_HOST : normalizeHost(host);
}

export function assertValidPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new InvalidPortError(port);
  }
  return port;
}

/** Resolve and validate process settings from the environment. */
export function resolveServerSettings(env: NodeJS.ProcessEnv = process.env): ServerSettings {
  const host = assertLoopbackHost(env.LOOM_HOST ?? DEFAULT_HOST);
  return { host, port: resolvePort(env) };
}

function resolvePort(env: NodeJS.ProcessEnv): number {
  const rawPort = env.LOOM_PORT?.trim();
  return rawPort === undefined || rawPort === '' ? DEFAULT_PORT : parsePort(rawPort);
}

function parsePort(rawPort: string): number {
  if (!/^\d+$/.test(rawPort)) {
    throw new InvalidPortError(rawPort);
  }
  return assertValidPort(Number(rawPort));
}

/**
 * Resolve the built web directory. The candidates cover source execution
 * (`tsx src/server/index.ts`), compiled execution (`dist/src/server/app.js`),
 * and a start from the repository root.
 */
function resolveWebRoot(env: NodeJS.ProcessEnv): string {
  const override = env.LOOM_WEB_ROOT?.trim();
  if (override !== undefined && override !== '') {
    return resolve(override);
  }

  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(moduleDirectory, '../../dist/web'),
    resolve(moduleDirectory, '../../../dist/web'),
    resolve(process.cwd(), 'dist/web'),
  ];

  return candidates.find((candidate) => existsSync(join(candidate, 'index.html'))) ?? candidates[0]!;
}

function requestPathname(url: string): string {
  const queryIndex = url.indexOf('?');
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

function isApiPath(url: string): boolean {
  const pathname = requestPathname(url);
  return pathname === '/api' || pathname.startsWith('/api/');
}

function statusToCode(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return API_ERROR_CODES.BAD_REQUEST;
    case 404:
      return API_ERROR_CODES.NOT_FOUND;
    case 405:
      return API_ERROR_CODES.METHOD_NOT_ALLOWED;
    case 409:
      return API_ERROR_CODES.CONFLICT;
    case 422:
      return API_ERROR_CODES.VALIDATION_ERROR;
    default:
      return statusCode >= 500 ? API_ERROR_CODES.INTERNAL_ERROR : API_ERROR_CODES.BAD_REQUEST;
  }
}

/**
 * Fastify composition root. Every HTTP/WebSocket route is mounted through
 * `routes/index.ts`, and every failure leaves through the shared envelope.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = options.env ?? process.env;
  const host = assertLoopbackHost(options.host ?? env.LOOM_HOST ?? DEFAULT_HOST);
  const port = assertValidPort(options.port ?? resolvePort(env));

  const app = Fastify({
    logger: options.logger ?? false,
  });

  const terminalManager = options.terminalManager ?? createTerminalManager();

  app.decorate('loomSettings', { host, port });
  app.decorate('loomVersion', options.version ?? LOOM_VERSION);
  app.decorate('loomTerminalManager', terminalManager);

  await app.register(fastifyWebsocket);

  // Fastify closes listener sockets and WebSocket upgrades before this hook.
  // Terminating every PTY here covers graceful SIGINT/SIGTERM shutdown too.
  app.addHook('onClose', async () => {
    await terminalManager.shutdown();
  });

  let staticEnabled = false;
  if (options.serveStatic ?? true) {
    const webRoot = options.webRoot ?? resolveWebRoot(env);
    const indexFile = join(webRoot, 'index.html');
    if (existsSync(indexFile)) {
      await app.register(fastifyStatic, {
        root: webRoot,
        wildcard: true,
        index: ['index.html'],
        dotfiles: 'deny',
      });
      staticEnabled = true;
    } else {
      app.log.warn({ webRoot }, 'Built web UI not found; static serving is disabled.');
    }
  }

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const statusCode =
      typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode <= 599
        ? error.statusCode
        : 500;

    if (statusCode >= 500) {
      request.log.error({ err: error }, 'Unhandled request error');
      void reply
        .code(statusCode)
        .send(
          createApiErrorEnvelope(
            API_ERROR_CODES.INTERNAL_ERROR,
            'An unexpected server error occurred.',
          ),
        );
      return;
    }

    if (error.validation) {
      void reply.code(statusCode).send(
        createApiErrorEnvelope(API_ERROR_CODES.VALIDATION_ERROR, error.message, {
          issues: error.validation,
        }),
      );
      return;
    }

    void reply
      .code(statusCode)
      .send(createApiErrorEnvelope(statusToCode(statusCode), error.message));
  });

  app.setNotFoundHandler((request, reply) => {
    // The static wildcard calls the not-found handler for missing files. In
    // production, non-API browser routes fall back to the SPA shell; API
    // paths always stay JSON so the web client can decode the envelope.
    if (
      staticEnabled &&
      !isApiPath(request.raw.url ?? request.url) &&
      (request.method === 'GET' || request.method === 'HEAD')
    ) {
      return reply.type('text/html; charset=utf-8').sendFile('index.html');
    }

    return reply.code(404).send(
      createApiErrorEnvelope(
        API_ERROR_CODES.NOT_FOUND,
        `No route matches ${request.method} ${requestPathname(request.raw.url ?? request.url)}.`,
        {
          method: request.method,
          path: requestPathname(request.raw.url ?? request.url),
        },
      ),
    );
  });

  await app.register(routes, {
    configStore: options.configStore ?? createConfigStore({ env }),
    version: options.version ?? LOOM_VERSION,
    port,
    terminalManager,
    ...(options.getActiveRun === undefined ? {} : { getActiveRun: options.getActiveRun }),
    ...(options.projectGitInit === undefined ? {} : { gitInit: options.projectGitInit }),
    ...(options.catalogService === undefined ? {} : { catalogService: options.catalogService }),
    ...(options.chainService === undefined ? {} : { chainService: options.chainService }),
    ...(options.globalChainService === undefined
      ? {}
      : { globalChainService: options.globalChainService }),
    ...(options.harnessRegistry === undefined ? {} : { harnessRegistry: options.harnessRegistry }),
    ...(options.preflightCommandRunner === undefined
      ? {}
      : { preflightCommandRunner: options.preflightCommandRunner }),
    ...(options.preflightReadFileText === undefined
      ? {}
      : { preflightReadFileText: options.preflightReadFileText }),
    ...(options.preflightHomeDirectory === undefined
      ? {}
      : { preflightHomeDirectory: options.preflightHomeDirectory }),
    preflightEnv: options.preflightEnv ?? env,
    ...(options.preflightAuthStrategies === undefined
      ? {}
      : { preflightAuthStrategies: options.preflightAuthStrategies }),
    ...(options.preflightEngine === undefined
      ? {}
      : { preflightEngine: options.preflightEngine }),
    ...(options.trustSessionService === undefined
      ? {}
      : { trustSessionService: options.trustSessionService }),
    ...(options.runOrchestrator === undefined
      ? {}
      : { runOrchestrator: options.runOrchestrator }),
    ...(options.runRecoverOnStartup === undefined
      ? {}
      : { runRecoverOnStartup: options.runRecoverOnStartup }),
    ...(options.runNow === undefined ? {} : { runNow: options.runNow }),
    ...(options.runCreateSessionId === undefined
      ? {}
      : { runCreateSessionId: options.runCreateSessionId }),
    ...(options.runCreateRunId === undefined
      ? {}
      : { runCreateRunId: options.runCreateRunId }),
    ...(options.runCreateSupervisedPty === undefined
      ? {}
      : { runCreateSupervisedPty: options.runCreateSupervisedPty }),
    ...(options.runCreateAutomaticSpawner === undefined
      ? {}
      : { runCreateAutomaticSpawner: options.runCreateAutomaticSpawner }),
    ...(options.runStepTimeoutMs === undefined
      ? {}
      : { runStepTimeoutMs: options.runStepTimeoutMs }),
  });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    loomSettings: ServerSettings;
    loomVersion: string;
    loomTerminalManager: TerminalManager;
  }
}
