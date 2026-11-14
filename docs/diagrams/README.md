# Architecture diagrams

These are self-contained Archify pages generated from the repository at `609847c`. Open the HTML file directly; no server or network is needed.

| Page | Covers | Source |
|---|---|---|
| [skill-loom-architecture.html](skill-loom-architecture.html) | repo-canonical chains, active-session execution, optional SSH/Podman catalog and publication path, loopback-only editor boundary, compatibility workflows | `src/architecture.explainer.txt` |
| [chain-save-sequence.html](chain-save-sequence.html) | the editor save path from `PUT` to the atomic rename | `src/chain-save.sequence.json` |
| [portable-handoff-workflow.html](portable-handoff-workflow.html) | the service-free inspect, prepare, step, and record path | `src/portable-handoff.workflow.json` |
| [repo-first-remote-authoring.html](repo-first-remote-authoring.html) | exact hosted-skill selection, local repo-chain authoring and execution, optional revision-checked publication | `src/repo-first-remote-authoring.archify.md` |

The [hosted-catalog implementation overview](../plans/hosted-catalog-repo-chains-overview.html) summarizes the delivered phases, pilot scope, and remaining gates. The blueprint keeps its Mermaid views as the text fallback. Regenerate HTML after changing the architecture or affected source lines.

## Regenerate

Install the [Archify skill](https://github.com/tt-a1i/archify), then run from the repository root, replacing `<archify>` with the skill directory:

```bash
node <archify>/bin/archify.mjs finalize explainer docs/diagrams/src/architecture.explainer.txt docs/diagrams/skill-loom-architecture.html --repo-root . --quality showcase
node <archify>/bin/archify.mjs finalize sequence docs/diagrams/src/chain-save.sequence.json docs/diagrams/chain-save-sequence.html --repo-root . --quality showcase
node <archify>/bin/archify.mjs finalize workflow docs/diagrams/src/portable-handoff.workflow.json docs/diagrams/portable-handoff-workflow.html --repo-root . --quality showcase
node <archify>/bin/archify.mjs finalize explainer docs/diagrams/src/repo-first-remote-authoring.archify.md docs/diagrams/repo-first-remote-authoring.html --repo-root . --quality showcase
node <archify>/bin/archify.mjs finalize explainer docs/plans/hosted-catalog-repo-chains-overview.archify.md docs/plans/hosted-catalog-repo-chains-overview.html --repo-root . --quality showcase
```

`finalize` writes a `.delivery.json` sidecar beside each page. The sidecars carry absolute build paths, so they are not committed.
