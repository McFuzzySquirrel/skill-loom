import { useEffect, useRef, useState } from 'react';
import { projectsApi, toApiClientError, type CoordinationAction, type CoordinationReview } from '../api/projects';
import type { ApiClientError } from '../api/client';
import { useStatusAnnouncer } from './StatusRegion';

export function ProjectCoordinationReview({ projectId }: { projectId: string }) {
  const { announce } = useStatusAnnouncer();
  const [review, setReview] = useState<CoordinationReview | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [loading, setLoading] = useState(false);
  const [oldClientsStopped, setOldClientsStopped] = useState(false);
  const [workStopped, setWorkStopped] = useState(false);
  const [abandonConfirmed, setAbandonConfirmed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const reviewButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!loading && (notice !== null || error !== null)) reviewButton.current?.focus();
  }, [error, loading, notice]);

  const inspect = async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    setError(null);
    setNotice(null);
    setOldClientsStopped(false);
    setWorkStopped(false);
    setAbandonConfirmed(false);
    setReview(null);
    try {
      const result = await projectsApi.coordinationReview(projectId, { signal: request.signal });
      if (request.signal.aborted) return;
      setReview(result);
      announce('Project coordination review is ready. Execution is not coordinated.');
    } catch (failure) {
      if (request.signal.aborted) return;
      const result = toApiClientError(failure, 'Project coordination could not be reviewed.');
      setError(result);
      announce(`Project coordination review failed: ${result.message}`);
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  };

  const act = async (input: CoordinationAction) => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await projectsApi.coordinationAction(projectId, input, { signal: request.signal });
      if (request.signal.aborted) return;
      setNotice('Coordination action applied. Review again before another action.');
      announce('Coordination action applied. Review again before another action.');
    } catch (failure) {
      if (request.signal.aborted) return;
      const result = toApiClientError(failure, 'Coordination action failed. Review again before retrying.');
      setError(result);
      announce(`Coordination action failed: ${result.message}`);
    } finally {
      if (!request.signal.aborted) {
        setReview(null);
        setOldClientsStopped(false);
        setWorkStopped(false);
        setAbandonConfirmed(false);
        setLoading(false);
      }
    }
  };

  const unresolved = review?.review.records.filter((record) => record.unresolved) ?? [];
  const soleUnresolved = unresolved.length === 1 ? unresolved[0] : undefined;
  const claim = review?.review.claim;
  const claimedRecord = claim === null || claim === undefined
    ? undefined : review?.review.records.find((record) => record.kind === claim.kind && record.runId === claim.runId);
  const confirmations = { stoppedConfirmed: true as const, oldClientsStoppedConfirmed: true as const };

  return (
    <section aria-labelledby="coordination-review-title">
      <h2 id="coordination-review-title">Project coordination</h2>
      <p>
        Arrange exclusive project use manually until older clients are stopped and coordination is enabled.
        Reviewing creates coordination files if needed; it does not stop or change any run.
      </p>
      <button ref={reviewButton} type="button" className="button button--secondary" disabled={loading} onClick={() => void inspect()}>
        {loading ? 'Reviewing coordination…' : 'Review coordination'}
      </button>
      {error !== null ? <p>Coordination failed: {error.message} ({error.code})</p> : null}
      {notice !== null ? <p>{notice}</p> : null}
      {review !== null ? (
        <div>
          <p>
            Project identity: <code>{review.review.identity.projectPath}</code>,
            device <code>{review.review.identity.projectDevice}</code>,
            inode <code>{review.review.identity.projectInode}</code>.
          </p>
          <p>
            Protocol: {review.review.protocol === null
              ? 'Not enabled'
              : `Enabled at ${review.review.protocol.enabledAt}`}.
          </p>
          <p>
            Claim: {review.review.claim === null
              ? 'None'
              : `${review.review.claim.kind} run ${review.review.claim.runId}, created ${review.review.claim.createdAt}`}.
          </p>
          <p>Execution coordinated: No. Run state may change during or after this review; it is not a lock.</p>
          {review.review.records.length === 0 ? <p>No run records found.</p> : (
            <ul>
              {review.review.records.map((record) => (
                <li key={`${record.kind}:${record.runId}`}>
                  {record.kind} run <code>{record.runId}</code>: {record.status}
                  {record.unresolved ? ' — unresolved' : ' — terminal'}
                  {' '}<span>Fingerprint: <code>{record.fingerprint}</code></span>
                </li>
              ))}
            </ul>
          )}
          <p>Review digest: <code>{review.review.reviewDigest}</code></p>
          <p>Confirmations are operator assertions, not proof. Stop all previous work, including descendant processes, before reconciliation.</p>
          <label>
            <input type="checkbox" checked={oldClientsStopped} disabled={loading} onChange={(event) => setOldClientsStopped(event.target.checked)} />
            I confirmed older Skill Loom services and helpers have stopped.
          </label>
          <label>
            <input type="checkbox" checked={workStopped} disabled={loading} onChange={(event) => setWorkStopped(event.target.checked)} />
            I confirmed previous work and all its processes and descendants have stopped.
          </label>
          {review.review.protocol === null ? (
            <button type="button" disabled={loading || !oldClientsStopped || !workStopped} onClick={() => void act({
              action: 'enable', reviewDigest: review.review.reviewDigest, ...confirmations,
            })}>Enable coordination</button>
          ) : null}
          {review.review.protocol !== null && claim === null && soleUnresolved !== undefined ? (
            <button type="button" disabled={loading || !oldClientsStopped || !workStopped} onClick={() => void act({
              action: 'adopt', reviewDigest: review.review.reviewDigest,
              kind: soleUnresolved.kind, runId: soleUnresolved.runId, ...confirmations,
            })}>Adopt reviewed {soleUnresolved.kind} run</button>
          ) : null}
          {review.review.protocol !== null && claim?.kind === 'managed' && claimedRecord?.unresolved ? (
            <button type="button" disabled={loading || !oldClientsStopped || !workStopped} onClick={() => void act({
              action: 'interrupt', reviewDigest: review.review.reviewDigest, runId: claim.runId, ...confirmations,
            })}>Mark claimed managed run interrupted</button>
          ) : null}
          {review.review.protocol !== null && claim?.kind === 'managed' && claimedRecord?.status === 'interrupted' ? (
            <>
              <label>
                <input type="checkbox" checked={abandonConfirmed} disabled={loading} onChange={(event) => setAbandonConfirmed(event.target.checked)} />
                I choose to abandon this interrupted run without replay.
              </label>
              <button type="button" disabled={loading || !oldClientsStopped || !workStopped || !abandonConfirmed} onClick={() => void act({
                action: 'abandon', reviewDigest: review.review.reviewDigest, runId: claim.runId,
                abandonConfirmed: true, ...confirmations,
              })}>Abandon interrupted managed run</button>
            </>
          ) : null}
          {review.review.protocol !== null && claim !== null && unresolved.length === 0 ? (
            <button type="button" disabled={loading || !oldClientsStopped || !workStopped} onClick={() => void act({
              action: 'clear', reviewDigest: review.review.reviewDigest, ...confirmations,
            })}>Clear reviewed claim</button>
          ) : null}
          {claim?.kind === 'portable' && claimedRecord?.unresolved ? (
            <p>Use the portable helper to explicitly resolve or abort this run before clearing its claim.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
