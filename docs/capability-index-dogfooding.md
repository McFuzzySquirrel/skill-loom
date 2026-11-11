# Capability index dogfooding

Use this guide to try the derived capability index against real projects and real pinned remote skill repositories. Dogfooding is a manual observation exercise, not a release gate and not a replacement for `npm run eval:retrieval`.

The evaluation corpus stays offline and reproducible. Do not add live repositories to it. Record dogfooding findings separately, then turn concrete defects into tests or issues.

## Prerequisites

- Node.js 24 or newer and an installed `skill-loom` CLI.
- A trusted project with roughly 10–50 skills.
- One or two trusted remote repositories with roughly 10–50 packages each, if you want to exercise remote candidates.
- A local loopback profile. The service remains loopback-only with no authentication.
- Explicit approval before adding or refreshing a remote source. Never put credentials in a repository URL.

Use a copy of a project if you do not want `project open` to write `.loom/` into the original.

## Isolate the run

Use a separate profile so dogfooding does not change your normal configuration:

```bash
export LOOM_CONFIG_DIR="$HOME/.config/loom-dogfood"
export LOOM_CAPABILITY_INDEX=1
skill-loom service start
```

Run the service in its own terminal. The environment variable must be present in the service process, not only in the CLI client that talks to it. If a service is already running without `LOOM_CAPABILITY_INDEX=1`, stop it and start it again with the variable set. The commands below are Bash examples; on Windows, use an equivalent protected local fixed NTFS/ReFS profile and set the variable in the service environment.

Check the profile:

```bash
skill-loom service status
skill-loom catalog limits show
```

## Register the project and remote sources

Register the project and keep the returned project id:

```bash
printf '%s' '{"path":"/absolute/project"}' | skill-loom project open
```

Register a trusted repository. Nothing is fetched until the explicit refresh:

```bash
printf '%s' '{"repository":"https://github.com/org/skills.git","ref":"main"}' \
  | skill-loom catalog source add
```

Refresh and inspect the pinned snapshot:

```bash
skill-loom catalog source refresh --source <source-id>
skill-loom catalog snapshot list --source <source-id>
```

Review any candidate package before using it. The refresh and index steps never execute package files.

## Warm the index

The first query after a missing index builds it and truthfully reports the scan fallback. Run the same query twice and confirm the second response uses the index:

```bash
printf '%s' '{"projectId":"<project-id>","harness":"opencode","query":"release audit","limit":10}' \
  | skill-loom catalog project page
```

Useful response fields:

```bash
... | jq '.result | {
  retrieval,
  metadataCoverage,
  metadataFacets,
  total,
  entries: [.entries[] | {
    name,
    source,
    score: .match.score,
    snippet: .match.snippet,
    metadata,
    sourceId,
    revision,
    repositoryPath,
    fingerprint
  }]
}'
```

`retrieval.mode` reports `index` or `scan`. A fallback also carries a reason and a `CAPABILITY_INDEX_FALLBACK` warning. `metadataCoverage` is present only when the indexed path answered.

## Run the dogfood matrix

Use the same outcomes for every run so results are comparable.

| Case | Query or intent | Filter |
|---|---|---|
| Description match | Wording close to a skill description | none |
| Body-only capability | Phrase that appears only in headings or body text | none |
| Metadata tag | Outcome names a domain | `tags` |
| Metadata tool | Outcome names a tool | `tools` |
| Metadata input or output | Outcome names a required artifact | `inputs` or `outputs` |
| Metadata presence | List skills that declare any tool or tag | `hasTools` or `hasTags` |
| Composition | Needs two skills in one chain | none |
| Negative | Should return nothing | none |
| Remote-only | Candidate exists only in a pinned snapshot | `sources: ["remote"]` |
| Source policy | Personal candidates must be excluded | `sources: ["project"]` |

Example metadata-filtered query:

```bash
printf '%s' '{
  "projectId":"<project-id>",
  "harness":"opencode",
  "query":"release",
  "sources":["project","remote"],
  "tags":["release"],
  "tools":["grep"],
  "hasTools":true,
  "limit":10
}' | skill-loom catalog project page
```

For each case record:

- `retrieval.mode`, `retrieval.ranking`, and any fallback reason;
- `metadataCoverage`;
- the top five names, sources, snippets, and scores;
- whether the expected skill appeared and at what rank;
- whether any remote entry carried the exact `sourceId`, `revision`, `repositoryPath`, and `fingerprint`.

## Check Phase 3 behavior

### Metadata and coverage

Remote repositories that do not declare metadata should show a high `withoutStructuredMetadata` count. That is expected, not a failure. Confirm that declared tags, tools, inputs, outputs, and `whenToUse` appear in `entries[].metadata` and match the package frontmatter. Invalid metadata should appear as a coverage issue, never as an invented value.

### Filters

Confirm that `sources`, `enabled`, `tags`, `tools`, `inputs`, and `outputs` narrow the result set. Filters are combined with AND. Use `hasTags`, `hasTools`, `hasInputs`, or `hasOutputs` to require or exclude a metadata kind; `true` requires at least one value and `false` requires none.

Use `metadataFacets` to discover every declared tag, tool, input, and output in the filtered scope, with counts. The facets are a discovery aid, not a package review.

If the index falls back to the scan, confirm the response contains `METADATA_FILTER_UNSUPPORTED`. The scan does not pretend a metadata filter held; the authoring skill must verify those claims from the package.

### Snapshot identity

Reuse the returned `snapshotId` with the same project, harness, query, and filters. Changing a filter must return `CATALOG_PAGE_MISMATCH`; an expired snapshot must return `CATALOG_PAGE_EXPIRED`.

### Exact remote binding

Compare a remote page entry with its pinned snapshot candidate:

```bash
skill-loom catalog snapshot inspect \
  --source <source-id> \
  --revision <commit> \
  --kind skill \
  --path <repository-path>
```

The `sourceId`, `revision`, `repositoryPath`, and `fingerprint` must match. A same-named package in another source must stay distinct; never resolve remote candidates by name alone.

### Invalidation

Edit a project `SKILL.md`, then query again. The entry’s fingerprint, snippet, and metadata should reflect the change without a manual rebuild. A changed package must not keep serving stale content.

### Rebuild and corruption

Stop the service, delete the derived index, and start it again:

```bash
skill-loom service stop
rm -f "$LOOM_CONFIG_DIR/capability-index.sqlite"
skill-loom service start
```

The first query should build the index and report the scan fallback; the next should use the index. Optionally replace the index with non-database content and repeat. The service must fall back to the scan, rebuild, and never hide a skill.

## Run an end-to-end authoring workflow

After the query matrix, use `scenario-discovery` on two or three real outcomes:

> Use scenario-discovery to propose a chain for “<outcome>” in this project. Use the indexed catalog with only justified metadata filters, show `metadataCoverage` and exact provenance, and read every selected package in full before proposing the chain.

Confirm that the skill:

- expands the outcome into a few bounded queries;
- uses snippets and scores only to shrink the shortlist;
- uses metadata filters only when the outcome or source policy justifies them;
- surfaces scan fallback and coverage gaps;
- preserves exact remote identity;
- reads every selected package in full;
- asks separately for chain approval, redistribution review, and execution approval.

## Success criteria

Treat the dogfooding run as successful if:

- body-only capability queries return plausible candidates;
- metadata filters reduce noise without creating empty results;
- every remote candidate has exact binding identity;
- the first-query fallback is visible and later queries use the index;
- latency is acceptable for the catalog size;
- `scenario-discovery` proposes a better shortlist than name-and-description search alone;
- a missing, corrupt, or unsafe index never hides a skill.

Record repo names, package counts, the query matrix, coverage counts, latency, and any bad rankings or misleading metadata. Keep that note separate from the evaluation corpus.

## Cleanup

Stop the service before removing the isolated profile:

```bash
skill-loom service stop
rm -rf "$LOOM_CONFIG_DIR"
```

That removes the dogfood config, recent-project list, remote snapshots, and derived index. It does not remove the project or its `.loom/` directory; review those separately before deleting anything.

## Related

- [Skill index for chain authoring](design/skill-index-for-chain-authoring.md)
- [Operations guide](OPERATIONS.md)
- [Administrator guide](admin-guide.md)
- [User guide](user-guide.md)
- [ADR-0030](adr/0030-capability-index-and-model-reranking.md)
