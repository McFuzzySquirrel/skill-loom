import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ConfigStore } from '../config/store.js';
import type { ProjectRegistry } from '../projects/registry.js';
import { TestWorkspaceError, TEST_WORKSPACE_ERROR_CODES } from './test-workspaces.js';
import { inspectTestWorkspace } from './workspace-inspect.js';

export const workspaceEvaluationSchema = z.strictObject({
  workspaceId: z.uuid(),
  checks: z.array(z.strictObject({
    path: z.string().min(1).max(4096),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    contains: z.string().min(1).max(4096).optional(),
    json: z.strictObject({
      pointer: z.string().max(4096).regex(/^(?:\/(?:[^~/]|~[01])*)*$/),
      equals: z.union([
        z.string().max(4096),
        z.number().finite().refine((value) => !Number.isInteger(value) || Number.isSafeInteger(value)),
        z.boolean(),
        z.null(),
      ]),
    }).optional(),
  })).min(1).max(20),
});

const UNSAFE_JSON_NUMBER = Symbol('unsafe JSON number');

function normalizedDecimal(source: string): string | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source);
  if (match === null) return null;
  const fraction = match[3] ?? '';
  const digits = `${match[2]}${fraction}`.replace(/^0+/, '');
  if (digits === '') return '0';
  const exponent = Number(match[4] ?? '0');
  if (!Number.isSafeInteger(exponent)) return null;
  const significant = digits.replace(/0+$/, '');
  const scale = exponent - fraction.length + digits.length - significant.length;
  if (!Number.isSafeInteger(scale)) return null;
  return `${match[1]}${significant}e${String(scale)}`;
}

function parseEvaluationJson(text: string): unknown {
  return JSON.parse(text, (_key: string, value: unknown, context?: { source?: string }) => {
    if (typeof value !== 'number') return value;
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)) ||
        context?.source === undefined ||
        normalizedDecimal(context.source) !== normalizedDecimal(String(value))) {
      return UNSAFE_JSON_NUMBER;
    }
    return value;
  }) as unknown;
}

function resolveJsonPointer(value: unknown, pointer: string): { found: boolean; value?: unknown } {
  let current = value;
  for (const encoded of pointer === '' ? [] : pointer.slice(1).split('/')) {
    const key = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(key)) return { found: false };
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index >= current.length) return { found: false };
      current = current[index] as unknown;
    } else if (typeof current === 'object' && current !== null && Object.hasOwn(current, key)) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return { found: false };
    }
  }
  return { found: true, value: current };
}

export async function evaluateTestWorkspace(
  options: { configStore: ConfigStore; projectRegistry: ProjectRegistry },
  request: z.infer<typeof workspaceEvaluationSchema>,
) {
  const checks = [];
  for (const check of request.checks) {
    let artifact: Awaited<ReturnType<typeof inspectTestWorkspace>>;
    try {
      artifact = await inspectTestWorkspace(options, {
        workspaceId: request.workspaceId, path: check.path, offset: 0, limit: 1,
      });
    } catch (error) {
      if (!(error instanceof TestWorkspaceError) || error.code !== TEST_WORKSPACE_ERROR_CODES.ARTIFACT_NOT_FOUND) throw error;
      checks.push({ path: check.path, passed: false, outcome: 'missing' as const });
      continue;
    }
    if (artifact.type !== 'file') {
      checks.push({ path: check.path, passed: false, outcome: 'not-file' as const });
      continue;
    }
    const content = Buffer.from(artifact.content, 'base64');
    const sha256 = createHash('sha256').update(content).digest('hex');
    const hashMatched = check.sha256 === undefined || sha256 === check.sha256;
    let textMatched: boolean | undefined;
    let jsonMatched: boolean | undefined;
    let invalidUtf8 = false;
    let invalidJson = false;
    let jsonMissing = false;
    let unsafeJsonNumber = false;
    let text: string | undefined;
    if (check.contains !== undefined || check.json !== undefined) {
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(content);
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        invalidUtf8 = true;
      }
    }
    if (text !== undefined && check.contains !== undefined) textMatched = text.includes(check.contains);
    if (text !== undefined && check.json !== undefined) {
      let parsed: unknown;
      try {
        parsed = parseEvaluationJson(text);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        invalidJson = true;
      }
      if (!invalidJson) {
        const selected = resolveJsonPointer(parsed, check.json.pointer);
        jsonMissing = !selected.found;
        unsafeJsonNumber = selected.found && selected.value === UNSAFE_JSON_NUMBER;
        jsonMatched = selected.found && !unsafeJsonNumber && selected.value === check.json.equals;
      }
    }
    const passed = hashMatched && (check.contains === undefined || textMatched === true) &&
      (check.json === undefined || jsonMatched === true);
    const outcome = !hashMatched ? 'hash-mismatch' as const
      : invalidUtf8 ? 'invalid-utf8' as const
      : textMatched === false ? 'text-mismatch' as const
      : invalidJson ? 'invalid-json' as const
      : jsonMissing ? 'json-pointer-missing' as const
      : unsafeJsonNumber ? 'json-number-unsafe' as const
      : jsonMatched === false ? 'json-mismatch' as const
      : 'matched' as const;
    checks.push({
      path: check.path, passed, outcome,
      bytes: artifact.bytes, sha256,
      ...(check.sha256 === undefined ? {} : { expectedSha256: check.sha256 }),
      ...(check.contains === undefined ? {} : { textMatched: textMatched ?? false }),
      ...(check.json === undefined ? {} : { jsonMatched: jsonMatched ?? false }),
    });
  }
  return { workspaceId: request.workspaceId, passed: checks.every((check) => check.passed), checks };
}
