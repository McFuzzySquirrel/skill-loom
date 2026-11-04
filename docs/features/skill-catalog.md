# Feature: Skill Catalog

## Traceability

| Canonical ID | Owner / Source Link | Relationship |
|--------------|---------------------|--------------|
| US-01 | [Vision](../PRD.md#US-01) | participates |
| US-05 | [Vision](../PRD.md#US-05) | participates |
| CAT-FR-01 | This feature | owns |
| CAT-FR-02 | This feature | owns |
| CAT-FR-03 | This feature | owns |
| CAT-FR-04 | This feature | owns |
| CAT-FR-05 | This feature | owns |
| CAT-FR-06 | This feature | owns |

**PRD:** [docs/PRD.md](../PRD.md)

---

## 1. Feature Overview

**Feature Name:** Skill Catalog
**ID Prefix:** CAT
**Summary:** Inventory the skills the selected harness can load, grouped and badged by source, searchable, and expandable to the full `SKILL.md` so the user can choose deliberately.
**Dependencies:** App Foundation, Project Workspace
**Priority:** Must

The catalog exists to support chain authoring. It is not a separate product surface, and it does not summarize or recommend skills with a model.

---

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| CAT-US-01 | solo builder | see project, personal, plugin, custom, builtin, and Slan-extra skills together | I know what each harness can actually load | Must |
| CAT-US-02 | solo builder | search names and descriptions and read the full SKILL.md | I choose the right skill without opening files | Must |
| CAT-US-03 | solo builder | spot duplicate names with source badges | I do not silently pick the wrong source | Must |
| CAT-US-04 | solo builder | add a skill directory in Slan settings | I can use skills outside the harness defaults | Must |

---

## 3. Functional Requirements

```forge-requirement
{"id":"CAT-FR-01","kind":"requirement","text":"Discover OpenCode skills by scanning <project>/.opencode/skills, ~/.config/opencode/skills, and Slan-configured extra directories, recursively finding SKILL.md packages, parsing YAML frontmatter name and description, and retaining source, canonical path, and harness."}
```

```forge-requirement
{"id":"CAT-FR-02","kind":"requirement","text":"Discover Copilot skills by invoking copilot skill list --json with the project as working directory, mapping project, personal, plugin, custom, and builtin sources, and surfacing command failures as warnings without crashing the catalog."}
```

```forge-requirement
{"id":"CAT-FR-03","kind":"requirement","text":"Merge harness and source results without silent deduplication; when names collide, return every entry with a visible source badge and stable id, and support case-insensitive search across name and description."}
```

```forge-requirement
{"id":"CAT-FR-04","kind":"requirement","text":"Expose GET /api/projects/:projectId/catalog?harness=&q= returning grouped entries, counts, and warnings; allow adding and removing extra skill directories in Slan settings and merge them into the selected harness catalog."}
```

```forge-requirement
{"id":"CAT-FR-05","kind":"requirement","text":"Provide a catalog panel grouped by source with source badges, search, refresh, and an expandable detail showing the full SKILL.md text; provide no AI summaries, and handle empty and error states explicitly."}
```

```forge-requirement
{"id":"CAT-FR-06","kind":"requirement","text":"Verify live discovery against installed OpenCode 2.2.5 and Copilot CLI 1.0.105, asserting each returns a temporary probe skill and an existing source, and record the evidence with versions and counts."}
```

| ID | Priority |
|----|----------|
| CAT-FR-01 | Must |
| CAT-FR-02 | Must |
| CAT-FR-03 | Must |
| CAT-FR-04 | Must |
| CAT-FR-05 | Must |
| CAT-FR-06 | Must |

---

## 4. UI / Interaction Design

The catalog is a panel inside the chain builder and a read-only panel on the project route. A harness selector shows OpenCode or Copilot and the active command path. A search field filters on name and description as the user types, with a debounce of 150 ms. Entries are grouped by source in this order: project, personal, custom, plugin, builtin, Slan extra. Each group header shows a count.

Each row shows the skill name, a one-line description, and a source badge. Duplicate names remain separate rows; the badge and canonical path disambiguate them. Expanding a row reveals the full `SKILL.md` in a scrollable `<pre>` region and an "Add as step" action when the catalog is embedded in the builder. A refresh control re-runs discovery and preserves search text.

Empty, loading, and error states are distinct. An error shows the failed command, exit code, stderr excerpt, and Retry. A warning (for example, a corrupt skill directory) appears above the results and does not suppress valid entries. Extra directories are managed in a settings dialog with an absolute-path field, Add, Remove, and a note that changes are global to Slan.

---

## 5. Implementation Tasks

### Phase 1: Discovery and Catalog API

```forge-task
{
  "id": "CAT-01",
  "title": "Implement OpenCode skill discovery",
  "description": "Implement the catalog domain types and the OpenCode scanner. Scan the project .opencode/skills directory, the personal ~/.config/opencode/skills directory, and each Slan-configured extra directory, recursively finding SKILL.md packages. Parse YAML frontmatter with the verified yaml package, require a nonempty name, fall back to the directory name with a warning when name is absent, and retain description, canonical path, source, and harness. Handle unreadable directories and malformed frontmatter as warnings. Add tests/unit/catalog-opencode.test.ts with temporary project and home directories covering nested packages, missing frontmatter, duplicate names, extra directories, and unreadable paths. Do not invoke the OpenCode CLI and do not merge Copilot results here.",
  "ownerAgent": "backend-engineer",
  "dependencies": ["PROJ-02", "FOUND-02"],
  "expectedOutputs": [
    "src/server/catalog/types.ts",
    "src/server/catalog/frontmatter.ts",
    "src/server/catalog/opencode.ts",
    "tests/unit/catalog-opencode.test.ts"
  ],
  "validationCommands": [
    "npx vitest run tests/unit/catalog-opencode.test.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/skill-catalog.md#CAT-FR-01"],
    "acceptanceCriteria": [
      "Project, personal, and Slan-extra directories are all scanned",
      "Nested SKILL.md packages are discovered and their canonical paths recorded",
      "Frontmatter name and description are parsed; malformed files become warnings",
      "Duplicate names are returned separately with distinct source and path",
      "No skill body is executed and no CLI is invoked"
    ],
    "constraints": ["Do not use AI summaries or infer descriptions", "Do not follow unreadable directories into an infinite loop"],
    "constraintRefs": ["docs/PRD.md#ARCH-03", "docs/PRD.md#SEC-03", "docs/PRD.md#NFR-COMPAT-01"],
    "references": ["docs/PRD.md#6. Technical Architecture", "docs/PRD.md#5. Research Findings"]
  }
}
```

```forge-task
{
  "id": "CAT-02",
  "title": "Implement Copilot CLI skill discovery",
  "description": "Implement the Copilot catalog adapter. Invoke copilot skill list --json in the project directory with an executable-plus-arguments spawn, a bounded timeout, and captured stdout/stderr. Normalize the returned array into catalog entries with harness copilot, source, enabled state, canonical path when present, and a stable id. Map the documented project, personal, plugin, custom, and builtin source labels. Return a warning entry rather than throwing when the command is missing, exits non-zero, emits invalid JSON, or times out. Add tests/unit/catalog-copilot.test.ts with an injected command runner covering valid output, malformed JSON, non-zero exit, missing executable, and timeout. Do not call the real CLI in this unit test.",
  "ownerAgent": "backend-engineer",
  "dependencies": ["PROJ-02", "CAT-01"],
  "expectedOutputs": [
    "src/server/catalog/copilot.ts",
    "tests/unit/catalog-copilot.test.ts"
  ],
  "validationCommands": [
    "npx vitest run tests/unit/catalog-copilot.test.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/skill-catalog.md#CAT-FR-02"],
    "acceptanceCriteria": [
      "The adapter invokes copilot skill list --json without shell interpolation",
      "Valid output maps every source label and preserves enabled state",
      "Malformed JSON, non-zero exit, missing executable, and timeout each produce a warning rather than a crash",
      "The unit test uses the injected runner and never depends on an installed Copilot CLI"
    ],
    "constraints": ["Do not read credential files", "Do not treat a discovery failure as an empty catalog"],
    "constraintRefs": ["docs/PRD.md#SEC-01", "docs/PRD.md#SEC-02", "docs/PRD.md#NFR-COMPAT-01"],
    "references": ["docs/PRD.md#5. Research Findings", "docs/PRD.md#6.3 Key APIs and Interfaces"]
  }
}
```

```forge-task
{
  "id": "CAT-03",
  "title": "Merge catalog sources and expose the catalog API",
  "description": "Implement catalog merge, search, and the HTTP surface. Merge OpenCode and Copilot entries for the selected harness without deduplicating names, assign stable ids from harness/source/path/name, group by source, count entries, and apply case-insensitive substring search to name and description. Read extra skill directories from the global config and pass them to OpenCode scanning. Add settings endpoints to add and remove an extra directory with canonical-path validation and duplicate rejection. Register GET /api/projects/:projectId/catalog and the settings endpoints through src/server/routes/index.ts. Add tests/unit/catalog-merge.test.ts and tests/integration/catalog-routes.test.ts covering grouping, duplicates, search, harness selection, extra-directory add/remove, and error envelopes. Do not build the catalog panel here.",
  "ownerAgent": "backend-engineer",
  "dependencies": ["CAT-01", "CAT-02", "FOUND-03"],
  "expectedOutputs": [
    "src/server/catalog/merge.ts",
    "src/server/routes/catalog.ts",
    "src/server/routes/index.ts",
    "tests/unit/catalog-merge.test.ts",
    "tests/integration/catalog-routes.test.ts"
  ],
  "validationCommands": [
    "npx vitest run tests/unit/catalog-merge.test.ts tests/integration/catalog-routes.test.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/skill-catalog.md#CAT-FR-03", "docs/features/skill-catalog.md#CAT-FR-04"],
    "acceptanceCriteria": [
      "Duplicate skill names produce multiple entries with distinct source badges",
      "Search is case-insensitive and matches name or description",
      "Selecting OpenCode versus Copilot returns only that harness plus Slan extras where applicable",
      "Extra directories are validated, persisted in global config, and reflected in the next catalog response",
      "Catalog and settings routes are reachable through src/server/app.ts and use the shared error envelope"
    ],
    "constraints": ["Do not silently deduplicate by skill name", "Do not cache results across projects without invalidation"],
    "constraintRefs": ["docs/PRD.md#NFR-PERF-01", "docs/PRD.md#ARCH-04", "docs/PRD.md#NFR-COMPAT-01"],
    "references": ["docs/PRD.md#6.3 Key APIs and Interfaces", "docs/PRD.md#7. Non-Functional Requirements"]
  }
}
```

### Phase 2: Catalog Panel and Live Verification

```forge-task
{
  "id": "CAT-04",
  "title": "Build the catalog panel and extra-directory settings",
  "description": "Replace the catalog placeholder with the real catalog panel. Implement harness selection, debounced search, source grouping and badges, refresh, expandable full SKILL.md detail, and distinct loading, empty, warning, and error states. In the chain builder context, expose an Add as step action; in the project context, omit it. Add a settings dialog for adding and removing global extra skill directories with absolute-path validation. Add tests/e2e/catalog.spec.ts using a temporary project fixture containing project-local OpenCode skills, covering grouping, duplicate badges, search, detail expansion, refresh, empty search, warning rendering, and extra-directory add/remove. Do not implement chain persistence or step editing.",
  "ownerAgent": "frontend-engineer",
  "dependencies": ["CAT-03"],
  "expectedOutputs": [
    "src/web/components/SkillCatalog.tsx",
    "src/web/components/SkillDetail.tsx",
    "src/web/components/SkillSourceBadge.tsx",
    "src/web/components/ExtraDirectoriesDialog.tsx",
    "src/web/hooks/useCatalog.ts",
    "src/web/api/catalog.ts",
    "src/web/routes/ProjectsPage.tsx",
    "tests/e2e/catalog.spec.ts"
  ],
  "validationCommands": [
    "npx playwright test tests/e2e/catalog.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/skill-catalog.md#CAT-FR-05"],
    "acceptanceCriteria": [
      "Entries are grouped by source with visible badges and duplicate names remain separate",
      "Search filters on name and description and preserves grouping",
      "Expanding an entry shows the full SKILL.md text without raw HTML rendering",
      "Loading, empty, warning, and error states are visually distinct",
      "The settings dialog adds and removes an extra directory and refresh reflects the change",
      "The Playwright test drives the panel through src/web/App.tsx and the real catalog API"
    ],
    "constraints": ["Do not add model-generated summaries", "Do not hide warnings when results exist"],
    "constraintRefs": ["docs/PRD.md#SEC-03", "docs/PRD.md#NFR-UX-01", "docs/PRD.md#A11Y-03"],
    "references": ["docs/features/skill-catalog.md#4. UI / Interaction Design", "docs/PRD.md#10.2 Catalog"]
  }
}
```

```forge-task
{
  "id": "CAT-05",
  "title": "Verify live discovery against both harness CLIs",
  "description": "Create scripts/live-discovery.ts. Build a temporary project with one probe skill under .opencode/skills/slan-live-probe and one under .agents/skills/slan-live-probe, then run the real discovery paths for OpenCode and Copilot with the project as working directory. Assert the probe skill appears for each harness, assert at least one builtin or personal source is returned where available, and fail with a non-zero exit when a required CLI is missing, the command fails, or a probe is absent. Write docs/evidence/live-discovery.json with timestamps, CLI versions, entry counts by source, probe results, and warnings. Respect COPILOT_HOME and SLAN_CONFIG_DIR. Do not require model authentication and do not make a paid model call. Do not modify the user's real skill directories.",
  "ownerAgent": "integration-engineer",
  "dependencies": ["CAT-03"],
  "expectedOutputs": [
    "scripts/live-discovery.ts",
    "docs/evidence/live-discovery.json"
  ],
  "validationCommands": [
    "npm run test:live:discovery"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/skill-catalog.md#CAT-FR-06"],
    "acceptanceCriteria": [
      "The script discovers the OpenCode probe skill through the real scanner",
      "The script discovers the Copilot probe skill through the real copilot skill list --json command",
      "Missing CLIs or absent probes produce a non-zero exit and a clear message",
      "The evidence file records CLI versions, counts, and probe results",
      "The script uses only temporary directories and removes them on exit"
    ],
    "constraints": ["Do not make a paid model call", "Do not write into ~/.copilot or the user's project skills"],
    "constraintRefs": ["docs/PRD.md#SEC-02", "docs/PRD.md#SEC-05", "docs/PRD.md#NFR-COMPAT-01"],
    "references": ["docs/PRD.md#5. Research Findings", "docs/PRD.md#12.1 Dependencies"]
  }
}
```

---

## 6. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit | OpenCode scanning, frontmatter, Copilot normalization, merge/search | Vitest with temporary directories and an injected Copilot runner |
| Integration | Catalog API, extra-directory settings, error envelopes | Fastify `inject` through the composition root |
| Browser | Grouping, badges, search, detail, settings | Playwright against a temporary project fixture |
| Live | Real OpenCode and Copilot discovery | `npm run test:live:discovery`, evidence written to `docs/evidence/live-discovery.json` |

Key test scenarios:

1. A malformed `SKILL.md` becomes a warning and does not hide valid skills.
2. Two skills with the same name in different sources appear as two rows.
3. Search matches a description term case-insensitively.
4. Copilot command failure produces an error state, not a false empty catalog.
5. Adding an extra directory merges its skills and removing it removes them on refresh.
6. The live probe finds `slan-live-probe` in both harnesses.

---

## 7. Acceptance Criteria

1. The selected harness's project, personal, plugin, custom, builtin, and Slan-extra skills are visible and badged.
2. Search and full-detail expansion work without AI summaries.
3. Name collisions are visible rather than silently deduplicated.
4. Extra skill directories are managed globally and take effect on refresh.
5. Discovery failures and warnings are distinct from an empty catalog.
6. Real discovery is proven against both installed harness CLIs with recorded evidence.

---

## 8. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Does OpenCode expose additional configured skill directories in a stable config key? | Scan only the documented native directories plus Slan extras until a stable key is verified. |
| 2 | Should disabled Copilot skills be shown? | Show them with a disabled badge and prevent adding them as steps with an explanation. |
| 3 | Should the catalog cache results between requests? | No cache in v1; re-scan on refresh and project change. |
