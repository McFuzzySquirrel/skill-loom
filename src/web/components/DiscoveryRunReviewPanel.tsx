import { Link } from '../router';
import { InlineError } from './InlineError';
import type { DiscoveryRunReviewState } from '../hooks/useDiscoveryRunReview';
import type { Run } from '../api/runs';

export function DiscoveryRunReviewPanel({
  review,
  runStatus,
}: {
  review: DiscoveryRunReviewState;
  runStatus: Run['status'];
}) {
  if (!review.shouldShowPanel) return null;

  if (review.lookupLoading) {
    return (
      <section className="panel" aria-labelledby="discovery-result-review-title">
        <h2 className="section-title" id="discovery-result-review-title">
          Checking discovery workspace
        </h2>
        <p className="state-note" role="status">Checking whether this run requires discovery-result review…</p>
      </section>
    );
  }

  if (review.lookupError !== null) {
    return (
      <section className="panel" aria-labelledby="discovery-result-review-title">
        <h2 className="section-title" id="discovery-result-review-title">
          Discovery review status unavailable
        </h2>
        <InlineError
          title="Workspace association could not be checked"
          message={review.lookupError.message}
          code={review.lookupError.code}
          httpStatus={review.lookupError.status}
          onRetry={() => void review.retryWorkspaceLookup()}
        />
      </section>
    );
  }

  const workspace = review.workspace;
  if (workspace === null) return null;

  return (
    <section className="panel" aria-labelledby="discovery-result-review-title" data-testid="discovery-result-review">
      <h2 className="section-title" id="discovery-result-review-title">
        Review scenario-discovery result
      </h2>
      <p>
        The harness output is untrusted. Load the fixed result file for complete validation,
        review the generated chain and package contents, and approve redistribution separately.
        Marking the discovery step Done binds approval to this exact result fingerprint.
      </p>
      <p>Workspace handoff fingerprint: <code>{workspace.handoffFingerprint}</code></p>
      <button
        type="button"
        className="button button--secondary"
        onClick={() => void review.loadResult()}
        disabled={review.busy}
      >
        {review.busy ? 'Loading result…' : 'Load result for review'}
      </button>
      {review.resultError !== null ? (
        <InlineError
          title="Discovery result action failed"
          message={review.resultError.message}
          code={review.resultError.code}
          httpStatus={review.resultError.status}
          onRetry={() => void review.loadResult()}
        />
      ) : null}
      {review.result !== null ? (
        <>
          <p>Result fingerprint: <code>{review.result.fingerprint}</code></p>
          <details open>
            <summary>Review complete chain, package inventory, and contents</summary>
            <pre>{JSON.stringify(review.result.bundle, null, 2)}</pre>
          </details>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={review.contentsReviewed}
              onChange={(event) => review.setContentsApproval(event.target.checked)}
            />
            <span>I reviewed the complete generated chain and package contents.</span>
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={review.redistributionReviewed}
              onChange={(event) => review.setRedistributionApproval(event.target.checked)}
            />
            <span>I separately reviewed whether sharing these package contents is permitted.</span>
          </label>
        </>
      ) : null}
      {workspace.importedDraftId ? (
        <p className="state-note">
          Imported as a new project-independent draft:{' '}
          <Link to={`/drafts/${encodeURIComponent(workspace.importedDraftId)}`}>
            Open Chain draft
          </Link>
        </p>
      ) : runStatus === 'completed' && workspace.resultFingerprint !== undefined ? (
        <button
          type="button"
          className="button"
          onClick={() => void review.importResult()}
          disabled={review.busy}
        >
          {review.busy ? 'Creating draft…' : 'Create new Chain draft from reviewed result'}
        </button>
      ) : null}
    </section>
  );
}
