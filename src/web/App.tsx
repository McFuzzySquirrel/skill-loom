import { useEffect, useMemo, type ReactElement } from 'react';
import { AppLayout } from './components/AppLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { StatusAnnouncerProvider } from './components/StatusRegion';
import { Redirect, RouterProvider, matchRoute, useRouter } from './router';
import { ChainBuilderPage } from './routes/ChainBuilderPage';
import { GlobalChainsPage } from './routes/GlobalChainsPage';
import { NotFoundPage } from './routes/NotFoundPage';
import { ProjectPage, ProjectsPage } from './routes/ProjectsPage';
import { RunPage } from './routes/RunPage';
import { RunStartPage } from './routes/RunStartPage';
import { ScenarioCatalogPage } from './routes/ScenarioCatalogPage';
import { TerminalRunPage } from './routes/TerminalRunPage';

interface RouteDefinition {
  pattern: string;
  title: string;
  render: (params: Record<string, string>) => ReactElement;
}

const ROUTES: RouteDefinition[] = [
  {
    pattern: '/projects',
    title: 'Projects',
    render: () => <ProjectsPage />,
  },
  {
    pattern: '/chains',
    title: 'Global chain library',
    render: () => <GlobalChainsPage />,
  },
  {
    pattern: '/scenarios',
    title: 'Scenario catalog',
    render: () => <ScenarioCatalogPage />,
  },
  {
    pattern: '/projects/:projectId',
    title: 'Project workspace',
    render: (params) => <ProjectPage projectId={params.projectId ?? ''} />,
  },
  {
    pattern: '/projects/:projectId/chains/:chainId/run',
    title: 'Run start',
    render: (params) => (
      <RunStartPage
        projectId={params.projectId ?? ''}
        chainId={params.chainId ?? ''}
      />
    ),
  },
  {
    pattern: '/projects/:projectId/chains/:chainId',
    title: 'Chain authoring',
    render: (params) => (
      <ChainBuilderPage
        projectId={params.projectId ?? ''}
        chainId={params.chainId ?? ''}
      />
    ),
  },
  {
    pattern: '/runs/:runId/terminal',
    title: 'Run terminal',
    render: (params) => <TerminalRunPage runId={params.runId ?? ''} />,
  },
  {
    pattern: '/runs/:runId',
    title: 'Run view',
    render: (params) => <RunPage runId={params.runId ?? ''} />,
  },
];

interface Screen {
  title: string;
  element: ReactElement;
}

export function resolveScreen(pathname: string): Screen {
  if (pathname === '/' || pathname === '') {
    return { title: 'Projects', element: <Redirect to="/projects" /> };
  }

  for (const route of ROUTES) {
    const match = matchRoute(route.pattern, pathname);
    if (match !== null) {
      return { title: route.title, element: route.render(match.params) };
    }
  }

  return { title: 'Page not found', element: <NotFoundPage /> };
}

function RoutedShell() {
  const { pathname } = useRouter();
  const screen = useMemo(() => resolveScreen(pathname), [pathname]);

  useEffect(() => {
    document.title = `${screen.title} · Skill Loom`;
  }, [screen.title]);

  return (
    <AppLayout>
      {/* Keying by pathname resets a route-level render failure on navigation. */}
      <ErrorBoundary key={pathname}>{screen.element}</ErrorBoundary>
    </AppLayout>
  );
}

/**
 * Composition root for every web route (ARCH-05). The router, announcement
 * provider, layout, and error boundary wrap all screens.
 */
export function App() {
  return (
    <RouterProvider>
      <StatusAnnouncerProvider>
        <RoutedShell />
      </StatusAnnouncerProvider>
    </RouterProvider>
  );
}
