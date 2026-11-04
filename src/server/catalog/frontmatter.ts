import { parse } from 'yaml';

/**
 * Parsing for the optional YAML frontmatter block at the top of a `SKILL.md`.
 *
 * This module is deliberately small and side-effect free. It never reads a
 * file, executes a skill, or contacts a harness; the scanner supplies text and
 * receives either a decoded mapping or a typed parse failure.
 */

export const FRONTMATTER_ERROR_CODES = {
  UNTERMINATED: 'FRONTMATTER_UNTERMINATED',
  INVALID_YAML: 'FRONTMATTER_INVALID_YAML',
  NOT_A_MAPPING: 'FRONTMATTER_NOT_A_MAPPING',
} as const;
export type FrontmatterErrorCode =
  (typeof FRONTMATTER_ERROR_CODES)[keyof typeof FRONTMATTER_ERROR_CODES];

/** Typed malformed-frontmatter failure. Messages never include file content. */
export class FrontmatterError extends Error {
  readonly code: FrontmatterErrorCode;

  constructor(code: FrontmatterErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
  }
}

/** A parsed `SKILL.md`, split into frontmatter data and the untouched body. */
export interface SkillFrontmatter {
  /** True only when a delimited `---` block was present. */
  present: boolean;
  /** Decoded YAML mapping; always an object, possibly empty. */
  data: Record<string, unknown>;
  /** Everything after the closing delimiter (or the whole file when absent). */
  body: string;
}

const OPENING_DELIMITER = /^---[ \t]*(\r?\n|$)/;
const CLOSING_DELIMITER = /^---[ \t]*$/m;

/**
 * Split and decode the YAML frontmatter block.
 *
 * - A file without an opening `---` line is a valid skill whose metadata is
 *   simply absent; `present` is false.
 * - An opening delimiter without a closing delimiter is malformed.
 * - YAML syntax errors, duplicate keys, and non-mapping documents are
 *   malformed. The caller converts them into a catalog warning and falls back
 *   to the directory name rather than dropping the package.
 */
export function parseSkillFrontmatter(source: string): SkillFrontmatter {
  const text = stripByteOrderMark(source);
  const opening = OPENING_DELIMITER.exec(text);
  if (!opening) {
    return { present: false, data: {}, body: text };
  }

  const remainder = text.slice(opening[0].length);
  const closing = CLOSING_DELIMITER.exec(remainder);
  if (!closing) {
    throw new FrontmatterError(
      FRONTMATTER_ERROR_CODES.UNTERMINATED,
      'The SKILL.md frontmatter is missing its closing "---" delimiter.',
    );
  }

  const yamlText = remainder.slice(0, closing.index);
  const body = remainder.slice(closing.index + closing[0].length).replace(/^\r?\n/, '');

  if (yamlText.trim() === '') {
    return { present: true, data: {}, body };
  }

  let decoded: unknown;
  try {
    decoded = parse(yamlText) as unknown;
  } catch (error) {
    throw new FrontmatterError(
      FRONTMATTER_ERROR_CODES.INVALID_YAML,
      'The SKILL.md frontmatter is not valid YAML.',
      { cause: error },
    );
  }

  if (decoded === null || decoded === undefined) {
    return { present: true, data: {}, body };
  }
  if (!isPlainMapping(decoded)) {
    throw new FrontmatterError(
      FRONTMATTER_ERROR_CODES.NOT_A_MAPPING,
      'The SKILL.md frontmatter must be a YAML mapping.',
    );
  }

  return { present: true, data: decoded, body };
}

/**
 * Read a scalar metadata field without coercion or inference.
 *
 * Only an own string property counts. Numbers, booleans, arrays, and nested
 * objects are ignored, and surrounding whitespace is trimmed. A missing or
 * blank value returns `undefined` so callers can apply their own documented
 * fallback.
 */
export function frontmatterString(
  data: Record<string, unknown>,
  key: string,
): string | undefined {
  if (!Object.hasOwn(data, key)) {
    return undefined;
  }
  const value = data[key];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function stripByteOrderMark(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function isPlainMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
