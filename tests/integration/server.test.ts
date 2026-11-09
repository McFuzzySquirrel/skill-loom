import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  LOOM_VERSION,
  assertLoopbackHost,
  buildApp,
  isLoopbackHost,
  resolveServerSettings,
} from '../../src/server/app.js';
import {
  createConfigStore,
  type ConfigStore,
} from '../../src/server/config/store.js';
import {
  isApiErrorEnvelope,
  type HealthResponse,
} from '../../src/shared/api.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

let root: string;
let apps: FastifyInstance[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loom-server-test-'));
  apps = [];
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await rm(root, { recursive: true, force: true });
});

function configStoreFor(name = 'config'): ConfigStore {
  return createConfigStore({
    env: { LOOM_CONFIG_DIR: join(root, name) },
    homeDirectory: () => join(root, 'home'),
  });
}

async function makeApp(overrides: Parameters<typeof buildApp>[0] = {}): Promise<FastifyInstance> {
  const app = await buildApp({
    env: {},
    serveStatic: false,
    configStore: configStoreFor(),
    ...overrides,
  });
  apps.push(app);
  return app;
}

async function packageVersion(): Promise<string> {
  const manifest = JSON.parse(
    await readFile(join(PROJECT_ROOT, 'package.json'), 'utf8'),
  ) as { version: string };
  return manifest.version;
}

function expectEnvelope(body: unknown, code: string): void {
  expect(isApiErrorEnvelope(body)).toBe(true);
  if (!isApiErrorEnvelope(body)) {
    throw new Error('Expected the shared API error envelope.');
  }
  expect(body.error.code).toBe(code);
  expect(body.error.message).toBeTypeOf('string');
  expect(body.error.message.length).toBeGreaterThan(0);
}

describe('loopback-only server configuration', () => {
  it('accepts only loopback hosts and maps localhost to 127.0.0.1', () => {
    for (const host of ['127.0.0.1', '127.1.2.3', '::1', '[::1]', 'localhost', 'LOCALHOST']) {
      expect(isLoopbackHost(host)).toBe(true);
      expect(assertLoopbackHost(host)).toMatch(/^(127\.\d+\.\d+\.\d+|::1|0:0:0:0:0:0:0:1)$/);
    }
    expect(assertLoopbackHost('localhost')).toBe(DEFAULT_HOST);

    for (const host of [
      '0.0.0.0',
      '::',
      '192.168.1.20',
      '10.0.0.1',
      'example.com',
      'localhost.example.com',
      '127.0.0.1.nip.io',
      '',
      '   ',
      'fe80::1%lo0',
    ]) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });

  it('rejects a non-loopback build host before the app is created', async () => {
    await expect(buildApp({ env: {}, host: '0.0.0.0', serveStatic: false })).rejects.toMatchObject({
      code: 'HOST_NOT_LOOPBACK',
      details: { host: '0.0.0.0' },
    });
  });

  it('defaults to 127.0.0.1:7373 and honors loopback-only environment overrides', () => {
    expect(resolveServerSettings({})).toEqual({ host: DEFAULT_HOST, port: DEFAULT_PORT });
    expect(resolveServerSettings({ LOOM_HOST: 'localhost', LOOM_PORT: '9001' })).toEqual({
      host: DEFAULT_HOST,
      port: 9001,
    });
    expect(resolveServerSettings({ LOOM_HOST: '::1', LOOM_PORT: ' 8080 ' })).toEqual({
      host: '::1',
      port: 8080,
    });

    expect(() => resolveServerSettings({ LOOM_HOST: '0.0.0.0' })).toThrowError(
      expect.objectContaining({ code: 'HOST_NOT_LOOPBACK' }),
    );
    expect(() => resolveServerSettings({ LOOM_PORT: 'not-a-port' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_PORT' }),
    );
    expect(() => resolveServerSettings({ LOOM_PORT: '70000' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_PORT' }),
    );
  });
});

describe('GET /api/health through the composition root', () => {
  it('returns status, package version, config directory, port, and run summary', async () => {
    const configStore = configStoreFor('health-config');
    const app = await makeApp({ configStore, port: 7444 });

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');

    const body = response.json<HealthResponse>();
    expect(body).toEqual({
      status: 'ok',
      version: await packageVersion(),
      configDirectory: configStore.getConfigDir(),
      port: 7444,
      activeRun: { active: false, runId: null, status: null },
    });
    expect(body.version).toBe(LOOM_VERSION);
    expect(response.body).not.toContain('harnessCommands');
  });

  it('reports an injected active-run summary without changing the route shape', async () => {
    const app = await makeApp({
      getActiveRun: () => ({ active: true, runId: 'run_test', status: 'running' }),
    });

    const body = (await app.inject({ method: 'GET', url: '/api/health' })).json<HealthResponse>();
    expect(body.activeRun).toEqual({ active: true, runId: 'run_test', status: 'running' });
  });

  it('does not create or read the config file just to answer health', async () => {
    const configStore = configStoreFor('untouched');
    const app = await makeApp({ configStore });

    await app.inject({ method: 'GET', url: '/api/health' });

    await expect(readFile(configStore.getConfigPath(), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('reports the persisted pointer without starting recovery or reading configuration', async () => {
    const configStore = configStoreFor('persisted-health');
    await mkdir(configStore.getConfigDir(), { recursive: true });
    const pointerPath = join(configStore.getConfigDir(), 'active-run.json');
    const pointer = {
      version: 1,
      runId: 'run_test',
      projectId: 'project',
      projectPath: join(root, 'missing-project'),
      status: 'awaiting-user',
      startedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const original = JSON.stringify(pointer);
    await writeFile(pointerPath, original);
    const app = await makeApp({ configStore });

    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json<HealthResponse>().activeRun).toEqual({
      active: true, runId: 'run_test', status: 'awaiting-user',
    });
    expect(await readFile(pointerPath, 'utf8')).toBe(original);
    await expect(readFile(configStore.getConfigPath(), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('surfaces a corrupt pointer without changing it or claiming the run is inactive', async () => {
    const configStore = configStoreFor('corrupt-health');
    await mkdir(configStore.getConfigDir(), { recursive: true });
    const pointerPath = join(configStore.getConfigDir(), 'active-run.json');
    await writeFile(pointerPath, '{"version":');
    const app = await makeApp({ configStore });

    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(500);
    expectEnvelope(response.json<unknown>(), 'INTERNAL_ERROR');
    expect(await readFile(pointerPath, 'utf8')).toBe('{"version":');
  });
});

describe('shared API error envelope', () => {
  it('returns the envelope for an unknown API route', async () => {
    const app = await makeApp();

    const response = await app.inject({ method: 'GET', url: '/api/does-not-exist?x=1' });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
    const body = response.json<unknown>();
    expectEnvelope(body, 'NOT_FOUND');
    expect(body).toMatchObject({
      error: { details: { method: 'GET', path: '/api/does-not-exist' } },
    });
  });

  it('returns the envelope for unknown non-API routes when no UI build is served', async () => {
    const app = await makeApp();

    const response = await app.inject({ method: 'GET', url: '/projects/abc' });

    expect(response.statusCode).toBe(404);
    expectEnvelope(response.json<unknown>(), 'NOT_FOUND');
  });

  it('returns the envelope for an uncaught handler error without leaking internals', async () => {
    const throwingStore: ConfigStore = {
      getConfigDir: () => {
        throw new Error('secret internal detail');
      },
      getConfigPath: () => join(root, 'never'),
      get: async () => {
        throw new Error('unused');
      },
      update: async () => {
        throw new Error('unused');
      },
      write: async () => {
        throw new Error('unused');
      },
    };
    const app = await makeApp({ configStore: throwingStore });

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(500);
    const body = response.json<unknown>();
    expectEnvelope(body, 'INTERNAL_ERROR');
    expect(response.body).not.toContain('secret internal detail');
    expect(response.body).not.toContain('stack');
  });

  it('never wraps a successful response in an error envelope', async () => {
    const app = await makeApp();
    const body = (await app.inject({ method: 'GET', url: '/api/health' })).json<unknown>();

    expect(isApiErrorEnvelope(body)).toBe(false);
  });
});

describe('production static serving and SPA fallback', () => {
  async function makeWebRoot(): Promise<string> {
    const webRoot = join(root, 'dist-web');
    await mkdir(join(webRoot, 'assets'), { recursive: true });
    await writeFile(
      join(webRoot, 'index.html'),
      '<!doctype html><html><body><div id="root">Skill Loom shell</div></body></html>',
      'utf8',
    );
    await writeFile(join(webRoot, 'assets', 'app.js'), 'console.log("loom");\n', 'utf8');
    return webRoot;
  }

  it('serves the built UI, assets, and the SPA fallback while keeping /api JSON', async () => {
    const webRoot = await makeWebRoot();
    const app = await makeApp({ serveStatic: true, webRoot });

    const index = await app.inject({ method: 'GET', url: '/' });
    expect(index.statusCode).toBe(200);
    expect(index.headers['content-type']).toContain('text/html');
    expect(index.body).toContain('Skill Loom shell');

    const directRoute = await app.inject({ method: 'GET', url: '/projects/abc' });
    expect(directRoute.statusCode).toBe(200);
    expect(directRoute.body).toContain('Skill Loom shell');

    const asset = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['content-type']).toContain('javascript');
    expect(asset.body).toContain('console.log');

    const missingApi = await app.inject({ method: 'GET', url: '/api/missing' });
    expect(missingApi.statusCode).toBe(404);
    expect(missingApi.headers['content-type']).toContain('application/json');
    expectEnvelope(missingApi.json<unknown>(), 'NOT_FOUND');

    const nonGet = await app.inject({ method: 'POST', url: '/projects/abc' });
    expect(nonGet.statusCode).toBe(404);
    expectEnvelope(nonGet.json<unknown>(), 'NOT_FOUND');
  });

  it('falls back to the envelope when a static UI build is absent', async () => {
    const app = await makeApp({ serveStatic: true, webRoot: join(root, 'no-build-here') });

    const response = await app.inject({ method: 'GET', url: '/projects/abc' });
    expect(response.statusCode).toBe(404);
    expectEnvelope(response.json<unknown>(), 'NOT_FOUND');
  });
});

describe('process lifecycle', () => {
  it.each(['SIGTERM', 'SIGINT'] as const)(
    'closes the real server and exits on %s',
    async (signal) => {
      const port = await freePort();
      const configDir = join(root, `signal-${signal}`);
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', join(PROJECT_ROOT, 'src', 'server', 'index.ts')],
        {
          cwd: PROJECT_ROOT,
          env: {
            ...process.env,
            NODE_ENV: 'test',
            LOOM_HOST: '127.0.0.1',
            LOOM_PORT: String(port),
            LOOM_CONFIG_DIR: configDir,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const stderr: string[] = [];
      child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString('utf8')));

      try {
        await waitForHealth(child, port, stderr);
        child.kill(signal);
        const result = await waitForExit(child);
        expect(result).toEqual({ code: 0, signal: null });
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
          await waitForExit(child).catch(() => undefined);
        }
      }

      // The config directory is empty until a feature actually reads config.
      await expect(readFile(join(configDir, 'config.json'), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  it('refuses to start a real process on a non-loopback host', async () => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', join(PROJECT_ROOT, 'src', 'server', 'index.ts')],
      {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          LOOM_HOST: '0.0.0.0',
          LOOM_PORT: '7399',
          LOOM_CONFIG_DIR: join(root, 'non-loopback'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const stderr: string[] = [];
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString('utf8')));

    const result = await waitForExit(child);

    expect(result.code).not.toBe(0);
    expect(stderr.join('')).toContain('HOST_NOT_LOOPBACK');
  });
});

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a loopback test port.'));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

async function waitForHealth(
  child: ChildProcess,
  port: number,
  stderr: string[],
): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Server exited before becoming healthy (code ${String(child.exitCode)}): ${stderr.join('')}`,
      );
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) {
        return;
      }
      lastError = new Error(`Health returned ${response.status}.`);
    } catch (error) {
      lastError = error;
    }

    await delay(50);
  }

  throw new Error(`Server did not become healthy: ${String(lastError)}\n${stderr.join('')}`);
}

function waitForExit(child: ChildProcess): Promise<{ code: number | null; signal: string | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }

  return new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Server did not exit within the shutdown timeout.'));
    }, 5_000);
    timer.unref();

    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}
