import { randomUUID } from 'node:crypto';
import type { HarnessId } from '../config/schema.js';
import type { HarnessAdapter, HarnessTrustCommand } from '../harness/types.js';
import type { HarnessRegistry } from '../harness/registry.js';
import type {
  CreateTerminalSessionOptions,
  TerminalSession,
  TerminalSpawnSpec,
} from '../terminal/pty.js';
import {
  checkFolderTrust,
  type TrustCheckResult,
  type TrustEvidenceItem,
  type TrustReason,
  type TrustState,
} from './trust.js';
import { renderManualCommand } from './manual-command.js';

/**
 * Copilot folder-trust session lifecycle.
 *
 * The service starts an *unseeded* interactive harness session through the
 * foundation terminal transport, then re-reads the harness trust configuration
 * on verify. It never writes the harness config, never queues a prompt, and
 * never supplies a session id to the interactive trust command. Persistent
 * trust is established by the user in the terminal; Skill Loom only observes it.
 *
 * Failures are typed so the route can map them to the shared error envelope
 * without inspecting a harness name or a filesystem message.
 */

export const TRUST_SESSION_ERROR_CODES = {
  NOT_SUPPORTED: 'TRUST_NOT_SUPPORTED',
  START_FAILED: 'TRUST_START_FAILED',
} as const;
export type TrustSessionErrorCode =
  (typeof TRUST_SESSION_ERROR_CODES)[keyof typeof TRUST_SESSION_ERROR_CODES];

export class TrustSessionError extends Error {
  readonly code: TrustSessionErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: TrustSessionErrorCode,
    message: string,
    details: Record<string, unknown> = {},
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

/** The subset of the terminal manager the trust flow depends on. */
export interface TrustTerminalPort {
  createSession(spec: TerminalSpawnSpec, options?: CreateTerminalSessionOptions): TerminalSession;
  getSession?(sessionId: string): TerminalSession | undefined;
  closeSession(sessionId: string): void;
}

/**
 * Harness registry source. A function lets the route honour a changed
 * `harnessCommands` configuration without rebuilding the session map.
 */
export type TrustRegistryProvider =
  | HarnessRegistry
  | (() => Promise<HarnessRegistry>);

export interface TrustSessionServiceOptions {
  terminalManager: TrustTerminalPort;
  harnessRegistry: TrustRegistryProvider;
  /** Injected home directory for trust-config resolution. Defaults to `os.homedir`. */
  homeDirectory?: string | undefined;
  /** Injected environment for `COPILOT_HOME` and credential-free reads. */
  env?: NodeJS.ProcessEnv | undefined;
  /** Injected trust-config reader; only the trusted-folder key is inspected. */
  readFileText?: ((path: string) => Promise<string>) | undefined;
  /** Session-id seam for deterministic tests. */
  generateSessionId?: (() => string) | undefined;
  /** Clock seam for the returned start timestamp. */
  now?: (() => Date) | undefined;
}

export interface TrustStartRequest {
  /** Canonical absolute project directory resolved from a project id. */
  projectPath: string;
  /** Harness id from the validated request. */
  harness: string;
}

export interface TrustStartResult {
  action: 'start';
  harness: HarnessId;
  displayName: string;
  projectPath: string;
  sessionId: string;
  /** WebSocket path the browser attaches to for the interactive terminal. */
  terminalPath: string;
  /** Exact command that was spawned; no prompt or session id is present. */
  command: HarnessTrustCommand;
  /** Exact manual fallback for the user when trust cannot be persisted. */
  manualCommand: HarnessTrustCommand;
  manualCommandText: string;
  startedAt: string;
}

export interface TrustVerifyRequest {
  projectPath: string;
  harness: string;
  /** Optional session id from the matching start response. */
  sessionId?: string | undefined;
}

export interface TrustVerifyResult {
  action: 'verify';
  harness: HarnessId;
  displayName: string;
  projectPath: string;
  /** The trust session known to this server, if one is still tracked. */
  sessionId: string | null;
  /** True only when this verify closed the tracked trust session. */
  closed: boolean;
  trusted: boolean;
  state: TrustState;
  reason: TrustReason;
  configPath: string | null;
  evidence: TrustEvidenceItem[];
  /** Always present for a folder-dialog harness; shown as the manual fallback. */
  manualCommand: HarnessTrustCommand | null;
  manualCommandText: string | null;
  remediation: string;
}

export interface TrustSessionService {
  start(request: TrustStartRequest): Promise<TrustStartResult>;
  verify(request: TrustVerifyRequest): Promise<TrustVerifyResult>;
  /** The tracked trust session id for a project/harness pair, if any. */
  getActiveSessionId(projectPath: string, harness: string): string | null;
  /** Close every tracked trust session. Safe to call on app shutdown. */
  closeAll(): void;
}

interface TrustSessionRecord {
  sessionId: string;
  harness: HarnessId;
  projectPath: string;
  startedAt: string;
  /** The exact command spawned for this trust session. */
  command: HarnessTrustCommand;
}

const MANUAL_FALLBACK_REMEDIATION =
  'Choose "Yes, and remember this folder for future sessions" in Copilot\'s folder-trust dialog, then verify trust. Session-only trust is not saved in trustedFolders. If the CLI cannot persist trust, run the manual command in a terminal and verify again.';
const UNKNOWN_TRUST_REMEDIATION =
  'Copilot trust could not be read. Check that Copilot\'s trust config is readable and valid. If the folder is not listed, choose "Yes, and remember this folder for future sessions" in Copilot\'s dialog. If needed, run the manual command in a terminal and verify again.';

export function createTrustSessionService(
  options: TrustSessionServiceOptions,
): TrustSessionService {
  const sessions = new Map<string, TrustSessionRecord>();

  const registry = async (): Promise<HarnessRegistry> => {
    if (typeof options.harnessRegistry === 'function') {
      return options.harnessRegistry();
    }
    return options.harnessRegistry;
  };

  const resolveAdapter = async (harness: string): Promise<HarnessAdapter> => {
    const adapter = (await registry()).get(harness);
    if (adapter.trust.behavior !== 'folder-dialog' || adapter.buildTrustCommand === undefined) {
      throw new TrustSessionError(
        TRUST_SESSION_ERROR_CODES.NOT_SUPPORTED,
        `${adapter.displayName} does not use a folder-trust dialog.`,
        {
          harness: adapter.id,
          behavior: adapter.trust.behavior,
        },
      );
    }
    return adapter;
  };

  const buildManualCommand = (
    adapter: HarnessAdapter,
    projectPath: string,
  ): HarnessTrustCommand | null => {
    if (adapter.buildTrustCommand === undefined) {
      return null;
    }
    try {
      return adapter.buildTrustCommand({ projectPath });
    } catch {
      // A missing executable is already a preflight block. On verify we still
      // return a typed result rather than throwing away the trust state.
      return null;
    }
  };

  const closeRecord = (record: TrustSessionRecord): void => {
    options.terminalManager.closeSession(record.sessionId);
    sessions.delete(sessionKey(record.projectPath, record.harness));
  };

  return {
    async start(request: TrustStartRequest): Promise<TrustStartResult> {
      const adapter = await resolveAdapter(request.harness);
      const projectPath = request.projectPath;

      let command: HarnessTrustCommand;
      try {
        command = adapter.buildTrustCommand!({ projectPath });
      } catch (error) {
        throw new TrustSessionError(
          TRUST_SESSION_ERROR_CODES.START_FAILED,
          `The ${adapter.displayName} trust session could not be prepared.`,
          { harness: adapter.id, reason: errorCode(error), projectPath },
          { cause: error },
        );
      }

      // Never leave a second trust PTY for the same project. The previous
      // session is user-facing and owns the single-subscriber terminal.
      const previous = sessions.get(sessionKey(projectPath, adapter.id));
      if (previous !== undefined) {
        closeRecord(previous);
      }

      const sessionId = options.generateSessionId?.() ?? `trust_${randomUUID()}`;
      let session: TerminalSession;
      try {
        session = options.terminalManager.createSession(
          {
            executable: command.executable,
            args: command.args,
            cwd: command.cwd,
            ...(options.env === undefined ? {} : { env: options.env }),
          },
          { id: sessionId },
        );
      } catch (error) {
        throw new TrustSessionError(
          TRUST_SESSION_ERROR_CODES.START_FAILED,
          `The ${adapter.displayName} trust terminal could not be started.`,
          { harness: adapter.id, reason: errorCode(error), executable: command.executable },
          { cause: error },
        );
      }

      const startedAt = (options.now ?? (() => new Date()))().toISOString();
      sessions.set(sessionKey(projectPath, adapter.id), {
        sessionId: session.id,
        harness: adapter.id,
        projectPath,
        startedAt,
        command,
      });

      return {
        action: 'start',
        harness: adapter.id,
        displayName: adapter.displayName,
        projectPath,
        sessionId: session.id,
        terminalPath: `/api/terminal/${encodeURIComponent(session.id)}`,
        command,
        manualCommand: command,
        manualCommandText: renderManualCommand(command),
        startedAt,
      };
    },

    async verify(request: TrustVerifyRequest): Promise<TrustVerifyResult> {
      const adapter = await resolveAdapter(request.harness);
      const projectPath = request.projectPath;

      const trust: TrustCheckResult = await checkFolderTrust({
        descriptor: adapter.trust,
        projectPath,
        ...(options.homeDirectory === undefined
          ? {}
          : { homeDirectory: options.homeDirectory }),
        ...(options.env === undefined ? {} : { env: options.env }),
        ...(options.readFileText === undefined
          ? {}
          : { readFileText: options.readFileText }),
      });

      const record = sessions.get(sessionKey(projectPath, adapter.id));
      let closed = false;
      if (trust.state === 'trusted' && record !== undefined) {
        closeRecord(record);
        closed = true;
      }

      // Prefer the command that was actually spawned: it is the exact manual
      // fallback even if the configured executable changed mid-session. A
      // client-supplied session id is advisory and never used to close an
      // arbitrary terminal.
      const manualCommand = record?.command ?? buildManualCommand(adapter, projectPath);
      return {
        action: 'verify',
        harness: adapter.id,
        displayName: adapter.displayName,
        projectPath,
        sessionId: record?.sessionId ?? null,
        closed,
        trusted: trust.state === 'trusted',
        state: trust.state,
        reason: trust.reason,
        configPath: trust.configPath,
        evidence: trust.evidence,
        manualCommand,
        manualCommandText:
          manualCommand === null ? null : renderManualCommand(manualCommand),
        remediation:
          trust.state === 'trusted'
            ? 'The project folder is trusted. Run preflight again before starting.'
            : trust.state === 'untrusted'
              ? MANUAL_FALLBACK_REMEDIATION
              : UNKNOWN_TRUST_REMEDIATION,
      };
    },

    getActiveSessionId(projectPath: string, harness: string): string | null {
      return sessions.get(sessionKey(projectPath, harness))?.sessionId ?? null;
    },

    closeAll(): void {
      const records = [...sessions.values()];
      sessions.clear();
      for (const record of records) {
        options.terminalManager.closeSession(record.sessionId);
      }
    },
  };
}

function sessionKey(projectPath: string, harness: string): string {
  return `${harness}\u0000${projectPath}`;
}

function errorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }
  return 'TRUST_SESSION_FAILED';
}
