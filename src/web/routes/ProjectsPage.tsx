import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useRouter } from '../router';
import {
  recallProject,
  rememberProject,
  projectsApi,
  toApiClientError,
  type DirectoryListing,
  type ProjectRegistration,
  type RecentProject,
} from '../api/projects';
import type { ApiClientError } from '../api/client';
import { FolderBrowser } from '../components/FolderBrowser';
import { InlineError } from '../components/InlineError';
import { NewProjectForm } from '../components/NewProjectForm';
import { RecentProjects } from '../components/RecentProjects';
import { SkillCatalog } from '../components/SkillCatalog';
import { useStatusAnnouncer } from '../components/StatusRegion';
import { useRecentProjects } from '../hooks/useRecentProjects';

/**
 * Project selection screen (PROJ-03).
 *
 * The left column keeps recent projects usable even when the browser path is
 * invalid; the right column owns server-side browsing and project creation.
 * Success always navigates to the project route with the registered id.
 */
export function ProjectsPage() {
  const { navigate } = useRouter();
  const { announce } = useStatusAnnouncer();
  const { state: recentState, reload } = useRecentProjects();
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<ApiClientError | null>(null);
  const [removeError, setRemoveError] = useState<ApiClientError | null>(null);
  const [newProjectParent, setNewProjectParent] = useState<string | null>(null);

  const handleProjectOpened = useCallback(
    (project: ProjectRegistration) => {
      rememberProject(project);
      announce(`Opening project ${project.displayName}.`);
      navigate(`/projects/${project.id}`);
    },
    [announce, navigate],
  );

  const handleOpenRecent = async (project: RecentProject) => {
    setOpeningId(project.id);
    setOpenError(null);
    try {
      const opened = await projectsApi.openProject(project.canonicalPath);
      setOpeningId(null);
      handleProjectOpened(opened);
    } catch (error) {
      setOpeningId(null);
      const apiError = toApiClientError(
        error,
        'An unexpected error prevented opening this recent project.',
      );
      setOpenError(apiError);
      announce(`Recent project could not be opened: ${apiError.message}`);
    }
  };

  const handleRemoveRecent = async (project: RecentProject): Promise<void> => {
    setRemovingId(project.id);
    setRemoveError(null);
    try {
      await projectsApi.removeRecent(project.id);
      await reload();
      announce(
        `Removed ${project.displayName} from recent projects. Files were not deleted.`,
      );
    } catch (error) {
      const apiError = toApiClientError(
        error,
        'An unexpected error prevented removing this recent project.',
      );
      setRemoveError(apiError);
      announce(`Recent project could not be removed: ${apiError.message}`);
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <section aria-labelledby="projects-title">
      <header className="projects-header">
        <h1 className="panel__title" id="projects-title">
          Projects
        </h1>
        <p className="lede">
          Choose a local project folder to browse its skills and chains. Nothing leaves
          this machine.
        </p>
      </header>

      <div className="projects-layout">
        <RecentProjects
          state={recentState}
          onRetry={() => void reload()}
          onOpen={(project) => void handleOpenRecent(project)}
          onRemove={handleRemoveRecent}
          openingId={openingId}
          removingId={removingId}
          openError={openError}
          removeError={removeError}
        />

        <div className="projects-browser-column">
          <FolderBrowser
            onProjectOpened={handleProjectOpened}
            onNewProject={(parentPath) => {
              setNewProjectParent(parentPath);
              announce('New project form opened. Enter a folder name.');
            }}
          />

          {newProjectParent !== null ? (
            <NewProjectForm
              parentPath={newProjectParent}
              onCreated={handleProjectOpened}
              onCancel={() => setNewProjectParent(null)}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

interface ProjectSummary {
  id: string;
  canonicalPath: string;
  displayName: string;
  lastOpenedAt: string;
  isGitRepo: boolean;
  gitInitialized: boolean;
  slanPresent: boolean;
  slanDirectory: string | null;
  slanGitignoreCreated: boolean;
  chainCount: number;
  /** False when the count was not returned by the server on this view. */
  chainCountKnown: boolean;
}

type ProjectViewState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; error: ApiClientError }
  | { status: 'ready'; summary: ProjectSummary };

function summaryFromRegistration(project: ProjectRegistration): ProjectSummary {
  return {
    id: project.id,
    canonicalPath: project.canonicalPath,
    displayName: project.displayName,
    lastOpenedAt: project.lastOpenedAt,
    isGitRepo: project.isGitRepo,
    gitInitialized: project.gitInitialized,
    slanPresent: true,
    slanDirectory: project.slan.directory,
    slanGitignoreCreated: project.slan.gitignoreCreated,
    chainCount: project.slan.chainCount,
    chainCountKnown: true,
  };
}

function summaryFromListing(
  project: RecentProject,
  listing: DirectoryListing,
): ProjectSummary {
  const gitEntry = listing.entries.find((entry) => entry.name === '.git');
  const slanEntry = listing.entries.find(
    (entry) => entry.name === '.slan' && entry.isDirectory,
  );

  return {
    id: project.id,
    canonicalPath: project.canonicalPath,
    displayName: project.displayName,
    lastOpenedAt: project.lastOpenedAt,
    isGitRepo: gitEntry !== undefined,
    gitInitialized: false,
    slanPresent: slanEntry !== undefined,
    slanDirectory: slanEntry?.path ?? null,
    slanGitignoreCreated: false,
    chainCount: 0,
    chainCountKnown: false,
  };
}

/**
 * Project workspace route.
 *
 * The immediate post-registration view uses the exact server response. After a
 * reload, the same facts are reconstructed from the recent list plus a
 * metadata-only directory listing; file contents are never requested.
 */
export function ProjectPage({ projectId }: { projectId: string }) {
  const cached = recallProject(projectId);
  const [state, setState] = useState<ProjectViewState>(() =>
    cached === undefined
      ? { status: 'loading' }
      : { status: 'ready', summary: summaryFromRegistration(cached) },
  );
  const generation = useRef(0);
  const { announce } = useStatusAnnouncer();

  const loadProject = useCallback(async () => {
    const current = generation.current + 1;
    generation.current = current;

    const registered = recallProject(projectId);
    if (registered !== undefined) {
      setState({ status: 'ready', summary: summaryFromRegistration(registered) });
      return;
    }

    setState({ status: 'loading' });
    try {
      const recents = await projectsApi.listRecent();
      if (generation.current !== current) {
        return;
      }
      const recent = recents.find((entry) => entry.id === projectId);
      if (recent === undefined) {
        setState({ status: 'not-found' });
        return;
      }

      const listing = await projectsApi.listDirectory(recent.canonicalPath);
      if (generation.current !== current) {
        return;
      }
      setState({ status: 'ready', summary: summaryFromListing(recent, listing) });
    } catch (error) {
      if (generation.current !== current) {
        return;
      }
      setState({
        status: 'error',
        error: toApiClientError(
          error,
          'An unexpected error prevented loading this project.',
        ),
      });
    }
  }, [projectId]);

  useEffect(() => {
    void loadProject();
    return () => {
      generation.current += 1;
    };
  }, [loadProject]);

  useEffect(() => {
    if (state.status === 'ready') {
      announce(`Project ${state.summary.displayName} loaded.`);
    } else if (state.status === 'error') {
      announce(`Project could not be loaded: ${state.error.message}`);
    }
  }, [announce, state]);

  if (state.status === 'loading') {
    return (
      <section className="panel" aria-labelledby="project-loading-title">
        <h1 className="panel__title" id="project-loading-title">
          Project
        </h1>
        <p className="state-note">
          <span aria-hidden="true">◌</span> Loading project details…
        </p>
        <p className="panel__actions">
          <Link className="button button--secondary" to="/projects">
            Back to projects
          </Link>
        </p>
      </section>
    );
  }

  if (state.status === 'not-found') {
    return (
      <section className="panel panel--not-found" aria-labelledby="project-not-found-title">
        <h1 className="panel__title" id="project-not-found-title">
          Project not found
        </h1>
        <p>
          No recent project matches <code>{projectId}</code>. It may have been removed
          from recent projects, or the link may be incomplete.
        </p>
        <p className="panel__actions">
          <Link className="button" to="/projects">
            Back to projects
          </Link>
        </p>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="panel" aria-labelledby="project-error-title">
        <h1 className="panel__title" id="project-error-title">
          Project could not be loaded
        </h1>
        <InlineError
          title="Project request failed"
          message={state.error.message}
          code={state.error.code}
          httpStatus={state.error.status}
          onRetry={() => void loadProject()}
        />
        <p className="panel__actions">
          <Link className="button button--secondary" to="/projects">
            Back to projects
          </Link>
        </p>
      </section>
    );
  }

  const { summary } = state;

  return (
    <section className="panel project-summary" aria-labelledby="project-title">
      <p className="breadcrumb">
        <Link to="/projects">← Projects</Link>
      </p>
      <h1 className="panel__title" id="project-title">
        {summary.displayName}
      </h1>
      <p className="lede">
        This project is registered locally. Browse its skill catalog below; chain
        authoring arrives in a later screen.
      </p>

      <dl className="detail-grid project-facts">
        <div>
          <dt>Canonical path</dt>
          <dd>
            <code data-testid="project-canonical-path">{summary.canonicalPath}</code>
          </dd>
        </div>
        <div>
          <dt>Git</dt>
          <dd>
            {summary.isGitRepo ? (
              <span className="status-tag status-tag--ok" data-testid="project-git-state">
                <span aria-hidden="true">✓</span> Repository initialized
              </span>
            ) : (
              <span
                className="status-tag status-tag--warning"
                data-testid="project-git-state"
              >
                <span aria-hidden="true">○</span> Not a git repository
              </span>
            )}
            {summary.gitInitialized ? (
              <p className="field__hint">git init ran when this project was created.</p>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>.slan</dt>
          <dd>
            {summary.slanPresent ? (
              <span className="status-tag status-tag--ok" data-testid="project-slan-state">
                <span aria-hidden="true">✓</span> Initialized
              </span>
            ) : (
              <span
                className="status-tag status-tag--warning"
                data-testid="project-slan-state"
              >
                <span aria-hidden="true">○</span> Not detected
              </span>
            )}
            {summary.slanDirectory !== null ? (
              <p className="field__hint">
                <code data-testid="project-slan-directory">{summary.slanDirectory}</code>
              </p>
            ) : null}
            {summary.slanGitignoreCreated ? (
              <p className="field__hint">
                Created <code>.slan/.gitignore</code> with <code>runs/</code>.
              </p>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Chains found</dt>
          <dd>
            {!summary.chainCountKnown
              ? 'Not loaded on this screen'
              : summary.chainCount === 0
                ? 'No chains yet'
                : `${String(summary.chainCount)} chain file${summary.chainCount === 1 ? '' : 's'}`}
          </dd>
        </div>
      </dl>

      <div className="placeholder-grid">
        <section
          className="placeholder"
          aria-labelledby="project-chains-placeholder"
        >
          <h2 className="section-title" id="project-chains-placeholder">
            Chain library
          </h2>
          <p>
            The chain library placeholder. Creating, duplicating, and deleting chains
            arrives with chain authoring.
          </p>
        </section>
      </div>

      <SkillCatalog projectId={summary.id} context="project" />

      <p className="panel__actions">
        <Link className="button button--secondary" to="/projects">
          Open another project
        </Link>
      </p>
    </section>
  );
}
