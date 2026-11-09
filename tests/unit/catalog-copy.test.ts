import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CATALOG_COPY_ERROR_CODES,
  CatalogCopyError,
  MAX_SKILL_PACKAGE_BYTES,
  copySkillIntoProject,
  projectSkillRootFor,
} from '../../src/server/catalog/copy.js';
import { REMOTE_SNAPSHOT_CONTENT, type SkillEntry } from '../../src/server/catalog/types.js';
import {
  scenarioCatalog,
  scenarioSkillPackagePath,
} from '../../src/server/chains/presets.js';

let root: string;
let projectPath: string;
let sourcePath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loom-catalog-copy-'));
  projectPath = join(root, 'project');
  sourcePath = join(root, 'personal-skills', 'release-notes');
  await mkdir(projectPath, { recursive: true });
  await mkdir(sourcePath, { recursive: true });
  await writeFile(
    join(sourcePath, 'SKILL.md'),
    '---\nname: release-notes\ndescription: Writes notes\n---\nBODY\n',
    'utf8',
  );
  await mkdir(join(sourcePath, 'templates'), { recursive: true });
  await writeFile(join(sourcePath, 'templates', 'note.md'), 'TEMPLATE\n', 'utf8');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function entry(overrides: Partial<SkillEntry> = {}): SkillEntry {
  return {
    id: 'opencode-personal-release-notes',
    harness: 'opencode',
    source: 'personal',
    name: 'release-notes',
    description: 'Writes notes',
    path: join(sourcePath, 'SKILL.md'),
    packagePath: sourcePath,
    enabled: true,
    ...overrides,
  };
}

async function expectCopyError(
  operation: Promise<unknown>,
  code: string,
): Promise<CatalogCopyError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(CatalogCopyError);
    const copyError = error as CatalogCopyError;
    expect(copyError.code).toBe(code);
    return copyError;
  }
  throw new Error('Expected a CatalogCopyError.');
}

describe('copySkillIntoProject', () => {
  it('binds a remote copy to the verified snapshot and removes altered copies', async () => {
    const skill = await readFile(join(sourcePath, 'SKILL.md'));
    const template = await readFile(join(sourcePath, 'templates', 'note.md'));
    const fingerprint = createHash('sha256')
      .update('SKILL.md\0-\0').update(skill)
      .update('templates/note.md\0-\0').update(template)
      .digest('hex');
    const remote = entry({
      source: 'remote',
      [REMOTE_SNAPSHOT_CONTENT]: { fingerprint, executablePaths: [] },
    });
    const copied = await copySkillIntoProject({ projectPath, harness: 'opencode', entry: remote });
    expect(await readFile(join(copied.destinationPath, 'SKILL.md'))).toEqual(skill);
    await writeFile(join(sourcePath, 'templates', 'note.md'), 'changed after discovery');
    await expectCopyError(
      copySkillIntoProject({ projectPath, harness: 'opencode', entry: remote }),
      CATALOG_COPY_ERROR_CODES.SOURCE_UNSAFE,
    );
    expect(await readdir(projectSkillRootFor('opencode', projectPath))).toEqual(['release-notes']);
  });

  it('rejects a remote copy without verified snapshot content', async () => {
    await expectCopyError(
      copySkillIntoProject({ projectPath, harness: 'opencode', entry: entry({ source: 'remote' }) }),
      CATALOG_COPY_ERROR_CODES.SOURCE_UNSAFE,
    );
    await expect(stat(join(projectPath, '.agents'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects remote snapshot mode metadata that references a missing file', async () => {
    const remote = entry({
      source: 'remote',
      [REMOTE_SNAPSHOT_CONTENT]: { fingerprint: '0'.repeat(64), executablePaths: ['missing.sh'] },
    });
    await expectCopyError(
      copySkillIntoProject({ projectPath, harness: 'opencode', entry: remote }),
      CATALOG_COPY_ERROR_CODES.SOURCE_UNSAFE,
    );
    if (process.platform !== 'win32') {
      expect(await readdir(projectSkillRootFor('opencode', projectPath))).toEqual([]);
    }
  });

  it.skipIf(process.platform === 'win32')('verifies remote executable bits against the snapshot', async () => {
    const script = join(sourcePath, 'scripts', 'check.sh');
    await mkdir(join(sourcePath, 'scripts'));
    await writeFile(script, 'echo checked\n');
    await chmod(script, 0o755);
    const fingerprint = createHash('sha256')
      .update('SKILL.md\0-\0').update(await readFile(join(sourcePath, 'SKILL.md')))
      .update('scripts/check.sh\0x\0').update(await readFile(script))
      .update('templates/note.md\0-\0').update(await readFile(join(sourcePath, 'templates', 'note.md')))
      .digest('hex');
    const remote = entry({
      source: 'remote',
      [REMOTE_SNAPSHOT_CONTENT]: { fingerprint, executablePaths: ['scripts/check.sh'] },
    });
    const copied = await copySkillIntoProject({ projectPath, harness: 'opencode', entry: remote });
    expect((await stat(join(copied.destinationPath, 'scripts', 'check.sh'))).mode & 0o111).not.toBe(0);
    await chmod(script, 0o644);
    await expectCopyError(
      copySkillIntoProject({ projectPath, harness: 'opencode', entry: remote }),
      CATALOG_COPY_ERROR_CODES.SOURCE_UNSAFE,
    );
    expect(await readdir(projectSkillRootFor('opencode', projectPath))).toEqual(['release-notes']);
  });

  it('copies the whole package into the shared project root for OpenCode', async () => {
    const result = await copySkillIntoProject({
      projectPath,
      harness: 'opencode',
      entry: entry(),
    });

    expect(result.destinationPath).toBe(
      join(projectPath, '.agents', 'skills', 'release-notes'),
    );
    expect(await readFile(join(result.destinationPath, 'SKILL.md'), 'utf8')).toContain(
      'BODY',
    );
    expect(
      await readFile(join(result.destinationPath, 'templates', 'note.md'), 'utf8'),
    ).toBe('TEMPLATE\n');
  });

  it('uses the shared project skill root for Copilot and suffixes an existing name', async () => {
    const first = await copySkillIntoProject({
      projectPath,
      harness: 'copilot',
      entry: entry({ harness: 'copilot' }),
    });
    const second = await copySkillIntoProject({
      projectPath,
      harness: 'copilot',
      entry: entry({ harness: 'copilot' }),
    });

    expect(projectSkillRootFor('copilot', projectPath)).toBe(
      join(projectPath, '.agents', 'skills'),
    );
    expect(first.destinationPath).toBe(
      join(projectPath, '.agents', 'skills', 'release-notes'),
    );
    expect(second.destinationPath).toBe(
      join(projectPath, '.agents', 'skills', 'release-notes-2'),
    );
  });

  it('can reject a duplicate package name without creating a suffixed copy', async () => {
    await copySkillIntoProject({
      projectPath,
      harness: 'opencode',
      entry: entry(),
      allowNameSuffix: false,
    });

    await expectCopyError(
      copySkillIntoProject({
        projectPath,
        harness: 'opencode',
        entry: entry(),
        allowNameSuffix: false,
      }),
      CATALOG_COPY_ERROR_CODES.SOURCE_ALREADY_PROJECT,
    );
  });

  it('refuses symlink package roots and symlinked destination roots', async () => {
    const sourceLink = join(root, 'linked-skill');
    await symlink(sourcePath, sourceLink);
    await expectCopyError(
      copySkillIntoProject({
        projectPath,
        harness: 'opencode',
        entry: entry({ packagePath: sourceLink, path: join(sourceLink, 'SKILL.md') }),
      }),
      CATALOG_COPY_ERROR_CODES.SYMLINK_UNSUPPORTED,
    );

    const outside = join(root, 'outside');
    await mkdir(outside, { recursive: true });
    await symlink(outside, join(projectPath, '.agents'));
    await expectCopyError(
      copySkillIntoProject({
        projectPath,
        harness: 'opencode',
        entry: entry(),
      }),
      CATALOG_COPY_ERROR_CODES.DESTINATION_UNAVAILABLE,
    );
    expect(await stat(outside).then((info) => info.isDirectory())).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('preserves executable package-file permissions', async () => {
    const script = join(sourcePath, 'scripts', 'check.sh');
    await mkdir(join(sourcePath, 'scripts'), { recursive: true });
    await writeFile(script, '#!/bin/sh\nexit 0\n', 'utf8');
    await chmod(script, 0o755);

    const result = await copySkillIntoProject({
      projectPath,
      harness: 'opencode',
      entry: entry(),
    });

    expect((await stat(join(result.destinationPath, 'scripts', 'check.sh'))).mode & 0o111)
      .toBe(0o111);
  });

  it('copies every bundled scenario package within the safe-copy contract', async () => {
    const bundleProjectPath = join(root, 'bundled-project');
    await mkdir(bundleProjectPath, { recursive: true });

    for (const [index, source] of scenarioCatalog.skills.entries()) {
      const packagePath = scenarioSkillPackagePath(source.name);
      if (packagePath === undefined) {
        throw new Error(`Missing bundled package path for ${source.name}.`);
      }
      const packageEntry: SkillEntry = {
        id: `bundled-${String(index)}`,
        harness: 'opencode',
        source: 'builtin',
        name: source.name,
        description: '',
        path: join(packagePath, 'SKILL.md'),
        packagePath,
        enabled: true,
      };
      const result = await copySkillIntoProject({
        projectPath: bundleProjectPath,
        harness: 'opencode',
        entry: packageEntry,
        allowNameSuffix: false,
      });

      expect(result.destinationPath).toBe(
        join(bundleProjectPath, '.agents', 'skills', source.name),
      );
      expect(await readFile(join(result.destinationPath, 'SKILL.md'), 'utf8')).toContain(
        'name:',
      );
    }
  });

  it('rejects a skill that is already a project entry', async () => {
    await expectCopyError(
      copySkillIntoProject({
        projectPath,
        harness: 'opencode',
        entry: entry({ source: 'project' }),
      }),
      CATALOG_COPY_ERROR_CODES.SOURCE_ALREADY_PROJECT,
    );
  });

  it('rejects a package containing a symbolic link', async () => {
    await symlink('/etc/hosts', join(sourcePath, 'outside-link'));

    const error = await expectCopyError(
      copySkillIntoProject({
        projectPath,
        harness: 'opencode',
        entry: entry(),
      }),
      CATALOG_COPY_ERROR_CODES.SYMLINK_UNSUPPORTED,
    );
    expect(error.details.path).toContain('outside-link');
    expect(await readdir(join(projectPath, '.agents', 'skills'))).toEqual([]);
  });

  it('accepts the byte limit and rejects an oversized package without leaving a partial copy', async () => {
    const skillBytes = (await stat(join(sourcePath, 'SKILL.md'))).size;
    const templateBytes = (await stat(join(sourcePath, 'templates', 'note.md'))).size;
    const payload = join(sourcePath, 'payload.bin');
    await writeFile(payload, Buffer.alloc(MAX_SKILL_PACKAGE_BYTES - skillBytes - templateBytes));
    const first = await copySkillIntoProject({ projectPath, harness: 'opencode', entry: entry() });
    expect((await stat(join(first.destinationPath, 'payload.bin'))).size)
      .toBe(MAX_SKILL_PACKAGE_BYTES - skillBytes - templateBytes);
    await writeFile(payload, Buffer.alloc(MAX_SKILL_PACKAGE_BYTES - skillBytes - templateBytes + 1));
    await expectCopyError(
      copySkillIntoProject({ projectPath, harness: 'opencode', entry: entry() }),
      CATALOG_COPY_ERROR_CODES.TOO_LARGE,
    );
    expect(await readdir(projectSkillRootFor('opencode', projectPath))).toEqual(['release-notes']);
  });

  it('rejects packages whose empty directories exceed the depth limit', async () => {
    let path = sourcePath;
    for (let depth = 0; depth < 33; depth += 1) {
      path = join(path, 'nested');
      await mkdir(path);
    }
    await expectCopyError(
      copySkillIntoProject({ projectPath, harness: 'opencode', entry: entry() }),
      CATALOG_COPY_ERROR_CODES.TOO_LARGE,
    );
    expect(await readdir(projectSkillRootFor('opencode', projectPath))).toEqual([]);
  });
});
