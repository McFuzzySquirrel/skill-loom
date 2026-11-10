import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
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
import {
  listRemoteSkillSnapshots,
  refreshRemoteSkillSource,
} from '../../src/server/catalog/remote.js';
import type { RemoteSourceGitRunner } from '../../src/server/catalog/remote.js';
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
  root = await realpath(await mkdtemp(join(tmpdir(), 'loom-catalog-routes-')));
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
    join(project, '.agents', 'skills', 'shared-name'),
    'shared-name',
    'Project copy',
  );
  await writeSkill(
    join(home, '.config', 'opencode', 'skills', 'shared-name'),
    'shared-name',
    'Personal copy',
  );
  await writeSkill(join(extraDirectory, 'extra-skill'), 'extra-skill', 'Deploys the RELEASE pipeline');

  const copilotProjectDirectory = join(project, '.agents', 'skills', 'copilot-project');
  const copilotPersonalDirectory = join(root, 'copilot', 'personal-skill');
  await writeSkill(copilotProjectDirectory, 'copilot-project', 'Copilot project skill');
  await writeSkill(copilotPersonalDirectory, 'copilot-personal', 'Copilot personal skill');
  if (process.platform === 'win32') {
    execFileSync('git', ['-C', root, 'init', '--quiet']);
    execFileSync('git', ['-C', root, 'add', '--', 'home', 'copilot', 'extra-skills']);
  }

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
    env: { LOOM_CONFIG_DIR: configDirectory },
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
    expect(catalog.total).toBe(4);
    expect(catalog.groups.map((group) => group.source)).toEqual(['project', 'personal']);
    expect(catalog.groups.map((group) => group.count)).toEqual([3, 1]);

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

describe('POST /api/projects/:projectId/catalog/skills/:skillId/copy', () => {
  it('copies a personal OpenCode package into the project skill root', async () => {
    const app = await buildTestApp();
    const registered = await openProject(app);
    const catalog = catalogOf(
      (await getCatalog(app, registered.id, 'opencode')).body,
    );
    const personal = catalog.groups
      .flatMap((group) => group.entries)
      .find((entry) => entry.source === 'personal' && entry.name === 'shared-name');
    expect(personal).toBeDefined();

    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${encodeURIComponent(registered.id)}/catalog/skills/${encodeURIComponent(
        personal!.id,
      )}/copy?harness=opencode`,
    });
    expect(response.statusCode).toBe(201);
    const copied = response.json<{ destinationPath: string; name: string }>();
    expect(copied.name).toBe('shared-name');
    // The project already has a shared-name package in the shared root, so the copy is suffixed.
    expect(copied.destinationPath).toBe(
      join(project, '.agents', 'skills', 'shared-name-2'),
    );
    expect(await readFile(join(copied.destinationPath, 'SKILL.md'), 'utf8')).toContain(
      'Personal copy',
    );

    const after = catalogOf((await getCatalog(app, registered.id, 'opencode')).body);
    expect(after.groups.find((group) => group.source === 'project')?.count).toBe(4);
  });

  it('copies a Copilot personal skill into the shared project root', async () => {
    const app = await buildTestApp();
    const registered = await openProject(app);
    const catalog = catalogOf((await getCatalog(app, registered.id, 'copilot')).body);
    const personal = catalog.groups
      .flatMap((group) => group.entries)
      .find((entry) => entry.source === 'personal');
    expect(personal).toBeDefined();

    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${encodeURIComponent(registered.id)}/catalog/skills/${encodeURIComponent(
        personal!.id,
      )}/copy?harness=copilot`,
    });
    expect(response.statusCode).toBe(201);
    const copied = response.json<{ destinationPath: string }>();
    expect(copied.destinationPath.startsWith(join(project, '.agents', 'skills'))).toBe(
      true,
    );
  });

  it('rejects a project-source skill and an unknown skill id', async () => {
    const app = await buildTestApp();
    const registered = await openProject(app);
    const catalog = catalogOf(
      (await getCatalog(app, registered.id, 'opencode')).body,
    );
    const projectEntry = catalog.groups
      .flatMap((group) => group.entries)
      .find((entry) => entry.source === 'project');
    expect(projectEntry).toBeDefined();

    const projectCopy = await app.inject({
      method: 'POST',
      url: `/api/projects/${encodeURIComponent(registered.id)}/catalog/skills/${encodeURIComponent(
        projectEntry!.id,
      )}/copy?harness=opencode`,
    });
    expect(projectCopy.statusCode).toBe(409);
    expect(isApiErrorEnvelope(projectCopy.json())).toBe(true);

    const missing = await app.inject({
      method: 'POST',
      url: `/api/projects/${encodeURIComponent(registered.id)}/catalog/skills/missing-skill/copy?harness=opencode`,
    });
    expect(missing.statusCode).toBe(404);
    expect(isApiErrorEnvelope(missing.json())).toBe(true);
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
    expect(catalogOf(beforeAdd.body).total).toBe(4);

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
    expect(extraCatalog.total).toBe(5);
    expect(extraCatalog.groups.map((group) => group.source)).toEqual([
      'project',
      'personal',
      'loom-extra',
    ]);
    expect(names(extraCatalog)).toContain('extra-skill');

    const copilot = await getCatalog(app, registered.id, 'copilot');
    expect(catalogOf(copilot.body).groups.map((group) => group.source)).not.toContain('loom-extra');

    const removed = await deleteExtraDirectory(app, extraDirectory);
    expect(removed.statusCode).toBe(200);
    expect(removed.body).toEqual({
      directory: canonicalExtra,
      extraSkillDirectories: [],
    });

    const afterRemove = await getCatalog(app, registered.id, 'opencode');
    expect(catalogOf(afterRemove.body).total).toBe(4);
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

describe('remote skill source settings and catalog snapshots', () => {
  it('validates saved-commit refresh requests before attempting Git', async () => {
    const app = await buildTestApp();
    const add = await app.inject({
      method: 'POST',
      url: '/api/settings/remote-skill-sources',
      payload: { repository: 'https://example.com/acme/skills.git' },
    });
    const source = add.json<{ source: { id: string } }>().source;
    const url = `/api/settings/remote-skill-sources/${source.id}/refresh`;
    for (const payload of [{ revision: '../invalid' }, { revision: 1 }, { extra: true }]) {
      const response = await app.inject({ method: 'POST', url, payload });
      expect(response.statusCode).toBe(422);
      expect(envelope(response.json<unknown>()).error.code).toBe('VALIDATION_ERROR');
    }
    const missing = await app.inject({ method: 'POST', url, payload: { revision: 'f'.repeat(40) } });
    expect(missing.statusCode).toBe(404);
  });

  it('updates global and per-source budgets without affecting other sources', async () => {
    const app = await buildTestApp();
    const add = await app.inject({
      method: 'POST',
      url: '/api/settings/remote-skill-sources',
      payload: { repository: 'https://example.com/acme/skills.git' },
    });
    const source = add.json<{ source: { id: string } }>().source;
    const global = await app.inject({
      method: 'PUT',
      url: '/api/settings/remote-catalog-limits',
      payload: { limits: { maxPackages: 1_000, maxFiles: 20_000 } },
    });
    expect(global.statusCode).toBe(200);
    expect(global.json()).toMatchObject({
      global: { maxPackages: 1_000, maxFiles: 20_000 },
      defaults: { maxPackages: 100 },
      maximums: { maxPackages: 10_000 },
    });
    const override = await app.inject({
      method: 'PUT',
      url: `/api/settings/remote-skill-sources/${source.id}/limits`,
      payload: { limits: { maxPackages: 1_500 } },
    });
    expect(override.statusCode).toBe(200);
    expect(override.json()).toMatchObject({ source: { limits: { maxPackages: 1_500 } } });
    const invalid = await app.inject({
      method: 'PUT',
      url: `/api/settings/remote-skill-sources/${source.id}/limits`,
      payload: { limits: { maxFiles: 0 } },
    });
    expect(invalid.statusCode).toBe(422);
    const reset = await app.inject({
      method: 'PUT',
      url: `/api/settings/remote-skill-sources/${source.id}/limits`,
      payload: { limits: null },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json<{ source: { limits?: unknown } }>().source.limits).toBeUndefined();
    expect((await configStore.get()).remoteCatalogLimits.maxPackages).toBe(1_000);
  });

  it('saves an optional friendly name for a source', async () => {
    const app = await buildTestApp();
    const add = await app.inject({
      method: 'POST',
      url: '/api/settings/remote-skill-sources',
      payload: { repository: 'https://example.com/acme/skills.git' },
    });
    const source = add.json<{ source: { id: string } }>().source;
    const save = await app.inject({
      method: 'PUT',
      url: `/api/settings/remote-skill-sources/${source.id}/name`,
      payload: { name: '  Team skills  ' },
    });
    expect(save.statusCode).toBe(200);
    expect(save.json()).toMatchObject({ source: { name: 'Team skills' } });

    const clear = await app.inject({
      method: 'PUT',
      url: `/api/settings/remote-skill-sources/${source.id}/name`,
      payload: { name: '' },
    });
    expect(clear.statusCode).toBe(200);
    expect(clear.json<{ source: { name?: string } }>().source.name).toBeUndefined();
  });

  it('registers sources, catalogs pinned packages for both harnesses, and unregisters with their snapshots', async () => {
    const app = await buildTestApp();
    const registered = await openProject(app);
    const repository = 'https://example.com/acme/remote-skills.git';
    const add = await app.inject({
      method: 'POST',
      url: '/api/settings/remote-skill-sources',
      payload: { repository, ref: 'main' },
    });
    expect(add.statusCode).toBe(201);
    const source = add.json<{ source: { id: string; repository: string; ref?: string } }>().source;
    expect(source).toMatchObject({ repository, ref: 'main' });

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/settings/remote-skill-sources',
      payload: { repository, ref: 'main' },
    });
    expect(duplicate.statusCode).toBe(409);

    const revision = 'd'.repeat(40);
    const skillHash = 'e'.repeat(40);
    const assetHash = 'f'.repeat(40);
    const agentHash = 'a'.repeat(40);
    const contents = new Map([
      [skillHash, '---\nname: remote-demo\ndescription: Pinned remote skill.\n---\nRemote instructions.\n'],
      [assetHash, 'Fixture asset.\n'],
      [agentHash, '---\nname: remote-reviewer\ndescription: Reviews changes.\n---\nReview carefully.\n'],
    ]);
    const gitRunner: RemoteSourceGitRunner = async (args) => {
      if (args[0] === 'clone') return { stdout: '' };
      if (args.includes('rev-parse')) return { stdout: `${revision}\n` };
      if (args.includes('ls-tree')) {
        return {
          stdout:
            `100644 blob ${skillHash}\tcollection/remote-demo/SKILL.md\0` +
            `100644 blob ${assetHash}\tcollection/remote-demo/references/asset.txt\0` +
            `100644 blob ${agentHash}\t.github/agents/remote-reviewer.agent.md\0`,
        };
      }
      if (args.includes('cat-file')) {
        const content = contents.get(args.at(-1) ?? '');
        if (content === undefined) throw new Error('Unexpected blob.');
        return { stdout: content };
      }
      throw new Error('Unexpected Git operation.');
    };
    const snapshot = await refreshRemoteSkillSource(configStore, source.id, {
      gitRunner,
      temporaryDirectory: root,
    });
    expect(snapshot.revision).toBe(revision);
    const page = await app.inject({
      method: 'GET',
      url: `/api/settings/remote-skill-sources/${source.id}/snapshots/${revision}/entries?kind=skill&limit=1&search=REMOTE`,
    });
    expect(page.statusCode).toBe(200);
    expect(page.json()).toMatchObject({
      sourceId: source.id,
      revision,
      total: 1,
      nextOffset: null,
      items: [{ name: 'remote-demo', repositoryPath: 'collection/remote-demo' }],
    });
    const badPage = await app.inject({
      method: 'GET',
      url: `/api/settings/remote-skill-sources/${source.id}/snapshots/${revision}/entries?kind=skill&limit=101`,
    });
    expect(badPage.statusCode).toBe(422);
    const agentPage = await app.inject({
      method: 'GET',
      url: `/api/settings/remote-skill-sources/${source.id}/snapshots/${revision}/entries?kind=agent`,
    });
    expect(agentPage.json()).toMatchObject({
      total: 1,
      items: [{ name: 'remote-reviewer' }],
    });

    for (const harness of ['opencode', 'copilot']) {
      const catalog = await getCatalog(app, registered.id, harness);
      expect(catalog.statusCode).toBe(200);
      const remote = catalogOf(catalog.body).groups
        .flatMap((group) => group.entries)
        .find((entry) => entry.name === 'remote-demo');
      expect(remote).toMatchObject({
        source: 'remote',
        repository,
        revision,
        repositoryPath: 'collection/remote-demo',
      });

      const copied = await app.inject({
        method: 'POST',
        url: `/api/projects/${encodeURIComponent(registered.id)}/catalog/skills/${encodeURIComponent(remote!.id)}/copy?harness=${harness}`,
      });
      expect(copied.statusCode).toBe(201);
      expect(copied.json<{ destinationPath: string }>().destinationPath).toContain(
        join('.agents', 'skills', 'remote-demo'),
      );
    }

    const copilotCatalog = catalogOf((await getCatalog(app, registered.id, 'copilot')).body);
    const remoteAgent = copilotCatalog.agents.find((agent) => agent.name === 'remote-reviewer');
    expect(remoteAgent).toMatchObject({
      harness: 'copilot',
      status: 'available',
      repositoryPath: '.github/agents/remote-reviewer.agent.md',
      revision,
    });
    const installedAgent = await app.inject({
      method: 'POST',
      url: `/api/projects/${encodeURIComponent(registered.id)}/catalog/agents/${encodeURIComponent(remoteAgent!.id)}/copy?harness=copilot`,
    });
    expect(installedAgent.statusCode).toBe(201);
    expect(installedAgent.json<{ destinationPath: string }>().destinationPath).toBe(
      join(project, '.github', 'agents', 'remote-reviewer.agent.md'),
    );
    expect(await readFile(join(project, '.github', 'agents', 'remote-reviewer.agent.md'), 'utf8'))
      .toContain('Review carefully.');

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/settings/remote-skill-sources/${encodeURIComponent(source.id)}`,
    });
    expect(remove.statusCode).toBe(200);
    expect(remove.json<{ remoteSkillSources: unknown[] }>().remoteSkillSources).toEqual([]);
    expect(await listRemoteSkillSnapshots(configDirectory, source.id)).toHaveLength(0);
    await expect(readdir(join(configDirectory, 'catalog-sources'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects credential-bearing remotes and never returns their values', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/settings/remote-skill-sources',
      payload: { repository: 'https://user:secret@example.com/private.git' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.body).not.toContain('secret');
  });
});
