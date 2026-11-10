# Architecture diagrams

These are self-contained Archify pages generated from the repository at `122fdc8`. Open the HTML file directly; no server or network is needed.

| Page | Covers | Source |
|---|---|---|
| [skill-loom-architecture.html](skill-loom-architecture.html) | system map, folder-to-run workflow, per-gap skill authoring, run-start guards, run lifecycle, scenario routes, gates, state locations, harness differences | `src/architecture.explainer.txt` and `src/run-lifecycle.lifecycle.json` |
| [chain-save-sequence.html](chain-save-sequence.html) | the editor save path from `PUT` to the atomic rename | `src/chain-save.sequence.json` |
| [portable-handoff-workflow.html](portable-handoff-workflow.html) | the service-free inspect, prepare, step, and record path, including mixed-origin bundles | `src/portable-handoff.workflow.json` |

The blueprint keeps its Mermaid views as the text fallback. Regenerate the HTML after changing the architecture or the affected source lines.

## Regenerate

Install the [Archify skill](https://github.com/tt-a1i/archify), then run from the repository root, replacing `<archify>` with the skill directory:

```bash
node <archify>/bin/archify.mjs finalize explainer docs/diagrams/src/architecture.explainer.txt docs/diagrams/skill-loom-architecture.html --repo-root . --quality showcase
node <archify>/bin/archify.mjs finalize sequence docs/diagrams/src/chain-save.sequence.json docs/diagrams/chain-save-sequence.html --repo-root . --quality showcase
node <archify>/bin/archify.mjs finalize workflow docs/diagrams/src/portable-handoff.workflow.json docs/diagrams/portable-handoff-workflow.html --repo-root . --quality showcase
```

`finalize` writes a `.delivery.json` sidecar beside each page. The sidecars carry absolute build paths, so they are not committed.
