/**
 * Placeholder for the project workspace route (`/projects`).
 *
 * FOUND-04 owns only the routed shell; recent projects, the folder browser,
 * and project creation belong to PROJ-03.
 */
export function ProjectsPage() {
  return (
    <section className="panel" aria-labelledby="projects-title">
      <h1 className="panel__title" id="projects-title">
        Projects
      </h1>
      <p className="lede">
        Choose a local project to browse its skills and chains.
      </p>
      <div className="placeholder" role="note" aria-label="Not implemented yet">
        <p className="placeholder__badge">
          <span aria-hidden="true">◇</span> Shell placeholder
        </p>
        <p>
          Recent projects, the server-side folder browser, and the new-project form arrive with
          the project workspace feature. This route only proves the shell, layout, and typed API
          client are wired.
        </p>
      </div>
      <h2 className="section-title">What this screen will show</h2>
      <ul className="plain-list">
        <li>Recent projects you can reopen or remove without deleting files.</li>
        <li>A folder browser that lists directories from the local server.</li>
        <li>The canonical path, git state, and <code>.slan</code> state of an opened project.</li>
      </ul>
    </section>
  );
}
