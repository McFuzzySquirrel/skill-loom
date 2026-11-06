import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createApiErrorEnvelope } from '../../shared/api.js';
import type { ServerLifecycle } from '../lifecycle.js';

export interface ServerRoutesOptions {
  lifecycle: ServerLifecycle;
  host: string;
  port: number;
  /** Additional loopback-only browser origins, used by a development proxy. */
  allowedOrigins?: readonly string[];
}

const shutdownRequestSchema = z.strictObject({
  confirm: z.literal(true),
});

function requestHostIsLoopback(hostHeader: string | undefined, port: number): boolean {
  if (hostHeader === undefined) return false;
  try {
    const url = new URL(`http://${hostHeader}`);
    const requestPort = url.port === '' ? 80 : Number(url.port);
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return (
      ['127.0.0.1', '::1', 'localhost'].includes(hostname) &&
      (requestPort === port || requestPort === 5173)
    );
  } catch {
    return false;
  }
}

function sameOriginRequest(
  hostHeader: string | undefined,
  originHeader: string | undefined,
  port: number,
  allowedOrigins: readonly string[],
): boolean {
  if (
    originHeader === undefined ||
    !requestHostIsLoopback(hostHeader, port)
  ) {
    return false;
  }
  try {
    const origin = new URL(originHeader);
    if (origin.protocol !== 'http:' || origin.username !== '' || origin.password !== '') {
      return false;
    }
    const normalizedOrigin = origin.origin;
    if (allowedOrigins.includes(normalizedOrigin)) {
      return true;
    }
    if (hostHeader === undefined) return false;
    return normalizedOrigin === `http://${hostHeader}`;
  } catch {
    return false;
  }
}

export const serverRoutes: FastifyPluginAsync<ServerRoutesOptions> = async (app, options) => {
  const allowedOrigins = options.allowedOrigins ?? [];

  app.get('/api/server/lifecycle', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return {
      state: options.lifecycle.state,
      token: options.lifecycle.token,
    };
  });

  app.post<{ Body: unknown }>('/api/server/shutdown', async (request, reply) => {
    if (
      !sameOriginRequest(
        request.headers.host,
        request.headers.origin,
        options.port,
        allowedOrigins,
      )
    ) {
      return reply.code(403).send(
        createApiErrorEnvelope('SHUTDOWN_ORIGIN_REJECTED', 'The shutdown request origin is not allowed.'),
      );
    }

    const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim();
    if (contentType !== 'application/json') {
      return reply.code(415).send(
        createApiErrorEnvelope('JSON_REQUIRED', 'The shutdown request must use JSON.'),
      );
    }

    if (
      request.headers['x-loom-shutdown-token'] !== options.lifecycle.token
    ) {
      return reply.code(403).send(
        createApiErrorEnvelope('SHUTDOWN_TOKEN_INVALID', 'The shutdown token is invalid.'),
      );
    }

    const parsed = shutdownRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(
        createApiErrorEnvelope('SHUTDOWN_CONFIRMATION_REQUIRED', 'Explicit shutdown confirmation is required.'),
      );
    }

    if (!options.lifecycle.beginShutdown()) {
      return reply.code(409).send(
        createApiErrorEnvelope('SHUTDOWN_ALREADY_STARTED', 'The server is already stopping.'),
      );
    }

    let responseFlushed: () => void = () => undefined;
    const responseBarrier = new Promise<void>((resolve) => {
      responseFlushed = resolve;
    });
    options.lifecycle.deferShutdownUntil(responseBarrier);

    let scheduled = false;
    const scheduleStop = () => {
      if (scheduled) return;
      scheduled = true;
      responseFlushed();
      setImmediate(() => {
        void options.lifecycle.stop().catch((error: unknown) => {
          request.log.error({ err: error }, 'Skill Loom shutdown failed.');
        });
      });
    };

    reply.raw.once('finish', scheduleStop);
    reply.raw.once('close', () => {
      if (reply.raw.writableFinished) {
        scheduleStop();
        return;
      }
      responseFlushed();
      options.lifecycle.cancelUnflushedShutdown();
    });
    return reply.code(202).send({ state: 'stopping' as const });
  });
};
