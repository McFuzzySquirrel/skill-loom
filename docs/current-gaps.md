# Known gaps and follow-up work

This page is the current list of capabilities that are implemented only in part, deliberately blocked, or not yet verified. It replaces the tracking role of the historical [standalone CLI plan](archive/standalone-cli-plan.md). Nothing here is shipped behavior unless the linked documentation says so.

## Execution gates

| Area | Status | What is missing |
|---|---|---|
| Protected managed skill execution | Blocked | A verified protected content view and a harness-resolution boundary are still required before managed execution of untrusted skill content can be claimed. |
| Descendant containment | Open | Verified native containment is required on Linux, macOS, and Windows. Direct-child exit, a terminal status, or operator confirmation does not prove descendants stopped. |
| Automatic OpenCode advancement | Partially verified | The record-aware parser passed a user-supplied OpenCode 2.2.6 probe (`docs/evidence/live-execution-2026-11-10-opencode-2.2.6-passed.json`). A managed multi-step automatic journey is still unverified, so automatic CLI starts remain blocked and supervised runs are unaffected. |
| Platform and version coverage | Partial | Historical evidence covers Linux ARM64 with OpenCode 2.2.5 and Copilot CLI 1.0.105. The latest passing execution probe covers Linux x64 with OpenCode 2.2.6 and Copilot CLI 1.0.107, with a Copilot exact-version warning. |
| Windows PowerShell 7 | Implemented, verification pending | Windows profile security prefers PowerShell 7 and falls back to 5.1 only for availability. Native PowerShell 7 verification remains pending. See the [administrator guide](admin-guide.md#identity-secrets-and-tls). |

## Packaging and release

- There is no npm registry release or Git release tag. The package is `"private": true`, and the supported install is from a locally packed tarball.
- Publishing requires repository/release metadata, a verified package name, `npm run test:package`, and a decision about the upgrade and rollback path.
- A published registry install removes the tarball-path requirement in the npm `allow-scripts` workaround; see [Install globally](../README.md#install-globally) in the README.

## Product scope

- One harness per chain. Per-step harness switching and per-step model selection are not supported.
- The web surface is limited to the visual chain editor. Projects, catalogs, discovery, libraries, test workspaces, and runs are CLI- and skill-driven.
- The global chain-template and shared-bundle-library interfaces were removed by [ADR-0027](adr/0027-cli-and-skill-driven-workflow.md) and [ADR-0028](adr/0028-single-purpose-chain-editor.md). Retained files under the config directory have no current command.
- Portable bundle runners cannot prepare a bundle that selects a native agent; use the managed run path for those bundles.
- Managed discovery workspaces do not accept locally authored skills. The reviewed per-gap authoring flow is supported in the project-local and downloaded-handoff paths; extending the managed result model needs a reachable create/preview/import surface and a local-origin binding first. See [ADR-0029](adr/0029-authored-skill-gap-flow.md).

## Quality gates

| Area | Status | What is missing |
|---|---|---|
| Chain editor UI tests | Open | The Playwright suite was retired with the broader web app, and no DOM or browser test currently imports the React editor. `npm test` therefore does not exercise save races, dirty-navigation guards, the step dialog, keyboard reordering, or input reconciliation. Add a lightweight Vitest DOM suite or an isolated browser suite for the remaining screen. |
