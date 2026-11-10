import { z } from 'zod';
import type { ChainBundle } from '../shared/bundles.js';
import { parseBundle } from './bundle.js';

export const RUN_VERSION = 1;
export const MAX_SUMMARY_BYTES = 8 * 1024;
export const MAX_PORTABLE_STEPS = 1_000;
export const MAX_ATTEMPTS_PER_STEP = 50;
export const RUN_ID_PATTERN = /^[a-f0-9-]{36}$/;
export const SafeInputSchema = z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), z.string().max(16_384));
const AttemptSchema = z.strictObject({
  number: z.number().int().positive(),
  status: z.enum(['running', 'done', 'failed', 'skipped', 'interrupted']),
  startedAt: z.iso.datetime({ offset: true }),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
  summary: z.string().max(MAX_SUMMARY_BYTES).nullable(),
  reason: z.string().max(2_000).nullable(),
});
export const RunSchema = z.strictObject({
  version: z.literal(RUN_VERSION),
  id: z.string().regex(RUN_ID_PATTERN),
  revision: z.number().int().positive(),
  projectPath: z.string().min(1),
  bundleFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  bundle: z.custom<ChainBundle>((value) => {
    try {
      parseBundle(value);
      return true;
    } catch {
      return false;
    }
  }),
  actualHost: z.enum(['copilot', 'opencode', 'other']),
  hostSwitchConfirmed: z.boolean(),
  progression: z.enum(['supervised', 'agent']),
  progressionConfirmed: z.boolean(),
  sessionDecision: z.strictObject({
    requested: z.enum(['shared', 'fresh', 'fork']),
    mechanism: z.enum(['current-conversation', 'isolated-worker', 'native-fork', 'handoff']),
    description: z.string().trim().min(1).max(500),
    confirmed: z.boolean(),
  }),
  resolvedInputs: SafeInputSchema,
  skillFingerprintVersion: z.literal(2).optional(),
  installedSkills: z.array(z.strictObject({
    name: z.string(),
    directory: z.string(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    reused: z.boolean(),
  })),
  status: z.enum(['ready', 'running', 'paused', 'failed', 'completed', 'aborted', 'interrupted']),
  currentStepIndex: z.number().int().min(0),
  resumeRequired: z.boolean(),
  steps: z.array(z.strictObject({
    id: z.string().min(1),
    index: z.number().int().min(0),
    attempts: z.array(AttemptSchema).max(MAX_ATTEMPTS_PER_STEP),
  })).min(1).max(MAX_PORTABLE_STEPS),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type PortableRun = z.infer<typeof RunSchema>;

export function parsePortableRunDocument(value: unknown, project: string, id: string): PortableRun | null {
  const parsed = RunSchema.safeParse(value);
  if (!parsed.success || parsed.data.projectPath !== project || parsed.data.id !== id) return null;
  const bundle = parseBundle(parsed.data.bundle);
  const fingerprint = createHash('sha256').update(JSON.stringify(bundle)).digest('hex');
  if (fingerprint !== parsed.data.bundleFingerprint ||
      bundle.chain.steps.length !== parsed.data.steps.length ||
      bundle.chain.steps.some((step, index) => parsed.data.steps[index]?.id !== step.id)) return null;
  return parsed.data;
}
import { createHash } from 'node:crypto';
