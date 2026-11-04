import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { createConfigStore } from '../../src/server/config/store.js';
import type { GitInitRunner } from '../../src/server/projects/registry.js';
import {
  isApiErrorEnvelope,
  type ApiErrorEnvelope,
  type ApiValidationIssue,
} from '../../src/shared/api.js';

interface ProjectPayload {
  id: string;
  canonicalPath: string;
  displayName: string;
  lastOpenedAt: string;
  isGitRepo: boolean;
  gitInitialized: boolean;
  loom: {
    directory: string;
    gitignoreCreated: boolean;
    chainCount: number;
    hasChains: boolean;
  };
}

interface RecentPayload {
  id: string;
  canonicalPath: string;
  displayName: string;
  lastOpenedAt: string;
}

let root: string;
let configDirectory: string;
let apps: FastifyInstance[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loom-project-routes-'));
  configDirectory = join(root, 'config');
  apps = [];
});

afterEach(async () => {
  for (const app of apps.splice(0)) {
    await app.close();
  }
  await rm(root, { recursive: true, force: true });
});

async function buildTestApp(gitInit?: GitInitRunner): Promise<FastifyInstance> {
  const app = await buildApp({
    env: {},
    serveStatic: false,
    configStore: createConfigStore({
      env: { LOOM_CONFIG_DIR: configDirectory },
      homeDirectory: () => join(root, 'home'),
    }),
    ...(gitInit === undefined ? {} : { projectGitInit: gitInit }),
  });
  apps.push(app);
  return app;
}

async function postProject(
  app: FastifyInstance,
  payload: unknown,
): Promise<{ statusCode: number; body: unknown; raw: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: payload as Record<string, unknown>,
  });
  return {
    statusCode: response.statusCode,
    body: response.json<unknown>(),
    raw: response.body,
  };
}

async function getRecent(
  app: FastifyInstance,
): Promise<{ statusCode: number; body: unknown }> {
  const response = await app.inject({ method: 'GET', url: '/api/projects/recent' });
  return { statusCode: response.statusCode, body: response.json<unknown>() };
}

async function deleteRecent(
  app: FastifyInstance,
  projectId: string,
): Promise<{ statusCode: number; body: unknown }> {
  const response = await app.inject({
    method: 'DELETE',
    url: `/api/projects/recent/${encodeURIComponent(projectId)}`,
  });
  return { statusCode: response.statusCode, body: response.json<unknown>() };
}

function projectOf(body: unknown): ProjectPayload {
  expect(body).toMatchObject({ project: expect.any(Object) });
  return (body as { project: ProjectPayload }).project;
}

function recentOf(body: unknown): RecentPayload[] {
  expect(body).toMatchObject({ projects: expect.any(Array) });
  return (body as { projects: RecentPayload[] }).projects;
}

function envelope(body: unknown): ApiErrorEnvelope {
  expect(isApiErrorEnvelope(body)).toBe(true);
  if (!isApiErrorEnvelope(body)) {
    throw new Error('Expected the shared API error envelope.');
  }
  expect(body.error.message.length).toBeGreaterThan(0);
  expect(body.error.message).not.toContain('stack');
  return body;
}

function issuesOf(body: unknown): ApiValidationIssue[] {
  const error = envelope(body);
  const details = error.error.details as { issues?: ApiValidationIssue[] } | undefined;
  return details?.issues ?? [];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('POST /api/projects through the composition root', () => {
  it('opens an existing project, initializes .loom, and lists it as recent', async () => {
    const project = join(root, 'existing-project');
    await mkdir(project);
    const secret = 'PROJECT-FILE-SECRET-MARKER';
    await writeFile(join(project, 'secret.txt'), secret, 'utf8');

    const app = await buildTestApp();
    const { statusCode, body, raw } = await postProject(app, { path: project });

    expect(statusCode).toBe(200);
    expect(raw).not.toContain(secret);

    const registration = projectOf(body);
    expect(registration.canonicalPath).toBe(await realpath(project));
    expect(registration.displayName).toBe('existing-project');
    expect(registration.gitInitialized).toBe(false);
    expect(registration.isGitRepo).toBe(false);
    expect(registration.loom.gitignoreCreated).toBe(true);
    expect(registration.loom.chainCount).toBe(0);
    expect(registration.loom.hasChains).toBe(false);

    expect(await readFile(join(project, '.loom', '.gitignore'), 'utf8')).toBe('runs/\n');
    expect(await exists(join(project, '.loom', 'chains'))).toBe(false);
    expect(await exists(join(project, '.loom', 'runs'))).toBe(false);

    const recent = await getRecent(app);
    expect(recent.statusCode).toBe(200);
    expect(recentOf(recent.body)).toEqual([
      {
        id: registration.id,
        canonicalPath: await realpath(project),
        displayName: 'existing-project',
        lastOpenedAt: registration.lastOpenedAt,
      },
    ]);
  });

  it('returns the same id for a repeated open and keeps one recent entry', async () => {
    const project = join(root, 'repeat');
    await mkdir(project);
    const app = await buildTestApp();

    const first = projectOf((await postProject(app, { path: project })).body);
    const second = projectOf((await postProject(app, { path: project })).body);

    expect(first.id).toBe(second.id);
    expect(Date.parse(second.lastOpenedAt)).toBeGreaterThanOrEqual(
      Date.parse(first.lastOpenedAt),
    );

    const recent = recentOf((await getRecent(app)).body);
    expect(recent).toHaveLength(1);
    expect(recent[0]?.id).toBe(first.id);
  });

  it('rejects a file path, a relative path, and a missing directory with typed envelopes', async () => {
    const project = join(root, 'paths');
    await mkdir(project);
    const file = join(project, 'notes.txt');
    await writeFile(file, 'file body\n', 'utf8');
    const app = await buildTestApp();

    const fileResponse = await postProject(app, { path: file });
    expect(fileResponse.statusCode).toBe(400);
    expect(envelope(fileResponse.body).error.code).toBe('PATH_NOT_DIRECTORY');

    const relativeResponse = await postProject(app, { path: 'relative/project' });
    expect(relativeResponse.statusCode).toBe(422);
    expect(envelope(relativeResponse.body).error.code).toBe('PATH_NOT_ABSOLUTE');

    const missingResponse = await postProject(app, {
      path: join(root, 'missing-directory'),
    });
    expect(missingResponse.statusCode).toBe(404);
    expect(envelope(missingResponse.body).error.code).toBe('PATH_NOT_FOUND');
  });

  it('preserves an existing .loom/.gitignore across opens', async () => {
    const project = join(root, 'custom-ignore');
    await mkdir(join(project, '.loom'), { recursive: true });
    const custom = '# keep this\nnode_modules/\nruns/\n';
    await writeFile(join(project, '.loom', '.gitignore'), custom, 'utf8');

    const app = await buildTestApp();
    const first = projectOf((await postProject(app, { path: project })).body);
    const second = projectOf((await postProject(app, { path: project })).body);

    expect(first.loom.gitignoreCreated).toBe(false);
    expect(second.loom.gitignoreCreated).toBe(false);
    expect(await readFile(join(project, '.loom', '.gitignore'), 'utf8')).toBe(custom);
  });

  it('reports existing chains without creating or deleting them', async () => {
    const project = join(root, 'chains-project');
    await mkdir(join(project, '.loom', 'chains'), { recursive: true });
    const chainPath = join(project, '.loom', 'chains', 'alpha.json');
    await writeFile(chainPath, '{"version":1,"id":"alpha"}\n', 'utf8');

    const app = await buildTestApp();
    const registration = projectOf((await postProject(app, { path: project })).body);

    expect(registration.loom.chainCount).toBe(1);
    expect(registration.loom.hasChains).toBe(true);
    expect(await readFile(chainPath, 'utf8')).toBe('{"version":1,"id":"alpha"}\n');
    expect(await exists(join(project, '.loom', 'runs'))).toBe(false);
  });

  it('returns field-specific validation issues for malformed bodies', async () => {
    const project = join(root, 'validation-project');
    await mkdir(project);
    const app = await buildTestApp();

    const missingPath = await postProject(app, {});
    expect(missingPath.statusCode).toBe(422);
    expect(envelope(missingPath.body).error.code).toBe('VALIDATION_ERROR');
    expect(issuesOf(missingPath.body)).toContainEqual(
      expect.objectContaining({ path: 'path' }),
    );

    const missingName = await postProject(app, {
      mode: 'create',
      parentPath: project,
    });
    expect(missingName.statusCode).toBe(422);
    expect(issuesOf(missingName.body)).toContainEqual(
      expect.objectContaining({ path: 'name' }),
    );

    const wrongType = await postProject(app, { path: 42 });
    expect(wrongType.statusCode).toBe(422);
    expect(issuesOf(wrongType.body)).toContainEqual(
      expect.objectContaining({ path: 'path' }),
    );

    const invalidGit = await postProject(app, {
      mode: 'create',
      parentPath: project,
      name: 'child',
      gitInit: 'yes',
    });
    expect(invalidGit.statusCode).toBe(422);
    expect(issuesOf(invalidGit.body)).toContainEqual(
      expect.objectContaining({ path: 'gitInit' }),
    );
  });
});

describe('POST /api/projects create mode', () => {
  it('creates an empty folder without templates and without git by default', async () => {
    const app = await buildTestApp();
    const { statusCode, body } = await postProject(app, {
      mode: 'create',
      parentPath: root,
      name: 'brand-new',
    });

    expect(statusCode).toBe(201);
    const registration = projectOf(body);
    const target = join(root, 'brand-new');

    expect(registration.canonicalPath).toBe(await realpath(target));
    expect(registration.gitInitialized).toBe(false);
    expect(registration.isGitRepo).toBe(false);
    expect(await readdir(target)).toEqual(['.loom']);
    expect(await exists(join(target, '.git'))).toBe(false);
    expect(await exists(join(target, 'package.json'))).toBe(false);
    expect(await exists(join(target, '.loom', 'chains'))).toBe(false);
  });

  it('runs git init only when requested and reports the created repository', async () => {
    const calls: string[] = [];
    const gitInit: GitInitRunner = async (directory) => {
      calls.push(directory);
      await mkdir(join(directory, '.git'));
    };
    const app = await buildTestApp(gitInit);

    const withGit = await postProject(app, {
      mode: 'create',
      parentPath: root,
      name: 'with-git',
      gitInit: true,
    });
    expect(withGit.statusCode).toBe(201);
    expect(projectOf(withGit.body).gitInitialized).toBe(true);
    expect(projectOf(withGit.body).isGitRepo).toBe(true);
    expect(calls).toEqual([await realpath(join(root, 'with-git'))]);

    const withoutGit = await postProject(app, {
      mode: 'create',
      parentPath: root,
      name: 'without-git',
    });
    expect(withoutGit.statusCode).toBe(201);
    expect(projectOf(withoutGit.body).gitInitialized).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('reports git unavailability as a typed 503 without registering the project', async () => {
    const gitInit: GitInitRunner = async () => {
      throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
    };
    const app = await buildTestApp(gitInit);

    const response = await postProject(app, {
      mode: 'create',
      parentPath: root,
      name: 'git-missing',
      gitInit: true,
    });

    expect(response.statusCode).toBe(503);
    expect(envelope(response.body).error.code).toBe('GIT_UNAVAILABLE');
    expect(recentOf((await getRecent(app)).body)).toEqual([]);
  });

  it('reports a failed git init as a typed 500 with the exit code', async () => {
    const gitInit: GitInitRunner = async () => {
      throw Object.assign(new Error('git init failed'), {
        code: 'GIT_INIT_EXIT',
        exitCode: 128,
      });
    };
    const app = await buildTestApp(gitInit);

    const response = await postProject(app, {
      mode: 'create',
      parentPath: root,
      name: 'git-failed',
      gitInit: true,
    });

    expect(response.statusCode).toBe(500);
    const error = envelope(response.body);
    expect(error.error.code).toBe('GIT_INIT_FAILED');
    expect(error.error.details).toMatchObject({ exitCode: 128 });
  });

  it('rejects an existing target with a conflict and leaves it untouched', async () => {
    const existing = join(root, 'occupied');
    await mkdir(existing);
    await writeFile(join(existing, 'marker.txt'), 'original\n', 'utf8');
    const app = await buildTestApp();

    const response = await postProject(app, {
      mode: 'create',
      parentPath: root,
      name: 'occupied',
    });

    expect(response.statusCode).toBe(409);
    expect(envelope(response.body).error.code).toBe('PROJECT_CREATE_TARGET_EXISTS');
    expect(await readFile(join(existing, 'marker.txt'), 'utf8')).toBe('original\n');
    expect(await exists(join(existing, '.loom'))).toBe(false);
    expect(recentOf((await getRecent(app)).body)).toEqual([]);
  });

  it('rejects a missing parent directory', async () => {
    const app = await buildTestApp();

    const response = await postProject(app, {
      mode: 'create',
      parentPath: join(root, 'missing-parent'),
      name: 'child',
    });

    expect(response.statusCode).toBe(404);
    expect(envelope(response.body).error.code).toBe('PATH_NOT_FOUND');
  });

  it('rejects names that would escape the selected parent', async () => {
    const app = await buildTestApp();

    for (const name of ['..', '../escape', 'nested/child', ' padded']) {
      const response = await postProject(app, {
        mode: 'create',
        parentPath: root,
        name,
      });
      expect(response.statusCode).toBe(422);
      expect(envelope(response.body).error.code).toBe('PROJECT_NAME_INVALID');
    }

    expect(await exists(join(root, 'escape'))).toBe(false);
  });
});

describe('GET /api/projects/recent and DELETE /api/projects/recent/:projectId', () => {
  it('returns recent projects newest first, including after a reopen', async () => {
    const alpha = join(root, 'alpha');
    const beta = join(root, 'beta');
    await mkdir(alpha);
    await mkdir(beta);
    const app = await buildTestApp();

    await postProject(app, { path: alpha });
    await postProject(app, { path: beta });

    let recent = recentOf((await getRecent(app)).body);
    expect(recent.map((entry) => entry.displayName)).toEqual(['beta', 'alpha']);
    for (let index = 1; index < recent.length; index += 1) {
      expect(Date.parse(recent[index - 1]!.lastOpenedAt)).toBeGreaterThanOrEqual(
        Date.parse(recent[index]!.lastOpenedAt),
      );
    }

    await postProject(app, { path: alpha });
    recent = recentOf((await getRecent(app)).body);
    expect(recent.map((entry) => entry.displayName)).toEqual(['alpha', 'beta']);
    expect(recent).toHaveLength(2);
  });

  it('removes only the recent entry and leaves every project file intact', async () => {
    const project = join(root, 'keep-files');
    await mkdir(join(project, '.loom', 'chains'), { recursive: true });
    await writeFile(join(project, 'source.ts'), 'export const kept = true;\n', 'utf8');
    const chainPath = join(project, '.loom', 'chains', 'chain.json');
    await writeFile(chainPath, '{"version":1}\n', 'utf8');

    const app = await buildTestApp();
    const registration = projectOf((await postProject(app, { path: project })).body);

    const removed = await deleteRecent(app, registration.id);
    expect(removed.statusCode).toBe(200);
    expect(removed.body).toEqual({ projectId: registration.id, removed: true });

    expect(recentOf((await getRecent(app)).body)).toEqual([]);
    expect(await readFile(join(project, 'source.ts'), 'utf8')).toBe(
      'export const kept = true;\n',
    );
    expect(await readFile(chainPath, 'utf8')).toBe('{"version":1}\n');
  });

  it('returns 404 for an unknown recent entry and 422 for a malformed id', async () => {
    const app = await buildTestApp();
    const project = join(root, 'registered');
    await mkdir(project);
    const registration = projectOf((await postProject(app, { path: project })).body);

    const first = await deleteRecent(app, registration.id);
    expect(first.statusCode).toBe(200);

    const second = await deleteRecent(app, registration.id);
    expect(second.statusCode).toBe(404);
    expect(envelope(second.body).error.code).toBe('RECENT_PROJECT_NOT_FOUND');

    const malformed = await deleteRecent(app, 'not-a-valid-id');
    expect(malformed.statusCode).toBe(422);
    expect(envelope(malformed.body).error.code).toBe('PROJECT_ID_INVALID');

    const traversal = await app.inject({
      method: 'DELETE',
      url: '/api/projects/recent/..%5Cescape',
    });
    expect(traversal.statusCode).toBe(422);
    expect(envelope(traversal.json<unknown>()).error.code).toBe('PROJECT_ID_INVALID');
  });
});
