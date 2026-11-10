import { z } from 'zod';
import {
  adoptReviewedLegacyRun, clearReviewedProjectClaim, enableReviewedProjectProtocol,
} from '../../shared/project-coordination.js';
import { abandonClaimedManagedRun, reconcileClaimedManagedRun } from '../runs/project-reconciliation.js';
import { RunOwnerError, type RunOwner } from '../runs/owner.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const runId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const confirmations = {
  stoppedConfirmed: z.literal(true),
  oldClientsStoppedConfirmed: z.literal(true),
};

export const coordinationActionSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('enable'), reviewDigest: digest, ...confirmations,
  }),
  z.strictObject({
    action: z.literal('adopt'), reviewDigest: digest, kind: z.enum(['managed', 'portable']), runId,
    ...confirmations,
  }),
  z.strictObject({ action: z.literal('interrupt'), reviewDigest: digest, runId, ...confirmations }),
  z.strictObject({
    action: z.literal('abandon'), reviewDigest: digest, runId, abandonConfirmed: z.literal(true),
    ...confirmations,
  }),
  z.strictObject({ action: z.literal('clear'), reviewDigest: digest, ...confirmations }),
]);

export type CoordinationAction = z.infer<typeof coordinationActionSchema>;

export class ProjectCoordinationActionError extends Error {
  constructor(readonly code: 'PROJECT_COORDINATION_BUSY', message: string) {
    super(message);
    this.name = 'ProjectCoordinationActionError';
  }
}

/** Reconciliation is exclusive with local run mutations and refuses owned live processes. */
export async function executeCoordinationAction(
  projectPath: string,
  configDirectory: string,
  runOwner: RunOwner,
  request: CoordinationAction,
) {
  try {
    return await runOwner.withExclusiveMutation(async () => {
      const orchestrator = await runOwner.get();
      if (orchestrator.hasLiveProject(projectPath)) {
        throw new ProjectCoordinationActionError('PROJECT_COORDINATION_BUSY', 'This service still owns a run in the project; stop it before reconciliation.');
      }
      switch (request.action) {
        case 'enable':
          await enableReviewedProjectProtocol(projectPath, request.reviewDigest, request.oldClientsStoppedConfirmed);
          break;
        case 'adopt':
          await adoptReviewedLegacyRun(projectPath, { kind: request.kind, runId: request.runId },
            request.reviewDigest, request.stoppedConfirmed, request.oldClientsStoppedConfirmed);
          break;
        case 'interrupt':
          await reconcileClaimedManagedRun({ projectPath, configDirectory, ...request });
          break;
        case 'abandon':
          await abandonClaimedManagedRun({ projectPath, configDirectory, ...request });
          break;
        case 'clear':
          await clearReviewedProjectClaim(projectPath, request.reviewDigest,
            request.stoppedConfirmed, request.oldClientsStoppedConfirmed);
          break;
      }
      return { applied: true as const };
    });
  } catch (error) {
    if (error instanceof RunOwnerError) {
      throw new ProjectCoordinationActionError('PROJECT_COORDINATION_BUSY', 'A run operation is in progress; review again after it finishes.');
    }
    throw error;
  }
}
