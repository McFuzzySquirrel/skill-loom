import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
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
import { createConfigStore } from '../../src/server/config/store.js';
import {
  createHarnessRegistry,
  type HarnessRegistry,
} from '../../src/server/harness/registry.js';
import type {
  LocalCommandRequest,
  LocalCommandResult,
  LocalCommandRunner,
} from '../../src/server/preflight/auth.js';
import type {
  RunActiveState,
  RunStreamMessage,
  RunView,
} from '../../src/server/runs/orchestrator.js';
import type { Run } from '../../src/server/runs/model.js';
import type {
  CreateTerminalSessionOptions,
  TerminalExit,
  TerminalManager,
  TerminalSession,
  TerminalSpawnSpec,
} from '../../src/server/terminal/pty.js';
import {
  isApiErrorEnvelope,
  type ApiErrorEnvelope,
} from '../../src/shared/api.js';

const CREATED_AT = '2026-11-04T12:00:00.000Z';
const RUN_ID_PATTERN = /^run-test-\d+$/;
const TERMINAL_ID_PREFIX = 'slan_run_';
const OSC_WORKING = '\x1b]7501;state=working\x07';
const OSC_IDLE = '\x1b]7501;state=idle\x07';

let root: string;
let configDirectory: string;
let home: string;
let fakeBin: string;
let project: string;
let canonicalProject: string;
let trustConfig: string;
let apps: FastifyInstance[];
let terminal: FakeTerminalManager;
let runCounter: number;
let sessionCounter: number;

const OPENCODE = (): string => join(fakeBin, 'opencode');
const COPILOT = (): string => join(fakeBin, 'copilot');

interface RecordedSpawn {
  spec: TerminalSpawnSpec;
  options: CreateTerminalSessionOptions | undefined;
}

class FakeTerminalSession implements TerminalSession {
  readonly id: string;
  readonly pid = 4_242;
  readonly cols = 120;
  readonly rows = 32;
  private readonly dataListeners = new Set<(chunk: string) => void>();
  private readonly exitListeners = new Set<(event: TerminalExit) => void>();
  private exitEvent: TerminalExit | null = null;

  constructor(id: string) {
    this.id = id;
  }

  write(): void {
    // Keystrokes are intentionally ignored; supervised advancement is explicit.
  }

  resize(): void {
    // Fixed test geometry.
  }

  onData(listener: (chunk: string) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onExit(listener: (event: TerminalExit) => void): () => void {
    if (this.exitEvent !== null) {
      const event = this.exitEvent;
      queueMicrotask(() => listener(event));
      return () => undefined;
    }
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  getBufferedOutput(): string {
    return '';
  }

  getExit(): TerminalExit | null {
    return this.exitEvent;
  }

  isRunning(): boolean {
    return this.exitEvent === null;
  }

  kill(): void {
    this.finish({ exitCode: 0 });
  }

  emitData(chunk: string): void {
    if (this.exitEvent !== null) {
      return;
    }
    for (const listener of [...this.dataListeners]) {
      listener(chunk);
    }
  }

  finish(event: TerminalExit): void {
    if (this.exitEvent !== null) {
      return;
    }
    this.exitEvent = event;
    const listeners = [...this.exitListeners];
    this.exitListeners.clear();
    for (const listener of listeners) {
      listener(event);
    }
  }
}

class FakeTerminalManager {
  readonly spawns: RecordedSpawn[] = [];
  readonly closed: string[] = [];
  readonly sessions = new Map<string, FakeTerminalSession>();

  createSession(
    spec: TerminalSpawnSpec,
    options: CreateTerminalSessionOptions = {},
  ): TerminalSession {
    const id = options.id ?? `term-fake-${String(this.spawns.length + 1)}`;
    if (this.sessions.has(id)) {
      throw new Error(`duplicate terminal id ${id}`);
    }
    this.spawns.push({ spec, options });
    const session = new FakeTerminalSession(id);
    this.sessions.set(id, session);
    return session as unknown as TerminalSession;
  }

  getSession(sessionId: string): FakeTerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      return;
    }
    this.closed.push(sessionId);
    session.kill();
    this.sessions.delete(sessionId);
  }

  get size(): number {
    return this.sessions.size;
  }

  attach(): never {
    throw new Error('The run tests do not attach the terminal route.');
  }

  async shutdown(): Promise<void> {
    for (const sessionId of [...this.sessions.keys()]) {
      this.closeSession(sessionId);
    }
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
  baseUrl: string;
}

async function buildTestApp(options: { extraEnv?: NodeJS.ProcessEnv } = {}): Promise<AppHarness> {
  const runner = createRunner();
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
      entry('opencode', 'review'),
      entry('copilot', 'brainstorm'),
      entry('copilot', 'implement'),
    ]),
    harnessRegistry: harnessRegistry(),
    terminalManager: terminal as unknown as TerminalManager,
    preflightCommandRunner: runner.runner,
    preflightReadFileText: async () => trustConfig,
    preflightHomeDirectory: home,
    preflightEnv: { PATH: fakeBin, ...(options.extraEnv ?? {}) },
    runNow: () => new Date(CREATED_AT),
    runCreateRunId: () => `run-test-${String(++runCounter)}`,
    runCreateSessionId: () => `ses_test_${String(++sessionCounter)}`,
  });
  apps.push(app);

  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected a loopback TCP address.');
  }
  const baseUrl = `ws://127.0.0.1:${String((address as AddressInfo).port)}`;

  const projectId = await registerProject(app, project);
  return { app, projectId, projectPath: canonicalProject, runner, baseUrl };
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
          id: 'step-plan',
          skillName: 'brainstorm',
          instruction: 'Plan the release for {{task}}.',
          label: 'Plan',
        },
        {
          id: 'step-build',
          skillName: 'implement',
          instruction: 'Implement the release for {{task}}.',
          label: 'Build',
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

function runsUrl(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/runs`;
}

function runUrl(runId: string): string {
  return `/api/runs/${encodeURIComponent(runId)}`;
}

async function postRun(
  app: FastifyInstance,
  projectId: string,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; body: unknown }> {
  const response = await app.inject({
    method: 'POST',
    url: runsUrl(projectId),
    payload,
  });
  return { statusCode: response.statusCode, body: response.json<unknown>() };
}

async function getRunRecord(
  app: FastifyInstance,
  runId: string,
): Promise<{ statusCode: number; body: unknown }> {
  const response = await app.inject({ method: 'GET', url: runUrl(runId) });
  return { statusCode: response.statusCode, body: response.json<unknown>() };
}

async function getActiveRun(
  app: FastifyInstance,
): Promise<{ statusCode: number; body: unknown }> {
  const response = await app.inject({ method: 'GET', url: '/api/runs/active' });
  return { statusCode: response.statusCode, body: response.json<unknown>() };
}

async function postAction(
  app: FastifyInstance,
  runId: string,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; body: unknown }> {
  const response = await app.inject({
    method: 'POST',
    url: `${runUrl(runId)}/actions`,
    payload,
  });
  return { statusCode: response.statusCode, body: response.json<unknown>() };
}

async function createRun(
  app: FastifyInstance,
  projectId: string,
  chain: Chain,
  overrides: Record<string, unknown> = {},
): Promise<Run> {
  const response = await postRun(app, projectId, {
    chainId: chain.id,
    inputs: { task: 'ship it' },
    ...overrides,
  });
  expect(response.statusCode).toBe(201);
  return (response.body as { run: Run }).run;
}

function envelope(body: unknown): ApiErrorEnvelope {
  expect(isApiErrorEnvelope(body)).toBe(true);
  if (!isApiErrorEnvelope(body)) {
    throw new Error('Expected the shared API error envelope.');
  }
  expect(body.error.message.length).toBeGreaterThan(0);
  return body;
}

function runView(body: unknown): RunView {
  return body as RunView;
}

function terminalIdFor(runId: string): string {
  return `${TERMINAL_ID_PREFIX}${runId}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

async function waitFor<T>(
  check: () => Promise<T | null | false | undefined>,
  description: string,
  timeoutMs = 2_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== null && value !== undefined && value !== false) {
      return value;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${description}.`);
    }
    await delay(10);
  }
}

async function waitForRunStatus(
  app: FastifyInstance,
  runId: string,
  status: Run['status'],
): Promise<Run> {
  return waitFor(async () => {
    const response = await getRunRecord(app, runId);
    if (response.statusCode !== 200) {
      return null;
    }
    const run = (response.body as { run: Run }).run;
    return run.status === status ? run : null;
  }, `run ${runId} status ${status}`);
}

/* ------------------------------------------------------------------ */
/* Minimal WebSocket client used to assert snapshot-first ordering     */
/* ------------------------------------------------------------------ */

interface SocketMessageEvent {
  data: unknown;
}

interface TestSocket {
  readonly readyState: number;
  addEventListener(type: 'message', listener: (event: SocketMessageEvent) => void): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'close', listener: () => void): void;
  addEventListener(type: 'error', listener: (event: unknown) => void): void;
  send(data: string): void;
  close(): void;
}

type SocketConstructor = new (url: string) => TestSocket;

class RunEventSocket {
  private readonly socket: TestSocket;
  private readonly queue: RunStreamMessage[] = [];
  private readonly waiters: Array<(message: RunStreamMessage) => void> = [];
  private closed = false;

  private constructor(socket: TestSocket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const text = typeof event.data === 'string' ? event.data : '';
      if (text === '') {
        return;
      }
      const message = JSON.parse(text) as RunStreamMessage;
      if (this.waiters.length > 0) {
        this.waiters.shift()?.(message);
      } else {
        this.queue.push(message);
      }
    });
    socket.addEventListener('close', () => {
      this.closed = true;
    });
  }

  static async connect(url: string): Promise<RunEventSocket> {
    const WebSocketClient = (
      globalThis as unknown as { WebSocket?: SocketConstructor }
    ).WebSocket;
    if (WebSocketClient === undefined) {
      throw new Error('This Node runtime does not provide a WebSocket client.');
    }

    const socket = new WebSocketClient(url);
    await new Promise<void>((resolveOpen, rejectOpen) => {
      const timer = setTimeout(() => rejectOpen(new Error('WebSocket open timed out.')), 2_000);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolveOpen();
      });
      socket.addEventListener('error', (event) => {
        clearTimeout(timer);
        rejectOpen(event);
      });
    });
    return new RunEventSocket(socket);
  }

  next(timeoutMs = 2_000): Promise<RunStreamMessage> {
    const queued = this.queue.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    if (this.closed) {
      return Promise.reject(new Error('Run event socket closed before the next message.'));
    }
    return new Promise<RunStreamMessage>((resolveMessage, rejectMessage) => {
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(onMessage);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        rejectMessage(new Error('Timed out waiting for a run event.'));
      }, timeoutMs);
      const onMessage = (message: RunStreamMessage): void => {
        clearTimeout(timer);
        resolveMessage(message);
      };
      this.waiters.push(onMessage);
    });
  }

  close(): void {
    this.socket.close();
  }
}

function eventsUrl(baseUrl: string, runId: string): string {
  return `${baseUrl}/api/runs/${encodeURIComponent(runId)}/events`;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'slan-run-routes-'));
  configDirectory = join(root, 'config');
  home = join(root, 'home');
  fakeBin = join(root, 'bin');
  project = join(root, 'workspace', 'demo-project');
  apps = [];
  terminal = new FakeTerminalManager();
  runCounter = 0;
  sessionCounter = 0;

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

describe('POST /api/projects/:projectId/runs', () => {
  it('re-runs preflight, snapshots the chain, and starts a supervised run', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId);

    const run = await createRun(harness.app, harness.projectId, chain, {
      mode: 'supervised',
      harness: 'opencode',
    });

    expect(run.id).toMatch(RUN_ID_PATTERN);
    expect(run.status).toBe('awaiting-user');
    expect(run.chainId).toBe(chain.id);
    expect(run.mode).toBe('supervised');
    expect(run.resolvedInputs).toEqual({ task: 'ship it' });
    expect(run.chainSnapshot).toEqual(chain);
    expect(run.steps.map((step) => step.status)).toEqual(['running', 'pending']);
    expect(terminal.sessions.has(terminalIdFor(run.id))).toBe(true);

    // The frozen snapshot is independent of the editable chain.
    const edited = await harness.app.inject({
      method: 'PUT',
      url: `/api/projects/${encodeURIComponent(harness.projectId)}/chains/${encodeURIComponent(chain.id)}`,
      payload: {
        name: 'Edited chain',
        harness: 'opencode',
        sessionMode: 'shared',
        steps: [
          {
            id: 'step-plan',
            skillName: 'brainstorm',
            instruction: 'Edited instruction for {{task}}.',
          },
        ],
        inputs: [{ name: 'task', required: true }],
      },
    });
    expect(edited.statusCode).toBe(200);
    const stored = await getRunRecord(harness.app, run.id);
    const storedView = stored.body as RunView;
    expect(storedView.run.chainSnapshot.name).toBe('Release chain');
    expect(storedView.terminalId).toBe(terminalIdFor(run.id));

    const activeResponse = await getActiveRun(harness.app);
    expect(activeResponse.statusCode).toBe(200);
    const active = activeResponse.body as RunActiveState;
    expect(active.active).toBe(true);
    expect(active.runId).toBe(run.id);
    expect(active.status).toBe('awaiting-user');
    expect(active.terminalId).toBe(terminalIdFor(run.id));
  });

  it('rejects a blocked preflight report and creates no run', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId, {
      steps: [
        {
          id: 'step-plan',
          skillName: 'not-installed',
          instruction: 'Use {{task}}.',
        },
      ],
    });

    const response = await postRun(harness.app, harness.projectId, {
      chainId: chain.id,
      inputs: { task: 'ship it' },
    });

    expect(response.statusCode).toBe(409);
    const error = envelope(response.body);
    expect(error.error.code).toBe('RUN_PREFLIGHT_BLOCKED');
    const details = error.error.details as { report?: { status: string; startAllowed: boolean } };
    expect(details.report?.status).toBe('blocked');
    expect(details.report?.startAllowed).toBe(false);

    const active = (await getActiveRun(harness.app)).body as RunActiveState;
    expect(active.active).toBe(false);
    expect(terminal.sessions.size).toBe(0);
  });

  it('rejects a second active run with 409 before starting another step', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId);
    const first = await createRun(harness.app, harness.projectId, chain);

    const second = await postRun(harness.app, harness.projectId, {
      chainId: chain.id,
      inputs: { task: 'second' },
    });

    expect(second.statusCode).toBe(409);
    expect(envelope(second.body).error.code).toBe('RUN_ACTIVE_CONFLICT');

    // The safe exit is explicit abort, which also releases the PTY.
    const aborted = await postAction(harness.app, first.id, { action: 'abort' });
    expect(aborted.statusCode).toBe(200);
    expect(runView(aborted.body).run.status).toBe('aborted');
    expect(terminal.closed).toContain(terminalIdFor(first.id));

    const active = (await getActiveRun(harness.app)).body as RunActiveState;
    expect(active.active).toBe(false);
  });

  it('rejects an invalid project, chain, mode, and body with the shared envelope', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId);

    const badProject = await postRun(harness.app, 'NOT_A_PROJECT', { chainId: chain.id });
    expect(badProject.statusCode).toBe(422);
    expect(envelope(badProject.body).error.code).toBe('RUN_PROJECT_ID_INVALID');

    const missingProject = await postRun(harness.app, 'missing-abcdefabcdef', {
      chainId: chain.id,
    });
    expect(missingProject.statusCode).toBe(404);
    expect(envelope(missingProject.body).error.code).toBe('RUN_PROJECT_NOT_FOUND');

    const badChain = await postRun(harness.app, harness.projectId, { chainId: '../escape' });
    expect(badChain.statusCode).toBe(422);
    expect(envelope(badChain.body).error.code).toBe('CHAIN_ID_INVALID');

    const missingChain = await postRun(harness.app, harness.projectId, {
      chainId: 'does-not-exist',
    });
    expect(missingChain.statusCode).toBe(404);
    expect(envelope(missingChain.body).error.code).toBe('CHAIN_NOT_FOUND');

    const badMode = await postRun(harness.app, harness.projectId, {
      chainId: chain.id,
      mode: 'turbo',
    });
    expect(badMode.statusCode).toBe(422);
    expect(envelope(badMode.body).error.code).toBe('VALIDATION_ERROR');

    const missingChainId = await postRun(harness.app, harness.projectId, {});
    expect(missingChainId.statusCode).toBe(422);
    expect(envelope(missingChainId.body).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/runs and POST /api/runs/:runId/actions', () => {
  it('applies explicit supervised outcomes and cleans up the PTY on completion', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId);
    const run = await createRun(harness.app, harness.projectId, chain);

    const done = await postAction(harness.app, run.id, { action: 'done' });
    expect(done.statusCode).toBe(200);
    let view = runView(done.body);
    expect(view.run.steps[0]?.status).toBe('done');
    expect(view.actions.next).toBe(true);

    const advanced = await postAction(harness.app, run.id, { action: 'next' });
    expect(advanced.statusCode).toBe(200);
    view = runView(advanced.body);
    expect(view.run.currentStepIndex).toBe(1);
    expect(view.run.steps[1]?.status).toBe('running');
    expect(view.run.status).toBe('awaiting-user');

    const secondDone = await postAction(harness.app, run.id, { action: 'done' });
    expect(secondDone.statusCode).toBe(200);

    const completed = await postAction(harness.app, run.id, { action: 'next' });
    expect(completed.statusCode).toBe(200);
    view = runView(completed.body);
    expect(view.run.status).toBe('completed');
    expect(view.run.finishedAt).not.toBeNull();
    expect(view.actions).toMatchObject({
      next: false,
      done: false,
      retry: false,
      abort: false,
    });

    // Completion closes the run PTY and releases the global slot.
    expect(terminal.closed).toContain(terminalIdFor(run.id));
    expect(terminal.sessions.has(terminalIdFor(run.id))).toBe(false);
    const active = (await getActiveRun(harness.app)).body as RunActiveState;
    expect(active.active).toBe(false);

    const stored = await getRunRecord(harness.app, run.id);
    expect((stored.body as { run: Run }).run.status).toBe('completed');
  });

  it('returns typed mode-inappropriate and unknown action failures', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId);
    const run = await createRun(harness.app, harness.projectId, chain);

    const pause = await postAction(harness.app, run.id, { action: 'pause' });
    expect(pause.statusCode).toBe(409);
    const pauseError = envelope(pause.body);
    expect(pauseError.error.code).toBe('RUN_ACTION_MODE_MISMATCH');
    const details = pauseError.error.details as { mode?: string; supported?: string[] };
    expect(details.mode).toBe('supervised');
    expect(details.supported).toContain('done');
    expect(details.supported).not.toContain('pause');

    const unknown = await postAction(harness.app, run.id, { action: 'teleport' });
    expect(unknown.statusCode).toBe(422);
    expect(envelope(unknown.body).error.code).toBe('RUN_ACTION_INVALID');

    const badRun = await postAction(harness.app, 'NOT_SAFE!', { action: 'next' });
    expect(badRun.statusCode).toBe(422);
    expect(envelope(badRun.body).error.code).toBe('RUN_ID_INVALID');

    const missingRun = await postAction(harness.app, 'run-missing', { action: 'next' });
    expect(missingRun.statusCode).toBe(404);
    expect(envelope(missingRun.body).error.code).toBe('RUN_NOT_FOUND');
  });

  it('streams a snapshot first, then ordered state deltas, and resnapshots on reconnect', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId);
    const run = await createRun(harness.app, harness.projectId, chain);

    let initialSequence = 0;
    const socket = await RunEventSocket.connect(eventsUrl(harness.baseUrl, run.id));
    try {
      const snapshot = await socket.next();
      expect(snapshot.type).toBe('snapshot');
      if (snapshot.type !== 'snapshot') {
        throw new Error('Expected a snapshot.');
      }
      initialSequence = snapshot.sequence;
      expect(snapshot.run.id).toBe(run.id);
      expect(snapshot.run.status).toBe('awaiting-user');
      expect(snapshot.terminalId).toBe(terminalIdFor(run.id));
      expect(snapshot.sequence).toBeGreaterThanOrEqual(3);
      expect(snapshot.actions.done).toBe(true);
      expect(snapshot.recovery).toBeNull();

      const done = await postAction(harness.app, run.id, { action: 'done' });
      expect(done.statusCode).toBe(200);

      const deltas: RunStreamMessage[] = [];
      for (let index = 0; index < 2; index += 1) {
        deltas.push(await socket.next());
      }
      const types = deltas.map((message) => message.type);
      expect(types).toContain('step-done');
      const sequences = deltas.map((message) => {
        if (message.type === 'snapshot') {
          throw new Error('A delta must not be a snapshot.');
        }
        return message.sequence;
      });
      expect(sequences).toEqual([...sequences].sort((left, right) => left - right));
      expect(sequences.every((sequence) => sequence > snapshot.sequence)).toBe(true);

      const advanced = await postAction(harness.app, run.id, { action: 'next' });
      expect(advanced.statusCode).toBe(200);
      const afterNext = await socket.next();
      expect(afterNext.type).toBe('step-advanced');
      const stepStarted = await socket.next();
      expect(stepStarted.type).toBe('step-started');
      const awaiting = await socket.next();
      expect(awaiting.type).toBe('awaiting-user');
    } finally {
      socket.close();
    }

    // Reconnect: a full snapshot is delivered before any new delta.
    const aborted = await postAction(harness.app, run.id, { action: 'abort' });
    expect(aborted.statusCode).toBe(200);

    const reconnected = await RunEventSocket.connect(eventsUrl(harness.baseUrl, run.id));
    try {
      const nextSnapshot = await reconnected.next();
      expect(nextSnapshot.type).toBe('snapshot');
      if (nextSnapshot.type !== 'snapshot') {
        throw new Error('Expected a reconnect snapshot.');
      }
      expect(nextSnapshot.run.status).toBe('aborted');
      expect(nextSnapshot.sequence).toBeGreaterThan(initialSequence);
      expect(nextSnapshot.recovery).toBeNull();
    } finally {
      reconnected.close();
    }
  });

  it('advances an automatic run only on the declared signal and cleans up at the end', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId);
    const run = await createRun(harness.app, harness.projectId, chain, {
      mode: 'automatic',
    });

    expect(run.status).toBe('running');
    expect(run.steps[0]?.status).toBe('running');

    const firstTerminal = await waitFor(
      async () => terminal.sessions.get(terminalIdFor(run.id)) ?? null,
      'the automatic run PTY',
    );
    firstTerminal.emitData(OSC_WORKING);
    // Idle-only output must not advance; only working followed by idle does.
    firstTerminal.emitData(OSC_IDLE);

    await waitFor(async () => {
      const response = await getRunRecord(harness.app, run.id);
      const current = (response.body as { run: Run }).run;
      return current.currentStepIndex === 1 && current.steps[0]?.status === 'done'
        ? current
        : null;
    }, 'the first automatic step to advance');

    const secondTerminal = await waitFor(
      async () => terminal.sessions.get(terminalIdFor(run.id)) ?? null,
      'the second automatic step PTY',
    );
    secondTerminal.emitData(OSC_WORKING);
    secondTerminal.emitData(OSC_IDLE);

    const completed = await waitForRunStatus(harness.app, run.id, 'completed');
    expect(completed.steps.map((step) => step.status)).toEqual(['done', 'done']);
    expect(completed.steps.every((step) => step.reason === 'COMPLETION_SIGNAL')).toBe(true);
    expect(terminal.closed).toContain(terminalIdFor(run.id));
    expect(terminal.sessions.has(terminalIdFor(run.id))).toBe(false);

    const active = (await getActiveRun(harness.app)).body as RunActiveState;
    expect(active.active).toBe(false);
  });
});

describe('interrupted run recovery', () => {
  async function simulateRestart(): Promise<{
    first: AppHarness;
    second: AppHarness;
    chain: Chain;
    run: Run;
  }> {
    const first = await buildTestApp();
    const chain = await createChain(first.app, first.projectId);
    const run = await createRun(first.app, first.projectId, chain);

    // Close the first server without aborting the record. The next buildApp
    // performs startup recovery exactly like a real restart.
    const index = apps.indexOf(first.app);
    if (index >= 0) {
      apps.splice(index, 1);
    }
    await first.app.close();

    const second = await buildTestApp();
    const recovered = await waitForRunStatus(second.app, run.id, 'interrupted');
    return { first, second, chain, run: recovered };
  }

  it('offers retry, continue, and restart for an interrupted run without auto-replay', async () => {
    const scenario = await simulateRestart();
    const { second, run } = scenario;

    const interrupted = await getRunRecord(second.app, run.id);
    expect(interrupted.statusCode).toBe(200);
    const recovered = (interrupted.body as { run: Run }).run;
    expect(recovered.status).toBe('interrupted');
    expect(recovered.steps[0]?.status).toBe('interrupted');
    expect(recovered.steps[1]?.status).toBe('pending');

    const active = (await getActiveRun(second.app)).body as RunActiveState;
    expect(active.active).toBe(false);

    // `next` cannot replay an interrupted run; recovery is explicit.
    const next = await postAction(second.app, run.id, { action: 'next' });
    expect(next.statusCode).toBe(409);
    expect(envelope(next.body).error.code).toBe('RUN_ACTION_NOT_ALLOWED');
    const nextError = envelope(next.body).error.details as { supported?: string[] };
    expect(nextError.supported).toEqual(['retry', 'continue', 'restart']);

    // Retry re-runs the interrupted step in the same run record.
    const retried = await postAction(second.app, run.id, { action: 'retry' });
    expect(retried.statusCode).toBe(200);
    const retryView = runView(retried.body);
    expect(retryView.run.id).toBe(run.id);
    expect(retryView.run.status).toBe('awaiting-user');
    expect(retryView.run.currentStepIndex).toBe(0);
    expect(retryView.run.steps[0]?.status).toBe('running');
    expect(retryView.run.steps[1]?.status).toBe('pending');
    expect(retryView.actions.done).toBe(true);

    const aborted = await postAction(second.app, run.id, { action: 'abort' });
    expect(aborted.statusCode).toBe(200);

    // A second interrupted run can continue from the next pending step.
    const continued = await simulateRestart();
    const continueResponse = await postAction(continued.second.app, continued.run.id, {
      action: 'continue',
    });
    expect(continueResponse.statusCode).toBe(200);
    const continueView = runView(continueResponse.body);
    expect(continueView.run.id).toBe(continued.run.id);
    expect(continueView.run.status).toBe('awaiting-user');
    expect(continueView.run.currentStepIndex).toBe(1);
    expect(continueView.run.steps[0]?.status).toBe('interrupted');
    expect(continueView.run.steps[1]?.status).toBe('running');

    const continueAbort = await postAction(continued.second.app, continued.run.id, {
      action: 'abort',
    });
    expect(continueAbort.statusCode).toBe(200);

    // Restart creates a new run record from the frozen snapshot.
    const restarted = await simulateRestart();
    const restartResponse = await postAction(restarted.second.app, restarted.run.id, {
      action: 'restart',
    });
    expect(restartResponse.statusCode).toBe(200);
    const restartBody = restartResponse.body as RunView & { restartedFrom: string | null };
    expect(restartBody.restartedFrom).toBe(restarted.run.id);
    expect(restartBody.run.id).not.toBe(restarted.run.id);
    expect(restartBody.run.status).toBe('awaiting-user');
    expect(restartBody.run.currentStepIndex).toBe(0);
    expect(restartBody.run.steps[0]?.status).toBe('running');

    const original = await getRunRecord(restarted.second.app, restarted.run.id);
    expect((original.body as { run: Run }).run.status).toBe('interrupted');

    const restartAbort = await postAction(restarted.second.app, restartBody.run.id, {
      action: 'abort',
    });
    expect(restartAbort.statusCode).toBe(200);
  });

  it('reports no pending step and no retry for an interrupted run after the last step', async () => {
    const singleStep = await buildTestApp();
    const chain = await createChain(singleStep.app, singleStep.projectId, {
      steps: [
        {
          id: 'step-plan',
          skillName: 'brainstorm',
          instruction: 'Plan {{task}}.',
        },
      ],
    });
    const run = await createRun(singleStep.app, singleStep.projectId, chain);

    const done = await postAction(singleStep.app, run.id, { action: 'done' });
    expect(done.statusCode).toBe(200);

    const index = apps.indexOf(singleStep.app);
    if (index >= 0) {
      apps.splice(index, 1);
    }
    await singleStep.app.close();
    const restarted = await buildTestApp();

    const current = (await getRunRecord(restarted.app, run.id)).body as { run: Run };
    expect(current.run.status).toBe('interrupted');
    expect(current.run.steps[0]?.status).toBe('done');

    const retried = await postAction(restarted.app, run.id, { action: 'retry' });
    expect(retried.statusCode).toBe(409);
    expect(envelope(retried.body).error.code).toBe('RUN_RECOVERY_STEP_INVALID');

    const continued = await postAction(restarted.app, run.id, { action: 'continue' });
    expect(continued.statusCode).toBe(409);
    expect(envelope(continued.body).error.code).toBe('RUN_RECOVERY_NO_PENDING');

    const restartedRun = await postAction(restarted.app, run.id, { action: 'restart' });
    expect(restartedRun.statusCode).toBe(200);
    const restartedBody = restartedRun.body as RunView & { restartedFrom: string | null };
    expect(restartedBody.restartedFrom).toBe(run.id);
  });
});
