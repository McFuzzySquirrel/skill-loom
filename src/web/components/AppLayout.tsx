import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { Link, useRouter } from '../router';
import { useAppearance } from '../ThemeProvider';
import { useWorkspace } from '../WorkspaceContext';
import { getPageHelpTopic } from '../help/topics';
import { HelpPopover } from './HelpPopover';
import { ServerStatus } from './ServerStatus';
import { StopServerDialog } from './StopServerDialog';
import { StatusRegion } from './StatusRegion';
import { useStatusAnnouncer } from './StatusRegion';

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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const [serverStopped, setServerStopped] = useState(false);
  const [otherTabStopping, setOtherTabStopping] = useState(false);
  const stopServerTrigger = useRef<HTMLButtonElement>(null);
  const restoreStopFocus = useRef(false);
  const { draftStatus, info } = useWorkspace();
  const { choice, persistenceError, setChoice } = useAppearance();
  const { announce } = useStatusAnnouncer();
  const persistenceAnnounced = useRef(false);

  useEffect(() => {
    if (!stopDialogOpen && restoreStopFocus.current) {
      restoreStopFocus.current = false;
      stopServerTrigger.current?.focus();
    }
  }, [stopDialogOpen]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('skill-loom-server-lifecycle');
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (
        typeof event.data === 'object' &&
        event.data !== null &&
        'state' in event.data &&
        event.data.state === 'stopping'
      ) {
        setOtherTabStopping(true);
      }
    };
    return () => channel.close();
  }, []);

  const routeContext = useMemo(() => {
    const projectId = pathname.match(/^\/projects\/([^/]+)/)?.[1];
    const chainId = pathname.match(/^\/projects\/[^/]+\/chains\/([^/]+)/)?.[1];
    const runId = pathname.match(/^\/runs\/([^/]+)/)?.[1];
    return {
      projectId,
      chainId,
      runId,
      projectName:
        projectId !== undefined && info?.projectId === projectId
          ? info.projectName
          : undefined,
      chainName:
        projectId !== undefined &&
        info?.projectId === projectId &&
        info.chainId === chainId
          ? info.chainName
          : undefined,
      runChainName:
        runId !== undefined && info?.runId === runId ? info.chainName : undefined,
      runChainId: runId !== undefined && info?.runId === runId ? info.chainId : undefined,
      runProjectId:
        runId !== undefined && info?.runId === runId ? info.projectId : undefined,
    };
  }, [info, pathname]);

  const pageTrail: Array<{ label: string; to?: string }> = (() => {
    if (pathname === '/projects') {
      return [{ label: 'Projects' }];
    }
    if (pathname === '/chains') {
      return [{ label: 'Chain library' }];
    }
    if (pathname === '/shared-bundles') {
      return [{ label: 'Shared bundle library' }];
    }
    if (pathname === '/drafts' || pathname.startsWith('/drafts/')) {
      return [{ label: 'Chain drafts', to: '/drafts' }];
    }
    if (pathname === '/scenarios') {
      return [{ label: 'Scenario catalog' }];
    }
    if (pathname === '/sources') {
      return [{ label: 'Remote skill repositories' }];
    }
    if (pathname === '/test-workspaces') {
      return [{ label: 'Disposable test workspaces' }];
    }
    if (pathname === '/help') {
      return [{ label: 'Help and user guide' }];
    }
    if (routeContext.projectId !== undefined) {
      const projectLabel = routeContext.projectName ?? 'Project';
      const projectPath = `/projects/${routeContext.projectId}`;
      const trail: Array<{ label: string; to?: string }> = [
        { label: 'Projects', to: '/projects' },
        { label: projectLabel, to: projectPath },
      ];
      if (pathname.endsWith('/skills')) {
        trail.push({ label: 'Skills' });
      } else if (routeContext.chainId !== undefined) {
        trail.push({
          label: routeContext.chainName ?? 'Chain',
          ...(pathname.endsWith('/run')
            ? { to: `${projectPath}/chains/${routeContext.chainId}` }
            : {}),
        });
        if (pathname.endsWith('/run')) {
          trail.push({ label: 'Prepare run' });
        } else {
          trail.push({ label: 'Edit chain' });
        }
      } else {
        trail.push({ label: 'Chains' });
      }
      return trail;
    }
    if (routeContext.runId !== undefined) {
      const trail: Array<{ label: string; to?: string }> = [
        { label: 'Projects', to: '/projects' },
        ...(routeContext.runProjectId === undefined
          ? []
          : [
              {
                label: 'Project',
                to: `/projects/${routeContext.runProjectId}`,
              },
            ]),
        {
          label: routeContext.runChainName ?? 'Run',
          ...(routeContext.runChainId === undefined
            ? {}
            : {
                to: `/projects/${routeContext.runProjectId}/chains/${routeContext.runChainId}`,
              }),
        },
        {
          label: pathname.endsWith('/terminal') ? 'Terminal' : 'Run details',
        },
      ];
      return trail;
    }
    return [{ label: 'Skill Loom' }];
  })();

  const isProjectArea = routeContext.projectId !== undefined;
  const projectNavId = routeContext.projectId ?? routeContext.runProjectId;
  const activeRunId =
    routeContext.runId ??
    (info !== null && info.projectId === routeContext.projectId
      ? info.runId
      : undefined);

  useEffect(() => {
    if (persistenceError && !persistenceAnnounced.current) {
      persistenceAnnounced.current = true;
      announce('Appearance changed, but this browser cannot save your preference.');
    } else if (!persistenceError) {
      persistenceAnnounced.current = false;
    }
  }, [announce, persistenceError]);

  const handleSkip = (event: MouseEvent<HTMLAnchorElement>) => {
    // Focusing the target explicitly works in every browser; the fragment
    // alone only moves the sequential-focus starting point in some of them.
    event.preventDefault();
    mainRef.current?.focus();
  };

  if (serverStopped) {
    return (
      <div className="app-shell">
        <a className="skip-link" href="#main-content" onClick={handleSkip}>
          Skip to main content
        </a>
        <header className="app-header">
          <strong>Skill Loom stopped</strong>
          <span className="local-badge">Local-only</span>
        </header>
        <StatusRegion />
        <main className="app-main shutdown-screen" id="main-content" ref={mainRef} tabIndex={-1}>
          <section className="panel" aria-labelledby="shutdown-complete-title">
            <h1 className="panel__title" id="shutdown-complete-title">
              Skill Loom server stopped
            </h1>
            <p>
              The local server is no longer available. You can close this tab and restart Skill
              Loom with the same command you used to launch it.
            </p>
            <p>
              Any active run was saved as interrupted. After restarting, open its run view and
              choose an explicit recovery action; no step will replay automatically.
            </p>
          </section>
        </main>
        <footer className="app-footer">
          <p>Skill Loom runs on this machine only.</p>
        </footer>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content" onClick={handleSkip}>
        Skip to main content
      </a>

      <header className="app-header">
        <button
          type="button"
          className="workspace-nav-toggle"
          aria-expanded={mobileNavOpen}
          aria-controls="workspace-navigation"
          onClick={() => setMobileNavOpen((open) => !open)}
        >
          <span aria-hidden="true">{mobileNavOpen ? '×' : '☰'}</span>
          <span>{mobileNavOpen ? 'Close navigation' : 'Menu'}</span>
        </button>
        <nav className="app-breadcrumbs" aria-label="Breadcrumb">
          <ol>
            {pageTrail.map((item, index) => (
              <li key={`${item.label}-${index}`}>
                {'to' in item && item.to !== undefined ? (
                  <Link to={item.to}>{item.label}</Link>
                ) : (
                  <span aria-current="page">{item.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
        <div className="app-header__identity">
          <span
            className="local-badge"
            title="Skill Loom binds to 127.0.0.1 and sends no application data off this machine."
          >
            Local-only
          </span>
          {projectName ?? routeContext.projectName ? (
            <span className="app-header__project">
              {projectName ?? routeContext.projectName}
            </span>
          ) : null}
        </div>
        <ServerStatus />
        <HelpPopover topic={getPageHelpTopic(pathname)} />
      </header>

      <StatusRegion />
      {otherTabStopping ? (
        <p className="shutdown-notice" role="status">
          Another tab requested server shutdown. This tab will lose its connection when shutdown
          completes.
        </p>
      ) : null}
      {stopDialogOpen ? (
        <StopServerDialog
          dirty={draftStatus.dirty}
          saving={draftStatus.saving}
          onClose={() => {
            restoreStopFocus.current = true;
            setStopDialogOpen(false);
          }}
          onStopped={() => setServerStopped(true)}
        />
      ) : null}

      <div className="workspace-frame">
        <aside
          className={`workspace-sidebar${mobileNavOpen ? ' workspace-sidebar--open' : ''}`}
          id="workspace-navigation"
        >
          <div className="workspace-brand">
            <Link to="/chains" className="wordmark" onClick={() => setMobileNavOpen(false)}>
              Skill Loom
            </Link>
          </div>
          <nav className="app-nav" aria-label="Primary">
            <Link
              to="/chains"
              aria-current={
                pathname === '/chains' ? 'page' : undefined
              }
              onClick={() => setMobileNavOpen(false)}
            >
              Chain library
            </Link>
            <Link
              to="/drafts"
              aria-current={pathname === '/drafts' || pathname.startsWith('/drafts/') ? 'page' : undefined}
              onClick={() => setMobileNavOpen(false)}
            >
              Chain drafts
            </Link>
            <Link
              to="/shared-bundles"
              aria-current={pathname === '/shared-bundles' ? 'page' : undefined}
              onClick={() => setMobileNavOpen(false)}
            >
              Shared bundles
            </Link>
            <Link
              to="/projects"
              aria-current={
                pathname === '/projects' || pathname.startsWith('/projects/')
                  ? 'page'
                  : undefined
              }
              onClick={() => setMobileNavOpen(false)}
            >
              Projects
            </Link>
            <Link
              to="/scenarios"
              aria-current={pathname === '/scenarios' ? 'page' : undefined}
              onClick={() => setMobileNavOpen(false)}
            >
              Scenario catalog
            </Link>
            <Link
              to="/sources"
              aria-current={pathname === '/sources' ? 'page' : undefined}
              onClick={() => setMobileNavOpen(false)}
            >
              Remote repositories
            </Link>
            <Link
              to="/test-workspaces"
              aria-current={pathname === '/test-workspaces' ? 'page' : undefined}
              onClick={() => setMobileNavOpen(false)}
            >
              Test workspaces
            </Link>
            <Link
              to="/help"
              aria-current={pathname === '/help' ? 'page' : undefined}
              onClick={() => setMobileNavOpen(false)}
            >
              Help and user guide
            </Link>
          </nav>
          {isProjectArea || projectNavId !== undefined ? (
            <nav className="workspace-project-nav" aria-label="Project workspace">
              <h2>{routeContext.projectName ?? 'Current project'}</h2>
              <Link
                to={`/projects/${projectNavId}`}
                aria-current={
                  pathname === `/projects/${projectNavId}` ||
                  pathname.startsWith(`/projects/${projectNavId}/chains/`)
                    ? 'page'
                    : undefined
                }
                onClick={() => setMobileNavOpen(false)}
              >
                Project chains
              </Link>
              <Link
                to={`/projects/${projectNavId}/skills`}
                aria-current={pathname.endsWith('/skills') ? 'page' : undefined}
                onClick={() => setMobileNavOpen(false)}
              >
                Project skills
              </Link>
            </nav>
          ) : null}
          {activeRunId !== undefined ? (
            <nav className="workspace-run-nav" aria-label="Active run">
              <Link
                to={`/runs/${encodeURIComponent(activeRunId)}`}
                aria-current={pathname === `/runs/${activeRunId}` ? 'page' : undefined}
                onClick={() => setMobileNavOpen(false)}
              >
                Return to run
              </Link>
            </nav>
          ) : null}
          <div className="workspace-sidebar__bottom">
            <button
              ref={stopServerTrigger}
              type="button"
              className="button button--danger button--small"
              onClick={() => {
                restoreStopFocus.current = false;
                setStopDialogOpen(true);
              }}
            >
              Stop server
            </button>
            <label className="field__label" htmlFor="appearance-choice">
              Appearance
            </label>
            <select
              className="input"
              id="appearance-choice"
              value={choice}
              aria-describedby={persistenceError ? 'appearance-storage-hint' : undefined}
              onChange={(event) => {
                const next = event.target.value;
                if (next === 'system' || next === 'light' || next === 'dark') {
                  setChoice(next);
                }
              }}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
            {persistenceError ? (
              <p className="field__hint" id="appearance-storage-hint">
                This browser cannot remember the appearance choice.
              </p>
            ) : null}
            <p className="workspace-sidebar__privacy">
              Skill Loom runs on this machine only.
            </p>
          </div>
        </aside>
        <main className="app-main" id="main-content" ref={mainRef} tabIndex={-1}>
          {children}
        </main>
      </div>
      <footer className="app-footer">
        <p>
          Skill Loom runs on this machine only. Skills are model-invoked context: prompt order is
          guaranteed, but a harness may decline to load a named skill.
        </p>
      </footer>
    </div>
  );
}
