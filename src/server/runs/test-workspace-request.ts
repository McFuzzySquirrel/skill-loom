import { z } from 'zod';
import { isSafeChainId } from '../chains/store.js';
import { isProjectId } from '../projects/registry.js';

export const testWorkspaceCreateSchema = z.union([
  z.strictObject({
    sourceProjectId: z.string().min(1).max(128).refine(isProjectId),
    sourceChainId: z.string().min(1).max(64).refine(isSafeChainId),
  }),
  z.strictObject({
    sourceDraftId: z.string().min(1).max(64).refine(isSafeChainId),
  }),
]);
