---
name: skill-creator
description: "Guide an agent through creating a new, well-structured agent skill from a rough idea. Runs a structured interview, applies the skill-review quality rubric during scaffolding, and validates the output with skill-review. Produces a staged, ready-to-install skill package."
---

# Skill: Create a New Agent Skill

You are guiding the user (or yourself) through building a new agent skill from scratch. The goal is not just to scaffold files - it is to produce a skill that passes the skill-review quality bar from the start. The workflow runs in five numbered steps with explicit decision points.

Load `references/quality-axes.md` now. You will use the six quality axes throughout all five steps.

---

## Process

### Step 1: Interview

Gather the information needed to build the skill well. Load `references/interview-questions.md` for the full question bank.

Ask the questions in order. Record the answers - you will use them in Steps 2–5. Do not skip questions; each one drives a specific scaffolding decision.

**Minimum required before proceeding:**
- Skill name (must match the directory name)
- One-sentence purpose
- Activation trigger phrase
- Step count and whether any branching or conditional logic exists
- Whether supporting reference material is needed

> **Calibration note:** The interview is open-ended - guide without constraining. If the user is uncertain about step count or complexity, default to modular. It is easier to collapse a modular skill than to refactor a flat one after the fact.

### Step 2: Template Selection

Based on the interview answers, choose the scaffold template:

| Signal | Template |
|--------|----------|
| ≤3 steps, no branching, no reference material | **Flat** - single `SKILL.md` |
| ≥4 steps, OR branching logic, OR supporting material | **Modular** - `SKILL.md` + `references/` |

State your choice and reasoning to the user before proceeding. Allow them to override.

Load the chosen template:
- Flat: Load `references/flat-template.md`
- Modular: Load `references/modular-template.md`

### Step 3: Scaffold

Generate the skill files in a staging directory, never directly in a
host-discovered skill root:

```text
<project>/.skill-loom-authored/<skill-name>/
```

Build each section intentionally against the six quality axes (loaded in the
intro). The staging directory is not discoverable by the host, so a scaffold
cannot become an active skill before review and install approval.

**Section-by-section guidance:**

| Section | Quality axis | What to do |
|---------|-------------|------------|
| YAML frontmatter | - | `name` must match directory name; `description` must include trigger keywords |
| Opening paragraph | Context economy | State exactly what the skill does and when to use it. No generic preamble. |
| `## Process` steps | Procedural clarity | Write *how to approach* each step, not just *what to produce*. Include decision criteria. |
| `## Gotchas` | Gotchas coverage | Add at least two concrete, project-specific edge cases. Use exact pattern: `**{Failure name}.** {What goes wrong and the concrete fix.}` - never generic advice. |
| Load triggers (modular only) | Progressive disclosure | Each trigger must say *when* to load, not just *what* exists. |
| `## Validation` | Validation | Include a self-check checklist or concrete commands the agent can run. |
| Prescriptiveness level | Calibration | Fragile/destructive ops → exact commands. Variable/creative ops → defaults + escape hatches. |

After generating, check: is `SKILL.md` under 500 lines? If not, move bulk content to `references/`.

### Step 4: Pre-flight Check

Before calling `skill-review`, run a self-check against the pre-flight list.

Load `references/preflight-checklist.md` now.

Work through every item on the checklist. For each failure:
1. State what is wrong
2. Fix it immediately
3. Mark it as resolved

Do not proceed to Step 5 until all blockers are cleared.

### Step 5: Validation

Run the formal `skill-review` audit on the newly created skill.

**Check if skill-review is available:**

Resolve it through the current host's skill catalog. Do not assume a slash
command, and do not guess an install path from a name.

If `skill-review` is not available, report the prerequisite clearly:

> ⚠️ **skill-review is unavailable for validation.** The skill has been
> scaffolded and pre-flight checked, but not formally audited. Install the
> `skill-review` package in a host-discovered project skill root before relying
> on its score.

If available, invoke it through the host and scope the audit to the staged
package:

```
Audit only <absolute-staged-skill-path> with skill-review.
Write the audit report beside the package, not inside it:
<absolute-staged-skill-path>/../<skill-name>.SKILL-AUDIT.md
```

**Validation loop:**
1. Review the audit findings.
2. For each finding scored below 2: fix it in the staged skill files.
3. Re-run the audit.
4. Stop when all axes score ≥ 2.0, or when the user explicitly accepts the
   current state and records the open findings.

The audit is advisory. It is not a correctness, security, or safety gate. Do
not describe a passing score as proof that the skill is safe or correct.

After the audit, show the final package inventory and the install path
(`<project>/.agents/skills/<skill-name>/`). Do not install or copy the package
until the user approves that specific install.

---

## Gotchas

- **`name` must exactly match the directory name.** A mismatch breaks skill activation. Check this before Step 5.
- **Load triggers must say *when*, not just *what*.** "Load `references/api-errors.md` if the API returns a non-200" is good. "See references/ for more" is useless and will score a 1 on progressive disclosure.
- **Do not move the first ~100 lines of SKILL.md to references/.** That content defines the skill's purpose and trigger conditions - it must stay inline even if it is verbose.
- **Gotchas must be concrete.** "Handle errors appropriately" scores a 1. "If the `users` table uses soft deletes, queries must include `WHERE deleted_at IS NULL`" scores a 3.
- **skill-review will not run on a skill that has no SKILL.md.** Ensure the file exists and has valid YAML frontmatter before Step 5.
- **Do not skip Step 4.** The pre-flight check catches issues that skill-review will flag. Fixing them before the audit saves a loop.
- **Do not scaffold into `.agents/skills/`, `.opencode/skills/`, or any other host-discovered root.** Staging under `.skill-loom-authored/` keeps an unapproved skill inactive.
- **Never install automatically after the audit.** Show the final inventory and ask for a separate install approval.
- **A passing audit is not a safety result.** Say that plainly; the rubric is advisory.

---

## Validation

After completing the full workflow, verify:

- [ ] `<project>/.skill-loom-authored/<name>/SKILL.md` exists with valid YAML frontmatter
- [ ] `name` in frontmatter matches the directory name
- [ ] `description` contains the trigger keywords from the interview
- [ ] All six quality axes are intentionally addressed in the skill content
- [ ] SKILL.md line count is under 500: `wc -l <skill-dir>/SKILL.md` (expect `< 500 <path>`)
- [ ] YAML frontmatter parses cleanly: `python3 -c "import yaml; yaml.safe_load(open('<skill-dir>/SKILL.md').read())"` exits 0
- [ ] If modular: `references/` exists with at least one file and all load triggers are specific
- [ ] Pre-flight checklist passed with no open blockers
- [ ] `skill-review` audit completed (or prerequisite absence documented); all axes ≥ 2.0 or open findings accepted
- [ ] The audit is described as advisory, not as a safety or correctness gate
- [ ] User has approved a specific install path (`<project>/.agents/skills/<name>/`)
- [ ] No install happened before that approval
