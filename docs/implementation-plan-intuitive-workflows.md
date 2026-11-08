# Implementation plan: intuitive workflows and scenario discovery

**Status:** Proposed; this document describes future work, not existing behavior.

## Outcome

Make the first choice in Skill Loom about the user's goal rather than the
application's storage types. Support two clear, connected journeys:

1. Discover skills and create reusable, project-independent scenarios and
   chains, including a handoff to an agent in an existing CLI session.
2. Open an existing repository, inspect its skills, and build or run chains in
   that project's workspace.

Users must be able to select all available skills as **candidates for
discovery**, without automatically adding them as chain steps. A reviewed
result must be usable in a compatible CLI through `loom-run-bundle` and
discoverable in a project-independent library.

## Current state and constraints

- `/` redirects to `/chains`. The sidebar in `src/web/components/AppLayout.tsx`
  exposes drafts, templates, shared bundles, projects, scenarios, and sources
  as peers, but does not explain the journeys between them.
- `src/web/routes/GlobalDraftsPage.tsx` can register and refresh remote sources
  and seed a draft with a goal instruction. It does **not** recommend scenarios
  or hold a separate candidate selection. Its draft catalog exposes remote
  snapshots only.
- `src/web/components/SkillCatalog.tsx` adds one skill as a chain step at a
  time. Search is server-filtered through `useCatalog`; the current result is
  not necessarily the complete catalog.
- `.github/skills/scenario-discovery` and `skill/scenario-discovery` currently
  inspect project-local packages only. Their bundle helper requires packages
  beneath a declared project root. They cannot consume Loom's retained remote
  snapshots as a project-independent selection.
- Drafts, global templates, and shared bundles have different persistence and
  operations. Templates are independent chain snapshots, but export currently
  requires a project copy. Drafts can be exported directly. Shared bundles are
  portable files in a configured directory; the current publish API accepts
  only a draft or project chain. Project bundle import installs skills into the
  selected project.
- Bundle execution is mediated by the `loom-run-bundle` skill in a compatible
  host; it is not a standalone CLI that starts a harness. Bundle v2 with a
  selected native agent cannot currently be prepared by that portable runner.
- Preserve ADR-0015's pinned-snapshot and explicit-fetch boundaries, ADR-0019's
  project-independent draft separation, ADR-0020's reviewed, no-overwrite
  publication, and the existing run/preflight trust and permission boundaries.

## Product and interaction design

### Entry point and navigation

- Introduce a **Start** page at `/` instead of redirecting to `/chains`; retain
  `/chains` and all other existing paths and deep links. Update the wordmark,
  breadcrumb, route title, help topic, and shell tests accordingly.
- Present three primary cards with descriptive actions, not just icons:
  **Discover reusable workflows** → discovery workspace; **Work in a
  repository** → `/projects`; **Browse examples and saved work** → a library
  overview. The start page must not require a project or a configured harness.
- Group sidebar destinations under understandable headings while retaining
  direct access to projects, skills/sources, drafts, examples, templates,
  shared bundles, test workspaces, and help. On narrow screens retain the
  existing keyboard-operable mobile menu and current-page indication.
- Add a library overview that distinguishes:
  **Drafts** (editable, project-independent chains), **Chain templates**
  (independent snapshots copied into projects), **Shared bundles** (reviewed
  portable files), and **Scenario examples** (illustrative recipes copied into
  projects). Link to existing screens instead of silently merging storage.
- On the project chooser, draft list, source management, example catalog, and
  library screens, add short, contextual links to the next relevant action.
  Empty and error states should explain what is possible without a project.

### Visual direction

Use the existing design tokens and light/dark theme as the foundation. Introduce
more generous spacing, clear section hierarchy, concise action-oriented copy,
and consistent cards with distinct primary and secondary actions. Use
responsive layouts that stack naturally, preserve readable line lengths, and
avoid using color alone to distinguish states. Keep the local-only notice,
visible focus, breadcrumbs, current project context, and existing run controls.
Avoid a redesign that changes chain execution semantics or obscures advanced
options.

### Discovery workspace

Add a dedicated discovery route, linked from Start and drafts, with a staged
flow that allows users to move back without losing their current choices:

1. **Outcome and harness:** enter a goal and choose OpenCode or Copilot CLI.
   Explain that this prepares a handoff; it does not launch a model, fetch a
   repository, create a chain, or execute a skill.
2. **Sources:** browse already refreshed remote snapshots and link to register
   or refresh sources. Make network access explicit and show source, pinned
   revision, and errors. Existing project-local discovery remains a separate
   project-based route; do not silently mix project, personal, and remote
   sources into the project-independent catalog.
3. **Candidates:** search and inspect package metadata and `SKILL.md`, then
   select individual packages or **Select all available skills**. Show selected
   and total eligible counts, and offer **Clear selection** and individual
   deselection. Native agents are not skills and are not included.
4. **Review and hand off:** show goal, harness, exact selected identities,
   package inventories and contents, and trust/privacy warnings. Prepare a
   downloadable discovery handoff plus clear instructions for opening it in an
   existing compatible CLI session using `scenario-discovery`. Provide a
   copyable prompt with a clearly marked placeholder for the handoff's actual
   local path; do not assume the browser download location.
5. **Use the result:** explain how to review the agent's proposals, approve a
   final chain, save the resulting `.loom.json` bundle to the shared bundle
   library, or import it into a project. Link to the reusable runner skill and
   its installation instructions.

The existing **Start from a goal** draft path remains a manual authoring option;
distinguish it from agent-assisted discovery and do not call it automatic
discovery. Users can also start a blank draft without going through discovery.

### Selection contract

- A candidate is an enabled remote skill with a complete, resolvable pinned
  identity. Identify it by harness, source ID, revision, and repository-relative
  package path, not by name, array position, or transient row visibility.
- **Select all available skills** selects every eligible package in the
  unfiltered catalog for the chosen harness, including collapsed groups and
  items hidden by search. State that scope next to the button. Search only
  changes visibility; the selection and selected count survive filtering.
  **Clear selection** clears the entire candidate set, including hidden rows.
- Fetch or maintain a complete unfiltered catalog independently of the visible
  query. Never equate the current server-filtered response with all skills.
  Disable bulk actions until that complete catalog is current; distinguish
  loading, refresh, empty, warning, and failed states.
- Deduplicate by exact identity, not skill name. Show same-named packages with
  source and revision. They may be candidates, but a final portable bundle
  cannot contain two packages with the same skill name; require an explicit
  choice when a proposed chain would be ambiguous.
- Changing harness clears the selection with an explicit confirmation when
  nonempty. On refresh, retain exact identities that still resolve and show
  unavailable or changed candidates as blocking items; never silently replace
  them with newer revisions. Users can remove or explicitly reselect them.
- Selection is transient workspace state in the first release, separate from
  draft and chain schemas. Warn before navigation or reload would discard a
  nonempty selection or goal, using the existing navigation and unload guard
  patterns. A prepared/downloaded handoff is an independent snapshot; later
  catalog changes do not mutate it.
- If all selected packages exceed handoff limits, keep the full selection and
  explain the precise limit and how to reduce it. Never silently truncate
  **Select all**. Block handoff with zero candidates, invalid identity,
  unresolved packages, or incomplete review.

## Technical design

### 1. Discovery handoff artifact

Create a separate, versioned JSON format, e.g.
`skill-loom-discovery-handoff` version 1, with a distinct filename such as
`*.loom-discovery.json`. It is **not** a `skill-loom-chain` bundle and must not
be accepted by chain import or execution APIs.

The artifact contains the goal, chosen harness, creation metadata, and the
selected candidate packages as bounded regular-file content with relative
paths and executable flags. Each candidate records its exact source ID,
revision, repository-relative package path, package name, and verified content
fingerprint. Avoid absolute machine paths, credentials, input defaults, run
history, and repository URLs; warn that the goal and package contents may
still contain private information or redistribution-restricted material.
Define an explicit strict schema and canonical fingerprint algorithm shared by
the server and standalone helper. Apply the existing portable-bundle path,
file-type, excluded-name, canonical encoding, and collision checks.

Start with the existing bundle limits as explicit aggregate handoff limits:
100 packages, 2,000 files, and 20 MiB decoded content, with an explicit bounded
JSON request/response size. Provide actionable errors; do not silently drop
packages or files. If these limits later change, version the contract and test
both producer and consumer.

Add a server-side preparation endpoint and typed web client. Accept only the
goal, harness, and selected immutable identities—not arbitrary filesystem paths
or client-supplied package bytes. Resolve each identity against the retained
remote snapshot, verify the recorded package fingerprint and complete content,
and reject unavailable, tampered, ambiguous, or unsafe packages. Reuse or
extract the bounded package collection and validation primitives from
`src/server/chains/bundle.ts`, `src/portable/bundle.ts`, and
`src/server/catalog/remote.ts` rather than implementing a weaker second path.
Catalog warnings must remain visible and must not become an empty-success
fallback.

Bind review to the actual bytes: prepare a fingerprinted artifact, display its
complete file inventory and contents for review, then require explicit
confirmation before download. Either download the exact immutable prepared
bytes held by the client or regenerate and compare the fingerprint before
download; do not allow a refreshed source or changed selection to inherit an
earlier confirmation. Do not retain handoffs on the server by default.

### 2. CLI agent workflow

Extend both checked-in `scenario-discovery` skill copies and their packaging
helper consistently. Add a standalone, Node.js 24+ handoff reader that works
without a running Skill Loom server and validates the entire artifact before
exposing metadata or file content to the host. It must reject malformed,
oversized, traversing, duplicated, tampered, or unsupported-version input
without executing package code or making network requests.

The skill must:

- Treat the handoff goal and package text as untrusted data, inspect only the
  selected candidates, and explain any unavailable or invalid content.
- Propose up to three distinct scenarios; selecting all candidates is not an
  instruction to use them all. Ask the user to select and revise a proposal.
- Show the complete proposed chain, target harness, session mode, named inputs,
  package inventories, and relevant contents. Require explicit approval before
  creating a bundle, and separate redistribution review from execution consent.
- Build a normal v1 `.loom.json` bundle using **only** the exact approved,
  referenced packages from the validated handoff. Preserve executable flags;
  enforce the same bundle parser and size/path rules and refuse ambiguous
  same-name choices. Write a new output file exclusively, without overwrite.
  Do not reinterpret artifact paths as absolute paths, weaken the existing
  project-root restriction, or install packages into the host project.
- Never import or run the resulting chain. Native-agent selection is outside
  this v1 handoff; direct users needing it to the Loom designer and managed run.

Keep the current project-local `scenario-discovery` mode working. Add a
downloadable, versioned skill package for users whose CLI host does not already
have the updated discovery skill: follow the existing portable runner build and
download pattern, include necessary license notices, and document installation
and host refresh. Ensure checked-in copies and packaged output stay in sync;
do not assume that `skill/scenario-discovery` is currently included in the
published `dist/skills` artifacts.

### 3. Project-independent result library

Extend the shared bundle library with a **Review and add bundle** flow for a
locally selected `.loom.json` file, without requiring a project. Preview with
the existing strict bundle parser and `BundleContents` review UI, including
instructions, complete package inventory/content, and native agent if present.
Require explicit content and redistribution confirmations. Publish the exact
reviewed bytes or validate and compare a fingerprint at publication; use the
existing bounded, atomic, no-overwrite shared-library publication mechanism.
Keep configured-directory errors, invalid bundles, collisions, and unsupported
files explicit. No arbitrary server-side path supplied by the browser should
be treated as a file to publish.

Add review/download actions on available library entries that do not require a
project; keep **Import into project** separate and explicitly project-scoped.
Show the runner skill download and explain its limitations, including v2
selected-agent incompatibility. Library publication does not execute content,
install skills, or establish redistribution rights. A shared bundle is not an
editable draft; editing it still requires an explicit project import in this
scope. Do not claim that the existing global template library can export a
template directly.

### 4. Accessibility and safety

- Preserve one main landmark, the skip link, visible focus, native control
  semantics, and the existing status announcer. Use descriptive headings and
  labels, keyboard-operable bulk/individual selection, and text status.
- Announce selection count changes and errors without announcing every row in
  a bulk action. Keep focus predictable when a filter hides a selected item.
  Review dialogs, if used, must have accessible names, focus management,
  Escape behavior, and focus return.
- Reuse the router's dirty-navigation and `beforeunload` protections. Never
  discard a draft, selection, or goal silently, and do not block navigation
  after a confirmed discard.
- No new automatic network access, model invocation, repository checkout,
  package script execution, project installation, or broad permissions.
  Review is not a safety guarantee; host permissions and user consent remain
  authoritative. Keep inputs and secrets out of handoff examples.

## Implementation sequence

1. **Shell and information architecture:** add Start and library overview,
   regroup navigation, update links, titles, help, responsive styles, and
   existing route assertions. Preserve old URLs.
2. **Selection workspace:** implement the goal/source/candidate UI, unfiltered
   catalog loading and stable identity selection, bulk controls, refresh and
   harness-change handling, dirty guards, and keyboard/status behavior. Keep
   handoff action unavailable until the producer is implemented.
3. **Handoff producer:** define and validate the versioned schema, extract
   shared package verification/collection utilities, implement preparation and
   review/download with strict limits and stable fingerprints.
4. **Standalone consumer:** extend both discovery skill copies, build and
   package the helper, implement safe inspection and bundle creation from
   approved handoff candidates, and retain project-local compatibility.
5. **Library return path:** add reviewed bundle upload/publication and
   project-free review/download, then connect discovery and CLI instructions.
6. **Documentation and release readiness:** update `README.md`,
   `docs/user-guide.md`, `docs/admin-guide.md`, `docs/OPERATIONS.md`, help
   topics, in-app guide text, and relevant ADRs. Update ADR-0019 to distinguish
   manual goal drafts from the new explicit agent handoff; document the new
   handoff and library publication decisions without implying old behavior
   already supported them.

Each phase should land with its focused tests; ship the end-to-end entry point
only when the handoff consumer and library return path are available. If phases
are released separately, hide unfinished actions or label them unavailable
rather than presenting a nonfunctional workflow.

## Verification and acceptance

- **Navigation:** fresh users can reach discovery, remote-source registration,
  project opening, drafts, examples, and both libraries from Start; old direct
  URLs, project breadcrumbs, mobile navigation, and dirty guards still work.
- **Selection:** individual and bulk selection work across multiple sources,
  revisions, duplicate names, collapsed groups, search, zero results, loading,
  warnings, refresh, unavailable identities, and harness changes. Assert that
  Select all includes hidden eligible results, excludes native agents and
  ineligible entries, adds no chain steps, and does not silently truncate over
  limits.
- **Handoff:** integration tests use isolated snapshots and verify exact pinned
  bytes and fingerprints; check stale review, modified snapshots, missing
  packages, invalid identities, path traversal, symlinks, special files,
  excluded files, limits, and error responses. Confirm no fetch, script
  execution, project modification, or unexpected server persistence occurs.
- **CLI:** run the packaged helper against valid and adversarial artifacts
  without the server; verify proposal inputs are limited to selected
  candidates, packaging includes only approved referenced packages, existing
  files are not overwritten, and the generated bundle passes the existing
  parser and portable runner inspection. Exercise both skill copies and the
  pre-existing project-local helper flow.
- **Library:** test project-free review, publication, listing and download;
  stale review, malformed bundles, missing directory, publication collisions,
  no-overwrite behavior, and project import remain correctly handled. Verify
  that adding a bundle neither installs nor runs it.
- **Accessible UX:** keyboard-only journey from Start through candidate
  selection, review, handoff, and library publication at desktop and mobile
  widths; visible focus, meaningful labels, one status announcement per
  transition, and both light and dark themes. Check that unsaved work is
  protected on in-app navigation, browser back, and unload.
- Add focused unit and integration coverage alongside
  `tests/integration/drafts-routes.test.ts`,
  `tests/integration/chain-bundles.test.ts`, and
  `tests/integration/shared-bundle-routes.test.ts`; add browser coverage
  alongside `tests/e2e/shell.spec.ts`, `tests/e2e/chain-builder.spec.ts`, and
  `tests/e2e/shared-bundles.spec.ts`. Use Playwright's isolated config/home and
  deterministic fixtures rather than real user repositories or credentials.
- Before release, run the focused suites, `npm run typecheck`, `npm run check`,
  and relevant package/portable-skill smoke checks; expand to the full suites
  when shared validation, navigation, or packaging changes warrant it.

## Out of scope

Launching or managing a discovery agent in the web app, hosted collaboration,
automatic skill recommendations in the browser, automatic remote refresh,
automatic package installation, native-agent switching in the portable runner,
and merging drafts, templates, and shared bundles into one storage format.
