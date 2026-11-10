import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { createConfigStore } from '../../src/server/config/store.js';
import { isApiErrorEnvelope } from '../../src/shared/api.js';
import type { DirectoryListing } from '../../src/server/projects/browser.js';

let root: string;
let project: string;
let app: FastifyInstance;
let restoreModePaths: string[];

const unprivilegedIt = process.platform === 'win32' || process.getuid?.() === 0 ? it.skip : it;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loom-fs-routes-'));
  project = join(root, 'project');
  restoreModePaths = [];

  await mkdir(join(project, 'Alpha'), { recursive: true });
  await mkdir(join(project, 'Alpha', '.git'), { recursive: true });
  await mkdir(join(project, 'Alpha', '.loom'), { recursive: true });
  await mkdir(join(project, 'beta'), { recursive: true });
  await writeFile(join(project, 'A.txt'), 'first file\n', 'utf8');
  await writeFile(join(project, 'b.txt'), 'second file\n', 'utf8');

  app = await buildApp({
    env: {},
    serveStatic: false,
    configStore: createConfigStore({
      env: { LOOM_CONFIG_DIR: join(root, 'config') },
      homeDirectory: () => join(root, 'home'),
    }),
  });
});

afterEach(async () => {
  await app.close();
  for (const path of restoreModePaths.splice(0)) {
    await chmod(path, 0o755).catch(() => undefined);
  }
  await rm(root, { recursive: true, force: true });
});

async function list(path: string): Promise<{ statusCode: number; body: unknown }> {
  const response = await app.inject({ method: 'GET', url: '/api/fs', query: { path } });
  return { statusCode: response.statusCode, body: response.json<unknown>() };
}

function expectEnvelope(body: unknown, code: string): void {
  expect(isApiErrorEnvelope(body)).toBe(true);
  if (!isApiErrorEnvelope(body)) {
    throw new Error('Expected the shared API error envelope.');
  }
  expect(body.error.code).toBe(code);
  expect(body.error.message.length).toBeGreaterThan(0);
  expect(body.error.message).not.toContain('stack');
}

describe('GET /api/fs through the composition root', () => {
  it('lists a canonical directory with metadata, ordering, and flags', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/fs',
      query: { path: project },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');

    const listing = response.json<DirectoryListing>();
    expect(listing.path).toBe(await realpath(project));
    expect(listing.parent).toBe(await realpath(root));
    expect(listing.truncated).toBe(false);
    expect(listing.entries.map((entry) => entry.name)).toEqual([
      'Alpha',
      'beta',
      'A.txt',
      'b.txt',
    ]);

    expect(listing.entries[0]).toEqual({
      name: 'Alpha',
      path: join(listing.path, 'Alpha'),
      isDirectory: true,
      isGitRepo: true,
      hasLoom: true,
    });
    expect(listing.entries[1]).toMatchObject({
      name: 'beta',
      isDirectory: true,
      isGitRepo: false,
      hasLoom: false,
    });
    expect(listing.entries[2]).toMatchObject({
      name: 'A.txt',
      isDirectory: false,
      isGitRepo: false,
      hasLoom: false,
    });
  });

  it('never returns file contents', async () => {
    const secret = 'UNIQUE-SECRET-MARKER';
    await writeFile(join(project, 'secret.txt'), secret, 'utf8');

    const response = await app.inject({
      method: 'GET',
      url: '/api/fs',
      query: { path: project },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(secret);
  });

  it('returns a typed not-a-directory error for a file path', async () => {
    const file = join(project, 'A.txt');
    const { statusCode, body } = await list(file);

    expect(statusCode).toBe(400);
    expectEnvelope(body, 'PATH_NOT_DIRECTORY');
    if (isApiErrorEnvelope(body)) {
      expect(body.error.details).toMatchObject({ path: await realpath(file) });
    }
  });

  it('rejects a relative path instead of resolving it silently', async () => {
    const { statusCode, body } = await list('project/Alpha');

    expect(statusCode).toBe(422);
    expectEnvelope(body, 'PATH_NOT_ABSOLUTE');
  });

  it('rejects a missing path query with field-specific validation details', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/fs' });

    expect(response.statusCode).toBe(422);
    const body = response.json<unknown>();
    expectEnvelope(body, 'VALIDATION_ERROR');
    if (isApiErrorEnvelope(body)) {
      expect(body.error.details).toMatchObject({
        issues: [expect.objectContaining({ path: 'path' })],
      });
    }
  });

  it('returns a typed not-found error for a missing directory', async () => {
    const missing = join(root, 'absent');
    const { statusCode, body } = await list(missing);

    expect(statusCode).toBe(404);
    expectEnvelope(body, 'PATH_NOT_FOUND');
  });

  unprivilegedIt('returns a typed unreadable error for an unreadable directory', async () => {
    const locked = join(root, 'locked');
    await mkdir(locked);
    restoreModePaths.push(locked);
    await chmod(locked, 0o000);

    const { statusCode, body } = await list(locked);

    expect(statusCode).toBe(403);
    expectEnvelope(body, 'PATH_UNREADABLE');
  });

  unprivilegedIt('omits an unreadable child while the listing still succeeds', async () => {
    const locked = join(project, 'locked-child');
    await mkdir(locked);
    restoreModePaths.push(locked);
    await chmod(locked, 0o000);

    const { statusCode, body } = await list(project);

    expect(statusCode).toBe(200);
    const listing = body as DirectoryListing;
    expect(listing.entries.map((entry) => entry.name)).not.toContain('locked-child');
    expect(listing.entries.map((entry) => entry.name)).toContain('A.txt');
  });

  it('canonicalizes a symlinked directory request through realpath', async () => {
    const alias = join(root, 'project-alias');
    await symlink(project, alias, 'dir');

    const { statusCode, body } = await list(alias);

    expect(statusCode).toBe(200);
    const listing = body as DirectoryListing;
    expect(listing.path).toBe(await realpath(project));
    expect(listing.path).not.toBe(alias);
  });

  it('keeps API failures in the shared envelope for unsupported methods', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/fs' });

    expect(response.statusCode).toBe(404);
    expectEnvelope(response.json<unknown>(), 'NOT_FOUND');
  });
});
