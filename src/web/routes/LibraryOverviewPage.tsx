import { Link } from '../router';

const libraries = [
  {
    title: 'Drafts',
    description:
      'Editable, project-independent chains. A goal draft is a manual authoring option; it does not recommend or assemble a scenario.',
    action: 'Open drafts',
    to: '/drafts',
  },
  {
    title: 'Chain templates',
    description:
      'Independent chain snapshots that can be copied into a project. Changes to a project copy do not update the template.',
    action: 'Browse templates',
    to: '/chains',
  },
  {
    title: 'Shared bundles',
    description:
      'Reviewed portable bundle files stored in the configured shared directory. Publishing or reviewing a bundle does not run it or install its skills.',
    action: 'Browse shared bundles',
    to: '/shared-bundles',
  },
  {
    title: 'Scenario examples',
    description:
      'Illustrative recipes to review and copy into a project. Examples do not install packages or run commands.',
    action: 'Browse examples',
    to: '/scenarios',
  },
];

export function LibraryOverviewPage() {
  return (
    <section aria-labelledby="library-overview-title" data-testid="library-overview">
      <header className="projects-header">
        <h1 className="panel__title" id="library-overview-title">Libraries and saved work</h1>
        <p className="lede">
          These collections have different purposes and remain separate. Choose one to
          review its contents and available actions.
        </p>
      </header>
      <div className="journey-grid journey-grid--library">
        {libraries.map((library) => (
          <article className="journey-card" key={library.to}>
            <h2>{library.title}</h2>
            <p>{library.description}</p>
            <Link className="button button--secondary" to={library.to}>
              {library.action}
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
