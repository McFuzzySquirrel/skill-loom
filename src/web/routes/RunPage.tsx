export interface RunPageProps {
  runId: string;
}

/** Placeholder for the terminal-dominant run view; RUN-07 owns the terminal. */
export function RunPage({ runId }: RunPageProps) {
  return (
    <section className="panel" aria-labelledby="run-view-title">
      <h1 className="panel__title" id="run-view-title">
        Run view
      </h1>
      <p className="lede">
        Supervise a live chain in a real terminal. Steps advance only on an explicit action or a
        harness completion signal, never on a timer.
      </p>
      <dl className="detail-grid">
        <div>
          <dt>Run</dt>
          <dd>{runId}</dd>
        </div>
      </dl>
      <div className="placeholder" role="note" aria-label="Not implemented yet">
        <p className="placeholder__badge">
          <span aria-hidden="true">◇</span> Shell placeholder
        </p>
        <p>
          The xterm.js terminal, step rail, and mode-specific controls arrive with the run view
          feature. This placeholder intentionally renders no terminal bytes.
        </p>
      </div>
    </section>
  );
}
