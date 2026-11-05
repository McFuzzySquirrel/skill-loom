import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  lstat,
  link,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { ChainBundle, BundleSkill } from '../shared/bundles.js';
import { chainStepName } from '../shared/chain.js';
import { frontmatterString, parseSkillFrontmatter } from '../server/catalog/frontmatter.js';
import {
  MAX_BUNDLE_REQUEST_BYTES,
  BundleError,
  chainFromBundle,
  decodeBundleFile,
  parseBundle,
} from './bundle.js';

const RUN_VERSION = 1;
const MAX_SUMMARY_BYTES = 8 * 1024;
const MAX_STEP_INSTRUCTION_BYTES = 64 * 1024;
const MAX_PORTABLE_STEPS = 1_000;
const MAX_ATTEMPTS_PER_STEP = 50;
const RUN_ID_PATTERN = /^[a-f0-9-]{36}$/;
const SafeInputSchema = z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), z.string().max(16_384));
const AttemptSchema = z.strictObject({
  number: z.number().int().positive(),
  status: z.enum(['running', 'done', 'failed', 'skipped', 'interrupted']),
  startedAt: z.iso.datetime({ offset: true }),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
  summary: z.string().max(MAX_SUMMARY_BYTES).nullable(),
  reason: z.string().max(2_000).nullable(),
});
const RunSchema = z.strictObject({
  version: z.literal(RUN_VERSION),
  id: z.string().regex(RUN_ID_PATTERN),
  revision: z.number().int().positive(),
  projectPath: z.string().min(1),
  bundleFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  bundle: z.custom<ChainBundle>((value) => {
    try {
      parseBundle(value);
      return true;
    } catch {
      return false;
    }
  }),
  actualHost: z.enum(['copilot', 'opencode', 'other']),
  hostSwitchConfirmed: z.boolean(),
  progression: z.enum(['supervised', 'agent']),
  progressionConfirmed: z.boolean(),
  sessionDecision: z.strictObject({
    requested: z.enum(['shared', 'fresh', 'fork']),
    mechanism: z.enum(['current-conversation', 'isolated-worker', 'native-fork', 'handoff']),
    description: z.string().trim().min(1).max(500),
    confirmed: z.boolean(),
  }),
  resolvedInputs: SafeInputSchema,
  installedSkills: z.array(z.strictObject({
    name: z.string(),
    directory: z.string(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    reused: z.boolean(),
  })),
  status: z.enum(['ready', 'running', 'paused', 'failed', 'completed', 'aborted', 'interrupted']),
  currentStepIndex: z.number().int().min(0),
  resumeRequired: z.boolean(),
  steps: z.array(z.strictObject({
    id: z.string().min(1),
    index: z.number().int().min(0),
    attempts: z.array(AttemptSchema).max(MAX_ATTEMPTS_PER_STEP),
  })).min(1).max(MAX_PORTABLE_STEPS),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
type PortableRun = z.infer<typeof RunSchema>;

export class PortableRunError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PortableRunError';
  }
}

function fail(code: string, message: string): never {
  throw new PortableRunError(code, message);
}

function now(): string {
  return new Date().toISOString();
}

function fingerprint(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function packageFingerprint(files: BundleSkill['files']): string {
  const hash = createHash('sha256');
  const directories = new Set<string>();
  const fileMap = new Map(files.map((file) => [file.path, file]));
  for (const file of files) {
    const segments = file.path.split('/');
    segments.pop();
    while (segments.length > 0) {
      directories.add(segments.join('/'));
      segments.pop();
    }
  }
  function visit(directory: string): void {
    const children = new Set<string>();
    for (const path of directories) {
      if (portableParent(path) === directory) children.add(path);
    }
    for (const path of fileMap.keys()) {
      if (portableParent(path) === directory) children.add(path);
    }
    for (const path of [...children].sort((a, b) => basename(a).localeCompare(basename(b)))) {
      if (directories.has(path)) {
        hash.update(path).update('\0d\0');
        visit(path);
      } else {
        const file = fileMap.get(path)!;
        hash.update(path).update('\0f\0').update(file.executable ? '1' : '0').update('\0');
        hash.update(decodeBundleFile(file.content)).update('\0');
      }
    }
  }
  visit('');
  return hash.digest('hex');
}

function portableParent(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

function resolvedInputs(bundle: ChainBundle, supplied: unknown): Record<string, string> {
  const parsed = SafeInputSchema.safeParse(supplied ?? {});
  if (!parsed.success) fail('INPUT_INVALID', 'Input values must be named strings no longer than 16 KiB.');
  const allowed = new Set(bundle.chain.inputs.map((input) => input.name));
  if (Object.keys(parsed.data).some((name) => !allowed.has(name))) {
    fail('INPUT_INVALID', 'An input value was supplied for an undeclared chain input.');
  }
  const values: Record<string, string> = {};
  if (bundle.chain.inputs.length > 256) fail('INPUTS_TOO_MANY', 'Portable chains are limited to 256 inputs.');
  for (const input of bundle.chain.inputs) {
    const value = Object.hasOwn(parsed.data, input.name)
      ? parsed.data[input.name]
      : input.defaultValue;
    if (value === undefined) {
      if (input.required) fail('INPUT_REQUIRED', `Required input "${input.name}" needs a value.`);
      continue;
    }
    if (input.required && value.trim() === '') {
      fail('INPUT_REQUIRED', `Required input "${input.name}" cannot be empty.`);
    }
    values[input.name] = value;
  }
  return values;
}

export function resolveBundleInstruction(
  bundle: ChainBundle,
  stepIndex: number,
  inputs: Readonly<Record<string, string>>,
): string {
  const step = bundle.chain.steps[stepIndex];
  if (!step) fail('STEP_NOT_FOUND', 'No active chain step exists.');
  const resolved = step.instruction.replace(/\{\{([^{}]*)\}\}/g, (_raw, inner: string) => {
    const name = inner.trim();
    if (!Object.hasOwn(inputs, name)) fail('INPUT_UNRESOLVED', `Input "${name}" has no resolved value.`);
    return inputs[name]!;
  });
  return step.kind === 'instruction'
    ? `Instruction:\n${resolved}`
    : `Skill: ${step.skillName}\n\nInstruction:\n${resolved}`;
}

async function ensureDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (!isErrno(error, 'EEXIST')) throw error;
  }
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) {
    fail('PATH_UNSAFE', 'A required directory is not a real directory.');
  }
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

async function canonicalProject(projectPath: string): Promise<string> {
  if (!isAbsolute(projectPath)) fail('PROJECT_INVALID', 'The project path must be absolute.');
  const canonical = await realpath(projectPath);
  if (!(await stat(canonical)).isDirectory()) fail('PROJECT_INVALID', 'The project path is not a directory.');
  return canonical;
}

async function ensureSkillRoot(project: string): Promise<string> {
  const agents = join(project, '.agents');
  const skills = join(agents, 'skills');
  await ensureDirectory(agents);
  await ensureDirectory(skills);
  return skills;
}

async function treeFingerprint(directory: string): Promise<string> {
  const hash = createHash('sha256');
  async function visit(root: string, prefix: string): Promise<void> {
    const entries = await readdir(root, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = join(root, entry.name);
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const info = await lstat(path);
      if (info.isSymbolicLink()) fail('PACKAGE_UNSAFE', 'An installed skill contains a symbolic link.');
      if (info.isDirectory()) {
        hash.update(relativePath).update('\0d\0');
        await visit(path, relativePath);
      } else if (info.isFile()) {
        hash.update(relativePath).update('\0f\0').update((info.mode & 0o111) !== 0 ? '1' : '0').update('\0');
        hash.update(await readFile(path)).update('\0');
      } else {
        fail('PACKAGE_UNSAFE', 'An installed skill contains a special file.');
      }
    }
  }
  await visit(directory, '');
  return hash.digest('hex');
}

async function installSkills(
  bundle: ChainBundle,
  project: string,
  reuseSkills: string[],
  differingReuseConfirmed: boolean,
): Promise<{ installedSkills: PortableRun['installedSkills']; createdDirectories: string[] }> {
  const root = await ensureSkillRoot(project);
  const reuse = new Set(reuseSkills);
  if (reuse.size !== reuseSkills.length || [...reuse].some((name) =>
    !bundle.skills.some((skill) => skill.name === name))) {
    fail('REUSE_INVALID', 'Reuse choices must name distinct skills included in the bundle.');
  }
  const installed: PortableRun['installedSkills'] = [];
  const created: string[] = [];
  try {
    for (const skill of bundle.skills) {
      const destination = join(root, skill.directory);
      if (relative(root, destination).startsWith(`..${sep}`) || relative(root, destination) === '..') {
        fail('PATH_UNSAFE', 'A skill destination escapes the project skill directory.');
      }
      let exists = false;
      try {
        await lstat(destination);
        exists = true;
      } catch (error) {
        if (!isErrno(error, 'ENOENT')) throw error;
      }
      if (exists) {
        const info = await lstat(destination);
        if (!info.isDirectory() || info.isSymbolicLink() || !reuse.has(skill.name)) {
          fail('PACKAGE_CONFLICT', `Skill "${skill.name}" already exists. Review it and explicitly choose reuse or cancel.`);
        }
        const entry = join(destination, 'SKILL.md');
        const entryInfo = await lstat(entry);
        if (!entryInfo.isFile() || entryInfo.isSymbolicLink()) {
          fail('PACKAGE_CONFLICT', `Existing "${skill.name}" is not a valid skill package.`);
        }
        const metadata = parseSkillFrontmatter(await readFile(entry, 'utf8'));
        const name = frontmatterString(metadata.data, 'name') ?? skill.directory;
        if (name !== skill.name) fail('PACKAGE_CONFLICT', `Existing skill directory does not contain "${skill.name}".`);
        const existingFingerprint = await treeFingerprint(destination);
        if (existingFingerprint !== packageFingerprint(skill.files) && !differingReuseConfirmed) {
          fail('REUSE_CONTENT_CONFIRMATION_REQUIRED', `Existing "${skill.name}" differs from the bundle; explicitly confirm reuse of its installed contents.`);
        }
        installed.push({
          name: skill.name,
          directory: skill.directory,
          fingerprint: existingFingerprint,
          reused: true,
        });
        continue;
      }
      if (reuse.has(skill.name)) fail('REUSE_MISSING', `Skill "${skill.name}" selected for reuse is missing.`);
      await mkdir(destination, { mode: 0o755 });
      created.push(destination);
      for (const file of skill.files) {
        const target = join(destination, ...file.path.split('/'));
        const parent = dirname(target);
        const segments = relative(destination, parent).split(sep).filter(Boolean);
        let current = destination;
        for (const segment of segments) {
          current = join(current, segment);
          await ensureDirectory(current);
        }
        const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, file.executable ? 0o755 : 0o644);
        try {
          await handle.writeFile(decodeBundleFile(file.content));
          await handle.sync();
        } finally {
          await handle.close();
        }
        await chmod(target, file.executable ? 0o755 : 0o644);
      }
      installed.push({
        name: skill.name,
        directory: skill.directory,
        fingerprint: await treeFingerprint(destination),
        reused: false,
      });
    }
    return { installedSkills: installed, createdDirectories: created };
  } catch (error) {
    await Promise.all(created.map((path) => rm(path, { recursive: true, force: true })));
    if (error instanceof PortableRunError || error instanceof BundleError) throw error;
    throw new PortableRunError('INSTALL_FAILED', 'Skill installation failed; newly created package directories were rolled back.');
  }
}

async function ensureRunDirectory(project: string): Promise<string> {
  const loom = join(project, '.loom');
  const directory = join(loom, 'portable-runs');
  await ensureDirectory(loom);
  await ensureDirectory(directory);
  const ignore = join(loom, '.gitignore');
  try {
    const handle = await open(ignore, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
        await handle.writeFile('portable-runs/\n', 'utf8');
        await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (!isErrno(error, 'EEXIST')) throw error;
    const info = await lstat(ignore);
    if (!info.isFile() || info.isSymbolicLink()) fail('PATH_UNSAFE', 'The Loom ignore file is not a regular file.');
    const text = await readFile(ignore, 'utf8');
    if (!text.split(/\r?\n/).some((line) => line.trim() === 'portable-runs/')) {
      await atomicWrite(ignore, `${text}${text.endsWith('\n') || text === '' ? '' : '\n'}portable-runs/\n`);
    }
  }
  return directory;
}

async function atomicWrite(target: string, value: unknown, exclusive = false): Promise<void> {
  const temporary = join(dirname(target), `.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (exclusive) {
      await link(temporary, target);
      await unlink(temporary);
    } else {
      await rename(temporary, target);
    }
    const directory = await open(dirname(target), constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function withRunLock<T>(directory: string, task: () => Promise<T>): Promise<T> {
  const lockPath = join(directory, '.lock');
  let lock;
  try {
    lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  } catch (error) {
    if (isErrno(error, 'EEXIST')) fail('RUN_LOCKED', 'Another helper process is mutating portable run state; retry after it exits.');
    throw error;
  }
  try {
    await lock.writeFile(`${process.pid}\n`, 'utf8');
    await lock.sync();
    return await task();
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

async function readRun(path: string, project: string): Promise<PortableRun> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BUNDLE_REQUEST_BYTES) {
    fail('RUN_FILE_INVALID', 'The portable run record is unsafe or exceeds its size limit.');
  }
  const parsed = RunSchema.safeParse(JSON.parse(await readFile(path, 'utf8')) as unknown);
  if (!parsed.success || parsed.data.projectPath !== project) {
    fail('RUN_FILE_INVALID', 'The portable run record is corrupt, unsupported, or belongs to another project.');
  }
  const bundle = parseBundle(parsed.data.bundle);
  if (fingerprint(JSON.stringify(bundle)) !== parsed.data.bundleFingerprint ||
    bundle.chain.steps.length !== parsed.data.steps.length ||
    bundle.chain.steps.some((step, index) => parsed.data.steps[index]?.id !== step.id)) {
    fail('RUN_FILE_INVALID', 'The portable run snapshot does not match its stored fingerprint or step list.');
  }
  return parsed.data;
}

async function verifyInstalledSkills(run: PortableRun, project: string): Promise<void> {
  for (const skill of run.installedSkills) {
    const directory = join(project, '.agents', 'skills', skill.directory);
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || await treeFingerprint(directory) !== skill.fingerprint) {
      fail('PACKAGE_CHANGED', `Installed skill "${skill.name}" changed since this run was prepared; review it and prepare a new run.`);
    }
  }
}

function runPath(directory: string, id: string): string {
  if (!RUN_ID_PATTERN.test(id)) fail('RUN_ID_INVALID', 'The run id is not safe.');
  return join(directory, `${id}.json`);
}

async function readJsonInput(input: unknown): Promise<Record<string, unknown>> {
  if (input === undefined) return {};
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail('REQUEST_INVALID', 'The request must be a JSON object.');
  }
  return input as Record<string, unknown>;
}

async function writeRun(directory: string, run: PortableRun, exclusive = false): Promise<void> {
  const parsed = RunSchema.safeParse(run);
  if (!parsed.success) fail('RUN_STATE_INVALID', 'The portable run transition would produce invalid state.');
  if (Buffer.byteLength(JSON.stringify(parsed.data), 'utf8') > MAX_BUNDLE_REQUEST_BYTES) {
    fail('RUN_TOO_LARGE', 'The portable run record exceeds the 30 MiB safety limit.');
  }
  await atomicWrite(runPath(directory, run.id), parsed.data, exclusive);
}

export interface PortableRequest {
  command: 'inspect' | 'prepare' | 'status' | 'step' | 'record' | 'resume';
  bundlePath?: string;
  projectPath?: string;
  runId?: string;
  input?: unknown;
}

export async function executePortableRequest(request: PortableRequest): Promise<unknown> {
  if (request.command === 'inspect') {
    if (!request.bundlePath || !isAbsolute(request.bundlePath)) fail('BUNDLE_PATH_INVALID', 'Provide an absolute bundle file path.');
    const info = await lstat(request.bundlePath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BUNDLE_REQUEST_BYTES) {
      fail('BUNDLE_INVALID', 'The bundle is not a regular file or exceeds the size limit.');
    }
    const raw = JSON.parse(await readFile(request.bundlePath, 'utf8')) as unknown;
    const bundle = parseBundle(raw);
    if (bundle.chain.steps.length > MAX_PORTABLE_STEPS) {
      fail('CHAIN_TOO_LARGE', `Portable chains are limited to ${String(MAX_PORTABLE_STEPS)} steps.`);
    }
    const project = request.projectPath ? await canonicalProject(request.projectPath) : null;
    const skills = [];
    for (const skill of bundle.skills) {
      let existing: string | null = null;
      if (project !== null) {
        const candidate = join(project, '.agents', 'skills', skill.directory);
        try {
          const entry = await lstat(candidate);
          existing = entry.isDirectory() && !entry.isSymbolicLink() ? await treeFingerprint(candidate) : 'unsafe';
        } catch (error) {
          if (!isErrno(error, 'ENOENT')) throw error;
        }
      }
      skills.push({
        name: skill.name,
        directory: skill.directory,
        files: skill.files.map((file) => ({ path: file.path, bytes: decodeBundleFile(file.content).length, executable: file.executable })),
        skillMarkdown: Buffer.from(skill.files.find((file) => file.path === 'SKILL.md')!.content, 'base64').toString('utf8'),
        existingFingerprint: existing,
        bundledFingerprint: packageFingerprint(skill.files),
      });
    }
    return {
      ok: true,
      chain: bundle.chain,
      bundleFingerprint: fingerprint(JSON.stringify(bundle)),
      skills,
    };
  }

  if (!request.projectPath || !isAbsolute(request.projectPath)) fail('PROJECT_INVALID', 'Provide an absolute project path.');
  const project = await canonicalProject(request.projectPath);
  const input = await readJsonInput(request.input);

  if (request.command === 'prepare') {
    if (!request.bundlePath || !isAbsolute(request.bundlePath)) fail('BUNDLE_PATH_INVALID', 'Provide an absolute bundle file path.');
    if (input.installConfirmed !== true) fail('INSTALL_CONFIRMATION_REQUIRED', 'Review and explicitly confirm package installation first.');
    const info = await lstat(request.bundlePath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BUNDLE_REQUEST_BYTES) {
      fail('BUNDLE_INVALID', 'The bundle is not a regular file or exceeds the size limit.');
    }
    const raw = JSON.parse(await readFile(request.bundlePath, 'utf8')) as unknown;
    const bundle = parseBundle(raw);
    if (bundle.chain.steps.length > MAX_PORTABLE_STEPS) {
      fail('CHAIN_TOO_LARGE', `Portable chains are limited to ${String(MAX_PORTABLE_STEPS)} steps.`);
    }
    const chain = chainFromBundle(bundle);
    const inputs = resolvedInputs(bundle, input.inputs);
    for (let index = 0; index < bundle.chain.steps.length; index += 1) {
      if (Buffer.byteLength(resolveBundleInstruction(bundle, index, inputs), 'utf8') > MAX_STEP_INSTRUCTION_BYTES) {
        fail('INSTRUCTION_TOO_LARGE', 'Resolved step instructions are limited to 64 KiB.');
      }
    }
    const progression = input.progression === 'agent' ? 'agent' : input.progression === 'supervised' ? 'supervised' : null;
    if (progression === null) fail('PROGRESSION_INVALID', 'Choose supervised or agent progression.');
    if (progression === 'agent' && input.progressionConfirmed !== true) {
      fail('PROGRESSION_CONFIRMATION_REQUIRED', 'Agent-driven progression needs explicit consent.');
    }
    const actualHost = input.actualHost === 'copilot' || input.actualHost === 'opencode' || input.actualHost === 'other'
      ? input.actualHost : null;
    if (actualHost === null) fail('HOST_INVALID', 'Identify the current host as copilot, opencode, or other.');
    const hostSwitchConfirmed = input.hostSwitchConfirmed === true;
    if (bundle.chain.harness !== actualHost && !hostSwitchConfirmed) {
      fail('HOST_SWITCH_CONFIRMATION_REQUIRED', 'The current host differs from the bundle harness; explicitly confirm compatibility review.');
    }
    const session = input.sessionDecision;
    if (typeof session !== 'object' || session === null || Array.isArray(session)) {
      fail('SESSION_DECISION_REQUIRED', 'Describe the verified host session mechanism before preparation.');
    }
    const sessionDecision = session as PortableRun['sessionDecision'];
    const sessionParsed = RunSchema.shape.sessionDecision.safeParse(sessionDecision);
    if (!sessionParsed.success || sessionParsed.data.requested !== bundle.chain.sessionMode) {
      fail('SESSION_DECISION_INVALID', 'The session decision must match the bundle and name an actual host mechanism.');
    }
    const needsApproximationConsent =
      (bundle.chain.sessionMode === 'fresh' && sessionParsed.data.mechanism === 'current-conversation') ||
      (bundle.chain.sessionMode === 'fork' && sessionParsed.data.mechanism === 'handoff');
    if (needsApproximationConsent && sessionParsed.data.confirmed !== true) {
      fail('SESSION_CONFIRMATION_REQUIRED', 'A non-native session approximation requires explicit consent.');
    }
    if (bundle.chain.sessionMode === 'shared' && sessionParsed.data.mechanism !== 'current-conversation') {
      fail('SESSION_DECISION_INVALID', 'A shared chain must use the current host conversation.');
    }
    if (bundle.chain.sessionMode === 'fresh' &&
      !['isolated-worker', 'current-conversation'].includes(sessionParsed.data.mechanism)) {
      fail('SESSION_DECISION_INVALID', 'Fresh mode needs a verified isolated worker or an explicitly accepted shared approximation.');
    }
    if (bundle.chain.sessionMode === 'fork' &&
      !['native-fork', 'handoff'].includes(sessionParsed.data.mechanism)) {
      fail('SESSION_DECISION_INVALID', 'Fork mode needs a verified native fork or an explicitly accepted handoff.');
    }
    if (input.installConfirmed !== true) fail('INSTALL_CONFIRMATION_REQUIRED', 'Review and explicitly confirm package installation first.');
    const reuseSkills = input.reuseSkills === undefined ? [] : input.reuseSkills;
    if (!Array.isArray(reuseSkills) || reuseSkills.some((name) => typeof name !== 'string')) {
      fail('REUSE_INVALID', 'Reuse choices must be a list of skill names.');
    }
    const directory = await ensureRunDirectory(project);
    return withRunLock(directory, async () => {
      const { installedSkills, createdDirectories } = await installSkills(
        bundle,
        project,
        reuseSkills as string[],
        input.differingReuseConfirmed === true,
      );
      const timestamp = now();
      const id = randomUUID();
      const run: PortableRun = {
        version: RUN_VERSION,
        id,
        revision: 1,
        projectPath: project,
        bundleFingerprint: fingerprint(JSON.stringify(bundle)),
        bundle,
        actualHost,
        hostSwitchConfirmed,
        progression,
        progressionConfirmed: input.progressionConfirmed === true,
        sessionDecision: sessionParsed.data,
        resolvedInputs: inputs,
        installedSkills,
        status: 'ready',
        currentStepIndex: 0,
        resumeRequired: false,
        steps: chain.steps.map((step, index) => ({ id: step.id, index, attempts: [] })),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      try {
        await writeRun(directory, run, true);
      } catch (error) {
        await Promise.all(createdDirectories.map((path) => rm(path, { recursive: true, force: true })));
        throw error;
      }
      return { ok: true, runId: id, revision: run.revision, status: run.status, installedSkills };
    });
  }

  const directory = await ensureRunDirectory(project);
  if (!request.runId) fail('RUN_ID_INVALID', 'Provide a run id.');
  const path = runPath(directory, request.runId);
  const run = await readRun(path, project);
  if (request.command === 'status') {
    return {
      ok: true,
      run: {
        id: run.id,
        revision: run.revision,
        chainName: (run.bundle as ChainBundle).chain.name,
        bundleFingerprint: run.bundleFingerprint,
        actualHost: run.actualHost,
        progression: run.progression,
        sessionDecision: run.sessionDecision,
        hostSwitchConfirmed: run.hostSwitchConfirmed,
        installedSkills: run.installedSkills,
        status: run.status,
        currentStepIndex: run.currentStepIndex,
        resumeRequired: run.resumeRequired,
        steps: run.steps,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      },
    };
  }

  if (request.command === 'step') {
    return withRunLock(directory, async () => {
      const current = await readRun(path, project);
      if (input.revision !== current.revision) fail('REVISION_CONFLICT', 'Portable run state changed; refresh status before acting.');
      if (current.status !== 'ready' || current.resumeRequired) fail('RUN_NOT_READY', 'The run is not ready to start another step.');
      await verifyInstalledSkills(current, project);
      if (current.progression === 'supervised' && input.confirmed !== true) {
        fail('STEP_CONFIRMATION_REQUIRED', 'Confirm this step before execution.');
      }
      const step = current.bundle.chain.steps[current.currentStepIndex];
      const record = current.steps[current.currentStepIndex];
      if (!step || !record) fail('RUN_STATE_INVALID', 'The current step is missing.');
      if (record.attempts.length >= MAX_ATTEMPTS_PER_STEP) {
        fail('ATTEMPTS_EXHAUSTED', `A step can have at most ${String(MAX_ATTEMPTS_PER_STEP)} attempts.`);
      }
      if (record.attempts.at(-1)?.status === 'running') fail('STEP_ALREADY_RUNNING', 'The current step already has an unresolved attempt.');
      const attempt = {
        number: record.attempts.length + 1,
        status: 'running' as const,
        startedAt: now(),
        finishedAt: null,
        summary: null,
        reason: null,
      };
      record.attempts.push(attempt);
      current.status = 'running';
      current.revision += 1;
      current.updatedAt = now();
      await writeRun(directory, current);
      const prompt = resolveBundleInstruction(current.bundle, current.currentStepIndex, current.resolvedInputs);
      let handoffNote: string | null = null;
      if (current.bundle.chain.sessionMode === 'fork' &&
        current.sessionDecision.mechanism === 'handoff' &&
        current.currentStepIndex > 0) {
        const previousStep = current.bundle.chain.steps[current.currentStepIndex - 1]!;
        const previousAttempt = current.steps[current.currentStepIndex - 1]?.attempts.at(-1);
        const previousInstruction = resolveBundleInstruction(current.bundle, current.currentStepIndex - 1, current.resolvedInputs);
        handoffNote = [
          'Portable handoff (not a native session fork):',
          `Previous step: ${String(current.currentStepIndex)} "${chainStepName(previousStep)}"`,
          `Previous instruction: ${previousInstruction.slice(0, 2_000)}`,
          `Recorded status: ${previousAttempt?.status ?? 'unknown'}`,
          `Recorded summary: ${(previousAttempt?.summary ?? 'No summary recorded.').slice(0, 4_000)}`,
        ].join('\n');
      }
      const installed = current.installedSkills.find((skill) => skill.name === ('skillName' in step ? step.skillName : ''));
      return {
        ok: true,
        runId: current.id,
        revision: current.revision,
        attempt: attempt.number,
        step: {
          index: current.currentStepIndex,
          count: current.steps.length,
          id: step.id,
          label: chainStepName(step),
          kind: step.kind === 'instruction' ? 'instruction' : 'skill',
          skillName: 'skillName' in step ? step.skillName : null,
          skillPath: installed ? join(project, '.agents', 'skills', installed.directory) : null,
          instruction: prompt,
          handoffNote,
        },
        progression: current.progression,
        sessionDecision: current.sessionDecision,
      };
    });
  }

  if (request.command === 'record') {
    return withRunLock(directory, async () => {
      const current = await readRun(path, project);
      if (input.revision !== current.revision) fail('REVISION_CONFLICT', 'Portable run state changed; refresh status before acting.');
      if (input.action === 'pause' || input.action === 'abort') {
        if (current.status !== 'ready' && current.status !== 'paused') {
          fail('RUN_ACTION_INVALID', 'Pause or abort is only available between steps.');
        }
        current.status = input.action === 'pause' ? 'paused' : 'aborted';
        current.revision += 1;
        current.updatedAt = now();
        await writeRun(directory, current);
        return { ok: true, runId: current.id, revision: current.revision, status: current.status };
      }
      if (input.action === 'retry') {
        const latest = current.steps[current.currentStepIndex]?.attempts.at(-1);
        if (current.status !== 'paused' || latest?.status !== 'failed') {
          fail('RETRY_NOT_AVAILABLE', 'Retry is available only for the current failed step.');
        }
        current.status = 'ready';
        current.revision += 1;
        current.updatedAt = now();
        await writeRun(directory, current);
        return { ok: true, runId: current.id, revision: current.revision, status: current.status };
      }
      if (input.action === 'skip') {
        const stepRecord = current.steps[current.currentStepIndex];
        if (current.status !== 'ready' || !stepRecord || typeof input.reason !== 'string' || input.reason.trim() === '') {
          fail('SKIP_REASON_REQUIRED', 'Skipping a pending step requires a reason.');
        }
        if (current.progression === 'supervised' && input.confirmed !== true) {
          fail('STEP_CONFIRMATION_REQUIRED', 'Confirm skipping this step.');
        }
        stepRecord.attempts.push({
          number: stepRecord.attempts.length + 1,
          status: 'skipped',
          startedAt: now(),
          finishedAt: now(),
          summary: null,
          reason: input.reason.slice(0, 2_000),
        });
        current.currentStepIndex += 1;
        current.status = current.currentStepIndex >= current.steps.length ? 'completed' : 'ready';
        current.revision += 1;
        current.updatedAt = now();
        await writeRun(directory, current);
        return { ok: true, runId: current.id, revision: current.revision, status: current.status };
      }
      const record = current.steps[current.currentStepIndex];
      const attempt = record?.attempts.at(-1);
      if (!record || !attempt || attempt.status !== 'running' || current.status !== 'running') {
        fail('STEP_NOT_RUNNING', 'There is no active step attempt to record.');
      }
      const outcome = input.outcome;
      if (outcome !== 'done' && outcome !== 'failed' && outcome !== 'skipped') {
        fail('OUTCOME_INVALID', 'Record done, failed, or skipped.');
      }
      if (outcome === 'skipped' && (typeof input.reason !== 'string' || input.reason.trim() === '')) {
        fail('SKIP_REASON_REQUIRED', 'Skipping a step requires a reason.');
      }
      if (outcome === 'done' && current.progression === 'supervised' && input.confirmed !== true) {
        fail('COMPLETION_CONFIRMATION_REQUIRED', 'Confirm the step outcome before marking it done.');
      }
      const summary = typeof input.summary === 'string' ? input.summary : '';
      if (Buffer.byteLength(summary, 'utf8') > MAX_SUMMARY_BYTES) {
        fail('SUMMARY_TOO_LARGE', 'Step summaries are limited to 8 KiB; do not store a transcript.');
      }
      attempt.status = outcome;
      attempt.finishedAt = now();
      attempt.summary = summary || null;
      attempt.reason = outcome === 'skipped' ? (input.reason as string).slice(0, 2_000) : null;
      if (outcome === 'failed') {
        current.status = 'paused';
      } else {
        current.currentStepIndex += 1;
        current.status = current.currentStepIndex >= current.steps.length ? 'completed' : 'ready';
      }
      current.revision += 1;
      current.updatedAt = now();
      await writeRun(directory, current);
      return { ok: true, runId: current.id, revision: current.revision, status: current.status, currentStepIndex: current.currentStepIndex };
    });
  }

  if (request.command === 'resume') {
    return withRunLock(directory, async () => {
      const current = await readRun(path, project);
      if (input.revision !== current.revision) fail('REVISION_CONFLICT', 'Portable run state changed; refresh status before acting.');
      if (current.status === 'paused' && !current.resumeRequired && input.decision === 'continue') {
        current.status = 'ready';
        current.revision += 1;
        current.updatedAt = now();
        await writeRun(directory, current);
        return { ok: true, runId: current.id, revision: current.revision, status: current.status };
      }
      if (current.status === 'running') {
        const attempt = current.steps[current.currentStepIndex]?.attempts.at(-1);
        if (attempt?.status !== 'running') fail('RUN_STATE_INVALID', 'The active run has no in-flight attempt.');
        attempt.status = 'interrupted';
        attempt.finishedAt = now();
        current.status = 'interrupted';
        current.resumeRequired = true;
        current.revision += 1;
        current.updatedAt = now();
        await writeRun(directory, current);
        return { ok: true, runId: current.id, revision: current.revision, status: current.status, decisionRequired: true };
      }
      if (!current.resumeRequired || current.status !== 'interrupted') {
        fail('RESUME_NOT_REQUIRED', 'This run has no interrupted attempt requiring recovery.');
      }
      const decision = input.decision;
      const attempt = current.steps[current.currentStepIndex]?.attempts.at(-1);
      if (!attempt || attempt.status !== 'interrupted') fail('RUN_STATE_INVALID', 'Interrupted attempt record is missing.');
      if (decision === 'retry') {
        attempt.reason = 'User chose to retry an interrupted attempt; earlier side effects may remain.';
      } else if (decision === 'done') {
        if (current.progression === 'supervised' && input.confirmed !== true) {
          fail('COMPLETION_CONFIRMATION_REQUIRED', 'Confirm the interrupted step outcome before marking it done.');
        }
        const summary = typeof input.summary === 'string' ? input.summary : '';
        if (Buffer.byteLength(summary, 'utf8') > MAX_SUMMARY_BYTES) fail('SUMMARY_TOO_LARGE', 'Step summaries are limited to 8 KiB.');
        attempt.status = 'done';
        attempt.summary = summary || null;
        current.currentStepIndex += 1;
      } else if (decision === 'failed') {
        attempt.status = 'failed';
      } else {
        fail('RESUME_DECISION_REQUIRED', 'Choose retry, done, or failed for the interrupted attempt.');
      }
      current.resumeRequired = false;
      current.status = decision === 'failed'
        ? 'paused'
        : current.currentStepIndex >= current.steps.length ? 'completed' : 'ready';
      current.revision += 1;
      current.updatedAt = now();
      await writeRun(directory, current);
      return { ok: true, runId: current.id, revision: current.revision, status: current.status };
    });
  }

  fail('COMMAND_INVALID', 'Unknown portable run command.');
}
