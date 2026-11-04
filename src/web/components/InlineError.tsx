import { useId, type ReactNode } from 'react';

export interface InlineErrorProps {
  title: string;
  message: string;
  /** Machine-readable server code, rendered as supporting detail. */
  code?: string;
  /** HTTP status when one was returned; 0 and undefined are omitted. */
  httpStatus?: number;
  onRetry?: () => void;
  retryLabel?: string;
  children?: ReactNode;
}

/**
 * Inline failure panel for one region of a screen.
 *
 * It always renders the server's own message, never a generic empty state, and
 * it never replaces sibling regions such as the recent-project list. The
 * panel is an alert so the failure reaches screen readers as well as the
 * visible page.
 */
export function InlineError({
  title,
  message,
  code,
  httpStatus,
  onRetry,
  retryLabel = 'Retry',
  children,
}: InlineErrorProps) {
  const titleId = useId();

  return (
    <section className="inline-error" role="alert" aria-labelledby={titleId}>
      <p className="inline-error__title" id={titleId}>
        <span aria-hidden="true">! </span>
        {title}
      </p>
      <p className="inline-error__message">{message}</p>
      {code !== undefined || (httpStatus !== undefined && httpStatus > 0) ? (
        <p className="inline-error__meta">
          {code !== undefined ? `Error code: ${code}` : ''}
          {code !== undefined && httpStatus !== undefined && httpStatus > 0 ? ' · ' : ''}
          {httpStatus !== undefined && httpStatus > 0 ? `HTTP ${httpStatus}` : ''}
        </p>
      ) : null}
      {children}
      {onRetry !== undefined ? (
        <p className="panel__actions">
          <button type="button" className="button button--secondary" onClick={onRetry}>
            {retryLabel}
          </button>
        </p>
      ) : null}
    </section>
  );
}
