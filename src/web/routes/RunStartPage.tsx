export interface RunStartPageProps {
  projectId: string;
  chainId: string;
}

/** Placeholder for run start and preflight; PRE-04 owns the real screen. */
export function RunStartPage({ projectId, chainId }: RunStartPageProps) {
  return (
    <section className="panel" aria-labelledby="run-start-title">
      <h1 className="panel__title" id="run-start-title">
        Run start
      </h1>
      <p className="lede">
        Review the chain, fill its inputs, run preflight, and start a run. Opening this screen
        never starts checks or a trust session by itself.
      </p>
      <dl className="detail-grid">
        <div>
          <dt>Project</dt>
          <dd>{projectId}</dd>
        </div>
        <div>
          <dt>Chain</dt>
          <dd>{chainId}</dd>
        </div>
      </dl>
      <div className="placeholder" role="note" aria-label="Not implemented yet">
        <p className="placeholder__badge">
          <span aria-hidden="true">◇</span> Shell placeholder
        </p>
        <p>
          Preflight findings, the inputs form, mode selection, and the Copilot trust panel
          arrive with the run preflight feature.
        </p>
      </div>
    </section>
  );
}
