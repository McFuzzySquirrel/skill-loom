import { useEffect, useId, useRef, useState } from 'react';
import type { ChainBundle } from '../../shared/bundles';
import { bundlesApi, downloadBundle } from '../api/bundles';
import { toApiClientError } from '../api/chains';
import type { ApiClientError } from '../api/client';
import { BundleContents } from './BundleContents';
import { InlineError } from './InlineError';
import { useStatusAnnouncer } from './StatusRegion';

export function ExportChainDialog({
  projectId, chainId, onClose,
}: { projectId: string; chainId: string; onClose: () => void }) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const { announce } = useStatusAnnouncer();
  const [bundle, setBundle] = useState<ChainBundle | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [reviewed, setReviewed] = useState(false);

  useEffect(() => {
    heading.current?.focus();
    let active = true;
    void bundlesApi.export(projectId, chainId).then((value) => {
      if (active) setBundle(value);
    }).catch((caught: unknown) => {
      if (active) setError(toApiClientError(caught, 'The chain bundle could not be prepared.'));
    });
    return () => { active = false; };
  }, [projectId, chainId]);

  return (
    <section className="new-chain" role="dialog" aria-modal="false" aria-labelledby={titleId}>
      <div className="new-chain__header">
        <h3 id={titleId} ref={heading} tabIndex={-1}>Export chain bundle</h3>
        <button type="button" className="button button--secondary" onClick={onClose}>Close</button>
      </div>
      <p>
        This downloads the saved chain and complete referenced skill packages, including scripts.
        Input defaults, run history, local source paths, and permission consent are not exported.
        Review instructions and all package files for secrets, private data, and redistribution rights before sharing.
        Embedded paths or secrets in file contents cannot be detected automatically.
      </p>
      {error !== null ? <InlineError title="Export failed" message={error.message} code={error.code} httpStatus={error.status} /> : null}
      {bundle === null && error === null ? <p role="status">Preparing bundle…</p> : null}
      {bundle !== null ? (
        <>
          <BundleContents bundle={bundle} />
          <label className="field__label">
            <input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
            {' '}I reviewed the contents and have permission to share these skills.
          </label>
          <button
            type="button"
            className="button"
            disabled={!reviewed}
            onClick={() => {
              downloadBundle(bundle);
              announce(`Downloaded chain bundle for ${bundle.chain.name}.`);
              onClose();
            }}
          >
            Download bundle
          </button>
        </>
      ) : null}
    </section>
  );
}
