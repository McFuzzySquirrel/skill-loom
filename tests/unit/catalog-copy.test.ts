import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CATALOG_COPY_ERROR_CODES,
  CatalogCopyError,
  copySkillIntoProject,
  projectSkillRootFor,
} from '../../src/server/catalog/copy.js';
import type { SkillEntry } from '../../src/server/catalog/types.js';

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
  it('copies the whole package into the OpenCode project root', async () => {
    const result = await copySkillIntoProject({
      projectPath,
      harness: 'opencode',
      entry: entry(),
    });

    expect(result.destinationPath).toBe(
      join(projectPath, '.opencode', 'skills', 'release-notes'),
    );
    expect(await readFile(join(result.destinationPath, 'SKILL.md'), 'utf8')).toContain(
      'BODY',
    );
    expect(
      await readFile(join(result.destinationPath, 'templates', 'note.md'), 'utf8'),
    ).toBe('TEMPLATE\n');
  });

  it('uses the Copilot project skill root and suffixes an existing name', async () => {
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
      join(projectPath, '.github', 'skills'),
    );
    expect(first.destinationPath).toBe(
      join(projectPath, '.github', 'skills', 'release-notes'),
    );
    expect(second.destinationPath).toBe(
      join(projectPath, '.github', 'skills', 'release-notes-2'),
    );
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
  });
});
