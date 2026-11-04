import {
  countTailLines,
  trimTail,
  type StepStatus,
} from './model.js';

/**
 * Deterministic handoff notes.
 *
 * A handoff note is *not* a native session fork. Skill Loom starts a fresh session
 * and seeds it with a bounded summary of the previous step: its position,
 * label, skill, instruction, recorded status, and the bounded terminal tail.
 * The note contains no timestamps, ids from the environment, or randomness, so
 * planning the same run twice produces byte-identical text.
 *
 * The previous step's tail is already capped by the run model at 200 lines or
 * 32 KiB. A note applies the same cap to the entire document, which keeps the
 * metadata readable while never allowing a full transcript into a prompt.
 */

/** First line of every handoff note; it explicitly labels the mechanism. */
export const HANDOFF_HEADING = 'Handoff note (not a native session fork)';

/** Heading immediately before the bounded terminal tail. */
export const HANDOFF_TAIL_HEADING = 'Bounded terminal tail (most recent output):';

/** Maximum size of an entire handoff note. */
export const MAX_HANDOFF_BYTES = 32 * 1024;
export const MAX_HANDOFF_LINES = 200;

/** Bound for a single metadata field before the tail is appended. */
export const MAX_HANDOFF_FIELD_CHARS = 2_000;
export const MAX_HANDOFF_STATUS_CHARS = 32;

/**
 * ANSI escape sequences that commonly appear in `node-pty` output: CSI colour
 * and cursor controls, OSC titles/hyperlinks terminated by BEL or ST, and
 * single-character escape sequences. Unrelated terminal control text must not
 * leak into a prompt.
 */
const ANSI_ESCAPE_PATTERN =
  /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-_])/g;

/** C0 controls except tab and newline, plus DEL and C1 controls. */
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** Zero-width and bidirectional formatting characters. */
const INVISIBLE_FORMATTING_PATTERN = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;

/** The previous step metadata a handoff note is built from. */
export interface HandoffSourceStep {
  /** Zero-based position in the frozen chain snapshot. */
  readonly index: number;
  /** Optional human-facing label; falls back to the skill name. */
  readonly label?: string | null | undefined;
  readonly skillName: string;
  /** The previous step's instruction, already resolved for this run. */
  readonly instruction: string;
  readonly status: StepStatus;
  /** Bounded tail retained for that step. Never a full transcript. */
  readonly tail?: string | undefined;
}

export interface HandoffNoteOptions {
  readonly maxBytes?: number | undefined;
  readonly maxLines?: number | undefined;
}

/**
 * Remove terminal escapes and unsafe control characters, normalize line
 * endings, and apply a deterministic character cap.
 *
 * The function is intentionally total: it accepts any value so a corrupt or
 * absent record produces a readable placeholder rather than throwing during
 * prompt assembly. Newlines and tabs are preserved because the tail is
 * line-oriented.
 */
export function sanitizeHandoffText(
  value: unknown,
  maxChars = MAX_HANDOFF_FIELD_CHARS,
): string {
  const raw = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);

  let text = raw.replace(ANSI_ESCAPE_PATTERN, '');
  text = text.replace(/\r\n?/g, '\n');
  text = text.replace(CONTROL_CHARACTER_PATTERN, '');
  text = text.replace(INVISIBLE_FORMATTING_PATTERN, '');
  // Strip trailing whitespace from each line without touching a meaningful
  // trailing tab in the middle of a line.
  text = text.replace(/[ \t]+$/gm, '');
  // Collapse runs of blank lines so a noisy tail cannot inflate the note with
  // layout whitespace. A single blank line is preserved.
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  if (maxChars > 0) {
    const characters = Array.from(text);
    if (characters.length > maxChars) {
      text = characters.slice(0, maxChars).join('');
    }
  }

  return text;
}

/**
 * Build the deterministic handoff note for the step that follows `source`.
 *
 * The note always starts with the explicit "not a native session fork" label
 * and keeps the full metadata block. The tail is trimmed from its oldest end
 * until both the note line and byte caps are satisfied.
 */
export function buildHandoffNote(
  source: HandoffSourceStep,
  options: HandoffNoteOptions = {},
): string {
  const maxBytes = positiveInteger(options.maxBytes, MAX_HANDOFF_BYTES);
  const maxLines = positiveInteger(options.maxLines, MAX_HANDOFF_LINES);

  const skillName =
    sanitizeHandoffText(source.skillName) || '(unknown skill)';
  const label =
    sanitizeHandoffText(source.label ?? '') ||
    skillName ||
    '(unknown step)';
  const instruction =
    sanitizeHandoffText(source.instruction) || '(no instruction recorded)';
  const status =
    sanitizeHandoffText(source.status, MAX_HANDOFF_STATUS_CHARS) || 'unknown';
  const tail = sanitizeHandoffText(source.tail ?? '', 0);

  const header = [
    HANDOFF_HEADING,
    `Previous step ${String(source.index + 1)}: ${label} (skill: ${skillName})`,
    `Status: ${status}`,
    '',
    'Instruction:',
    instruction,
  ].join('\n');

  const fixedPrefix = `${header}\n\n${HANDOFF_TAIL_HEADING}\n`;
  const fixedBytes = Buffer.byteLength(fixedPrefix, 'utf8');
  const fixedLines = countTailLines(fixedPrefix);

  const tailByteBudget = Math.max(0, maxBytes - fixedBytes);
  const tailLineBudget = Math.max(0, maxLines - fixedLines);
  const boundedTail =
    tailByteBudget === 0 || tailLineBudget === 0
      ? ''
      : trimTail(tail, { maxBytes: tailByteBudget, maxLines: tailLineBudget });

  const tailBody =
    boundedTail === '' ? '(no terminal output captured)' : boundedTail;
  let note = `${fixedPrefix}${tailBody}`;

  // The tail budget keeps the note inside both caps in normal use. Re-apply
  // both caps as a final guard so an unusually small custom cap remains safe.
  note = capLines(note, maxLines);
  note = truncateUtf8(note, maxBytes);
  note = capLines(note, maxLines);

  return note.trimEnd();
}

/**
 * Cut a UTF-8 string to at most `maxBytes` without splitting a multi-byte
 * code point. Used only as a final guard for a caller-supplied tiny cap.
 */
export function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return '';
  }

  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= maxBytes) {
    return value;
  }

  let end = maxBytes;
  // Move back while the byte at the cut point is a UTF-8 continuation byte.
  while (end > 0 && end < bytes.length && ((bytes[end] ?? 0) & 0xc0) === 0x80) {
    end -= 1;
  }
  return bytes.subarray(0, end).toString('utf8');
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function capLines(value: string, maxLines: number): string {
  if (maxLines <= 0) {
    return '';
  }
  const lines = value.split('\n');
  return lines.length <= maxLines ? value : lines.slice(0, maxLines).join('\n');
}
