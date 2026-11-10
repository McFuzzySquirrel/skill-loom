---
id: ADR-0028
applies_to:
  - "src/web/App.tsx"
  - "src/web/routes/ChainEditorPage.tsx"
  - "src/web/components/ChainFlow.tsx"
  - "src/web/hooks/useChainDraft.ts"
status: Accepted
---

# ADR-0028: Limit the web UI to a visual chain editor

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-10

**Technical Story:** Users sometimes want to change step order or instructions visually; that is the one task a CLI does poorly.

## Editor Rules

- **MUST:** Edit only an existing chain or draft, opened by `skill-loom edit --draft <id>` or `skill-loom edit --project <id> --chain <id>`.
- **MUST:** Save through the existing chain API with its revision check, so edits stay in the chain and no second format exists.
- **MUST:** Keep keyboard reordering (move up/down), non-color status text, a live announcement region, and the unsaved-changes warning.
- **MUST NOT:** Create chains, change the harness, browse catalogs, run chains, or host a terminal.

## Decision Outcome

The editor shows a drag-to-reorder flow of steps, the step list, a dialog for step instructions, and the inputs editor. It remains loopback-only ([ADR-0001](0001-loopback-only-single-user-server.md)). Saved edits change the chain only; a bundle must be re-exported or re-inspected before it is run elsewhere.

### Consequences

- Small surface to keep accessible and tested.
- Visual authoring cannot start from nothing; use the CLI or skills first.

## Links

- Supersedes the builder decisions in [ADR-0019](0019-project-independent-chain-drafts.md). Related: [ADR-0027](0027-cli-and-skill-driven-workflow.md).
