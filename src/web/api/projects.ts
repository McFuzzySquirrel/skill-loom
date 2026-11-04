import {
  ApiClientError,
  requestJson,
  type FetchLike,
  type RequestJsonOptions,
} from './client';

/**
 * Typed client for the project-workspace API surface.
 *
 * Every response is decoded before it reaches a component, so a shape change
 * surfaces as an `ApiClientError` instead of a render crash. The browser never
 * derives a path from a project id and never touches the filesystem itself.
 */

/** One persisted recent-project entry. */
export interface RecentProject {
  id: string;
  canonicalPath: string;
  displayName: string;
  lastOpenedAt: string;
}

/** Project-local `.slan` state returned by open/create. */
export interface ProjectSlanState {
  directory: string;
  /** True only when this request created `.slan/.gitignore`. */
  gitignoreCreated: boolean;
  chainCount: number;
  hasChains: boolean;
}

/** The registered project returned by `POST /api/projects`. */
export interface ProjectRegistration {
  id: string;
  canonicalPath: string;
  displayName: string;
  lastOpenedAt: string;
  isGitRepo: boolean;
  gitInitialized: boolean;
  slan: ProjectSlanState;
}

/** One child in a folder-browser listing. */
export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isGitRepo: boolean;
  hasSlan: boolean;
}

/** The documented `GET /api/fs?path=` response. */
export interface DirectoryListing {
  path: string;
  parent: string | null;
  entries: DirectoryEntry[];
  truncated: boolean;
}

export interface CreateProjectInput {
  parentPath: string;
  name: string;
  gitInit?: boolean;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface ProjectsApi {
  listRecent: (options?: RequestOptions) => Promise<RecentProject[]>;
  removeRecent: (
    projectId: string,
    options?: RequestOptions,
  ) => Promise<{ projectId: string; removed: true }>;
  listDirectory: (path: string, options?: RequestOptions) => Promise<DirectoryListing>;
  openProject: (path: string, options?: RequestOptions) => Promise<ProjectRegistration>;
  createProject: (
    input: CreateProjectInput,
    options?: RequestOptions,
  ) => Promise<ProjectRegistration>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function invalidResponse(what: string): ApiClientError {
  return new ApiClientError(
    `The Slan server returned an unexpected ${what} response.`,
    { code: 'INVALID_RESPONSE', status: 200 },
  );
}

/** Coerce an unknown thrown value into the shared typed client error. */
export function toApiClientError(
  error: unknown,
  fallbackMessage = 'An unexpected error prevented the request.',
): ApiClientError {
  if (error instanceof ApiClientError) {
    return error;
  }
  return new ApiClientError(fallbackMessage, { code: 'UNKNOWN_ERROR', status: 0 });
}

function decodeRecentProject(value: unknown): RecentProject {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.canonicalPath) ||
    !isNonEmptyString(value.displayName) ||
    !isNonEmptyString(value.lastOpenedAt)
  ) {
    throw invalidResponse('recent project');
  }

  return {
    id: value.id,
    canonicalPath: value.canonicalPath,
    displayName: value.displayName,
    lastOpenedAt: value.lastOpenedAt,
  };
}

function decodeSlanState(value: unknown): ProjectSlanState {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.directory) ||
    typeof value.gitignoreCreated !== 'boolean' ||
    typeof value.chainCount !== 'number' ||
    !Number.isInteger(value.chainCount) ||
    value.chainCount < 0 ||
    typeof value.hasChains !== 'boolean'
  ) {
    throw invalidResponse('.slan state');
  }

  return {
    directory: value.directory,
    gitignoreCreated: value.gitignoreCreated,
    chainCount: value.chainCount,
    hasChains: value.hasChains,
  };
}

function decodeProjectRegistration(value: unknown): ProjectRegistration {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.canonicalPath) ||
    !isNonEmptyString(value.displayName) ||
    !isNonEmptyString(value.lastOpenedAt) ||
    typeof value.isGitRepo !== 'boolean' ||
    typeof value.gitInitialized !== 'boolean'
  ) {
    throw invalidResponse('project');
  }

  return {
    id: value.id,
    canonicalPath: value.canonicalPath,
    displayName: value.displayName,
    lastOpenedAt: value.lastOpenedAt,
    isGitRepo: value.isGitRepo,
    gitInitialized: value.gitInitialized,
    slan: decodeSlanState(value.slan),
  };
}

function decodeDirectoryEntry(value: unknown): DirectoryEntry {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.name) ||
    !isNonEmptyString(value.path) ||
    typeof value.isDirectory !== 'boolean' ||
    typeof value.isGitRepo !== 'boolean' ||
    typeof value.hasSlan !== 'boolean'
  ) {
    throw invalidResponse('directory entry');
  }

  return {
    name: value.name,
    path: value.path,
    isDirectory: value.isDirectory,
    isGitRepo: value.isGitRepo,
    hasSlan: value.hasSlan,
  };
}

function decodeDirectoryListing(value: unknown): DirectoryListing {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.path) ||
    (value.parent !== null && !isNonEmptyString(value.parent)) ||
    !Array.isArray(value.entries) ||
    typeof value.truncated !== 'boolean'
  ) {
    throw invalidResponse('directory listing');
  }

  return {
    path: value.path,
    parent: value.parent,
    entries: value.entries.map(decodeDirectoryEntry),
    truncated: value.truncated,
  };
}

function optionsFor(signal: AbortSignal | undefined): RequestJsonOptions {
  return signal === undefined ? {} : { signal };
}

/**
 * Successful registrations are cached for this browser session so the project
 * route can show the exact git and `.slan` result without a second request.
 * Reloads fall back to the recent list plus a metadata-only directory listing.
 */
const registrationCache = new Map<string, ProjectRegistration>();

export function rememberProject(project: ProjectRegistration): void {
  registrationCache.set(project.id, project);
}

export function recallProject(projectId: string): ProjectRegistration | undefined {
  return registrationCache.get(projectId);
}

export function createProjectsApi(fetchImpl: FetchLike = fetch): ProjectsApi {
  return {
    async listRecent(options: RequestOptions = {}): Promise<RecentProject[]> {
      const value = await requestJson<unknown>(
        '/api/projects/recent',
        optionsFor(options.signal),
        fetchImpl,
      );
      if (!isRecord(value) || !Array.isArray(value.projects)) {
        throw invalidResponse('recent projects');
      }
      return value.projects.map(decodeRecentProject);
    },

    async removeRecent(
      projectId: string,
      options: RequestOptions = {},
    ): Promise<{ projectId: string; removed: true }> {
      const value = await requestJson<unknown>(
        `/api/projects/recent/${encodeURIComponent(projectId)}`,
        {
          method: 'DELETE',
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      if (
        !isRecord(value) ||
        !isNonEmptyString(value.projectId) ||
        value.removed !== true
      ) {
        throw invalidResponse('recent-project removal');
      }
      return { projectId: value.projectId, removed: true };
    },

    async listDirectory(
      path: string,
      options: RequestOptions = {},
    ): Promise<DirectoryListing> {
      const value = await requestJson<unknown>(
        `/api/fs?path=${encodeURIComponent(path)}`,
        optionsFor(options.signal),
        fetchImpl,
      );
      return decodeDirectoryListing(value);
    },

    async openProject(
      path: string,
      options: RequestOptions = {},
    ): Promise<ProjectRegistration> {
      const value = await requestJson<unknown>(
        '/api/projects',
        {
          method: 'POST',
          body: { mode: 'open', path },
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      if (!isRecord(value) || value.project === undefined) {
        throw invalidResponse('project registration');
      }
      return decodeProjectRegistration(value.project);
    },

    async createProject(
      input: CreateProjectInput,
      options: RequestOptions = {},
    ): Promise<ProjectRegistration> {
      const body: Record<string, unknown> = {
        mode: 'create',
        parentPath: input.parentPath,
        name: input.name,
      };
      if (input.gitInit !== undefined) {
        body.gitInit = input.gitInit;
      }

      const value = await requestJson<unknown>(
        '/api/projects',
        {
          method: 'POST',
          body,
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      if (!isRecord(value) || value.project === undefined) {
        throw invalidResponse('project registration');
      }
      return decodeProjectRegistration(value.project);
    },
  };
}

/** Same-origin client; Vite proxies /api in development. */
export const projectsApi = createProjectsApi();
