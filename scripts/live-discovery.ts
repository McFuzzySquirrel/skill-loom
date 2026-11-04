/**
 * CAT-05 / CAT-FR-06 — live discovery probe.
 *
 * Builds a disposable project that contains one probe skill for each harness,
 * runs the real discovery path used by the product (the OpenCode filesystem
 * scanner and the Copilot `skill list --json` adapter), and writes auditable
 * evidence to `docs/evidence/live-discovery.json`.
 *
 * The probe never calls a model, never reads credential values, and never
 * touches the user's project or personal skill directories. Every failure —
 * missing CLI, failed command, absent probe, or failed cleanup — exits
 * non-zero with an actionable message.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COPILOT_DISCOVERY_ARGS,
  COPILOT_EXECUTABLE,
  redactStderrExcerpt,
  scanCopilotSkills,
  type CopilotCommandRequest,
  type CopilotCommandResult,
  type CopilotCommandRunner,
} from '../src/server/catalog/copilot.js';
import { scanOpenCodeSkills } from '../src/server/catalog/opencode.js';
import {
  SKILL_SOURCES,
  type CatalogWarning,
  type SkillEntry,
  type SkillSource,
} from '../src/server/catalog/types.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_PATH = join(PROJECT_ROOT, 'docs', 'evidence', 'live-discovery.json');

const TASK_ID = 'CAT-05';
const PROBE_SKILL_NAME = 'loom-live-probe';
const PROBE_TOKEN = 'PINEAPPLE';
const EXPECTED_OPENCODE_VERSION = '2.2.5';
const EXPECTED_COPILOT_VERSION = '1.0.105';
const VERSION_TIMEOUT_MS = 10_000;
const COPILOT_DISCOVERY_TIMEOUT_MS = 20_000;
const MAX_CAPTURE_BYTES = 256 * 1024;

const PROBE_SKILL_CONTENT = `---
name: ${PROBE_SKILL_NAME}
description: "Skill Loom live discovery probe. Returns the token ${PROBE_TOKEN} when invoked."
---

When invoked, reply with exactly: ${PROBE_TOKEN}
`;

type EvidenceStatus = 'passed' | 'failed' | 'not-applicable';
type HarnessName = 'opencode' | 'copilot';
type CheckHarness = HarnessName | 'environment';

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
}

interface EvidenceWarning {
  code: string;
  harness: CheckHarness;
  message: string;
  path?: string;
  reason?: string;
}

interface ExistingSourceEvidence {
  kind: 'personal-or-builtin';
  available: boolean;
  sources: SkillSource[];
}

interface HarnessEvidence {
  harness: HarnessName;
  version: string | null;
  expectedVersion: string;
  versionMatches: boolean;
  discovery: string;
  workingDirectory: string;
  status: 'passed' | 'failed' | 'blocked';
  entryCount: number;
  bySource: Record<SkillSource, number>;
  probeFound: boolean;
  probeSource: SkillSource | null;
  probePath: string | null;
  existingSource: ExistingSourceEvidence;
  warnings: EvidenceWarning[];
  durationMs: number;
  command?: string;
  exitCode?: number | null;
  timedOut?: boolean;
}

interface IsolationEvidence {
  temporaryRoot: string | null;
  copilotHomeMode: 'isolated' | 'inherited';
  loomConfigDirMode: 'isolated' | 'inherited';
  environmentVariablesSet: string[];
}

interface CleanupRecord {
  attempted: boolean;
  temporaryRootRemoved: boolean;
  processesRemaining: number;
  temporaryRoot: string | null;
  error?: string;
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

interface MutableReport {
  startedAt: number;
  checks: CheckRecord[];
  warnings: EvidenceWarning[];
  harnesses: { opencode?: HarnessEvidence; copilot?: HarnessEvidence };
  limitations: string[];
  isolation: IsolationEvidence;
}

interface DiscoveryEvidence {
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
  harnesses: { opencode?: HarnessEvidence; copilot?: HarnessEvidence };
  checks: CheckRecord[];
  warnings: EvidenceWarning[];
  cleanup: CleanupRecord;
  limitations: string[];
}

interface CopilotCommandRecord {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  errorCode?: string;
  stderrExcerpt?: string;
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

/* ------------------------------------------------------------------------- */
/* Process tracking and cleanup                                              */
/* ------------------------------------------------------------------------- */

const activeChildren = new Set<ChildProcess>();
let temporaryRoot: string | undefined;
let temporaryRootRemovedSync = false;
let cleanupPromise: Promise<CleanupRecord> | undefined;
let currentReport: MutableReport | undefined;
let interruptedBy: 'SIGINT' | 'SIGTERM' | undefined;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

function killTrackedChildren(signal: NodeJS.Signals): void {
  for (const child of activeChildren) {
    killChildTree(child, signal);
  }
}

/**
 * Signal the child's process group on POSIX so a harness that spawns helpers
 * cannot leave a grandchild behind. Windows has no process-group signal, so
 * the direct child is signalled instead.
 */
function killChildTree(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (pid !== undefined && process.platform !== 'win32') {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // The group may already be gone; fall back to the direct child.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // The child may have exited between iterations; nothing to do.
  }
}

async function waitForChildrenToExit(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (activeChildren.size > 0 && Date.now() < deadline) {
    await delay(20);
  }
}

async function terminateActiveChildren(): Promise<void> {
  if (activeChildren.size === 0) {
    return;
  }
  killTrackedChildren('SIGTERM');
  await waitForChildrenToExit(250);
  if (activeChildren.size > 0) {
    killTrackedChildren('SIGKILL');
    await waitForChildrenToExit(250);
  }
}

async function cleanupTemporaryRoot(): Promise<CleanupRecord> {
  cleanupPromise ??= performCleanup();
  return cleanupPromise;
}

async function performCleanup(): Promise<CleanupRecord> {
  await terminateActiveChildren();

  const root = temporaryRoot;
  if (root === undefined) {
    return {
      attempted: false,
      temporaryRootRemoved: true,
      processesRemaining: activeChildren.size,
      temporaryRoot: null,
    };
  }

  try {
    await rm(root, { recursive: true, force: true });
  } catch (error) {
    return {
      attempted: true,
      temporaryRootRemoved: false,
      processesRemaining: activeChildren.size,
      temporaryRoot: root,
      error: errnoCode(error) ?? 'CLEANUP_FAILED',
    };
  }

  try {
    await stat(root);
    return {
      attempted: true,
      temporaryRootRemoved: false,
      processesRemaining: activeChildren.size,
      temporaryRoot: root,
      error: 'STILL_EXISTS',
    };
  } catch {
    temporaryRootRemovedSync = true;
    return {
      attempted: true,
      temporaryRootRemoved: true,
      processesRemaining: activeChildren.size,
      temporaryRoot: null,
    };
  }
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
    let timedOut = false;
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let killHandle: NodeJS.Timeout | undefined;
    let child: ChildProcess | undefined;

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null, errorCode?: string): void => {
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
      if (stdout.length < MAX_CAPTURE_BYTES) {
        stdout += chunk.toString();
      }
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      if (stderr.length < MAX_CAPTURE_BYTES) {
        stderr += chunk.toString();
      }
    });

    timeoutHandle = setTimeout(() => {
      if (settled) {
        return;
      }
      timedOut = true;
      child?.kill('SIGTERM');
      killHandle = setTimeout(() => {
        if (!settled) {
          child?.kill('SIGKILL');
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

/* ------------------------------------------------------------------------- */
/* Versions and environment                                                  */
/* ------------------------------------------------------------------------- */

function parseVersion(output: string): string | null {
  const match = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(output);
  return match?.[1] ?? null;
}

async function probeVersion(
  executable: string,
  expectedVersion: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<VersionProbe> {
  const command = `${executable} --version`;
  const result = await runTrackedCommand(executable, ['--version'], {
    cwd,
    env,
    timeoutMs: VERSION_TIMEOUT_MS,
  });
  const version = parseVersion(`${result.stdout}\n${result.stderr}`);
  const available =
    result.errorCode === undefined && result.exitCode === 0 && !result.timedOut && version !== null;

  const probe: VersionProbe = {
    executable,
    command,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    version,
    expectedVersion,
    versionMatches: version === expectedVersion,
    available,
  };
  if (result.errorCode !== undefined) {
    probe.errorCode = result.errorCode;
  }
  return probe;
}

interface Isolation {
  evidence: IsolationEvidence;
  copilotHome: string;
  loomConfigDir: string;
  childEnv: NodeJS.ProcessEnv;
  replacements: Array<[string, string]>;
}

async function createIsolation(root: string): Promise<Isolation> {
  const inheritedCopilotHome = nonEmpty(process.env.COPILOT_HOME);
  const inheritedLoomConfig = nonEmpty(process.env.LOOM_CONFIG_DIR);

  const copilotHome = inheritedCopilotHome ?? join(root, 'copilot-home');
  const loomConfigDir = inheritedLoomConfig ?? join(root, 'loom-config');
  const projectDirectory = join(root, 'project');

  if (inheritedCopilotHome === undefined) {
    await mkdir(copilotHome, { recursive: true });
  }
  if (inheritedLoomConfig === undefined) {
    await mkdir(loomConfigDir, { recursive: true });
  }
  await mkdir(projectDirectory, { recursive: true });

  const environmentVariablesSet = ['COPILOT_HOME', 'LOOM_CONFIG_DIR'];
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    COPILOT_HOME: copilotHome,
    LOOM_CONFIG_DIR: loomConfigDir,
  };

  const replacements: Array<[string, string]> = [];
  replacements.push([projectDirectory, '<temporary-root>/project']);
  replacements.push([root, '<temporary-root>']);
  const home = homedir();
  if (home !== '') {
    replacements.push([home, '~']);
  }

  return {
    evidence: {
      temporaryRoot: '<temporary-root>',
      copilotHomeMode: inheritedCopilotHome === undefined ? 'isolated' : 'inherited',
      loomConfigDirMode: inheritedLoomConfig === undefined ? 'isolated' : 'inherited',
      environmentVariablesSet,
    },
    copilotHome,
    loomConfigDir,
    childEnv,
    replacements,
  };
}

/* ------------------------------------------------------------------------- */
/* Evidence helpers                                                          */
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
    result = result.split(search).join(replacement);
  }
  return result;
}

function sanitizeError(error: unknown, replacements: Array<[string, string]>): string {
  const message = error instanceof Error ? error.message : String(error);
  return sanitize(message, replacements);
}

function emptySourceCounts(): Record<SkillSource, number> {
  const counts = {} as Record<SkillSource, number>;
  for (const source of SKILL_SOURCES) {
    counts[source] = 0;
  }
  return counts;
}

function countBySource(entries: readonly SkillEntry[]): Record<SkillSource, number> {
  const counts = emptySourceCounts();
  for (const entry of entries) {
    counts[entry.source] += 1;
  }
  return counts;
}

function toEvidenceWarning(
  warning: CatalogWarning,
  replacements: Array<[string, string]>,
): EvidenceWarning {
  const result: EvidenceWarning = {
    code: warning.code,
    harness: warning.harness,
    message: sanitize(warning.message, replacements),
  };
  if (warning.path !== undefined) {
    result.path = sanitize(warning.path, replacements);
  }
  if (warning.reason !== undefined) {
    result.reason = warning.reason;
  }
  return result;
}

function addCheck(report: MutableReport, check: CheckRecord): void {
  report.checks.push(check);
}

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
/* Discovery probes                                                          */
/* ------------------------------------------------------------------------- */

async function writeProbeSkills(projectPath: string): Promise<void> {
  const locations = [
    join(projectPath, '.opencode', 'skills', PROBE_SKILL_NAME),
    join(projectPath, '.agents', 'skills', PROBE_SKILL_NAME),
  ];
  for (const directory of locations) {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'SKILL.md'), PROBE_SKILL_CONTENT, 'utf8');
  }
}

async function probeOpenCode(input: {
  report: MutableReport;
  projectPath: string;
  expectedProbePath: string;
  version: VersionProbe;
}): Promise<HarnessEvidence> {
  const { report, projectPath, expectedProbePath, version } = input;
  const startedAt = Date.now();
  const harness: HarnessEvidence = {
    harness: 'opencode',
    version: version.version,
    expectedVersion: EXPECTED_OPENCODE_VERSION,
    versionMatches: version.versionMatches,
    discovery: 'scanOpenCodeSkills (project, personal, and Loom extra directories)',
    workingDirectory: sanitize(projectPath, sanitizeReplacements()),
    status: 'blocked',
    entryCount: 0,
    bySource: emptySourceCounts(),
    probeFound: false,
    probeSource: null,
    probePath: null,
    existingSource: { kind: 'personal-or-builtin', available: false, sources: [] },
    warnings: [],
    durationMs: 0,
  };

  if (!version.available) {
    const observed =
      version.errorCode !== undefined
        ? `opencode --version could not start (${version.errorCode})`
        : `opencode --version exited ${String(version.exitCode)}${version.timedOut ? ' after timing out' : ''}`;
    addCheck(
      report,
      checkFailed({
        id: 'opencode.probe',
        harness: 'opencode',
        description: 'Discover the temporary OpenCode probe skill with the real scanner.',
        expected: `A project entry named ${PROBE_SKILL_NAME} under .opencode/skills.`,
        observed: `Blocked: ${observed}.`,
        remediation:
          'Install OpenCode 2.2.5, ensure "opencode" resolves on PATH, then rerun npm run test:live:discovery.',
        durationMs: version.durationMs,
      }),
    );
    harness.durationMs = Date.now() - startedAt;
    return harness;
  }

  try {
    const discovery = await scanOpenCodeSkills({ projectPath });
    const entries = discovery.entries;
    const probe = entries.find(
      (entry) => entry.name === PROBE_SKILL_NAME && entry.source === 'project' && entry.path === expectedProbePath,
    );
    const sources = [...new Set(entries.map((entry) => entry.source))].sort();
    const existingSource = sources.includes('personal') || sources.includes('builtin');

    harness.entryCount = entries.length;
    harness.bySource = countBySource(entries);
    harness.probeFound = probe !== undefined;
    harness.probeSource = probe?.source ?? null;
    harness.probePath = probe === undefined ? null : sanitize(probe.path, sanitizeReplacements());
    harness.existingSource = {
      kind: 'personal-or-builtin',
      available: existingSource,
      sources,
    };
    harness.warnings = discovery.warnings.map((warning) =>
      toEvidenceWarning(warning, sanitizeReplacements()),
    );
    harness.status = probe === undefined ? 'failed' : 'passed';
    report.warnings.push(...harness.warnings);

    addCheck(
      report,
      probe === undefined
        ? checkFailed({
            id: 'opencode.probe',
            harness: 'opencode',
            description: 'Discover the temporary OpenCode probe skill with the real scanner.',
            expected: `A project entry named ${PROBE_SKILL_NAME} at ${sanitize(expectedProbePath, sanitizeReplacements())}.`,
            observed: `No matching entry among ${String(entries.length)} discovered entries (sources: ${sources.join(', ') || 'none'}).`,
            remediation:
              'Confirm .opencode/skills/loom-live-probe/SKILL.md exists with a matching frontmatter name. Report a scanner defect to the backend engineer.',
            durationMs: Date.now() - startedAt,
          })
        : checkPassed({
            id: 'opencode.probe',
            harness: 'opencode',
            description: 'Discover the temporary OpenCode probe skill with the real scanner.',
            expected: `A project entry named ${PROBE_SKILL_NAME} at ${sanitize(expectedProbePath, sanitizeReplacements())}.`,
            observed: `Found ${String(harness.entryCount)} entries in total, ${String(harness.bySource.project)} from the project source.`,
            durationMs: Date.now() - startedAt,
          }),
    );

    addCheck(report, existingSourceCheck('opencode', existingSource, sources));
    if (!existingSource) {
      report.limitations.push(
        'OpenCode returned no personal or builtin skill source; this machine has no personal OpenCode skills installed, so only project discovery could be asserted.',
      );
    }
  } catch (error) {
    harness.status = 'failed';
    addCheck(
      report,
      checkFailed({
        id: 'opencode.probe',
        harness: 'opencode',
        description: 'Discover the temporary OpenCode probe skill with the real scanner.',
        expected: `A project entry named ${PROBE_SKILL_NAME} under .opencode/skills.`,
        observed: `scanOpenCodeSkills threw: ${sanitizeError(error, sanitizeReplacements())}`,
        remediation:
          'Inspect the scanner error and rerun npm run test:live:discovery. Report a product defect to the backend engineer.',
        durationMs: Date.now() - startedAt,
      }),
    );
  }

  harness.durationMs = Date.now() - startedAt;
  return harness;
}

function existingSourceCheck(
  harness: HarnessName,
  available: boolean,
  sources: SkillSource[],
): CheckRecord {
  const description = 'Assert an existing personal or builtin source is returned where available.';
  const expected = 'At least one personal or builtin entry when the machine has one installed.';
  const observed =
    sources.length === 0
      ? 'No skill sources were returned.'
      : `Sources returned: ${sources.join(', ')}.`;

  if (!available) {
    return checkNotApplicable({
      id: `${harness}.existing-source`,
      harness,
      description,
      expected,
      observed: `${observed} No personal or builtin source is available on this machine.`,
    });
  }

  const existing = sources.filter((source) => source === 'personal' || source === 'builtin');
  return checkPassed({
    id: `${harness}.existing-source`,
    harness,
    description,
    expected,
    observed: `${observed} Existing source(s): ${existing.join(', ')}.`,
  });
}

async function probeCopilot(input: {
  report: MutableReport;
  projectPath: string;
  expectedProbePath: string;
  version: VersionProbe;
  env: NodeJS.ProcessEnv;
}): Promise<HarnessEvidence> {
  const { report, projectPath, expectedProbePath, version, env } = input;
  const startedAt = Date.now();
  const records: CopilotCommandRecord[] = [];
  const runner: CopilotCommandRunner = async (
    request: CopilotCommandRequest,
  ): Promise<CopilotCommandResult> => {
    const result = await runTrackedCommand(request.executable, request.args, {
      cwd: request.cwd,
      env,
      timeoutMs: request.timeoutMs,
    });

    const record: CopilotCommandRecord = {
      command: [request.executable, ...request.args].join(' '),
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
    };
    if (result.errorCode !== undefined) {
      record.errorCode = result.errorCode;
    }
    const excerpt = redactStderrExcerpt(result.stderr);
    if (excerpt !== '') {
      record.stderrExcerpt = excerpt;
    }
    records.push(record);

    const adapterResult: CopilotCommandResult = {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
      signal: result.signal,
    };
    if (result.errorCode !== undefined) {
      adapterResult.errorCode = result.errorCode;
    }
    return adapterResult;
  };

  const harness: HarnessEvidence = {
    harness: 'copilot',
    version: version.version,
    expectedVersion: EXPECTED_COPILOT_VERSION,
    versionMatches: version.versionMatches,
    discovery: `${COPILOT_EXECUTABLE} ${COPILOT_DISCOVERY_ARGS.join(' ')}`,
    workingDirectory: sanitize(projectPath, sanitizeReplacements()),
    status: 'blocked',
    entryCount: 0,
    bySource: emptySourceCounts(),
    probeFound: false,
    probeSource: null,
    probePath: null,
    existingSource: { kind: 'personal-or-builtin', available: false, sources: [] },
    warnings: [],
    durationMs: 0,
    command: `${COPILOT_EXECUTABLE} ${COPILOT_DISCOVERY_ARGS.join(' ')}`,
  };

  if (!version.available) {
    const observed =
      version.errorCode !== undefined
        ? `copilot --version could not start (${version.errorCode})`
        : `copilot --version exited ${String(version.exitCode)}${version.timedOut ? ' after timing out' : ''}`;
    addCheck(
      report,
      checkFailed({
        id: 'copilot.probe',
        harness: 'copilot',
        description: 'Discover the temporary Copilot probe skill through copilot skill list --json.',
        expected: `A project entry named ${PROBE_SKILL_NAME} from .agents/skills.`,
        observed: `Blocked: ${observed}.`,
        remediation:
          'Install GitHub Copilot CLI 1.0.105, ensure "copilot" resolves on PATH, then rerun npm run test:live:discovery.',
        durationMs: version.durationMs,
      }),
    );
    harness.durationMs = Date.now() - startedAt;
    return harness;
  }

  try {
    const discovery = await scanCopilotSkills({
      projectPath,
      timeoutMs: COPILOT_DISCOVERY_TIMEOUT_MS,
      runner,
    });
    const entries = discovery.entries;
    const probe = entries.find(
      (entry) => entry.name === PROBE_SKILL_NAME && entry.source === 'project' && entry.path === expectedProbePath,
    );
    const sources = [...new Set(entries.map((entry) => entry.source))].sort();
    const existingSource = sources.includes('personal') || sources.includes('builtin');
    const command = records[0];

    harness.entryCount = entries.length;
    harness.bySource = countBySource(entries);
    harness.probeFound = probe !== undefined;
    harness.probeSource = probe?.source ?? null;
    harness.probePath = probe === undefined ? null : sanitize(probe.path, sanitizeReplacements());
    harness.existingSource = {
      kind: 'personal-or-builtin',
      available: existingSource,
      sources,
    };
    harness.warnings = discovery.warnings.map((warning) =>
      toEvidenceWarning(warning, sanitizeReplacements()),
    );
    harness.status = probe === undefined ? 'failed' : 'passed';
    if (command !== undefined) {
      harness.exitCode = command.exitCode;
      harness.timedOut = command.timedOut;
      harness.command = command.command;
    }
    report.warnings.push(...harness.warnings);

    const commandOk =
      command !== undefined && command.exitCode === 0 && !command.timedOut && command.errorCode === undefined;
    const commandObserved =
      command === undefined
        ? 'The adapter did not invoke the discovery command.'
        : `${command.command} exited ${String(command.exitCode)}${command.timedOut ? ' after timing out' : ''}${
            command.errorCode === undefined ? '' : ` (${command.errorCode})`
          }`;

    addCheck(
      report,
      commandOk
        ? checkPassed({
            id: 'copilot.command',
            harness: 'copilot',
            description: 'Run the real copilot skill list --json discovery command.',
            expected: 'Exit code 0 without a timeout.',
            observed: commandObserved,
            ...(command?.durationMs === undefined ? {} : { durationMs: command.durationMs }),
          })
        : checkFailed({
            id: 'copilot.command',
            harness: 'copilot',
            description: 'Run the real copilot skill list --json discovery command.',
            expected: 'Exit code 0 without a timeout.',
            observed: commandObserved,
            remediation: command?.errorCode
              ? 'Ensure the "copilot" executable is installed and on PATH, then rerun npm run test:live:discovery.'
              : 'Run "copilot skill list --json" manually in a temporary project, fix the reported error, then rerun npm run test:live:discovery.',
            ...(command?.durationMs === undefined ? {} : { durationMs: command.durationMs }),
          }),
    );

    addCheck(
      report,
      probe === undefined
        ? checkFailed({
            id: 'copilot.probe',
            harness: 'copilot',
            description: 'Discover the temporary Copilot probe skill through copilot skill list --json.',
            expected: `A project entry named ${PROBE_SKILL_NAME} at ${sanitize(expectedProbePath, sanitizeReplacements())}.`,
            observed: `No matching entry among ${String(entries.length)} discovered entries (sources: ${sources.join(', ') || 'none'}).`,
            remediation:
              'Confirm .agents/skills/loom-live-probe/SKILL.md exists with a matching frontmatter name and that copilot runs with the temporary project as cwd.',
            durationMs: Date.now() - startedAt,
          })
        : checkPassed({
            id: 'copilot.probe',
            harness: 'copilot',
            description: 'Discover the temporary Copilot probe skill through copilot skill list --json.',
            expected: `A project entry named ${PROBE_SKILL_NAME} at ${sanitize(expectedProbePath, sanitizeReplacements())}.`,
            observed: `Found ${String(harness.entryCount)} entries in total, ${String(harness.bySource.project)} from the project source.`,
            durationMs: Date.now() - startedAt,
          }),
    );

    addCheck(report, existingSourceCheck('copilot', existingSource, sources));
    if (!existingSource) {
      report.limitations.push(
        'Copilot returned no personal or builtin skill source; only project discovery could be asserted.',
      );
    }
  } catch (error) {
    harness.status = 'failed';
    addCheck(
      report,
      checkFailed({
        id: 'copilot.probe',
        harness: 'copilot',
        description: 'Discover the temporary Copilot probe skill through copilot skill list --json.',
        expected: `A project entry named ${PROBE_SKILL_NAME} under .agents/skills.`,
        observed: `scanCopilotSkills threw: ${sanitizeError(error, sanitizeReplacements())}`,
        remediation:
          'Inspect the adapter error and rerun npm run test:live:discovery. Report a product defect to the backend engineer.',
        durationMs: Date.now() - startedAt,
      }),
    );
  }

  harness.durationMs = Date.now() - startedAt;
  return harness;
}

function sanitizeReplacements(): Array<[string, string]> {
  const replacements: Array<[string, string]> = [];
  if (temporaryRoot !== undefined) {
    replacements.push([join(temporaryRoot, 'project'), '<temporary-root>/project']);
    replacements.push([temporaryRoot, '<temporary-root>']);
  }
  const home = homedir();
  if (home !== '') {
    replacements.push([home, '~']);
  }
  return replacements;
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

function cleanupCheck(cleanup: CleanupRecord): CheckRecord {
  return cleanup.temporaryRootRemoved
    ? checkPassed({
        id: 'cleanup.temporary-root',
        harness: 'environment',
        description: 'Remove the temporary project, probe skills, and config directories.',
        expected: 'The temporary root no longer exists and no child process remains.',
        observed: `Temporary root removed; ${String(cleanup.processesRemaining)} tracked child process(es) remaining.`,
      })
    : checkFailed({
        id: 'cleanup.temporary-root',
        harness: 'environment',
        description: 'Remove the temporary project, probe skills, and config directories.',
        expected: 'The temporary root no longer exists and no child process remains.',
        observed: `Temporary root still present (${cleanup.error ?? 'UNKNOWN'}); ${String(cleanup.processesRemaining)} tracked child process(es) remaining.`,
        remediation: 'Remove the path reported in cleanup.temporaryRoot manually, then rerun the probe.',
      });
}

async function writeEvidenceFile(filePath: string, evidence: DiscoveryEvidence): Promise<void> {
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
}): Promise<DiscoveryEvidence> {
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
    harnesses: input.report.harnesses,
    checks: input.report.checks,
    warnings: input.report.warnings,
    cleanup: input.cleanup,
    limitations: input.report.limitations,
  };
}

function reportResult(report: MutableReport, cleanup: CleanupRecord): 'passed' | 'failed' {
  if (!cleanup.temporaryRootRemoved) {
    return 'failed';
  }
  return report.checks.some((check) => check.status === 'failed') ? 'failed' : 'passed';
}

/* ------------------------------------------------------------------------- */
/* Signal handling                                                           */
/* ------------------------------------------------------------------------- */

/**
 * A signal aborts the active child commands and lets `main` finish through its
 * single cleanup and evidence path. This avoids two writers racing over the
 * evidence file and guarantees one final cleanup record.
 */
function installProcessHandlers(): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (interruptedBy !== undefined) {
        return;
      }
      interruptedBy = signal;
      void terminateActiveChildren();
    });
  }
  process.on('exit', () => {
    killTrackedChildren('SIGKILL');
    if (temporaryRoot !== undefined && !temporaryRootRemovedSync) {
      try {
        rmSync(temporaryRoot, { recursive: true, force: true });
      } catch {
        // Best-effort synchronous fallback; the async cleanup reports failure.
      }
    }
  });
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
      copilotHomeMode: 'isolated',
      loomConfigDirMode: 'isolated',
      environmentVariablesSet: ['COPILOT_HOME', 'LOOM_CONFIG_DIR'],
    },
  };
  currentReport = report;

  const root = await mkdtemp(join(tmpdir(), 'loom-live-discovery-'));
  temporaryRoot = root;

  const isolation = await createIsolation(root);
  report.isolation = isolation.evidence;
  const projectPath = join(root, 'project');
  const canonicalProject = await realpath(projectPath);

  // Product seams that read the environment must see the isolated values.
  process.env.COPILOT_HOME = isolation.copilotHome;
  process.env.LOOM_CONFIG_DIR = isolation.loomConfigDir;

  let prerequisites: { opencode: VersionProbe; copilot: VersionProbe } | null = null;
  let fatal: unknown;

  try {
    await writeProbeSkills(projectPath);

    const openCodeVersion = await probeVersion(
      'opencode',
      EXPECTED_OPENCODE_VERSION,
      isolation.childEnv,
      canonicalProject,
    );
    const copilotVersion = await probeVersion(
      COPILOT_EXECUTABLE,
      EXPECTED_COPILOT_VERSION,
      isolation.childEnv,
      canonicalProject,
    );
    prerequisites = { opencode: openCodeVersion, copilot: copilotVersion };

    for (const probe of [openCodeVersion, copilotVersion]) {
      const harness = probe.executable === 'opencode' ? 'opencode' : 'copilot';
      const remediation =
        harness === 'opencode'
          ? 'Install OpenCode 2.2.5, ensure "opencode" resolves on PATH, then rerun npm run test:live:discovery.'
          : 'Install GitHub Copilot CLI 1.0.105, ensure "copilot" resolves on PATH, then rerun npm run test:live:discovery.';

      addCheck(
        report,
        probe.available
          ? checkPassed({
              id: `prereq.${harness}`,
              harness,
              description: `Confirm the ${harness} CLI is installed and reports a version.`,
              expected: `${probe.command} exits 0 and prints a semantic version.`,
              observed: `${probe.command} exited ${String(probe.exitCode)} and reported ${probe.version ?? 'no parseable version'}.`,
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
                  : `${probe.command} exited ${String(probe.exitCode)}${probe.timedOut ? ' after timing out' : ''}.`,
              remediation,
              durationMs: probe.durationMs,
            }),
      );

      if (probe.available && !probe.versionMatches) {
        report.warnings.push({
          code: 'CLI_VERSION_MISMATCH',
          harness,
          message: `Expected ${probe.expectedVersion}, observed ${probe.version ?? 'unknown'}. The probe continued against the installed version.`,
        });
      }
    }

    const expectedOpenCodeProbePath = await realpath(
      join(canonicalProject, '.opencode', 'skills', PROBE_SKILL_NAME, 'SKILL.md'),
    );
    const expectedCopilotProbePath = await realpath(
      join(canonicalProject, '.agents', 'skills', PROBE_SKILL_NAME, 'SKILL.md'),
    );

    report.harnesses.opencode = await probeOpenCode({
      report,
      projectPath: canonicalProject,
      expectedProbePath: expectedOpenCodeProbePath,
      version: openCodeVersion,
    });
    report.harnesses.copilot = await probeCopilot({
      report,
      projectPath: canonicalProject,
      expectedProbePath: expectedCopilotProbePath,
      version: copilotVersion,
      env: isolation.childEnv,
    });
  } catch (error) {
    fatal = error;
    addCheck(
      report,
      checkFailed({
        id: 'script.fatal',
        harness: 'environment',
        description: 'The live discovery probe completed its setup and discovery sequence.',
        expected: 'No unhandled error.',
        observed: sanitizeError(error, isolation.replacements),
        remediation:
          'Inspect the error, confirm Node 24+ and both CLIs are installed, then rerun npm run test:live:discovery.',
      }),
    );
  } finally {
    killTrackedChildren('SIGTERM');
  }

  if (interruptedBy !== undefined) {
    addCheck(
      report,
      checkFailed({
        id: 'script.interrupted',
        harness: 'environment',
        description: 'The live discovery probe ran to completion.',
        expected: 'The probe finishes without an interrupt.',
        observed: `Received ${interruptedBy}; the run was stopped and cleaned up.`,
        remediation: 'Rerun npm run test:live:discovery and let it finish.',
      }),
    );
  }

  const cleanup = await cleanupTemporaryRoot();
  addCheck(report, cleanupCheck(cleanup));

  const result = interruptedBy !== undefined ? 'interrupted' : reportResult(report, cleanup);
  const evidence = await buildEvidence({ report, result, cleanup, prerequisites });

  try {
    await writeEvidenceFile(EVIDENCE_PATH, evidence);
  } catch (error) {
    console.error(
      `Live discovery: evidence could not be written to ${EVIDENCE_PATH}: ${sanitizeError(error, isolation.replacements)}`,
    );
    return 1;
  }

  printSummary(evidence, fatal !== undefined);
  if (interruptedBy !== undefined) {
    return interruptedBy === 'SIGINT' ? 130 : 143;
  }
  return result === 'passed' ? 0 : 1;
}

function printSummary(evidence: DiscoveryEvidence, fatal: boolean): void {
  const lines: string[] = [];
  lines.push('Skill Loom live discovery (CAT-FR-06)');
  lines.push(
    `  node ${evidence.node} | opencode ${evidence.prerequisites?.opencode.version ?? 'unavailable'} | copilot ${
      evidence.prerequisites?.copilot.version ?? 'unavailable'
    }`,
  );

  for (const check of evidence.checks) {
    const label =
      check.status === 'passed' ? 'PASS' : check.status === 'failed' ? 'FAIL' : 'SKIP';
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
    console.error(`Live discovery failed before it could report: ${String(error)}`);
    process.exitCode = 1;
  });
