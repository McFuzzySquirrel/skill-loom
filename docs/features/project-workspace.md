# Feature: Project Workspace

## Traceability

| Canonical ID | Owner / Source Link | Relationship |
|--------------|---------------------|--------------|
| US-02 | [Vision](../PRD.md#US-02) | participates |
| US-05 | [Vision](../PRD.md#US-05) | participates |
| PROJ-FR-01 | This feature | owns |
| PROJ-FR-02 | This feature | owns |
| PROJ-FR-03 | This feature | owns |
| PROJ-FR-04 | This feature | owns |
| PROJ-FR-05 | This feature | owns |
| PROJ-FR-06 | This feature | owns |

**PRD:** [docs/PRD.md](../PRD.md)

---

## 1. Feature Overview

**Feature Name:** Project Workspace
**ID Prefix:** PROJ
**Summary:** Choose or create the working directory a chain runs against, register it locally, keep recent projects, and initialize the project-local `.slan` data directory without scaffolding the user's code.
**Dependencies:** App Foundation
**Priority:** Must

The feature ends when the user can browse the filesystem, open or create a directory, see it in recent projects, and land on a project screen that later features extend with chains and catalog data.

---

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| PROJ-US-01 | solo builder | browse and select an existing project folder | the chain runs in the codebase I am working on | Must |
| PROJ-US-02 | solo builder | create an empty folder and optionally initialize git | I can start a fresh project without leaving Slan | Must |
| PROJ-US-03 | solo builder | reopen a recent project quickly | I do not navigate the filesystem every time | Must |
| PROJ-US-04 | solo builder | keep chains in the repository and run records out of git | recipes travel with the code and noisy run data does not | Must |

---

## 3. Functional Requirements

```forge-requirement
{"id":"PROJ-FR-01","kind":"requirement","text":"List directories for the server-side folder browser from any readable absolute path, canonicalize every requested path with realpath, return parent, entries, git status, and Slan-data presence, reject files and unreadable paths with typed errors, and never expose file contents."}
```

```forge-requirement
{"id":"PROJ-FR-02","kind":"requirement","text":"Register an existing directory or create a new empty directory under a selected parent, optionally run git init, reject a create target that already exists or whose parent is missing, and perform no scaffolding or template copying."}
```

```forge-requirement
{"id":"PROJ-FR-03","kind":"requirement","text":"Persist recent projects in global configuration with id, canonical path, display name, and lastOpenedAt; return newest first and allow removing an entry without deleting files."}
```

```forge-requirement
{"id":"PROJ-FR-04","kind":"requirement","text":"Create or extend <project>/.slan/ with a .gitignore containing runs/ when a project is first opened, never rewrite an existing .gitignore, never delete files, and detect existing chains."}
```

```forge-requirement
{"id":"PROJ-FR-05","kind":"requirement","text":"Provide a project screen that browses and lists directories, accepts a typed absolute path, opens a recent project, creates a folder with optional git init, and shows loading, empty, invalid-path, and server-error states."}
```

```forge-requirement
{"id":"PROJ-FR-06","kind":"requirement","text":"Expose project APIs for listing directories, opening or creating a project, listing recent projects, and removing a recent entry, all returning the shared error envelope."}
```

| ID | Priority |
|----|----------|
| PROJ-FR-01 | Must |
| PROJ-FR-02 | Must |
| PROJ-FR-03 | Must |
| PROJ-FR-04 | Must |
| PROJ-FR-05 | Must |
| PROJ-FR-06 | Must |

---

## 4. UI / Interaction Design

The projects route opens on a two-column layout. The left column lists recent projects with name, canonical path, and last-opened time. The right column is a folder browser: an editable absolute-path field, Up and Home actions, a directory list, and an "Open this folder" action. Selecting a directory navigates into it; opening a directory registers it and navigates to the project workspace.

"New project" opens a compact form: parent directory (prefilled from the browser), folder name, and an "Initialize git repository" checkbox. The form validates the folder name inline, disables submission while creating, and on success opens the new project. The form never offers templates.

Once a project is open, the project route shows its canonical path, git state, `.slan` state, chain library placeholder, and a catalog placeholder. Opening a project with missing or unreadable data shows an inline error while keeping recent projects usable.

The local-only notice from the shell remains visible. Removing a recent project requires a confirmation that says files are not deleted.

---

## 5. Implementation Tasks

### Phase 1: Filesystem and Project APIs

```forge-task
{
  "id": "PROJ-01",
  "title": "Implement the server-side folder browser",
  "description": "Implement canonical path resolution and directory listing for the folder browser. Accept any readable absolute path, resolve it with realpath, reject files, non-directories, and unreadable paths with typed errors, and return the canonical path, parent, entries with name/path/isDirectory/isGitRepo/hasSlan, and a truncated flag. Sort directories before files and hide unreadable children without failing the listing. Register GET /api/fs through src/server/routes/index.ts. Add tests/unit/projects-paths.test.ts for canonicalization, traversal rejection, and symlink handling, and tests/integration/fs-routes.test.ts for listing, file rejection, and unreadable paths. Do not register projects or read file contents.",
  "ownerAgent": "backend-engineer",
  "dependencies": ["FOUND-03"],
  "expectedOutputs": [
    "src/server/projects/paths.ts",
    "src/server/projects/browser.ts",
    "src/server/routes/fs.ts",
    "src/server/routes/index.ts",
    "tests/unit/projects-paths.test.ts",
    "tests/integration/fs-routes.test.ts"
  ],
  "validationCommands": [
    "npx vitest run tests/unit/projects-paths.test.ts tests/integration/fs-routes.test.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/project-workspace.md#PROJ-FR-01", "docs/features/project-workspace.md#PROJ-FR-06"],
    "acceptanceCriteria": [
      "Relative and non-absolute paths are rejected or resolved against the documented base, never silently accepted",
      "The returned path is canonical and matches realpath",
      "A file path returns a typed not-a-directory error",
      "An unreadable child is omitted while the listing succeeds",
      "The integration test reaches GET /api/fs through src/server/app.ts"
    ],
    "constraints": ["Do not read or return file contents", "Do not use shell commands for listing"],
    "constraintRefs": ["docs/PRD.md#ARCH-03", "docs/PRD.md#SEC-01", "docs/PRD.md#SEC-03"],
    "references": ["docs/PRD.md#6.3 Key APIs and Interfaces", "docs/PRD.md#8.2 Risk Acceptance"]
  }
}
```

```forge-task
{
  "id": "PROJ-02",
  "title": "Register projects, recent entries, and .slan initialization",
  "description": "Implement the project registry. Open an existing directory by canonical path and assign a stable id derived from the path; create a new empty directory under a selected parent with an optional git init; reject existing targets and missing parents. Persist recent projects in the global config with id, canonical path, display name, and lastOpenedAt, return them newest first, and remove an entry without touching the filesystem. On first open, create <project>/.slan with a .gitignore containing runs/ when absent, preserve an existing .slan/.gitignore, and report existing chains. Register POST /api/projects, GET /api/projects/recent, and DELETE /api/projects/recent/:projectId through src/server/routes/index.ts. Add tests/unit/project-registry.test.ts and tests/integration/projects-routes.test.ts covering open, create, git init success and failure, recent ordering, removal, and idempotent .slan setup. Do not create chains or run directories here.",
  "ownerAgent": "backend-engineer",
  "dependencies": ["PROJ-01", "FOUND-02"],
  "expectedOutputs": [
    "src/server/projects/registry.ts",
    "src/server/routes/projects.ts",
    "src/server/routes/index.ts",
    "tests/unit/project-registry.test.ts",
    "tests/integration/projects-routes.test.ts"
  ],
  "validationCommands": [
    "npx vitest run tests/unit/project-registry.test.ts tests/integration/projects-routes.test.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/project-workspace.md#PROJ-FR-02", "docs/features/project-workspace.md#PROJ-FR-03", "docs/features/project-workspace.md#PROJ-FR-04", "docs/features/project-workspace.md#PROJ-FR-06"],
    "acceptanceCriteria": [
      "Opening the same canonical path twice returns the same project id",
      "Creating an existing directory fails with a conflict and leaves it untouched",
      "The optional git init creates a repository only when requested and git is available",
      "Recent projects are returned newest first and removal leaves the directory intact",
      "First open creates .slan/.gitignore with runs/ and preserves an existing file",
      "All project routes are registered through src/server/routes/index.ts"
    ],
    "constraints": ["Do not copy templates or scaffold application code", "Do not delete project files"],
    "constraintRefs": ["docs/PRD.md#ARCH-04", "docs/PRD.md#PRIV-02", "docs/PRD.md#SEC-01"],
    "references": ["docs/PRD.md#6.3 Key APIs and Interfaces", "docs/PRD.md#10.1 Project"]
  }
}
```

### Phase 2: Project Screen

```forge-task
{
  "id": "PROJ-03",
  "title": "Build the project selection screen",
  "description": "Replace the placeholder projects route with the real project screen. Implement recent projects, the folder browser, typed path entry, Up/Home navigation, open-folder action, and the new-project form with optional git init. Show loading, empty, invalid-path, and server-error states; keep recent projects usable when a path fails. On success, navigate to the project route and show canonical path, git state, and .slan state. Add tests/e2e/projects.spec.ts covering open existing, create with and without git, invalid path, recent ordering, removal confirmation, and keyboard-only selection. Do not implement chain or catalog content beyond placeholders.",
  "ownerAgent": "frontend-engineer",
  "dependencies": ["PROJ-02"],
  "expectedOutputs": [
    "src/web/routes/ProjectsPage.tsx",
    "src/web/components/FolderBrowser.tsx",
    "src/web/components/RecentProjects.tsx",
    "src/web/components/NewProjectForm.tsx",
    "src/web/api/projects.ts",
    "tests/e2e/projects.spec.ts"
  ],
  "validationCommands": [
    "npx playwright test tests/e2e/projects.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/project-workspace.md#PROJ-FR-05"],
    "acceptanceCriteria": [
      "The reviewer can open a recent project and an arbitrary directory through the browser",
      "Creating a folder with git init enabled produces a repository and opens the project",
      "An invalid path shows an inline error without clearing recent projects",
      "The browser and new-project form are operable with the keyboard alone",
      "Removing a recent project requires confirmation and does not delete files",
      "The Playwright test drives the screen through src/web/App.tsx and the real API"
    ],
    "constraints": ["Do not add templates or scaffolding options", "Do not hide server errors behind a generic empty state"],
    "constraintRefs": ["docs/PRD.md#NFR-UX-01", "docs/PRD.md#A11Y-01", "docs/PRD.md#A11Y-02"],
    "references": ["docs/features/project-workspace.md#4. UI / Interaction Design", "docs/PRD.md#10.1 Project"]
  }
}
```

---

## 6. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit | Path canonicalization, project registry, recent ordering, .slan setup | Vitest with temporary directories and injected config paths |
| Integration | `/api/fs`, `/api/projects`, recent removal | Fastify `inject` through the composition root |
| Browser | Folder browser, recent projects, create form, keyboard flow | Playwright with an isolated temporary home and config directory |
| Human | Practical usability of project selection | Covered by the primary-journey review |

Key test scenarios:

1. A relative path and a file path are rejected with typed errors.
2. Opening the same directory twice yields the same project id.
3. Creating a duplicate folder fails without modifying it.
4. `.slan/.gitignore` contains `runs/` and is not rewritten on the second open.
5. Removing a recent project leaves its directory and chains intact.

---

## 7. Acceptance Criteria

1. The user can browse any readable directory and open it as a project.
2. The user can create an empty folder with optional git initialization.
3. Recent projects persist across restarts, newest first, and can be removed without file deletion.
4. Opening a project creates the `.slan` directory and the `runs/` ignore rule exactly once.
5. The project screen exposes loading, empty, invalid, and error states and is keyboard-operable.
6. Project APIs are reachable through the Fastify composition root and use the shared envelope.

---

## 8. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Should the browser hide hidden directories? | Show them; the user may keep projects under dot-directories. |
| 2 | Should creating a project require the parent to be inside `$HOME`? | No; the owner chose no browse restriction, so any writable parent is allowed. |
| 3 | Should `git init` use a specific default branch name? | Use the installed git default and record the result; do not pass a branch flag in v1. |
