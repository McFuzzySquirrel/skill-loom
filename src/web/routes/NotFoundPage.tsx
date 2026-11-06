import { Link, useRouter } from '../router';

/** Fallback for any path the shell does not recognise. */
export function NotFoundPage() {
  const { pathname } = useRouter();

  return (
    <section className="panel panel--not-found" aria-labelledby="not-found-title">
      <h1 className="panel__title" id="not-found-title">Page not found</h1>
      <p>
        No Skill Loom screen matches <code>{pathname}</code>.
      </p>
      <p className="panel__actions">
        <Link className="button" to="/projects">
          Back to projects
        </Link>
      </p>
    </section>
  );
}
