import { ProjectClaimError, withProjectClaimTransaction } from '../../shared/project-claim.js';
import {
  ProjectCoordinationError, reviewProjectCoordinationTransaction,
} from '../../shared/project-coordination.js';
import { isActiveRunStatus, markRunInterrupted, validateRun, type Run } from './model.js';
import { createRunStore } from './store.js';

/**
 * Mark a claimed managed run interrupted only after explicit review and
 * confirmation that prior work and nonparticipating clients have stopped.
 * The durable claim remains held throughout and after this operation.
 * The caller must own the profile associated with configDirectory; the project
 * claim transaction does not serialize the profile's active-run pointer.
 */
export async function reconcileClaimedManagedRun(options: {
  projectPath: string;
  configDirectory: string;
  runId: string;
  reviewDigest: string;
  stoppedConfirmed: boolean;
  oldClientsStoppedConfirmed: boolean;
  now?: Date;
}): Promise<Run> {
  if (!options.stoppedConfirmed || !options.oldClientsStoppedConfirmed) {
    throw new ProjectCoordinationError('PROJECT_CONFIRMATION_REQUIRED');
  }
  return withProjectClaimTransaction(options.projectPath, async (tx) => {
    const review = await reviewProjectCoordinationTransaction(tx);
    if (review.protocol === null) throw new ProjectCoordinationError('PROJECT_PROTOCOL_NOT_ENABLED');
    if (review.reviewDigest !== options.reviewDigest) throw new ProjectCoordinationError('PROJECT_REVIEW_STALE');
    if (review.claim?.kind !== 'managed' || review.claim.runId !== options.runId) {
      throw new ProjectClaimError('PROJECT_CLAIM_MISMATCH', 'The project claim does not match this run.');
    }
    const unresolved = review.records.filter((record) => record.unresolved);
    if (unresolved.length !== 1 || unresolved[0]?.kind !== 'managed' || unresolved[0].runId !== options.runId) {
      throw new ProjectCoordinationError('PROJECT_RECONCILIATION_REQUIRED', unresolved);
    }
    const store = createRunStore({ projectPath: tx.identity.projectPath, configDirectory: options.configDirectory });
    const current = await store.read(options.runId);
    if (!isActiveRunStatus(current.status) && current.status !== 'interrupted') {
      throw new ProjectCoordinationError('PROJECT_RECONCILIATION_REQUIRED', unresolved);
    }
    const interrupted = isActiveRunStatus(current.status)
      ? markRunInterrupted(current, options.now ?? new Date(), 'RECONCILED_AFTER_CONFIRMATION')
      : current;
    if (interrupted !== current) await store.update(interrupted, { syncActiveRun: false });
    const pointer = await store.getActiveRun();
    if (pointer?.projectPath === tx.identity.projectPath && pointer.runId === options.runId) {
      await store.releaseActiveRun(options.runId);
    }
    return interrupted;
  });
}

/**
 * Abandon a previously interrupted run without replaying it. This records the
 * operator's decision but leaves the claim in place for a separate review and
 * release. The caller must own the profile associated with configDirectory.
 */
export async function abandonClaimedManagedRun(options: {
  projectPath: string;
  configDirectory: string;
  runId: string;
  reviewDigest: string;
  stoppedConfirmed: boolean;
  oldClientsStoppedConfirmed: boolean;
  abandonConfirmed: boolean;
  now?: Date;
}): Promise<Run> {
  if (!options.stoppedConfirmed || !options.oldClientsStoppedConfirmed || !options.abandonConfirmed) {
    throw new ProjectCoordinationError('PROJECT_CONFIRMATION_REQUIRED');
  }
  return withProjectClaimTransaction(options.projectPath, async (tx) => {
    const review = await reviewProjectCoordinationTransaction(tx);
    if (review.protocol === null) throw new ProjectCoordinationError('PROJECT_PROTOCOL_NOT_ENABLED');
    if (review.reviewDigest !== options.reviewDigest) throw new ProjectCoordinationError('PROJECT_REVIEW_STALE');
    if (review.claim?.kind !== 'managed' || review.claim.runId !== options.runId) {
      throw new ProjectClaimError('PROJECT_CLAIM_MISMATCH', 'The project claim does not match this run.');
    }
    const unresolved = review.records.filter((record) => record.unresolved);
    const target = review.records.find((record) => record.kind === 'managed' && record.runId === options.runId);
    const canAbandon = unresolved.length === 1 && unresolved[0]?.kind === 'managed' &&
      unresolved[0].runId === options.runId && unresolved[0].status === 'interrupted';
    const alreadyAborted = unresolved.length === 0 && target?.status === 'aborted';
    if (!canAbandon && !alreadyAborted) {
      throw new ProjectCoordinationError('PROJECT_RECONCILIATION_REQUIRED', unresolved);
    }
    const store = createRunStore({ projectPath: tx.identity.projectPath, configDirectory: options.configDirectory });
    const current = await store.read(options.runId);
    if ((canAbandon && current.status !== 'interrupted') ||
        (alreadyAborted && current.status !== 'aborted') ||
        current.steps.some((step) => step.status === 'running')) {
      throw new ProjectCoordinationError('PROJECT_RECONCILIATION_REQUIRED', unresolved);
    }
    const pointer = await store.getActiveRun();
    const timestamp = (options.now ?? new Date()).toISOString();
    const abandoned = current.status === 'aborted' ? current : validateRun({
      ...current, status: 'aborted', finishedAt: timestamp, updatedAt: timestamp,
      reason: 'ABANDONED_AFTER_CONFIRMATION',
    });
    if (abandoned !== current) await store.update(abandoned, { syncActiveRun: false });
    if (pointer?.projectPath === tx.identity.projectPath && pointer.runId === options.runId) {
      await store.releaseActiveRun(options.runId);
    }
    return abandoned;
  });
}
