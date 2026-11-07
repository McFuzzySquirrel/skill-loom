import { useEffect, useId, useRef, useState } from 'react';
import type { ChainBundle } from '../../shared/bundles';
import { bundlesApi, downloadBundle } from '../api/bundles';
import { toApiClientError } from '../api/chains';
import type { ApiClientError } from '../api/client';
import { BundleContents } from './BundleContents';
import { InlineError } from './InlineError';
import { useStatusAnnouncer } from './StatusRegion';
import { HelpPopover } from './HelpPopover';

export function ExportChainDialog({
  projectId,
  chainId,
  draftId,
  onClose,
}: {
  projectId?: string;
  chainId?: string;
  draftId?: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const { announce } = useStatusAnnouncer();
  const [bundle, setBundle] = useState<ChainBundle | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [runnerError, setRunnerError] = useState<ApiClientError | null>(null);
  const [runnerBusy, setRunnerBusy] = useState(false);

  useEffect(() => {
    heading.current?.focus();
    let active = true;
    const request = draftId !== undefined
      ? bundlesApi.exportDraft(draftId)
      : projectId !== undefined && chainId !== undefined
        ? bundlesApi.export(projectId, chainId)
        : Promise.reject(new Error('An export source is required.'));
    void request.then((value) => {
      if (active) setBundle(value);
    }).catch((caught: unknown) => {
      if (active) setError(toApiClientError(caught, 'The chain bundle could not be prepared.'));
    });
    return () => { active = false; };
  }, [chainId, draftId, projectId]);

  return (
    <section className="new-chain" role="dialog" aria-modal="false" aria-labelledby={titleId}>
      <div className="new-chain__header">
        <h3 id={titleId} ref={heading} tabIndex={-1}>Export chain bundle</h3>
        <HelpPopover topic="exportBundle" />
        <button type="button" className="button button--secondary" onClick={onClose}>Close</button>
      </div>
      <p>
        This downloads the saved chain, complete referenced skill packages, including scripts,
        and the selected native agent definition when the chain uses one.
        Input defaults, run history, local source paths, and permission consent are not exported.
        Review instructions and all package files for secrets, private data, and redistribution rights before sharing.
        Embedded paths or secrets in file contents cannot be detected automatically.
      </p>
      <p>
        The reusable runner skill is a separate download for Node.js 24+ Agent Skills-compatible hosts.
        It does not contain this chain; install it in the target project and provide the downloaded bundle when invoking it.
        Session isolation and completion reporting depend on the host and may be approximations.
      </p>
      {error !== null ? <InlineError title="Export failed" message={error.message} code={error.code} httpStatus={error.status} /> : null}
      {runnerError !== null ? <InlineError title="Runner skill download failed" message={runnerError.message} code={runnerError.code} httpStatus={runnerError.status} /> : null}
      {runnerBusy ? <p role="status">Preparing the reusable runner skill…</p> : null}
      {bundle === null && error === null ? <p role="status">Preparing bundle…</p> : null}
      {bundle !== null ? (
        <>
          <BundleContents bundle={bundle} />
          <button
            type="button"
            className="button button--secondary"
            disabled={runnerBusy}
            onClick={() => {
              setRunnerBusy(true);
              setRunnerError(null);
              void bundlesApi.downloadRunnerSkill().then(() => {
                announce('Downloaded the reusable Loom bundle runner skill.');
              }).catch((caught: unknown) => {
                setRunnerError(toApiClientError(caught, 'The runner skill could not be downloaded.'));
              }).finally(() => setRunnerBusy(false));
            }}
          >
            Download reusable runner skill
          </button>
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
