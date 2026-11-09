import { createHash } from 'node:crypto';
import {
  ProjectClaimError, withProjectClaimTransaction, type ProjectClaim, type ProjectClaimTransaction,
} from './project-claim.js';
import { scanProjectRunRecords, type ProjectRunRecord } from './project-run-records.js';

export class ProjectCoordinationError extends Error {
  constructor(
    readonly code: 'PROJECT_RECONCILIATION_REQUIRED' | 'PROJECT_REVIEW_STALE' |
      'PROJECT_CONFIRMATION_REQUIRED' | 'PROJECT_PROTOCOL_NOT_ENABLED',
    readonly records: readonly ProjectRunRecord[] = [],
  ) {
    super(code === 'PROJECT_PROTOCOL_NOT_ENABLED'
      ? 'Review and enable coordinated project execution before starting a run.'
      : code === 'PROJECT_REVIEW_STALE'
      ? 'Project coordination evidence changed; review it again.'
      : code === 'PROJECT_CONFIRMATION_REQUIRED'
        ? 'Confirm that prior work, processes, and older clients have stopped.'
        : 'Existing project runs have unresolved ownership and require explicit reconciliation.');
    this.name = 'ProjectCoordinationError';
  }
}

export interface ProjectCoordinationReview {
  identity: Pick<ProjectClaim, 'projectPath' | 'projectDevice' | 'projectInode'>;
  protocol: ReturnType<ProjectClaimTransaction['protocol']>;
  claim: ProjectClaim | null;
  records: ProjectRunRecord[];
  reviewDigest: string;
}

export async function reviewProjectCoordinationTransaction(
  tx: ProjectClaimTransaction,
): Promise<ProjectCoordinationReview> {
  const identity = tx.identity;
  const protocol = tx.protocol();
  const claim = tx.read();
  const records = await scanProjectRunRecords(identity.projectPath);
  const reviewDigest = createHash('sha256').update(JSON.stringify({ identity, protocol, claim, records })).digest('hex');
  return { identity, protocol, claim, records, reviewDigest };
}

/** Enable the protocol only after reviewing the project and stopping older clients. */
export async function enableReviewedProjectProtocol(
  projectPath: string,
  reviewDigest: string,
  oldClientsStoppedConfirmed: boolean,
  now: Date = new Date(),
): Promise<void> {
  if (!oldClientsStoppedConfirmed) throw new ProjectCoordinationError('PROJECT_CONFIRMATION_REQUIRED');
  await withProjectClaimTransaction(projectPath, async (tx) => {
    const review = await reviewProjectCoordinationTransaction(tx);
    if (review.reviewDigest !== reviewDigest) throw new ProjectCoordinationError('PROJECT_REVIEW_STALE');
    tx.enableProtocol(now.toISOString());
  });
}

/** Review the exact project claim and bounded run-record evidence. */
export async function reviewProjectCoordination(projectPath: string): Promise<ProjectCoordinationReview> {
  return withProjectClaimTransaction(projectPath, reviewProjectCoordinationTransaction);
}

/**
 * Clear a reviewed claim only after an operator confirms prior work has stopped
 * and every record is already terminal. Unresolved records need their own
 * explicit reconciliation and cannot be cleared by this operation.
 */
export async function clearReviewedProjectClaim(
  projectPath: string,
  reviewDigest: string,
  stoppedConfirmed: boolean,
  oldClientsStoppedConfirmed: boolean,
): Promise<void> {
  if (!stoppedConfirmed || !oldClientsStoppedConfirmed) {
    throw new ProjectCoordinationError('PROJECT_CONFIRMATION_REQUIRED');
  }
  await withProjectClaimTransaction(projectPath, async (tx) => {
    const review = await reviewProjectCoordinationTransaction(tx);
    if (review.protocol === null) throw new ProjectCoordinationError('PROJECT_PROTOCOL_NOT_ENABLED');
    if (review.reviewDigest !== reviewDigest) throw new ProjectCoordinationError('PROJECT_REVIEW_STALE');
    const unresolved = review.records.filter((record) => record.unresolved);
    if (unresolved.length > 0) throw new ProjectCoordinationError('PROJECT_RECONCILIATION_REQUIRED', unresolved);
    if (review.claim === null) {
      throw new ProjectClaimError('PROJECT_CLAIM_MISMATCH', 'The project has no claim to clear.');
    }
    tx.release(review.claim);
  });
}

/**
 * Adopt exactly one reviewed legacy run after the operator confirms that its
 * previous work and nonparticipating clients have stopped. Adoption reserves
 * the project; it does not change, resume, or replay the run record.
 */
export async function adoptReviewedLegacyRun(
  projectPath: string,
  expected: Pick<ProjectClaim, 'kind' | 'runId'>,
  reviewDigest: string,
  stoppedConfirmed: boolean,
  oldClientsStoppedConfirmed: boolean,
  now: Date = new Date(),
): Promise<ProjectClaim> {
  if (!stoppedConfirmed || !oldClientsStoppedConfirmed) {
    throw new ProjectCoordinationError('PROJECT_CONFIRMATION_REQUIRED');
  }
  return withProjectClaimTransaction(projectPath, async (tx) => {
    const review = await reviewProjectCoordinationTransaction(tx);
    if (review.protocol === null) throw new ProjectCoordinationError('PROJECT_PROTOCOL_NOT_ENABLED');
    if (review.reviewDigest !== reviewDigest) throw new ProjectCoordinationError('PROJECT_REVIEW_STALE');
    if (review.claim !== null) {
      throw new ProjectClaimError('PROJECT_CLAIM_CONFLICT', 'Another operation already claims this project.');
    }
    const unresolved = review.records.filter((record) => record.unresolved);
    if (unresolved.length !== 1 || unresolved[0]?.kind !== expected.kind ||
        unresolved[0].runId !== expected.runId) {
      throw new ProjectCoordinationError('PROJECT_RECONCILIATION_REQUIRED', unresolved);
    }
    const claim: ProjectClaim = {
      version: 1,
      ...tx.identity,
      kind: expected.kind,
      runId: expected.runId,
      createdAt: now.toISOString(),
    };
    tx.acquire(claim);
    return claim;
  });
}

/**
 * Check legacy records and establish a durable claim before any run or package
 * installation side effect. A failed operation must not infer that a claim is
 * safe to release merely from a missing record.
 */
export async function acquireProjectRunClaim(
  projectPath: string,
  kind: ProjectClaim['kind'],
  runId: string,
  now: Date = new Date(),
): Promise<ProjectClaim> {
  return withProjectClaimTransaction(projectPath, async (tx) => {
    if (tx.protocol() === null) throw new ProjectCoordinationError('PROJECT_PROTOCOL_NOT_ENABLED');
    if (tx.read() !== null) {
      throw new ProjectClaimError('PROJECT_CLAIM_CONFLICT', 'Another operation already claims this project.');
    }
    const records = await scanProjectRunRecords(tx.identity.projectPath);
    const unresolved = records.filter((record) => record.unresolved);
    if (unresolved.length > 0) throw new ProjectCoordinationError('PROJECT_RECONCILIATION_REQUIRED', unresolved);
    const claim: ProjectClaim = {
      version: 1,
      ...tx.identity,
      kind,
      runId,
      createdAt: now.toISOString(),
    };
    tx.acquire(claim);
    return claim;
  });
}

/** Require the already committed claim before changing a run or dispatching work. */
export async function requireProjectRunClaim(
  projectPath: string,
  expected: Pick<ProjectClaim, 'kind' | 'runId'>,
): Promise<ProjectClaim> {
  return withClaimedProjectRun(projectPath, expected, async (claim) => claim);
}

/**
 * Serialize a short run mutation or dispatch against claim reconciliation.
 * The callback must not wait for the full lifetime of a harness or host task;
 * the committed claim, rather than the SQLite lock, protects that lifetime.
 */
export async function withClaimedProjectRun<T>(
  projectPath: string,
  expected: Pick<ProjectClaim, 'kind' | 'runId'>,
  task: (claim: ProjectClaim) => Promise<T>,
  waitForLock = false,
): Promise<T> {
  return withProjectClaimTransaction(projectPath, async (tx) => {
    if (tx.protocol() === null) throw new ProjectCoordinationError('PROJECT_PROTOCOL_NOT_ENABLED');
    const claim = tx.read();
    if (claim === null || claim.kind !== expected.kind || claim.runId !== expected.runId) {
      throw new ProjectClaimError('PROJECT_CLAIM_MISMATCH', 'The project claim does not match this run.');
    }
    return task(claim);
  }, waitForLock);
}

/**
 * Start a run under the project transaction. An enabled protocol commits its
 * claim before any callback side effect; legacy mode holds the transaction
 * during the callback so protocol enablement cannot race that start.
 */
export async function beginCoordinatedProjectRun<T>(
  projectPath: string,
  kind: ProjectClaim['kind'],
  runId: string,
  task: () => Promise<T>,
  now: Date = new Date(),
): Promise<T> {
  const result = await withProjectClaimTransaction(projectPath, async (tx) => {
    if (tx.read() !== null) {
      throw new ProjectClaimError('PROJECT_CLAIM_CONFLICT', 'Another operation already claims this project.');
    }
    if (tx.protocol() === null) {
      return { kind: 'legacy' as const, value: await task() };
    }
    const records = await scanProjectRunRecords(tx.identity.projectPath);
    const unresolved = records.filter((record) => record.unresolved);
    if (unresolved.length > 0) throw new ProjectCoordinationError('PROJECT_RECONCILIATION_REQUIRED', unresolved);
    tx.acquire({ version: 1, ...tx.identity, kind, runId, createdAt: now.toISOString() });
    return { kind: 'claimed' as const };
  });
  if (result.kind === 'legacy') return result.value;
  return withClaimedProjectRun(projectPath, { kind, runId }, task, true);
}

/**
 * Serialize a run mutation with protocol enablement and claim reconciliation.
 * Legacy mutations are allowed only while no durable claim exists.
 */
export async function withCoordinatedProjectRun<T>(
  projectPath: string,
  expected: Pick<ProjectClaim, 'kind' | 'runId'>,
  task: (claim: ProjectClaim | null) => Promise<T>,
): Promise<T> {
  return withProjectClaimTransaction(projectPath, async (tx) => {
    const protocol = tx.protocol();
    const claim = tx.read();
    if (protocol !== null) {
      if (claim === null || claim.kind !== expected.kind || claim.runId !== expected.runId) {
        throw new ProjectClaimError('PROJECT_CLAIM_MISMATCH', 'The project claim does not match this run.');
      }
    } else if (claim !== null) {
      throw new ProjectClaimError('PROJECT_CLAIM_CONFLICT', 'Another operation already claims this project.');
    }
    return task(claim);
  });
}
