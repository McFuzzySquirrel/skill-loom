import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn as spawnPty } from 'node-pty';
import type {
  TerminalErrorCode,
  TerminalServerMessage,
} from '../../shared/terminal.js';

/** Default PTY geometry used when a runner does not supply one. */
export const DEFAULT_TERMINAL_COLS = 120;
export const DEFAULT_TERMINAL_ROWS = 32;

/** A bounded tail, never a transcript (PRIV-01). */
export const DEFAULT_MAX_TAIL_LINES = 200;
export const DEFAULT_MAX_TAIL_BYTES = 32 * 1024;

const MAX_TERMINAL_COLS = 1_000;
const MAX_TERMINAL_ROWS = 1_000;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type TerminalTransportErrorCode = Exclude<
  TerminalErrorCode,
  'TERMINAL_INVALID_MESSAGE' | 'TERMINAL_INTERNAL_ERROR'
>;

/** A typed failure raised by the terminal transport before it reaches a route. */
export class TerminalTransportError extends Error {
  readonly code: TerminalTransportErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: TerminalTransportErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

export class TerminalInvalidSpecError extends TerminalTransportError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('TERMINAL_INVALID_SPEC', message, details);
  }
}

export class TerminalSpawnError extends TerminalTransportError {
  constructor(
    message: string,
    details: Record<string, unknown> = {},
    options: { cause?: unknown } = {},
  ) {
    super('TERMINAL_SPAWN_FAILED', message, details);
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export class TerminalSessionNotFoundError extends TerminalTransportError {
  constructor(sessionId: string) {
    super('TERMINAL_NOT_FOUND', `Terminal session "${sessionId}" was not found.`, { sessionId });
  }
}

export class TerminalSubscriberConflictError extends TerminalTransportError {
  constructor(sessionId: string) {
    super(
      'TERMINAL_SUBSCRIBER_CONFLICT',
      `Terminal session "${sessionId}" already has an active subscriber.`,
      { sessionId },
    );
  }
}

export class TerminalNotRunningError extends TerminalTransportError {
  constructor(sessionId: string) {
    super('TERMINAL_NOT_RUNNING', `Terminal session "${sessionId}" is no longer running.`, {
      sessionId,
    });
  }
}

export interface TerminalSpawnSpec {
  /** Executable name or absolute path. Never a shell command string. */
  executable: string;
  /** Argument vector passed to the executable without shell interpolation. */
  args: readonly string[];
  /** Canonical working directory. Defaults to the server process cwd. */
  cwd?: string;
  /** Additional environment entries; the base is the server environment. */
  env?: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
  /** TERM value conveyed to the child. Defaults to `xterm-256color`. */
  name?: string;
}

export interface TerminalExit {
  exitCode: number;
  signal?: number;
}

/** The server-side terminal contract consumed by later run runners. */
export interface TerminalSession {
  readonly id: string;
  readonly pid: number;
  readonly cols: number;
  readonly rows: number;
  /** Write client input to the PTY. Throws when the child has exited. */
  write(data: string): void;
  /** Resize the PTY. Throws when the child has exited. */
  resize(cols: number, rows: number): void;
  /** Subscribe to raw PTY output. Returns an unsubscribe function. */
  onData(listener: (chunk: string) => void): () => void;
  /** Subscribe to a single process exit. Returns an unsubscribe function. */
  onExit(listener: (event: TerminalExit) => void): () => void;
  /** The bounded tail retained for reconnects and later run records. */
  getBufferedOutput(): string;
  /** The recorded exit event, or `null` while the child is alive. */
  getExit(): TerminalExit | null;
  isRunning(): boolean;
  /** Idempotent kill. A missing or already-exited child is tolerated. */
  kill(signal?: string): void;
}

export interface CreateTerminalSessionOptions {
  /** Stable session id. Defaults to a generated `term_<uuid>`. */
  id?: string;
  maxTailLines?: number;
  maxTailBytes?: number;
}

/**
 * Keep only the newest lines and bytes of terminal output. Applied at append
 * time so the transport never retains an unbounded transcript.
 */
export function trimTerminalOutput(
  text: string,
  maxLines = DEFAULT_MAX_TAIL_LINES,
  maxBytes = DEFAULT_MAX_TAIL_BYTES,
): string {
  if (text === '') {
    return '';
  }

  let output = text;
  if (maxLines > 0) {
    const lines = output.split('\n');
    if (lines.length > maxLines) {
      output = lines.slice(lines.length - maxLines).join('\n');
    }
  }

  let byteLength = Buffer.byteLength(output, 'utf8');
  if (byteLength > maxBytes) {
    const bytes = Buffer.from(output, 'utf8');
    let start = bytes.length - maxBytes;
    // Do not begin in the middle of a UTF-8 continuation sequence.
    while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) {
      start += 1;
    }
    output = bytes.subarray(start).toString('utf8');
    byteLength = Buffer.byteLength(output, 'utf8');
    while (byteLength > maxBytes && output.length > 0) {
      output = output.slice(1);
      byteLength = Buffer.byteLength(output, 'utf8');
    }
  }

  return output;
}

/** A per-session capped output buffer. */
export class TerminalOutputBuffer {
  readonly maxLines: number;
  readonly maxBytes: number;
  private content = '';

  constructor(maxLines = DEFAULT_MAX_TAIL_LINES, maxBytes = DEFAULT_MAX_TAIL_BYTES) {
    this.maxLines = maxLines;
    this.maxBytes = maxBytes;
  }

  append(chunk: string): void {
    if (chunk === '') {
      return;
    }
    this.content = trimTerminalOutput(`${this.content}${chunk}`, this.maxLines, this.maxBytes);
  }

  toString(): string {
    return this.content;
  }

  get byteLength(): number {
    return Buffer.byteLength(this.content, 'utf8');
  }

  clear(): void {
    this.content = '';
  }
}

function validateDimension(value: unknown, name: 'cols' | 'rows'): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_TERMINAL_COLS) {
    throw new TerminalInvalidSpecError(
      `Terminal ${name} must be an integer from 1 to ${MAX_TERMINAL_COLS}.`,
      { field: name, value },
    );
  }
  return value as number;
}

function validateSessionId(id: string): string {
  if (typeof id !== 'string' || !SESSION_ID_PATTERN.test(id)) {
    throw new TerminalInvalidSpecError('Terminal session id must be a stable identifier.', {
      field: 'id',
      value: typeof id === 'string' ? id : typeof id,
    });
  }
  return id;
}

function resolveCwd(cwd: string | undefined): string {
  try {
    const candidate = realpathSync(resolve(cwd ?? process.cwd()));
    if (!statSync(candidate).isDirectory()) {
      throw new TerminalInvalidSpecError('Terminal cwd must be an existing directory.', {
        field: 'cwd',
      });
    }
    return candidate;
  } catch (error) {
    if (error instanceof TerminalTransportError) {
      throw error;
    }
    throw new TerminalInvalidSpecError('Terminal cwd must be an existing directory.', {
      field: 'cwd',
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

function validateSpawnSpec(spec: TerminalSpawnSpec): {
  executable: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  name: string;
} {
  if (typeof spec !== 'object' || spec === null) {
    throw new TerminalInvalidSpecError('A terminal spawn specification is required.');
  }

  const executable = typeof spec.executable === 'string' ? spec.executable.trim() : '';
  if (executable === '' || executable.includes('\0')) {
    throw new TerminalInvalidSpecError('Terminal executable must be a non-empty file name.', {
      field: 'executable',
    });
  }
  if (!Array.isArray(spec.args) || spec.args.some((arg) => typeof arg !== 'string')) {
    throw new TerminalInvalidSpecError('Terminal args must be an array of strings.', {
      field: 'args',
    });
  }
  if (spec.args.some((arg) => arg.includes('\0'))) {
    throw new TerminalInvalidSpecError('Terminal args must not contain NUL bytes.', {
      field: 'args',
    });
  }

  return {
    executable,
    args: [...spec.args],
    cwd: resolveCwd(spec.cwd),
    cols: validateDimension(spec.cols ?? DEFAULT_TERMINAL_COLS, 'cols'),
    rows: validateDimension(spec.rows ?? DEFAULT_TERMINAL_ROWS, 'rows'),
    name: spec.name?.trim() || 'xterm-256color',
  };
}

/**
 * Spawn a child in a real PTY using an executable and argument vector only.
 * No shell is involved and no client text is ever interpreted as a command.
 */
export function createTerminalSession(
  spec: TerminalSpawnSpec,
  options: CreateTerminalSessionOptions = {},
): TerminalSession {
  const validated = validateSpawnSpec(spec);
  const id = validateSessionId(options.id ?? `term_${randomUUID()}`);
  const buffer = new TerminalOutputBuffer(
    options.maxTailLines ?? DEFAULT_MAX_TAIL_LINES,
    options.maxTailBytes ?? DEFAULT_MAX_TAIL_BYTES,
  );

  const dataListeners = new Set<(chunk: string) => void>();
  const exitListeners = new Set<(event: TerminalExit) => void>();
  let exited = false;
  let exitEvent: TerminalExit | null = null;
  let colsValue = validated.cols;
  let rowsValue = validated.rows;

  const child = (() => {
    try {
      return spawnPty(validated.executable, validated.args, {
        name: validated.name,
        cwd: validated.cwd,
        cols: validated.cols,
        rows: validated.rows,
        env: {
          ...process.env,
          TERM: validated.name,
          ...(spec.env ?? {}),
        },
      });
    } catch (error) {
      throw new TerminalSpawnError(
        `Could not start terminal process "${validated.executable}".`,
        { executable: validated.executable },
        { cause: error },
      );
    }
  })();

  const dataSubscription = child.onData((chunk: string) => {
    buffer.append(chunk);
    for (const listener of [...dataListeners]) {
      listener(chunk);
    }
  });

  const exitSubscription = child.onExit((event) => {
    if (exited) {
      return;
    }
    exited = true;
    exitEvent = {
      exitCode: event.exitCode,
      ...(event.signal === undefined ? {} : { signal: event.signal }),
    };
    dataSubscription.dispose();
    exitSubscription.dispose();
    for (const listener of [...exitListeners]) {
      listener(exitEvent);
    }
    exitListeners.clear();
  });

  return {
    id,
    pid: child.pid,
    get cols(): number {
      return colsValue;
    },
    get rows(): number {
      return rowsValue;
    },
    write(data: string): void {
      if (exited) {
        throw new TerminalNotRunningError(id);
      }
      if (typeof data !== 'string') {
        throw new TerminalInvalidSpecError('Terminal input must be a string.', {
          field: 'data',
        });
      }
      child.write(data);
    },
    resize(cols: number, rows: number): void {
      if (exited) {
        throw new TerminalNotRunningError(id);
      }
      const nextCols = validateDimension(cols, 'cols');
      const nextRows = validateDimension(rows, 'rows');
      if (nextCols === colsValue && nextRows === rowsValue) {
        return;
      }
      child.resize(nextCols, nextRows);
      colsValue = nextCols;
      rowsValue = nextRows;
    },
    onData(listener: (chunk: string) => void): () => void {
      dataListeners.add(listener);
      return () => {
        dataListeners.delete(listener);
      };
    },
    onExit(listener: (event: TerminalExit) => void): () => void {
      if (exited && exitEvent !== null) {
        const event = exitEvent;
        queueMicrotask(() => listener(event));
        return () => undefined;
      }
      exitListeners.add(listener);
      return () => {
        exitListeners.delete(listener);
      };
    },
    getBufferedOutput(): string {
      return buffer.toString();
    },
    getExit(): TerminalExit | null {
      return exitEvent;
    },
    isRunning(): boolean {
      return !exited;
    },
    kill(signal?: string): void {
      if (exited) {
        return;
      }
      try {
        child.kill(signal);
      } catch {
        // Kill races and already-exited children are expected during cleanup.
      }
    },
  };
}

/** The server-side consumer that receives terminal messages. */
export interface TerminalSubscriber {
  send(message: TerminalServerMessage): void;
  close(code?: number, reason?: string): void;
}

export interface TerminalAttachment {
  readonly sessionId: string;
  readonly session: TerminalSession;
  /** Release the subscriber, optionally terminating the child. Idempotent. */
  detach(options?: { terminate?: boolean }): void;
}

export interface TerminalManagerOptions {
  maxTailLines?: number;
  maxTailBytes?: number;
}

interface ManagedTerminal {
  session: TerminalSession;
  subscriber: TerminalSubscriber | null;
  unsubscribeData: (() => void) | null;
  unsubscribeExit: (() => void) | null;
}

/**
 * In-memory registry of PTY sessions with single-subscriber ownership.
 *
 * Runners create sessions here; the WebSocket route attaches a browser client
 * to an existing id. The manager never accepts a command or path from a client.
 */
export class TerminalManager {
  private readonly terminals = new Map<string, ManagedTerminal>();
  private readonly options: TerminalManagerOptions;

  constructor(options: TerminalManagerOptions = {}) {
    this.options = options;
  }

  createSession(spec: TerminalSpawnSpec, options: CreateTerminalSessionOptions = {}): TerminalSession {
    const id = validateSessionId(options.id ?? `term_${randomUUID()}`);
    if (this.terminals.has(id)) {
      throw new TerminalInvalidSpecError('Terminal session id is already in use.', {
        field: 'id',
      });
    }
    const session = createTerminalSession(spec, { ...this.options, ...options, id });
    this.terminals.set(session.id, {
      session,
      subscriber: null,
      unsubscribeData: null,
      unsubscribeExit: null,
    });
    return session;
  }

  getSession(sessionId: string): TerminalSession | undefined {
    return this.terminals.get(sessionId)?.session;
  }

  hasSession(sessionId: string): boolean {
    return this.terminals.has(sessionId);
  }

  get size(): number {
    return this.terminals.size;
  }

  /**
   * Attach the one permitted subscriber. A second subscriber receives a typed
   * conflict and the first subscriber continues receiving output untouched.
   */
  attach(sessionId: string, subscriber: TerminalSubscriber): TerminalAttachment {
    validateSessionId(sessionId);
    const entry = this.terminals.get(sessionId);
    if (entry === undefined) {
      throw new TerminalSessionNotFoundError(sessionId);
    }
    if (entry.subscriber !== null) {
      throw new TerminalSubscriberConflictError(sessionId);
    }

    entry.subscriber = subscriber;
    entry.unsubscribeData = entry.session.onData((chunk) => {
      this.send(entry, { type: 'output', data: chunk });
    });
    entry.unsubscribeExit = entry.session.onExit((event) => {
      this.send(entry, {
        type: 'exit',
        exitCode: event.exitCode,
        ...(event.signal === undefined ? {} : { signal: event.signal }),
      });
      this.clearListeners(entry);
      const active = entry.subscriber;
      entry.subscriber = null;
      active?.close(1000, 'terminal exited');
    });

    this.send(entry, {
      type: 'ready',
      sessionId: entry.session.id,
      pid: entry.session.pid,
      cols: entry.session.cols,
      rows: entry.session.rows,
    });
    const buffered = entry.session.getBufferedOutput();
    if (buffered !== '') {
      this.send(entry, { type: 'output', data: buffered });
    }

    const exit = entry.session.getExit();
    if (exit !== null) {
      this.send(entry, {
        type: 'exit',
        exitCode: exit.exitCode,
        ...(exit.signal === undefined ? {} : { signal: exit.signal }),
      });
      this.clearListeners(entry);
      entry.subscriber = null;
      subscriber.close(1000, 'terminal exited');
    }

    let detached = false;
    return {
      sessionId,
      session: entry.session,
      detach: (detachOptions = {}) => {
        if (detached) {
          return;
        }
        detached = true;

        if (entry.subscriber === subscriber) {
          entry.subscriber = null;
          this.clearListeners(entry);
        } else if (entry.subscriber !== null) {
          return;
        }
        if (detachOptions.terminate === true && this.terminals.get(sessionId) === entry) {
          this.closeSession(sessionId);
        }
      },
    };
  }

  /** Kill the child, close its subscriber, and forget the session. */
  closeSession(sessionId: string): void {
    const entry = this.terminals.get(sessionId);
    if (entry === undefined) {
      return;
    }

    this.terminals.delete(sessionId);
    const active = entry.subscriber;
    entry.subscriber = null;
    this.clearListeners(entry);
    entry.session.kill();
    active?.close(1001, 'terminal closed');
  }

  /**
   * Terminate every session for shutdown. SIGHUP is followed by a bounded wait
   * and SIGKILL escalation so a stubborn child cannot outlive the server.
   */
  async shutdown(timeoutMs = 500): Promise<void> {
    const entries = [...this.terminals.values()];
    this.terminals.clear();

    for (const entry of entries) {
      const active = entry.subscriber;
      entry.subscriber = null;
      this.clearListeners(entry);
      active?.close(1001, 'server shutting down');
      entry.session.kill('SIGHUP');
    }

    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (Date.now() < deadline && entries.some((entry) => entry.session.isRunning())) {
      await delay(10);
    }

    for (const entry of entries) {
      if (entry.session.isRunning()) {
        entry.session.kill('SIGKILL');
      }
    }
  }

  private send(entry: ManagedTerminal, message: TerminalServerMessage): void {
    const subscriber = entry.subscriber;
    if (subscriber === null) {
      return;
    }
    try {
      subscriber.send(message);
    } catch {
      // A subscriber can disappear between the socket close and listener cleanup.
    }
  }

  private clearListeners(entry: ManagedTerminal): void {
    entry.unsubscribeData?.();
    entry.unsubscribeData = null;
    entry.unsubscribeExit?.();
    entry.unsubscribeExit = null;
  }
}

export function createTerminalManager(options: TerminalManagerOptions = {}): TerminalManager {
  return new TerminalManager(options);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}
