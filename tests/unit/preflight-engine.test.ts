import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHAIN_VERSION,
  type Chain,
  type ChainSessionMode,
} from '../../src/server/chains/model.js';
import type {
  CatalogService,
  CatalogResponse,
} from '../../src/server/catalog/merge.js';
import {
  SKILL_SOURCES,
  type CatalogWarning,
  type SkillEntry,
  type SkillHarness,
  type SkillSource,
} from '../../src/server/catalog/types.js';
import type { HarnessCommands } from '../../src/server/config/schema.js';
import { createHarnessRegistry } from '../../src/server/harness/registry.js';
import type { HarnessAdapter } from '../../src/server/harness/types.js';
import { createOpenCodeAdapter } from '../../src/server/harness/opencode.js';
import type {
  HarnessAuthStrategy,
  LocalCommandRequest,
  LocalCommandResult,
  LocalCommandRunner,
} from '../../src/server/preflight/auth.js';
import {
  createPreflightEngine,
  PREFLIGHT_WARNINGS_ACKNOWLEDGEMENT,
  runPreflight,
  type PreflightEngineDependencies,
  type PreflightReport,
} from '../../src/server/preflight/engine.js';

const CREATED_AT = '2026-11-04T12:00:00.000Z';
const PROJECT = '/workspace/demo-project';
const HOME = '/home/preflight';
const PATH_ENV = '/fake/bin';

const OPENCODE = join(PATH_ENV, 'opencode');
const COPILOT = join(PATH_ENV, 'copilot');

function makeChain(overrides: Record<string, unknown> = {}): Chain {
  return {
    version: CHAIN_VERSION,
    id: 'chain-alpha',
    name: 'Alpha chain',
    harness: 'opencode',
    sessionMode: 'shared',
    steps: [
      { id: 'step-1', skillName: 'brainstorm', instruction: 'Plan {{task}}.', label: 'Plan' },
      { id: 'step-2', skillName: 'implement', instruction: 'Implement {{task}} for {{audience}}.' },
    ],
    inputs: [
      { name: 'task', label: 'Task', required: true },
      { name: 'audience', label: 'Audience', required: false, defaultValue: 'maintainers' },
    ],
    automaticPermissionOptIn: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  } as unknown as Chain;
}

function skill(
  harness: SkillHarness,
  source: SkillSource,
  name: string,
  pathKey = name,
): SkillEntry {
  const path = join(PROJECT, '.opencode', 'skills', pathKey, 'SKILL.md');
  return {
    id: `${harness}-${source}-${pathKey}`,
    harness,
    source,
    name,
    description: `${name} description`,
    path,
    packagePath: join(PROJECT, '.opencode', 'skills', pathKey),
    enabled: true,
  };
}

function emptyCounts(total = 0): CatalogResponse['counts'] {
  const bySource = {} as Record<SkillSource, number>;
  for (const source of SKILL_SOURCES) {
    bySource[source] = 0;
  }
  return { total, bySource };
}

function catalogWith(
  entries: readonly SkillEntry[],
  warnings: CatalogWarning[] = [],
  harness: SkillHarness = 'opencode',
): CatalogService {
  return {
    defaultHarness: harness,
    async getCatalog(request): Promise<CatalogResponse> {
      const counts = emptyCounts(entries.length);
      for (const entry of entries) {
        counts.bySource[entry.source] += 1;
      }
      return {
        harness: request.harness,
        query: request.query ?? '',
        total: entries.length,
        counts,
        groups:
          entries.length === 0
            ? []
            : [{ source: entries[0]?.source ?? 'project', count: entries.length, entries: [...entries] }],
        agents: [],
        warnings,
        elapsedMs: 1,
      };
    },
  };
}

function failingCatalog(error: Error): CatalogService {
  return {
    defaultHarness: 'opencode',
    async getCatalog(): Promise<CatalogResponse> {
      throw error;
    },
  };
}

interface RunnerHandlers {
  auth?: (request: LocalCommandRequest) => Partial<LocalCommandResult>;
  git?: (request: LocalCommandRequest) => Partial<LocalCommandResult>;
}

interface RunnerHarness {
  runner: LocalCommandRunner;
  calls: LocalCommandRequest[];
}

function createRunner(handlers: RunnerHandlers = {}): RunnerHarness {
  const calls: LocalCommandRequest[] = [];
  const runner: LocalCommandRunner = async (request) => {
    calls.push(request);
    if (request.args[0] === 'auth') {
      const partial = handlers.auth?.(request) ?? {
        exitCode: 0,
        stdout: JSON.stringify([{ id: 'provider', connections: [{ id: 'connection' }] }]),
        stderr: '',
      };
      return normalizeCommandResult(partial);
    }
    if (request.args[0] === 'status' && request.args[1] === '--porcelain') {
      const partial = handlers.git?.(request) ?? {
        exitCode: 0,
        stdout: '',
        stderr: '',
      };
      return normalizeCommandResult(partial);
    }
    return normalizeCommandResult({
      exitCode: 127,
      stdout: '',
      stderr: `unexpected command ${request.args.join(' ')}`,
    });
  };
  return { runner, calls };
}

function normalizeCommandResult(
  partial: Partial<LocalCommandResult>,
): LocalCommandResult {
  return {
    exitCode: partial.exitCode ?? 0,
    signal: partial.signal ?? null,
    stdout: partial.stdout ?? '',
    stderr: partial.stderr ?? '',
    timedOut: partial.timedOut ?? false,
    spawnError: partial.spawnError ?? null,
  };
}

function registry(options: {
  executable?: boolean;
  commands?: HarnessCommands;
  adapter?: HarnessAdapter;
} = {}) {
  if (options.adapter !== undefined) {
    return {
      get: () => options.adapter,
      list: () => [options.adapter],
      has: () => true,
    } as unknown as ReturnType<typeof createHarnessRegistry>;
  }

  const executable = options.executable ?? true;
  return createHarnessRegistry({
    env: { PATH: PATH_ENV },
    isExecutable: (candidate) =>
      executable && (candidate === OPENCODE || candidate === COPILOT),
    ...(options.commands === undefined ? {} : { commands: options.commands }),
  });
}

function engineOptions(options: {
  chain?: Chain;
  entries?: readonly SkillEntry[];
  warnings?: CatalogWarning[];
  catalog?: CatalogService;
  harness?: SkillHarness;
  runner?: RunnerHarness;
  authStrategies?: readonly HarnessAuthStrategy[];
  readFileText?: (path: string) => Promise<string>;
  env?: NodeJS.ProcessEnv;
  registry?: ReturnType<typeof createHarnessRegistry>;
  homeDirectory?: string;
} = {}): PreflightEngineDependencies {
  const chain = options.chain ?? makeChain();
  const harness = options.harness ?? (chain.harness as SkillHarness);
  const catalog =
    options.catalog ??
    catalogWith(
      options.entries ?? [
        skill(harness, 'project', 'brainstorm'),
        skill(harness, 'project', 'implement'),
      ],
      options.warnings ?? [],
      harness,
    );

  return {
    catalogService: catalog,
    harnessRegistry: options.registry ?? registry(),
    commandRunner: (options.runner ?? createRunner()).runner,
    readFileText:
      options.readFileText ??
      (async () => JSON.stringify({ trustedFolders: [PROJECT] })),
    homeDirectory: options.homeDirectory ?? HOME,
    env: options.env ?? { PATH: PATH_ENV },
    ...(options.authStrategies === undefined
      ? {}
      : { authStrategies: options.authStrategies }),
  };
}

async function preflight(
  options: {
    chain?: Chain;
    inputs?: unknown;
    mode?: string;
    acknowledgements?: unknown;
    harness?: string;
    projectPath?: string;
    deps?: PreflightEngineDependencies;
  } = {},
): Promise<PreflightReport> {
  const chain = options.chain ?? makeChain();
  return runPreflight(
    {
      chain,
      projectPath: options.projectPath ?? PROJECT,
      ...(options.inputs === undefined ? { inputs: { task: 'ship it' } } : { inputs: options.inputs }),
      ...(options.mode === undefined ? {} : { mode: options.mode }),
      ...(options.acknowledgements === undefined
        ? {}
        : { acknowledgements: options.acknowledgements }),
      ...(options.harness === undefined ? {} : { harness: options.harness }),
    },
    options.deps ?? engineOptions({ chain }),
  );
}

function checkById(report: PreflightReport, key: string) {
  return report.checks.find((check) => check.key === key);
}

function expectBlocked(report: PreflightReport, key: string): void {
  expect(report.status).toBe('blocked');
  const check = checkById(report, key);
  expect(check?.status).toBe('block');
}

describe('preflight engine: passing report', () => {
  it('does not require or read a skill catalog for instruction-only chains', async () => {
    const chain = makeChain({
      steps: [{ id: 'plain', kind: 'instruction', instruction: 'Plan {{task}}.' }],
      inputs: [{ name: 'task', required: true }],
    });
    const report = await preflight({
      chain, deps: engineOptions({ chain, catalog: failingCatalog(new Error('No skills installed')) }),
    });
    expect(report.startAllowed).toBe(true);
    expect(report.skills).toEqual([]);
    expect(report.resolvedInputs.task).toBe('ship it');
    expect(report.checks.some((check) => check.id === 'skill' || check.id === 'catalog')).toBe(false);
  });

  it('resolves only skill steps in mixed chains without losing their original indices', async () => {
    const chain = makeChain({
      steps: [
        { id: 'plain', kind: 'instruction', instruction: 'Plan {{task}}.' },
        { id: 'skill', skillName: 'implement', instruction: 'Implement {{task}}.' },
      ],
      inputs: [{ name: 'task', required: true }],
    });
    const report = await preflight({ chain });
    expect(report.startAllowed).toBe(true);
    expect(report.skills).toHaveLength(1);
    expect(report.skills[0]).toMatchObject({ stepId: 'skill', stepIndex: 1, resolved: true });
  });

  it('resolves a bound remote skill snapshot instead of the first same-name catalog entry', async () => {
    const first = {
      ...skill('opencode', 'remote', 'review', 'first-revision'),
      sourceId: 'repo-one',
      revision: 'a'.repeat(40),
      repositoryPath: 'skills/review',
    };
    const selected = {
      ...skill('opencode', 'remote', 'review', 'selected-revision'),
      sourceId: 'repo-one',
      revision: 'b'.repeat(40),
      repositoryPath: 'skills/review',
    };
    const chain = makeChain({
      steps: [
        {
          id: 'pinned',
          kind: 'skill',
          skillName: 'review',
          skillBinding: {
            sourceId: selected.sourceId,
            revision: selected.revision,
            repositoryPath: selected.repositoryPath,
          },
          instruction: 'Review the project.',
        },
      ],
      inputs: [],
    });
    const report = await preflight({
      chain,
      inputs: {},
      deps: engineOptions({ chain, catalog: catalogWith([first, selected]) }),
    });

    expect(report.startAllowed).toBe(true);
    expect(report.skills).toMatchObject([
      { stepId: 'pinned', entryId: selected.id, path: selected.path, resolved: true },
    ]);
  });

  it('blocks legacy name-only steps when multiple packages match', async () => {
    const first = {
      ...skill('opencode', 'remote', 'review', 'first-revision'),
      sourceId: 'repo-one',
      revision: 'a'.repeat(40),
      repositoryPath: 'skills/review',
    };
    const second = {
      ...skill('opencode', 'remote', 'review', 'second-revision'),
      sourceId: 'repo-one',
      revision: 'b'.repeat(40),
      repositoryPath: 'skills/review',
    };
    const chain = makeChain({
      steps: [{ id: 'legacy', skillName: 'review', instruction: 'Review the project.' }],
      inputs: [],
    });
    const report = await preflight({
      chain,
      inputs: {},
      deps: engineOptions({ chain, catalog: catalogWith([first, second]) }),
    });

    expect(report.skills).toMatchObject([{ stepId: 'legacy', matchCount: 2 }]);
    expect(report.startAllowed).toBe(false);
    expect(checkById(report, 'skill:legacy')?.status).toBe('block');
  });

  it('distinguishes a disabled bound snapshot from an unavailable binding', async () => {
    const disabled = {
      ...skill('opencode', 'remote', 'review', 'disabled-revision'),
      sourceId: 'repo-one',
      revision: 'c'.repeat(40),
      repositoryPath: 'skills/review',
      enabled: false,
    };
    const chain = makeChain({
      steps: [
        {
          id: 'pinned',
          kind: 'skill',
          skillName: 'review',
          skillBinding: {
            sourceId: disabled.sourceId,
            revision: disabled.revision,
            repositoryPath: disabled.repositoryPath,
          },
          instruction: 'Review the project.',
        },
      ],
      inputs: [],
    });
    const report = await preflight({
      chain,
      inputs: {},
      deps: engineOptions({ chain, catalog: catalogWith([disabled]) }),
    });

    expect(checkById(report, 'skill:pinned')?.message).toContain('disabled');
    expect(checkById(report, 'skill:pinned')?.message).not.toContain('unavailable');
  });

  it('resolves inputs, skills, auth, trust, session, and a clean tree', async () => {
    const runner = createRunner();
    const report = await preflight({ deps: engineOptions({ runner }) });

    expect(report.status).toBe('pass');
    expect(report.startAllowed).toBe(true);
    expect(report.chain).toEqual({ id: 'chain-alpha', name: 'Alpha chain', stepCount: 2 });
    expect(report.harness).toBe('opencode');
    expect(report.displayName).toBe('OpenCode');
    expect(report.mode).toBe('supervised');
    expect(report.resolvedInputs).toEqual({ task: 'ship it', audience: 'maintainers' });
    expect(report.skills).toHaveLength(2);
    expect(report.skills.every((entry) => entry.resolved)).toBe(true);
    expect(report.catalogWarnings).toEqual([]);
    expect(report.sessionPlan).toMatchObject({
      sessionMode: 'shared',
      surface: 'interactive',
      mechanism: 'none',
      nativeFork: true,
    });
    expect(report.permissions).toMatchObject({
      mode: 'supervised',
      automatic: false,
      required: false,
      flags: [],
    });
    expect(report.acknowledgements).toEqual({ required: [], provided: [], missing: [] });

    expect(checkById(report, 'chain')?.status).toBe('pass');
    expect(checkById(report, 'inputs')?.status).toBe('pass');
    expect(checkById(report, 'cli')?.status).toBe('pass');
    expect(checkById(report, 'catalog')?.status).toBe('pass');
    expect(checkById(report, 'skill:step-1')?.status).toBe('pass');
    expect(checkById(report, 'skill:step-2')?.status).toBe('pass');
    expect(checkById(report, 'authentication')?.status).toBe('pass');
    expect(checkById(report, 'trust')?.status).toBe('pass');
    expect(checkById(report, 'session-mode')?.status).toBe('pass');
    expect(checkById(report, 'fork')?.status).toBe('pass');
    expect(checkById(report, 'permissions')?.status).toBe('pass');
    expect(checkById(report, 'git')?.status).toBe('pass');

    // No prompt mode, no session flag, no model call: only static evidence
    // commands and git status may run.
    expect(runner.calls.map((call) => call.args)).toEqual([
      ['auth', 'list', '--format', 'json'],
      ['status', '--porcelain'],
    ]);
    for (const call of runner.calls) {
      expect(call.args).not.toContain('-p');
      expect(call.args).not.toContain('--prompt');
      expect(call.args).not.toContain('-i');
      expect(call.args).not.toContain('--session');
      expect(call.args).not.toContain('--session-id');
    }
  });

  it('is deterministic for the same inputs', async () => {
    const first = await preflight({ deps: engineOptions({ runner: createRunner() }) });
    const second = await preflight({ deps: engineOptions({ runner: createRunner() }) });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('uses an environment token as authentication evidence without running a command', async () => {
    const runner = createRunner();
    const report = await preflight({
      deps: engineOptions({
        runner,
        env: { PATH: PATH_ENV, OPENAI_API_KEY: 'present-but-never-reported' },
      }),
    });

    expect(report.status).toBe('pass');
    expect(checkById(report, 'authentication')?.status).toBe('pass');
    expect(checkById(report, 'authentication')?.details).toMatchObject({
      reason: 'ENVIRONMENT_TOKEN',
    });
    expect(runner.calls.some((call) => call.args[0] === 'auth')).toBe(false);
  });
});

describe('preflight engine: hard blocks', () => {
  it('blocks native agents when the selected harness command surface cannot select them', async () => {
    const chain = makeChain({
      agent: {
        harness: 'opencode',
        name: 'reviewer',
        sourceId: 'remote-source',
        revision: 'a'.repeat(40),
        repositoryPath: '.opencode/agents/reviewer.md',
        agentPath: 'reviewer.md',
        fingerprint: 'b'.repeat(64),
      },
    });

    const report = await preflight({ chain, mode: 'supervised' });

    expectBlocked(report, 'agent:capability');
    expect(checkById(report, 'agent:capability')?.message).toContain('interactive command surface');
  });

  it('blocks a selected native agent whose project definition is missing', async () => {
    const chain = makeChain({
      agent: {
        harness: 'opencode',
        name: 'reviewer',
        sourceId: 'remote-source',
        revision: 'a'.repeat(40),
        repositoryPath: '.opencode/agents/reviewer.md',
        agentPath: 'reviewer.md',
        fingerprint: 'b'.repeat(64),
      },
    });

    const report = await preflight({ chain, mode: 'automatic' });

    expectBlocked(report, 'agent:installed');
    expect(checkById(report, 'agent:installed')?.message).toContain('missing');
  });
  it('blocks an unresolved required input', async () => {
    const report = await preflight({
      inputs: {},
      deps: engineOptions({ runner: createRunner() }),
    });

    expectBlocked(report, 'inputs:required');
    expect(checkById(report, 'inputs:required')?.details).toMatchObject({ missing: ['task'] });
  });

  it('blocks invalid input value types', async () => {
    const report = await preflight({
      inputs: { task: 42 },
      deps: engineOptions({ runner: createRunner() }),
    });

    expectBlocked(report, 'inputs:values');
  });

  it('blocks an unresolved skill and names the step', async () => {
    const chain = makeChain();
    const report = await preflight({
      chain,
      deps: engineOptions({
        chain,
        entries: [skill('opencode', 'project', 'brainstorm')],
        runner: createRunner(),
      }),
    });

    expectBlocked(report, 'skill:step-2');
    const check = checkById(report, 'skill:step-2');
    expect(check?.message).toContain('Step 2');
    expect(check?.message).toContain('implement');
    expect(check?.details).toMatchObject({
      stepId: 'step-2',
      stepIndex: 1,
      skillName: 'implement',
    });
    expect(report.skills.find((entry) => entry.stepId === 'step-2')?.resolved).toBe(false);
  });

  it('blocks a skill that only exists as a disabled catalog entry', async () => {
    const disabled = { ...skill('opencode', 'project', 'implement'), enabled: false };
    const report = await preflight({
      deps: engineOptions({
        entries: [skill('opencode', 'project', 'brainstorm'), disabled],
        runner: createRunner(),
      }),
    });

    expectBlocked(report, 'skill:step-2');
  });

  it('blocks a missing CLI', async () => {
    const report = await preflight({
      deps: engineOptions({
        runner: createRunner(),
        registry: registry({ executable: false }),
      }),
    });

    expectBlocked(report, 'cli');
    expect(checkById(report, 'cli')?.details).toMatchObject({ harness: 'opencode' });
  });

  it('blocks an unsupported session mode', async () => {
    const chain = makeChain({ sessionMode: 'fresh' });
    const adapter = {
      ...createOpenCodeAdapter({
        env: { PATH: PATH_ENV },
        isExecutable: (candidate: string) => candidate === OPENCODE,
      }),
      supportedSessionModes: ['shared'],
      supportsSessionMode: (mode: string) => mode === 'shared',
      assertSessionMode: (mode: string) => mode as ChainSessionMode,
    } as unknown as HarnessAdapter;

    const report = await preflight({
      chain,
      deps: engineOptions({
        chain,
        runner: createRunner(),
        registry: registry({ adapter }),
      }),
    });

    expectBlocked(report, 'session-mode');
    expect(checkById(report, 'session-mode')?.details).toMatchObject({
      sessionMode: 'fresh',
      supported: ['shared'],
    });
  });

  it('blocks a catalog failure instead of treating it as empty', async () => {
    const report = await preflight({
      deps: engineOptions({
        runner: createRunner(),
        catalog: failingCatalog(new Error('catalog exploded')),
      }),
    });

    expectBlocked(report, 'catalog');
    expect(report.skills).toEqual([]);
  });

  it('blocks an untrusted Copilot folder', async () => {
    const chain = makeChain({ harness: 'copilot' });
    const report = await preflight({
      chain,
      deps: engineOptions({
        chain,
        harness: 'copilot',
        env: { PATH: PATH_ENV, COPILOT_GITHUB_TOKEN: 'present' },
        readFileText: async () =>
          JSON.stringify({ trustedFolders: ['/workspace/other-project'] }),
        runner: createRunner(),
      }),
    });

    expectBlocked(report, 'trust');
    expect(checkById(report, 'trust')?.details).toMatchObject({
      harness: 'copilot',
      state: 'untrusted',
      configPath: `${HOME}/.copilot/config.json`,
    });
  });

  it('blocks a missing Copilot config as an untrusted folder', async () => {
    const chain = makeChain({ harness: 'copilot' });
    const report = await preflight({
      chain,
      deps: engineOptions({
        chain,
        harness: 'copilot',
        env: { PATH: PATH_ENV, COPILOT_GITHUB_TOKEN: 'present' },
        readFileText: async () => {
          const error = new Error('missing') as Error & { code: string };
          error.code = 'ENOENT';
          throw error;
        },
        runner: createRunner(),
      }),
    });

    expectBlocked(report, 'trust');
    expect(checkById(report, 'trust')?.details).toMatchObject({ state: 'untrusted' });
  });

  it('blocks automatic Copilot without the per-chain opt-in and shows exact flags', async () => {
    const chain = makeChain({ harness: 'copilot', automaticPermissionOptIn: false });
    const report = await preflight({
      chain,
      mode: 'automatic',
      deps: engineOptions({
        chain,
        harness: 'copilot',
        env: { PATH: PATH_ENV, COPILOT_GITHUB_TOKEN: 'present' },
        readFileText: async () => JSON.stringify({ trustedFolders: [PROJECT] }),
        runner: createRunner(),
      }),
    });

    expectBlocked(report, 'permissions');
    expect(report.permissions).toMatchObject({
      automatic: true,
      optInRequired: true,
      optInSatisfied: false,
      flags: ['--allow-all-paths', '--allow-all-tools'],
    });
    expect(checkById(report, 'permissions')?.message).toContain('permission opt-in');
  });

  it('blocks explicitly unauthenticated CLI output', async () => {
    const strategy: HarnessAuthStrategy = {
      harness: 'opencode',
      environmentVariables: [],
      commands: [
        {
          args: ['auth', 'status'],
          parse: 'status-text',
          description: 'fake status',
          unauthenticatedPattern: /not logged in/i,
        },
      ],
      files: [],
      loginHint: 'Log in.',
    };
    const runner = createRunner({
      auth: () => ({ exitCode: 0, stdout: 'Not logged in.', stderr: '' }),
    });

    const report = await preflight({
      deps: engineOptions({ runner, authStrategies: [strategy] }),
    });

    expectBlocked(report, 'authentication');
    expect(checkById(report, 'authentication')?.details).toMatchObject({
      state: 'unauthenticated',
    });
  });

  it('blocks a request harness that differs from the chain harness', async () => {
    const report = await preflight({
      harness: 'copilot',
      deps: engineOptions({ runner: createRunner() }),
    });

    expectBlocked(report, 'harness:mismatch');
  });

  it('blocks an invalid chain document', async () => {
    const report = await preflight({
      chain: { version: CHAIN_VERSION, id: 'broken' } as unknown as Chain,
    });

    expectBlocked(report, 'chain');
    expect(report.skills).toEqual([]);
    expect(report.sessionPlan).toBeNull();
  });

  it('blocks a relative project path', async () => {
    const report = await preflight({
      projectPath: 'relative/project',
      deps: engineOptions({ runner: createRunner() }),
    });

    expectBlocked(report, 'project');
  });

  it('blocks an invalid run mode and invalid acknowledgements', async () => {
    const report = await preflight({
      mode: 'turbo',
      acknowledgements: [42],
      deps: engineOptions({ runner: createRunner() }),
    });

    expectBlocked(report, 'request:mode');
    expectBlocked(report, 'request:acknowledgements');
  });
});

describe('preflight engine: warnings and acknowledgements', () => {
  it('warns on a dirty git tree without blocking and requires acknowledgement', async () => {
    const runner = createRunner({
      git: () => ({ exitCode: 0, stdout: ' M src/a.ts\n?? src/b.ts\n', stderr: '' }),
    });
    const deps = engineOptions({ runner });
    const report = await preflight({ deps });

    expect(report.status).toBe('warn');
    expect(report.startAllowed).toBe(false);
    expect(checkById(report, 'git')?.status).toBe('warn');
    expect(checkById(report, 'git')?.details).toMatchObject({
      count: 2,
      state: 'dirty',
    });
    expect(report.acknowledgements.required).toContain(PREFLIGHT_WARNINGS_ACKNOWLEDGEMENT);
    expect(report.acknowledgements.missing).toContain(PREFLIGHT_WARNINGS_ACKNOWLEDGEMENT);

    const acknowledged = await runPreflight(
      {
        chain: makeChain(),
        projectPath: PROJECT,
        inputs: { task: 'ship it' },
        acknowledgements: { warnings: true },
      },
      deps,
    );
    expect(acknowledged.status).toBe('warn');
    expect(acknowledged.startAllowed).toBe(true);
    expect(acknowledged.acknowledgements.missing).toEqual([]);
  });

  it('treats a non-repository as a non-blocking pass', async () => {
    const runner = createRunner({
      git: () => ({
        exitCode: 128,
        stdout: '',
        stderr: 'fatal: not a git repository (or any parent up to mount point /)',
      }),
    });
    const report = await preflight({ deps: engineOptions({ runner }) });

    expect(report.status).toBe('pass');
    expect(checkById(report, 'git')?.status).toBe('pass');
    expect(checkById(report, 'git')?.details).toMatchObject({ state: 'not-repository' });
  });

  it('warns when git status cannot be inspected', async () => {
    const runner = createRunner({
      git: () => ({ spawnError: 'ENOENT', exitCode: null }),
    });
    const report = await preflight({ deps: engineOptions({ runner }) });

    expect(report.status).toBe('warn');
    expect(checkById(report, 'git')?.status).toBe('warn');
    expect(checkById(report, 'git')?.details).toMatchObject({ state: 'unavailable' });
  });

  it('propagates catalog warnings without dropping valid entries', async () => {
    const warning: CatalogWarning = {
      code: 'SKILL_FILE_UNREADABLE',
      message: 'A sibling skill file could not be read.',
      harness: 'opencode',
      reason: 'EACCES',
    };
    const report = await preflight({
      deps: engineOptions({ runner: createRunner(), warnings: [warning] }),
    });

    expect(report.status).toBe('warn');
    expect(report.catalogWarnings).toEqual([warning]);
    expect(checkById(report, 'catalog')?.status).toBe('warn');
    expect(report.skills.every((entry) => entry.resolved)).toBe(true);
    expect(report.startAllowed).toBe(false);
  });

  it('warns on an unused chain input and requires warning acknowledgement', async () => {
    const chain = makeChain({
      inputs: [
        { name: 'task', label: 'Task', required: true },
        { name: 'audience', label: 'Audience', required: false, defaultValue: 'maintainers' },
        { name: 'unused', label: 'Unused', required: false },
      ],
    });
    const report = await preflight({
      chain,
      inputs: { task: 'ship it' },
      deps: engineOptions({ chain, runner: createRunner() }),
    });

    expect(report.status).toBe('warn');
    expect(checkById(report, 'chain:warning:0')?.status).toBe('warn');
    expect(report.acknowledgements.required).toContain(PREFLIGHT_WARNINGS_ACKNOWLEDGEMENT);
  });

  it('warns on unknown input names and never blocks', async () => {
    const report = await preflight({
      inputs: { task: 'ship it', extra: 'ignored' },
      deps: engineOptions({ runner: createRunner() }),
    });

    expect(report.status).toBe('warn');
    expect(checkById(report, 'inputs:unknown')?.status).toBe('warn');
    expect(checkById(report, 'inputs:unknown')?.details).toMatchObject({
      unknown: ['extra'],
    });
  });

  it('requires acknowledgement for ambiguous authentication instead of passing', async () => {
    const runner = createRunner({
      auth: () => ({ exitCode: 0, stdout: '[]', stderr: '' }),
    });
    const deps = engineOptions({ runner });
    const report = await preflight({ deps });

    expect(report.status).toBe('warn');
    expect(report.startAllowed).toBe(false);
    const check = checkById(report, 'authentication');
    expect(check?.status).toBe('acknowledge');
    expect(check?.acknowledgementKey).toBe('authentication:opencode');
    expect(check?.acknowledged).toBe(false);
    expect(report.acknowledgements.required).toEqual(['authentication:opencode']);
    expect(report.acknowledgements.missing).toEqual(['authentication:opencode']);

    const acknowledged = await runPreflight(
      {
        chain: makeChain(),
        projectPath: PROJECT,
        inputs: { task: 'ship it' },
        acknowledgements: ['authentication:opencode'],
      },
      deps,
    );
    expect(acknowledged.status).toBe('warn');
    expect(acknowledged.startAllowed).toBe(true);
    expect(checkById(acknowledged, 'authentication')?.acknowledged).toBe(true);
    expect(acknowledged.acknowledgements.missing).toEqual([]);
  });

  it('requires acknowledgement when an auth command times out', async () => {
    const runner = createRunner({
      auth: () => ({ timedOut: true, exitCode: null, stdout: '', stderr: '' }),
    });
    const report = await preflight({ deps: engineOptions({ runner }) });

    expect(report.status).toBe('warn');
    expect(report.startAllowed).toBe(false);
    expect(checkById(report, 'authentication')?.status).toBe('acknowledge');
    expect(checkById(report, 'authentication')?.details).toMatchObject({
      state: 'unknown',
      reason: 'COMMAND_TIMEOUT',
    });
  });

  it('requires acknowledgement for an unreadable Copilot trust config', async () => {
    const chain = makeChain({ harness: 'copilot' });
    const report = await preflight({
      chain,
      deps: engineOptions({
        chain,
        harness: 'copilot',
        env: { PATH: PATH_ENV, COPILOT_GITHUB_TOKEN: 'present' },
        readFileText: async () => {
          const error = new Error('permission denied') as Error & { code: string };
          error.code = 'EACCES';
          throw error;
        },
        runner: createRunner(),
      }),
    });

    expect(report.status).toBe('warn');
    expect(checkById(report, 'trust')?.status).toBe('acknowledge');
    expect(checkById(report, 'trust')?.details).toMatchObject({
      state: 'unknown',
      reason: 'CONFIG_UNREADABLE',
    });
  });

  it('requires acknowledgement for ambiguous Copilot trust instead of passing', async () => {
    const chain = makeChain({ harness: 'copilot' });
    const deps = engineOptions({
      chain,
      harness: 'copilot',
      env: { PATH: PATH_ENV, COPILOT_GITHUB_TOKEN: 'present' },
      readFileText: async () => '{"trustedFolders": [',
      runner: createRunner(),
    });
    const report = await preflight({ chain, deps });

    expect(report.status).toBe('warn');
    expect(report.startAllowed).toBe(false);
    const check = checkById(report, 'trust');
    expect(check?.status).toBe('acknowledge');
    expect(check?.acknowledgementKey).toBe('trust:copilot');
    expect(report.acknowledgements.missing).toEqual(['trust:copilot']);

    const acknowledged = await runPreflight(
      {
        chain,
        projectPath: PROJECT,
        inputs: { task: 'ship it' },
        acknowledgements: { 'trust:copilot': true },
      },
      deps,
    );
    expect(acknowledged.status).toBe('warn');
    expect(acknowledged.startAllowed).toBe(true);
  });
});

describe('preflight engine: permissions, forks, and redaction', () => {
  it('uses the automatic Copilot flags only after the per-chain opt-in', async () => {
    const chain = makeChain({ harness: 'copilot', automaticPermissionOptIn: true });
    const report = await preflight({
      chain,
      mode: 'automatic',
      deps: engineOptions({
        chain,
        harness: 'copilot',
        env: { PATH: PATH_ENV, COPILOT_GITHUB_TOKEN: 'present' },
        readFileText: async () => JSON.stringify({ trustedFolders: [PROJECT] }),
        runner: createRunner(),
      }),
    });

    expect(report.status).toBe('pass');
    expect(checkById(report, 'permissions')?.status).toBe('pass');
    expect(report.permissions).toMatchObject({
      automatic: true,
      optInRequired: true,
      optInSatisfied: true,
      flags: ['--allow-all-paths', '--allow-all-tools'],
    });
    expect(checkById(report, 'permissions')?.message).toContain('--allow-all-paths');
  });

  it('reports an automatic OpenCode permission plan without broad flags', async () => {
    const report = await preflight({
      mode: 'automatic',
      deps: engineOptions({ runner: createRunner() }),
    });

    expect(report.status).toBe('pass');
    expect(report.permissions).toMatchObject({
      automatic: true,
      required: false,
      flags: [],
    });
  });

  it('plans a native OpenCode fork for automatic runs and a handoff for supervised runs', async () => {
    const forkChain = makeChain({ sessionMode: 'fork' });
    const automatic = await preflight({
      chain: forkChain,
      mode: 'automatic',
      deps: engineOptions({ chain: forkChain, runner: createRunner() }),
    });
    expect(automatic.sessionPlan).toMatchObject({
      sessionMode: 'fork',
      surface: 'headless',
      mechanism: 'native',
    });

    const supervised = await preflight({
      chain: forkChain,
      deps: engineOptions({ chain: forkChain, runner: createRunner() }),
    });
    expect(supervised.sessionPlan).toMatchObject({
      sessionMode: 'fork',
      surface: 'interactive',
      mechanism: 'handoff',
    });
  });

  it('reports a Copilot fork as a handoff on both surfaces', async () => {
    const chain = makeChain({ harness: 'copilot', sessionMode: 'fork' });
    const report = await preflight({
      chain,
      mode: 'automatic',
      deps: engineOptions({
        chain,
        harness: 'copilot',
        env: { PATH: PATH_ENV, COPILOT_GITHUB_TOKEN: 'present' },
        readFileText: async () => JSON.stringify({ trustedFolders: [PROJECT] }),
        runner: createRunner(),
      }),
    });

    expect(report.sessionPlan).toMatchObject({
      sessionMode: 'fork',
      surface: 'headless',
      mechanism: 'handoff',
      nativeFork: false,
    });
    expect(checkById(report, 'fork')?.message).toContain('handoff note');
  });

  it('redacts token-shaped values from every diagnostic field', async () => {
    const strategy: HarnessAuthStrategy = {
      harness: 'opencode',
      environmentVariables: [],
      commands: [
        {
          args: ['auth', 'status'],
          parse: 'status-text',
          description: 'fake status',
        },
      ],
      files: [],
      loginHint: 'Log in.',
    };
    const runner = createRunner({
      auth: () => ({
        exitCode: 1,
        stdout: '',
        stderr:
          'failed authorization: bearer sk-supersecret123456789 token=hunter2 password=letmein',
      }),
    });

    const report = await preflight({
      deps: engineOptions({ runner, authStrategies: [strategy] }),
    });

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('sk-supersecret123456789');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('letmein');
    expect(serialized).toContain('[REDACTED]');
    expect(checkById(report, 'authentication')?.status).toBe('acknowledge');
  });
});
