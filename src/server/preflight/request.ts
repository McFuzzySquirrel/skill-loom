import { z } from 'zod';
import { HARNESS_IDS } from '../config/schema.js';
import { PREFLIGHT_RUN_MODES } from './engine.js';

export const preflightRequestBodySchema = z.strictObject({
  chainId: z.string().min(1).max(64),
  harness: z.enum(HARNESS_IDS).optional(),
  mode: z.enum(PREFLIGHT_RUN_MODES).optional(),
  inputs: z.record(z.string(), z.string().nullable()).optional(),
  acknowledgements: z.union([
    z.array(z.string().min(1)),
    z.record(z.string(), z.boolean()),
  ]).optional(),
});
