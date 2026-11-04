/**
 * RUN-08 / RUN-FR-13 — live execution probe.
 *
 * Builds a disposable project under the user's cache directory with one probe
 * skill for each harness, then proves the real installed CLIs can:
 *
 * - OpenCode 2.2.5: run an interactive seeded prompt in a PTY, return the probe
 *   token, emit OSC 7501 `working` then `idle`, and recall the token in a second
 *   process using the same `ses_` session id.
 * - Copilot CLI 1.0.105: resolve folder trust, run a headless seeded prompt with
 *   the documented broad flags, return the probe token, and recall the token in
 *   a second process using the same UUID session id.
 *
 * Every failure is explicit: a missing CLI, an unauthenticated harness, an
 * unresolved trust gate, a missing token, a missing signal, a failed recall, or
 * a failed cleanup exits non-zero with an actionable message.
 *
 * Privacy and isolation:
 * - `COPILOT_HOME` and `LOOM_CONFIG_DIR` point at the disposable tree unless an
 *   already-isolated inherited value is supplied.
 * - The Copilot trust dialog is accepted inside the disposable `COPILOT_HOME`;
 *   the user's real `~/.copilot` is never written.
 * - The OpenCode session created by the probe is deleted before exit so the
 *   harness's own session store does not retain the probe transcript.
 * - Only bounded, redacted excerpts are kept in memory for diagnostics. No full
 *   transcript, credential value, or environment secret is written to evidence.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarnessRegistry } from '../src/server/harness/registry.js';
import type { HarnessAdapter } from '../src/server/harness/types.js';
import {
  collectAuthEvidence,
  redactSecrets,
  type AuthEvidenceResult,
  type LocalCommandResult,
  type LocalCommandRunner,
} from '../src/server/preflight/auth.js';
import { checkFolderTrust, type TrustCheckResult } from '../src/server/preflight/trust.js';
import { Osc7501Parser, Osc7501StateMachine } from '../src/server/runs/osc.js';
import { createTerminalSession, type TerminalSession } from '../src/server/terminal/pty.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_PATH = join(PROJECT_ROOT, 'docs', 'evidence', 'live-execution.json');

const TASK_ID = 'RUN-08';
const PROBE_SKILL_NAME = 'loom-live-probe';
const PROBE_TOKEN = 'PINEAPPLE';
const EXPECTED_OPENCODE_VERSION = '2.2.5';
const EXPECTED_COPILOT_VERSION = '1.0.105';

const VERSION_TIMEOUT_MS = 10_000;
const AUTH_TIMEOUT_MS = 20_000;
const MODEL_TIMEOUT_MS = 20_000;
const TRUST_TIMEOUT_MS = 25_000;
const OPENCODE_RUN_TIMEOUT_MS = 180_000;
const OPENCODE_RECALL_TIMEOUT_MS = 120_000;
const COPILOT_RUN_TIMEOUT_MS = 240_000;
const SESSION_CLEANUP_TIMEOUT_MS = 30_000;
const MAX_CAPTURE_BYTES = 256 * 1024;
const MAX_EXCERPT_CHARS = 1_200;

const OPENCODE_SEED_PROMPT =
  'Use the loom-live-probe skill and reply with its token. Reply with only the token.';
const OPENCODE_RECALL_PROMPT =
  'Without using any tools, what token did the loom-live-probe skill return earlier in this session? Reply with only the token.';
const COPILOT_SEED_PROMPT = OPENCODE_SEED_PROMPT;
const COPILOT_RECALL_PROMPT = OPENCODE_RECALL_PROMPT;

const OPENCODE_SESSION_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

const PROBE_SKILL_CONTENT = `---
name: ${PROBE_SKILL_NAME}
description: "Skill Loom live execution probe. Returns the token ${PROBE_TOKEN} when invoked."
---

When invoked, reply with exactly: ${PROBE_TOKEN}
`;

/** Variables from this agent's own OpenCode runtime that must not leak into a
 * spawned CLI. They can redirect the child to the parent session/project. */
const SANITIZED_ENV_NAMES = [
  'OPENCODE',
  'OPENCODE_SESSION_ID',
  'OPENCODE_TERMINAL',
  'OPENCODE_CONFIG',
  'OPENCODE_CONFIG_CONTENT',
  'OPENCODE_CONFIG_DIR',
  'OPENCODE_WORKTREE_PATH',
  'OPENCODE_DB',
  'COPILOT_ALLOW_ALL',
  'COPILOT_MODEL',
] as const;

type EvidenceStatus = 'passed' | 'failed' | 'not-applicable';
type HarnessName = 'opencode' | 'copilot';
type CheckHarness = HarnessName | 'environment';
type OpenCodeParamFormat = 'colon' | 'semicolon' | 'unknown';
type FailureClass = 'none' | 'auth' | 'trust' | 'limit' | 'command' | 'timeout' | 'token-missing';

interface CheckRecord {
  id: string;
  harness: CheckHarness;
  description: string;
  expected: string;
  observed: string;
  status: EvidenceStatus;
  passed: boolean;
  durationMs?: number;
  remediation?: string;
  excerpt?: string;
}

interface EvidenceWarning {
  code: string;
  harness: CheckHarness;
  message: string;
}

interface VersionProbe {
  executable: string;
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  version: string | null;
  expectedVersion: string;
  versionMatches: boolean;
  available: boolean;
  errorCode?: string;
}

interface AuthSummary {
  harness: HarnessName;
  state: AuthEvidenceResult['state'];
  reason: AuthEvidenceResult['reason'];
  loginHint: string;
  evidence: AuthEvidenceResult['evidence'];
}

interface IsolationEvidence {
  temporaryRoot: string;
  cacheRootMode: 'XDG_CACHE_HOME' | 'home-cache';
  copilotHomeMode: 'isolated' | 'inherited';
  loomConfigDirMode: 'isolated' | 'inherited';
  environmentVariablesSet: string[];
  sanitizedEnvironmentVariables: string[];
}

interface SignalEvidence {
  working: boolean;
  idle: boolean;
  clear: boolean;
  workingBeforeIdle: boolean;
  workingEventCount: number;
  idleEventCount: number;
  clearEventCount: number;
  sequence: string[];
  sessionIdFromSignal: string | null;
  firstWorkingAtMs: number | null;
  firstIdleAfterWorkingAtMs: number | null;
  paramFormat: OpenCodeParamFormat;
  productParser: {
    eventCount: number;
    recognized: boolean;
  };
  productStateMachine: {
    sawWorking: boolean;
    completed: boolean;
    state: string;
  };
}

interface InteractiveRunResult {
  sessionId: string;
  durationMs: number;
  exitCode: number | null;
  exitSignal: number | null;
  timedOut: boolean;
  forcedKill: boolean;
  tokenObserved: boolean;
  signal: SignalEvidence;
  failureClass: FailureClass;
  failureExcerpt?: string;
}

interface SeededRunEvidence {
  passed: boolean;
  tokenObserved: boolean;
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
  forcedKill: boolean;
  skillAvailable: boolean;
}

interface RecallEvidence {
  passed: boolean;
  tokenObserved: boolean;
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
  forcedKill: boolean;
  probeSkillPresent: boolean;
}

interface OpenCodeEvidence {
  harness: 'opencode';
  version: string | null;
  expectedVersion: string;
  versionMatches: boolean;
  sessionId: string;
  sessionMode: 'shared';
  model: string | null;
  modelSource: 'environment' | 'authenticated-provider' | 'default';
  command: {
    executable: string;
    args: string[];
    cwd: string;
  };
  seededPrompt: SeededRunEvidence;
  signal: SignalEvidence;
  recall: RecallEvidence;
  cleanup: {
    sessionsCreated: string[];
    sessionsDeleted: boolean;
    sessionsStillPresent: string[];
  };
}

interface CopilotHeadlessResult {
  sessionId: string;
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
  tokenObserved: boolean;
  skillObserved: boolean;
  failureClass: FailureClass;
  failureExcerpt?: string;
}

interface CopilotTrustEvidence {
  resolved: boolean;
  state: TrustCheckResult['state'];
  reason: TrustCheckResult['reason'];
  mechanism: 'dialog' | 'preexisting' | 'failed';
  durationMs: number;
  configPath: string | null;
  manualFallback: string;
  sentSelectionKeys: boolean;
  outputClassified:
    | 'trust-dialog'
    | 'already-trusted'
    | 'auth-required'
    | 'timeout'
    | 'exited';
}

interface CopilotEvidence {
  harness: 'copilot';
  version: string | null;
  expectedVersion: string;
  versionMatches: boolean;
  sessionId: string;
  copilotHomeMode: 'isolated' | 'inherited';
  trust: CopilotTrustEvidence;
  seededPrompt: SeededRunEvidence & {
    exitCode: number | null;
    skillObserved: boolean;
    skillObservation: 'observed' | 'not-observable';
    broadPermissions: string[];
  };
  recall: RecallEvidence;
  command: {
    executable: string;
    args: string[];
    cwd: string;
  };
}

interface CleanupRecord {
  attempted: boolean;
  temporaryRootRemoved: boolean;
  temporaryRoot: string | null;
  processesRemaining: number;
  ptySessionsRemaining: number;
  opencodeSessions: Array<{
    sessionId: string;
    existed: boolean;
    deleted: boolean;
    verifiedAbsent: boolean;
  }>;
  opencodeSessionCleanupPassed: boolean;
  error?: string;
}

interface ExecutionEvidence {
  version: 1;
  taskId: typeof TASK_ID;
  generatedAt: string;
  node: string;
  platform: string;
  loomVersion: string | null;
  durationMs: number;
  result: 'passed' | 'failed' | 'interrupted';
  isolation: IsolationEvidence;
  prerequisites: { opencode: VersionProbe; copilot: VersionProbe } | null;
  auth: { opencode: AuthSummary | null; copilot: AuthSummary | null };
  harnesses: { opencode?: OpenCodeEvidence; copilot?: CopilotEvidence };
  checks: CheckRecord[];
  warnings: EvidenceWarning[];
  cleanup: CleanupRecord;
  limitations: string[];
}

interface MutableReport {
  startedAt: number;
  checks: CheckRecord[];
  warnings: EvidenceWarning[];
  harnesses: { opencode?: OpenCodeEvidence; copilot?: CopilotEvidence };
  limitations: string[];
  isolation: IsolationEvidence;
  auth: { opencode: AuthSummary | null; copilot: AuthSummary | null };
}

interface TrackedCommandOptions {
  cwd?: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

interface TrackedCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  signal: NodeJS.Signals | null;
  errorCode?: string;
}

interface Isolation {
  evidence: IsolationEvidence;
  copilotHome: string;
  loomConfigDir: string;
  childEnv: NodeJS.ProcessEnv;
  cacheRootMode: 'XDG_CACHE_HOME' | 'home-cache';
}

interface ProbeOscEvent {
  readonly state: 'working' | 'idle' | 'clear';
  readonly sessionId: string | null;
  readonly atMs: number;
  readonly format: OpenCodeParamFormat;
}

interface OpenCodeModelSelection {
  model: string | null;
  source: 'environment' | 'authenticated-provider' | 'default';
  authenticatedProviderCount: number;
}

/* ------------------------------------------------------------------------- */
/* Process and PTY tracking                                                  */
/* ------------------------------------------------------------------------- */

class InterruptedError extends Error {
  constructor() {
    super('The live execution probe was interrupted.');
    this.name = 'InterruptedError';
  }
}

const activeChildren = new Set<ChildProcess>();
const activeSessions = new Set<TerminalSession>();
const createdOpenCodeSessions = new Set<string>();
let temporaryRoot: string | undefined;
let temporaryRootRemovedSync = false;
let cleanupPromise: Promise<CleanupRecord> | undefined;
let interruptedBy: 'SIGINT' | 'SIGTERM' | undefined;
let childEnvValue: NodeJS.ProcessEnv | undefined;
let replacementsValue: Array<[string, string]> = [];

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

function throwIfInterrupted(): void {
  if (interruptedBy !== undefined) {
    throw new InterruptedError();
  }
}

function killChildTree(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (pid !== undefined && process.platform !== 'win32') {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // The process group may already be gone; fall back to the direct child.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // A child can exit between the check and the signal.
  }
}

function killSessionTree(session: TerminalSession, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32') {
    try {
      process.kill(-session.pid, signal);
      return;
    } catch {
      // The PTY child may not be a process-group leader; fall back below.
    }
  }
  try {
    session.kill(signal);
  } catch {
    // A PTY child can exit between the check and the signal.
  }
}

async function waitForChildrenToExit(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (activeChildren.size > 0 && Date.now() < deadline) {
    await delay(20);
  }
}

async function waitForSessionsToExit(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (runningSessions().length > 0 && Date.now() < deadline) {
    await delay(20);
  }
}

function runningSessions(): TerminalSession[] {
  return [...activeSessions].filter((session) => session.isRunning());
}

async function terminateActiveChildren(): Promise<void> {
  if (activeChildren.size === 0) {
    return;
  }
  for (const child of activeChildren) {
    killChildTree(child, 'SIGTERM');
  }
  await waitForChildrenToExit(250);
  if (activeChildren.size > 0) {
    for (const child of activeChildren) {
      killChildTree(child, 'SIGKILL');
    }
    await waitForChildrenToExit(250);
  }
}

async function terminateActiveSessions(): Promise<void> {
  const sessions = runningSessions();
  if (sessions.length === 0) {
    return;
  }
  for (const session of sessions) {
    killSessionTree(session, 'SIGTERM');
  }
  await waitForSessionsToExit(300);
  for (const session of runningSessions()) {
    killSessionTree(session, 'SIGKILL');
  }
  await waitForSessionsToExit(300);
}

/* ------------------------------------------------------------------------- */
/* Bounded command execution                                                 */
/* ------------------------------------------------------------------------- */

function runTrackedCommand(
  executable: string,
  args: readonly string[],
  options: TrackedCommandOptions,
): Promise<TrackedCommandResult> {
  return new Promise((resolvePromise) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let killHandle: NodeJS.Timeout | undefined;
    let child: ChildProcess | undefined;

    const finish = (
      exitCode: number | null,
      signal: NodeJS.Signals | null,
      errorCode?: string,
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      if (killHandle !== undefined) {
        clearTimeout(killHandle);
      }
      if (child !== undefined) {
        activeChildren.delete(child);
      }

      const result: TrackedCommandResult = {
        exitCode,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - startedAt,
        signal,
      };
      if (errorCode !== undefined) {
        result.errorCode = errorCode;
      }
      resolvePromise(result);
    };

    try {
      child = spawn(executable, [...args], {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      const result: TrackedCommandResult = {
        exitCode: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        durationMs: Date.now() - startedAt,
        signal: null,
      };
      const code = errnoCode(error);
      if (code !== undefined) {
        result.errorCode = code;
      }
      resolvePromise(result);
      return;
    }

    activeChildren.add(child);

    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (stdoutBytes >= MAX_CAPTURE_BYTES) {
        return;
      }
      const text = chunk.toString();
      const remaining = MAX_CAPTURE_BYTES - stdoutBytes;
      const appended = text.slice(0, remaining);
      stdout += appended;
      stdoutBytes += Buffer.byteLength(appended);
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      if (stderrBytes >= MAX_CAPTURE_BYTES) {
        return;
      }
      const text = chunk.toString();
      const remaining = MAX_CAPTURE_BYTES - stderrBytes;
      const appended = text.slice(0, remaining);
      stderr += appended;
      stderrBytes += Buffer.byteLength(appended);
    });

    timeoutHandle = setTimeout(() => {
      if (settled || child === undefined) {
        return;
      }
      timedOut = true;
      killChildTree(child, 'SIGTERM');
      killHandle = setTimeout(() => {
        if (!settled && child !== undefined) {
          killChildTree(child, 'SIGKILL');
        }
      }, 250);
    }, options.timeoutMs);

    child.on('error', (error) => {
      finish(null, null, errnoCode(error));
    });

    child.on('close', (exitCode, signal) => {
      finish(exitCode, signal);
    });
  });
}

function createLocalRunner(env: NodeJS.ProcessEnv): LocalCommandRunner {
  return async (request): Promise<LocalCommandResult> => {
    const result = await runTrackedCommand(request.executable, request.args, {
      cwd: request.cwd,
      env: request.env ?? env,
      timeoutMs: request.timeoutMs,
    });
    return {
      exitCode: result.exitCode,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
      spawnError: result.errorCode ?? null,
    };
  };
}

/* ------------------------------------------------------------------------- */
/* Text safety                                                               */
/* ------------------------------------------------------------------------- */

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed === '' ? undefined : trimmed;
}

function errnoCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code !== '') {
      return code;
    }
  }
  return undefined;
}

function sanitize(value: string, replacements: Array<[string, string]>): string {
  let result = value;
  for (const [search, replacement] of replacements) {
    if (search !== '') {
      result = result.split(search).join(replacement);
    }
  }
  return result;
}

function sanitizeError(error: unknown, replacements: Array<[string, string]>): string {
  const message = error instanceof Error ? error.message : String(error);
  return sanitize(message, replacements);
}

function stripAnsi(value: string): string {
  return value
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[()][A-Za-z0-9]/g, '')
    .replace(/\x1b[=>]/g, '');
}

function redactProbeText(value: string): string {
  return redactSecrets(value)
    .split(PROBE_TOKEN)
    .join('<probe-token>')
    .replace(/\b(?:ghp_|github_pat_|gho_|ghu_|ghs_|ghr_|sk-)[A-Za-z0-9_-]{8,}\b/g, '<redacted>');
}

function boundedExcerpt(
  value: string,
  replacements: Array<[string, string]>,
): string {
  if (value.trim() === '') {
    return '';
  }
  const stripped = stripAnsi(value);
  const lines = stripped.split(/\r?\n/).filter((line) => line.trim() !== '');
  const tail = lines.slice(-20).join('\n');
  const redacted = redactProbeText(sanitize(tail, replacements));
  return redacted.slice(-MAX_EXCERPT_CHARS);
}

function classifyFailure(combined: string): FailureClass {
  if (/free usage limit|rate limit|quota|limit reached|too many requests|429/i.test(combined)) {
    return 'limit';
  }
  if (
    /not (?:logged|signed) in|not authenticated|unauthenticated|authentication (?:failed|required)|please (?:log|sign) in|run ['"]?copilot login|unauthorized|\b401\b/i.test(
      combined,
    )
  ) {
    return 'auth';
  }
  if (/untrusted folder|folder (?:is )?not trusted|trust (?:is )?required|confirm folder trust/i.test(combined)) {
    return 'trust';
  }
  return 'command';
}

/* ------------------------------------------------------------------------- */
/* OSC 7501 probe parser                                                     */
/* ------------------------------------------------------------------------- */

/**
 * Buffered OSC 7501 parser used by the probe.
 *
 * The installed OpenCode 2.2.5 emits colon-separated parameters such as
 * `OSC 7501;state=working:app=opencode:title=...`. The product parser splits
 * parameters on `;`, so the probe keeps an equivalent parser here that accepts
 * both separators and records the live format for the evidence file. This is a
 * probe assertion helper only; the product parser is not modified.
 */
class ProbeOsc7501Parser {
  private buffer = '';
  private readonly maxBufferBytes: number;
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now(), maxBufferBytes = 64 * 1024) {
    this.now = now;
    this.maxBufferBytes = maxBufferBytes;
  }

  push(chunk: string): ProbeOscEvent[] {
    this.buffer += chunk;
    const events: ProbeOscEvent[] = [];

    while (this.buffer.length > 0) {
      const start = this.buffer.indexOf('\x1b]7501;');
      if (start < 0) {
        this.buffer = keepPossiblePrefix(this.buffer);
        return events;
      }
      if (start > 0) {
        this.buffer = this.buffer.slice(start);
      }

      const scan = scanTerminator(this.buffer, '\x1b]7501;'.length);
      if (scan.kind === 'incomplete') {
        this.buffer = this.buffer.length <= this.maxBufferBytes ? this.buffer : '';
        return events;
      }
      if (scan.kind === 'malformed') {
        this.buffer = this.buffer.slice(scan.index);
        continue;
      }

      const params = this.buffer.slice('\x1b]7501;'.length, scan.index);
      const event = this.parseParams(params);
      if (event !== null) {
        events.push(event);
      }
      this.buffer = this.buffer.slice(scan.index + scan.length);
    }

    return events;
  }

  private parseParams(params: string): ProbeOscEvent | null {
    const trimmed = params.trim();
    if (trimmed === '' || trimmed === '?') {
      return null;
    }

    const format: OpenCodeParamFormat = trimmed.includes(':') ? 'colon' : 'semicolon';
    const fields = trimmed.split(/[;:]/);
    let state: 'working' | 'idle' | 'clear' | null = null;
    let sessionId: string | null = null;

    for (const field of fields) {
      const separator = field.indexOf('=');
      if (separator <= 0) {
        continue;
      }
      const key = field.slice(0, separator).trim().toLowerCase();
      const value = field.slice(separator + 1).trim();

      if (key === 'state') {
        const candidate = value.toLowerCase();
        if (candidate === 'working' || candidate === 'idle' || candidate === 'clear') {
          state = candidate;
        } else {
          return null;
        }
      } else if (key === 'id') {
        sessionId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value) ? value : null;
      }
    }

    if (state === null) {
      return null;
    }
    return { state, sessionId, atMs: this.now(), format };
  }
}

function keepPossiblePrefix(value: string): string {
  const prefix = '\x1b]7501;';
  const longestPossible = Math.min(value.length, prefix.length - 1);
  for (let length = longestPossible; length > 0; length -= 1) {
    const suffix = value.slice(value.length - length);
    if (prefix.startsWith(suffix)) {
      return suffix;
    }
  }
  return '';
}

type TerminatorScan =
  | { readonly kind: 'terminator'; readonly index: number; readonly length: number }
  | { readonly kind: 'incomplete' }
  | { readonly kind: 'malformed'; readonly index: number };

function scanTerminator(value: string, from: number): TerminatorScan {
  for (let index = from; index < value.length; index += 1) {
    const character = value[index];
    if (character === '\x07' || character === '\u009c') {
      return { kind: 'terminator', index, length: 1 };
    }
    if (character === '\x1b') {
      const next = value[index + 1];
      if (next === undefined) {
        return { kind: 'incomplete' };
      }
      if (next === '\\') {
        return { kind: 'terminator', index, length: 2 };
      }
      return { kind: 'malformed', index };
    }
  }
  return { kind: 'incomplete' };
}

function emptySignalEvidence(): SignalEvidence {
  return {
    working: false,
    idle: false,
    clear: false,
    workingBeforeIdle: false,
    workingEventCount: 0,
    idleEventCount: 0,
    clearEventCount: 0,
    sequence: [],
    sessionIdFromSignal: null,
    firstWorkingAtMs: null,
    firstIdleAfterWorkingAtMs: null,
    paramFormat: 'unknown',
    productParser: { eventCount: 0, recognized: false },
    productStateMachine: { sawWorking: false, completed: false, state: 'unknown' },
  };
}

/* ------------------------------------------------------------------------- */
/* Evidence helpers                                                          */
/* ------------------------------------------------------------------------- */

function checkPassed(input: {
  id: string;
  harness: CheckHarness;
  description: string;
  expected: string;
  observed: string;
  durationMs?: number;
}): CheckRecord {
  const check: CheckRecord = {
    id: input.id,
    harness: input.harness,
    description: input.description,
    expected: input.expected,
    observed: input.observed,
    status: 'passed',
    passed: true,
  };
  if (input.durationMs !== undefined) {
    check.durationMs = input.durationMs;
  }
  return check;
}

function checkFailed(input: {
  id: string;
  harness: CheckHarness;
  description: string;
  expected: string;
  observed: string;
  remediation: string;
  durationMs?: number;
  excerpt?: string;
}): CheckRecord {
  const check: CheckRecord = {
    id: input.id,
    harness: input.harness,
    description: input.description,
    expected: input.expected,
    observed: input.observed,
    status: 'failed',
    passed: false,
    remediation: input.remediation,
  };
  if (input.durationMs !== undefined) {
    check.durationMs = input.durationMs;
  }
  if (input.excerpt !== undefined && input.excerpt !== '') {
    check.excerpt = input.excerpt;
  }
  return check;
}

function checkNotApplicable(input: {
  id: string;
  harness: CheckHarness;
  description: string;
  expected: string;
  observed: string;
}): CheckRecord {
  return {
    id: input.id,
    harness: input.harness,
    description: input.description,
    expected: input.expected,
    observed: input.observed,
    status: 'not-applicable',
    passed: true,
  };
}

/* ------------------------------------------------------------------------- */
/* Versions, isolation, and model selection                                  */
/* ------------------------------------------------------------------------- */

function parseVersion(output: string): string | null {
  const match = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(output);
  return match?.[1] ?? null;
}

async function probeVersion(input: {
  harness: HarnessName;
  adapter: HarnessAdapter;
  expectedVersion: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
}): Promise<VersionProbe> {
  let executable = input.adapter.executableName;
  let resolutionError: string | undefined;
  try {
    executable = input.adapter.resolveExecutable().executable;
  } catch (error) {
    resolutionError = errnoCode(error) ?? 'HARNESS_UNAVAILABLE';
  }

  const result = await runTrackedCommand(executable, ['--version'], {
    cwd: input.cwd,
    env: input.env,
    timeoutMs: VERSION_TIMEOUT_MS,
  });
  const version = parseVersion(`${result.stdout}\n${result.stderr}`);
  const available =
    resolutionError === undefined &&
    result.errorCode === undefined &&
    result.exitCode === 0 &&
    !result.timedOut &&
    version !== null;

  const probe: VersionProbe = {
    executable: sanitize(basename(executable), replacementsValue),
    command: `${basename(executable)} --version`,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    version,
    expectedVersion: input.expectedVersion,
    versionMatches: version === input.expectedVersion,
    available,
  };
  const errorCode = resolutionError ?? result.errorCode;
  if (errorCode !== undefined) {
    probe.errorCode = errorCode;
  }
  return probe;
}

async function createIsolation(root: string): Promise<Isolation> {
  const inheritedCopilotHome = nonEmpty(process.env.COPILOT_HOME);
  const inheritedLoomConfig = nonEmpty(process.env.LOOM_CONFIG_DIR);
  const realCopilotHome = resolve(homedir(), '.copilot');
  const inheritedCopilotIsRealHome =
    inheritedCopilotHome !== undefined && resolve(inheritedCopilotHome) === realCopilotHome;

  const copilotHome =
    inheritedCopilotHome !== undefined && !inheritedCopilotIsRealHome
      ? inheritedCopilotHome
      : join(root, 'copilot-home');
  const loomConfigDir = inheritedLoomConfig ?? join(root, 'loom-config');
  const projectDirectory = join(root, 'project');

  await mkdir(copilotHome, { recursive: true });
  await mkdir(loomConfigDir, { recursive: true });
  await mkdir(projectDirectory, { recursive: true });
  await mkdir(join(root, 'opencode'), { recursive: true });

  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const name of SANITIZED_ENV_NAMES) {
    delete childEnv[name];
  }
  childEnv.COPILOT_HOME = copilotHome;
  childEnv.LOOM_CONFIG_DIR = loomConfigDir;
  childEnv.PWD = projectDirectory;
  childEnv.OLDPWD = projectDirectory;
  childEnv.COPILOT_AUTO_UPDATE = 'false';
  childEnv.OPENCODE_LOG_LEVEL = 'none';

  const cacheRootMode = nonEmpty(process.env.XDG_CACHE_HOME) !== undefined ? 'XDG_CACHE_HOME' : 'home-cache';
  const evidence: IsolationEvidence = {
    temporaryRoot: '<temporary-root>',
    cacheRootMode,
    copilotHomeMode:
      inheritedCopilotHome !== undefined && !inheritedCopilotIsRealHome ? 'inherited' : 'isolated',
    loomConfigDirMode: inheritedLoomConfig !== undefined ? 'inherited' : 'isolated',
    environmentVariablesSet: [
      'COPILOT_HOME',
      'LOOM_CONFIG_DIR',
      'PWD',
      'OLDPWD',
      'COPILOT_AUTO_UPDATE',
      'OPENCODE_LOG_LEVEL',
    ],
    sanitizedEnvironmentVariables: [...SANITIZED_ENV_NAMES],
  };

  return {
    evidence,
    copilotHome,
    loomConfigDir,
    childEnv,
    cacheRootMode,
  };
}

async function selectOpenCodeModel(input: {
  executable: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
  configDirectory: string;
}): Promise<OpenCodeModelSelection> {
  const override = nonEmpty(process.env.LOOM_LIVE_OPENCODE_MODEL);
  if (override !== undefined && /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/.test(override)) {
    await writeOpenCodeConfig(input.configDirectory, override);
    return {
      model: override,
      source: 'environment',
      authenticatedProviderCount: 0,
    };
  }

  const providerIds = await discoverOpenCodeProviders(input.executable, input.env, input.cwd);
  if (providerIds.length === 0) {
    return { model: null, source: 'default', authenticatedProviderCount: 0 };
  }

  const modelsResult = await runTrackedCommand(input.executable, ['models'], {
    cwd: input.cwd,
    env: input.env,
    timeoutMs: MODEL_TIMEOUT_MS,
  });
  if (modelsResult.exitCode !== 0 || modelsResult.timedOut) {
    return {
      model: null,
      source: 'default',
      authenticatedProviderCount: providerIds.length,
    };
  }

  const models = modelsResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/.test(line));

  for (const provider of providerIds) {
    const prefix = `${provider}/`;
    const candidates = models.filter((model) => model.startsWith(prefix));
    const preferred = candidates.find((model) => !model.endsWith('-free')) ?? candidates[0];
    if (preferred !== undefined) {
      await writeOpenCodeConfig(input.configDirectory, preferred);
      return {
        model: preferred,
        source: 'authenticated-provider',
        authenticatedProviderCount: providerIds.length,
      };
    }
  }

  return {
    model: null,
    source: 'default',
    authenticatedProviderCount: providerIds.length,
  };
}

async function discoverOpenCodeProviders(
  executable: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<string[]> {
  const result = await runTrackedCommand(executable, ['auth', 'list', '--format', 'json'], {
    cwd,
    env,
    timeoutMs: AUTH_TIMEOUT_MS,
  });
  if (result.exitCode !== 0 || result.timedOut) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const ids: string[] = [];
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null || !('id' in entry)) {
        continue;
      }
      const id = (entry as { id?: unknown }).id;
      if (typeof id === 'string' && /^[A-Za-z0-9._-]+$/.test(id)) {
        ids.push(id);
      }
    }
    return ids;
  } catch {
    return [];
  }
}

async function writeOpenCodeConfig(directory: string, model: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'opencode.json'), `${JSON.stringify({ model })}\n`, 'utf8');
}

function openCodeConfigPath(root: string): string {
  // Keep the probe config at the temporary root. OpenCode 2.2.5 applies the
  // model override reliably from this location; a nested config path is not
  // honored consistently by the installed CLI.
  return join(root, 'opencode.json');
}

/* ------------------------------------------------------------------------- */
/* Probe skills                                                              */
/* ------------------------------------------------------------------------- */

async function writeProbeSkill(
  projectPath: string,
  location: 'opencode' | 'copilot',
): Promise<void> {
  const relative =
    location === 'opencode'
      ? join('.opencode', 'skills', PROBE_SKILL_NAME)
      : join('.agents', 'skills', PROBE_SKILL_NAME);
  const directory = join(projectPath, relative);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'SKILL.md'), PROBE_SKILL_CONTENT, 'utf8');
}

async function removeProbeSkill(
  projectPath: string,
  location: 'opencode' | 'copilot',
): Promise<void> {
  const relative =
    location === 'opencode'
      ? join('.opencode', 'skills', PROBE_SKILL_NAME)
      : join('.agents', 'skills', PROBE_SKILL_NAME);
  await rm(join(projectPath, relative), { recursive: true, force: true });
}

async function probeSkillPresent(
  projectPath: string,
  location: 'opencode' | 'copilot',
): Promise<boolean> {
  const relative =
    location === 'opencode'
      ? join('.opencode', 'skills', PROBE_SKILL_NAME, 'SKILL.md')
      : join('.agents', 'skills', PROBE_SKILL_NAME, 'SKILL.md');
  try {
    const info = await stat(join(projectPath, relative));
    return info.isFile();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------- */
/* OpenCode interactive run                                                  */
/* ------------------------------------------------------------------------- */

function createOpenCodeSessionId(): string {
  const bytes = randomBytes(26);
  let id = 'ses_';
  for (const byte of bytes) {
    id += OPENCODE_SESSION_ALPHABET[byte % OPENCODE_SESSION_ALPHABET.length] ?? '0';
  }
  return id;
}

function sanitizedCommand(
  command: { executable: string; args: readonly string[]; cwd: string },
  replacements: Array<[string, string]>,
  prompt: string,
): { executable: string; args: string[]; cwd: string } {
  return {
    executable: sanitize(basename(command.executable), replacements),
    args: command.args.map((arg) =>
      arg === prompt ? '<probe-prompt>' : sanitize(arg, replacements),
    ),
    cwd: sanitize(command.cwd, replacements),
  };
}

function updateSignalEvidence(
  signal: SignalEvidence,
  probeParser: ProbeOsc7501Parser,
  productParser: Osc7501Parser,
  productState: Osc7501StateMachine,
  chunk: string,
  startedAt: number,
): void {
  for (const event of probeParser.push(chunk)) {
    if (event.format !== 'unknown') {
      signal.paramFormat = event.format;
    }
    if (event.sessionId !== null) {
      signal.sessionIdFromSignal = event.sessionId;
    }

    if (event.state === 'working') {
      signal.working = true;
      signal.workingEventCount += 1;
      if (signal.firstWorkingAtMs === null) {
        signal.firstWorkingAtMs = event.atMs - startedAt;
      }
    } else if (event.state === 'idle') {
      signal.idle = true;
      signal.idleEventCount += 1;
      if (signal.working && signal.firstIdleAfterWorkingAtMs === null) {
        signal.firstIdleAfterWorkingAtMs = event.atMs - startedAt;
        signal.workingBeforeIdle = true;
      }
    } else {
      signal.clear = true;
      signal.clearEventCount += 1;
    }

    if (signal.sequence[signal.sequence.length - 1] !== event.state && signal.sequence.length < 32) {
      signal.sequence.push(event.state);
    }
  }

  signal.productParser.eventCount += productParser.push(chunk).length;
  signal.productParser.recognized = signal.productParser.eventCount > 0;
  productState.push(chunk);
  signal.productStateMachine = {
    sawWorking: productState.sawWorking,
    completed: productState.completed,
    state: productState.state,
  };
}

async function runOpenCodeInteractive(input: {
  adapter: HarnessAdapter;
  prompt: string;
  sessionId: string;
  projectPath: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  requireSignal: boolean;
  replacements: Array<[string, string]>;
}): Promise<InteractiveRunResult> {
  const command = input.adapter.buildInteractiveCommand({
    prompt: input.prompt,
    sessionId: input.sessionId,
    projectPath: input.projectPath,
    sessionMode: 'shared',
  });

  const startedAt = Date.now();
  const signal = emptySignalEvidence();
  const probeParser = new ProbeOsc7501Parser();
  const productParser = new Osc7501Parser();
  const productState = new Osc7501StateMachine();

  let accumulated = '';
  let tokenObserved = false;
  let timedOut = false;
  let forcedKill = false;
  let settled = false;
  let exitResult: { exitCode: number | null; exitSignal: number | null } | null = null;
  let killEscalation: NodeJS.Timeout | undefined;
  let exitFallback: NodeJS.Timeout | undefined;
  let timeoutHandle: NodeJS.Timeout | undefined;

  const session = createTerminalSession(
    {
      executable: command.executable,
      args: command.args,
      cwd: command.cwd,
      env: input.env,
      cols: 120,
      rows: 32,
    },
    { id: `live_${randomUUID()}`, maxTailLines: 200, maxTailBytes: 32 * 1024 },
  );
  activeSessions.add(session);

  return new Promise<InteractiveRunResult>((resolvePromise) => {
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      if (killEscalation !== undefined) {
        clearTimeout(killEscalation);
      }
      if (exitFallback !== undefined) {
        clearTimeout(exitFallback);
      }
      const durationMs = Date.now() - startedAt;
      let failureClass: FailureClass = 'none';
      if (!tokenObserved || (input.requireSignal && !signal.workingBeforeIdle)) {
        if (timedOut) {
          failureClass = classifyFailure(accumulated) === 'auth' ? 'auth' : 'timeout';
        } else {
          const classified = classifyFailure(accumulated);
          failureClass = classified === 'command' ? 'token-missing' : classified;
        }
      }
      const result: InteractiveRunResult = {
        sessionId: input.sessionId,
        durationMs,
        exitCode: exitResult?.exitCode ?? null,
        exitSignal: exitResult?.exitSignal ?? null,
        timedOut,
        forcedKill,
        tokenObserved,
        signal,
        failureClass,
      };
      const excerpt = boundedExcerpt(accumulated, input.replacements);
      if (excerpt !== '') {
        result.failureExcerpt = excerpt;
      }
      resolvePromise(result);
    };

    const stop = (): void => {
      forcedKill = true;
      killSessionTree(session, 'SIGTERM');
      killEscalation = setTimeout(() => {
        killSessionTree(session, 'SIGKILL');
      }, 1_500);
      exitFallback = setTimeout(() => {
        if (!settled) {
          exitResult = exitResult ?? { exitCode: null, exitSignal: null };
          finish();
        }
      }, 6_000);
    };

    const completed = (): boolean =>
      tokenObserved && (!input.requireSignal || signal.workingBeforeIdle);

    timeoutHandle = setTimeout(() => {
      if (settled) {
        return;
      }
      timedOut = true;
      stop();
    }, input.timeoutMs);

    session.onData((chunk) => {
      accumulated += chunk;
      if (accumulated.length > MAX_CAPTURE_BYTES * 2) {
        accumulated = accumulated.slice(-MAX_CAPTURE_BYTES);
      }
      updateSignalEvidence(signal, probeParser, productParser, productState, chunk, startedAt);
      // A seed run must see the token after the harness has entered its working
      // state. This prevents the probe skill's own text from being mistaken for
      // model output if a future TUI renders the skill body.
      if (accumulated.includes(PROBE_TOKEN) && (!input.requireSignal || signal.working)) {
        tokenObserved = true;
      }
      if (completed() && !timedOut && !forcedKill) {
        stop();
      }
    });

    session.onExit((event) => {
      exitResult = {
        exitCode: event.exitCode,
        exitSignal: event.signal ?? null,
      };
      activeSessions.delete(session);
      finish();
    });
  });
}

/* ------------------------------------------------------------------------- */
/* Copilot trust                                                             */
/* ------------------------------------------------------------------------- */

function manualTrustCommand(projectPath: string, replacements: Array<[string, string]>): string {
  return `copilot -C ${sanitize(projectPath, replacements)}`;
}

async function verifyCopilotTrust(input: {
  adapter: HarnessAdapter;
  projectPath: string;
  env: NodeJS.ProcessEnv;
}): Promise<TrustCheckResult> {
  return checkFolderTrust({
    descriptor: input.adapter.trust,
    projectPath: input.projectPath,
    homeDirectory: homedir(),
    env: input.env,
  });
}

async function resolveCopilotTrust(input: {
  adapter: HarnessAdapter;
  projectPath: string;
  env: NodeJS.ProcessEnv;
  replacements: Array<[string, string]>;
}): Promise<CopilotTrustEvidence> {
  const startedAt = Date.now();
  const prior = await verifyCopilotTrust(input);
  if (prior.trusted) {
    return {
      resolved: true,
      state: prior.state,
      reason: prior.reason,
      mechanism: 'preexisting',
      durationMs: Date.now() - startedAt,
      configPath: prior.configPath === null ? null : sanitize(prior.configPath, input.replacements),
      manualFallback: manualTrustCommand(input.projectPath, input.replacements),
      sentSelectionKeys: false,
      outputClassified: 'already-trusted',
    };
  }

  const trustCommand = input.adapter.buildTrustCommand;
  if (trustCommand === undefined) {
    return {
      resolved: false,
      state: 'unknown',
      reason: 'NOT_REQUIRED',
      mechanism: 'failed',
      durationMs: Date.now() - startedAt,
      configPath: null,
      manualFallback: manualTrustCommand(input.projectPath, input.replacements),
      sentSelectionKeys: false,
      outputClassified: 'timeout',
    };
  }

  const command = trustCommand({ projectPath: input.projectPath });
  const session = createTerminalSession(
    {
      executable: command.executable,
      args: command.args,
      cwd: command.cwd,
      env: input.env,
      cols: 120,
      rows: 32,
    },
    { id: `live_trust_${randomUUID()}`, maxTailLines: 200, maxTailBytes: 32 * 1024 },
  );
  activeSessions.add(session);

  let accumulated = '';
  let sentSelectionKeys = false;
  let exited = false;
  let authDetected = false;

  return new Promise<CopilotTrustEvidence>((resolvePromise) => {
    let settled = false;
    let pollHandle: NodeJS.Timeout | undefined;
    let deadlineHandle: NodeJS.Timeout | undefined;
    let selectionTimer: NodeJS.Timeout | undefined;

    const finish = (evidence: CopilotTrustEvidence): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (pollHandle !== undefined) {
        clearInterval(pollHandle);
      }
      if (deadlineHandle !== undefined) {
        clearTimeout(deadlineHandle);
      }
      if (selectionTimer !== undefined) {
        clearTimeout(selectionTimer);
      }
      killSessionTree(session, 'SIGTERM');
      setTimeout(() => {
        if (session.isRunning()) {
          killSessionTree(session, 'SIGKILL');
        }
        resolvePromise(evidence);
      }, 300);
    };

    const sendSelection = (): void => {
      if (sentSelectionKeys) {
        return;
      }
      sentSelectionKeys = true;
      try {
        session.write('\x1b[B');
      } catch {
        // The trust session may have exited; the poll below reports it.
      }
      selectionTimer = setTimeout(() => {
        try {
          session.write('\r');
        } catch {
          // The trust session may have exited; the poll below reports it.
        }
      }, 250);
    };

    session.onData((chunk) => {
      accumulated += chunk;
      if (accumulated.length > MAX_CAPTURE_BYTES) {
        accumulated = accumulated.slice(-MAX_CAPTURE_BYTES);
      }
      const clean = stripAnsi(accumulated);
      if (/Confirm folder trust|Do you trust the files in this folder/i.test(clean)) {
        sendSelection();
      }
      if (
        /not (?:logged|signed) in|not authenticated|authentication (?:failed|required)|please (?:log|sign) in|run ['"]?copilot login|device code/i.test(
          clean,
        )
      ) {
        authDetected = true;
      }
    });

    session.onExit(() => {
      exited = true;
      activeSessions.delete(session);
      if (!settled) {
        finish({
          resolved: false,
          state: 'unknown',
          reason: 'NO_CONFIG',
          mechanism: 'failed',
          durationMs: Date.now() - startedAt,
          configPath: null,
          manualFallback: manualTrustCommand(input.projectPath, input.replacements),
          sentSelectionKeys,
          outputClassified: authDetected ? 'auth-required' : 'exited',
        });
      }
    });

    const checkTrust = async (): Promise<void> => {
      if (settled) {
        return;
      }
      const current = await verifyCopilotTrust(input);
      if (settled) {
        return;
      }
      if (current.trusted) {
        finish({
          resolved: true,
          state: current.state,
          reason: current.reason,
          mechanism: sentSelectionKeys ? 'dialog' : 'preexisting',
          durationMs: Date.now() - startedAt,
          configPath: current.configPath === null ? null : sanitize(current.configPath, input.replacements),
          manualFallback: manualTrustCommand(input.projectPath, input.replacements),
          sentSelectionKeys,
          outputClassified: sentSelectionKeys ? 'trust-dialog' : 'already-trusted',
        });
        return;
      }
      if (authDetected && !exited) {
        finish({
          resolved: false,
          state: current.state,
          reason: current.reason,
          mechanism: 'failed',
          durationMs: Date.now() - startedAt,
          configPath: current.configPath === null ? null : sanitize(current.configPath, input.replacements),
          manualFallback: manualTrustCommand(input.projectPath, input.replacements),
          sentSelectionKeys,
          outputClassified: 'auth-required',
        });
      }
    };

    pollHandle = setInterval(() => {
      void checkTrust();
    }, 250);

    deadlineHandle = setTimeout(() => {
      if (settled) {
        return;
      }
      void (async () => {
        const current = await verifyCopilotTrust(input);
        if (settled) {
          return;
        }
        finish({
          resolved: current.trusted,
          state: current.state,
          reason: current.reason,
          mechanism: current.trusted ? 'preexisting' : 'failed',
          durationMs: Date.now() - startedAt,
          configPath: current.configPath === null ? null : sanitize(current.configPath, input.replacements),
          manualFallback: manualTrustCommand(input.projectPath, input.replacements),
          sentSelectionKeys,
          outputClassified: authDetected ? 'auth-required' : 'timeout',
        });
      })();
    }, TRUST_TIMEOUT_MS);
  });
}

/* ------------------------------------------------------------------------- */
/* Copilot headless runs                                                     */
/* ------------------------------------------------------------------------- */

async function runCopilotHeadless(input: {
  adapter: HarnessAdapter;
  prompt: string;
  sessionId: string;
  projectPath: string;
  env: NodeJS.ProcessEnv;
  replacements: Array<[string, string]>;
}): Promise<CopilotHeadlessResult> {
  const command = input.adapter.buildHeadlessCommand({
    prompt: input.prompt,
    sessionId: input.sessionId,
    projectPath: input.projectPath,
    sessionMode: 'shared',
    automaticPermissionOptIn: true,
  });

  const result = await runTrackedCommand(command.executable, command.args, {
    cwd: command.cwd,
    env: input.env,
    timeoutMs: COPILOT_RUN_TIMEOUT_MS,
  });

  const combined = `${result.stdout}\n${result.stderr}`;
  const tokenObserved = result.stdout.includes(PROBE_TOKEN);
  const skillObserved = /skill\(\s*loom-live-probe\s*\)/.test(combined);
  let failureClass: FailureClass = 'none';

  if (result.timedOut) {
    failureClass = 'timeout';
  } else if (result.errorCode !== undefined) {
    failureClass = 'command';
  } else if (result.exitCode !== 0) {
    failureClass = classifyFailure(combined);
  } else if (!tokenObserved) {
    failureClass = 'token-missing';
  }

  const output: CopilotHeadlessResult = {
    sessionId: input.sessionId,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    tokenObserved,
    skillObserved,
    failureClass,
  };

  if (failureClass !== 'none') {
    const excerpt = boundedExcerpt(combined, input.replacements);
    if (excerpt !== '') {
      output.failureExcerpt = excerpt;
    }
  }

  return output;
}

/* ------------------------------------------------------------------------- */
/* OpenCode session cleanup                                                  */
/* ------------------------------------------------------------------------- */

async function openCodeSessionExists(input: {
  executable: string;
  sessionId: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
}): Promise<boolean | null> {
  const result = await runTrackedCommand(input.executable, ['session', 'list'], {
    cwd: input.cwd,
    env: input.env,
    timeoutMs: SESSION_CLEANUP_TIMEOUT_MS,
  });
  if (result.exitCode !== 0 || result.timedOut) {
    return null;
  }
  return result.stdout.includes(input.sessionId);
}

async function deleteOpenCodeSession(input: {
  executable: string;
  sessionId: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
}): Promise<{ existed: boolean; deleted: boolean; verifiedAbsent: boolean }> {
  const existed = await openCodeSessionExists(input);
  if (existed === false) {
    return { existed: false, deleted: true, verifiedAbsent: true };
  }

  const result = await runTrackedCommand(
    input.executable,
    ['session', 'delete', input.sessionId],
    {
      cwd: input.cwd,
      env: input.env,
      timeoutMs: SESSION_CLEANUP_TIMEOUT_MS,
    },
  );
  const deleted = result.exitCode === 0 && !result.timedOut && result.errorCode === undefined;
  const after = await openCodeSessionExists(input);
  // A successful delete is accepted when the follow-up list cannot run, but a
  // list that still contains the session is always a cleanup failure.
  const verifiedAbsent = after === false || (after === null && deleted);

  return {
    existed: existed === true || (existed === null && deleted),
    deleted: deleted || after === false,
    verifiedAbsent,
  };
}

/* ------------------------------------------------------------------------- */
/* Cleanup                                                                   */
/* ------------------------------------------------------------------------- */

async function cleanupTemporaryRoot(): Promise<CleanupRecord> {
  cleanupPromise ??= performCleanup();
  return cleanupPromise;
}

async function performCleanup(): Promise<CleanupRecord> {
  await terminateActiveChildren();
  await terminateActiveSessions();

  const opencodeSessions: CleanupRecord['opencodeSessions'] = [];
  let opencodeSessionCleanupPassed = true;
  const env = childEnvValue;
  const root = temporaryRoot;

  if (env !== undefined && root !== undefined && createdOpenCodeSessions.size > 0) {
    let executable = 'opencode';
    try {
      executable = createHarnessRegistry({ env }).get('opencode').resolveExecutable().executable;
    } catch {
      executable = 'opencode';
    }
    const projectPath = join(root, 'project');
    for (const sessionId of createdOpenCodeSessions) {
      try {
        const result = await deleteOpenCodeSession({
          executable,
          sessionId,
          env,
          cwd: projectPath,
        });
        opencodeSessions.push({ sessionId, ...result });
        if (!result.verifiedAbsent) {
          opencodeSessionCleanupPassed = false;
        }
      } catch {
        opencodeSessions.push({
          sessionId,
          existed: true,
          deleted: false,
          verifiedAbsent: false,
        });
        opencodeSessionCleanupPassed = false;
      }
    }
  }

  if (root === undefined) {
    return {
      attempted: false,
      temporaryRootRemoved: true,
      temporaryRoot: null,
      processesRemaining: activeChildren.size,
      ptySessionsRemaining: runningSessions().length,
      opencodeSessions,
      opencodeSessionCleanupPassed,
    };
  }

  try {
    await rm(root, { recursive: true, force: true });
  } catch (error) {
    return {
      attempted: true,
      temporaryRootRemoved: false,
      temporaryRoot: root,
      processesRemaining: activeChildren.size,
      ptySessionsRemaining: runningSessions().length,
      opencodeSessions,
      opencodeSessionCleanupPassed,
      error: errnoCode(error) ?? 'CLEANUP_FAILED',
    };
  }

  try {
    await stat(root);
    return {
      attempted: true,
      temporaryRootRemoved: false,
      temporaryRoot: root,
      processesRemaining: activeChildren.size,
      ptySessionsRemaining: runningSessions().length,
      opencodeSessions,
      opencodeSessionCleanupPassed,
      error: 'STILL_EXISTS',
    };
  } catch {
    temporaryRootRemovedSync = true;
    return {
      attempted: true,
      temporaryRootRemoved: true,
      temporaryRoot: null,
      processesRemaining: activeChildren.size,
      ptySessionsRemaining: runningSessions().length,
      opencodeSessions,
      opencodeSessionCleanupPassed,
    };
  }
}

function cleanupCheck(cleanup: CleanupRecord): CheckRecord {
  const ok =
    cleanup.temporaryRootRemoved &&
    cleanup.processesRemaining === 0 &&
    cleanup.ptySessionsRemaining === 0;
  return ok
    ? checkPassed({
        id: 'cleanup.temporary-root',
        harness: 'environment',
        description:
          'Remove the temporary project, probe skills, PTY sessions, and child processes.',
        expected:
          'The temporary root no longer exists and no tracked child process or PTY remains.',
        observed: `Temporary root removed; ${String(cleanup.processesRemaining)} child process(es) and ${String(
          cleanup.ptySessionsRemaining,
        )} PTY session(s) remaining.`,
      })
    : checkFailed({
        id: 'cleanup.temporary-root',
        harness: 'environment',
        description:
          'Remove the temporary project, probe skills, PTY sessions, and child processes.',
        expected:
          'The temporary root no longer exists and no tracked child process or PTY remains.',
        observed: `Temporary root removed=${String(cleanup.temporaryRootRemoved)}; ${String(
          cleanup.processesRemaining,
        )} child process(es) and ${String(cleanup.ptySessionsRemaining)} PTY session(s) remaining${
          cleanup.error === undefined ? '' : ` (${cleanup.error})`
        }.`,
        remediation:
          'Kill the reported process or remove the reported temporary path, then rerun npm run test:live:execution.',
      });
}

function openCodeCleanupCheck(cleanup: CleanupRecord): CheckRecord {
  if (cleanup.opencodeSessions.length === 0) {
    return checkNotApplicable({
      id: 'cleanup.opencode-session',
      harness: 'opencode',
      description: 'Delete the OpenCode session created by the probe.',
      expected: 'No probe session remains in the OpenCode session store.',
      observed: 'No OpenCode session was created before the probe stopped.',
    });
  }

  const stillPresent = cleanup.opencodeSessions.filter((entry) => !entry.verifiedAbsent);
  return cleanup.opencodeSessionCleanupPassed
    ? checkPassed({
        id: 'cleanup.opencode-session',
        harness: 'opencode',
        description: 'Delete the OpenCode session created by the probe.',
        expected: 'No probe session remains in the OpenCode session store.',
        observed: `${String(
          cleanup.opencodeSessions.length,
        )} probe session(s) verified absent after deletion.`,
      })
    : checkFailed({
        id: 'cleanup.opencode-session',
        harness: 'opencode',
        description: 'Delete the OpenCode session created by the probe.',
        expected: 'No probe session remains in the OpenCode session store.',
        observed: `${String(stillPresent.length)} of ${String(
          cleanup.opencodeSessions.length,
        )} probe session(s) could not be verified absent.`,
        remediation: `Run "opencode session delete <session-id>" for the session ids recorded in cleanup.opencodeSessions, then rerun npm run test:live:execution.`,
      });
}

/* ------------------------------------------------------------------------- */
/* Signal handling                                                           */
/* ------------------------------------------------------------------------- */

function installProcessHandlers(): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (interruptedBy !== undefined) {
        return;
      }
      interruptedBy = signal;
      for (const child of activeChildren) {
        killChildTree(child, 'SIGTERM');
      }
      for (const session of runningSessions()) {
        killSessionTree(session, 'SIGTERM');
      }
    });
  }

  process.on('exit', () => {
    for (const child of activeChildren) {
      killChildTree(child, 'SIGKILL');
    }
    for (const session of runningSessions()) {
      killSessionTree(session, 'SIGKILL');
    }
    if (temporaryRoot !== undefined && !temporaryRootRemovedSync) {
      try {
        rmSync(temporaryRoot, { recursive: true, force: true });
      } catch {
        // Best-effort synchronous fallback; the async cleanup records failure.
      }
    }
  });
}

/* ------------------------------------------------------------------------- */
/* Evidence writing                                                          */
/* ------------------------------------------------------------------------- */

async function readLoomVersion(): Promise<string | null> {
  try {
    const raw = await readFile(join(PROJECT_ROOT, 'package.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
      const version = (parsed as { version?: unknown }).version;
      return typeof version === 'string' ? version : null;
    }
    return null;
  } catch {
    return null;
  }
}

async function writeEvidenceFile(filePath: string, evidence: ExecutionEvidence): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${String(process.pid)}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, filePath);
}

async function buildEvidence(input: {
  report: MutableReport;
  result: 'passed' | 'failed' | 'interrupted';
  cleanup: CleanupRecord;
  prerequisites: { opencode: VersionProbe; copilot: VersionProbe } | null;
}): Promise<ExecutionEvidence> {
  return {
    version: 1,
    taskId: TASK_ID,
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    loomVersion: await readLoomVersion(),
    durationMs: Date.now() - input.report.startedAt,
    result: input.result,
    isolation: input.report.isolation,
    prerequisites: input.prerequisites,
    auth: input.report.auth,
    harnesses: input.report.harnesses,
    checks: input.report.checks,
    warnings: input.report.warnings,
    cleanup: input.cleanup,
    limitations: input.report.limitations,
  };
}

function reportResult(report: MutableReport, cleanup: CleanupRecord): 'passed' | 'failed' {
  if (
    !cleanup.temporaryRootRemoved ||
    cleanup.processesRemaining > 0 ||
    cleanup.ptySessionsRemaining > 0 ||
    !cleanup.opencodeSessionCleanupPassed
  ) {
    return 'failed';
  }
  return report.checks.some((check) => check.status === 'failed') ? 'failed' : 'passed';
}

/* ------------------------------------------------------------------------- */
/* Main                                                                      */
/* ------------------------------------------------------------------------- */

async function main(): Promise<number> {
  installProcessHandlers();

  const startedAt = Date.now();
  const report: MutableReport = {
    startedAt,
    checks: [],
    warnings: [],
    harnesses: {},
    limitations: [],
    isolation: {
      temporaryRoot: '<temporary-root>',
      cacheRootMode: 'home-cache',
      copilotHomeMode: 'isolated',
      loomConfigDirMode: 'isolated',
      environmentVariablesSet: [],
      sanitizedEnvironmentVariables: [...SANITIZED_ENV_NAMES],
    },
    auth: { opencode: null, copilot: null },
  };

  const cacheBase = nonEmpty(process.env.XDG_CACHE_HOME) ?? join(homedir(), '.cache');
  await mkdir(join(cacheBase, 'loom'), { recursive: true });
  const root = await mkdtemp(join(cacheBase, 'loom', 'live-execution-'));
  temporaryRoot = root;

  const isolation = await createIsolation(root);
  report.isolation = isolation.evidence;
  childEnvValue = isolation.childEnv;

  const projectPath = join(root, 'project');
  const canonicalProject = await realpath(projectPath);
  isolation.childEnv.PWD = canonicalProject;
  isolation.childEnv.OLDPWD = canonicalProject;
  process.env.COPILOT_HOME = isolation.copilotHome;
  process.env.LOOM_CONFIG_DIR = isolation.loomConfigDir;

  replacementsValue = [
    [canonicalProject, '<temporary-project>'],
    [projectPath, '<temporary-project>'],
    [root, '<temporary-root>'],
    [homedir(), '~'],
  ];

  if (
    nonEmpty(process.env.COPILOT_HOME) !== undefined &&
    resolve(process.env.COPILOT_HOME) === resolve(homedir(), '.copilot')
  ) {
    report.warnings.push({
      code: 'COPILOT_HOME_REAL_HOME_IGNORED',
      harness: 'copilot',
      message:
        'The inherited COPILOT_HOME pointed at the real ~/.copilot. The probe used an isolated temporary home instead so it never writes the user\'s trust state.',
    });
  }

  const registry = createHarnessRegistry({ env: isolation.childEnv, cwd: canonicalProject });
  const openCodeAdapter = registry.get('opencode');
  const copilotAdapter = registry.get('copilot');

  let prerequisites: { opencode: VersionProbe; copilot: VersionProbe } | null = null;
  let fatal: unknown;

  try {
    await writeProbeSkill(canonicalProject, 'opencode');
    await writeProbeSkill(canonicalProject, 'copilot');

    const openCodeVersion = await probeVersion({
      harness: 'opencode',
      adapter: openCodeAdapter,
      expectedVersion: EXPECTED_OPENCODE_VERSION,
      env: isolation.childEnv,
      cwd: canonicalProject,
    });
    const copilotVersion = await probeVersion({
      harness: 'copilot',
      adapter: copilotAdapter,
      expectedVersion: EXPECTED_COPILOT_VERSION,
      env: isolation.childEnv,
      cwd: canonicalProject,
    });
    prerequisites = { opencode: openCodeVersion, copilot: copilotVersion };

    addPrerequisiteCheck(report, openCodeVersion, 'opencode', openCodeAdapter.installHint);
    addPrerequisiteCheck(report, copilotVersion, 'copilot', copilotAdapter.installHint);

    if (openCodeVersion.available && !openCodeVersion.versionMatches) {
      report.warnings.push({
        code: 'CLI_VERSION_MISMATCH',
        harness: 'opencode',
        message: `Expected ${openCodeVersion.expectedVersion}, observed ${
          openCodeVersion.version ?? 'unknown'
        }. The probe continued against the installed version.`,
      });
    }
    if (copilotVersion.available && !copilotVersion.versionMatches) {
      report.warnings.push({
        code: 'CLI_VERSION_MISMATCH',
        harness: 'copilot',
        message: `Expected ${copilotVersion.expectedVersion}, observed ${
          copilotVersion.version ?? 'unknown'
        }. The probe continued against the installed version.`,
      });
    }

    const localRunner = createLocalRunner(isolation.childEnv);

    throwIfInterrupted();
    const openCodeAuth = await collectAuth({
      harness: 'opencode',
      adapter: openCodeAdapter,
      projectPath: canonicalProject,
      env: isolation.childEnv,
      runner: localRunner,
    });
    const copilotAuth = await collectAuth({
      harness: 'copilot',
      adapter: copilotAdapter,
      projectPath: canonicalProject,
      env: isolation.childEnv,
      runner: localRunner,
    });
    report.auth = {
      opencode: openCodeAuth.summary,
      copilot: copilotAuth.summary,
    };
    addAuthCheck(report, openCodeAuth.summary);
    addAuthCheck(report, copilotAuth.summary);
    throwIfInterrupted();

    const openCodeBlocked =
      !openCodeVersion.available || openCodeAuth.summary.state === 'unauthenticated';
    const copilotBlocked =
      !copilotVersion.available || copilotAuth.summary.state === 'unauthenticated';

    if (openCodeBlocked) {
      report.harnesses.opencode = blockedOpenCodeEvidence(openCodeVersion);
      addBlockedChecks(report, 'opencode', openCodeVersion, openCodeAuth.summary);
    } else {
      report.harnesses.opencode = await runOpenCodeProbe({
        report,
        adapter: openCodeAdapter,
        projectPath: canonicalProject,
        env: isolation.childEnv,
        replacements: replacementsValue,
      });
    }

    throwIfInterrupted();

    // The OpenCode recall phase removes both probe skill locations so a recall
    // cannot re-read the token. Re-create the Copilot probe before its seed.
    await writeProbeSkill(canonicalProject, 'copilot');

    if (copilotBlocked) {
      report.harnesses.copilot = blockedCopilotEvidence(copilotVersion);
      addBlockedChecks(report, 'copilot', copilotVersion, copilotAuth.summary);
    } else {
      report.harnesses.copilot = await runCopilotProbe({
        report,
        adapter: copilotAdapter,
        projectPath: canonicalProject,
        env: isolation.childEnv,
        replacements: replacementsValue,
      });
    }

    if (report.harnesses.opencode !== undefined) {
      report.harnesses.opencode.version = openCodeVersion.version;
      report.harnesses.opencode.versionMatches = openCodeVersion.versionMatches;
    }
    if (report.harnesses.copilot !== undefined) {
      report.harnesses.copilot.version = copilotVersion.version;
      report.harnesses.copilot.versionMatches = copilotVersion.versionMatches;
      report.harnesses.copilot.copilotHomeMode = report.isolation.copilotHomeMode;
    }
  } catch (error) {
    if (!(error instanceof InterruptedError)) {
      fatal = error;
      report.checks.push(
        checkFailed({
          id: 'script.fatal',
          harness: 'environment',
          description: 'The live execution probe completed its setup and harness sequence.',
          expected: 'No unhandled error.',
          observed: `Unexpected error: ${sanitizeError(error, replacementsValue)}`,
          remediation:
            'Inspect the error, confirm Node 24+, node-pty, and both harness CLIs are installed, then rerun npm run test:live:execution.',
        }),
      );
    }
  } finally {
    for (const child of activeChildren) {
      killChildTree(child, 'SIGTERM');
    }
    for (const session of runningSessions()) {
      killSessionTree(session, 'SIGTERM');
    }
  }

  if (interruptedBy !== undefined) {
    report.checks.push(
      checkFailed({
        id: 'script.interrupted',
        harness: 'environment',
        description: 'The live execution probe ran to completion.',
        expected: 'The probe finishes without an interrupt.',
        observed: `Received ${interruptedBy}; the run was stopped and cleaned up.`,
        remediation: 'Rerun npm run test:live:execution and let it finish.',
      }),
    );
  }

  const cleanup = await cleanupTemporaryRoot();
  report.checks.push(cleanupCheck(cleanup));
  report.checks.push(openCodeCleanupCheck(cleanup));

  if (report.harnesses.opencode !== undefined) {
    report.harnesses.opencode.cleanup = {
      sessionsCreated: [...createdOpenCodeSessions],
      sessionsDeleted: cleanup.opencodeSessionCleanupPassed,
      sessionsStillPresent: cleanup.opencodeSessions
        .filter((entry) => !entry.verifiedAbsent)
        .map((entry) => entry.sessionId),
    };
  }

  const result = interruptedBy !== undefined ? 'interrupted' : reportResult(report, cleanup);
  const evidence = await buildEvidence({ report, result, cleanup, prerequisites });

  try {
    await writeEvidenceFile(EVIDENCE_PATH, evidence);
  } catch (error) {
    console.error(
      `Live execution: evidence could not be written to ${EVIDENCE_PATH}: ${sanitizeError(
        error,
        replacementsValue,
      )}`,
    );
    return 1;
  }

  printSummary(evidence, fatal !== undefined);
  if (interruptedBy !== undefined) {
    return interruptedBy === 'SIGINT' ? 130 : 143;
  }
  return result === 'passed' ? 0 : 1;
}

function addPrerequisiteCheck(
  report: MutableReport,
  probe: VersionProbe,
  harness: HarnessName,
  installHint: string,
): void {
  report.checks.push(
    probe.available
      ? checkPassed({
          id: `prereq.${harness}`,
          harness,
          description: `Confirm the ${harness} CLI is installed and reports a version.`,
          expected: `${probe.command} exits 0 and prints a semantic version.`,
          observed: `${probe.command} exited ${String(probe.exitCode)} and reported ${
            probe.version ?? 'no parseable version'
          }.`,
          durationMs: probe.durationMs,
        })
      : checkFailed({
          id: `prereq.${harness}`,
          harness,
          description: `Confirm the ${harness} CLI is installed and reports a version.`,
          expected: `${probe.command} exits 0 and prints a semantic version.`,
          observed:
            probe.errorCode !== undefined
              ? `${probe.command} could not start (${probe.errorCode}).`
              : `${probe.command} exited ${String(probe.exitCode)}${
                  probe.timedOut ? ' after timing out' : ''
                }.`,
          remediation: installHint,
          durationMs: probe.durationMs,
        }),
  );
}

async function collectAuth(input: {
  harness: HarnessName;
  adapter: HarnessAdapter;
  projectPath: string;
  env: NodeJS.ProcessEnv;
  runner: LocalCommandRunner;
}): Promise<{ summary: AuthSummary }> {
  let executable: string | null = null;
  try {
    executable = input.adapter.resolveExecutable().executable;
  } catch {
    executable = null;
  }

  const result = await collectAuthEvidence({
    harness: input.harness,
    executable,
    cwd: input.projectPath,
    env: input.env,
    runner: input.runner,
    timeoutMs: AUTH_TIMEOUT_MS,
  });

  return {
    summary: {
      harness: input.harness,
      state: result.state,
      reason: result.reason,
      loginHint: result.loginHint,
      evidence: result.evidence.map((item) => {
        if (item.kind === 'command') {
          return {
            ...item,
            command: sanitize(item.command, replacementsValue),
            ...(item.outputExcerpt === undefined
              ? {}
              : {
                  outputExcerpt: sanitize(
                    redactProbeText(item.outputExcerpt),
                    replacementsValue,
                  ),
                }),
          };
        }
        if (item.kind === 'file') {
          return {
            ...item,
            path: sanitize(item.path, replacementsValue),
          };
        }
        return item;
      }),
    },
  };
}

function addAuthCheck(report: MutableReport, summary: AuthSummary): void {
  const harness = summary.harness;
  if (summary.state === 'authenticated') {
    report.checks.push(
      checkPassed({
        id: `auth.${harness}`,
        harness,
        description: `Confirm ${harness} has local authentication evidence.`,
        expected: 'Positive local authentication evidence without reading credential values.',
        observed: `Authentication evidence: ${summary.reason}.`,
      }),
    );
    return;
  }
  if (summary.state === 'unauthenticated') {
    report.checks.push(
      checkFailed({
        id: `auth.${harness}`,
        harness,
        description: `Confirm ${harness} has local authentication evidence.`,
        expected: 'Positive local authentication evidence without reading credential values.',
        observed: `The CLI reported an unauthenticated state (${summary.reason}).`,
        remediation: summary.loginHint,
      }),
    );
    return;
  }
  report.checks.push(
    checkNotApplicable({
      id: `auth.${harness}`,
      harness,
      description: `Confirm ${harness} has local authentication evidence.`,
      expected: 'Positive local authentication evidence without reading credential values.',
      observed: `No static authentication evidence was available (${summary.reason}); the live ${harness} probe determines whether authentication works.`,
    }),
  );
}

function blockedOpenCodeEvidence(version: VersionProbe): OpenCodeEvidence {
  return {
    harness: 'opencode',
    version: version.version,
    expectedVersion: EXPECTED_OPENCODE_VERSION,
    versionMatches: version.versionMatches,
    sessionId: '',
    sessionMode: 'shared',
    model: null,
    modelSource: 'default',
    command: { executable: 'opencode', args: [], cwd: '<temporary-project>' },
    seededPrompt: {
      passed: false,
      tokenObserved: false,
      durationMs: 0,
      exitCode: null,
      timedOut: false,
      forcedKill: false,
      skillAvailable: true,
    },
    signal: emptySignalEvidence(),
    recall: {
      passed: false,
      tokenObserved: false,
      durationMs: 0,
      exitCode: null,
      timedOut: false,
      forcedKill: false,
      probeSkillPresent: false,
    },
    cleanup: { sessionsCreated: [], sessionsDeleted: true, sessionsStillPresent: [] },
  };
}

function blockedCopilotEvidence(version: VersionProbe): CopilotEvidence {
  return {
    harness: 'copilot',
    version: version.version,
    expectedVersion: EXPECTED_COPILOT_VERSION,
    versionMatches: version.versionMatches,
    sessionId: '',
    copilotHomeMode: 'isolated',
    trust: {
      resolved: false,
      state: 'unknown',
      reason: 'NO_CONFIG',
      mechanism: 'failed',
      durationMs: 0,
      configPath: null,
      manualFallback: 'copilot -C <temporary-project>',
      sentSelectionKeys: false,
      outputClassified: 'timeout',
    },
    seededPrompt: {
      passed: false,
      tokenObserved: false,
      durationMs: 0,
      exitCode: null,
      timedOut: false,
      forcedKill: false,
      skillAvailable: true,
      skillObserved: false,
      skillObservation: 'not-observable',
      broadPermissions: [],
    },
    recall: {
      passed: false,
      tokenObserved: false,
      durationMs: 0,
      exitCode: null,
      timedOut: false,
      forcedKill: false,
      probeSkillPresent: false,
    },
    command: { executable: 'copilot', args: [], cwd: '<temporary-project>' },
  };
}

function addBlockedChecks(
  report: MutableReport,
  harness: HarnessName,
  version: VersionProbe,
  auth: AuthSummary,
): void {
  const reason =
    !version.available
      ? `the ${harness} CLI is unavailable${version.errorCode === undefined ? '' : ` (${version.errorCode})`}`
      : `the ${harness} CLI reported an unauthenticated state`;
  const prefix = harness === 'opencode' ? 'opencode' : 'copilot';
  const checks =
    harness === 'opencode'
      ? ['seed', 'signal', 'recall']
      : ['trust', 'seed', 'recall'];
  for (const check of checks) {
    report.checks.push(
      checkFailed({
        id: `${prefix}.${check}`,
        harness,
        description: `Run the live ${harness} ${check} probe.`,
        expected: `The ${harness} ${check} probe completes successfully.`,
        observed: `Blocked: ${reason}.`,
        remediation:
          auth.state === 'unauthenticated'
            ? auth.loginHint
            : `Install the expected ${harness} CLI version and rerun npm run test:live:execution.`,
      }),
    );
  }
}

async function runOpenCodeProbe(input: {
  report: MutableReport;
  adapter: HarnessAdapter;
  projectPath: string;
  env: NodeJS.ProcessEnv;
  replacements: Array<[string, string]>;
}): Promise<OpenCodeEvidence> {
  const sessionId = createOpenCodeSessionId();
  createdOpenCodeSessions.add(sessionId);

  // OpenCode 2.x discovers configuration from the project directory. Writing
  // the disposable project's `opencode.json` selects the authenticated provider
  // model for both probe processes without touching the user's config.
  const modelSelection = await selectOpenCodeModel({
    executable: input.adapter.resolveExecutable().executable,
    env: input.env,
    cwd: input.projectPath,
    configDirectory: input.projectPath,
  });
  // `OPENCODE_CONFIG` is a v1 setting and is not honored by 2.2.5; never let an
  // inherited value redirect this probe to a developer config.
  delete input.env.OPENCODE_CONFIG;
  if (modelSelection.model === null) {
    input.report.limitations.push(
      'OpenCode used its CLI default model because no authenticated provider model could be selected. The probe records the selected model but does not route models.',
    );
  }
  if (modelSelection.authenticatedProviderCount === 0) {
    input.report.warnings.push({
      code: 'OPENCODE_NO_PROVIDER_EVIDENCE',
      harness: 'opencode',
      message:
        'No authenticated OpenCode provider id was available for model selection. The probe used the CLI default, which may be a free model with a usage limit.',
    });
  }

  const seed = await runOpenCodeInteractive({
    adapter: input.adapter,
    prompt: OPENCODE_SEED_PROMPT,
    sessionId,
    projectPath: input.projectPath,
    env: input.env,
    timeoutMs: OPENCODE_RUN_TIMEOUT_MS,
    requireSignal: true,
    replacements: input.replacements,
  });

  const skillAvailable = await probeSkillPresent(input.projectPath, 'opencode');
  const seedCommand = input.adapter.buildInteractiveCommand({
    prompt: OPENCODE_SEED_PROMPT,
    sessionId,
    projectPath: input.projectPath,
    sessionMode: 'shared',
  });

  input.report.checks.push(
    seed.tokenObserved
      ? checkPassed({
          id: 'opencode.seed',
          harness: 'opencode',
          description: 'Run a seeded interactive OpenCode prompt in a PTY and return the probe token.',
          expected: `The ${PROBE_SKILL_NAME} skill returns the probe token.`,
          observed: `The seeded prompt returned the probe token after ${String(
            seed.durationMs,
          )} ms${skillAvailable ? '' : ' (probe skill was already removed)'}.`,
          durationMs: seed.durationMs,
        })
      : checkFailed({
          id: 'opencode.seed',
          harness: 'opencode',
          description: 'Run a seeded interactive OpenCode prompt in a PTY and return the probe token.',
          expected: `The ${PROBE_SKILL_NAME} skill returns the probe token.`,
          observed: seed.timedOut
            ? `Timed out after ${String(seed.durationMs)} ms without the probe token.`
            : `The OpenCode process exited ${String(
                seed.exitCode,
              )} without the probe token.`,
          remediation: openCodeRemediation(seed.failureClass),
          durationMs: seed.durationMs,
          ...(seed.failureExcerpt === undefined ? {} : { excerpt: seed.failureExcerpt }),
        }),
  );

  input.report.checks.push(
    seed.signal.workingBeforeIdle
      ? checkPassed({
          id: 'opencode.signal',
          harness: 'opencode',
          description: 'Observe OpenCode OSC 7501 working followed by idle.',
          expected: 'At least one state=working event precedes a later state=idle event.',
          observed: `Observed ${String(seed.signal.workingEventCount)} working, ${String(
            seed.signal.idleEventCount,
          )} idle, and ${String(seed.signal.clearEventCount)} clear event(s); sequence ${seed.signal.sequence.join(
            ' -> ',
          )}.`,
          durationMs: seed.durationMs,
        })
      : checkFailed({
          id: 'opencode.signal',
          harness: 'opencode',
          description: 'Observe OpenCode OSC 7501 working followed by idle.',
          expected: 'At least one state=working event precedes a later state=idle event.',
          observed: `working=${String(seed.signal.working)}, idle=${String(
            seed.signal.idle,
          )}, sequence ${seed.signal.sequence.join(' -> ') || 'none'}.`,
          remediation:
            'A live OpenCode run that does not emit working then idle must not be treated as complete. Inspect the OpenCode version and terminal state signal, then rerun npm run test:live:execution.',
          durationMs: seed.durationMs,
          ...(seed.failureExcerpt === undefined ? {} : { excerpt: seed.failureExcerpt }),
        }),
  );

  if (seed.signal.paramFormat === 'colon' && !seed.signal.productParser.recognized) {
    input.report.warnings.push({
      code: 'OSC7501_PRODUCT_PARSER_MISMATCH',
      harness: 'opencode',
      message: `Live OpenCode ${EXPECTED_OPENCODE_VERSION} emitted colon-separated OSC 7501 parameters (state=working:app=opencode). The product parser splits on ";" and recognized ${String(
        seed.signal.productParser.eventCount,
      )} event(s), while the probe's equivalent buffered parser recognized the signal. Report this contract mismatch to the backend engineer.`,
    });
  }
  if (seed.signal.clearEventCount > 0 && !seed.signal.productStateMachine.completed) {
    input.report.warnings.push({
      code: 'OSC7501_CLEAR_BEFORE_IDLE',
      harness: 'opencode',
      message:
        'Live OpenCode emitted clear between working and idle. The product Osc7501StateMachine resets its working observation on clear, so this live order would still fail to advance after the parameter-separator defect is fixed. The probe asserts the CLI order (working before idle) without weakening the no-idle-only rule. Report this contract mismatch to the backend engineer.',
    });
  }

  throwIfInterrupted();

  // Remove both probe skill locations so the recall cannot re-read the token
  // from disk. Main recreates the Copilot `.agents` copy before its seed.
  await removeProbeSkill(input.projectPath, 'opencode');
  await removeProbeSkill(input.projectPath, 'copilot');

  const recall = await runOpenCodeInteractive({
    adapter: input.adapter,
    prompt: OPENCODE_RECALL_PROMPT,
    sessionId,
    projectPath: input.projectPath,
    env: input.env,
    timeoutMs: OPENCODE_RECALL_TIMEOUT_MS,
    requireSignal: false,
    replacements: input.replacements,
  });
  const recallSkillPresent = await probeSkillPresent(input.projectPath, 'opencode');

  input.report.checks.push(
    recall.tokenObserved
      ? checkPassed({
          id: 'opencode.recall',
          harness: 'opencode',
          description: 'Recall the probe token in a second OpenCode process using the same session id.',
          expected: 'The same ses_ session returns the probe token after the probe skill is removed.',
          observed: `The second process recalled the token after ${String(
            recall.durationMs,
          )} ms; probe skill present during recall=${String(recallSkillPresent)}.`,
          durationMs: recall.durationMs,
        })
      : checkFailed({
          id: 'opencode.recall',
          harness: 'opencode',
          description: 'Recall the probe token in a second OpenCode process using the same session id.',
          expected: 'The same ses_ session returns the probe token after the probe skill is removed.',
          observed: recall.timedOut
            ? `Timed out after ${String(recall.durationMs)} ms without the probe token.`
            : `The second process exited ${String(
                recall.exitCode,
              )} without the probe token; session id ${sessionId}.`,
          remediation: openCodeRemediation(recall.failureClass, true),
          durationMs: recall.durationMs,
          ...(recall.failureExcerpt === undefined ? {} : { excerpt: recall.failureExcerpt }),
        }),
  );

  if (await probeSkillPresent(input.projectPath, 'opencode')) {
    await removeProbeSkill(input.projectPath, 'opencode');
  }

  return {
    harness: 'opencode',
    version: null,
    expectedVersion: EXPECTED_OPENCODE_VERSION,
    versionMatches: true,
    sessionId,
    sessionMode: 'shared',
    model: modelSelection.model,
    modelSource: modelSelection.source,
    command: sanitizedCommand(seedCommand, input.replacements, OPENCODE_SEED_PROMPT),
    seededPrompt: {
      passed: seed.tokenObserved,
      tokenObserved: seed.tokenObserved,
      durationMs: seed.durationMs,
      exitCode: seed.exitCode,
      timedOut: seed.timedOut,
      forcedKill: seed.forcedKill,
      skillAvailable,
    },
    signal: seed.signal,
    recall: {
      passed: recall.tokenObserved,
      tokenObserved: recall.tokenObserved,
      durationMs: recall.durationMs,
      exitCode: recall.exitCode,
      timedOut: recall.timedOut,
      forcedKill: recall.forcedKill,
      probeSkillPresent: recallSkillPresent,
    },
    cleanup: {
      sessionsCreated: [sessionId],
      sessionsDeleted: false,
      sessionsStillPresent: [],
    },
  };
}

async function runCopilotProbe(input: {
  report: MutableReport;
  adapter: HarnessAdapter;
  projectPath: string;
  env: NodeJS.ProcessEnv;
  replacements: Array<[string, string]>;
}): Promise<CopilotEvidence> {
  const trust = await resolveCopilotTrust({
    adapter: input.adapter,
    projectPath: input.projectPath,
    env: input.env,
    replacements: input.replacements,
  });

  input.report.checks.push(
    trust.resolved
      ? checkPassed({
          id: 'copilot.trust',
          harness: 'copilot',
          description: 'Resolve Copilot folder trust before running a seeded prompt.',
          expected: 'The temporary project is recorded as a trusted folder.',
          observed: `Trust resolved via ${trust.mechanism} (${trust.reason}) after ${String(
            trust.durationMs,
          )} ms; selection keys sent=${String(trust.sentSelectionKeys)}.`,
          durationMs: trust.durationMs,
        })
      : checkFailed({
          id: 'copilot.trust',
          harness: 'copilot',
          description: 'Resolve Copilot folder trust before running a seeded prompt.',
          expected: 'The temporary project is recorded as a trusted folder.',
          observed:
            trust.outputClassified === 'auth-required'
              ? 'Copilot reported an authentication requirement before folder trust could be resolved.'
              : `Trust did not resolve (${trust.state}/${trust.reason}) after ${String(
                  trust.durationMs,
                )} ms.`,
          remediation:
            trust.outputClassified === 'auth-required'
              ? 'Run "copilot login" in a terminal, or set COPILOT_GITHUB_TOKEN, GH_TOKEN, or GITHUB_TOKEN, then rerun npm run test:live:execution. The probe never copies credentials.'
              : `Run "${trust.manualFallback}" in a terminal, accept the folder-trust dialog, then rerun npm run test:live:execution.`,
          durationMs: trust.durationMs,
        }),
  );

  if (!trust.resolved) {
    for (const check of ['seed', 'recall'] as const) {
      input.report.checks.push(
        checkFailed({
          id: `copilot.${check}`,
          harness: 'copilot',
          description: `Run the live Copilot ${check} probe.`,
          expected: `The Copilot ${check} probe completes successfully after folder trust is resolved.`,
          observed: 'Blocked: Copilot folder trust did not resolve.',
          remediation: `Run "${trust.manualFallback}" in a terminal, accept the folder-trust dialog, then rerun npm run test:live:execution.`,
        }),
      );
    }
    return blockedCopilotRunEvidence(input, trust);
  }

  throwIfInterrupted();

  const sessionId = randomUUID();
  const seed = await runCopilotHeadless({
    adapter: input.adapter,
    prompt: COPILOT_SEED_PROMPT,
    sessionId,
    projectPath: input.projectPath,
    env: input.env,
    replacements: input.replacements,
  });
  const skillAvailable = await probeSkillPresent(input.projectPath, 'copilot');
  const seedCommand = input.adapter.buildHeadlessCommand({
    prompt: COPILOT_SEED_PROMPT,
    sessionId,
    projectPath: input.projectPath,
    sessionMode: 'shared',
    automaticPermissionOptIn: true,
  });

  input.report.checks.push(
    seed.failureClass === 'none'
      ? checkPassed({
          id: 'copilot.seed',
          harness: 'copilot',
          description: 'Run a headless Copilot prompt and return the probe token.',
          expected: `Exit 0 and the ${PROBE_SKILL_NAME} skill returns the probe token.`,
          observed: `The headless prompt returned the probe token after ${String(
            seed.durationMs,
          )} ms; skill line observed=${String(seed.skillObserved)}.`,
          durationMs: seed.durationMs,
        })
      : checkFailed({
          id: 'copilot.seed',
          harness: 'copilot',
          description: 'Run a headless Copilot prompt and return the probe token.',
          expected: `Exit 0 and the ${PROBE_SKILL_NAME} skill returns the probe token.`,
          observed: `Headless failure class ${seed.failureClass}; exit ${String(
            seed.exitCode,
          )}, timed out=${String(seed.timedOut)}, token observed=${String(seed.tokenObserved)}.`,
          remediation: copilotRemediation(seed.failureClass, seed.failureClass === 'trust' ? trust.manualFallback : undefined),
          durationMs: seed.durationMs,
          ...(seed.failureExcerpt === undefined ? {} : { excerpt: seed.failureExcerpt }),
        }),
  );

  throwIfInterrupted();

  await removeProbeSkill(input.projectPath, 'copilot');

  const recall = await runCopilotHeadless({
    adapter: input.adapter,
    prompt: COPILOT_RECALL_PROMPT,
    sessionId,
    projectPath: input.projectPath,
    env: input.env,
    replacements: input.replacements,
  });
  const recallSkillPresent = await probeSkillPresent(input.projectPath, 'copilot');

  input.report.checks.push(
    recall.failureClass === 'none'
      ? checkPassed({
          id: 'copilot.recall',
          harness: 'copilot',
          description: 'Recall the probe token in a second Copilot process using the same UUID session id.',
          expected: 'The same UUID session returns the probe token after the probe skill is removed.',
          observed: `The second process recalled the token after ${String(
            recall.durationMs,
          )} ms; probe skill present during recall=${String(recallSkillPresent)}.`,
          durationMs: recall.durationMs,
        })
      : checkFailed({
          id: 'copilot.recall',
          harness: 'copilot',
          description: 'Recall the probe token in a second Copilot process using the same UUID session id.',
          expected: 'The same UUID session returns the probe token after the probe skill is removed.',
          observed: `Headless failure class ${recall.failureClass}; exit ${String(
            recall.exitCode,
          )}, timed out=${String(recall.timedOut)}, token observed=${String(
            recall.tokenObserved,
          )}; session id ${sessionId}.`,
          remediation:
            'Verify the same UUID session id was passed to both Copilot processes and that Copilot persisted the first session. Rerun npm run test:live:execution.',
          durationMs: recall.durationMs,
          ...(recall.failureExcerpt === undefined ? {} : { excerpt: recall.failureExcerpt }),
        }),
  );

  if (recallSkillPresent) {
    await removeProbeSkill(input.projectPath, 'copilot');
  }

  return {
    harness: 'copilot',
    version: null,
    expectedVersion: EXPECTED_COPILOT_VERSION,
    versionMatches: true,
    sessionId,
    copilotHomeMode: input.report.isolation.copilotHomeMode,
    trust,
    seededPrompt: {
      passed: seed.failureClass === 'none',
      tokenObserved: seed.tokenObserved,
      durationMs: seed.durationMs,
      exitCode: seed.exitCode,
      timedOut: seed.timedOut,
      forcedKill: false,
      skillAvailable,
      skillObserved: seed.skillObserved,
      skillObservation: seed.skillObserved ? 'observed' : 'not-observable',
      broadPermissions: [...input.adapter.automaticPermissions],
    },
    recall: {
      passed: recall.failureClass === 'none',
      tokenObserved: recall.tokenObserved,
      durationMs: recall.durationMs,
      exitCode: recall.exitCode,
      timedOut: recall.timedOut,
      forcedKill: false,
      probeSkillPresent: recallSkillPresent,
    },
    command: sanitizedCommand(seedCommand, input.replacements, COPILOT_SEED_PROMPT),
  };
}

function blockedCopilotRunEvidence(
  input: {
    adapter: HarnessAdapter;
    projectPath: string;
    replacements: Array<[string, string]>;
    report: MutableReport;
  },
  trust: CopilotTrustEvidence,
): CopilotEvidence {
  return {
    harness: 'copilot',
    version: null,
    expectedVersion: EXPECTED_COPILOT_VERSION,
    versionMatches: true,
    sessionId: '',
    copilotHomeMode: input.report.isolation.copilotHomeMode,
    trust,
    seededPrompt: {
      passed: false,
      tokenObserved: false,
      durationMs: 0,
      exitCode: null,
      timedOut: false,
      forcedKill: false,
      skillAvailable: true,
      skillObserved: false,
      skillObservation: 'not-observable',
      broadPermissions: [...input.adapter.automaticPermissions],
    },
    recall: {
      passed: false,
      tokenObserved: false,
      durationMs: 0,
      exitCode: null,
      timedOut: false,
      forcedKill: false,
      probeSkillPresent: false,
    },
    command: {
      executable: 'copilot',
      args: [],
      cwd: sanitize(input.projectPath, input.replacements),
    },
  };
}

function openCodeRemediation(failureClass: FailureClass, recall = false): string {
  switch (failureClass) {
    case 'auth':
      return 'Run "opencode auth login" in a terminal, then rerun npm run test:live:execution. The probe never reads credential values.';
    case 'limit':
      return 'The selected model is rate-limited or out of quota. Authenticate another provider, or set LOOM_LIVE_OPENCODE_MODEL to an available authenticated model, then rerun npm run test:live:execution.';
    case 'timeout':
      return 'The interactive OpenCode run exceeded the bounded timeout. Check the login state and selected model, then rerun npm run test:live:execution.';
    case 'token-missing':
      return recall
        ? 'Verify the same ses_ session id was passed to both OpenCode processes and that OpenCode persisted the first session. Rerun npm run test:live:execution.'
        : 'Confirm the loom-live-probe skill was discovered and the selected model followed the seeded prompt, then rerun npm run test:live:execution.';
    default:
      return 'Inspect the bounded redacted excerpt, fix the reported CLI or skill problem, then rerun npm run test:live:execution.';
  }
}

function copilotRemediation(
  failureClass: FailureClass,
  manualTrustCommandText: string | undefined,
): string {
  switch (failureClass) {
    case 'auth':
      return 'Run "copilot login" in a terminal, or set COPILOT_GITHUB_TOKEN, GH_TOKEN, or GITHUB_TOKEN, then rerun npm run test:live:execution. The probe never copies credentials.';
    case 'trust':
      return `Run "${
        manualTrustCommandText ?? 'copilot'
      }" in a terminal, accept the folder-trust dialog, then rerun npm run test:live:execution.`;
    case 'limit':
      return 'The selected model is rate-limited or out of quota. Authenticate another provider or choose an available model, then rerun npm run test:live:execution.';
    case 'timeout':
      return 'The headless prompt exceeded the bounded timeout. Check the Copilot login state, trust state, and model availability, then rerun npm run test:live:execution.';
    case 'token-missing':
      return `The harness completed without returning the probe token. Confirm the ${PROBE_SKILL_NAME} skill was discovered and the model followed the seeded prompt, then rerun npm run test:live:execution.`;
    default:
      return 'Inspect the bounded redacted excerpt, fix the reported CLI or skill problem, then rerun npm run test:live:execution.';
  }
}

function printSummary(evidence: ExecutionEvidence, fatal: boolean): void {
  const lines: string[] = [];
  lines.push('Skill Loom live execution (RUN-FR-13)');
  lines.push(
    `  node ${evidence.node} | opencode ${
      evidence.prerequisites?.opencode.version ?? 'unavailable'
    } | copilot ${evidence.prerequisites?.copilot.version ?? 'unavailable'}`,
  );

  for (const check of evidence.checks) {
    const label =
      check.status === 'passed' ? 'PASS' : check.status === 'failed' ? 'FAIL' : 'N/A';
    lines.push(`  [${label}] ${check.id}: ${check.observed}`);
    if (check.status === 'failed' && check.remediation !== undefined) {
      lines.push(`         remediation: ${check.remediation}`);
    }
  }

  for (const warning of evidence.warnings) {
    lines.push(`  [WARN] ${warning.code} (${warning.harness}): ${warning.message}`);
  }

  for (const limitation of evidence.limitations) {
    lines.push(`  [LIMIT] ${limitation}`);
  }

  lines.push(`  result: ${evidence.result}`);
  lines.push(`  evidence: ${EVIDENCE_PATH}`);

  if (fatal) {
    lines.push('  A fatal error occurred; see the script.fatal check above.');
  }

  const text = lines.join('\n');
  if (evidence.result === 'passed') {
    console.log(text);
  } else {
    console.error(text);
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`Live execution failed before it could report: ${String(error)}`);
    process.exitCode = 1;
  });
