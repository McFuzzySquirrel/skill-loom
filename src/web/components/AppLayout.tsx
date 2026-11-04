import { useRef, type MouseEvent, type ReactNode } from 'react';
import { Link, useRouter } from '../router';
import { ServerStatus } from './ServerStatus';
import { StatusRegion } from './StatusRegion';

export interface AppLayoutProps {
  children: ReactNode;
  /** Present once a project is selected; the shell does not invent one. */
  projectName?: string;
}

/**
 * Persistent shell: skip link, header with wordmark and local-only badge,
 * server health, the aria-live status region, the main landmark, and a footer
 * that repeats the privacy boundary.
 */
export function AppLayout({ children, projectName }: AppLayoutProps) {
  const { pathname } = useRouter();
  const mainRef = useRef<HTMLElement>(null);

  const handleSkip = (event: MouseEvent<HTMLAnchorElement>) => {
    // Focusing the target explicitly works in every browser; the fragment
    // alone only moves the sequential-focus starting point in some of them.
    event.preventDefault();
    mainRef.current?.focus();
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content" onClick={handleSkip}>
        Skip to main content
      </a>

      <header className="app-header">
        <div className="app-header__identity">
          <span className="wordmark">Slan</span>
          <span
            className="local-badge"
            title="Slan binds to 127.0.0.1 and sends no application data off this machine."
          >
            <span aria-hidden="true">●</span> Local-only
          </span>
        </div>

        <nav className="app-nav" aria-label="Primary">
          <Link to="/projects" aria-current={pathname === '/projects' ? 'page' : undefined}>
            Projects
          </Link>
          <Link to="/chains" aria-current={pathname === '/chains' ? 'page' : undefined}>
            Chain library
          </Link>
        </nav>

        {projectName !== undefined ? (
          <p className="app-header__project">
            Project: <span>{projectName}</span>
          </p>
        ) : null}

        <ServerStatus />
      </header>

      <StatusRegion />

      <main className="app-main" id="main-content" ref={mainRef} tabIndex={-1}>
        {children}
      </main>

      <footer className="app-footer">
        <p>
          Slan runs on this machine only. Skills are model-invoked context: prompt order is
          guaranteed, but a harness may decline to load a named skill.
        </p>
      </footer>
    </div>
  );
}
