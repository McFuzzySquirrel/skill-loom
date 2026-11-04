/**
 * Streaming parser for OpenCode's OSC 7501 terminal state signal.
 *
 * OpenCode emits `OSC 7501;state=working|idle|clear` with an optional
 * `id=ses_...` parameter. The signal arrives on the PTY byte stream, so it can
 * be split at any position across chunks and surrounded by unrelated ANSI
 * output. A completion may only be reported after `working` was observed in
 * the same step; `clear` resets that observation.
 *
 * This module contains no timers, clocks, or output-quiescence logic. Quiet
 * terminal output is not a completion signal (EXEC-02).
 */

/** Complete OSC introducer for the 7501 state channel. */
export const OSC7501_PREFIX = '\x1b]7501;';

/** String Terminator in its BEL and two-byte ESC forms, plus C1 ST. */
const BEL = '\x07';
const ESC = '\x1b';
const ESCAPED_ST = `${ESC}\\`;
const C1_ST = '\u009c';

/** Recognized state values. Unknown values are ignored, never invented. */
export const OSC7501_STATES = ['working', 'idle', 'clear'] as const;
export type Osc7501State = (typeof OSC7501_STATES)[number];

/** Default cap for an unterminated sequence retained across chunks. */
export const DEFAULT_OSC_BUFFER_BYTES = 64 * 1024;

/** Stable parameter names. Extra parameters are retained but not interpreted. */
export const OSC7501_PARAM_STATE = 'state';
export const OSC7501_PARAM_SESSION_ID = 'id';

/**
 * A session id is used only as an observation label. Restrict it to a safe
 * token so arbitrary terminal text can never be surfaced as a session id.
 */
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

/** One complete, recognized OSC 7501 sequence. */
export interface Osc7501Event {
  readonly state: Osc7501State;
  /** Optional `id=ses_...` from the same sequence. */
  readonly sessionId: string | null;
  /** Raw parameter text between the prefix and the terminator. */
  readonly params: string;
}

/** Result of feeding one chunk into the incremental parser. */
export interface OscParseResult {
  readonly events: readonly Osc7501Event[];
  /**
   * The only bytes that may belong to a sequence completed by a later chunk.
   * It is either a partial OSC 7501 introducer or an unterminated sequence.
   */
  readonly remainder: string;
}

export interface Osc7501ParserOptions {
  /** Cap for an unterminated sequence. Exceeding it discards the fragment. */
  readonly maxBufferBytes?: number | undefined;
}

/**
 * Parse the parameter text of one OSC 7501 sequence.
 *
 * Parameters are semicolon-separated `key=value` pairs. `state` is required
 * and must be one of the documented values; a sequence with an unknown or
 * absent state is ignored. `id` is optional and only retained when it looks
 * like a safe token.
 */
export function parseOsc7501Params(params: string): Osc7501Event | null {
  if (typeof params !== 'string') {
    return null;
  }

  let state: Osc7501State | null = null;
  let sessionId: string | null = null;

  for (const field of params.split(';')) {
    const separator = field.indexOf('=');
    if (separator <= 0) {
      continue;
    }

    const key = field.slice(0, separator).trim().toLowerCase();
    const value = field.slice(separator + 1).trim();

    if (key === OSC7501_PARAM_STATE) {
      const candidate = value.toLowerCase();
      if ((OSC7501_STATES as readonly string[]).includes(candidate)) {
        state = candidate as Osc7501State;
      } else {
        // An unknown state invalidates the sequence rather than guessing.
        return null;
      }
    } else if (key === OSC7501_PARAM_SESSION_ID) {
      sessionId = SESSION_ID_PATTERN.test(value) ? value : null;
    }
  }

  if (state === null) {
    return null;
  }

  return { state, sessionId, params };
}

/**
 * Parse one chunk plus an optional carried remainder.
 *
 * The parser searches for the OSC 7501 introducer, discards unrelated text
 * and ANSI, and emits every complete sequence in arrival order. A split
 * introducer or an unterminated sequence is returned as `remainder` so the
 * caller can feed it back with the next chunk.
 */
export function parseOsc7501Chunk(
  chunk: string,
  previousRemainder = '',
  options: Osc7501ParserOptions = {},
): OscParseResult {
  const combined =
    (typeof previousRemainder === 'string' ? previousRemainder : '') +
    (typeof chunk === 'string' ? chunk : '');
  const maxBufferBytes = positiveInteger(options.maxBufferBytes, DEFAULT_OSC_BUFFER_BYTES);

  let buffer = combined;
  const events: Osc7501Event[] = [];

  while (buffer.length > 0) {
    const start = buffer.indexOf(OSC7501_PREFIX);

    if (start < 0) {
      return { events, remainder: keepPossiblePrefix(buffer) };
    }

    if (start > 0) {
      buffer = buffer.slice(start);
    }

    const scan = scanForTerminator(buffer, OSC7501_PREFIX.length);

    if (scan.kind === 'incomplete') {
      // Keep the fragment only when it is within the bounded buffer. Dropping
      // an oversized unterminated fragment can only lose a completion signal,
      // which is safer than unbounded memory growth.
      return {
        events,
        remainder: buffer.length <= maxBufferBytes ? buffer : '',
      };
    }

    if (scan.kind === 'malformed') {
      // A non-ST escape inside an OSC payload means the sequence never
      // terminated. Drop it and continue scanning after the escape so a later
      // valid sequence is not swallowed by the malformed one.
      buffer = buffer.slice(scan.index);
      continue;
    }

    const params = buffer.slice(OSC7501_PREFIX.length, scan.index);
    const event = parseOsc7501Params(params);
    if (event !== null) {
      events.push(event);
    }

    buffer = buffer.slice(scan.index + scan.length);
  }

  return { events, remainder: '' };
}

/**
 * Incremental OSC 7501 parser.
 *
 * Feed each PTY chunk to `push`; complete events are returned in order and the
 * unconsumed fragment stays internal until the next push.
 */
export class Osc7501Parser {
  private buffer = '';
  private readonly maxBufferBytes: number;

  constructor(options: Osc7501ParserOptions = {}) {
    this.maxBufferBytes = positiveInteger(
      options.maxBufferBytes,
      DEFAULT_OSC_BUFFER_BYTES,
    );
  }

  push(chunk: string): Osc7501Event[] {
    const result = parseOsc7501Chunk(chunk, this.buffer, {
      maxBufferBytes: this.maxBufferBytes,
    });
    this.buffer = result.remainder;
    return [...result.events];
  }

  /** Current carried fragment. Useful for diagnostics and tests. */
  get remainder(): string {
    return this.buffer;
  }

  /** UTF-8 size of the carried fragment. */
  get bufferedBytes(): number {
    return Buffer.byteLength(this.buffer, 'utf8');
  }

  reset(): void {
    this.buffer = '';
  }
}

/** Observable phase of one step's OSC state machine. */
export type OscPhase = 'unknown' | Osc7501State;

/**
 * One recognized event as seen by the state machine. `advanced` is true only
 * for the idle that follows a working state in the same step.
 */
export interface OscStateChange {
  readonly state: Osc7501State;
  readonly sessionId: string | null;
  /** True only on the working -> idle transition that completes the step. */
  readonly advanced: boolean;
  /** True when this event reported `working`. */
  readonly working: boolean;
  /** True when this event reported `clear` and reset the observation. */
  readonly cleared: boolean;
}

export interface OscStateMachineOptions extends Osc7501ParserOptions {}

/**
 * Per-step working/idle state machine.
 *
 * The only way `completed` becomes true is an `idle` event after a `working`
 * event in this instance. An idle-only stream is ignored, and `clear` resets
 * both the working observation and the completion flag. Call `reset()` before
 * every new step so a previous step can never advance the next one.
 */
export class Osc7501StateMachine {
  private readonly parser: Osc7501Parser;
  private phaseValue: OscPhase = 'unknown';
  private sawWorkingValue = false;
  private completedValue = false;
  private sessionIdValue: string | null = null;

  constructor(options: OscStateMachineOptions = {}) {
    this.parser = new Osc7501Parser(options);
  }

  /**
   * Feed a PTY chunk and return each state change it produced. Idle without a
   * prior working event produces no change at all, so a caller cannot
   * accidentally treat it as completion.
   */
  push(chunk: string): OscStateChange[] {
    const events = this.parser.push(chunk);
    const changes: OscStateChange[] = [];

    for (const event of events) {
      if (event.sessionId !== null) {
        this.sessionIdValue = event.sessionId;
      }

      if (event.state === 'working') {
        this.sawWorkingValue = true;
        this.completedValue = false;
        this.phaseValue = 'working';
        changes.push({
          state: 'working',
          sessionId: this.sessionIdValue,
          advanced: false,
          working: true,
          cleared: false,
        });
        continue;
      }

      if (event.state === 'idle') {
        if (!this.sawWorkingValue) {
          // Idle without working in the same step is not a completion. Leave
          // the phase and all flags exactly as they were.
          continue;
        }

        const advanced = !this.completedValue;
        this.completedValue = true;
        this.phaseValue = 'idle';
        changes.push({
          state: 'idle',
          sessionId: this.sessionIdValue,
          advanced,
          working: false,
          cleared: false,
        });
        continue;
      }

      // clear
      this.sawWorkingValue = false;
      this.completedValue = false;
      this.phaseValue = 'clear';
      changes.push({
        state: 'clear',
        sessionId: this.sessionIdValue,
        advanced: false,
        working: false,
        cleared: true,
      });
    }

    return changes;
  }

  get phase(): OscPhase {
    return this.phaseValue;
  }

  /** Alias for phase, matching the vocabulary of the wire signal. */
  get state(): OscPhase {
    return this.phaseValue;
  }

  get sawWorking(): boolean {
    return this.sawWorkingValue;
  }

  /** True only after an idle following working in this same step. */
  get completed(): boolean {
    return this.completedValue;
  }

  /** Alias used by automatic runners when deciding whether to advance. */
  get advanced(): boolean {
    return this.completedValue;
  }

  get sessionId(): string | null {
    return this.sessionIdValue;
  }

  /** Drop buffered bytes and reset all per-step observation state. */
  reset(): void {
    this.parser.reset();
    this.phaseValue = 'unknown';
    this.sawWorkingValue = false;
    this.completedValue = false;
    this.sessionIdValue = null;
  }
}

type TerminatorScan =
  | { readonly kind: 'terminator'; readonly index: number; readonly length: number }
  | { readonly kind: 'incomplete' }
  | { readonly kind: 'malformed'; readonly index: number };

function scanForTerminator(value: string, from: number): TerminatorScan {
  for (let index = from; index < value.length; index += 1) {
    const character = value[index];

    if (character === BEL || character === C1_ST) {
      return { kind: 'terminator', index, length: 1 };
    }

    if (character === ESC) {
      const next = value[index + 1];
      if (next === undefined) {
        // The two-byte ESC \ terminator may be split across chunks.
        return { kind: 'incomplete' };
      }
      if (next === '\\') {
        return { kind: 'terminator', index, length: 2 };
      }
      // An OSC payload cannot contain a raw escape other than ST. Treat the
      // current sequence as malformed instead of swallowing later output.
      return { kind: 'malformed', index };
    }
  }

  return { kind: 'incomplete' };
}

/**
 * Keep only the longest suffix that could be the beginning of an OSC 7501
 * introducer. This makes a chunk boundary in `ESC ] 7 5 0 1 ;` safe without
 * retaining unrelated terminal output.
 */
function keepPossiblePrefix(value: string): string {
  const longestPossible = Math.min(value.length, OSC7501_PREFIX.length - 1);
  for (let length = longestPossible; length > 0; length -= 1) {
    const suffix = value.slice(value.length - length);
    if (OSC7501_PREFIX.startsWith(suffix)) {
      return suffix;
    }
  }
  return '';
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
