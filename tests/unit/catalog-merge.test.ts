import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CATALOG_PERF_BUDGET_MS,
  EXTRA_DIRECTORY_ERROR_CODES,
  ExtraDirectoryError,
  addExtraSkillDirectory,
  createCatalogService,
  createDefaultCatalogAdapters,
  listExtraSkillDirectories,
  removeExtraSkillDirectory,
  type CatalogAdapter,
  type CatalogDiscoveryRequest,
} from '../../src/server/catalog/merge.js';
import {
  CATALOG_WARNING_CODES,
  createSkillId,
  type CatalogWarning,
  type SkillDiscoveryResult,
  type SkillEntry,
  type SkillHarness,
  type SkillSource,
} from '../../src/server/catalog/types.js';
import { createConfigStore, type ConfigStore } from '../../src/server/config/store.js';
import { FolderPathError } from '../../src/server/projects/paths.js';

let root: string;
let project: string;
let configDirectory: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loom-catalog-merge-'));
  project = join(root, 'project');
  configDirectory = join(root, 'config');
  await mkdir(project, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function createStore(): ConfigStore {
  return createConfigStore({
    env: { LOOM_CONFIG_DIR: configDirectory },
    homeDirectory: () => join(root, 'home'),
  });
}

function entry(
  harness: SkillHarness,
  source: SkillSource,
  name: string,
  description = '',
  pathKey = name,
): SkillEntry {
  const path = join(root, 'skills', source, pathKey, 'SKILL.md');
  return {
    id: 'adapter-supplied-id',
    harness,
    source,
    name,
    description,
    path,
    packagePath: dirname(path),
    enabled: true,
  };
}

interface TestAdapter extends CatalogAdapter {
  calls: CatalogDiscoveryRequest[];
}

function adapter(
  harness: SkillHarness,
  entries: SkillEntry[],
  usesExtraDirectories = false,
  warnings: CatalogWarning[] = [],
): TestAdapter {
  const calls: CatalogDiscoveryRequest[] = [];
  return {
    harness,
    usesExtraDirectories,
    calls,
    async discover(request): Promise<SkillDiscoveryResult> {
      calls.push({
        projectPath: request.projectPath,
        extraDirectories: [...request.extraDirectories],
      });
      return { entries: entries.map((item) => ({ ...item })), warnings: [...warnings] };
    },
  };
}

function allEntries(catalog: Awaited<ReturnType<ReturnType<typeof createCatalogService>['getCatalog']>>): SkillEntry[] {
  return catalog.groups.flatMap((group) => group.entries);
}

async function captureError(action: () => Promise<unknown>): Promise<Error> {
  try {
    await action();
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected the operation to fail.');
}

describe('catalog merge', () => {
  it('keeps duplicate names as separate entries with distinct stable ids', async () => {
    const first = entry('opencode', 'project', 'deploy', 'Project deployment', 'project-deploy');
    const second = entry('opencode', 'loom-extra', 'deploy', 'Extra deployment', 'extra-deploy');
    const opencode = adapter('opencode', [first, second], true);
    const service = createCatalogService({ configStore: createStore(), adapters: [opencode] });

    const catalog = await service.getCatalog({ projectPath: project, harness: 'opencode' });
    const merged = allEntries(catalog);

    expect(catalog.total).toBe(2);
    expect(merged.map((item) => item.name)).toEqual(['deploy', 'deploy']);
    expect(catalog.groups.map((group) => group.source)).toEqual(['project', 'loom-extra']);
    expect(catalog.groups.map((group) => group.count)).toEqual([1, 1]);

    expect(merged[0]?.id).toBe(
      createSkillId({
        harness: 'opencode',
        source: 'project',
        path: first.path,
        name: 'deploy',
      }),
    );
    expect(merged[1]?.id).toBe(
      createSkillId({
        harness: 'opencode',
        source: 'loom-extra',
        path: second.path,
        name: 'deploy',
      }),
    );
    expect(merged[0]?.id).not.toBe(merged[1]?.id);
  });

  it('groups entries by source in badge order and counts every entry', async () => {
    const opencode = adapter('opencode', [
      entry('opencode', 'builtin', 'builtin-skill'),
      entry('opencode', 'personal', 'personal-skill'),
      entry('opencode', 'project', 'project-skill-a', '', 'a'),
      entry('opencode', 'project', 'project-skill-b', '', 'b'),
      entry('opencode', 'custom', 'custom-skill'),
    ]);
    const service = createCatalogService({ configStore: createStore(), adapters: [opencode] });

    const catalog = await service.getCatalog({ projectPath: project, harness: 'opencode' });

    expect(catalog.groups.map((group) => group.source)).toEqual([
      'project',
      'personal',
      'custom',
      'builtin',
    ]);
    expect(catalog.groups.map((group) => group.count)).toEqual([2, 1, 1, 1]);
    expect(catalog.total).toBe(5);
    expect(catalog.counts).toEqual({
      total: 5,
      bySource: {
        project: 2,
        personal: 1,
        custom: 1,
        plugin: 0,
        builtin: 1,
        'loom-extra': 0,
        remote: 0,
      },
    });
  });

  it('applies a case-insensitive substring search to name and description', async () => {
    const opencode = adapter('opencode', [
      entry('opencode', 'project', 'Deploy', 'Ships the release'),
      entry('opencode', 'personal', 'release-notes', 'Writes the changelog'),
      entry('opencode', 'custom', 'Other', 'Deploys the RELEASE pipeline'),
    ]);
    const service = createCatalogService({ configStore: createStore(), adapters: [opencode] });

    const byName = await service.getCatalog({
      projectPath: project,
      harness: 'opencode',
      query: 'DEPLOY',
    });
    expect(byName.query).toBe('DEPLOY');
    expect(allEntries(byName).map((item) => item.name).sort()).toEqual(['Deploy', 'Other']);
    expect(byName.total).toBe(2);
    expect(byName.counts.bySource.project).toBe(1);
    expect(byName.counts.bySource.custom).toBe(1);

    const byDescription = await service.getCatalog({
      projectPath: project,
      harness: 'opencode',
      query: 'release PIPELINE',
    });
    expect(allEntries(byDescription).map((item) => item.name)).toEqual(['Other']);
    expect(byDescription.total).toBe(1);

    const empty = await service.getCatalog({
      projectPath: project,
      harness: 'opencode',
      query: '   ',
    });
    expect(empty.query).toBe('');
    expect(empty.total).toBe(3);
  });

  it('selects only the requested harness and supplies extras only where supported', async () => {
    const extraDirectory = join(root, 'extra-skills');
    await mkdir(extraDirectory, { recursive: true });
    const store = createStore();
    await store.update({ extraSkillDirectories: [extraDirectory] });

    const opencode = adapter('opencode', [entry('opencode', 'project', 'opencode-skill')], true);
    const copilot = adapter('copilot', [entry('copilot', 'personal', 'copilot-skill')], false);
    const service = createCatalogService({
      configStore: store,
      adapters: [opencode, copilot],
    });

    expect(service.defaultHarness).toBe('opencode');

    const copilotCatalog = await service.getCatalog({
      projectPath: project,
      harness: 'copilot',
    });
    expect(copilotCatalog.harness).toBe('copilot');
    expect(allEntries(copilotCatalog).every((item) => item.harness === 'copilot')).toBe(true);
    expect(allEntries(copilotCatalog).map((item) => item.name)).toEqual(['copilot-skill']);
    expect(copilot.calls[0]?.extraDirectories).toEqual([]);
    expect(opencode.calls).toHaveLength(0);

    const opencodeCatalog = await service.getCatalog({
      projectPath: project,
      harness: 'opencode',
    });
    expect(allEntries(opencodeCatalog).every((item) => item.harness === 'opencode')).toBe(true);
    expect(opencode.calls[0]?.extraDirectories).toEqual([extraDirectory]);
  });

  it('re-runs discovery on every request instead of caching across projects', async () => {
    const opencode = adapter('opencode', [entry('opencode', 'project', 'deploy')]);
    const service = createCatalogService({ configStore: createStore(), adapters: [opencode] });

    await service.getCatalog({ projectPath: project, harness: 'opencode' });
    await service.getCatalog({ projectPath: join(root, 'other-project'), harness: 'opencode' });

    expect(opencode.calls).toHaveLength(2);
    expect(opencode.calls.map((call) => call.projectPath)).toEqual([
      project,
      join(root, 'other-project'),
    ]);
  });

  it('reports a slow discovery as a warning without hiding entries', async () => {
    const opencode = adapter('opencode', [entry('opencode', 'project', 'deploy')]);
    const times = [1_000, 4_001];
    const service = createCatalogService({
      configStore: createStore(),
      adapters: [opencode],
      now: () => times.shift() ?? 4_001,
      slowThresholdMs: CATALOG_PERF_BUDGET_MS,
    });

    const catalog = await service.getCatalog({ projectPath: project, harness: 'opencode' });

    expect(catalog.elapsedMs).toBe(3_001);
    expect(catalog.total).toBe(1);
    expect(catalog.warnings).toContainEqual(
      expect.objectContaining({
        code: CATALOG_WARNING_CODES.DISCOVERY_SLOW,
        harness: 'opencode',
        reason: 'PERF_BUDGET',
      }),
    );
  });

  it('preserves adapter warnings alongside valid entries', async () => {
    const warning: CatalogWarning = {
      code: CATALOG_WARNING_CODES.FRONTMATTER_INVALID,
      message: 'A SKILL.md frontmatter block is malformed.',
      harness: 'opencode',
      source: 'project',
      path: join(project, '.opencode', 'skills', 'broken', 'SKILL.md'),
      reason: 'FRONTMATTER_INVALID',
    };
    const opencode = adapter(
      'opencode',
      [entry('opencode', 'project', 'valid-skill')],
      true,
      [warning],
    );
    const service = createCatalogService({ configStore: createStore(), adapters: [opencode] });

    const catalog = await service.getCatalog({ projectPath: project, harness: 'opencode' });

    expect(catalog.total).toBe(1);
    expect(catalog.warnings).toEqual([warning]);
  });

  it('registers the v1 adapters without route-specific harness knowledge', () => {
    const adapters = createDefaultCatalogAdapters();

    expect(adapters.map((item) => item.harness)).toEqual(['opencode', 'copilot']);
    expect(adapters.map((item) => item.usesExtraDirectories)).toEqual([true, false]);
  });
});

describe('extra skill directory settings', () => {
  it('adds, lists, persists, and removes a canonical extra directory', async () => {
    const first = join(root, 'first-skills');
    const second = join(root, 'second-skills');
    await mkdir(first, { recursive: true });
    await mkdir(second, { recursive: true });
    const store = createStore();

    expect(await listExtraSkillDirectories(store)).toEqual([]);

    const added = await addExtraSkillDirectory(store, first);
    expect(added.directory).toBe(await realpath(first));
    expect(added.extraSkillDirectories).toEqual([await realpath(first)]);
    expect(await listExtraSkillDirectories(store)).toEqual([await realpath(first)]);

    const secondAdded = await addExtraSkillDirectory(store, second);
    expect(secondAdded.extraSkillDirectories).toEqual([
      await realpath(first),
      await realpath(second),
    ]);

    const reopened = await listExtraSkillDirectories(createStore());
    expect(reopened).toEqual([await realpath(first), await realpath(second)]);

    const removed = await removeExtraSkillDirectory(store, first);
    expect(removed.directory).toBe(await realpath(first));
    expect(removed.extraSkillDirectories).toEqual([await realpath(second)]);
    expect(await listExtraSkillDirectories(store)).toEqual([await realpath(second)]);
  });

  it('rejects duplicate directories, including symlink aliases', async () => {
    const target = join(root, 'shared-skills');
    const alias = join(root, 'alias-skills');
    await mkdir(target, { recursive: true });
    await symlink(target, alias);
    const store = createStore();

    await addExtraSkillDirectory(store, target);

    const duplicate = await captureError(() => addExtraSkillDirectory(store, target));
    expect(duplicate).toBeInstanceOf(ExtraDirectoryError);
    expect((duplicate as ExtraDirectoryError).code).toBe(
      EXTRA_DIRECTORY_ERROR_CODES.DUPLICATE,
    );

    const aliasDuplicate = await captureError(() => addExtraSkillDirectory(store, alias));
    expect(aliasDuplicate).toBeInstanceOf(ExtraDirectoryError);
    expect((aliasDuplicate as ExtraDirectoryError).code).toBe(
      EXTRA_DIRECTORY_ERROR_CODES.DUPLICATE,
    );
    expect(await listExtraSkillDirectories(store)).toEqual([await realpath(target)]);
  });

  it('validates relative paths, files, and unknown removals', async () => {
    const file = join(root, 'not-a-directory.txt');
    await writeFile(file, 'not a skill directory\n', 'utf8');
    const store = createStore();

    const relative = await captureError(() => addExtraSkillDirectory(store, 'relative/skills'));
    expect(relative).toBeInstanceOf(FolderPathError);
    expect((relative as FolderPathError).code).toBe('PATH_NOT_ABSOLUTE');

    const notDirectory = await captureError(() => addExtraSkillDirectory(store, file));
    expect(notDirectory).toBeInstanceOf(FolderPathError);
    expect((notDirectory as FolderPathError).code).toBe('PATH_NOT_DIRECTORY');

    const missing = await captureError(() => addExtraSkillDirectory(store, join(root, 'missing')));
    expect(missing).toBeInstanceOf(FolderPathError);
    expect((missing as FolderPathError).code).toBe('PATH_NOT_FOUND');

    const unknownRemoval = await captureError(() =>
      removeExtraSkillDirectory(store, join(root, 'never-added')),
    );
    expect(unknownRemoval).toBeInstanceOf(ExtraDirectoryError);
    expect((unknownRemoval as ExtraDirectoryError).code).toBe(
      EXTRA_DIRECTORY_ERROR_CODES.NOT_FOUND,
    );

    const relativeRemoval = await captureError(() =>
      removeExtraSkillDirectory(store, 'relative/skills'),
    );
    expect(relativeRemoval).toBeInstanceOf(FolderPathError);
    expect((relativeRemoval as FolderPathError).code).toBe('PATH_NOT_ABSOLUTE');
  });

  it('still removes a configured directory after it is deleted', async () => {
    const directory = join(root, 'removable-skills');
    await mkdir(directory, { recursive: true });
    const store = createStore();
    await addExtraSkillDirectory(store, directory);
    await rm(directory, { recursive: true, force: true });

    const removed = await removeExtraSkillDirectory(store, directory);

    expect(removed.extraSkillDirectories).toEqual([]);
    expect(await listExtraSkillDirectories(store)).toEqual([]);
  });
});
