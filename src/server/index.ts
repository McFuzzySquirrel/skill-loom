import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import {
  buildApp,
  type BuildAppOptions,
  type ServerSettings,
} from './app.js';

/** Minimal closeable surface so signal wiring is testable without a listener. */
export interface CloseableServer {
  close(): Promise<void>;
}

export interface SignalSource {
  once(event: NodeJS.Signals, listener: () => void): unknown;
  removeListener(event: NodeJS.Signals, listener: () => void): unknown;
}

export interface ShutdownHandlerOptions {
  /** Signal source. Defaults to `process`. */
  signals?: SignalSource;
  /** Called when `close()` rejects. Defaults to logging and exit code 1. */
  onCloseError?: (error: unknown) => void;
}

export interface StartedServer {
  app: FastifyInstance;
  settings: ServerSettings;
  /** Remove signal listeners and close the Fastify instance. */
  stop(): Promise<void>;
}

/**
 * Close the server on SIGINT/SIGTERM. The handler is idempotent, removes its
 * own listeners, and relies on `app.close()` to release the listening socket
 * (and, in later tasks, PTYs and WebSocket subscriptions) before the event
 * loop drains normally.
 */
export function installShutdownHandlers(
  server: CloseableServer,
  options: ShutdownHandlerOptions = {},
): () => void {
  const signals = options.signals ?? process;
  let closing = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (closing) {
      return;
    }
    closing = true;

    for (const event of ['SIGINT', 'SIGTERM'] as const) {
      signals.removeListener(event, handlers[event]);
    }

    server.close().catch((error: unknown) => {
      if (options.onCloseError) {
        options.onCloseError(error);
        return;
      }
      console.error(`Skill Loom failed to shut down after ${signal}.`, error);
      process.exitCode = 1;
    });
  };

  const handlers = {
    SIGINT: () => shutdown('SIGINT'),
    SIGTERM: () => shutdown('SIGTERM'),
  } as const;

  signals.once('SIGINT', handlers.SIGINT);
  signals.once('SIGTERM', handlers.SIGTERM);

  return () => {
    closing = true;
    for (const event of ['SIGINT', 'SIGTERM'] as const) {
      signals.removeListener(event, handlers[event]);
    }
  };
}

/**
 * Build, listen, and install signal handlers. The caller owns the returned
 * instance and may call `stop()` for an explicit shutdown.
 */
export async function startServer(options: BuildAppOptions = {}): Promise<StartedServer> {
  const app = await buildApp(options);
  const settings: ServerSettings = { ...app.loomSettings };

  try {
    await app.listen({ host: settings.host, port: settings.port });
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }

  const removeSignalHandlers = installShutdownHandlers(app);

  return {
    app,
    settings,
    async stop(): Promise<void> {
      removeSignalHandlers();
      await app.close();
    },
  };
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  startServer({ logger: true })
    .then(({ settings }) => {
      console.log(`Skill Loom listening on http://${settings.host}:${settings.port}`);
    })
    .catch((error: unknown) => {
      console.error('Skill Loom failed to start.', error);
      process.exitCode = 1;
    });
}
