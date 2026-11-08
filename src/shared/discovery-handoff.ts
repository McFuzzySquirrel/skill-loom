import { z } from 'zod';

export const MAX_HANDOFF_BYTES = 20 * 1024 * 1024;
export const MAX_HANDOFF_FILES = 2_000;
export const MAX_HANDOFF_PACKAGES = 100;
export const MAX_HANDOFF_JSON_BYTES = 30 * 1024 * 1024;

const handoffFileSchema = z.strictObject({
  path: z.string().min(1).max(512),
  content: z.string().max(Math.ceil(MAX_HANDOFF_BYTES / 3) * 4),
  executable: z.boolean(),
});

export const DiscoveryHandoffSchema = z.strictObject({
  format: z.literal('skill-loom-discovery-handoff'),
  version: z.literal(1),
  goal: z.string().trim().min(1).max(1_000),
  harness: z.enum(['opencode', 'copilot']),
  createdAt: z.string().datetime(),
  candidates: z.array(z.strictObject({
    sourceId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    revision: z.string().regex(/^[a-f0-9]{40,64}$/),
    repositoryPath: z.string().min(1).max(4_096),
    name: z.string().min(1).max(128),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    files: z.array(handoffFileSchema).min(1).max(MAX_HANDOFF_FILES),
  })).min(1).max(MAX_HANDOFF_PACKAGES),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});

export type DiscoveryHandoff = z.infer<typeof DiscoveryHandoffSchema>;
export type DiscoveryHandoffCandidate = DiscoveryHandoff['candidates'][number];
export type DiscoveryHandoffFile = DiscoveryHandoffCandidate['files'][number];
