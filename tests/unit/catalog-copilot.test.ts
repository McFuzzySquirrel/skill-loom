import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  COPILOT_DISCOVERY_ARGS,
  COPILOT_HARNESS,
  DEFAULT_COPILOT_TIMEOUT_MS,
  buildCopilotDiscoveryCommand,
  redactStderrExcerpt,
  scanCopilotSkills,
  type CopilotCommandRequest,
  type CopilotCommandResult,
  type CopilotCommandRunner,
} from '../../src/server/catalog/copilot.js';
import {
  CATALOG_ERROR_CODES,
  CATALOG_WARNING_CODES,
  CatalogError,
  createSkillId,
  type SkillEntry,
} from '../../src/server/catalog/types.js';

let root: string;
let project: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'slan-catalog-copilot-'));
  project = join(root, 'project');
  await mkdir(project, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Write a Copilot-style package directory and return its absolute path. */
async function writePackage(
  source: string,
  name: string,
  frontmatter = true,
): Promise<string> {
  const directory = join(root, 'skills', source, name);
  await mkdir(directory, { recursive: true });
  if (frontmatter) {
    await writeFile(
      join(directory, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${name} description\n---\nBody.\n`,
      'utf8',
    );
  }
  return directory;
}

/** A runner that records the request and returns one fixed outcome. */
function fixedRunner(
  result: CopilotCommandResult | ((request: CopilotCommandRequest) => CopilotCommandResult),
): { run: CopilotCommandRunner; requests: CopilotCommandRequest[] } {
  const requests: CopilotCommandRequest[] = [];
  const run: CopilotCommandRunner = async (request) => {
    requests.push(request);
    return typeof result === 'function' ? result(request) : result;
  };
  return { run, requests };
}

function success(stdout: unknown): CopilotCommandResult {
  return {
    exitCode: 0,
    stdout: JSON.stringify(stdout),
    stderr: '',
    timedOut: false,
  };
}

function namesBySource(entries: SkillEntry[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const entry of entries) {
    (grouped[entry.source] ??= []).push(entry.name);
  }
  return grouped;
}

describe('Copilot skill discovery', () => {
  it('invokes copilot skill list --json with an executable and argument array', async () => {
    const { run, requests } = fixedRunner(success([]));

    await scanCopilotSkills({ projectPath: project, runner: run });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      executable: 'copilot',
      args: ['skill', 'list', '--json'],
      cwd: await realpath(project),
      timeoutMs: DEFAULT_COPILOT_TIMEOUT_MS,
    });
    expect(requests[0]?.args).toEqual([...COPILOT_DISCOVERY_ARGS]);
    expect(DEFAULT_COPILOT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(buildCopilotDiscoveryCommand()).toEqual({
      executable: 'copilot',
      args: ['skill', 'list', '--json'],
    });
    expect(buildCopilotDiscoveryCommand('/custom/copilot')).toEqual({
      executable: '/custom/copilot',
      args: ['skill', 'list', '--json'],
    });
  });

  it('maps every documented source label and preserves enabled state', async () => {
    const projectPackage = await writePackage('project', 'project-skill');
    const personalPackage = await writePackage('personal', 'personal-skill');
    const pluginPackage = await writePackage('plugin', 'plugin-skill');
    const customFile = await writePackage('custom', 'custom-skill');
    const builtinPackage = await writePackage('builtin', 'builtin-skill', false);

    const output = [
      {
        name: 'project-skill',
        description: 'Project description',
        source: 'project',
        path: projectPackage,
        enabled: true,
      },
      {
        name: 'personal-skill',
        description: 'Personal description',
        source: 'personal',
        path: personalPackage,
        enabled: false,
      },
      {
        name: 'plugin-skill',
        description: 'Plugin description',
        source: 'plugin',
        path: pluginPackage,
        enabled: true,
      },
      {
        name: 'custom-skill',
        description: 'Custom description',
        source: 'custom',
        path: join(customFile, 'SKILL.md'),
        enabled: true,
      },
      {
        name: 'builtin-skill',
        description: 'Builtin description',
        source: 'builtin',
        path: builtinPackage,
        enabled: true,
      },
    ];
    const { run } = fixedRunner(success(output));

    const result = await scanCopilotSkills({ projectPath: project, runner: run });

    expect(result.warnings).toEqual([]);
    expect(result.entries).toHaveLength(5);
    expect(namesBySource(result.entries)).toEqual({
      project: ['project-skill'],
      personal: ['personal-skill'],
      custom: ['custom-skill'],
      plugin: ['plugin-skill'],
      builtin: ['builtin-skill'],
    });

    const byName = new Map(result.entries.map((entry) => [entry.name, entry]));
    expect(byName.get('project-skill')).toMatchObject({
      harness: 'copilot',
      source: 'project',
      description: 'Project description',
      enabled: true,
      path: await realpath(join(projectPackage, 'SKILL.md')),
      packagePath: await realpath(projectPackage),
    });
    expect(byName.get('personal-skill')?.enabled).toBe(false);
    expect(byName.get('custom-skill')?.path).toBe(
      await realpath(join(customFile, 'SKILL.md')),
    );
    // A source without SKILL.md remains addressable through its directory.
    expect(byName.get('builtin-skill')).toMatchObject({
      path: await realpath(builtinPackage),
      packagePath: await realpath(builtinPackage),
    });

    for (const entry of result.entries) {
      expect(entry.id).toMatch(/^copilot-[a-z-]+-[0-9a-f]{16}$/);
      expect(entry.id).toBe(
        createSkillId({
          harness: COPILOT_HARNESS,
          source: entry.source,
          path: entry.path,
          name: entry.name,
        }),
      );
    }
  });

  it('keeps valid entries when individual records are malformed', async () => {
    const fallbackPackage = await writePackage('project', 'fallback-name');
    const output = [
      'not-an-object',
      { name: 'mystery-skill', description: 'Unknown origin', source: 'moon', path: project },
      {
        description: 'No explicit name',
        source: 'project',
        path: fallbackPackage,
        enabled: false,
      },
      { name: 'pathless-skill', description: 'No path', source: 'custom', enabled: true },
      {
        name: 'valid-skill',
        description: 'A valid sibling',
        source: 'builtin',
        path: project,
        enabled: true,
      },
    ];
    const { run } = fixedRunner(success(output));

    const result = await scanCopilotSkills({ projectPath: project, runner: run });

    expect(result.entries.map((entry) => entry.name).sort()).toEqual([
      'fallback-name',
      'pathless-skill',
      'valid-skill',
    ]);
    expect(result.entries.find((entry) => entry.name === 'fallback-name')).toMatchObject({
      source: 'project',
      enabled: false,
    });
    expect(result.entries.find((entry) => entry.name === 'pathless-skill')).toMatchObject({
      path: '',
      packagePath: '',
    });

    const codes = result.warnings.map((warning) => warning.code);
    expect(codes).toContain(CATALOG_WARNING_CODES.ENTRY_INVALID);
    expect(codes).toContain(CATALOG_WARNING_CODES.SOURCE_UNKNOWN);
    expect(codes).toContain(CATALOG_WARNING_CODES.NAME_MISSING);
    expect(codes).toContain(CATALOG_WARNING_CODES.PATH_UNRESOLVED);
    expect(result.warnings.every((warning) => warning.harness === 'copilot')).toBe(true);
  });

  it('returns an empty successful catalog without warnings', async () => {
    const { run } = fixedRunner(success([]));

    const result = await scanCopilotSkills({ projectPath: project, runner: run });

    expect(result).toEqual({ entries: [], warnings: [] });
  });

  it('turns malformed JSON into a warning instead of an empty catalog', async () => {
    const { run } = fixedRunner({
      exitCode: 0,
      stdout: '{ "name": "broken", ',
      stderr: '',
      timedOut: false,
    });

    const result = await scanCopilotSkills({ projectPath: project, runner: run });

    expect(result.entries).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: CATALOG_WARNING_CODES.OUTPUT_INVALID,
      harness: 'copilot',
      reason: 'JSON_INVALID',
      exitCode: 0,
    });
    expect(result.warnings[0]?.command).toContain('copilot skill list --json');
  });

  it('turns JSON that is not an array into a warning', async () => {
    const { run } = fixedRunner(success({ skills: [] }));

    const result = await scanCopilotSkills({ projectPath: project, runner: run });

    expect(result.entries).toEqual([]);
    expect(result.warnings[0]).toMatchObject({
      code: CATALOG_WARNING_CODES.OUTPUT_INVALID,
      reason: 'OUTPUT_NOT_ARRAY',
    });
  });

  it('turns a non-zero exit into a redacted warning', async () => {
    const { run } = fixedRunner({
      exitCode: 2,
      stdout: '',
      stderr: 'failed for token=super-secret-value\nBearer abcdefghijklmnop',
      timedOut: false,
    });

    const result = await scanCopilotSkills({ projectPath: project, runner: run });

    expect(result.entries).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: CATALOG_WARNING_CODES.COMMAND_FAILED,
      harness: 'copilot',
      exitCode: 2,
      reason: 'EXIT_2',
    });
    expect(result.warnings[0]?.message).toContain('exit code 2');
    expect(result.warnings[0]?.stderr).toContain('[REDACTED]');
    expect(result.warnings[0]?.stderr).not.toContain('super-secret-value');
    expect(result.warnings[0]?.stderr).not.toContain('abcdefghijklmnop');
  });

  it('turns a missing executable into an unavailable warning', async () => {
    const { run } = fixedRunner({
      exitCode: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      errorCode: 'ENOENT',
    });

    const result = await scanCopilotSkills({ projectPath: project, runner: run });

    expect(result.entries).toEqual([]);
    expect(result.warnings[0]).toMatchObject({
      code: CATALOG_WARNING_CODES.COMMAND_UNAVAILABLE,
      reason: 'ENOENT',
      harness: 'copilot',
    });
    expect(result.warnings[0]?.message).toContain('"copilot"');
  });

  it('turns a thrown spawn failure into a warning rather than rejecting', async () => {
    const runner: CopilotCommandRunner = async () => {
      throw Object.assign(new Error('spawn copilot ENOENT'), { code: 'ENOENT' });
    };

    const result = await scanCopilotSkills({ projectPath: project, runner });

    expect(result.entries).toEqual([]);
    expect(result.warnings[0]?.code).toBe(CATALOG_WARNING_CODES.COMMAND_UNAVAILABLE);
  });

  it('turns a reported timeout into a warning', async () => {
    const { run } = fixedRunner({
      exitCode: null,
      stdout: '',
      stderr: '',
      timedOut: true,
    });

    const result = await scanCopilotSkills({ projectPath: project, runner: run, timeoutMs: 200 });

    expect(result.entries).toEqual([]);
    expect(result.warnings[0]).toMatchObject({
      code: CATALOG_WARNING_CODES.COMMAND_TIMEOUT,
      reason: 'TIMEOUT',
      harness: 'copilot',
    });
    expect(result.warnings[0]?.message).toContain('200 ms');
  });

  it('bounds a runner that never settles', async () => {
    const runner: CopilotCommandRunner = () => new Promise<CopilotCommandResult>(() => undefined);

    const result = await scanCopilotSkills({ projectPath: project, runner, timeoutMs: 100 });

    expect(result.entries).toEqual([]);
    expect(result.warnings[0]?.code).toBe(CATALOG_WARNING_CODES.COMMAND_TIMEOUT);
  });

  it('uses a configured executable without a shell string', async () => {
    const { run, requests } = fixedRunner(success([]));

    await scanCopilotSkills({
      projectPath: project,
      executable: '/opt/copilot/bin/copilot',
      runner: run,
    });

    expect(requests[0]?.executable).toBe('/opt/copilot/bin/copilot');
    expect(requests[0]?.args).toEqual(['skill', 'list', '--json']);
  });

  it('rejects a relative or missing project directory before running a command', async () => {
    const { run, requests } = fixedRunner(success([]));

    await expect(
      scanCopilotSkills({ projectPath: 'relative/project', runner: run }),
    ).rejects.toMatchObject({
      name: 'CatalogError',
      code: CATALOG_ERROR_CODES.PROJECT_PATH_INVALID,
    } satisfies Partial<CatalogError>);

    await expect(
      scanCopilotSkills({ projectPath: join(root, 'missing'), runner: run }),
    ).rejects.toBeInstanceOf(CatalogError);

    expect(requests).toEqual([]);
  });

  it('produces stable ids and keeps duplicate names separate', async () => {
    const first = await writePackage('project', 'duplicate');
    const second = await writePackage('personal', 'duplicate');
    const output = [
      { name: 'duplicate', description: 'Project', source: 'project', path: first, enabled: true },
      {
        name: 'duplicate',
        description: 'Personal',
        source: 'personal',
        path: second,
        enabled: true,
      },
    ];

    const firstResult = await scanCopilotSkills({
      projectPath: project,
      runner: fixedRunner(success(output)).run,
    });
    const secondResult = await scanCopilotSkills({
      projectPath: project,
      runner: fixedRunner(success(output)).run,
    });

    expect(firstResult.entries).toHaveLength(2);
    expect(new Set(firstResult.entries.map((entry) => entry.id)).size).toBe(2);
    expect(firstResult.entries.map((entry) => entry.id).sort()).toEqual(
      secondResult.entries.map((entry) => entry.id).sort(),
    );
    expect(firstResult.entries.map((entry) => entry.source).sort()).toEqual([
      'personal',
      'project',
    ]);
  });
});

describe('stderr redaction', () => {
  it('removes token-like values and bounds the excerpt', () => {
    const excerpt = redactStderrExcerpt(
      `token=abc123 ghp_${'a'.repeat(24)} Bearer ${'b'.repeat(24)} ${'x'.repeat(500)}`,
      80,
    );

    expect(excerpt).toContain('[REDACTED]');
    expect(excerpt).not.toContain('abc123');
    expect(excerpt).not.toContain('a'.repeat(24));
    expect(excerpt.length).toBeLessThanOrEqual(80);
  });

  it('returns an empty excerpt for absent stderr', () => {
    expect(redactStderrExcerpt(undefined)).toBe('');
    expect(redactStderrExcerpt('')).toBe('');
  });
});
