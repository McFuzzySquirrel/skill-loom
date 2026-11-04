import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';
import type { HarnessTrustDescriptor } from '../harness/types.js';

/**
 * Folder-trust inspection.
 *
 * The harness adapter owns the trust descriptor (whether trust is required, the
 * config path, and the trusted-folders key). This module only reads that file
 * and compares the canonical project path. It never writes the config, never
 * launches a trust session, and never includes other config values in a
 * report.
 *
 * A folder that is simply not listed is `untrusted` and hard-blocks a run.
 * A config that cannot be read or parsed is `unknown`; automation cannot
 * verify trust, so the engine requires an explicit acknowledgement instead of
 * assuming either outcome.
 */

export const TRUST_BEHAVIORS = ['none', 'folder-dialog'] as const;
export type TrustBehavior = (typeof TRUST_BEHAVIORS)[number];

export const TRUST_STATES = ['not-required', 'trusted', 'untrusted', 'unknown'] as const;
export type TrustState = (typeof TRUST_STATES)[number];

export const TRUST_REASONS = {
  NOT_REQUIRED: 'NOT_REQUIRED',
  FOLDER_TRUSTED: 'FOLDER_TRUSTED',
  FOLDER_NOT_TRUSTED: 'FOLDER_NOT_TRUSTED',
  NO_CONFIG: 'NO_CONFIG',
  CONFIG_UNREADABLE: 'CONFIG_UNREADABLE',
  CONFIG_INVALID: 'CONFIG_INVALID',
  TRUSTED_FOLDERS_MISSING: 'TRUSTED_FOLDERS_MISSING',
  TRUSTED_FOLDERS_INVALID: 'TRUSTED_FOLDERS_INVALID',
  CONFIG_PATH_INVALID: 'CONFIG_PATH_INVALID',
} as const;
export type TrustReason = (typeof TRUST_REASONS)[keyof typeof TRUST_REASONS];

export interface TrustEvidenceItem {
  readonly kind: 'config';
  readonly path: string;
  readonly present: boolean;
  readonly parsed: boolean;
}

export interface TrustCheckResult {
  readonly behavior: TrustBehavior;
  readonly state: TrustState;
  readonly trusted: boolean;
  readonly configPath: string | null;
  readonly projectPath: string;
  readonly reason: TrustReason;
  readonly evidence: TrustEvidenceItem[];
}

export interface ReadTrustedFoldersInput {
  readonly configPath: string;
  readonly trustedFoldersKey: string;
  readonly homeDirectory?: string;
  readonly readFileText?: (path: string) => Promise<string>;
}

export type TrustedFoldersReadResult =
  | {
      readonly ok: true;
      readonly folders: string[];
    }
  | {
      readonly ok: false;
      readonly present: boolean;
      readonly reason: TrustReason;
    };

export interface FolderTrustOptions {
  readonly descriptor: Pick<
    HarnessTrustDescriptor,
    'behavior' | 'configPath' | 'trustedFoldersKey'
  >;
  /** Canonical absolute project directory. */
  readonly projectPath: string;
  readonly homeDirectory?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly readFileText?: (path: string) => Promise<string>;
}

/**
 * Check whether the project folder is trusted by the harness.
 *
 * `descriptor.behavior === 'none'` short-circuits to `not-required`. For a
 * folder-dialog harness, only an explicit trusted-folder match is `trusted`.
 */
export async function checkFolderTrust(
  options: FolderTrustOptions,
): Promise<TrustCheckResult> {
  const base = {
    behavior: options.descriptor.behavior,
    projectPath: normalizeFolderPath(options.projectPath, options.homeDirectory),
  } as const;

  if (options.descriptor.behavior === 'none') {
    return {
      ...base,
      state: 'not-required',
      trusted: true,
      configPath: null,
      reason: TRUST_REASONS.NOT_REQUIRED,
      evidence: [],
    };
  }

  const configPath = resolveTrustConfigPath(
    options.descriptor.configPath,
    options.homeDirectory,
    options.env,
  );

  if (configPath === null) {
    return {
      ...base,
      state: 'unknown',
      trusted: false,
      configPath: null,
      reason: TRUST_REASONS.CONFIG_PATH_INVALID,
      evidence: [],
    };
  }

  const key = options.descriptor.trustedFoldersKey;
  if (key === null || key.trim() === '') {
    return {
      ...base,
      state: 'unknown',
      trusted: false,
      configPath,
      reason: TRUST_REASONS.TRUSTED_FOLDERS_MISSING,
      evidence: [{ kind: 'config', path: configPath, present: false, parsed: false }],
    };
  }

  const read = await readTrustedFolders({
    configPath,
    trustedFoldersKey: key,
    ...(options.homeDirectory === undefined
      ? {}
      : { homeDirectory: options.homeDirectory }),
    ...(options.readFileText === undefined ? {} : { readFileText: options.readFileText }),
  });

  if (!read.ok) {
    return {
      ...base,
      state: read.reason === TRUST_REASONS.NO_CONFIG ? 'untrusted' : 'unknown',
      trusted: false,
      configPath,
      reason: read.reason,
      evidence: [
        {
          kind: 'config',
          path: configPath,
          present: read.present,
          parsed: false,
        },
      ],
    };
  }

  const project = base.projectPath;
  const trusted = read.folders.some(
    (folder) => normalizeFolderPath(folder, options.homeDirectory) === project,
  );

  return {
    ...base,
    state: trusted ? 'trusted' : 'untrusted',
    trusted,
    configPath,
    reason: trusted ? TRUST_REASONS.FOLDER_TRUSTED : TRUST_REASONS.FOLDER_NOT_TRUSTED,
    evidence: [
      {
        kind: 'config',
        path: configPath,
        present: true,
        parsed: true,
      },
    ],
  };
}

/**
 * Read and parse the trusted-folder list. The file may be JSON with `//` or
 * `/* *\/` comments, as the installed Copilot CLI writes. Only the configured
 * trusted-folders key is extracted; every other property is ignored.
 */
export async function readTrustedFolders(
  input: ReadTrustedFoldersInput,
): Promise<TrustedFoldersReadResult> {
  const reader = input.readFileText ?? ((path: string) => readFile(path, 'utf8'));

  let text: string;
  try {
    text = await reader(input.configPath);
  } catch (error) {
    return {
      ok: false,
      present: errnoCode(error) !== 'ENOENT',
      reason:
        errnoCode(error) === 'ENOENT'
          ? TRUST_REASONS.NO_CONFIG
          : TRUST_REASONS.CONFIG_UNREADABLE,
    };
  }

  let document: unknown;
  try {
    document = JSON.parse(stripJsonComments(text));
  } catch {
    return { ok: false, present: true, reason: TRUST_REASONS.CONFIG_INVALID };
  }

  if (!isRecord(document)) {
    return { ok: false, present: true, reason: TRUST_REASONS.CONFIG_INVALID };
  }

  if (!Object.hasOwn(document, input.trustedFoldersKey)) {
    return {
      ok: false,
      present: true,
      reason: TRUST_REASONS.TRUSTED_FOLDERS_MISSING,
    };
  }

  const folders = normalizeTrustedFolders(document[input.trustedFoldersKey]);
  if (folders === undefined) {
    return {
      ok: false,
      present: true,
      reason: TRUST_REASONS.TRUSTED_FOLDERS_INVALID,
    };
  }

  return { ok: true, folders };
}

/** Expand `~` and `COPILOT_HOME`-style homes for a descriptor config path. */
export function resolveTrustConfigPath(
  configPath: string | null,
  homeDirectory: string | undefined,
  env: NodeJS.ProcessEnv | undefined,
): string | null {
  if (configPath === null || configPath.trim() === '') {
    return null;
  }

  const raw = configPath.trim();
  if (raw.includes('\0')) {
    return null;
  }

  const home = homeDirectory ?? homedir();
  const copilotHome = env?.COPILOT_HOME?.trim();

  // The CLI honors COPILOT_HOME for its own settings. Apply the same override
  // to a descriptor path under the default `~/.copilot` directory so a probe or
  // test can isolate the CLI and preflight against the same home.
  if (copilotHome !== undefined && copilotHome !== '') {
    const underDefaultHome =
      raw === '~/.copilot' ||
      raw.startsWith('~/.copilot/') ||
      resolve(raw) === resolve(home, '.copilot') ||
      resolve(raw).startsWith(`${resolve(home, '.copilot')}${sep}`);
    if (underDefaultHome) {
      const relative = raw
        .replace(/^~\/\.copilot\/?/, '')
        .replace(`${resolve(home, '.copilot')}${sep}`, '');
      return resolve(copilotHome, relative);
    }
  }

  if (raw === '~') {
    return home;
  }
  if (raw.startsWith('~/')) {
    return join(home, raw.slice(2));
  }
  if (isAbsolute(raw)) {
    return normalize(raw);
  }
  return resolve(home, raw);
}

function normalizeTrustedFolders(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    if (!value.every((entry) => typeof entry === 'string')) {
      return undefined;
    }
    return value.map((entry) => entry.trim()).filter((entry) => entry !== '');
  }

  if (isRecord(value)) {
    return Object.entries(value)
      .filter(([, enabled]) => enabled === true || enabled === 'true' || enabled === 1)
      .map(([folder]) => folder.trim())
      .filter((folder) => folder !== '');
  }

  return undefined;
}

function normalizeFolderPath(value: string, homeDirectory: string | undefined): string {
  let expanded = value.trim();
  const home = homeDirectory ?? homedir();

  if (expanded === '~') {
    expanded = home;
  } else if (expanded.startsWith('~/')) {
    expanded = join(home, expanded.slice(2));
  } else if (!isAbsolute(expanded)) {
    // Trusted-folder entries are expected to be absolute. Resolve a relative
    // entry against the isolated home rather than the server process cwd.
    expanded = join(home, expanded);
  }

  const normalized = normalize(resolve(expanded));
  if (normalized.length > 1 && normalized.endsWith(sep)) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * Strip JavaScript-style comments and trailing commas before `JSON.parse`.
 * The small state machine keeps `//` inside string values intact.
 */
export function stripJsonComments(input: string): string {
  let output = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index] ?? '';
    const next = input[index + 1] ?? '';

    if (inString) {
      output += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }

    if (character === '/' && next === '/') {
      while (index < input.length && input[index] !== '\n') {
        index += 1;
      }
      output += '\n';
      continue;
    }

    if (character === '/' && next === '*') {
      index += 2;
      while (index < input.length && !(input[index] === '*' && input[index + 1] === '/')) {
        index += 1;
      }
      index += 1;
      continue;
    }

    output += character;
  }

  // Remove trailing commas only when the next significant character is a
  // closing brace/bracket. This is safe for the config files the CLI writes.
  return output.replace(/,(\s*[}\]])/g, '$1');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errnoCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }
  return 'READ_FAILED';
}
