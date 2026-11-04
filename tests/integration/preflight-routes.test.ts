import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type {
  CatalogResponse,
  CatalogService,
} from '../../src/server/catalog/merge.js';
import {
  SKILL_SOURCES,
  type SkillEntry,
  type SkillHarness,
  type SkillSource,
} from '../../src/server/catalog/types.js';
import type { Chain } from '../../src/server/chains/model.js';
import { createConfigStore, type ConfigStore } from '../../src/server/config/store.js';
import { createHarnessRegistry, type HarnessRegistry } from '../../src/server/harness/registry.js';
import type {
  LocalCommandRequest,
  LocalCommandResult,
  LocalCommandRunner,
} from '../../src/server/preflight/auth.js';
import type { PreflightReport } from '../../src/server/preflight/engine.js';
import type { TrustStartResult, TrustVerifyResult } from '../../src/server/preflight/trust-session.js';
import type {
  CreateTerminalSessionOptions,
  TerminalManager,
  TerminalSession,
  TerminalSpawnSpec,
} from '../../src/server/terminal/pty.js';
import {
  isApiErrorEnvelope,
  type ApiErrorEnvelope,
  type ApiValidationIssue,
} from '../../src/shared/api.js';

const CREATED_AT = '2026-11-04T12:00:00.000Z';

let root: string;
let configDirectory: string;
let home: string;
let fakeBin: string;
let project: string;
let canonicalProject: string;
let trustConfig: string;
let apps: FastifyInstance[];
let terminal: FakeTerminal;

const OPENCODE = (): string => join(fakeBin, 'opencode');
const COPILOT = (): string => join(fakeBin, 'copilot');

interface RecordedSpawn {
  spec: TerminalSpawnSpec;
  options: CreateTerminalSessionOptions | undefined;
}

class FakeTerminal {
  readonly spawns: RecordedSpawn[] = [];
  readonly closed: string[] = [];
  readonly sessions = new Map<string, TerminalSession>();

  createSession(
    spec: TerminalSpawnSpec,
    options: CreateTerminalSessionOptions = {},
  ): TerminalSession {
    const id = options.id ?? `term-fake-${String(this.spawns.length + 1)}`;
    this.spawns.push({ spec, options });
    const session: TerminalSession = {
      id,
      pid: 4_242,
      cols: 120,
      rows: 32,
      write: () => undefined,
      resize: () => undefined,
      onData: () => () => undefined,
      onExit: () => () => undefined,
      getBufferedOutput: () => '',
      getExit: () => null,
      isRunning: () => true,
      kill: () => undefined,
    };
    this.sessions.set(id, session);
    return session;
  }

  getSession(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  closeSession(sessionId: string): void {
    this.closed.push(sessionId);
    this.sessions.delete(sessionId);
  }

  async shutdown(): Promise<void> {
    this.sessions.clear();
  }
}

interface TestRunner {
  runner: LocalCommandRunner;
  calls: LocalCommandRequest[];
}

function createRunner(): TestRunner {
  const calls: LocalCommandRequest[] = [];
  const runner: LocalCommandRunner = async (request) => {
    calls.push(request);

    if (request.args[0] === 'auth') {
      return result({
        exitCode: 0,
        stdout: JSON.stringify([{ id: 'provider', connections: [{ id: 'connection' }] }]),
      });
    }

    if (request.args[0] === 'status' && request.args[1] === '--porcelain') {
      return result({ exitCode: 0, stdout: '' });
    }

    return result({
      exitCode: 127,
      stderr: `unexpected command: ${request.args.join(' ')}`,
    });
  };

  return { runner, calls };
}

function result(partial: Partial<LocalCommandResult>): LocalCommandResult {
  return {
    exitCode: partial.exitCode ?? 0,
    signal: partial.signal ?? null,
    stdout: partial.stdout ?? '',
    stderr: partial.stderr ?? '',
    timedOut: partial.timedOut ?? false,
    spawnError: partial.spawnError ?? null,
  };
}

function entry(harness: SkillHarness, name: string): SkillEntry {
  const source: SkillSource = 'project';
  return {
    id: `${harness}-${source}-${name}`,
    harness,
    source,
    name,
    description: `${name} description`,
    path: join(canonicalProject, '.harness', 'skills', name, 'SKILL.md'),
    packagePath: join(canonicalProject, '.harness', 'skills', name),
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

function fakeCatalog(entries: readonly SkillEntry[]): CatalogService {
  return {
    defaultHarness: 'opencode',
    async getCatalog(request): Promise<CatalogResponse> {
      const matching = entries.filter((item) => item.harness === request.harness);
      const counts = emptyCounts(matching.length);
      for (const item of matching) {
        counts.bySource[item.source] += 1;
      }
      return {
        harness: request.harness,
        query: request.query ?? '',
        total: matching.length,
        counts,
        groups:
          matching.length === 0
            ? []
            : [{ source: 'project', count: matching.length, entries: [...matching] }],
        warnings: [],
        elapsedMs: 1,
      };
    },
  };
}

function harnessRegistry(): HarnessRegistry {
  return createHarnessRegistry({
    env: { PATH: fakeBin },
    isExecutable: (candidate) => candidate === OPENCODE() || candidate === COPILOT(),
  });
}

interface AppHarness {
  app: FastifyInstance;
  projectId: string;
  projectPath: string;
  runner: TestRunner;
  configStore: ConfigStore;
}

async function buildTestApp(options: { runner?: TestRunner } = {}): Promise<AppHarness> {
  const runner = options.runner ?? createRunner();
  const configStore = createConfigStore({
    env: { SLAN_CONFIG_DIR: configDirectory },
    homeDirectory: () => home,
  });
  const app = await buildApp({
    env: {},
    serveStatic: false,
    configStore,
    catalogService: fakeCatalog([
      entry('opencode', 'brainstorm'),
      entry('opencode', 'implement'),
      entry('copilot', 'brainstorm'),
      entry('copilot', 'implement'),
    ]),
    harnessRegistry: harnessRegistry(),
    terminalManager: terminal as unknown as TerminalManager,
    preflightCommandRunner: runner.runner,
    preflightReadFileText: async () => trustConfig,
    preflightHomeDirectory: home,
    preflightEnv: { PATH: fakeBin },
  });
  apps.push(app);

  const projectId = await registerProject(app, project);
  return { app, projectId, projectPath: canonicalProject, runner, configStore };
}

async function registerProject(app: FastifyInstance, directory: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { mode: 'open', path: directory },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ project: { id: string } }>().project.id;
}

async function createChain(
  app: FastifyInstance,
  projectId: string,
  overrides: Record<string, unknown> = {},
): Promise<Chain> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/projects/${encodeURIComponent(projectId)}/chains`,
    payload: {
      name: 'Release chain',
      harness: 'opencode',
      sessionMode: 'shared',
      steps: [
        {
          id: 'step-1',
          skillName: 'brainstorm',
          instruction: 'Plan the release for {{task}}.',
        },
      ],
      inputs: [{ name: 'task', required: true }],
      automaticPermissionOptIn: false,
      ...overrides,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ chain: Chain }>().chain;
}

function preflightUrl(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/preflight`;
}

function trustUrl(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/trust`;
}

async function postPreflight(
  app: FastifyInstance,
  projectId: string,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; body: unknown }> {
  const response = await app.inject({
    method: 'POST',
    url: preflightUrl(projectId),
    payload,
  });
  return { statusCode: response.statusCode, body: response.json<unknown>() };
}

async function postTrust(
  app: FastifyInstance,
  projectId: string,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; body: unknown }> {
  const response = await app.inject({
    method: 'POST',
    url: trustUrl(projectId),
    payload,
  });
  return { statusCode: response.statusCode, body: response.json<unknown>() };
}

function envelope(body: unknown): ApiErrorEnvelope {
  expect(isApiErrorEnvelope(body)).toBe(true);
  if (!isApiErrorEnvelope(body)) {
    throw new Error('Expected the shared API error envelope.');
  }
  expect(body.error.message.length).toBeGreaterThan(0);
  return body;
}

function issuesOf(body: unknown): ApiValidationIssue[] {
  const error = envelope(body);
  const details = error.error.details as { issues?: ApiValidationIssue[] } | undefined;
  return details?.issues ?? [];
}

function noPromptArguments(args: readonly string[]): void {
  expect(args).not.toContain('-i');
  expect(args).not.toContain('-p');
  expect(args).not.toContain('--prompt');
  expect(args).not.toContain('--session');
  expect(args).not.toContain('--session-id');
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'slan-preflight-routes-'));
  configDirectory = join(root, 'config');
  home = join(root, 'home');
  fakeBin = join(root, 'bin');
  project = join(root, 'workspace', 'demo-project');
  apps = [];
  terminal = new FakeTerminal();

  await mkdir(home, { recursive: true });
  await mkdir(fakeBin, { recursive: true });
  await mkdir(project, { recursive: true });

  canonicalProject = await realpath(project);
  trustConfig = JSON.stringify({ trustedFolders: [canonicalProject] });
});

afterEach(async () => {
  for (const app of apps.splice(0)) {
    await app.close();
  }
  await rm(root, { recursive: true, force: true });
});

describe('POST /api/projects/:projectId/preflight', () => {
  it('returns a passing structured report through the composition root', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId);

    const response = await postPreflight(harness.app, harness.projectId, {
      chainId: chain.id,
      harness: 'opencode',
      mode: 'supervised',
      inputs: { task: 'ship it' },
    });

    expect(response.statusCode).toBe(200);
    const report = response.body as PreflightReport;
    expect(report.status).toBe('pass');
    expect(report.startAllowed).toBe(true);
    expect(report.chain).toEqual({ id: chain.id, name: 'Release chain', stepCount: 1 });
    expect(report.harness).toBe('opencode');
    expect(report.resolvedInputs).toEqual({ task: 'ship it' });
    expect(report.skills).toHaveLength(1);
    expect(report.skills[0]).toMatchObject({ stepId: 'step-1', resolved: true });
    expect(report.acknowledgements).toEqual({ required: [], provided: [], missing: [] });
    expect(report.checks.some((check) => check.key === 'authentication' && check.status === 'pass')).toBe(
      true,
    );

    // Preflight may run only static evidence commands and git status.
    for (const call of harness.runner.calls) {
      noPromptArguments(call.args);
    }
    expect(harness.runner.calls.some((call) => call.args[0] === 'auth')).toBe(true);
  });

  it('returns a blocked report when a step skill is unresolved', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId, {
      steps: [
        {
          id: 'step-1',
          skillName: 'not-installed',
          instruction: 'Use {{task}}.',
        },
      ],
    });

    const response = await postPreflight(harness.app, harness.projectId, {
      chainId: chain.id,
      inputs: { task: 'ship it' },
    });

    expect(response.statusCode).toBe(200);
    const report = response.body as PreflightReport;
    expect(report.status).toBe('blocked');
    expect(report.startAllowed).toBe(false);
    const skillCheck = report.checks.find((check) => check.key === 'skill:step-1');
    expect(skillCheck?.status).toBe('block');
    expect(skillCheck?.message).toContain('not-installed');
    expect(report.skills[0]?.resolved).toBe(false);
  });

  it('requires explicit acknowledgements for ambiguous auth and trust', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId, {
      harness: 'copilot',
      steps: [
        {
          id: 'step-1',
          skillName: 'brainstorm',
          instruction: 'Plan the release for {{task}}.',
        },
      ],
    });

    // Invalid JSON makes Copilot trust ambiguous rather than untrusted.
    trustConfig = '{"trustedFolders": [';
    // No Copilot token in the environment makes authentication ambiguous.

    const withoutAcknowledgement = await postPreflight(harness.app, harness.projectId, {
      chainId: chain.id,
      harness: 'copilot',
      inputs: { task: 'ship it' },
    });

    expect(withoutAcknowledgement.statusCode).toBe(200);
    const warned = withoutAcknowledgement.body as PreflightReport;
    expect(warned.status).toBe('warn');
    expect(warned.startAllowed).toBe(false);
    expect(warned.acknowledgements.missing.sort()).toEqual([
      'authentication:copilot',
      'trust:copilot',
    ]);
    expect(warned.checks.find((check) => check.key === 'authentication')?.status).toBe(
      'acknowledge',
    );
    expect(warned.checks.find((check) => check.key === 'trust')?.status).toBe('acknowledge');

    const acknowledged = await postPreflight(harness.app, harness.projectId, {
      chainId: chain.id,
      harness: 'copilot',
      inputs: { task: 'ship it' },
      acknowledgements: ['authentication:copilot', 'trust:copilot'],
    });

    expect(acknowledged.statusCode).toBe(200);
    const allowed = acknowledged.body as PreflightReport;
    expect(allowed.status).toBe('warn');
    expect(allowed.startAllowed).toBe(true);
    expect(allowed.acknowledgements.missing).toEqual([]);
  });

  it('rejects invalid project, chain, harness, and mode with the shared envelope', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId);

    const badProject = await postPreflight(harness.app, 'NOT_A_PROJECT_ID', {
      chainId: chain.id,
    });
    expect(badProject.statusCode).toBe(422);
    expect(envelope(badProject.body).error.code).toBe('PREFLIGHT_PROJECT_ID_INVALID');

    const missingProject = await postPreflight(harness.app, 'missing-abcdefabcdef', {
      chainId: chain.id,
    });
    expect(missingProject.statusCode).toBe(404);
    expect(envelope(missingProject.body).error.code).toBe('PREFLIGHT_PROJECT_NOT_FOUND');

    const badChainId = await postPreflight(harness.app, harness.projectId, {
      chainId: '../escape',
    });
    expect(badChainId.statusCode).toBe(422);
    expect(envelope(badChainId.body).error.code).toBe('CHAIN_ID_INVALID');

    const missingChain = await postPreflight(harness.app, harness.projectId, {
      chainId: 'does-not-exist',
    });
    expect(missingChain.statusCode).toBe(404);
    expect(envelope(missingChain.body).error.code).toBe('CHAIN_NOT_FOUND');

    const badHarness = await postPreflight(harness.app, harness.projectId, {
      chainId: chain.id,
      harness: 'other-harness',
    });
    expect(badHarness.statusCode).toBe(422);
    expect(envelope(badHarness.body).error.code).toBe('VALIDATION_ERROR');
    expect(issuesOf(badHarness.body).map((issue) => issue.path)).toContain('harness');

    const badMode = await postPreflight(harness.app, harness.projectId, {
      chainId: chain.id,
      mode: 'turbo',
    });
    expect(badMode.statusCode).toBe(422);
    expect(envelope(badMode.body).error.code).toBe('VALIDATION_ERROR');
    expect(issuesOf(badMode.body).map((issue) => issue.path)).toContain('mode');

    const missingChainId = await postPreflight(harness.app, harness.projectId, {});
    expect(missingChainId.statusCode).toBe(422);
    expect(issuesOf(missingChainId.body).map((issue) => issue.path)).toContain('chainId');
  });
});

describe('POST /api/projects/:projectId/trust', () => {
  it('starts an unseeded interactive trust session with no prompt argument', async () => {
    const harness = await buildTestApp();

    const response = await postTrust(harness.app, harness.projectId, {
      action: 'start',
      harness: 'copilot',
    });

    expect(response.statusCode).toBe(200);
    const started = response.body as TrustStartResult;
    expect(started.action).toBe('start');
    expect(started.harness).toBe('copilot');
    expect(started.projectPath).toBe(canonicalProject);
    expect(started.sessionId).toMatch(/^trust_/);
    expect(started.terminalPath).toBe(`/api/terminal/${encodeURIComponent(started.sessionId)}`);
    expect(started.manualCommand).toEqual({
      harness: 'copilot',
      executable: COPILOT(),
      args: ['-C', canonicalProject],
      cwd: canonicalProject,
    });
    expect(started.manualCommandText).toContain('-C');

    expect(terminal.spawns).toHaveLength(1);
    const spawn = terminal.spawns[0]!;
    expect(spawn.spec.executable).toBe(COPILOT());
    expect(spawn.spec.args).toEqual(['-C', canonicalProject]);
    expect(spawn.spec.cwd).toBe(canonicalProject);
    expect(spawn.options?.id).toBe(started.sessionId);
    noPromptArguments(spawn.spec.args);
  });

  it('verifies a newly trusted folder and closes the trust session', async () => {
    const harness = await buildTestApp();
    const start = await postTrust(harness.app, harness.projectId, {
      action: 'start',
      harness: 'copilot',
    });
    const started = start.body as TrustStartResult;

    trustConfig = JSON.stringify({ trustedFolders: [canonicalProject] });
    const response = await postTrust(harness.app, harness.projectId, {
      action: 'verify',
      harness: 'copilot',
      sessionId: started.sessionId,
    });

    expect(response.statusCode).toBe(200);
    const verified = response.body as TrustVerifyResult;
    expect(verified.action).toBe('verify');
    expect(verified.trusted).toBe(true);
    expect(verified.state).toBe('trusted');
    expect(verified.sessionId).toBe(started.sessionId);
    expect(verified.closed).toBe(true);
    expect(verified.configPath).toBe(join(home, '.copilot', 'config.json'));
    expect(verified.manualCommand).not.toBeNull();

    expect(terminal.closed).toEqual([started.sessionId]);
    expect(terminal.getSession(started.sessionId)).toBeUndefined();
  });

  it('returns the exact manual fallback and keeps the session when trust is absent', async () => {
    const harness = await buildTestApp();
    const start = await postTrust(harness.app, harness.projectId, {
      action: 'start',
      harness: 'copilot',
    });
    const started = start.body as TrustStartResult;

    trustConfig = JSON.stringify({ trustedFolders: [join(root, 'somewhere-else')] });
    const response = await postTrust(harness.app, harness.projectId, {
      action: 'verify',
      harness: 'copilot',
      sessionId: started.sessionId,
    });

    expect(response.statusCode).toBe(200);
    const verified = response.body as TrustVerifyResult;
    expect(verified.trusted).toBe(false);
    expect(verified.state).toBe('untrusted');
    expect(verified.closed).toBe(false);
    expect(verified.remediation.length).toBeGreaterThan(0);
    expect(verified.manualCommand).toEqual({
      harness: 'copilot',
      executable: COPILOT(),
      args: ['-C', canonicalProject],
      cwd: canonicalProject,
    });
    expect(verified.manualCommandText).toBe(`${COPILOT()} -C ${canonicalProject}`);

    expect(terminal.closed).toEqual([]);
    expect(terminal.getSession(started.sessionId)).toBeDefined();
  });

  it('rejects an unsupported trust harness and invalid project with the envelope', async () => {
    const harness = await buildTestApp();

    const unsupported = await postTrust(harness.app, harness.projectId, {
      action: 'start',
      harness: 'opencode',
    });
    expect(unsupported.statusCode).toBe(422);
    expect(envelope(unsupported.body).error.code).toBe('TRUST_NOT_SUPPORTED');

    const invalidProject = await postTrust(harness.app, 'NOT_A_PROJECT_ID', {
      action: 'start',
      harness: 'copilot',
    });
    expect(invalidProject.statusCode).toBe(422);
    expect(envelope(invalidProject.body).error.code).toBe('PREFLIGHT_PROJECT_ID_INVALID');

    const missingProject = await postTrust(harness.app, 'missing-abcdefabcdef', {
      action: 'verify',
      harness: 'copilot',
    });
    expect(missingProject.statusCode).toBe(404);
    expect(envelope(missingProject.body).error.code).toBe('PREFLIGHT_PROJECT_NOT_FOUND');

    const badAction = await postTrust(harness.app, harness.projectId, {
      action: 'cancel',
      harness: 'copilot',
    });
    expect(badAction.statusCode).toBe(422);
    expect(envelope(badAction.body).error.code).toBe('VALIDATION_ERROR');
  });
});
