import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import {
  CONFIG_FILE_NAME,
  CONFIG_VERSION,
  ConfigUpdateSchema,
  LoomConfigSchema,
  createDefaultConfig,
  type ConfigUpdate,
  type HarnessCommands,
  type LoomConfig,
} from './schema.js';

export type ConfigErrorCode =
  | 'CONFIG_CORRUPT'
  | 'CONFIG_UNSUPPORTED_VERSION'
  | 'CONFIG_READ_FAILED'
  | 'CONFIG_WRITE_FAILED'
  | 'CONFIG_INVALID';

export type ConfigErrorDetails = Record<string, unknown>;

/**
 * Typed configuration failure. Details never include file contents or
 * credential values: only the path, a sanitized version, field paths, and
 * errno-style reason codes.
 */
export class ConfigError extends Error {
  readonly code: ConfigErrorCode;
  readonly details: ConfigErrorDetails;

  constructor(
    code: ConfigErrorCode,
    message: string,
    details: ConfigErrorDetails = {},
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

export class ConfigCorruptError extends ConfigError {
  constructor(configPath: string, issues: Array<{ path: string; code: string }> = []) {
    super('CONFIG_CORRUPT', 'The Skill Loom configuration file is not valid JSON configuration.', {
      path: configPath,
      issues,
    });
  }
}

export class ConfigUnsupportedVersionError extends ConfigError {
  constructor(configPath: string, version: unknown) {
    super('CONFIG_UNSUPPORTED_VERSION', 'The Skill Loom configuration file uses an unsupported version.', {
      path: configPath,
      version: describeVersion(version),
    });
  }
}

export class ConfigReadError extends ConfigError {
  constructor(configPath: string, cause: unknown) {
    super('CONFIG_READ_FAILED', 'The Skill Loom configuration file could not be read.', {
      path: configPath,
      reason: errnoCode(cause),
    }, cause);
  }
}

export class ConfigWriteError extends ConfigError {
  constructor(configPath: string, cause: unknown) {
    super('CONFIG_WRITE_FAILED', 'The Skill Loom configuration file could not be written.', {
      path: configPath,
      reason: errnoCode(cause),
    }, cause);
  }
}

export class ConfigValidationError extends ConfigError {
  constructor(issues: Array<{ path: string; code: string }>) {
    super('CONFIG_INVALID', 'The configuration update is not valid.', { issues });
  }
}

export interface ConfigPathOptions {
  /** Environment source. Defaults to `process.env` and is read on every operation. */
  env?: NodeJS.ProcessEnv;
  /** Home directory seam for tests. Defaults to `os.homedir()`. */
  homeDirectory?: () => string;
}

export interface ConfigStoreOptions extends ConfigPathOptions {
  /** Atomic write seam for failure simulation. Defaults to `atomicWriteJson`. */
  atomicWrite?: (target: string, value: unknown) => Promise<void>;
}

export interface ConfigStore {
  getConfigDir(): string;
  getConfigPath(): string;
  /** Read the configuration, creating the documented defaults on first read. */
  get(): Promise<LoomConfig>;
  /** Read-modify-write a partial update atomically, preserving unrelated fields. */
  update(update: ConfigUpdate | ((current: LoomConfig) => ConfigUpdate)): Promise<LoomConfig>;
  /** Validate and persist a complete configuration document atomically. */
  write(config: LoomConfig): Promise<LoomConfig>;
}

/**
 * `$LOOM_CONFIG_DIR` wins over the XDG-style default. The environment is read
 * per call so every store operation honors a changed override.
 */
export function resolveConfigDir(options: ConfigPathOptions = {}): string {
  const env = options.env ?? process.env;
  const override = env.LOOM_CONFIG_DIR;
  if (typeof override === 'string' && override.trim() !== '') {
    return resolve(override.trim());
  }
  const home = options.homeDirectory ?? homedir;
  return join(home(), '.config', 'loom');
}

export function resolveConfigPath(options: ConfigPathOptions = {}): string {
  return join(resolveConfigDir(options), CONFIG_FILE_NAME);
}

/**
 * Parse a decoded JSON document into the versioned config schema.
 *
 * A missing or non-object document is corrupt. A present but unsupported
 * `version` is a distinct typed error so callers can tell the user to upgrade
 * instead of treating the file as damaged.
 */
export function parseConfigDocument(raw: unknown, configPath: string): LoomConfig {
  if (!isPlainRecord(raw)) {
    throw new ConfigCorruptError(configPath, [{ path: '', code: 'invalid_type' }]);
  }

  if (!Object.hasOwn(raw, 'version')) {
    throw new ConfigCorruptError(configPath, [{ path: 'version', code: 'invalid_type' }]);
  }

  if (raw.version !== CONFIG_VERSION) {
    throw new ConfigUnsupportedVersionError(configPath, raw.version);
  }

  const result = LoomConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigCorruptError(configPath, normalizeIssues(result.error.issues));
  }

  return result.data;
}

export interface AtomicWriteDependencies {
  openFile?: typeof open;
  renameFile?: typeof rename;
  unlinkFile?: typeof unlink;
  makeTempId?: () => string;
  processId?: number;
}

/**
 * Write JSON through a temporary file in the target directory, fsync it, then
 * rename over the target. A failure removes the temporary file and leaves the
 * previous target untouched. `EXDEV` is surfaced as a typed error instead of
 * falling back to a non-atomic copy.
 */
export async function atomicWriteJson(
  target: string,
  value: unknown,
  dependencies: AtomicWriteDependencies = {},
): Promise<void> {
  const openFile = dependencies.openFile ?? open;
  const renameFile = dependencies.renameFile ?? rename;
  const unlinkFile = dependencies.unlinkFile ?? unlink;
  const makeTempId = dependencies.makeTempId ?? randomUUID;
  const processId = dependencies.processId ?? process.pid;

  const directory = dirname(target);
  const temporary = join(directory, `.${basename(target)}.${processId}.${makeTempId()}.tmp`);
  const body = `${JSON.stringify(value, null, 2)}\n`;

  let handle: FileHandle | undefined;
  try {
    handle = await openFile(temporary, 'w', 0o600);
    await handle.writeFile(body, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await renameFile(temporary, target);
    await syncDirectory(directory);
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
    await unlinkFile(temporary).catch(() => undefined);

    if (error instanceof ConfigError) {
      throw error;
    }
    if (errnoCode(error) === 'EXDEV') {
      throw new ConfigError(
        'CONFIG_WRITE_FAILED',
        'Atomic configuration write failed because the temporary file is on another device.',
        { path: target, reason: 'EXDEV' },
        error,
      );
    }
    throw error;
  }
}

const writeQueues = new Map<string, Promise<void>>();

/**
 * Serialize read-modify-write cycles for the same target in this process.
 * Two concurrent updates must not lose one another's changes.
 */
function enqueueWrite<T>(target: string, task: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(target) ?? Promise.resolve();
  const current = previous.then(task, task);
  const settled = current.then(
    () => undefined,
    () => undefined,
  );
  writeQueues.set(target, settled);
  settled.then(() => {
    if (writeQueues.get(target) === settled) {
      writeQueues.delete(target);
    }
  }, () => undefined);
  return current;
}

class FileConfigStore implements ConfigStore {
  private readonly options: ConfigStoreOptions;

  constructor(options: ConfigStoreOptions = {}) {
    this.options = options;
  }

  getConfigDir(): string {
    return resolveConfigDir(this.options);
  }

  getConfigPath(): string {
    return resolveConfigPath(this.options);
  }

  async get(): Promise<LoomConfig> {
    const target = this.getConfigPath();
    return enqueueWrite(target, async () => {
      const existing = await readExistingConfig(target);
      if (existing) {
        return existing;
      }

      const defaults = createDefaultConfig();
      await this.persist(target, defaults);
      return defaults;
    });
  }

  async update(update: ConfigUpdate | ((current: LoomConfig) => ConfigUpdate)): Promise<LoomConfig> {
    const target = this.getConfigPath();
    return enqueueWrite(target, async () => {
      const current = (await readExistingConfig(target)) ?? createDefaultConfig();
      const candidate = typeof update === 'function' ? update(structuredClone(current)) : update;

      const parsedUpdate = ConfigUpdateSchema.safeParse(candidate);
      if (!parsedUpdate.success) {
        throw new ConfigValidationError(normalizeIssues(parsedUpdate.error.issues));
      }

      const next = applyUpdate(current, parsedUpdate.data);
      const parsedConfig = LoomConfigSchema.safeParse(next);
      if (!parsedConfig.success) {
        throw new ConfigValidationError(normalizeIssues(parsedConfig.error.issues));
      }

      await this.persist(target, parsedConfig.data);
      return parsedConfig.data;
    });
  }

  async write(config: LoomConfig): Promise<LoomConfig> {
    const target = this.getConfigPath();
    return enqueueWrite(target, async () => {
      const parsed = LoomConfigSchema.safeParse(config);
      if (!parsed.success) {
        throw new ConfigValidationError(normalizeIssues(parsed.error.issues));
      }

      await this.persist(target, parsed.data);
      return parsed.data;
    });
  }

  private async persist(target: string, config: LoomConfig): Promise<void> {
    const writer = this.options.atomicWrite ?? atomicWriteJson;
    try {
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writer(target, config);
    } catch (error) {
      if (error instanceof ConfigError) {
        throw error;
      }
      throw new ConfigWriteError(target, error);
    }
  }
}

export function createConfigStore(options: ConfigStoreOptions = {}): ConfigStore {
  return new FileConfigStore(options);
}

let defaultStore: ConfigStore | undefined;

/** Process-wide store used by feature services. Paths are resolved per call. */
export function getConfigStore(): ConfigStore {
  defaultStore ??= createConfigStore();
  return defaultStore;
}

export function readConfig(): Promise<LoomConfig> {
  return getConfigStore().get();
}

export function updateConfig(
  update: ConfigUpdate | ((current: LoomConfig) => ConfigUpdate),
): Promise<LoomConfig> {
  return getConfigStore().update(update);
}

export function writeConfig(config: LoomConfig): Promise<LoomConfig> {
  return getConfigStore().write(config);
}

/** Aliases kept for feature code that prefers load/save terminology. */
export const loadConfig = readConfig;
export const saveConfig = writeConfig;

async function readExistingConfig(target: string): Promise<LoomConfig | undefined> {
  let text: string;
  try {
    text = await readFile(target, 'utf8');
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') {
      return undefined;
    }
    throw new ConfigReadError(target, error);
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    throw new ConfigCorruptError(target, [{ path: '', code: 'invalid_json' }]);
  }

  return parseConfigDocument(decoded, target);
}

function applyUpdate(current: LoomConfig, patch: ConfigUpdate): LoomConfig {
  const harnessCommands: HarnessCommands = { ...current.harnessCommands };
  if (patch.harnessCommands?.opencode !== undefined) {
    harnessCommands.opencode = patch.harnessCommands.opencode;
  }
  if (patch.harnessCommands?.copilot !== undefined) {
    harnessCommands.copilot = patch.harnessCommands.copilot;
  }

  return {
    version: CONFIG_VERSION,
    harnessCommands,
    extraSkillDirectories: patch.extraSkillDirectories ?? current.extraSkillDirectories,
    remoteSkillSources: patch.remoteSkillSources ?? current.remoteSkillSources,
    ...(patch.sharedBundleDirectory === null
      ? {}
      : {
          sharedBundleDirectory:
            patch.sharedBundleDirectory ?? current.sharedBundleDirectory,
        }),
    recentProjects: patch.recentProjects ?? current.recentProjects,
    testWorkspaces: patch.testWorkspaces ?? current.testWorkspaces,
    discoveryWorkspaces: patch.discoveryWorkspaces ?? current.discoveryWorkspaces,
    uiPreferences:
      patch.uiPreferences === undefined
        ? current.uiPreferences
        : { ...current.uiPreferences, ...patch.uiPreferences },
  };
}

async function syncDirectory(directory: string): Promise<void> {
  // Directory fsync is unsupported on some platforms; ignore the documented
  // benign errno values instead of failing an already-completed rename.
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } catch (error) {
    const code = errnoCode(error);
    if (code !== 'EINVAL' && code !== 'EISDIR' && code !== 'EPERM' && code !== 'ENOTSUP') {
      throw error;
    }
  } finally {
    await handle.close();
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeIssues(issues: ReadonlyArray<{ path: PropertyKey[]; code: string }>): Array<{
  path: string;
  code: string;
}> {
  return issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join('.'),
    code: issue.code,
  }));
}

function describeVersion(version: unknown): unknown {
  if (version === null || ['string', 'number', 'boolean'].includes(typeof version)) {
    return version;
  }
  return Array.isArray(version) ? 'array' : typeof version;
}

function errnoCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') {
      return code;
    }
  }
  return 'UNKNOWN';
}
