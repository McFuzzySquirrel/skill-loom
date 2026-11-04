import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { CopilotCommandRunner } from '../../src/server/catalog/copilot.js';
import {
  createCatalogService,
  createDefaultCatalogAdapters,
  type CatalogResponse,
} from '../../src/server/catalog/merge.js';
import { createConfigStore, type ConfigStore } from '../../src/server/config/store.js';
import { isApiErrorEnvelope, type ApiErrorEnvelope } from '../../src/shared/api.js';

interface ProjectPayload {
  id: string;
  canonicalPath: string;
  displayName: string;
}

let root: string;
let project: string;
let configDirectory: string;
let home: string;
let extraDirectory: string;
let configStore: ConfigStore;
let catalogService: ReturnType<typeof createCatalogService>;
let apps: FastifyInstance[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'slan-catalog-routes-'));
  project = join(root, 'workspace', 'demo-project');
  configDirectory = join(root, 'config');
  home = join(root, 'home');
  extraDirectory = join(root, 'extra-skills');
  apps = [];

  await mkdir(project, { recursive: true });
  await mkdir(home, { recursive: true });
  await mkdir(extraDirectory, { recursive: true });

  await writeSkill(
    join(project, '.opencode', 'skills', 'deploy'),
    'deploy',
    'Ships a release',
  );
  await writeSkill(
    join(project, '.opencode', 'skills', 'shared-name'),
    'shared-name',
    'Project copy',
  );
  await writeSkill(
    join(home, '.config', 'opencode', 'skills', 'shared-name'),
    'shared-name',
    'Personal copy',
  );
  await writeSkill(join(extraDirectory, 'extra-skill'), 'extra-skill', 'Deploys the RELEASE pipeline');

  const copilotProjectDirectory = join(root, 'copilot', 'project-skill');
  const copilotPersonalDirectory = join(root, 'copilot', 'personal-skill');
  await writeSkill(copilotProjectDirectory, 'copilot-project', 'Copilot project skill');
  await writeSkill(copilotPersonalDirectory, 'copilot-personal', 'Copilot personal skill');

  const copilotRunner: CopilotCommandRunner = async () => ({
    exitCode: 0,
    stdout: JSON.stringify([
      {
        name: 'copilot-project',
        description: 'Copilot project skill',
        source: 'project',
        path: copilotProjectDirectory,
        enabled: true,
      },
      {
        name: 'copilot-personal',
        description: 'Copilot personal skill',
        source: 'personal',
        path: copilotPersonalDirectory,
        enabled: true,
      },
    ]),
    stderr: '',
    timedOut: false,
  });

  configStore = createConfigStore({
    env: { SLAN_CONFIG_DIR: configDirectory },
    homeDirectory: () => home,
  });
  catalogService = createCatalogService({
    configStore,
    adapters: createDefaultCatalogAdapters({
      homeDirectory: home,
      copilotRunner,
    }),
  });
});

afterEach(async () => {
  for (const app of apps.splice(0)) {
    await app.close();
  }
  await rm(root, { recursive: true, force: true });
});

async function writeSkill(
  directory: string,
  name: string,
  description: string,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\nBody for ${name}.\n`,
    'utf8',
  );
}

async function buildTestApp(): Promise<FastifyInstance> {
  const app = await buildApp({
    env: {},
    serveStatic: false,
    configStore,
    catalogService,
  });
  apps.push(app);
  return app;
}

async function openProject(app: FastifyInstance): Promise<ProjectPayload> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { mode: 'open', path: project },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ project: ProjectPayload }>().project;
}

async function getCatalog(
  app: FastifyInstance,
  projectId: string,
  harness: string,
  query?: string,
): Promise<{ statusCode: number; body: unknown }> {
  const params = new URLSearchParams({ harness });
  if (query !== undefined) {
    params.set('q', query);
  }
  const response = await app.inject({
    method: 'GET',
    url: `/api/projects/${encodeURIComponent(projectId)}/catalog?${params.toString()}`,
  });
  return { statusCode: response.statusCode, body: response.json<unknown>() };
}

async function postExtraDirectory(
  app: FastifyInstance,
  path: string,
): Promise<{ statusCode: number; body: unknown }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/settings/extra-skill-directories',
    payload: { path },
  });
  return { statusCode: response.statusCode, body: response.json<unknown>() };
}

async function deleteExtraDirectory(
  app: FastifyInstance,
  path: string,
): Promise<{ statusCode: number; body: unknown }> {
  const response = await app.inject({
    method: 'DELETE',
    url: `/api/settings/extra-skill-directories?${new URLSearchParams({ path }).toString()}`,
  });
  return { statusCode: response.statusCode, body: response.json<unknown>() };
}

async function getExtraDirectories(
  app: FastifyInstance,
): Promise<{ statusCode: number; body: unknown }> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/settings/extra-skill-directories',
  });
  return { statusCode: response.statusCode, body: response.json<unknown>() };
}

function catalogOf(body: unknown): CatalogResponse {
  return body as CatalogResponse;
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

function names(catalog: CatalogResponse): string[] {
  return catalog.groups.flatMap((group) => group.entries).map((entry) => entry.name);
}

describe('GET /api/projects/:projectId/catalog', () => {
  it('returns grouped OpenCode entries with duplicate names kept separate', async () => {
    const app = await buildTestApp();
    const registered = await openProject(app);

    const result = await getCatalog(app, registered.id, 'opencode');

    expect(result.statusCode).toBe(200);
    const catalog = catalogOf(result.body);
    expect(catalog.harness).toBe('opencode');
    expect(catalog.query).toBe('');
    expect(catalog.total).toBe(3);
    expect(catalog.groups.map((group) => group.source)).toEqual(['project', 'personal']);
    expect(catalog.groups.map((group) => group.count)).toEqual([2, 1]);

    const shared = catalog.groups
      .flatMap((group) => group.entries)
      .filter((entry) => entry.name === 'shared-name');
    expect(shared).toHaveLength(2);
    expect(shared.map((entry) => entry.source).sort()).toEqual(['personal', 'project']);
    expect(new Set(shared.map((entry) => entry.id)).size).toBe(2);
    expect(shared.every((entry) => entry.harness === 'opencode')).toBe(true);
  });

  it('searches case-insensitively across name and description', async () => {
    const app = await buildTestApp();
    const registered = await openProject(app);

    const byName = await getCatalog(app, registered.id, 'opencode', 'SHARED');
    expect(byName.statusCode).toBe(200);
    expect(names(catalogOf(byName.body))).toEqual(['shared-name', 'shared-name']);

    const byDescription = await getCatalog(app, registered.id, 'opencode', 'PERSONAL COPY');
    expect(byDescription.statusCode).toBe(200);
    const catalog = catalogOf(byDescription.body);
    expect(names(catalog)).toEqual(['shared-name']);
    expect(catalog.groups.map((group) => group.source)).toEqual(['personal']);
    expect(catalog.total).toBe(1);
    expect(catalog.counts.bySource.project).toBe(0);
  });

  it('returns only the selected harness', async () => {
    const app = await buildTestApp();
    const registered = await openProject(app);

    const result = await getCatalog(app, registered.id, 'copilot');

    expect(result.statusCode).toBe(200);
    const catalog = catalogOf(result.body);
    expect(catalog.harness).toBe('copilot');
    expect(names(catalog).sort()).toEqual(['copilot-personal', 'copilot-project']);
    expect(catalog.groups.every((group) => group.entries.every((entry) => entry.harness === 'copilot'))).toBe(true);
  });

  it('rejects an invalid harness with the shared validation envelope', async () => {
    const app = await buildTestApp();
    const registered = await openProject(app);

    const result = await getCatalog(app, registered.id, 'unknown-harness');

    expect(result.statusCode).toBe(422);
    const failure = envelope(result.body);
    expect(failure.error.code).toBe('VALIDATION_ERROR');
    const details = failure.error.details as { issues: Array<{ path: string; code: string }> };
    expect(details.issues).toContainEqual(expect.objectContaining({ path: 'harness' }));
  });

  it('returns a 404 envelope for an unknown project and a 422 for an invalid id', async () => {
    const app = await buildTestApp();

    const missing = await getCatalog(app, 'missing-000000000000', 'opencode');
    expect(missing.statusCode).toBe(404);
    expect(envelope(missing.body).error.code).toBe('CATALOG_PROJECT_NOT_FOUND');

    const invalid = await getCatalog(app, 'INVALID-000000000000', 'opencode');
    expect(invalid.statusCode).toBe(422);
    expect(envelope(invalid.body).error.code).toBe('CATALOG_PROJECT_ID_INVALID');
  });
});

describe('extra skill directory settings', () => {
  it('adds an extra directory, reflects it in the catalog, then removes it', async () => {
    const app = await buildTestApp();
    const registered = await openProject(app);
    const canonicalExtra = await realpath(extraDirectory);

    const initial = await getExtraDirectories(app);
    expect(initial.statusCode).toBe(200);
    expect(initial.body).toEqual({ extraSkillDirectories: [] });

    const beforeAdd = await getCatalog(app, registered.id, 'opencode');
    expect(catalogOf(beforeAdd.body).total).toBe(3);

    const added = await postExtraDirectory(app, extraDirectory);
    expect(added.statusCode).toBe(201);
    expect(added.body).toEqual({
      directory: canonicalExtra,
      extraSkillDirectories: [canonicalExtra],
    });

    const listed = await getExtraDirectories(app);
    expect(listed.body).toEqual({ extraSkillDirectories: [canonicalExtra] });

    const withExtra = await getCatalog(app, registered.id, 'opencode');
    expect(withExtra.statusCode).toBe(200);
    const extraCatalog = catalogOf(withExtra.body);
    expect(extraCatalog.total).toBe(4);
    expect(extraCatalog.groups.map((group) => group.source)).toEqual([
      'project',
      'personal',
      'slan-extra',
    ]);
    expect(names(extraCatalog)).toContain('extra-skill');

    const copilot = await getCatalog(app, registered.id, 'copilot');
    expect(catalogOf(copilot.body).groups.map((group) => group.source)).not.toContain('slan-extra');

    const removed = await deleteExtraDirectory(app, extraDirectory);
    expect(removed.statusCode).toBe(200);
    expect(removed.body).toEqual({
      directory: canonicalExtra,
      extraSkillDirectories: [],
    });

    const afterRemove = await getCatalog(app, registered.id, 'opencode');
    expect(catalogOf(afterRemove.body).total).toBe(3);
    expect(names(catalogOf(afterRemove.body))).not.toContain('extra-skill');
  });

  it('rejects a duplicate directory with a 409 envelope', async () => {
    const app = await buildTestApp();
    await openProject(app);
    await postExtraDirectory(app, extraDirectory);

    const duplicate = await postExtraDirectory(app, extraDirectory);

    expect(duplicate.statusCode).toBe(409);
    expect(envelope(duplicate.body).error.code).toBe('EXTRA_SKILL_DIRECTORY_DUPLICATE');
  });

  it('rejects relative paths and unknown removals with the shared envelope', async () => {
    const app = await buildTestApp();

    const relative = await postExtraDirectory(app, 'relative/skills');
    expect(relative.statusCode).toBe(422);
    expect(envelope(relative.body).error.code).toBe('PATH_NOT_ABSOLUTE');

    const missing = await deleteExtraDirectory(app, join(root, 'never-configured'));
    expect(missing.statusCode).toBe(404);
    expect(envelope(missing.body).error.code).toBe('EXTRA_SKILL_DIRECTORY_NOT_FOUND');

    const missingPath = await app.inject({
      method: 'DELETE',
      url: '/api/settings/extra-skill-directories',
    });
    expect(missingPath.statusCode).toBe(422);
    expect(envelope(missingPath.json<unknown>()).error.code).toBe('VALIDATION_ERROR');
  });
});
