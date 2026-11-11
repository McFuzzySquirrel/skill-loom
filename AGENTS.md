# Repository Guidance

Skill Loom is a local, CLI- and skill-driven tool for assembling, sharing, and running ordered skill chains; its only web screen is the React chain editor.

<!-- BEGIN: documentation-maintenance -->
## Documentation Maintenance

Update the documentation in the same change as the behavior it describes, or state in the change why no update is needed.

- `README.md` — keep the capability table, project structure, and Getting Started commands current, and link to the guides instead of repeating them.
- `CHANGELOG.md` — add an entry under `[Unreleased]` for every user-visible change, using the existing categories.
- `docs/user-guide.md` — update workflows, visible states, and recovery steps when user-facing behavior changes.
- `docs/admin-guide.md` — update prerequisites, configuration, data locations, and troubleshooting when deployment or configuration changes.
- `docs/standalone-skill-guide.md` — update the inspect, prepare, and recovery procedure when the portable helper contract changes.
- `docs/current-gaps.md` — add or remove a capability only when verification evidence supports the change.
- `docs/releases/` — add release notes for each version, and correct them when shipped behavior changes after publication.
- Before finishing work, run `npm run check` and confirm that commands, paths, and links still resolve.
<!-- END: documentation-maintenance -->
