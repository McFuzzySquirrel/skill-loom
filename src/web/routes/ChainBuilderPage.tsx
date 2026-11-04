export interface ChainBuilderPageProps {
  projectId: string;
  chainId: string;
}

/** Placeholder for chain authoring; CHAIN-04 through CHAIN-06 own the builder. */
export function ChainBuilderPage({ projectId, chainId }: ChainBuilderPageProps) {
  return (
    <section className="panel" aria-labelledby="chain-builder-title">
      <h1 className="panel__title" id="chain-builder-title">
        Chain authoring
      </h1>
      <p className="lede">
        Build an ordered recipe of skills for one harness. The chain—not the catalog—is the
        artifact this screen edits.
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
          The catalog panel, ordered step list, and step editor arrive with chain authoring.
          Reordering will support both pointer drag and keyboard Move up / Move down.
        </p>
      </div>
    </section>
  );
}
