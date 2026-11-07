import { useEffect, useId, useRef, useState } from 'react';
import type { ChainBundle } from '../../shared/bundles';
import { bundlesApi } from '../api/bundles';
import { sharedBundlesApi, type SharedBundleSource } from '../api/sharedBundles';
import { toApiClientError } from '../api/projects';
import { ApiClientError } from '../api/client';
import { BundleContents } from './BundleContents';
import { InlineError } from './InlineError';
import { useStatusAnnouncer } from './StatusRegion';

export function PublishSharedBundleDialog({
  source,
  onClose,
  onPublished,
}: {
  source: SharedBundleSource;
  onClose: () => void;
  onPublished: (name: string) => void;
}) {
  const titleId = useId();
  const nameId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const { announce } = useStatusAnnouncer();
  const [bundle, setBundle] = useState<ChainBundle | null>(null);
  const [reviewFingerprint, setReviewFingerprint] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [contentsReviewed, setContentsReviewed] = useState(false);
  const [redistributionReviewed, setRedistributionReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);

  useEffect(() => {
    heading.current?.focus();
    let active = true;
    const request = source.type === 'draft'
      ? bundlesApi.exportDraft(source.draftId)
      : bundlesApi.export(source.projectId, source.chainId);
    void request.then((result) => {
      if (!active) return;
      setBundle(result);
      setDisplayName(result.chain.name);
    }).catch((caught: unknown) => {
      if (active) {
        setError(toApiClientError(caught, 'The reviewed bundle could not be prepared.'));
      }
    });
    return () => { active = false; };
  }, [source]);

  useEffect(() => {
    if (bundle === null) {
      setReviewFingerprint(null);
      return;
    }
    let active = true;
    const subtle = globalThis.crypto?.subtle;
    if (subtle === undefined) {
      setError(new ApiClientError('Secure bundle review hashing is unavailable in this browser.', {
        code: 'CRYPTO_UNAVAILABLE',
        status: 0,
      }));
      return;
    }
    void subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(bundle)),
    ).then((digest) => {
      if (!active) return;
      const fingerprint = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      setReviewFingerprint(fingerprint);
    }).catch((caught: unknown) => {
      if (!active) return;
      setError(toApiClientError(caught, 'The reviewed bundle fingerprint could not be calculated.'));
    });
    return () => { active = false; };
  }, [bundle]);

  const publish = async () => {
    if (
      bundle === null ||
      displayName.trim() === '' ||
      !contentsReviewed ||
      !redistributionReviewed ||
      reviewFingerprint === null ||
      busy
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sharedBundlesApi.publish({
        source,
        displayName: displayName.trim(),
        contentsReviewed: true,
        redistributionReviewed: true,
        reviewFingerprint,
      });
      announce(`Published ${displayName.trim()} to the shared bundle library.`);
      onPublished(displayName.trim());
    } catch (caught) {
      const apiError = toApiClientError(caught, 'The bundle could not be published.');
      setError(apiError);
      announce(`Bundle publication failed: ${apiError.message}`, 'assertive');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="new-chain" role="dialog" aria-modal="false" aria-labelledby={titleId}>
      <div className="new-chain__header">
        <h2 id={titleId} ref={heading} tabIndex={-1}>Publish to shared library</h2>
        <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
          Close
        </button>
      </div>
      <p>
        Publication creates a new immutable bundle file; it never overwrites or deletes an existing
        entry. Bundles are published as untested unless someone independently verifies them.
      </p>
      <p>
        Remote snapshots do not provide verified redistribution rights. Review upstream license and
        notice files yourself; private repository access does not imply permission to redistribute.
        No workspace files, run inputs, or terminal output are published.
      </p>
      {bundle === null && error === null ? <p role="status">Preparing bundle for review…</p> : null}
      {error !== null ? (
        <InlineError
          title="Shared bundle operation failed"
          message={error.message}
          code={error.code}
          httpStatus={error.status}
        />
      ) : null}
      {bundle !== null ? (
        <>
          <BundleContents bundle={bundle} />
          <div className="field">
            <label className="field__label" htmlFor={nameId}>Library display name</label>
            <input
              className="input"
              id={nameId}
              maxLength={100}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              disabled={busy}
              required
            />
          </div>
          <label className="field__label">
            <input
              type="checkbox"
              checked={contentsReviewed}
              onChange={(event) => setContentsReviewed(event.target.checked)}
              disabled={busy}
            />
            {' '}I reviewed every instruction and bundled package file for sensitive content.
          </label>
          <label className="field__label">
            <input
              type="checkbox"
              checked={redistributionReviewed}
              onChange={(event) => setRedistributionReviewed(event.target.checked)}
              disabled={busy}
            />
            {' '}I reviewed applicable licenses/notices and have permission to redistribute these contents.
          </label>
          <div className="panel__actions">
            <button
              type="button"
              className="button"
              onClick={() => void publish()}
              disabled={
                busy ||
                displayName.trim() === '' ||
                !contentsReviewed ||
                !redistributionReviewed ||
                reviewFingerprint === null
              }
            >
              {busy ? 'Publishing…' : 'Publish immutable bundle'}
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
