# AGENTS.md Documentation-Maintenance Section

> Load when writing or reconciling the `AGENTS.md` section that keeps the documents created in this run up to date.

This template covers only the artifacts this run created or refreshed. Do not add rules for documents that were not part of the run, and do not restate the document map rules owned by the `doc-map` skill. Write one section per applicable scope and keep it short enough that an agent reads it before starting work.

## Template

```markdown
<!-- BEGIN: documentation-maintenance -->
## Documentation Maintenance

Update the documentation in the same change as the behavior it describes, or state in the change why no update is needed.

- `README.md` — keep the Getting Started commands runnable, the links resolving, and the feature list current. Link to the guides instead of repeating their content.
- `CHANGELOG.md` — add an entry under the unreleased section for every user-visible change, using the existing headings instead of inventing categories.
- `docs/releases/` — add release notes for each version, and correct them when shipped behavior changes after publication.
- `docs/user-guide.md` — update workflows, visible states, and recovery steps when user-facing behavior changes.
- `docs/admin-guide.md` — update prerequisites, configuration, operations, and troubleshooting when deployment or configuration changes.
- `docs/adr/NNNN-kebab-title.md` — record a new decision when a durable architectural choice changes, and supersede the old record instead of rewriting it.
- `docs/adr/index.md` — add or update the row for every record you add, supersede, or re-date, in identifier order.
- Before finishing work, re-run the documentation checks named in the README and confirm that commands, paths, and links still resolve.
<!-- END: documentation-maintenance -->
```

## Adapting The Template

- Replace each default path with the path this run actually used.
- Delete every bullet for an artifact this run did not create. A rule pointing at a missing file is worse than no rule.
- Keep the rule imperative and the artifact list flat; do not add rationale, examples, or a second level of nesting.
- Drop the final check bullet when the project has no documentation gate to re-run, rather than inventing a command.
- Keep the begin and end comments. They are how a later run updates the section without touching surrounding prose.

## Placement

1. Find the nearest applicable `AGENTS.md` for the repository or package that owns the documents. Ignore dot-prefixed copies such as `.agents/AGENTS.md`, which are tooling configuration rather than project guidance.
2. If a delimited `documentation-maintenance` section already exists, replace only the text between the markers and leave the markers in place.
3. If an `AGENTS.md` exists without the markers, append the section at the end of the file. Do not rewrite, reorder, or reformat the existing prose, and do not fold this section into an existing heading that belongs to something else.
4. If no applicable `AGENTS.md` exists, create a root `AGENTS.md` with a single `# Repository Guidance` heading, a one-line description of the repository, and the section.
5. For a monorepo, place the section at the scope that owns the documents. A nested file should name only documents in or below its directory and must not claim repository-wide authority. When the same rule would be repeated at several scopes, keep it once at the nearest common scope instead.

If the requester declines the `AGENTS.md` edit, skip the section, leave the file untouched, and report that the upkeep rules were not written. A partial write is worse than none.

## Coexisting With A Document Map

The `doc-map` skill owns the document reference map and its own maintenance section. If `AGENTS.md` contains a `Documentation Map Maintenance` section, or any section that names a `docmap.jsonl` or `docmap.sqlite` path:

- Leave that section exactly as written. Do not delete, reorder, or reword it, and do not edit the map itself.
- Do not restate its priorities, its map path, or its `update_when` fields. This section lists update triggers per artifact; the map section lists documents and how to track them.
- If the map section already names the same artifact, keep this section's bullet focused on when that artifact changes rather than repeating where it lives.
- If both sections would give an agent conflicting instructions, the map section wins for selection and lookup, and this section wins for update triggers. Report the overlap instead of merging the two by hand.

## Reconciliation Rules

- One `documentation-maintenance` section per `AGENTS.md`; update the existing one instead of appending a second.
- Preserve unrelated sections, badges, links, and wording, even when they look stale. Report other stale guidance rather than fixing it in this run.
- Keep the section in sync with the documents that exist after this run, not with the documents that were planned.
- Re-read the final file after writing to confirm both markers are present, the section is not duplicated, and no existing heading moved.
