/**
 * Deterministic extraction of optional structured skill metadata.
 *
 * The extractor reads only decoded frontmatter. It never changes package
 * contents, executes a skill, or guesses a value from prose. Every accepted
 * value is bounded and deduplicated, and an invalid field is reported as an
 * issue instead of failing the package.
 */

export const SKILL_METADATA_LIMITS = {
  tags: 20,
  tools: 50,
  inputs: 50,
  outputs: 50,
  valueChars: 120,
  whenToUseChars: 2_000,
} as const;

export interface SkillMetadata {
  tags: string[];
  tools: string[];
  inputs: string[];
  outputs: string[];
  whenToUse?: string;
}

export interface SkillMetadataResult {
  metadata: SkillMetadata;
  /** Stable field names that were present but invalid, bounded, or unreadable. */
  issues: string[];
}

type ListKind = 'tags' | 'tools' | 'inputs' | 'outputs';

interface ListOptions {
  kind: ListKind;
  keys: readonly string[];
  /** `words` splits on whitespace as well as commas; the others split on commas and newlines. */
  split: 'words' | 'lines';
  limit: number;
  /** Inputs and outputs may be `{name}` objects; tags and tools may not. */
  allowObjects: boolean;
}

const LIST_OPTIONS: Record<ListKind, ListOptions> = {
  tags: {
    kind: 'tags', keys: ['tags'], split: 'lines', limit: SKILL_METADATA_LIMITS.tags, allowObjects: false,
  },
  tools: {
    kind: 'tools',
    keys: ['allowed-tools', 'allowed_tools', 'tools'],
    split: 'words',
    limit: SKILL_METADATA_LIMITS.tools,
    allowObjects: false,
  },
  inputs: {
    kind: 'inputs', keys: ['inputs'], split: 'lines', limit: SKILL_METADATA_LIMITS.inputs, allowObjects: true,
  },
  outputs: {
    kind: 'outputs', keys: ['outputs'], split: 'lines', limit: SKILL_METADATA_LIMITS.outputs, allowObjects: true,
  },
};

const WHEN_TO_USE_KEYS = ['when_to_use', 'when-to-use', 'whenToUse'] as const;
const OBJECT_NAME_KEYS = ['name', 'id', 'label', 'path'] as const;

/**
 * Extract tags, tools, inputs, outputs, and `when_to_use` from frontmatter.
 *
 * Top-level fields win over the same fields under a `metadata` mapping, but
 * values from both places are merged for arrays. A field with an invalid shape
 * is ignored and recorded in `issues`; it never rejects the package.
 */
export function extractSkillMetadata(data: Record<string, unknown>): SkillMetadataResult {
  const issues = new Set<string>();
  const containers = [data];
  const nested = data.metadata;
  if (isPlainMapping(nested)) containers.push(nested);

  const tags = readList(containers, LIST_OPTIONS.tags, issues);
  const tools = readList(containers, LIST_OPTIONS.tools, issues);
  const inputs = readList(containers, LIST_OPTIONS.inputs, issues);
  const outputs = readList(containers, LIST_OPTIONS.outputs, issues);
  const whenToUse = readWhenToUse(containers, issues);
  return {
    metadata: {
      tags: tags.values,
      tools: tools.values,
      inputs: inputs.values,
      outputs: outputs.values,
      ...(whenToUse === undefined ? {} : { whenToUse }),
    },
    issues: [...issues].sort(),
  };
}

function readList(
  containers: readonly Record<string, unknown>[],
  options: ListOptions,
  issues: Set<string>,
): { values: string[] } {
  const values: string[] = [];
  const seen = new Set<string>();
  let truncated = false;

  const add = (raw: string): void => {
    const normalized = normalizeValue(raw);
    if (normalized === '') return;
    if (normalized.length > SKILL_METADATA_LIMITS.valueChars) issues.add(options.kind);
    const value = normalized.slice(0, SKILL_METADATA_LIMITS.valueChars);
    const key = value.toLocaleLowerCase('en-US');
    if (seen.has(key)) return;
    if (values.length >= options.limit) {
      truncated = true;
      return;
    }
    seen.add(key);
    values.push(value);
  };

  for (const container of containers) {
    for (const key of options.keys) {
      if (!Object.hasOwn(container, key)) continue;
      const raw = container[key];
      if (raw === undefined || raw === null) continue;
      if (typeof raw === 'string') {
        for (const item of splitValue(raw, options.split)) add(item);
        continue;
      }
      if (!Array.isArray(raw)) {
        issues.add(options.kind);
        continue;
      }
      for (const item of raw) {
        if (typeof item === 'string') {
          for (const value of splitValue(item, options.split)) add(value);
          continue;
        }
        if (isPlainMapping(item) && options.allowObjects) {
          const name = objectName(item);
          if (name === undefined) {
            issues.add(options.kind);
            continue;
          }
          add(name);
          continue;
        }
        issues.add(options.kind);
      }
    }
  }
  if (truncated) issues.add(options.kind);
  // An explicitly empty list is valid and means "declared but empty".
  return { values };
}

function readWhenToUse(
  containers: readonly Record<string, unknown>[],
  issues: Set<string>,
): string | undefined {
  for (const container of containers) {
    for (const key of WHEN_TO_USE_KEYS) {
      if (!Object.hasOwn(container, key)) continue;
      const raw = container[key];
      if (raw === undefined || raw === null) continue;
      if (typeof raw !== 'string') {
        issues.add('when_to_use');
        continue;
      }
      const value = normalizeValue(raw);
      if (value === '') continue;
      if (value.length > SKILL_METADATA_LIMITS.whenToUseChars) {
        issues.add('when_to_use');
        return value.slice(0, SKILL_METADATA_LIMITS.whenToUseChars);
      }
      return value;
    }
  }
  return undefined;
}

function objectName(value: Record<string, unknown>): string | undefined {
  for (const key of OBJECT_NAME_KEYS) {
    if (Object.hasOwn(value, key) && typeof value[key] === 'string') {
      const name = normalizeValue(value[key]);
      if (name !== '') return name;
    }
  }
  return undefined;
}

function splitValue(value: string, split: 'words' | 'lines'): string[] {
  const pattern = split === 'words' ? /[\s,]+/u : /[,\n]+/u;
  return value.split(pattern);
}

function normalizeValue(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function isPlainMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
