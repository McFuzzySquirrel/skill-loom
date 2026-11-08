import { Suspense, lazy, useEffect, useMemo, type ReactElement } from 'react';
import { AppLayout } from './components/AppLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HelpPopoverProvider } from './components/HelpPopover';
import { StatusAnnouncerProvider } from './components/StatusRegion';
import { ThemeProvider } from './ThemeProvider';
import { WorkspaceProvider } from './WorkspaceContext';
import { RouterProvider, matchRoute, useRouter } from './router';
import { ChainBuilderPage } from './routes/ChainBuilderPage';
import { GlobalChainsPage } from './routes/GlobalChainsPage';
import { GlobalDraftsPage } from './routes/GlobalDraftsPage';
import { SharedBundlesPage } from './routes/SharedBundlesPage';
import { NotFoundPage } from './routes/NotFoundPage';
import { ProjectPage, ProjectsPage } from './routes/ProjectsPage';
import { RunPage } from './routes/RunPage';
import { RunStartPage } from './routes/RunStartPage';
import { RemoteSourcesPage } from './routes/RemoteSourcesPage';
import { ScenarioCatalogPage } from './routes/ScenarioCatalogPage';
import { TerminalRunPage } from './routes/TerminalRunPage';
import { TestWorkspacesPage } from './routes/TestWorkspacesPage';
import { StartPage } from './routes/StartPage';
import { LibraryOverviewPage } from './routes/LibraryOverviewPage';
import { DiscoveryPage } from './routes/DiscoveryPage';

const HelpPage = lazy(async () => {
  const module = await import('./routes/HelpPage');
  return { default: module.HelpPage };
});

interface RouteDefinition {
  pattern: string;
  title: string;
  render: (params: Record<string, string>) => ReactElement;
}

const ROUTES: RouteDefinition[] = [
  {
    pattern: '/',
    title: 'Start',
    render: () => <StartPage />,
  },
  {
    pattern: '/library',
    title: 'Libraries and saved work',
    render: () => <LibraryOverviewPage />,
  },
  {
    pattern: '/discovery',
    title: 'Discover reusable workflows',
    render: () => <DiscoveryPage />,
  },
  {
    pattern: '/help',
    title: 'Help and user guide',
    render: () => <HelpPage />,
  },
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
    pattern: '/drafts',
    title: 'Chain drafts',
    render: () => <GlobalDraftsPage />,
  },
  {
    pattern: '/drafts/:draftId',
    title: 'Draft workflow designer',
    render: (params) => (
      <ChainBuilderPage
        projectId="__global_drafts__"
        chainId={params.draftId ?? ''}
        draftMode
      />
    ),
  },
  {
    pattern: '/shared-bundles',
    title: 'Shared bundle library',
    render: () => <SharedBundlesPage />,
  },
  {
    pattern: '/scenarios',
    title: 'Scenario catalog',
    render: () => <ScenarioCatalogPage />,
  },
  {
    pattern: '/sources',
    title: 'Remote skill repositories',
    render: () => <RemoteSourcesPage />,
  },
  {
    pattern: '/test-workspaces',
    title: 'Disposable test workspaces',
    render: () => <TestWorkspacesPage />,
  },
  {
    pattern: '/projects/:projectId/skills',
    title: 'Project skills',
    render: (params) => (
      <ProjectPage projectId={params.projectId ?? ''} view="skills" />
    ),
  },
  {
    pattern: '/projects/:projectId',
    title: 'Project workspace',
    render: (params) => <ProjectPage projectId={params.projectId ?? ''} view="chains" />,
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
    title: 'Workflow designer',
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
      <Suspense fallback={<p role="status">Loading help content…</p>}>
        {/* Keying by pathname resets a route-level render failure on navigation. */}
        <ErrorBoundary key={pathname}>{screen.element}</ErrorBoundary>
      </Suspense>
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
      <ThemeProvider>
        <WorkspaceProvider>
          <StatusAnnouncerProvider>
            <HelpPopoverProvider>
              <RoutedShell />
            </HelpPopoverProvider>
          </StatusAnnouncerProvider>
        </WorkspaceProvider>
      </ThemeProvider>
    </RouterProvider>
  );
}
