import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { startServer } from '../../src/server/index.js';
import { isApiErrorEnvelope } from '../../src/shared/api.js';

let root: string;
let app: FastifyInstance;
const stopHandler = vi.fn(async () => undefined);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loom-server-routes-'));
  app = await buildApp({
    serveStatic: false,
    env: { ...process.env, LOOM_CONFIG_DIR: root },
    runRecoverOnStartup: false,
  });
  app.loomLifecycle.setShutdownHandler(stopHandler);
});

afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
  stopHandler.mockClear();
});

describe('server lifecycle routes', () => {
  it('returns a no-store per-instance capability', async () => {
    const response = await app.inject('/api/server/lifecycle');
    const body = response.json() as { state: string; token: string };

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(body.state).toBe('running');
    expect(body.token).toBe(app.loomLifecycle.token);
    expect(body.token).toHaveLength(43);
  });

  it.each([
    {
      name: 'rejects foreign origins',
      headers: {
        host: '127.0.0.1:7373',
        origin: 'http://example.test',
        'content-type': 'application/json',
        'x-loom-shutdown-token': 'invalid',
      },
      payload: { confirm: true },
      expected: 403,
    },
    {
      name: 'rejects missing capability',
      headers: {
        host: '127.0.0.1:7373',
        origin: 'http://127.0.0.1:7373',
        'content-type': 'application/json',
      },
      payload: { confirm: true },
      expected: 403,
    },
    {
      name: 'rejects an invalid capability for the same origin',
      headers: {
        host: '127.0.0.1:7373',
        origin: 'http://127.0.0.1:7373',
        'content-type': 'application/json',
        'x-loom-shutdown-token': 'invalid',
      },
      payload: { confirm: true },
      expected: 403,
    },
    {
      name: 'rejects a non-loopback request host',
      headers: {
        host: 'example.test:7373',
        origin: 'http://example.test:7373',
        'content-type': 'application/json',
        'x-loom-shutdown-token': 'invalid',
      },
      payload: { confirm: true },
      expected: 403,
    },
    {
      name: 'requires JSON',
      headers: {
        host: '127.0.0.1:7373',
        origin: 'http://127.0.0.1:7373',
        'content-type': 'text/plain',
        'x-loom-shutdown-token': 'placeholder',
      },
      payload: 'confirm',
      expected: 415,
    },
  ])('$name', async ({ headers, payload, expected }) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/server/shutdown',
      headers,
      payload,
    });

    expect(response.statusCode).toBe(expected);
    expect(isApiErrorEnvelope(response.json())).toBe(true);
    expect(stopHandler).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation and returns before stopping', async () => {
    const token = app.loomLifecycle.token;
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/server/shutdown',
      headers: {
        host: '127.0.0.1:7373',
        origin: 'http://127.0.0.1:7373',
        'content-type': 'application/json',
        'x-loom-shutdown-token': token,
      },
      payload: { confirm: false },
    });
    expect(rejected.statusCode).toBe(400);

    const response = await app.inject({
      method: 'POST',
      url: '/api/server/shutdown',
      headers: {
        host: '127.0.0.1:7373',
        origin: 'http://127.0.0.1:7373',
        'content-type': 'application/json',
        'x-loom-shutdown-token': token,
      },
      payload: { confirm: true },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ state: 'stopping' });
    await vi.waitFor(() => expect(stopHandler).toHaveBeenCalledTimes(1));
    expect(app.loomLifecycle.state).toBe('stopped');
  });

  it('closes a listening server after the shutdown response is delivered', async () => {
    const reservation = createServer();
    await new Promise<void>((resolve, reject) => {
      reservation.once('error', reject);
      reservation.listen(0, '127.0.0.1', resolve);
    });
    const address = reservation.address() as AddressInfo;
    await new Promise<void>((resolve, reject) => {
      reservation.close((error) =>
        error === undefined || error === null ? resolve() : reject(error),
      );
    });

    const started = await startServer({
      host: '127.0.0.1',
      port: address.port,
      serveStatic: false,
      env: { ...process.env, LOOM_CONFIG_DIR: root },
      runRecoverOnStartup: false,
    });

    const baseUrl = `http://127.0.0.1:${String(address.port)}`;
    try {
      const lifecycle = (await fetch(`${baseUrl}/api/server/lifecycle`).then((response) =>
        response.json(),
      )) as { token: string };
      const response = await fetch(`${baseUrl}/api/server/shutdown`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: baseUrl,
          'x-loom-shutdown-token': lifecycle.token,
        },
        body: JSON.stringify({ confirm: true }),
      });

      expect(response.status).toBe(202);
      await started.stop();
      await expect(fetch(`${baseUrl}/api/server/lifecycle`)).rejects.toThrow();
    } finally {
      await started.stop();
    }
  });

  it('rejects a second server for the same profile without disturbing the owner', async () => {
    const reservation = createServer();
    await new Promise<void>((resolve, reject) => {
      reservation.once('error', reject);
      reservation.listen(0, '127.0.0.1', resolve);
    });
    const address = reservation.address() as AddressInfo;
    await new Promise<void>((resolve, reject) => {
      reservation.close((error) =>
        error === undefined || error === null ? resolve() : reject(error),
      );
    });
    const options = {
      host: '127.0.0.1',
      port: address.port,
      serveStatic: false,
      env: { ...process.env, LOOM_CONFIG_DIR: root },
      runRecoverOnStartup: false,
    };
    const started = await startServer(options);
    try {
      await expect(startServer(options)).rejects.toMatchObject({ code: 'PROFILE_IN_USE' });
      const response = await fetch(`http://127.0.0.1:${String(address.port)}/api/server/lifecycle`);
      expect(response.status).toBe(200);
      expect((await response.json() as { state: string }).state).toBe('running');
    } finally {
      await started.stop();
    }
    const restarted = await startServer(options);
    await restarted.stop();
  });
});
