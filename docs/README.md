# Documentation map

This page lists the canonical documentation and where retired material lives. Keep it current when adding or moving a document.

## Canonical

| Document | Audience | Covers |
|---|---|---|
| [README](../README.md) | everyone | product summary, install, build, commands, configuration, security |
| [Quick start](quick-start.md) | new users | build, review, import, and run a first workflow |
| [User guide](user-guide.md) | end users | service, projects, discovery, editing, bundles, runs, recovery, accessibility |
| [Administrator guide](admin-guide.md) | operators | install, configuration, CLI flags, identity and TLS, storage, backups, upgrades, troubleshooting |
| [Operations guide](OPERATIONS.md) | operators | configuration contract, data locations, harness prerequisites, Copilot trust, security model, live verification |
| [Standalone skill guide](standalone-skill-guide.md) | skill-only users | discover, inspect, prepare, run, and recover bundles without the service |
| [Scenario chain examples](scenario-chains.md) | workflow authors | starter recipes and third-party skill sources |
| [Visual tour](visual-tour.md) | editor users | the chain editor and its controls |
| [Known gaps](current-gaps.md) | everyone | blocked, partial, and unverified capabilities |
| [Architecture blueprint](../Project_Architecture_Blueprint.md) | maintainers | detected stack, C4 views, component/layer map, data and communication patterns, extension guide |
| [Architecture diagrams](diagrams/README.md) | maintainers | [system map and run flows](diagrams/skill-loom-architecture.html), [chain save](diagrams/chain-save-sequence.html), [portable handoff](diagrams/portable-handoff-workflow.html) |
| [Capability retrieval design](design/capability-retrieval.md) | maintainers | phased plan for the capability index, model reranking, and chain-pattern retrieval |
| [ADR index](adr/README.md) | maintainers | durable architecture decisions |
| [Release notes](releases/0.1.0.md) | everyone | current release status, compatibility, limitations, evidence |
| [Changelog](../CHANGELOG.md) | everyone | notable changes |
| [Support](SUPPORT.md) | maintainers | ownership, intake, escalation |

## Evidence

`docs/evidence/` contains privacy-reviewed probe output. Filenames include the date and, where useful, the harness version and result. A failed probe is retained only with `failed` in the name; it is not acceptance evidence.

## Skills and agents

- `.github/skills/**` is the canonical source for the companion and harness skills. `scripts/build-portable-skill.mjs` builds `dist/skills/**` and syncs the checked-in mirrors.
- `.agents/skills/create-project-documentation/` is the single tracked copy of the documentation workflow skill and its AGENTS.md maintenance reference. Do not add a second copy under `.github/skills/` or `.opencode/skills/`.
- `skill/**` is the distributable mirror of `scenario-discovery`, `loom-chain-workflow`, and the generated `loom-run-bundle` helper.
- `.opencode/skills/**` contains the project-local OpenCode mirrors of the `.github/skills/**` packages.
- `.opencode/agents/**` defines the maintainer agent team described in [Support](SUPPORT.md).

## Archived

[docs/archive/](archive/README.md) holds retired plans and generated explainers. Archived documents are historical and must not be followed as current instructions.

## Maintenance

- `npm run check` validates required headings, commands, and safety statements, plus relative links and anchors, documented npm scripts, retired vocabulary, ADR index dates, and skill sources and mirrors.
- When moving a document, update this map, the README navigation, and any relative links.
- When an ADR is superseded, update both the record and the index row.
