import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import {
  buildApp,
  type BuildAppOptions,
  type ServerSettings,
} from './app.js';
import { createConfigStore } from './config/store.js';
import { ControlError, ControlStartupCleanupError, startControlServer } from './control.js';
import { acquireProfileOwner, type ProfileOwner } from './profile-owner.js';

const retainedOwners = new Set<ProfileOwner>();

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
export async function startServer(options: BuildAppOptions & { enableControl?: boolean } = {}): Promise<StartedServer> {
  const configStore = options.configStore ?? createConfigStore(options.env === undefined ? {} : { env: options.env });
  const owner = await acquireProfileOwner(configStore.getConfigDir());
  let app: FastifyInstance;
  try {
    app = await buildApp({ ...options, configStore });
  } catch (error) {
    owner.release();
    throw error;
  }
  const settings: ServerSettings = { ...app.loomSettings };

  try {
    await app.loomRunOwner.recoverIfConfigured();
  } catch (error) {
    try {
      await app.close();
    } catch (cleanupError) {
      retainedOwners.add(owner);
      throw new AggregateError([error, cleanupError], 'Startup recovery failed and application cleanup did not complete.');
    }
    owner.release();
    throw error;
  }

  let control: { close(): Promise<void> } | undefined;
  let controlReady = false;
  try {
    if (options.enableControl !== false) {
      control = await startControlServer(configStore, {
        services: app.loomServices,
        runOwner: app.loomRunOwner,
        terminalManager: app.loomTerminalManager,
        isStopping: () => app.loomLifecycle.state !== 'running',
        isFailed: () => app.loomLifecycle.state === 'failed',
        isReady: () => controlReady,
        httpEndpoint: { host: settings.host, port: settings.port },
        prepareStop: async () => {
          if (!controlReady) {
            throw new ControlError('CONTROL_BUSY', 'The Skill Loom service is still starting.');
          }
          if (app.loomLifecycle.state === 'failed') return;
          if (!app.loomRunOwner.blockMutations()) {
            throw new ControlError('CONTROL_BUSY', 'A run operation is in progress; retry after it finishes.');
          }
          if (!app.loomLifecycle.beginShutdown()) {
            app.loomRunOwner.unblockMutations();
            throw new ControlError('CONTROL_STOPPING', 'The Skill Loom service is already stopping.');
          }
          try {
            const active = await (await app.loomRunOwner.get()).getActiveRun();
            if (active.active) {
              throw new ControlError('CONTROL_RUN_ACTIVE', 'A managed run is active. Abort or finish it before stopping the service.');
            }
          } catch (error) {
            app.loomLifecycle.cancelUnflushedShutdown();
            app.loomRunOwner.unblockMutations();
            throw error;
          }
        },
        stop: () => app.loomLifecycle.stop(),
      });
    }
  } catch (error) {
    try {
      await app.close();
    } catch (cleanupError) {
      retainedOwners.add(owner);
      throw new AggregateError([error, cleanupError], 'Control startup failed and application cleanup did not complete.');
    }
    if (error instanceof ControlStartupCleanupError) retainedOwners.add(owner);
    else owner.release();
    throw error;
  }

  let removeSignalHandlers: () => void = () => undefined;
  let supervisorExitIntent: 'stop' | 'restart' = 'stop';
  const handleSupervisorMessage = (message: unknown): void => {
    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === 'loom:prepare-restart'
    ) {
      supervisorExitIntent = 'restart';
      process.send?.({ type: 'loom:restart-ready' });
    }
  };
  if (process.env.LOOM_DEV_SUPERVISOR === '1') {
    process.on('message', handleSupervisorMessage);
  }
  app.loomLifecycle.setShutdownHandler(async () => {
    removeSignalHandlers();
    try {
      await app.loomRunOwner.shutdown();
      await control?.close();
      await app.close();
      owner.release();
      retainedOwners.delete(owner);
    } catch (error) {
      retainedOwners.add(owner);
      throw error;
    }
    if (
      process.env.LOOM_DEV_SUPERVISOR === '1' &&
      process.send !== undefined &&
      process.connected
    ) {
      await new Promise<void>((resolveSend, rejectSend) => {
        process.send?.(
          { type: 'loom:server-stopped', intent: supervisorExitIntent },
          (error) => {
            if (error !== null) {
              rejectSend(error);
              return;
            }
            process.removeListener('message', handleSupervisorMessage);
            process.disconnect();
            resolveSend();
          },
        );
      });
    }
  });
  removeSignalHandlers = installShutdownHandlers({
    close: () => app.loomLifecycle.stop(),
  });
  try {
    await app.listen({ host: settings.host, port: settings.port });
    if (app.loomLifecycle.state !== 'running') {
      throw new ControlError('CONTROL_STOPPING', 'The Skill Loom service stopped during startup.');
    }
    controlReady = true;
  } catch (error) {
    await app.loomLifecycle.stop();
    throw error;
  }

  return {
    app,
    settings,
    stop: () => app.loomLifecycle.stop(),
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
