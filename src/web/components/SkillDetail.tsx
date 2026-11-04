import { useEffect, useState } from 'react';
import { isAbortError, type ApiClientError } from '../api/client';
import {
  catalogApi,
  toApiClientError,
  type CatalogApi,
  type SkillDetail as SkillDetailPayload,
  type SkillEntry,
} from '../api/catalog';
import { InlineError } from './InlineError';

export interface SkillDetailProps {
  projectId: string;
  skill: SkillEntry;
  /** Id of the element that controls this region. */
  detailId: string;
  onAddAsStep?: (skill: SkillEntry) => void;
  /** Explains why Add as step is unavailable, for example a disabled skill. */
  addDisabledReason?: string;
  api?: CatalogApi;
}

type DetailState =
  | { status: 'loading' }
  | { status: 'ready'; detail: SkillDetailPayload }
  | { status: 'error'; error: ApiClientError };

/**
 * Expanded skill detail.
 *
 * The full `SKILL.md` arrives from the detail endpoint and is rendered as
 * escaped React text inside a scrollable `<pre>`. Harness content is never
 * interpreted as HTML, and no summary is synthesized from it.
 */
export function SkillDetail({
  projectId,
  skill,
  detailId,
  onAddAsStep,
  addDisabledReason,
  api = catalogApi,
}: SkillDetailProps) {
  const [state, setState] = useState<DetailState>({ status: 'loading' });
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setState({ status: 'loading' });

    api
      .getSkillDetail(projectId, skill.id, {
        harness: skill.harness,
        signal: controller.signal,
      })
      .then((detail) => {
        if (!cancelled) {
          setState({ status: 'ready', detail });
        }
      })
      .catch((error: unknown) => {
        if (cancelled || isAbortError(error)) {
          return;
        }
        setState({
          status: 'error',
          error: toApiClientError(
            error,
            'An unexpected error prevented loading this SKILL.md.',
          ),
        });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [api, projectId, retryToken, skill.harness, skill.id]);

  return (
    <div
      className="skill-detail"
      id={detailId}
      role="region"
      aria-label={`Full SKILL.md for ${skill.name}`}
      aria-busy={state.status === 'loading'}
    >
      <p className="skill-detail__path">
        <span className="skill-detail__path-label">Canonical path</span>{' '}
        <code>{skill.path}</code>
      </p>

      {state.status === 'loading' ? (
        <p className="state-note" data-testid="skill-detail-loading">
          <span aria-hidden="true">◌</span> Loading SKILL.md…
        </p>
      ) : null}

      {state.status === 'error' ? (
        <InlineError
          title="SKILL.md could not be loaded"
          message={state.error.message}
          code={state.error.code}
          httpStatus={state.error.status}
          onRetry={() => setRetryToken((current) => current + 1)}
          retryLabel="Retry skill detail"
        />
      ) : null}

      {state.status === 'ready' ? (
        <>
          <pre
            className="skill-detail__content"
            data-testid="skill-detail-content"
            tabIndex={0}
            aria-label={`Full SKILL.md text for ${skill.name}`}
          >
            {state.detail.content}
          </pre>
          <p className="skill-detail__note">
            Text shown exactly as it appears in SKILL.md. Slan adds no summary or
            recommendation.
          </p>
        </>
      ) : null}

      {onAddAsStep !== undefined ? (
        <p className="skill-detail__actions">
          <button
            type="button"
            className="button button--small"
            onClick={() => onAddAsStep(skill)}
            disabled={addDisabledReason !== undefined}
            aria-describedby={addDisabledReason === undefined ? undefined : `${detailId}-add-note`}
          >
            Add as step
          </button>
          {addDisabledReason !== undefined ? (
            <span className="field__hint" id={`${detailId}-add-note`}>
              {addDisabledReason}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
