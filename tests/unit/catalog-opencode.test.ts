import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FRONTMATTER_ERROR_CODES,
  FrontmatterError,
  frontmatterString,
  parseSkillFrontmatter,
} from '../../src/server/catalog/frontmatter.js';
import {
  DEFAULT_MAX_SKILL_DEPTH,
  scanOpenCodeSkills,
} from '../../src/server/catalog/opencode.js';
import {
  CATALOG_ERROR_CODES,
  CATALOG_WARNING_CODES,
  CatalogError,
  type SkillEntry,
} from '../../src/server/catalog/types.js';

let root: string;
let project: string;
let home: string;
let extra: string;
let restoreModePaths: string[];

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'loom-catalog-opencode-')));
  project = join(root, 'project');
  home = join(root, 'home');
  extra = join(root, 'extra');
  restoreModePaths = [];
  await mkdir(project, { recursive: true });
  await mkdir(home, { recursive: true });
  await mkdir(extra, { recursive: true });
});

afterEach(async () => {
  for (const path of restoreModePaths.splice(0)) {
    await chmod(path, 0o755).catch(() => undefined);
  }
  await rm(root, { recursive: true, force: true });
});

const projectSkills = (): string => join(project, '.opencode', 'skills');
const personalSkills = (): string => join(home, '.config', 'opencode', 'skills');
const unprivilegedIt = process.platform === 'win32' || process.getuid?.() === 0 ? it.skip : it;

/**
 * Write a package with either a YAML frontmatter block or a raw body. The
 * helper intentionally leaves the body untouched so tests can prove the
 * scanner never executes it.
 */
async function writeSkill(
  base: string,
  relativeDirectory: string,
  frontmatter: string | null,
  body = 'Follow the instructions in this skill.\n',
): Promise<string> {
  const directory = join(base, relativeDirectory);
  await mkdir(directory, { recursive: true });
  const content = frontmatter === null ? body : `---\n${frontmatter}\n---\n${body}`;
  const file = join(directory, 'SKILL.md');
  await writeFile(file, content, 'utf8');
  return file;
}

function namesBySource(entries: SkillEntry[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const entry of entries) {
    (grouped[entry.source] ??= []).push(entry.name);
  }
  return grouped;
}

describe('OpenCode skill discovery', () => {
  it('scans project, personal, and Loom extra directories', async () => {
    const projectFile = await writeSkill(
      projectSkills(),
      'alpha',
      'name: alpha-skill\ndescription: Project alpha instructions',
    );
    const personalFile = await writeSkill(
      personalSkills(),
      'beta',
      'name: beta-skill\ndescription: Personal beta instructions',
    );
    const extraFile = await writeSkill(
      extra,
      'gamma',
      'name: gamma-skill\ndescription: Extra gamma instructions',
    );

    const result = await scanOpenCodeSkills({
      projectPath: project,
      homeDirectory: home,
      extraDirectories: [extra],
    });

    expect(result.warnings).toEqual([]);
    expect(result.entries).toHaveLength(3);
    expect(namesBySource(result.entries)).toEqual({
      project: ['alpha-skill'],
      personal: ['beta-skill'],
      'loom-extra': ['gamma-skill'],
    });

    const byName = new Map(result.entries.map((entry) => [entry.name, entry]));
    expect(byName.get('alpha-skill')).toMatchObject({
      harness: 'opencode',
      source: 'project',
      description: 'Project alpha instructions',
      enabled: true,
      path: await realpath(projectFile),
    });
    expect(byName.get('beta-skill')).toMatchObject({
      source: 'personal',
      path: await realpath(personalFile),
    });
    expect(byName.get('gamma-skill')).toMatchObject({
      source: 'loom-extra',
      path: await realpath(extraFile),
      sourceDirectory: await realpath(extra),
    });

    for (const entry of result.entries) {
      expect(entry.id).toMatch(/^opencode-[a-z-]+-[0-9a-f]{16}$/);
      expect(isAbsolute(entry.path)).toBe(true);
      expect(entry.packagePath).toBe(dirname(entry.path));
    }
  });

  it('scans shared and legacy project roots without hiding same-name packages', async () => {
    const sharedFile = await writeSkill(
      join(project, '.agents', 'skills'),
      'market-sizing-analysis',
      'name: market-sizing-analysis\ndescription: Shared package',
    );
    const legacyFile = await writeSkill(
      projectSkills(),
      'market-sizing-analysis',
      'name: market-sizing-analysis\ndescription: Legacy OpenCode package',
    );

    const result = await scanOpenCodeSkills({ projectPath: project, homeDirectory: home });

    expect(result.entries.filter((entry) => entry.name === 'market-sizing-analysis')).toEqual([
      expect.objectContaining({ source: 'project', description: 'Shared package', path: await realpath(sharedFile) }),
      expect.objectContaining({ source: 'project', description: 'Legacy OpenCode package', path: await realpath(legacyFile) }),
    ]);
  });

  it('discovers global shared .agents skills from the host home directory', async () => {
    const globalFile = await writeSkill(
      join(home, '.agents', 'skills'),
      'personal-agent-skill',
      'name: personal-agent-skill\ndescription: Shared global skill',
    );

    const result = await scanOpenCodeSkills({ projectPath: project, homeDirectory: home });

    expect(result.warnings).toEqual([]);
    expect(result.entries).toEqual([
      expect.objectContaining({
        name: 'personal-agent-skill',
        source: 'personal',
        path: await realpath(globalFile),
        packagePath: await realpath(dirname(globalFile)),
      }),
    ]);
  });

  it('discovers nested SKILL.md packages and records canonical paths', async () => {
    const nestedFile = await writeSkill(
      projectSkills(),
      join('group', 'deep', 'nested-skill'),
      'name: nested-skill\ndescription: Found below two directory levels',
    );
    await writeSkill(
      projectSkills(),
      'top-level',
      'name: top-level\ndescription: Found at the root of the skills directory',
    );

    const result = await scanOpenCodeSkills({ projectPath: project, homeDirectory: home });

    expect(result.warnings).toEqual([]);
    expect(result.entries.map((entry) => entry.name).sort()).toEqual([
      'nested-skill',
      'top-level',
    ]);
    const nested = result.entries.find((entry) => entry.name === 'nested-skill');
    expect(nested?.path).toBe(await realpath(nestedFile));
    expect(nested?.packagePath).toBe(await realpath(dirname(nestedFile)));
  });

  it('returns an empty catalog without warnings when native roots are absent', async () => {
    const result = await scanOpenCodeSkills({ projectPath: project, homeDirectory: home });

    expect(result.entries).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('falls back to the directory name when frontmatter is missing', async () => {
    const file = await writeSkill(
      projectSkills(),
      'no-frontmatter',
      null,
      'This package has instructions but no YAML metadata.\n',
    );

    const result = await scanOpenCodeSkills({ projectPath: project, homeDirectory: home });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      name: 'no-frontmatter',
      description: '',
      source: 'project',
      path: await realpath(file),
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: CATALOG_WARNING_CODES.FRONTMATTER_MISSING,
      source: 'project',
      path: await realpath(file),
      harness: 'opencode',
    });
  });

  it('falls back to the directory name when the frontmatter name is blank', async () => {
    await writeSkill(projectSkills(), 'blank-name', 'name: "   "\ndescription: usable');

    const result = await scanOpenCodeSkills({ projectPath: project, homeDirectory: home });

    expect(result.entries[0]).toMatchObject({
      name: 'blank-name',
      description: 'usable',
    });
    expect(result.warnings[0]?.code).toBe(CATALOG_WARNING_CODES.NAME_MISSING);
  });

  it('turns malformed frontmatter into a warning without dropping the package', async () => {
    await writeSkill(projectSkills(), 'broken-yaml', 'name: [unclosed\ndescription: nope');
    await writeSkill(
      projectSkills(),
      'valid',
      'name: valid-skill\ndescription: still discovered',
    );

    const result = await scanOpenCodeSkills({ projectPath: project, homeDirectory: home });

    expect(result.entries.map((entry) => entry.name).sort()).toEqual([
      'broken-yaml',
      'valid-skill',
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: CATALOG_WARNING_CODES.FRONTMATTER_INVALID,
      source: 'project',
      reason: FRONTMATTER_ERROR_CODES.INVALID_YAML,
    });
  });

  it('returns duplicate names separately with distinct source and path', async () => {
    const projectFile = await writeSkill(
      projectSkills(),
      'one',
      'name: shared-name\ndescription: Project copy',
    );
    const personalFile = await writeSkill(
      personalSkills(),
      'two',
      'name: shared-name\ndescription: Personal copy',
    );

    const result = await scanOpenCodeSkills({ projectPath: project, homeDirectory: home });

    const shared = result.entries.filter((entry) => entry.name === 'shared-name');
    expect(shared).toHaveLength(2);
    expect(new Set(shared.map((entry) => entry.source))).toEqual(
      new Set(['project', 'personal']),
    );
    expect(new Set(shared.map((entry) => entry.path))).toEqual(
      new Set([await realpath(projectFile), await realpath(personalFile)]),
    );
    expect(new Set(shared.map((entry) => entry.id)).size).toBe(2);
    expect(
      shared.map((entry) => entry.description).sort(),
    ).toEqual(['Personal copy', 'Project copy']);
  });

  it('warns about missing or relative extra directories but keeps valid entries', async () => {
    await writeSkill(extra, 'present', 'name: present\ndescription: extra skill');
    const missing = join(root, 'does-not-exist');

    const result = await scanOpenCodeSkills({
      projectPath: project,
      homeDirectory: home,
      extraDirectories: [missing, 'relative/extra', extra],
    });

    expect(result.entries.map((entry) => entry.name)).toEqual(['present']);
    expect(result.warnings.map((warning) => warning.code).sort()).toEqual([
      CATALOG_WARNING_CODES.DIRECTORY_NOT_FOUND,
      CATALOG_WARNING_CODES.DIRECTORY_PATH_INVALID,
    ]);
    expect(result.warnings.every((warning) => warning.source === 'loom-extra')).toBe(true);
  });

  it('does not follow nested directory symlinks into a loop', async () => {
    await writeSkill(projectSkills(), 'real', 'name: real-skill\ndescription: real');
    await symlink(projectSkills(), join(projectSkills(), 'loop'), 'dir');

    const result = await scanOpenCodeSkills({ projectPath: project, homeDirectory: home });

    expect(result.entries.map((entry) => entry.name)).toEqual(['real-skill']);
    expect(result.warnings).toEqual([]);
  });

  unprivilegedIt('warns about an unreadable directory and continues scanning', async () => {
    await writeSkill(projectSkills(), 'good', 'name: good-skill\ndescription: readable');
    const lockedDirectory = join(projectSkills(), 'locked');
    await writeSkill(projectSkills(), 'locked', 'name: locked-skill\ndescription: hidden');
    await chmod(lockedDirectory, 0o000);
    restoreModePaths.push(lockedDirectory);

    const result = await scanOpenCodeSkills({ projectPath: project, homeDirectory: home });

    expect(result.entries.map((entry) => entry.name)).toEqual(['good-skill']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: CATALOG_WARNING_CODES.DIRECTORY_UNREADABLE,
      source: 'project',
      path: lockedDirectory,
      reason: 'EACCES',
    });
  });

  unprivilegedIt('warns about an unreadable SKILL.md and continues scanning', async () => {
    const lockedFile = await writeSkill(
      projectSkills(),
      'locked-file',
      'name: locked-file\ndescription: cannot read',
    );
    await writeSkill(projectSkills(), 'good', 'name: good-skill\ndescription: readable');
    await chmod(lockedFile, 0o000);
    restoreModePaths.push(lockedFile);

    const result = await scanOpenCodeSkills({ projectPath: project, homeDirectory: home });

    expect(result.entries.map((entry) => entry.name)).toEqual(['good-skill']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: CATALOG_WARNING_CODES.FILE_UNREADABLE,
      path: await realpath(lockedFile),
      reason: 'EACCES',
    });
  });

  it('never executes a skill body', async () => {
    const marker = join(root, 'skill-body-executed');
    await writeSkill(
      projectSkills(),
      'not-executed',
      'name: not-executed\ndescription: body must remain inert',
      `node -e "require('fs').writeFileSync('${marker}', 'executed')"\n`,
    );

    const result = await scanOpenCodeSkills({ projectPath: project, homeDirectory: home });

    expect(result.entries).toHaveLength(1);
    expect(existsSync(marker)).toBe(false);
  });

  it('rejects a non-absolute project path before touching the filesystem', async () => {
    await expect(
      scanOpenCodeSkills({ projectPath: 'relative/project', homeDirectory: home }),
    ).rejects.toMatchObject({
      name: 'CatalogError',
      code: CATALOG_ERROR_CODES.PROJECT_PATH_INVALID,
    } satisfies Partial<CatalogError>);
  });

  it('exposes a bounded recursive scan depth', async () => {
    expect(DEFAULT_MAX_SKILL_DEPTH).toBeGreaterThan(0);
    await writeSkill(
      projectSkills(),
      join('one', 'two', 'three'),
      'name: too-deep\ndescription: beyond the scan cap',
    );

    const result = await scanOpenCodeSkills({
      projectPath: project,
      homeDirectory: home,
      maxDepth: 2,
    });

    expect(result.entries).toEqual([]);
    expect(result.warnings[0]).toMatchObject({
      code: CATALOG_WARNING_CODES.DEPTH_EXCEEDED,
      reason: 'MAX_DEPTH',
    });
  });
});

describe('SKILL.md frontmatter parsing', () => {
  it('parses name and description and preserves the body', () => {
    const parsed = parseSkillFrontmatter(
      [
        '---',
        'name: "quoted-skill"',
        'description: >-',
        '  A folded description',
        '  over two lines',
        '---',
        '# Body',
        'Do the work.',
        '',
      ].join('\n'),
    );

    expect(parsed.present).toBe(true);
    expect(frontmatterString(parsed.data, 'name')).toBe('quoted-skill');
    expect(frontmatterString(parsed.data, 'description')).toBe(
      'A folded description over two lines',
    );
    expect(parsed.body).toBe('# Body\nDo the work.\n');
  });

  it('treats a file without frontmatter as a valid package with no metadata', () => {
    const parsed = parseSkillFrontmatter('Just instructions.\n');

    expect(parsed).toEqual({ present: false, data: {}, body: 'Just instructions.\n' });
  });

  it('accepts an empty frontmatter block', () => {
    const parsed = parseSkillFrontmatter('---\n---\nBody\n');

    expect(parsed.present).toBe(true);
    expect(parsed.data).toEqual({});
    expect(parsed.body).toBe('Body\n');
  });

  it('rejects an unterminated frontmatter block', () => {
    expect(() => parseSkillFrontmatter('---\nname: broken\nNo closing delimiter\n')).toThrowError(
      expect.objectContaining({
        code: FRONTMATTER_ERROR_CODES.UNTERMINATED,
      }),
    );
    expect(() => parseSkillFrontmatter('---\nname: broken\n')).toThrow(FrontmatterError);
  });

  it('rejects invalid YAML and non-mapping documents', () => {
    expect(() => parseSkillFrontmatter('---\nname: [unclosed\n---\nBody\n')).toThrowError(
      expect.objectContaining({ code: FRONTMATTER_ERROR_CODES.INVALID_YAML }),
    );
    expect(() => parseSkillFrontmatter('---\n- one\n- two\n---\nBody\n')).toThrowError(
      expect.objectContaining({ code: FRONTMATTER_ERROR_CODES.NOT_A_MAPPING }),
    );
  });

  it('ignores non-string metadata instead of coercing it', () => {
    const parsed = parseSkillFrontmatter('---\nname: 42\ndescription: [not, a, string]\n---\n');

    expect(frontmatterString(parsed.data, 'name')).toBeUndefined();
    expect(frontmatterString(parsed.data, 'description')).toBeUndefined();
    expect(frontmatterString(parsed.data, 'missing')).toBeUndefined();
  });
});
