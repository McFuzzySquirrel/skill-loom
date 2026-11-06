import { useEffect, useId, useRef, useState } from 'react';
import type { BundlePreview } from '../../shared/bundles';
import { bundlesApi } from '../api/bundles';
import { toApiClientError, type Chain } from '../api/chains';
import { ApiClientError } from '../api/client';
import { BundleContents } from './BundleContents';
import { InlineError } from './InlineError';
import { useStatusAnnouncer } from './StatusRegion';
import { HelpPopover } from './HelpPopover';

export function ImportBundleDialog({
  projectId, onImported, onClose,
}: { projectId: string; onImported: (chain: Chain) => void; onClose: () => void }) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const { announce } = useStatusAnnouncer();
  const [preview, setPreview] = useState<BundlePreview | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [reuse, setReuse] = useState<string[]>([]);
  const requestId = useRef(0);

  useEffect(() => {
    heading.current?.focus();
    return () => { requestId.current += 1; };
  }, []);

  const chooseFile = async (file: File | undefined) => {
    const id = ++requestId.current;
    setPreview(null);
    setError(null);
    setReviewed(false);
    setReuse([]);
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 30 * 1024 * 1024) {
        throw new ApiClientError('Bundle files must be smaller than 30 MiB.', { code: 'BUNDLE_TOO_LARGE', status: 413 });
      }
      let raw: unknown;
      try {
        raw = JSON.parse(await file.text()) as unknown;
      } catch {
        throw new ApiClientError('Select a valid JSON chain bundle.', { code: 'BUNDLE_INVALID', status: 422 });
      }
      const result = await bundlesApi.preview(projectId, raw);
      if (id === requestId.current) setPreview(result);
    } catch (caught) {
      if (id === requestId.current) {
        const failure = toApiClientError(caught, 'The bundle could not be read.');
        setError(failure);
        announce(`Bundle preview failed: ${failure.message}`, 'assertive');
      }
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  };

  const importCopy = async () => {
    if (!preview || !reviewed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const chain = await bundlesApi.import(projectId, preview.bundle, reuse);
      announce(`Imported chain ${chain.name}. Review permissions and run preflight before running.`);
      onImported(chain);
    } catch (caught) {
      const failure = toApiClientError(caught, 'The chain bundle could not be imported.');
      setError(failure);
      announce(`Bundle import failed: ${failure.message}`, 'assertive');
    } finally {
      setBusy(false);
    }
  };
  const unresolved = preview?.skills.some((skill) =>
    (skill.conflict || skill.directoryExists) && !reuse.includes(skill.name)) ?? false;

  return (
    <section className="new-chain" role="dialog" aria-modal="false" aria-labelledby={titleId}>
      <div className="new-chain__header">
        <h3 id={titleId} ref={heading} tabIndex={-1}>Import chain bundle</h3>
        <HelpPopover topic="importBundle" />
        <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>Close</button>
      </div>
      <label className="field__label">
        Chain bundle (.loom.json)
        <input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => void chooseFile(event.target.files?.[0])} />
      </label>
      <p>
        Only import skills you trust. Packages can contain executable scripts and agent instructions.
        Import installs project-local files but never runs them or starts a chain.
        Existing packages are never overwritten; permission consent starts off.
      </p>
      {busy ? <p role="status">Processing bundle…</p> : null}
      {error !== null ? <InlineError title="Bundle import failed" message={error.message} code={error.code} httpStatus={error.status} /> : null}
      {preview !== null ? (
        <>
          <BundleContents bundle={preview.bundle} />
          {preview.skills.map((skill) => (
            <div key={skill.name}>
              <p>{skill.name}: {skill.files} files, {skill.bytes} bytes.</p>
              {skill.conflict ? (
                <label className="field__label">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={reuse.includes(skill.name)}
                    onChange={(event) => setReuse((current) => event.target.checked
                      ? [...current, skill.name] : current.filter((name) => name !== skill.name))}
                  />
                  {' '}Reuse installed "{skill.name}" instead of the bundled package (contents may differ).
                </label>
              ) : skill.directoryExists ? (
                <p role="alert">The destination directory already exists. Cancel and resolve it before importing; it will not be overwritten.</p>
              ) : null}
            </div>
          ))}
          <label className="field__label">
            <input type="checkbox" checked={reviewed} disabled={busy} onChange={(event) => setReviewed(event.target.checked)} />
            {' '}I reviewed and trust these instructions and packages.
          </label>
          <button type="button" className="button" disabled={busy || !reviewed || unresolved} onClick={() => void importCopy()}>
            Import chain and skills
          </button>
        </>
      ) : null}
    </section>
  );
}
