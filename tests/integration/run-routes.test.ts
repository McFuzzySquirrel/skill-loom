import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { runCli } from '../../src/server/cli.js';
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
import { chainRevision } from '../../src/server/chains/service.js';
import { createConfigStore, type ConfigStore } from '../../src/server/config/store.js';
import { callControl, startControlServer } from '../../src/server/control.js';
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
import { createRunOrchestrator, runRevision } from '../../src/server/runs/orchestrator.js';
import type { Run } from '../../src/server/runs/model.js';
import { createRunStore } from '../../src/server/runs/store.js';
import { createProjectRegistry } from '../../src/server/projects/registry.js';
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
import {
  adoptReviewedLegacyRun, clearReviewedProjectClaim, enableReviewedProjectProtocol, reviewProjectCoordination,
} from '../../src/shared/project-coordination.js';
import { withProjectClaimTransaction } from '../../src/shared/project-claim.js';

const CREATED_AT = '2026-11-04T12:00:00.000Z';
const RUN_ID_PATTERN = /^run-test-\d+$/;
const TERMINAL_ID_PREFIX = 'loom_run_';
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
        agents: [],
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
  configStore: ConfigStore;
}

async function buildTestApp(options: { extraEnv?: NodeJS.ProcessEnv; configDirectory?: string } = {}): Promise<AppHarness> {
  const runner = createRunner();
  const configStore = createConfigStore({
    env: { LOOM_CONFIG_DIR: options.configDirectory ?? configDirectory },
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
  return { app, projectId, projectPath: canonicalProject, runner, baseUrl, configStore };
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
  timeoutMs = 5_000,
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
  root = await mkdtemp(join(tmpdir(), 'loom-run-routes-'));
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
  it.skipIf(process.platform === 'win32')('runs an instruction-only chain end to end through reviewed CLI commands', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId, {
      steps: [
        { id: 'one', kind: 'instruction', instruction: 'Review {{task}}.' },
        { id: 'two', kind: 'instruction', instruction: 'Summarize {{task}}.' },
      ],
    });
    const control = await startControlServer(harness.configStore, {
      services: harness.app.loomServices, runOwner: harness.app.loomRunOwner,
    });
    try {
      const cli = async (command: string, input: unknown): Promise<Record<string, unknown>> => {
        let output = '';
        let error = '';
        const code = await runCli(['run', command, '--config-dir', configDirectory], {
          env: {}, stdin: Readable.from([JSON.stringify(input)]),
          stdout: { write: (chunk) => { output += String(chunk); return true; }, isTTY: false },
          stderr: { write: (chunk) => { error += String(chunk); return true; } },
        });
        expect({ code, error }).toEqual({ code: 0, error: '' });
        return (JSON.parse(output) as { result: Record<string, unknown> }).result;
      };
      const request = { projectId: harness.projectId, chainId: chain.id, inputs: { task: 'the change' } };
      const review = await cli('review-start', request);
      const started = await cli('start', { ...request, reviewDigest: review.reviewDigest, confirmed: true });
      const runId = (started.run as Run).id;
      for (let index = 0; index < 2; index += 1) {
        const done = { runId, action: 'done' };
        const doneReview = await cli('review-action', done);
        const marked = await cli('action', { ...done, reviewDigest: doneReview.reviewDigest, confirmed: true });
        expect((marked.run as Run).currentStepIndex).toBe(index);
        const next = { runId, action: 'next' };
        const nextReview = await cli('review-action', next);
        const advanced = await cli('action', {
          ...next, reviewDigest: nextReview.reviewDigest, confirmed: true, executionConfirmed: true,
        });
        expect((advanced.run as Run).status).toBe(index === 1 ? 'completed' : 'awaiting-user');
      }
      expect((await getActiveRun(harness.app)).body).toMatchObject({ active: false });
    } finally {
      await control.close();
    }
  });

  it.skipIf(process.platform === 'win32')('rejects a chain changed between start re-review and orchestrator creation', async () => {
    const harness = await buildTestApp();
    const draft = {
      name: 'Instructions only', harness: 'opencode', sessionMode: 'shared',
      steps: [{ id: 'one', kind: 'instruction', instruction: 'Review {{task}}.' }],
      inputs: [{ name: 'task', required: true }], automaticPermissionOptIn: false,
    };
    const chain = await createChain(harness.app, harness.projectId, draft);
    const provider = harness.app.loomServices.preflightProvider;
    const engine = await provider.preflightEngine();
    let calls = 0;
    vi.spyOn(provider, 'preflightEngine').mockResolvedValue({
      run: async (request) => {
        const report = await engine.run(request);
        calls += 1;
        if (calls === 2) {
          const updated = await harness.app.inject({
            method: 'PUT', url: `/api/projects/${harness.projectId}/chains/${chain.id}`,
            headers: { 'x-loom-chain-revision': chainRevision(chain) },
            payload: { ...draft, name: 'Changed during start' },
          });
          expect(updated.statusCode).toBe(200);
        }
        return report;
      },
    });
    const control = await startControlServer(harness.configStore, {
      services: harness.app.loomServices, runOwner: harness.app.loomRunOwner,
    });
    try {
      const request = { projectId: harness.projectId, chainId: chain.id, inputs: { task: 'the change' } };
      const review = await callControl(configDirectory, 'run.start.review', request);
      if (!review.ok) throw new Error('Review failed.');
      const digest = (review.result as { reviewDigest: string }).reviewDigest;
      expect(await callControl(configDirectory, 'run.start', { ...request, reviewDigest: digest, confirmed: true }))
        .toMatchObject({ ok: false, error: { code: 'RUN_STALE' } });
      expect(terminal.sessions.size).toBe(0);
      expect((await getActiveRun(harness.app)).body).toMatchObject({ active: false });
    } finally {
      await control.close();
    }
  });

  it.skipIf(process.platform === 'win32')('requires separate live-test approval for a retained workspace', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId, {
      steps: [{ id: 'one', kind: 'instruction', instruction: 'Review {{task}}.' }],
    });
    const workspace = await harness.app.loomServices.testWorkspaceService.create({
      sourceProjectId: harness.projectId, sourceChainId: chain.id,
    });
    const control = await startControlServer(harness.configStore, {
      services: harness.app.loomServices, runOwner: harness.app.loomRunOwner,
    });
    try {
      const request = { projectId: workspace.projectId, chainId: workspace.chainId, inputs: { task: 'the change' } };
      const review = await callControl(configDirectory, 'run.start.review', request);
      expect(review).toMatchObject({ ok: true, result: { evidence: { testWorkspaceId: workspace.id } } });
      if (!review.ok) throw new Error('Review failed.');
      const digest = (review.result as { reviewDigest: string }).reviewDigest;
      expect(await callControl(configDirectory, 'run.start', { ...request, reviewDigest: digest, confirmed: true }))
        .toMatchObject({ ok: false, error: { code: 'RUN_LIVE_TEST_CONFIRMATION_REQUIRED' } });
      const started = await callControl(configDirectory, 'run.start', {
        ...request, reviewDigest: digest, confirmed: true, liveTestConfirmed: true,
      });
      expect(started).toMatchObject({ ok: true, result: { run: { projectId: workspace.projectId } } });
      if (!started.ok) throw new Error('Live test start failed.');
      const runId = (started.result as { run: Run }).run.id;
      expect((await postAction(harness.app, runId, { action: 'done' })).statusCode).toBe(200);
      const next = { runId, action: 'next' };
      const nextReview = await callControl(configDirectory, 'run.action.review', next);
      if (!nextReview.ok) throw new Error('Next review failed.');
      const nextDigest = (nextReview.result as { reviewDigest: string }).reviewDigest;
      expect(await callControl(configDirectory, 'run.action', {
        ...next, reviewDigest: nextDigest, confirmed: true, executionConfirmed: true,
      })).toMatchObject({ ok: false, error: { code: 'RUN_LIVE_TEST_CONFIRMATION_REQUIRED' } });
      expect(await callControl(configDirectory, 'run.action', {
        ...next, reviewDigest: nextDigest, confirmed: true, executionConfirmed: true, liveTestConfirmed: true,
      })).toMatchObject({ ok: true, result: { run: { status: 'completed' } } });
    } finally {
      await control.close();
    }
  });

  it.skipIf(process.platform === 'win32')('starts only reviewed supervised instruction chains through local control', async () => {
    const harness = await buildTestApp();
    const skillChain = await createChain(harness.app, harness.projectId);
    const chain = await createChain(harness.app, harness.projectId, {
      name: 'Instructions only',
      steps: [{ id: 'one', kind: 'instruction', instruction: 'Review {{task}}.' }],
    });
    const control = await startControlServer(harness.configStore, {
      services: harness.app.loomServices, runOwner: harness.app.loomRunOwner,
    });
    try {
      const input = {
        projectId: harness.projectId, chainId: chain.id, mode: 'supervised', inputs: { task: 'the change' },
      };
      expect(await callControl(configDirectory, 'run.start.review', { ...input, chainId: skillChain.id }))
        .toMatchObject({ ok: false, error: { code: 'RUN_START_UNSUPPORTED' } });
      expect(await callControl(configDirectory, 'run.start.review', { ...input, mode: 'automatic' }))
        .toMatchObject({ ok: false, error: { code: 'RUN_START_UNSUPPORTED' } });
      let reviewOutput = '';
      expect(await runCli(['run', 'review-start', '--config-dir', configDirectory], {
        env: {}, stdin: Readable.from([JSON.stringify(input)]),
        stdout: { write: (chunk) => { reviewOutput += String(chunk); return true; }, isTTY: false },
      })).toBe(0);
      const review = JSON.parse(reviewOutput) as Awaited<ReturnType<typeof callControl>>;
      expect(review).toMatchObject({ ok: true, result: { evidence: {
        chain: { id: chain.id }, preflight: { startAllowed: true }, testWorkspaceId: null,
      } } });
      if (!review.ok) throw new Error('Review failed.');
      const digest = (review.result as { reviewDigest: string }).reviewDigest;
      expect(await callControl(configDirectory, 'run.start', { ...input, reviewDigest: digest }))
        .toMatchObject({ ok: false, error: { code: 'CONTROL_INVALID_REQUEST' } });
      expect(await callControl(configDirectory, 'run.start', {
        ...input, inputs: { task: 'another change' }, reviewDigest: digest, confirmed: true,
      })).toMatchObject({ ok: false, error: { code: 'RUN_STALE' } });
      let startOutput = '';
      expect(await runCli(['run', 'start', '--config-dir', configDirectory], {
        env: {}, stdin: Readable.from([JSON.stringify({ ...input, reviewDigest: digest, confirmed: true })]),
        stdout: { write: (chunk) => { startOutput += String(chunk); return true; }, isTTY: false },
      })).toBe(0);
      const started = JSON.parse(startOutput) as Awaited<ReturnType<typeof callControl>>;
      expect(started).toMatchObject({ ok: true, result: { run: {
        mode: 'supervised', chainId: chain.id, status: 'awaiting-user',
      } } });
      if (!started.ok) throw new Error('Start failed.');
      const runId = (started.result as { run: Run }).run.id;
      expect(terminal.sessions.get(terminalIdFor(runId))?.isRunning()).toBe(true);
      expect((await postAction(harness.app, runId, { action: 'abort' })).statusCode).toBe(200);
    } finally {
      await control.close();
    }
  });

  it.skipIf(process.platform === 'win32')('requires separate automatic and permission approvals for process-exit starts', async () => {
    const callsPath = join(root, 'automatic-calls.jsonl');
    await writeFile(COPILOT(), `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(process.argv.slice(2)) + '\\n');\n`, { mode: 0o755 });
    const harness = await buildTestApp({ extraEnv: { GH_TOKEN: 'test-token' } });
    const chain = await createChain(harness.app, harness.projectId, {
      harness: 'copilot', automaticPermissionOptIn: true,
      steps: [
        { id: 'one', kind: 'instruction', instruction: 'Review {{task}}.' },
        { id: 'two', kind: 'instruction', instruction: 'Summarize {{task}}.' },
      ],
    });
    const control = await startControlServer(harness.configStore, {
      services: harness.app.loomServices, runOwner: harness.app.loomRunOwner,
    });
    try {
      const noOptIn = await createChain(harness.app, harness.projectId, {
        harness: 'copilot', automaticPermissionOptIn: false,
        steps: [{ id: 'one', kind: 'instruction', instruction: 'Review {{task}}.' }],
      });
      const blockedRequest = { projectId: harness.projectId, chainId: noOptIn.id, mode: 'automatic', inputs: { task: 'the change' } };
      const blockedReview = await callControl(configDirectory, 'run.start.review', blockedRequest);
      expect(blockedReview).toMatchObject({ ok: true, result: { evidence: { preflight: { startAllowed: false } } } });
      if (!blockedReview.ok) throw new Error('Blocked review failed.');
      expect(await callControl(configDirectory, 'run.start', {
        ...blockedRequest, reviewDigest: (blockedReview.result as { reviewDigest: string }).reviewDigest,
        confirmed: true, automaticConfirmed: true, broadPermissionsConfirmed: true,
      })).toMatchObject({ ok: false, error: { code: 'RUN_PREFLIGHT_BLOCKED' } });
      const request = { projectId: harness.projectId, chainId: chain.id, mode: 'automatic', inputs: { task: 'the change' } };
      let output = '';
      expect(await runCli(['run', 'review-start', '--config-dir', configDirectory], {
        env: {}, stdin: Readable.from([JSON.stringify(request)]),
        stdout: { write: (chunk) => { output += String(chunk); return true; }, isTTY: false },
      })).toBe(0);
      const review = JSON.parse(output) as Awaited<ReturnType<typeof callControl>>;
      expect(review).toMatchObject({ ok: true, result: { evidence: {
        request: { mode: 'automatic' }, preflight: { startAllowed: true, permissions: { required: true } },
      } } });
      if (!review.ok) throw new Error('Review failed.');
      const reviewDigest = (review.result as { reviewDigest: string }).reviewDigest;
      const start = { ...request, reviewDigest, confirmed: true };
      expect(await callControl(configDirectory, 'run.start', { ...start, mode: 'supervised' }))
        .toMatchObject({ ok: false, error: { code: 'RUN_STALE' } });
      expect(await callControl(configDirectory, 'run.start', start))
        .toMatchObject({ ok: false, error: { code: 'RUN_AUTOMATIC_CONFIRMATION_REQUIRED' } });
      expect(await callControl(configDirectory, 'run.start', { ...start, automaticConfirmed: true }))
        .toMatchObject({ ok: false, error: { code: 'RUN_PERMISSIONS_CONFIRMATION_REQUIRED' } });
      await expect(access(callsPath)).rejects.toMatchObject({ code: 'ENOENT' });
      output = '';
      expect(await runCli(['run', 'start', '--config-dir', configDirectory], {
        env: {}, stdin: Readable.from([JSON.stringify({ ...start, automaticConfirmed: true, broadPermissionsConfirmed: true })]),
        stdout: { write: (chunk) => { output += String(chunk); return true; }, isTTY: false },
      })).toBe(0);
      const started = JSON.parse(output) as Awaited<ReturnType<typeof callControl>>;
      expect(started).toMatchObject({ ok: true, result: { run: { mode: 'automatic' } } });
      if (!started.ok) throw new Error('Automatic start failed.');
      const runId = (started.result as { run: Run }).run.id;
      const run = await waitForRunStatus(harness.app, runId, 'completed');
      expect(run.steps.map((step) => step.status)).toEqual(['done', 'done']);
      const calls = (await readFile(callsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as string[]);
      expect(calls).toHaveLength(2);
      expect(calls.every((args) => args.includes('--allow-all-paths') && args.includes('--allow-all-tools'))).toBe(true);
    } finally {
      await control.close();
    }
  });

  it.skipIf(process.platform === 'win32')('reviews automatic resume and requires renewed execution and permission approvals', async () => {
    await writeFile(COPILOT(), `#!${process.execPath}\nsetInterval(() => {}, 1000);\n`, { mode: 0o755 });
    const harness = await buildTestApp({ extraEnv: { GH_TOKEN: 'test-token' } });
    const chain = await createChain(harness.app, harness.projectId, {
      harness: 'copilot', automaticPermissionOptIn: true,
      steps: [{ id: 'one', kind: 'instruction', instruction: 'Review {{task}}.' }],
    });
    const control = await startControlServer(harness.configStore, {
      services: harness.app.loomServices, runOwner: harness.app.loomRunOwner,
    });
    try {
      const request = { projectId: harness.projectId, chainId: chain.id, mode: 'automatic', inputs: { task: 'the change' } };
      const review = await callControl(configDirectory, 'run.start.review', request);
      if (!review.ok) throw new Error('Review failed.');
      const started = await callControl(configDirectory, 'run.start', {
        ...request, reviewDigest: (review.result as { reviewDigest: string }).reviewDigest,
        confirmed: true, automaticConfirmed: true, broadPermissionsConfirmed: true,
      });
      if (!started.ok) throw new Error('Automatic start failed.');
      const runId = (started.result as { run: Run }).run.id;
      const pause = { runId, action: 'pause' };
      const pauseReview = await callControl(configDirectory, 'run.action.review', pause);
      if (!pauseReview.ok) throw new Error('Pause review failed.');
      expect(await callControl(configDirectory, 'run.action', {
        ...pause, reviewDigest: (pauseReview.result as { reviewDigest: string }).reviewDigest, confirmed: true,
      })).toMatchObject({ ok: true, result: { run: { status: 'paused' } } });

      const resume = { runId, action: 'resume' };
      const resumeReview = await callControl(configDirectory, 'run.action.review', resume);
      expect(resumeReview).toMatchObject({ ok: true, result: { evidence: {
        preflight: { mode: 'automatic', permissions: { required: true } },
      } } });
      if (!resumeReview.ok) throw new Error('Resume review failed.');
      const action = { ...resume, reviewDigest: (resumeReview.result as { reviewDigest: string }).reviewDigest, confirmed: true };
      expect(await callControl(configDirectory, 'run.action', action))
        .toMatchObject({ ok: false, error: { code: 'RUN_EXECUTION_CONFIRMATION_REQUIRED' } });
      expect(await callControl(configDirectory, 'run.action', { ...action, executionConfirmed: true }))
        .toMatchObject({ ok: false, error: { code: 'RUN_AUTOMATIC_CONFIRMATION_REQUIRED' } });
      expect(await callControl(configDirectory, 'run.action', { ...action, executionConfirmed: true, automaticConfirmed: true }))
        .toMatchObject({ ok: false, error: { code: 'RUN_PERMISSIONS_CONFIRMATION_REQUIRED' } });
      expect(await callControl(configDirectory, 'run.action', {
        ...action, executionConfirmed: true, automaticConfirmed: true, broadPermissionsConfirmed: true,
      })).toMatchObject({ ok: true, result: { run: { status: 'running' } } });
      expect((await postAction(harness.app, runId, { action: 'abort' })).statusCode).toBe(200);
    } finally {
      await control.close();
    }
  });

  it.skipIf(process.platform === 'win32')('does not retry a failed automatic step without separate replay approval', async () => {
    const callsPath = join(root, 'retry-calls');
    await writeFile(COPILOT(), `#!${process.execPath}\nconst fs = require('node:fs');\nconst seen = fs.existsSync(${JSON.stringify(callsPath)});\nfs.appendFileSync(${JSON.stringify(callsPath)}, 'x');\nprocess.exit(seen ? 0 : 1);\n`, { mode: 0o755 });
    const harness = await buildTestApp({ extraEnv: { GH_TOKEN: 'test-token' } });
    const chain = await createChain(harness.app, harness.projectId, {
      harness: 'copilot', automaticPermissionOptIn: true,
      steps: [{ id: 'one', kind: 'instruction', instruction: 'Review {{task}}.' }],
    });
    const control = await startControlServer(harness.configStore, {
      services: harness.app.loomServices, runOwner: harness.app.loomRunOwner,
    });
    try {
      const request = { projectId: harness.projectId, chainId: chain.id, mode: 'automatic', inputs: { task: 'the change' } };
      const review = await callControl(configDirectory, 'run.start.review', request);
      if (!review.ok) throw new Error('Review failed.');
      const started = await callControl(configDirectory, 'run.start', {
        ...request, reviewDigest: (review.result as { reviewDigest: string }).reviewDigest,
        confirmed: true, automaticConfirmed: true, broadPermissionsConfirmed: true,
      });
      if (!started.ok) throw new Error('Automatic start failed.');
      const runId = (started.result as { run: Run }).run.id;
      const paused = await waitForRunStatus(harness.app, runId, 'paused');
      expect(paused.steps[0]?.status).toBe('failed');
      const retry = { runId, action: 'retry' };
      const retryReview = await callControl(configDirectory, 'run.action.review', retry);
      if (!retryReview.ok) throw new Error('Retry review failed.');
      const action = {
        ...retry, reviewDigest: (retryReview.result as { reviewDigest: string }).reviewDigest,
        confirmed: true, executionConfirmed: true, automaticConfirmed: true, broadPermissionsConfirmed: true,
      };
      expect(await callControl(configDirectory, 'run.action', action))
        .toMatchObject({ ok: false, error: { code: 'RUN_REPLAY_CONFIRMATION_REQUIRED' } });
      expect(await readFile(callsPath, 'utf8')).toBe('x');
      expect(await callControl(configDirectory, 'run.action', { ...action, replayConfirmed: true })).toMatchObject({ ok: true });
      await waitForRunStatus(harness.app, runId, 'completed');
      expect(await readFile(callsPath, 'utf8')).toBe('xx');
    } finally {
      await control.close();
    }
  });

  it.skipIf(process.platform === 'win32')('keeps an automatic run paused after skip until an approved run-next', async () => {
    const callsPath = join(root, 'skip-calls');
    await writeFile(COPILOT(), `#!${process.execPath}\nconst fs = require('node:fs');\nconst seen = fs.existsSync(${JSON.stringify(callsPath)});\nfs.appendFileSync(${JSON.stringify(callsPath)}, 'x');\nif (!seen) process.exit(1);\nsetInterval(() => {}, 1000);\n`, { mode: 0o755 });
    const harness = await buildTestApp({ extraEnv: { GH_TOKEN: 'test-token' } });
    const chain = await createChain(harness.app, harness.projectId, {
      harness: 'copilot', automaticPermissionOptIn: true,
      steps: [
        { id: 'one', kind: 'instruction', instruction: 'Review {{task}}.' },
        { id: 'two', kind: 'instruction', instruction: 'Summarize {{task}}.' },
      ],
    });
    const control = await startControlServer(harness.configStore, {
      services: harness.app.loomServices, runOwner: harness.app.loomRunOwner,
    });
    try {
      const request = { projectId: harness.projectId, chainId: chain.id, mode: 'automatic', inputs: { task: 'the change' } };
      const review = await callControl(configDirectory, 'run.start.review', request);
      if (!review.ok) throw new Error('Review failed.');
      const started = await callControl(configDirectory, 'run.start', {
        ...request, reviewDigest: (review.result as { reviewDigest: string }).reviewDigest,
        confirmed: true, automaticConfirmed: true, broadPermissionsConfirmed: true,
      });
      if (!started.ok) throw new Error('Automatic start failed.');
      const runId = (started.result as { run: Run }).run.id;
      await waitForRunStatus(harness.app, runId, 'paused');
      const skip = { runId, action: 'skip', reason: 'Reviewed and skipped' };
      const skipReview = await callControl(configDirectory, 'run.action.review', skip);
      if (!skipReview.ok) throw new Error('Skip review failed.');
      expect(await callControl(configDirectory, 'run.action', {
        ...skip, reviewDigest: (skipReview.result as { reviewDigest: string }).reviewDigest, confirmed: true,
      })).toMatchObject({ ok: true, result: { run: { status: 'paused', currentStepIndex: 0 } } });
      const next = { runId, action: 'run-next' };
      const nextReview = await callControl(configDirectory, 'run.action.review', next);
      if (!nextReview.ok) throw new Error('Run-next review failed.');
      const action = {
        ...next, reviewDigest: (nextReview.result as { reviewDigest: string }).reviewDigest,
        confirmed: true, executionConfirmed: true, automaticConfirmed: true,
      };
      expect(await callControl(configDirectory, 'run.action', action))
        .toMatchObject({ ok: false, error: { code: 'RUN_PERMISSIONS_CONFIRMATION_REQUIRED' } });
      expect(await readFile(callsPath, 'utf8')).toBe('x');
      expect(await callControl(configDirectory, 'run.action', { ...action, broadPermissionsConfirmed: true }))
        .toMatchObject({ ok: true, result: { run: { currentStepIndex: 1 } } });
      await waitFor(async () => (await readFile(callsPath, 'utf8')) === 'xx', 'the second automatic process');
      expect((await postAction(harness.app, runId, { action: 'abort' })).statusCode).toBe(200);
    } finally {
      await control.close();
    }
  });

  it.skipIf(process.platform === 'win32')('requires live-test approval independently of automatic permissions', async () => {
    await writeFile(COPILOT(), `#!${process.execPath}\nsetInterval(() => {}, 1000);\n`, { mode: 0o755 });
    const harness = await buildTestApp({ extraEnv: { GH_TOKEN: 'test-token' } });
    const chain = await createChain(harness.app, harness.projectId, {
      harness: 'copilot', automaticPermissionOptIn: true,
      steps: [{ id: 'one', kind: 'instruction', instruction: 'Review {{task}}.' }],
    });
    const workspace = await harness.app.loomServices.testWorkspaceService.create({
      sourceProjectId: harness.projectId, sourceChainId: chain.id,
    });
    const workspaceProject = await harness.app.loomServices.projectRegistry.findRecentProject(workspace.projectId);
    if (workspaceProject === undefined) throw new Error('Workspace project missing.');
    trustConfig = JSON.stringify({ trustedFolders: [workspaceProject.canonicalPath] });
    const control = await startControlServer(harness.configStore, {
      services: harness.app.loomServices, runOwner: harness.app.loomRunOwner,
    });
    try {
      const request = { projectId: workspace.projectId, chainId: workspace.chainId, mode: 'automatic', inputs: { task: 'the change' } };
      const review = await callControl(configDirectory, 'run.start.review', request);
      expect(review).toMatchObject({ ok: true, result: { evidence: {
        testWorkspaceId: workspace.id, preflight: { startAllowed: true },
      } } });
      if (!review.ok) throw new Error('Review failed.');
      const start = {
        ...request, reviewDigest: (review.result as { reviewDigest: string }).reviewDigest,
        confirmed: true, automaticConfirmed: true, broadPermissionsConfirmed: true,
      };
      expect(await callControl(configDirectory, 'run.start', start))
        .toMatchObject({ ok: false, error: { code: 'RUN_LIVE_TEST_CONFIRMATION_REQUIRED' } });
      const started = await callControl(configDirectory, 'run.start', { ...start, liveTestConfirmed: true });
      expect(started).toMatchObject({ ok: true });
      if (!started.ok) throw new Error('Automatic live test start failed.');
      const runId = (started.result as { run: Run }).run.id;
      expect((await postAction(harness.app, runId, { action: 'abort' })).statusCode).toBe(200);
    } finally {
      await control.close();
    }
  });

  it('refuses automatic execution for a managed discovery chain', async () => {
    const { app, projectId, configStore } = await buildTestApp();
    const chain = await createChain(app, projectId);
    await configStore.update({
      discoveryWorkspaces: [{
        id: 'a0f4cbaa-f755-4be6-95bf-d6a2019ff7d5',
        projectId,
        chainId: chain.id,
        harness: 'opencode',
        createdAt: CREATED_AT,
        handoffFingerprint: 'a'.repeat(64),
        autoImport: false,
      }],
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${encodeURIComponent(projectId)}/runs`,
      payload: { chainId: chain.id, mode: 'automatic' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: 'DISCOVERY_SUPERVISED_ONLY' },
    });
  });

  it('refuses to mark a discovery step Done until its exact result is reviewed', async () => {
    const { app, configStore } = await buildTestApp();
    const workspaceId = 'a0f4cbaa-f755-4be6-95bf-d6a2019ff7d5';
    const workspacePath = join(configDirectory, 'discovery-workspaces', workspaceId);
    await mkdir(join(workspacePath, 'discovery-output'), { recursive: true });
    const managedProject = await createProjectRegistry({ configStore })
      .registerManagedWorkspace(workspacePath);
    const chain = await createChain(app, managedProject.id);
    await configStore.update({
      discoveryWorkspaces: [{
        id: workspaceId,
        projectId: managedProject.id,
        chainId: chain.id,
        harness: 'opencode',
        createdAt: CREATED_AT,
        handoffFingerprint: 'a'.repeat(64),
        autoImport: false,
      }],
    });

    const run = await createRun(app, managedProject.id, chain, { mode: 'supervised' });
    const done = await postAction(app, run.id, { action: 'done' });
    expect(done.statusCode).toBe(422);
    expect(envelope(done.body)).toMatchObject({
      error: { code: 'DISCOVERY_RESULT_REVIEW_REQUIRED' },
    });
    if (process.platform !== 'win32') {
      const control = await startControlServer(configStore, {
        services: app.loomServices, runOwner: app.loomRunOwner,
      });
      try {
        const request = { runId: run.id, action: 'done' };
        const reviewed = await callControl(configDirectory, 'run.action.review', request);
        expect(reviewed.ok).toBe(true);
        if (!reviewed.ok) throw new Error('Review failed.');
        const digest = (reviewed.result as { reviewDigest: string }).reviewDigest;
        expect(await callControl(configDirectory, 'run.action', {
          ...request, reviewDigest: digest, confirmed: true,
        })).toMatchObject({ ok: false, error: { code: 'DISCOVERY_RESULT_REVIEW_REQUIRED' } });
      } finally {
        await control.close();
      }
    }
    const current = await getRunRecord(app, run.id);
    expect(current.statusCode).toBe(200);
    expect((current.body as { run: Run }).run.steps[0]?.status).toBe('running');
  });

  it('clears the previous discovery result and review state before starting another run', async () => {
    const { app, configStore } = await buildTestApp();
    const workspaceId = 'a0f4cbaa-f755-4be6-95bf-d6a2019ff7d5';
    const workspacePath = join(configDirectory, 'discovery-workspaces', workspaceId);
    await mkdir(join(workspacePath, 'discovery-output'), { recursive: true });
    const managedProject = await createProjectRegistry({ configStore })
      .registerManagedWorkspace(workspacePath);
    const chain = await createChain(app, managedProject.id, {
      steps: [{ id: 'discover', kind: 'instruction', instruction: 'Review the discovery result.' }],
      inputs: [],
    });
    const previousResultPath = join(workspacePath, 'discovery-output', 'approved-result.loom.json');
    await writeFile(previousResultPath, '{"previous":"result"}');
    await configStore.update({
      discoveryWorkspaces: [{
        id: workspaceId,
        projectId: managedProject.id,
        chainId: chain.id,
        harness: 'opencode',
        createdAt: CREATED_AT,
        handoffFingerprint: 'a'.repeat(64),
        autoImport: false,
        runId: 'run-previous',
        resultFingerprint: 'b'.repeat(64),
        importedDraftId: 'draft-previous',
      }],
    });
    trustConfig = JSON.stringify({ trustedFolders: [workspacePath] });

    const started = await postRun(app, managedProject.id, {
      chainId: chain.id,
      mode: 'supervised',
    });

    expect(started.statusCode).toBe(201);
    const run = (started.body as { run: Run }).run;
    expect(await configStore.get()).toMatchObject({
      discoveryWorkspaces: [{
        id: workspaceId,
        runId: run.id,
      }],
    });
    expect((await configStore.get()).discoveryWorkspaces[0]).not.toHaveProperty('resultFingerprint');
    expect((await configStore.get()).discoveryWorkspaces[0]).not.toHaveProperty('importedDraftId');
    await expect(access(previousResultPath)).rejects.toMatchObject({ code: 'ENOENT' });
    const done = await postAction(app, run.id, { action: 'done' });
    expect(done.statusCode).toBe(422);
    expect(envelope(done.body)).toMatchObject({
      error: { code: 'DISCOVERY_RESULT_REVIEW_REQUIRED' },
    });
  });

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
      headers: { 'x-loom-chain-revision': chainRevision(chain) },
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

  it('persists active work as interrupted and releases its pointer on shutdown', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId);
    const run = await createRun(harness.app, harness.projectId, chain);
    const store = createRunStore({
      projectPath: harness.projectPath,
      configDirectory,
    });

    await harness.app.close();

    const interrupted = await store.read(run.id);
    expect(interrupted.status).toBe('interrupted');
    expect(interrupted.reason).toBe('SERVER_SHUTDOWN');
    expect(interrupted.steps[0]?.status).toBe('interrupted');
    expect(await store.getActiveRun()).toBeNull();
    expect(terminal.closed).toContain(terminalIdFor(run.id));
  });

  it('retains a failed shutdown for retry without interrupting or releasing the run', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId);
    const run = await createRun(harness.app, harness.projectId, chain);
    const store = createRunStore({ projectPath: harness.projectPath, configDirectory });
    const session = terminal.getSession(terminalIdFor(run.id))!;
    const kill = vi.spyOn(session, 'kill').mockImplementation(() => { throw new Error('termination failed'); });
    const owner = harness.app.loomRunOwner;

    try {
      await expect(owner.shutdown()).rejects.toThrow('could not be shut down cleanly');
      expect(session.isRunning()).toBe(true);
      expect((await store.read(run.id)).status).not.toBe('interrupted');
      expect((await store.getActiveRun())?.runId).toBe(run.id);
      expect(terminal.closed).not.toContain(terminalIdFor(run.id));
      await expect(owner.get()).rejects.toThrow('shutting down');
      await expect(owner.withMutation(async () => undefined)).rejects.toThrow('stopping');
    } finally {
      kill.mockRestore();
    }

    await owner.shutdown();
    expect(session.isRunning()).toBe(false);
    expect((await store.read(run.id)).status).toBe('interrupted');
    expect(await store.getActiveRun()).toBeNull();
  });

  it('keeps ownership when a post-spawn start failure cannot terminate its process', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId);
    const store = createRunStore({ projectPath: harness.projectPath, configDirectory });
    const update = store.update.bind(store);
    const persist = vi.spyOn(store, 'update').mockImplementation(async (run) => {
      if (run.status === 'awaiting-user') throw new Error('simulated persistence failure');
      return update(run);
    });
    const services = harness.app.loomServices;
    const orchestrator = createRunOrchestrator({
      configDirectory,
      projectRegistry: services.projectRegistry,
      chainService: services.chainService,
      harnessRegistry: services.preflightProvider.harnessRegistry,
      preflightEngine: services.preflightProvider.preflightEngine,
      terminalManager: terminal as unknown as TerminalManager,
      createRunId: () => 'run-start-failure',
      createSessionId: () => 'ses_start_failure',
      runStoreFor: () => store,
    });
    const createSession = terminal.createSession.bind(terminal);
    let session: FakeTerminalSession | undefined;
    const create = vi.spyOn(terminal, 'createSession').mockImplementation((spec, options) => {
      session = createSession(spec, options) as FakeTerminalSession;
      vi.spyOn(session, 'kill').mockImplementation(() => { throw new Error('termination failed'); });
      return session;
    });

    try {
      await expect(orchestrator.createRun({
        projectId: harness.projectId, chainId: chain.id, inputs: { task: 'release' },
      })).rejects.toMatchObject({ code: 'RUN_START_FAILED' });
      expect(session?.isRunning()).toBe(true);
      expect((await store.getActiveRun())?.runId).toBe('run-start-failure');
      expect((await store.read('run-start-failure')).status).not.toBe('failed');
    } finally {
      create.mockRestore();
      persist.mockRestore();
      if (session !== undefined) vi.mocked(session.kill).mockRestore();
      await orchestrator.shutdown();
    }
    expect(session?.isRunning()).toBe(false);
    expect((await store.read('run-start-failure')).status).toBe('interrupted');
    expect(await store.getActiveRun()).toBeNull();
  });

  it('retains a final run and blocks another start until failed terminal cleanup succeeds', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId);
    const run = await createRun(harness.app, harness.projectId, chain);
    const owner = harness.app.loomRunOwner;
    const orchestrator = await owner.get();
    const close = vi.spyOn(terminal, 'closeSession').mockImplementation(() => { throw new Error('close failed'); });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(orchestrator.applyAction(run.id, { action: 'abort' })).rejects.toThrow('close failed');
      expect((await orchestrator.getRun(run.id)).status).toBe('aborted');
      await expect(orchestrator.createRun({
        projectId: harness.projectId, chainId: chain.id, inputs: { task: 'release' },
      })).rejects.toMatchObject({ code: 'RUN_ACTIVE_CONFLICT' });
      expect(terminal.hasSession(terminalIdFor(run.id))).toBe(true);
      expect(log).toHaveBeenCalled();
    } finally {
      close.mockRestore();
      log.mockRestore();
    }

    await owner.shutdown();
    expect(terminal.hasSession(terminalIdFor(run.id))).toBe(false);
  });

  it('retains failed cleanup after an automatic completion without a caller awaiting it', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId, {
      steps: [{ id: 'one', kind: 'instruction', instruction: 'Review {{task}}.' }],
    });
    const run = await createRun(harness.app, harness.projectId, chain, { mode: 'automatic' });
    const owner = harness.app.loomRunOwner;
    const orchestrator = await owner.get();
    const session = terminal.getSession(terminalIdFor(run.id))!;
    const close = vi.spyOn(terminal, 'closeSession').mockImplementation(() => { throw new Error('close failed'); });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      session.emitData(OSC_WORKING + OSC_IDLE);
      await vi.waitFor(() => expect(log).toHaveBeenCalled());
      expect((await orchestrator.getRun(run.id)).status).toBe('completed');
      await expect(orchestrator.createRun({
        projectId: harness.projectId, chainId: chain.id, inputs: { task: 'release' },
      })).rejects.toMatchObject({ code: 'RUN_ACTIVE_CONFLICT' });
      expect(terminal.hasSession(terminalIdFor(run.id))).toBe(true);
    } finally {
      close.mockRestore();
      log.mockRestore();
    }

    await owner.shutdown();
    expect(terminal.hasSession(terminalIdFor(run.id))).toBe(false);
  });
});

describe('GET /api/runs and POST /api/runs/:runId/actions', () => {
  it.skipIf(process.platform === 'win32')('requires reviewed execution and replay decisions for supervised next and retry', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId, {
      steps: [
        { id: 'one', kind: 'instruction', instruction: 'Review {{task}}.' },
        { id: 'two', kind: 'instruction', instruction: 'Summarize {{task}}.' },
      ],
    });
    const run = await createRun(harness.app, harness.projectId, chain);
    const control = await startControlServer(harness.configStore, {
      services: harness.app.loomServices, runOwner: harness.app.loomRunOwner,
    });
    try {
      expect((await postAction(harness.app, run.id, { action: 'done' })).statusCode).toBe(200);
      const next = { runId: run.id, action: 'next' };
      const nextReview = await callControl(configDirectory, 'run.action.review', next);
      expect(nextReview).toMatchObject({ ok: true, result: { evidence: {
        destination: { path: harness.projectPath }, action: 'next',
      } } });
      if (!nextReview.ok) throw new Error('Next review failed.');
      const nextDigest = (nextReview.result as { reviewDigest: string }).reviewDigest;
      const orchestrator = await harness.app.loomRunOwner.get();
      const beforeNext = await orchestrator.getRunView(run.id);
      await expect(orchestrator.applyAction(run.id, {
        action: 'next', expectedRevision: runRevision(beforeNext.run),
        expectedProject: { path: harness.projectPath, device: '-1', inode: '-1' },
      })).rejects.toMatchObject({ code: 'RUN_STALE' });
      expect((await orchestrator.getRunView(run.id)).run.currentStepIndex).toBe(0);
      expect(await callControl(configDirectory, 'run.action', {
        ...next, reviewDigest: nextDigest, confirmed: true,
      })).toMatchObject({ ok: false, error: { code: 'RUN_EXECUTION_CONFIRMATION_REQUIRED' } });
      const advanced = await callControl(configDirectory, 'run.action', {
        ...next, reviewDigest: nextDigest, confirmed: true, executionConfirmed: true,
      });
      expect(advanced).toMatchObject({ ok: true, result: { run: { currentStepIndex: 1 } } });
      expect((await postAction(harness.app, run.id, { action: 'failed', reason: 'needs retry' })).statusCode).toBe(200);
      const retry = { runId: run.id, action: 'retry' };
      const retryReview = await callControl(configDirectory, 'run.action.review', retry);
      if (!retryReview.ok) throw new Error('Retry review failed.');
      const retryDigest = (retryReview.result as { reviewDigest: string }).reviewDigest;
      expect(await callControl(configDirectory, 'run.action', {
        ...retry, reviewDigest: retryDigest, confirmed: true, executionConfirmed: true,
      })).toMatchObject({ ok: false, error: { code: 'RUN_REPLAY_CONFIRMATION_REQUIRED' } });
      const retried = await callControl(configDirectory, 'run.action', {
        ...retry, reviewDigest: retryDigest, confirmed: true, executionConfirmed: true, replayConfirmed: true,
      });
      expect(retried).toMatchObject({ ok: true, result: { run: { currentStepIndex: 1, status: 'awaiting-user' } } });
      expect((await postAction(harness.app, run.id, { action: 'abort' })).statusCode).toBe(200);
    } finally {
      await control.close();
    }
  });

  it.skipIf(process.platform === 'win32')('reviews CLI outcomes against the live run before applying them', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId);
    const run = await createRun(harness.app, harness.projectId, chain);
    const control = await startControlServer(harness.configStore, {
      services: harness.app.loomServices, runOwner: harness.app.loomRunOwner,
    });
    try {
      const request = { runId: run.id, action: 'skip', reason: 'Reviewed skip' };
      expect(await callControl(configDirectory, 'run.action.review', { runId: run.id, action: 'skip' }))
        .toMatchObject({ ok: false, error: { code: 'CONTROL_INVALID_REQUEST' } });
      expect(await callControl(configDirectory, 'run.action.review', { runId: run.id, action: 'pause' }))
        .toMatchObject({ ok: false, error: { code: 'RUN_ACTION_NOT_ALLOWED' } });
      const reviewed = await callControl(configDirectory, 'run.action.review', request);
      expect(reviewed).toMatchObject({ ok: true, result: { evidence: { ...request } } });
      if (!reviewed.ok) throw new Error('Review failed.');
      const digest = (reviewed.result as { reviewDigest: string }).reviewDigest;
      expect(await callControl(configDirectory, 'run.action', { ...request, reviewDigest: digest }))
        .toMatchObject({ ok: false, error: { code: 'CONTROL_INVALID_REQUEST' } });
      expect(await callControl(configDirectory, 'run.action', {
        ...request, reason: 'Changed reason', reviewDigest: digest, confirmed: true,
      })).toMatchObject({ ok: false, error: { code: 'RUN_STALE' } });
      expect(await callControl(configDirectory, 'run.action', {
        ...request, action: 'failed', reviewDigest: digest, confirmed: true,
      })).toMatchObject({ ok: false, error: { code: 'RUN_STALE' } });
      terminal.sessions.get(terminalIdFor(run.id))?.emitData('New output since review');
      await waitFor(async () => {
        const view = await callControl(configDirectory, 'run.show', { runId: run.id });
        if (!view.ok) return null;
        const current = (view.result as { run: Run }).run;
        return current.steps[0]?.tail.includes('New output since review') ? current : null;
      }, 'new terminal output to reach the run');
      expect(await callControl(configDirectory, 'run.action', {
        ...request, reviewDigest: digest, confirmed: true,
      })).toMatchObject({ ok: false, error: { code: 'RUN_STALE' } });
      const updatedReview = await callControl(configDirectory, 'run.action.review', request);
      if (!updatedReview.ok) throw new Error('Updated review failed.');
      const updatedDigest = (updatedReview.result as { reviewDigest: string }).reviewDigest;
      const applied = await callControl(configDirectory, 'run.action', { ...request, reviewDigest: updatedDigest, confirmed: true });
      expect(applied).toMatchObject({
        ok: true, result: { run: { currentStepIndex: 0, steps: expect.arrayContaining([
          expect.objectContaining({ id: 'step-plan', status: 'skipped' }),
        ]) } },
      });
      expect(await callControl(configDirectory, 'run.action.review', { runId: run.id, action: 'next' }))
        .toMatchObject({ ok: false, error: { code: 'RUN_ACTION_NOT_ALLOWED' } });
      const orchestrator = await harness.app.loomRunOwner.get();
      const before = await orchestrator.getRunView(run.id);
      await postAction(harness.app, run.id, { action: 'next' });
      await expect(orchestrator.applyAction(run.id, {
        action: 'done', expectedRevision: runRevision(before.run),
      })).rejects.toMatchObject({ code: 'RUN_STALE' });
      await postAction(harness.app, run.id, { action: 'abort' });
    } finally {
      await control.close();
    }
  });

  it('applies explicit supervised outcomes and cleans up the PTY on completion', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId);
    const run = await createRun(harness.app, harness.projectId, chain);
    const healthDuring = await harness.app.inject({ method: 'GET', url: '/api/health' });
    expect(healthDuring.json()).toMatchObject({
      activeRun: { active: true, runId: run.id, status: 'awaiting-user' },
    });
    const pointerPath = join(configDirectory, 'active-run.json');
    const originalPointer = await readFile(pointerPath, 'utf8');
    const pointer = JSON.parse(originalPointer) as Record<string, unknown>;
    await writeFile(pointerPath, JSON.stringify({ ...pointer, status: 'paused' }));
    try {
      const liveHealth = await harness.app.inject({ method: 'GET', url: '/api/health' });
      expect(liveHealth.json()).toMatchObject({
        activeRun: { active: true, runId: run.id, status: 'awaiting-user' },
      });
    } finally {
      await writeFile(pointerPath, originalPointer);
    }

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
    const healthAfter = await harness.app.inject({ method: 'GET', url: '/api/health' });
    expect(healthAfter.json()).toMatchObject({
      activeRun: { active: false, runId: null, status: null },
    });

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
      const processStarted = await socket.next();
      expect(processStarted.type).toBe('process-started');
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
      async () => {
        const session = terminal.sessions.get(terminalIdFor(run.id));
        return session !== undefined && session !== firstTerminal && session.isRunning()
          ? session
          : null;
      },
      'the second automatic step PTY',
    );
    secondTerminal.emitData(OSC_WORKING);
    secondTerminal.emitData(OSC_IDLE);

    const completed = await waitForRunStatus(harness.app, run.id, 'completed');
    expect(completed.steps.map((step) => step.status)).toEqual(['done', 'done']);
    expect(completed.steps.every((step) => step.reason === 'COMPLETION_SIGNAL')).toBe(true);
    expect(terminal.closed).toContain(terminalIdFor(run.id));
    await waitFor(
      async () => (terminal.sessions.has(terminalIdFor(run.id)) ? null : true),
      'the automatic run terminal to be removed',
    );

    const active = (await getActiveRun(harness.app)).body as RunActiveState;
    expect(active.active).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('pauses an automatic run through a reviewed CLI action without advancing', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId);
    const run = await createRun(harness.app, harness.projectId, chain, { mode: 'automatic' });
    const control = await startControlServer(harness.configStore, {
      services: harness.app.loomServices, runOwner: harness.app.loomRunOwner,
    });
    try {
      const request = { runId: run.id, action: 'pause', reason: 'Pause after this step' };
      expect(await callControl(configDirectory, 'run.action.review', { runId: run.id, action: 'done' }))
        .toMatchObject({ ok: false, error: { code: 'RUN_ACTION_NOT_ALLOWED' } });
      const reviewed = await callControl(configDirectory, 'run.action.review', request);
      expect(reviewed.ok).toBe(true);
      if (!reviewed.ok) throw new Error('Review failed.');
      const digest = (reviewed.result as { reviewDigest: string }).reviewDigest;
      expect(await callControl(configDirectory, 'run.action', {
        ...request, reviewDigest: digest, confirmed: true,
      })).toMatchObject({ ok: true, result: { run: { status: 'paused', currentStepIndex: 0 } } });
      const session = terminal.sessions.get(terminalIdFor(run.id));
      expect(session?.isRunning()).toBe(true);
      session?.emitData(OSC_WORKING);
      session?.emitData(OSC_IDLE);
      const paused = await waitFor(async () => {
        const response = await getRunRecord(harness.app, run.id);
        const current = (response.body as { run: Run }).run;
        return current.steps[0]?.status === 'done' ? current : null;
      }, 'the paused automatic step to finish');
      expect(paused.status).toBe('paused');
      expect(paused.currentStepIndex).toBe(0);
      expect(paused.steps[1]?.status).toBe('pending');
      expect(await callControl(configDirectory, 'run.action.review', { runId: run.id, action: 'run-next' }))
        .toMatchObject({ ok: false, error: { code: 'RUN_ACTION_NOT_ALLOWED' } });
      expect((await postAction(harness.app, run.id, { action: 'abort' })).statusCode).toBe(200);
    } finally {
      await control.close();
    }
  });
});

describe('interrupted run recovery', () => {
  it('reconciles an interrupted legacy run through separately reviewed actions', async () => {
    const first = await buildTestApp();
    const chain = await createChain(first.app, first.projectId);
    const run = await createRun(first.app, first.projectId, chain);
    apps.splice(apps.indexOf(first.app), 1);
    await first.app.close();
    const second = await buildTestApp();
    const url = `/api/projects/${second.projectId}/coordination-action`;
    const confirmations = { stoppedConfirmed: true, oldClientsStoppedConfirmed: true };
    const apply = async (payload: Record<string, unknown>) => {
      const response = await second.app.inject({ method: 'POST', url, payload });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ applied: true });
    };
    let review = await reviewProjectCoordination(project);
    await apply({ action: 'enable', reviewDigest: review.reviewDigest, ...confirmations });
    review = await reviewProjectCoordination(project);
    await apply({ action: 'adopt', reviewDigest: review.reviewDigest, kind: 'managed', runId: run.id, ...confirmations });
    review = await reviewProjectCoordination(project);
    expect(review.claim).toMatchObject({ kind: 'managed', runId: run.id });
    await apply({ action: 'interrupt', reviewDigest: review.reviewDigest, runId: run.id, ...confirmations });
    review = await reviewProjectCoordination(project);
    await apply({ action: 'abandon', reviewDigest: review.reviewDigest, runId: run.id, abandonConfirmed: true, ...confirmations });
    review = await reviewProjectCoordination(project);
    expect(review.records).toEqual([expect.objectContaining({ runId: run.id, status: 'aborted', unresolved: false })]);
    expect(review.claim).not.toBeNull();
    await apply({ action: 'clear', reviewDigest: review.reviewDigest, ...confirmations });
    expect((await reviewProjectCoordination(project)).claim).toBeNull();
    expect(terminal.spawns).toHaveLength(1);
  });

  it.skipIf(process.platform === 'win32')('accepts reviewed coordination actions through the CLI', async () => {
    const harness = await buildTestApp();
    const control = await startControlServer(harness.configStore, {
      services: harness.app.loomServices, runOwner: harness.app.loomRunOwner,
    });
    try {
      const reviewed = await callControl(configDirectory, 'project.coordination.review', { projectId: harness.projectId });
      if (!reviewed.ok) throw new Error('Review failed.');
      const digest = (reviewed.result as { review: { reviewDigest: string } }).review.reviewDigest;
      let output = '';
      let error = '';
      const code = await runCli(['project', 'coordination-action', '--config-dir', configDirectory], {
        env: {}, stdin: Readable.from([JSON.stringify({
          projectId: harness.projectId,
          request: { action: 'enable', reviewDigest: digest, stoppedConfirmed: true, oldClientsStoppedConfirmed: true },
        })]),
        stdout: { write: (chunk) => { output += String(chunk); return true; }, isTTY: false },
        stderr: { write: (chunk) => { error += String(chunk); return true; } },
      });
      expect(code).toBe(0);
      expect(error).toBe('');
      expect(JSON.parse(output)).toMatchObject({ ok: true, result: { applied: true } });
      expect((await reviewProjectCoordination(project)).protocol).not.toBeNull();
    } finally {
      await control.close();
    }
  });

  it('refuses coordination changes while this service owns a live run', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId);
    const run = await createRun(harness.app, harness.projectId, chain);
    const review = await reviewProjectCoordination(project);
    const response = await harness.app.inject({
      method: 'POST', url: `/api/projects/${harness.projectId}/coordination-action`,
      payload: {
        action: 'enable', reviewDigest: review.reviewDigest,
        stoppedConfirmed: true, oldClientsStoppedConfirmed: true,
      },
    });
    expect(response.statusCode).toBe(409);
    expect(envelope(response.json()).error.code).toBe('PROJECT_COORDINATION_BUSY');
    expect((await reviewProjectCoordination(project)).protocol).toBeNull();
    expect(terminal.sessions.get(terminalIdFor(run.id))?.isRunning()).toBe(true);
    expect((await postAction(harness.app, run.id, { action: 'abort' })).statusCode).toBe(200);
  });

  it('does not auto-advance when protocol enablement wins the transition race', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId);
    const run = await createRun(harness.app, harness.projectId, chain, { mode: 'automatic' });
    const file = join(project, '.loom', 'runs', `${run.id}.json`);
    const before = await readFile(file, 'utf8');
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const enabling = withProjectClaimTransaction(project, async (tx) => {
      enter();
      await gate;
      tx.enableProtocol(CREATED_AT);
    });
    await entered;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const session = terminal.sessions.get(terminalIdFor(run.id));
      expect(session).toBeDefined();
      session?.emitData(OSC_WORKING);
      session?.emitData(OSC_IDLE);
      release();
      await enabling;
      await waitFor(async () => log.mock.calls.length > 0 ? true : null, 'blocked automatic transition to pause');
      expect(session?.isRunning()).toBe(false);
      expect(terminal.spawns).toHaveLength(1);
      expect(await readFile(file, 'utf8')).toBe(before);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('paused automatic run'));
      apps.splice(apps.indexOf(harness.app), 1);
      await expect(harness.app.close()).rejects.toThrow('could not be shut down cleanly');
      expect(await readFile(file, 'utf8')).toBe(before);
    } finally {
      release();
      await enabling;
      log.mockRestore();
    }
  });

  it('retains a managed claim through abort in an enabled project', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId);
    const review = await reviewProjectCoordination(project);
    await enableReviewedProjectProtocol(project, review.reviewDigest, true);
    const run = await createRun(harness.app, harness.projectId, chain);
    const claimed = await reviewProjectCoordination(project);
    expect(claimed.claim).toMatchObject({ kind: 'managed', runId: run.id });
    expect(claimed.records).toEqual([expect.objectContaining({ runId: run.id, unresolved: true })]);
    expect((await postAction(harness.app, run.id, { action: 'abort' })).statusCode).toBe(200);
    const after = await reviewProjectCoordination(project);
    expect(after.claim).toEqual(claimed.claim);
    expect(after.records).toEqual([expect.objectContaining({ runId: run.id, unresolved: false })]);
    const response = await postRun(harness.app, harness.projectId, {
      chainId: chain.id, inputs: { task: 'ship it' },
    });
    expect(response.statusCode).toBe(409);
    expect(envelope(response.body).error.code).toBe('PROJECT_CLAIM_CONFLICT');
  });

  it('blocks another profile from starting a managed run in a claimed project', async () => {
    const first = await buildTestApp();
    const chain = await createChain(first.app, first.projectId);
    const review = await reviewProjectCoordination(project);
    await enableReviewedProjectProtocol(project, review.reviewDigest, true);
    const run = await createRun(first.app, first.projectId, chain);
    const before = terminal.spawns.length;
    const second = await buildTestApp({ configDirectory: join(root, 'second-claim-profile') });
    const response = await postRun(second.app, second.projectId, {
      chainId: chain.id, inputs: { task: 'ship it' },
    });
    expect(response.statusCode).toBe(409);
    expect(envelope(response.body).error.code).toBe('PROJECT_CLAIM_CONFLICT');
    expect(terminal.spawns).toHaveLength(before);
    expect((await reviewProjectCoordination(project)).claim).toMatchObject({ kind: 'managed', runId: run.id });
    expect((await postAction(first.app, run.id, { action: 'abort' })).statusCode).toBe(200);
  });

  it('prevents managed and separate-process portable runs from claiming the same project', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId);
    const initial = await reviewProjectCoordination(project);
    await enableReviewedProjectProtocol(project, initial.reviewDigest, true);
    const bundlePath = join(root, 'portable-race.loom.json');
    await writeFile(bundlePath, JSON.stringify({
      format: 'skill-loom-chain', version: 1,
      chain: {
        name: 'Portable test', harness: 'opencode', sessionMode: 'shared',
        steps: [{ id: 'one', kind: 'instruction', instruction: 'Review.' }], inputs: [],
      },
      skills: [],
    }));
    const helper = (args: string[], input?: unknown) => new Promise<{ code: number | null; output: string; error: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [
        '--disable-warning=ExperimentalWarning',
        join(process.cwd(), '.github', 'skills', 'loom-run-bundle', 'scripts', 'loom-bundle.mjs'),
        ...args,
      ], { stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      let error = '';
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { error += chunk.toString(); });
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, output, error }));
      child.stdin.end(input === undefined ? '' : JSON.stringify(input));
    });
    const inspect = await helper(['inspect', '--bundle', bundlePath, '--project', project]);
    expect(inspect.code, inspect.error).toBe(0);
    const reviewDigest = (JSON.parse(inspect.output) as { reviewDigest: string }).reviewDigest;
    const prepareInput = {
      reviewDigest, installConfirmed: true, actualHost: 'opencode', progression: 'supervised', inputs: {},
      sessionDecision: {
        requested: 'shared', mechanism: 'current-conversation', description: 'Current conversation.', confirmed: true,
      },
    };
    const prepared = await helper(['prepare', '--bundle', bundlePath, '--project', project], prepareInput);
    expect(prepared.code, prepared.error).toBe(0);
    const portableRun = JSON.parse(prepared.output) as { runId: string; revision: number };
    const before = terminal.spawns.length;
    const blockedManaged = await postRun(harness.app, harness.projectId, {
      chainId: chain.id, inputs: { task: 'ship it' },
    });
    expect(blockedManaged.statusCode).toBe(409);
    expect(envelope(blockedManaged.body).error.code).toBe('PROJECT_CLAIM_CONFLICT');
    expect(terminal.spawns).toHaveLength(before);
    const aborted = await helper(['record', '--project', project, '--run-id', portableRun.runId], {
      revision: portableRun.revision, action: 'abort',
    });
    expect(aborted.code, aborted.error).toBe(0);
    const portableReview = await reviewProjectCoordination(project);
    expect(portableReview.claim).toMatchObject({ kind: 'portable', runId: portableRun.runId });
    await clearReviewedProjectClaim(project, portableReview.reviewDigest, true, true);
    const managedRun = await createRun(harness.app, harness.projectId, chain);
    const newInspect = await helper(['inspect', '--bundle', bundlePath, '--project', project]);
    expect(newInspect.code, newInspect.error).toBe(0);
    const blockedPortable = await helper(['prepare', '--bundle', bundlePath, '--project', project], {
      ...prepareInput, reviewDigest: (JSON.parse(newInspect.output) as { reviewDigest: string }).reviewDigest,
    });
    expect(blockedPortable.code).toBe(1);
    expect(JSON.parse(blockedPortable.error)).toMatchObject({ error: { code: 'PROJECT_CLAIM_CONFLICT' } });
    expect((await reviewProjectCoordination(project)).claim).toMatchObject({ kind: 'managed', runId: managedRun.id });
    expect((await postAction(harness.app, managedRun.id, { action: 'abort' })).statusCode).toBe(200);
  });

  it('retains a managed claim across automatic transitions and completion', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId);
    const review = await reviewProjectCoordination(project);
    await enableReviewedProjectProtocol(project, review.reviewDigest, true);
    const run = await createRun(harness.app, harness.projectId, chain, { mode: 'automatic' });
    const claimed = (await reviewProjectCoordination(project)).claim;
    expect(claimed).toMatchObject({ kind: 'managed', runId: run.id });
    const first = terminal.sessions.get(terminalIdFor(run.id));
    expect(first).toBeDefined();
    first?.emitData(OSC_WORKING);
    first?.emitData(OSC_IDLE);
    const second = await waitFor(async () => {
      const session = terminal.sessions.get(terminalIdFor(run.id));
      return session !== undefined && session !== first && session.isRunning() ? session : null;
    }, 'coordinated second step');
    expect((await reviewProjectCoordination(project)).claim).toEqual(claimed);
    second.emitData(OSC_WORKING);
    second.emitData(OSC_IDLE);
    const completed = await waitForRunStatus(harness.app, run.id, 'completed');
    expect(completed.steps.map((step) => step.status)).toEqual(['done', 'done']);
    const after = await reviewProjectCoordination(project);
    expect(after.claim).toEqual(claimed);
    expect(after.records).toEqual([expect.objectContaining({ runId: run.id, unresolved: false })]);
  });

  it('retains a managed claim when harness startup fails', async () => {
    const harness = await buildTestApp();
    const chain = await createChain(harness.app, harness.projectId);
    const review = await reviewProjectCoordination(project);
    await enableReviewedProjectProtocol(project, review.reviewDigest, true);
    const spawn = vi.spyOn(terminal, 'createSession').mockImplementationOnce(() => {
      throw new Error('injected terminal failure');
    });
    try {
      const response = await postRun(harness.app, harness.projectId, {
        chainId: chain.id, inputs: { task: 'ship it' },
      });
      expect(response.statusCode).not.toBe(201);
      const after = await reviewProjectCoordination(project);
      expect(after.claim).toMatchObject({ kind: 'managed' });
      expect(after.records).toEqual([expect.objectContaining({
        kind: 'managed', runId: after.claim?.runId,
      })]);
      expect(terminal.spawns).toHaveLength(0);
    } finally {
      spawn.mockRestore();
    }
  });

  it('retains the claim through shutdown and explicitly retries the interrupted run', async () => {
    const first = await buildTestApp();
    const chain = await createChain(first.app, first.projectId);
    const review = await reviewProjectCoordination(project);
    await enableReviewedProjectProtocol(project, review.reviewDigest, true);
    const run = await createRun(first.app, first.projectId, chain);
    const claim = (await reviewProjectCoordination(project)).claim;
    apps.splice(apps.indexOf(first.app), 1);
    await first.app.close();
    expect((await reviewProjectCoordination(project)).claim).toEqual(claim);

    const second = await buildTestApp();
    const view = runView((await getRunRecord(second.app, run.id)).body);
    expect(view.run.status).toBe('interrupted');
    expect(view.recovery).toMatchObject({ retry: true, restart: false });
    const restart = await postAction(second.app, run.id, { action: 'restart' });
    expect(restart.statusCode).toBe(409);
    expect(envelope(restart.body).error.code).toBe('RUN_COORDINATION_REQUIRED');
    expect((await postAction(second.app, run.id, { action: 'retry' })).statusCode).toBe(200);
    expect((await reviewProjectCoordination(project)).claim).toEqual(claim);
    expect((await postAction(second.app, run.id, { action: 'abort' })).statusCode).toBe(200);
  });

  it('retains a stale pointer to a terminal run when coordination requires review', async () => {
    const first = await buildTestApp();
    const chain = await createChain(first.app, first.projectId);
    const run = await createRun(first.app, first.projectId, chain);
    const pointer = await readFile(join(configDirectory, 'active-run.json'), 'utf8');
    expect((await postAction(first.app, run.id, { action: 'abort' })).statusCode).toBe(200);
    const review = await reviewProjectCoordination(project);
    await enableReviewedProjectProtocol(project, review.reviewDigest, true);

    const otherConfigDirectory = join(root, 'terminal-claimed-profile');
    const otherConfig = createConfigStore({
      env: { LOOM_CONFIG_DIR: otherConfigDirectory },
      homeDirectory: () => home,
    });
    await createProjectRegistry({ configStore: otherConfig }).openProject(project);
    await writeFile(join(otherConfigDirectory, 'active-run.json'), pointer);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await buildTestApp({ configDirectory: otherConfigDirectory });
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('RUN_RECOVERY_CLAIMED'));
      expect(await readFile(join(otherConfigDirectory, 'active-run.json'), 'utf8')).toBe(pointer);
    } finally {
      warning.mockRestore();
    }
  });

  it('reports a claimed run and preserves it when another profile has a matching pointer', async () => {
    const first = await buildTestApp();
    const chain = await createChain(first.app, first.projectId);
    const run = await createRun(first.app, first.projectId, chain);
    const otherConfigDirectory = join(root, 'claimed-profile');
    const otherConfig = createConfigStore({
      env: { LOOM_CONFIG_DIR: otherConfigDirectory },
      homeDirectory: () => home,
    });
    await createProjectRegistry({ configStore: otherConfig }).openProject(project);
    const pointer = await readFile(join(configDirectory, 'active-run.json'), 'utf8');
    await writeFile(join(otherConfigDirectory, 'active-run.json'), pointer);
    const beforeEnable = await reviewProjectCoordination(project);
    await enableReviewedProjectProtocol(project, beforeEnable.reviewDigest, true);
    const beforeAdoption = await reviewProjectCoordination(project);
    await adoptReviewedLegacyRun(project, { kind: 'managed', runId: run.id }, beforeAdoption.reviewDigest, true, true);
    const file = join(project, '.loom', 'runs', `${run.id}.json`);
    const original = await readFile(file, 'utf8');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await buildTestApp({ configDirectory: otherConfigDirectory });
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('RUN_RECOVERY_CLAIMED'));
      expect(await readFile(file, 'utf8')).toBe(original);
      expect(await readFile(join(otherConfigDirectory, 'active-run.json'), 'utf8')).toBe(pointer);
      expect((await getActiveRun(first.app)).body).toMatchObject({ active: true, runId: run.id });
      expect((await postAction(first.app, run.id, { action: 'abort' })).statusCode).toBe(200);
    } finally {
      warning.mockRestore();
    }
  });

  it('does not interrupt a live run when a different profile starts with the same project', async () => {
    const first = await buildTestApp();
    const chain = await createChain(first.app, first.projectId);
    const run = await createRun(first.app, first.projectId, chain);
    const file = join(project, '.loom', 'runs', `${run.id}.json`);
    const original = await readFile(file, 'utf8');

    const otherConfigDirectory = join(root, 'other-profile');
    const otherConfig = createConfigStore({
      env: { LOOM_CONFIG_DIR: otherConfigDirectory },
      homeDirectory: () => home,
    });
    await createProjectRegistry({ configStore: otherConfig }).openProject(project);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const second = await buildTestApp({ configDirectory: otherConfigDirectory });
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('RUN_RECOVERY_AMBIGUOUS'));
      expect(await readFile(file, 'utf8')).toBe(original);
      expect((await getActiveRun(first.app)).body).toMatchObject({
        active: true, runId: run.id,
      });
      expect((await getRunRecord(second.app, run.id)).body).toMatchObject({
        run: { id: run.id, status: 'awaiting-user' },
      });
      expect((await postAction(second.app, run.id, { action: 'done' })).statusCode).toBe(409);
      expect((await postAction(first.app, run.id, { action: 'done' })).statusCode).toBe(200);
      expect((await postAction(first.app, run.id, { action: 'abort' })).statusCode).toBe(200);
    } finally {
      warning.mockRestore();
    }
  });

  async function simulateRestart(instructionOnly = false): Promise<{
    first: AppHarness;
    second: AppHarness;
    chain: Chain;
    run: Run;
  }> {
    const first = await buildTestApp();
    const chain = await createChain(first.app, first.projectId, instructionOnly ? {
      steps: [
        { id: 'one', kind: 'instruction', instruction: 'Review {{task}}.' },
        { id: 'two', kind: 'instruction', instruction: 'Summarize {{task}}.' },
      ],
    } : {});
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

  it.skipIf(process.platform === 'win32')('requires reviewed execution and replay approval for interrupted retry', async () => {
    const { second, run } = await simulateRestart(true);
    const control = await startControlServer(second.configStore, {
      services: second.app.loomServices, runOwner: second.app.loomRunOwner,
    });
    try {
      const request = { runId: run.id, action: 'retry' };
      const review = await callControl(configDirectory, 'run.action.review', request);
      expect(review).toMatchObject({ ok: true, result: { evidence: {
        preflight: { startAllowed: true }, action: 'retry',
      } } });
      if (!review.ok) throw new Error('Review failed.');
      const digest = (review.result as { reviewDigest: string }).reviewDigest;
      expect(await callControl(configDirectory, 'run.action', {
        ...request, reviewDigest: digest, confirmed: true, executionConfirmed: true,
      })).toMatchObject({ ok: false, error: { code: 'RUN_REPLAY_CONFIRMATION_REQUIRED' } });
      expect((await getActiveRun(second.app)).body).toMatchObject({ active: false });
      expect(await callControl(configDirectory, 'run.action', {
        ...request, reviewDigest: digest, confirmed: true, executionConfirmed: true, replayConfirmed: true,
      })).toMatchObject({ ok: true, result: { run: { id: run.id, status: 'awaiting-user', currentStepIndex: 0 } } });
      expect((await postAction(second.app, run.id, { action: 'abort' })).statusCode).toBe(200);
    } finally {
      await control.close();
    }
  });

  it.skipIf(process.platform === 'win32').each(['continue', 'restart'] as const)(
    'reviews interrupted %s without implicit replay',
    async (action) => {
      const { second, run } = await simulateRestart(true);
      const control = await startControlServer(second.configStore, {
        services: second.app.loomServices, runOwner: second.app.loomRunOwner,
      });
      try {
        const request = { runId: run.id, action };
        const review = await callControl(configDirectory, 'run.action.review', request);
        if (!review.ok) throw new Error('Review failed.');
        const digest = (review.result as { reviewDigest: string }).reviewDigest;
        if (action === 'restart') {
          expect(await callControl(configDirectory, 'run.action', {
            ...request, reviewDigest: digest, confirmed: true, executionConfirmed: true,
          })).toMatchObject({ ok: false, error: { code: 'RUN_REPLAY_CONFIRMATION_REQUIRED' } });
        }
        const resumed = await callControl(configDirectory, 'run.action', {
          ...request, reviewDigest: digest, confirmed: true, executionConfirmed: true,
          ...(action === 'restart' ? { replayConfirmed: true } : {}),
        });
        expect(resumed).toMatchObject({ ok: true, result: {
          run: { status: 'awaiting-user', currentStepIndex: action === 'continue' ? 1 : 0 },
          restartedFrom: action === 'restart' ? run.id : null,
        } });
        if (!resumed.ok) throw new Error('Recovery failed.');
        const resumedId = (resumed.result as { run: Run }).run.id;
        expect((await postAction(second.app, resumedId, { action: 'abort' })).statusCode).toBe(200);
      } finally {
        await control.close();
      }
    },
  );

  it('allows only one concurrent interrupted retry to start a harness', async () => {
    const { second, run } = await simulateRestart(true);
    const previousSpawns = terminal.spawns.length;
    const responses = await Promise.all([
      postAction(second.app, run.id, { action: 'retry' }),
      postAction(second.app, run.id, { action: 'retry' }),
    ]);
    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode !== 200)).toHaveLength(1);
    expect(terminal.spawns.length - previousSpawns).toBe(1);
    expect((await postAction(second.app, run.id, { action: 'abort' })).statusCode).toBe(200);
  });

  it.skipIf(process.platform === 'win32')('does not replay twice when UI and reviewed CLI recovery race', async () => {
    const { second, run } = await simulateRestart(true);
    const control = await startControlServer(second.configStore, {
      services: second.app.loomServices, runOwner: second.app.loomRunOwner,
    });
    try {
      const request = { runId: run.id, action: 'retry' };
      const review = await callControl(configDirectory, 'run.action.review', request);
      if (!review.ok) throw new Error('Review failed.');
      const digest = (review.result as { reviewDigest: string }).reviewDigest;
      const before = terminal.spawns.length;
      const [cli, ui] = await Promise.all([
        callControl(configDirectory, 'run.action', {
          ...request, reviewDigest: digest, confirmed: true, executionConfirmed: true, replayConfirmed: true,
        }),
        postAction(second.app, run.id, { action: 'retry' }),
      ]);
      expect([cli.ok, ui.statusCode === 200].filter(Boolean)).toHaveLength(1);
      expect(terminal.spawns.length - before).toBe(1);
      expect((await postAction(second.app, run.id, { action: 'abort' })).statusCode).toBe(200);
    } finally {
      await control.close();
    }
  });

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
