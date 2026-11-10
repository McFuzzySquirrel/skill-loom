import { useEffect, useMemo, type ReactElement } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HelpPopoverProvider } from './components/HelpPopover';
import { StatusAnnouncerProvider, StatusRegion } from './components/StatusRegion';
import { ThemeProvider } from './ThemeProvider';
import { RouterProvider, matchRoute, useRouter } from './router';
import { ChainEditorPage } from './routes/ChainEditorPage';
import { NotFoundPage } from './routes/NotFoundPage';

interface RouteDefinition {
  pattern: string;
  title: string;
  render: (params: Record<string, string>) => ReactElement;
}

function EditorLanding() {
  return (
    <section className="panel" aria-labelledby="landing-title">
      <h1 className="panel__title" id="landing-title">Skill Loom chain editor</h1>
      <p>
        Skill Loom is driven by its CLI and skills. Open this editor for a specific chain
        with <code>skill-loom edit --project &lt;id&gt; --chain &lt;id&gt;</code> or{' '}
        <code>skill-loom edit --draft &lt;id&gt;</code>.
      </p>
    </section>
  );
}

const ROUTES: RouteDefinition[] = [
  { pattern: '/', title: 'Chain editor', render: () => <EditorLanding /> },
  {
    pattern: '/drafts/:draftId',
    title: 'Edit draft chain',
    render: (params) => <ChainEditorPage chainId={params.draftId ?? ''} />,
  },
  {
    pattern: '/projects/:projectId/chains/:chainId',
    title: 'Edit chain',
    render: (params) => (
      <ChainEditorPage projectId={params.projectId ?? ''} chainId={params.chainId ?? ''} />
    ),
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
    <main id="main-content" className="app-main" tabIndex={-1}>
      <ErrorBoundary key={pathname}>{screen.element}</ErrorBoundary>
      <StatusRegion />
    </main>
  );
}

export function App() {
  return (
    <RouterProvider>
      <ThemeProvider>
        <StatusAnnouncerProvider>
          <HelpPopoverProvider>
            <RoutedShell />
          </HelpPopoverProvider>
        </StatusAnnouncerProvider>
      </ThemeProvider>
    </RouterProvider>
  );
}
