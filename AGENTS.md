# Repository Guidance

Skill Loom is a single-user local tool for assembling, saving, and running ordered chains of agent skills, driven by the `skill-loom` CLI and companion Agent Skills, with one visual chain editor.

## Repository Invariants

- The server binds to loopback only. Reject non-loopback hosts; there is no authentication, TLS, or supported remote deployment.
- The server owns filesystem, persistence, process, and PTY access. Spawn harnesses with an executable plus argument array, never a shell string.
- Skills are model-invoked prompt context. Chain order is prompt order, not a guarantee that a harness loads a named skill.
- The product is CLI- and skill-driven; the only web screen is the chain editor opened by `skill-loom edit`.
- Persistent state is versioned JSON with atomic replacement. Do not hand-edit run records or add unversioned fields.
- Skill sources: `.github/skills/**` is canonical for the companion and harness skills; `.agents/skills/**` is the single source for `create-project-documentation`; `skill/**` and `.opencode/skills/**` are mirrors. Do not keep a second copy of a skill in another root.
- Edit the canonical skill package first. `npm run build:portable-skill` syncs the portable skills and their `skill/**` mirrors, and `npm run check` requires every remaining `.opencode/skills/**` mirror to stay byte-identical.
- After changing bundled scenario packages, run `npm run update:scenario-modes`.

<!-- BEGIN: documentation-maintenance -->
## Documentation Maintenance

Update the documentation in the same change as the behavior it describes, or state in the change why no update is needed.

- `README.md` — keep Getting Started commands runnable and links resolving; keep the feature list current and link to the guides instead of repeating them.
- `CHANGELOG.md` — add an entry under `## [Unreleased]` for every user-visible change, using the existing Keep a Changelog headings.
- `docs/releases/` — keep release status, compatibility, limitations, and validation evidence accurate; mark gates that were not run as unrun.
- `docs/user-guide.md` — update workflows, visible states, recovery, accessibility, and privacy when user-facing behavior changes.
- `docs/admin-guide.md` — update prerequisites, configuration, storage, backups, upgrades, and troubleshooting when deployment or configuration changes.
- `docs/OPERATIONS.md` — update the operator contract when data locations, harness prerequisites, trust, permissions, or security behavior changes.
- `docs/standalone-skill-guide.md` — update the skill-only procedure when bundle inspection, installation, reuse, execution, or recovery changes.
- `docs/adr/NNNN-kebab-title.md` — record a durable decision as one record with `applies_to`, imperative rules, and a runnable verification check; supersede the old record instead of rewriting it.
- `docs/adr/README.md` — add or update the row for every record you add, supersede, or re-date, in identifier order.
- Before finishing, run `npm run check`, `npm run typecheck`, `npm test`, and `git diff --check`. Run `npm run test:package` for packaging changes, and live probes only with real harness CLIs and credentials.
<!-- END: documentation-maintenance -->
