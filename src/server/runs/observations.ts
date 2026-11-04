/**
 * Best-effort skill-firing observation.
 *
 * RUN-FR-10 allows Skill Loom to report whether a harness visibly loaded a step's
 * named skill. The signal is informational only:
 *
 * - Copilot prints lines such as `● skill(spike-skill)`; those map to
 *   `observed` with the skill name.
 * - Interactive OpenCode exposes no equivalent visible line, so its adapter
 *   declares the capability `unobservable` and the result is `not-observable`.
 * - Anything else is `unknown`.
 *
 * An observation must never block, fail, or advance a step. This module
 * therefore returns plain data, throws for no input, and contains no run-state
 * transition. Harness-specific capability selection lives on the adapter
 * descriptor; this parser never compares a harness id (NFR-COMPAT-01).
 */

import type {
  HarnessDescriptor,
  HarnessSkillObservation,
} from '../harness/types.js';
import type { SkillObservationState } from './model.js';

/** Capabilities an adapter may declare for skill-firing observation. */
export const SKILL_OBSERVATION_CAPABILITIES = ['log-lines', 'unobservable'] as const;
export type SkillObservationCapability = HarnessSkillObservation;

/** Maximum evidence lines retained for one observation pass. */
export const MAX_SKILL_OBSERVATIONS = 100;

/** Maximum characters retained from one matched log line. */
export const MAX_SKILL_EVIDENCE_CHARS = 512;

/** Maximum incomplete line retained by the streaming tracker. */
export const DEFAULT_SKILL_LINE_BUFFER_BYTES = 8 * 1024;

/**
 * Common ANSI escape families. OSC and CSI are removed before matching so a
 * colour code inside `skill(...)` cannot hide the skill name.
 */
const ANSI_ESCAPE_PATTERN =
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[PX^_][^\x1b]*(?:\x1b\\)?|\x1b[@-_]|\u009d[^\x07\u009c]*(?:\x07|\u009c)|\u009b[0-?]*[ -/]*[@-~]/g;

/** C0 controls except tab/newline/CR, DEL, and C1 controls. */
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * A Copilot skill log token. The negative lookbehind avoids matching a suffix
 * of an unrelated hyphenated word such as `my-skill(name)`.
 */
const SKILL_LOG_PATTERN =
  /(?<![A-Za-z0-9_-])skill\(\s*([A-Za-z0-9_@][A-Za-z0-9_@./:-]{0,127})\s*\)/g;

/** One matched piece of evidence from terminal output. */
export interface SkillObservationEvidence {
  readonly skillName: string;
  /** ANSI-stripped, bounded line that produced the match. Never persisted. */
  readonly line: string;
  /** Zero-based line number in the observed output. */
  readonly lineIndex: number;
}

/** Plain-data result of one observation pass. */
export interface SkillObservationResult {
  readonly state: SkillObservationState;
  /** The selected observed skill name, if any. */
  readonly skillName: string | null;
  /** The skill the step requested, when the caller supplied one. */
  readonly expectedSkillName: string | null;
  /** Null when there is no comparable observation or no expected name. */
  readonly matchesExpected: boolean | null;
  readonly capability: SkillObservationCapability;
  readonly observations: readonly SkillObservationEvidence[];
}

export interface ObserveSkillFiringInput {
  readonly capability: SkillObservationCapability;
  readonly output?: string | null | undefined;
  readonly expectedSkillName?: string | null | undefined;
}

export interface SkillObservationTrackerOptions {
  readonly capability: SkillObservationCapability;
  readonly expectedSkillName?: string | null | undefined;
  readonly maxBufferedLineBytes?: number | undefined;
}

/**
 * Strip terminal escapes and unsafe controls, and normalize line endings.
 * The function is total: it accepts any value and returns a string.
 */
export function stripTerminalEscapes(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARACTER_PATTERN, '');
}

/**
 * Find every `skill(name)` evidence line in terminal output.
 *
 * ANSI escapes are removed before matching, so `● \x1b[36mskill(name)\x1b[0m`
 * is recognized. The function never throws and bounds both the number of
 * matches and the retained evidence text.
 */
export function findSkillObservations(output: unknown): SkillObservationEvidence[] {
  const text = stripTerminalEscapes(output);
  if (text === '') {
    return [];
  }

  const observations: SkillObservationEvidence[] = [];
  const lines = text.split('\n');

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (observations.length >= MAX_SKILL_OBSERVATIONS) {
      break;
    }

    const line = lines[lineIndex] ?? '';
    SKILL_LOG_PATTERN.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = SKILL_LOG_PATTERN.exec(line)) !== null) {
      const skillName = match[1];
      if (skillName !== undefined && skillName !== '') {
        observations.push({
          skillName,
          line: truncateText(line.trim(), MAX_SKILL_EVIDENCE_CHARS),
          lineIndex,
        });
      }

      if (match[0].length === 0) {
        SKILL_LOG_PATTERN.lastIndex += 1;
      }

      if (observations.length >= MAX_SKILL_OBSERVATIONS) {
        break;
      }
    }
  }

  return observations;
}

/** Convenience wrapper returning only the observed names in line order. */
export function extractSkillNames(output: unknown): string[] {
  return findSkillObservations(output).map((observation) => observation.skillName);
}

/**
 * Observe skill firing from a harness output buffer.
 *
 * - `unobservable` always reports `not-observable`, even if the text happens
 *   to contain a `skill(...)` token.
 * - `log-lines` reports `observed` when evidence exists, otherwise `unknown`.
 *
 * A caller may supply the expected step skill so a mismatch is visible; the
 * result still records the name that was actually observed.
 */
export function observeSkillFiring(input: ObserveSkillFiringInput): SkillObservationResult {
  const expectedSkillName = normalizeSkillName(input.expectedSkillName);

  if (input.capability === 'unobservable') {
    return {
      state: 'not-observable',
      skillName: null,
      expectedSkillName,
      matchesExpected: null,
      capability: input.capability,
      observations: [],
    };
  }

  if (input.capability !== 'log-lines') {
    return {
      state: 'unknown',
      skillName: null,
      expectedSkillName,
      matchesExpected: null,
      capability: 'log-lines',
      observations: [],
    };
  }

  return summarizeObservations(
    'log-lines',
    expectedSkillName,
    findSkillObservations(input.output ?? ''),
  );
}

/**
 * Observe using the capability declared by an adapter descriptor. Route and
 * runner code should use this rather than selecting behaviour by harness id.
 */
export function observeSkillFiringForAdapter(
  descriptor: Pick<HarnessDescriptor, 'skillObservation'>,
  output?: string | null | undefined,
  expectedSkillName?: string | null | undefined,
): SkillObservationResult {
  return observeSkillFiring({
    capability: descriptor.skillObservation,
    output,
    expectedSkillName,
  });
}

/**
 * Streaming skill observation tracker.
 *
 * Chunks are accumulated until a newline or `finish()` so a `skill(name)`
 * token split across PTY writes is still recognized. Only the current
 * incomplete line is buffered, and it is capped; no transcript is retained.
 */
export class SkillObservationTracker {
  private readonly capability: SkillObservationCapability;
  private readonly expectedSkillName: string | null;
  private readonly maxBufferedLineBytes: number;
  private buffer = '';
  private nextLineIndex = 0;
  private observations: SkillObservationEvidence[] = [];

  constructor(options: SkillObservationTrackerOptions) {
    this.capability = options.capability;
    this.expectedSkillName = normalizeSkillName(options.expectedSkillName);
    this.maxBufferedLineBytes = positiveInteger(
      options.maxBufferedLineBytes,
      DEFAULT_SKILL_LINE_BUFFER_BYTES,
    );
  }

  /** Feed one terminal chunk and return the current observation result. */
  push(chunk: string): SkillObservationResult {
    if (this.capability !== 'log-lines' || typeof chunk !== 'string') {
      return this.result();
    }

    this.buffer += chunk;
    this.processCompleteLines();

    if (Buffer.byteLength(this.buffer, 'utf8') > this.maxBufferedLineBytes) {
      // Do not retain an unbounded line. Best-effort matching still sees the
      // current buffer, then it is discarded rather than growing a transcript.
      this.collectLine(this.buffer);
      this.buffer = '';
    }

    return this.result();
  }

  /** Process the final unterminated line and return the result. */
  finish(): SkillObservationResult {
    if (this.capability === 'log-lines' && this.buffer !== '') {
      this.collectLine(this.buffer);
      this.buffer = '';
    }
    return this.result();
  }

  /** Current result without consuming pending bytes. */
  result(): SkillObservationResult {
    if (this.capability === 'unobservable') {
      return {
        state: 'not-observable',
        skillName: null,
        expectedSkillName: this.expectedSkillName,
        matchesExpected: null,
        capability: this.capability,
        observations: [],
      };
    }

    return summarizeObservations(
      'log-lines',
      this.expectedSkillName,
      this.observations,
    );
  }

  /** Drop buffered output and every collected observation. */
  reset(): void {
    this.buffer = '';
    this.nextLineIndex = 0;
    this.observations = [];
  }

  private processCompleteLines(): void {
    const parts = this.buffer.split('\n');
    const tail = parts.pop() ?? '';
    for (const line of parts) {
      this.collectLine(line);
    }
    this.buffer = tail;
  }

  private collectLine(line: string): void {
    const lineIndex = this.nextLineIndex;
    this.nextLineIndex += 1;

    const found = findSkillObservations(line);
    for (const observation of found) {
      if (this.observations.length >= MAX_SKILL_OBSERVATIONS) {
        return;
      }
      this.observations.push({
        skillName: observation.skillName,
        line: observation.line,
        lineIndex,
      });
    }
  }
}

function summarizeObservations(
  capability: SkillObservationCapability,
  expectedSkillName: string | null,
  observations: readonly SkillObservationEvidence[],
): SkillObservationResult {
  const selected =
    expectedSkillName === null
      ? observations[0] ?? null
      : observations.find((observation) => observation.skillName === expectedSkillName) ??
        observations[0] ??
        null;

  return {
    state: selected === null ? 'unknown' : 'observed',
    skillName: selected?.skillName ?? null,
    expectedSkillName,
    matchesExpected:
      selected === null || expectedSkillName === null
        ? null
        : selected.skillName === expectedSkillName,
    capability,
    observations: [...observations],
  };
}

function normalizeSkillName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  // Cut on code points so a retained evidence line stays valid Unicode.
  return Array.from(value).slice(0, maxChars).join('');
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
