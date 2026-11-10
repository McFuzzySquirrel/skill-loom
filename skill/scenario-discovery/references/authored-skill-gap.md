# Authored-skill gap procedure

Load this reference when a proposed chain has a step role that no available
skill can cover, and the user is considering authoring a new skill.

The gap is per step role. A chain may mix existing skills, instruction-only
steps, and new locally authored skills.

## 1. Prove the gap

For each uncovered step role, record:

- the step id and the outcome that step must produce;
- the exact catalog query and sources searched;
- the candidates considered and why each is a poor fit;
- whether an existing skill plus a connecting instruction step can cover it.

Do not call a role a gap merely because a keyword search returned nothing.
Prefer instruction-only when it can bridge the work. A new skill is justified
only when the step needs repeatable, project-specific procedure or reference
material that an instruction cannot carry reliably.

## 2. Ask per gap

Show the proposal as a table:

| # | Step role | Source | Status |
|---|---|---|---|
| 1 | inspect repository | `repo-review` | existing |
| 2 | design API contract | *none* | new skill needed |
| 3 | implement endpoints | `fastapi-expert` | existing |

For each gap, ask the user to choose exactly one:

1. continue without the skill, using an instruction-only step;
2. change the sources or query and look again;
3. author a new skill.

Never infer approval from a zero-result search, a proposal, or a prior
authoring decision. Approval is per gap.

## 3. Author in staging

Only after approval, load `skill-creator` and run its interview and scaffold
for that gap. Stage the package at:

```text
<project>/.skill-loom-authored/<skill-name>/
```

Staging keeps the skill out of every host-discovered skill root. Do not create
files under `.agents/skills/`, `.opencode/skills/`, or a personal/global root
before install approval.

Bounds and naming:

- author at most three new skills for one chain;
- the name must be a single safe directory segment and must match the
  `SKILL.md` frontmatter `name`;
- check the full catalog for an existing name, including disabled and
  ambiguous entries; a collision blocks authoring until the user renames the
  new skill or chooses a different approach;
- do not copy third-party files into the package without recording the source
  and reviewing redistribution.

## 4. Validate the staged package

Use the helper shipped with this skill:

```text
node <absolute-skill-directory>/scripts/authored-skill.mjs check \
  --package <absolute-staged-package-path> \
  --name <skill-name> \
  --project <absolute-project-root>
```

It validates the real directory, path safety, excluded credential/build
directories, no symlinks or special files, file and byte limits, and the
frontmatter name. It prints the local fingerprint and file inventory. Treat a
failure as a stop, not something to hand-edit around.

Then run `skill-review` through the host, scoped to the staged package:

```text
Audit only <absolute-staged-package-path> with skill-review.
Write the report beside the package, not inside it:
<absolute-staged-package-path>/../<skill-name>.SKILL-AUDIT.md
```

The audit is advisory. A passing score is not proof that the skill is safe,
correct, or approved. Show the findings and the complete package inventory to
the user.

## 5. Install only after approval

Ask for explicit approval to install the reviewed package. Then run:

```text
node <absolute-skill-directory>/scripts/authored-skill.mjs install \
  --package <absolute-staged-package-path> \
  --root <absolute-project-skill-root> \
  --project <absolute-project-root> \
  --confirmed
```

The helper revalidates the package, refuses to overwrite an existing package,
copies without following symlinks, preserves executable bits, and verifies the
installed fingerprint. It removes a partial destination if the copy fails.

After installation:

1. refresh or rescan the host catalog;
2. re-resolve every step name in the proposal, existing and new;
3. stop on any new ambiguity or name collision;
4. keep the installed fingerprint for the final chain review.

## 6. Finish the chain

Add the new skill to the chain like any other project-local package. The final
review shows the origin per step:

- `remote@<revision>` for pinned remote handoff candidates;
- `project` for existing project-local packages;
- `authored` for skills created in this flow, with their local fingerprint;
- `instruction` for instruction-only steps.

The bundle carries the exact reviewed files. If the chain uses the handoff
flow, pass the authored package as a `localSkills` entry with its reviewed
fingerprint; see the handoff section of `SKILL.md`.

## 7. Failure and abort behavior

- If authoring fails, discard the staged package and offer instruction-only or
  another approach. Do not install a partial package.
- If the audit is unavailable, report that the package was not audited. Do not
  imply it passed.
- If install approval is refused, leave the staged package in place only if the
  user wants to revisit it; otherwise remove it.
- Existing and instruction-only steps remain valid throughout. A failed gap
  must not invalidate the rest of the proposal.
- Never install, import, or run the finished chain as part of this procedure.
