# Feature: Chain Authoring

## Traceability

| Canonical ID | Owner / Source Link | Relationship |
|--------------|---------------------|--------------|
| US-02 | [Vision](../PRD.md#US-02) | participates |
| US-07 | [Vision](../PRD.md#US-07) | participates |
| US-08 | [Vision](../PRD.md#US-08) | participates |
| CHAIN-FR-01 | This feature | owns |
| CHAIN-FR-02 | This feature | owns |
| CHAIN-FR-03 | This feature | owns |
| CHAIN-FR-04 | This feature | owns |
| CHAIN-FR-05 | This feature | owns |
| CHAIN-FR-06 | This feature | owns |
| CHAIN-FR-07 | This feature | owns |

**PRD:** [docs/PRD.md](../PRD.md)

---

## 1. Feature Overview

**Feature Name:** Chain Authoring
**ID Prefix:** CHAIN
**Summary:** Turn selected catalog skills into a saved, ordered recipe with a required instruction per step, named inputs, and one harness binding, stored as reviewable JSON inside the project.
**Dependencies:** App Foundation, Project Workspace, Skill Catalog
**Priority:** Must

The chain is the product. The authoring experience must make a saved sequence faster to reuse than retyping prompts, and it must make the harness binding and input substitution obvious before a run.

---

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| CHAIN-US-01 | solo builder | add a catalog skill as a step and write what to do with it | the step is not just "load this and figure it out" | Must |
| CHAIN-US-02 | solo builder | reorder steps by drag or keyboard | I can correct the sequence without rebuilding it | Must |
| CHAIN-US-03 | solo builder | declare named inputs and use them in instructions | one recipe serves different tasks | Must |
| CHAIN-US-04 | solo builder | keep chains in the repository | recipes are reviewable in git and travel with the code | Must |
| CHAIN-US-05 | solo builder | duplicate a chain to change harness | I keep the original recipe intact | Must |

---

## 3. Functional Requirements

```forge-requirement
{"id":"CHAIN-FR-01","kind":"requirement","text":"Model a chain as versioned JSON with id, name, harness, sessionMode shared|fresh|fork, steps, inputs, automatic permission opt-in, and timestamps; each step has a stable id, skill name, required instruction, and optional label; validate nonempty name and steps, unique step ids, known harness, known session mode, unique input names, and {{name}} placeholders that match declared inputs."}
```

```forge-requirement
{"id":"CHAIN-FR-02","kind":"requirement","text":"Store each chain at <project>/.slan/chains/<chainId>.json using atomic temporary-file replacement, reject ids that escape the chains directory, list newest-updated first, and report corrupt files as warnings rather than failing the whole list."}
```

```forge-requirement
{"id":"CHAIN-FR-03","kind":"requirement","text":"Expose chain create, read, update, duplicate, and delete endpoints under /api/projects/:projectId/chains, scope every operation to the project's canonical .slan/chains directory, and return 404, 409, or 422 with the shared error envelope."}
```

```forge-requirement
{"id":"CHAIN-FR-04","kind":"requirement","text":"Show a project's chain library with name, harness, step count, and updated time; allow create, open, duplicate, and delete with confirmation."}
```

```forge-requirement
{"id":"CHAIN-FR-05","kind":"requirement","text":"Provide a chain builder that adds a catalog skill as a step, edits its instruction and optional label, removes steps, and reorders by drag-and-drop and by keyboard move-up and move-down controls."}
```

```forge-requirement
{"id":"CHAIN-FR-06","kind":"requirement","text":"Provide an inputs editor for named inputs with labels, required flags, and defaults; validate unresolved placeholders before save; block navigation on unsaved changes with a confirmation prompt."}
```

```forge-requirement
{"id":"CHAIN-FR-07","kind":"requirement","text":"Keep a chain bound to one harness; changing the harness of an existing chain requires duplicating the chain, and the UI explains that per-step harness switching is unsupported."}
```

| ID | Priority |
|----|----------|
| CHAIN-FR-01 | Must |
| CHAIN-FR-02 | Must |
| CHAIN-FR-03 | Must |
| CHAIN-FR-04 | Must |
| CHAIN-FR-05 | Must |
| CHAIN-FR-06 | Must |
| CHAIN-FR-07 | Must |

---

## 4. UI / Interaction Design

The project route adds a chain library below the project summary. Each chain card shows name, harness badge, session mode, step count, and relative updated time. Primary actions are Open and Duplicate; Delete sits in an overflow menu and requires typing or confirming the chain name. New Chain prompts for a name and harness, then opens the builder with one empty step slot.

The builder is a three-region layout: catalog panel on the left, ordered step list in the center, and the selected step editor on the right. On narrow screens the regions stack. The step list shows sequence number, label or skill name, skill name, and a status-free instruction excerpt. Each row has a drag handle, Move up, Move down, and Remove. Dragging is an enhancement; the move buttons are the keyboard path.

The step editor contains a skill selector prefilled from the catalog, a required instruction textarea with `{{input}}` helper text, and an optional label. Empty instructions block save with an inline message. The inputs editor lists name, label, required, and default columns with Add and Remove; renaming an input lists every instruction that would break.

Saving shows a dirty indicator in the header. Navigating away, closing the tab, or switching chains prompts for confirmation when dirty. After save, the header shows the updated time. The harness selector is read-only after creation and offers Duplicate to change harness.

---

## 5. Implementation Tasks

### Phase 1: Model, Storage, and API

```forge-task
{
  "id": "CHAIN-01",
  "title": "Implement the chain model and validation",
  "description": "Implement the versioned chain schema and domain validation. Define id, name, harness, sessionMode, steps, inputs, automatic broad-permission opt-in, createdAt, and updatedAt. Each step has a stable id, skill name, required instruction, and optional label. Validate nonempty name and at least one step, unique step ids, known harness and session mode, unique input names, valid input-name syntax, and that every {{name}} placeholder resolves to a declared input. Reject a chain with no harness or an unknown harness. Add tests/unit/chain-model.test.ts covering valid chains, empty names/instructions, duplicate step and input ids, unknown placeholders, unused inputs, and version migration behavior. Do not implement filesystem storage or HTTP routes.",
  "ownerAgent": "backend-engineer",
  "dependencies": ["FOUND-01"],
  "expectedOutputs": [
    "src/server/chains/model.ts",
    "tests/unit/chain-model.test.ts"
  ],
  "validationCommands": [
    "npx vitest run tests/unit/chain-model.test.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/chain-authoring.md#CHAIN-FR-01"],
    "acceptanceCriteria": [
      "A valid chain with named inputs and placeholders passes validation",
      "An empty name, empty steps, or empty instruction fails with a field-specific error",
      "Duplicate step ids and duplicate input names fail",
      "An undeclared {{placeholder}} fails and reports the step and input name",
      "Unknown harness and session mode values fail",
      "The schema is versioned and the tests document the current version"
    ],
    "constraints": ["Do not store a per-step harness", "Do not accept an instruction that is only whitespace"],
    "constraintRefs": ["docs/PRD.md#EXEC-04", "docs/PRD.md#ARCH-04"],
    "references": ["docs/PRD.md#6.4 Execution Model", "docs/PRD.md#15. Glossary"]
  }
}
```

```forge-task
{
  "id": "CHAIN-02",
  "title": "Implement chain storage with atomic writes",
  "description": "Implement project-scoped chain storage under <project>/.slan/chains. Create the directory on demand, write each chain to <chainId>.json through a temporary file plus rename, reject ids containing traversal or separators, list valid chains newest-updated first, and return corrupt files as warnings without failing the list. Read one chain by id with 404 semantics when absent. Add tests/unit/chain-store.test.ts covering create/read/update/list ordering, traversal ids, corrupt JSON quarantine, and atomic replacement after a simulated write failure. Do not implement HTTP routes or builder logic.",
  "ownerAgent": "backend-engineer",
  "dependencies": ["CHAIN-01", "PROJ-02"],
  "expectedOutputs": [
    "src/server/chains/store.ts",
    "tests/unit/chain-store.test.ts"
  ],
  "validationCommands": [
    "npx vitest run tests/unit/chain-store.test.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/chain-authoring.md#CHAIN-FR-02"],
    "acceptanceCriteria": [
      "Chains are written only inside the project's .slan/chains directory",
      "A traversal id is rejected before any filesystem access",
      "List order is updatedAt descending",
      "A corrupt chain file appears as a warning and valid chains remain listed",
      "A failed write does not leave a partial target file"
    ],
    "constraints": ["Do not write run data into the chains directory", "Do not delete corrupt files automatically"],
    "constraintRefs": ["docs/PRD.md#ARCH-04", "docs/PRD.md#SEC-01", "docs/PRD.md#PRIV-01"],
    "references": ["docs/PRD.md#6. Technical Architecture", "docs/PRD.md#10.3 Chain Draft"]
  }
}
```

```forge-task
{
  "id": "CHAIN-03",
  "title": "Expose chain CRUD and duplicate endpoints",
  "description": "Implement chain HTTP routes under /api/projects/:projectId/chains. Support list, get, create, update, duplicate, and delete, resolving the project through the project registry and scoping every path to its canonical .slan/chains directory. Generate ids server-side, preserve createdAt, update updatedAt, and return 422 for validation failures, 404 for missing projects/chains, and 409 for duplicate ids or conflicting names when the caller requests uniqueness. Add tests/integration/chains-routes.test.ts covering CRUD, duplicate, project scoping, invalid payloads, and error envelopes through src/server/app.ts. Do not implement builder UI behavior.",
  "ownerAgent": "backend-engineer",
  "dependencies": ["CHAIN-02", "PROJ-02", "FOUND-03"],
  "expectedOutputs": [
    "src/server/routes/chains.ts",
    "src/server/routes/index.ts",
    "tests/integration/chains-routes.test.ts"
  ],
  "validationCommands": [
    "npx vitest run tests/integration/chains-routes.test.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/chain-authoring.md#CHAIN-FR-03"],
    "acceptanceCriteria": [
      "All six operations are reachable through src/server/app.ts",
      "A chain from one project cannot be read or modified through another project id",
      "Invalid payloads return 422 with field details",
      "Duplicate creates a new id and name while preserving the source chain",
      "Missing project or chain returns 404 with the shared envelope"
    ],
    "constraints": ["Do not accept a client-supplied filesystem path", "Do not allow cross-project chain ids"],
    "constraintRefs": ["docs/PRD.md#ARCH-05", "docs/PRD.md#SEC-01", "docs/PRD.md#SEC-03"],
    "references": ["docs/PRD.md#6.3 Key APIs and Interfaces", "docs/PRD.md#10.3 Chain Draft"]
  }
}
```

### Phase 2: Chain Library and Builder

```forge-task
{
  "id": "CHAIN-04",
  "title": "Build the project chain library",
  "description": "Implement the chain library on the project route. Show chain cards with name, harness, session mode, step count, and updated time. Implement New Chain with name and harness, Open, Duplicate, and Delete with a confirmation that names the chain. Show loading, empty, warning, and error states, including corrupt-chain warnings from the API. Keep the catalog panel visible on the same route. Add tests/e2e/chain-library.spec.ts covering create, open, duplicate, delete confirmation, empty state, and keyboard operation. Do not implement the builder editor itself.",
  "ownerAgent": "frontend-engineer",
  "dependencies": ["CHAIN-03", "PROJ-03"],
  "expectedOutputs": [
    "src/web/components/ChainList.tsx",
    "src/web/components/NewChainDialog.tsx",
    "src/web/api/chains.ts",
    "src/web/routes/ProjectsPage.tsx",
    "tests/e2e/chain-library.spec.ts"
  ],
  "validationCommands": [
    "npx playwright test tests/e2e/chain-library.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/chain-authoring.md#CHAIN-FR-04"],
    "acceptanceCriteria": [
      "The library lists name, harness, session mode, step count, and updated time",
      "New Chain creates a draft and navigates to the builder",
      "Duplicate creates a separate chain and opens or lists it",
      "Delete requires confirmation naming the chain and removes only that chain",
      "Corrupt-chain warnings are visible without hiding valid chains",
      "The Playwright test drives the library through src/web/App.tsx"
    ],
    "constraints": ["Do not delete chain files from the browser directly", "Do not use color alone for harness or status"],
    "constraintRefs": ["docs/PRD.md#NFR-UX-01", "docs/PRD.md#A11Y-03", "docs/PRD.md#PRIV-02"],
    "references": ["docs/features/chain-authoring.md#4. UI / Interaction Design", "docs/PRD.md#10.3 Chain Draft"]
  }
}
```

```forge-task
{
  "id": "CHAIN-05",
  "title": "Build the chain step editor and reordering",
  "description": "Implement the chain builder route with the catalog panel, ordered step list, and step editor. Add a catalog skill as a step, require an instruction before the step is valid, edit the optional label, remove a step, and reorder with pointer drag plus Move up and Move down buttons. Selecting a row opens it in the editor. Preserve unsaved edits while reordering. Add tests/e2e/chain-builder.spec.ts covering add, edit, remove, drag reorder, keyboard reorder, empty instruction validation, and catalog search inside the builder. Do not implement input editing or save persistence here.",
  "ownerAgent": "frontend-engineer",
  "dependencies": ["CHAIN-04", "CAT-04"],
  "expectedOutputs": [
    "src/web/routes/ChainBuilderPage.tsx",
    "src/web/components/StepList.tsx",
    "src/web/components/StepEditor.tsx",
    "src/web/hooks/useChainDraft.ts",
    "tests/e2e/chain-builder.spec.ts"
  ],
  "validationCommands": [
    "npx playwright test tests/e2e/chain-builder.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/chain-authoring.md#CHAIN-FR-05"],
    "acceptanceCriteria": [
      "Adding a catalog skill creates a step with a stable local id",
      "An empty instruction blocks save and shows an inline error",
      "Remove deletes only the selected step",
      "Drag-and-drop and Move up/Move down produce the same order",
      "Keyboard reordering works without a pointer",
      "The Playwright test exercises the builder through src/web/App.tsx"
    ],
    "constraints": ["Do not add a third-party drag-and-drop dependency unless the pointer behavior cannot be met with native events", "Do not lose unsaved text when reordering"],
    "constraintRefs": ["docs/PRD.md#A11Y-01", "docs/PRD.md#A11Y-02", "docs/PRD.md#NFR-UX-01"],
    "references": ["docs/features/chain-authoring.md#4. UI / Interaction Design", "docs/PRD.md#6.4 Execution Model"]
  }
}
```

```forge-task
{
  "id": "CHAIN-06",
  "title": "Add chain inputs, save, and harness binding",
  "description": "Implement the inputs editor and save flow. Add, rename, and remove named inputs with label, required flag, and default; reconcile placeholders when an input is renamed or removed and report every affected step. Validate unresolved placeholders before save. Persist through the chain API, show a dirty indicator, and block navigation with a confirmation when dirty. Make the harness read-only after creation and offer Duplicate to change harness, explaining that per-step switching is unsupported. Add tests/e2e/chain-save.spec.ts covering input add/remove, placeholder validation, save, reload persistence, dirty-navigation confirmation, and harness-change duplication. Do not implement preflight or execution.",
  "ownerAgent": "frontend-engineer",
  "dependencies": ["CHAIN-05", "CHAIN-03"],
  "expectedOutputs": [
    "src/web/components/InputsEditor.tsx",
    "src/web/routes/ChainBuilderPage.tsx",
    "src/web/api/chains.ts",
    "tests/e2e/chain-save.spec.ts"
  ],
  "validationCommands": [
    "npx playwright test tests/e2e/chain-save.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/chain-authoring.md#CHAIN-FR-06", "docs/features/chain-authoring.md#CHAIN-FR-07"],
    "acceptanceCriteria": [
      "Inputs can be added, edited, and removed with labels, required flags, and defaults",
      "Renaming or removing an input lists every instruction that references it",
      "An unresolved placeholder blocks save with the step and placeholder named",
      "A saved chain reloads with steps, inputs, session mode, and harness intact",
      "Navigating away from a dirty draft asks for confirmation",
      "The harness selector cannot silently change an existing chain and offers Duplicate instead",
      "The Playwright test drives the full save flow through src/web/App.tsx"
    ],
    "constraints": ["Do not auto-rewrite placeholders without showing the affected steps", "Do not allow a harness change on the existing chain record"],
    "constraintRefs": ["docs/PRD.md#EXEC-04", "docs/PRD.md#NFR-UX-01", "docs/PRD.md#ARCH-04"],
    "references": ["docs/features/chain-authoring.md#4. UI / Interaction Design", "docs/PRD.md#10.3 Chain Draft"]
  }
}
```

---

## 6. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit | Chain schema, placeholder resolution, storage, atomic writes | Vitest with temporary project directories |
| Integration | Chain CRUD, duplicate, project scoping | Fastify `inject` through the composition root |
| Browser | Library, builder, reorder, inputs, save, dirty guard | Playwright with a temporary project and catalog fixture |
| Human | Authoring speed and clarity | Covered by the primary-journey review |

Key test scenarios:

1. An instruction with `{{task}}` fails when `task` is not declared.
2. Renaming an input reports every affected step before the user confirms.
3. A chain id containing `../` is rejected before filesystem access.
4. Reordering by keyboard produces the same persisted array as drag-and-drop.
5. Duplicating a chain creates a new id and leaves the source unchanged.
6. A harness change is impossible without duplication.

---

## 7. Acceptance Criteria

1. A chain can be created from catalog skills, ordered, instructed, saved, reopened, and edited.
2. Named inputs work with placeholders and are validated before save.
3. Chains are stored as project-local JSON and survive a server restart.
4. Name collisions and corrupt files are visible without blocking valid work.
5. The builder is keyboard-operable, including reordering and navigation guards.
6. A chain is bound to one harness and can only change harness by duplication.

---

## 8. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Should the same skill be allowed twice in one chain? | Yes; repeated steps are useful and each has its own instruction and id. |
| 2 | Should unused declared inputs be allowed? | Yes, with a warning; they may be reserved for later edits. |
| 3 | Should chain names be unique within a project? | No; ids are unique and duplicate names are visible, but create warns on an exact name match. |
| 4 | Should there be a per-chain timeout? | Yes, default 30 minutes per automatic step, editable in chain settings; no per-step model routing. |
