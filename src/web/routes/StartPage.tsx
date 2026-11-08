import { Link } from '../router';

const journeys = [
  {
    title: 'Discover reusable workflows',
    description:
      'Explore refreshed remote skill snapshots, select candidate packages, and prepare a reviewed handoff for an existing compatible CLI session.',
    action: 'Start discovery',
    to: '/discovery',
  },
  {
    title: 'Work in a repository',
    description:
      'Open a local project to inspect its skills, build chains, and run them with your configured harness.',
    action: 'Choose a project',
    to: '/projects',
  },
  {
    title: 'Browse examples and saved work',
    description:
      'Compare scenario recipes, editable drafts, chain templates, and reviewed shared bundles without mixing their storage.',
    action: 'Open the library overview',
    to: '/library',
  },
];

export function StartPage() {
  return (
    <section aria-labelledby="start-title" data-testid="start-page">
      <header className="projects-header">
        <p className="eyebrow">Skill Loom</p>
        <h1 className="panel__title" id="start-title">What would you like to do?</h1>
        <p className="lede">
          Choose a workflow to begin. You can browse and prepare project-independent
          material without opening a project or configuring a harness.
        </p>
      </header>
      <div className="journey-grid">
        {journeys.map((journey) => (
          <article className="journey-card" key={journey.to}>
            <h2>{journey.title}</h2>
            <p>{journey.description}</p>
            <Link className="button" to={journey.to}>{journey.action}</Link>
          </article>
        ))}
      </div>
    </section>
  );
}
