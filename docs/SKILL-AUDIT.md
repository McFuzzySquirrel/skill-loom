# Skill Audit Report

**Generated:** 2026-11-04
**Audited by:** `forge-skill-review`
**Skills audited:** 6

---

## Summary Scores

| Skill | Context economy | Gotchas coverage | Procedural clarity | Progressive disclosure | Calibration | Validation | Overall |
|-------|---|---|---|---|---|---|---------|
| `atomic-json-persistence` | 3 | 3 | 3 | 3 | 3 | 3 | 3 |
| `harness-adapter-contract` | 3 | 3 | 3 | 3 | 3 | 3 | 3 |
| `pty-run-lifecycle` | 3 | 3 | 3 | 3 | 3 | 3 | 3 |
| `live-harness-verification` | 3 | 3 | 3 | 3 | 3 | 3 | 3 |
| `playwright-harness-fixtures` | 3 | 3 | 3 | 3 | 3 | 3 | 3 |
| `accessible-react-workflows` | 3 | 3 | 3 | 3 | 3 | 3 | 3 |

**Score interpretation:**
- 2.5–3.0: Strong - follows best practices well
- 1.5–2.4: Adequate - works but has improvement opportunities
- 1.0–1.4: Needs work - significant gaps against best practices

---

### `atomic-json-persistence`
**Overall score:** 3 🟢 (strong)
**Path:** `/home/mcsquirrel/projects/personal/slan/.opencode/skills/atomic-json-persistence/SKILL.md`
**Reviewer-style proxy:** 3 (proxy)
**Strengths:**
- Strong context economy
- Strong gotchas coverage
- Strong procedural clarity
- Strong progressive disclosure
- Strong calibration
- Strong validation
**Improvement opportunities:** None - all axes scored 3

---

### `harness-adapter-contract`
**Overall score:** 3 🟢 (strong)
**Path:** `/home/mcsquirrel/projects/personal/slan/.opencode/skills/harness-adapter-contract/SKILL.md`
**Reviewer-style proxy:** 3 (proxy)
**Strengths:**
- Strong context economy
- Strong gotchas coverage
- Strong procedural clarity
- Strong progressive disclosure
- Strong calibration
- Strong validation
**Improvement opportunities:** None - all axes scored 3

---

### `pty-run-lifecycle`
**Overall score:** 3 🟢 (strong)
**Path:** `/home/mcsquirrel/projects/personal/slan/.opencode/skills/pty-run-lifecycle/SKILL.md`
**Reviewer-style proxy:** 3 (proxy)
**Strengths:**
- Strong context economy
- Strong gotchas coverage
- Strong procedural clarity
- Strong progressive disclosure
- Strong calibration
- Strong validation
**Improvement opportunities:** None - all axes scored 3

---

### `live-harness-verification`
**Overall score:** 3 🟢 (strong)
**Path:** `/home/mcsquirrel/projects/personal/slan/.opencode/skills/live-harness-verification/SKILL.md`
**Reviewer-style proxy:** 3 (proxy)
**Strengths:**
- Strong context economy
- Strong gotchas coverage
- Strong procedural clarity
- Strong progressive disclosure
- Strong calibration
- Strong validation
**Improvement opportunities:** None - all axes scored 3

---

### `playwright-harness-fixtures`
**Overall score:** 3 🟢 (strong)
**Path:** `/home/mcsquirrel/projects/personal/slan/.opencode/skills/playwright-harness-fixtures/SKILL.md`
**Reviewer-style proxy:** 3 (proxy)
**Strengths:**
- Strong context economy
- Strong gotchas coverage
- Strong procedural clarity
- Strong progressive disclosure
- Strong calibration
- Strong validation
**Improvement opportunities:** None - all axes scored 3

---

### `accessible-react-workflows`
**Overall score:** 3 🟢 (strong)
**Path:** `/home/mcsquirrel/projects/personal/slan/.opencode/skills/accessible-react-workflows/SKILL.md`
**Reviewer-style proxy:** 2 (proxy)
**Strengths:**
- Strong context economy
- Strong gotchas coverage
- Strong procedural clarity
- Strong progressive disclosure
- Strong calibration
- Strong validation
**Improvement opportunities:** None - all axes scored 3

---

## Next Steps

Review the suggested changes above. Fix structural issues first, then tackle the lowest-scoring axes.

---

## Gate

```bash
cd .opencode/skills/forge-skill-review
npm run forge-skill-review -- \
  --files .opencode/skills/atomic-json-persistence/SKILL.md \
          .opencode/skills/harness-adapter-contract/SKILL.md \
          .opencode/skills/pty-run-lifecycle/SKILL.md \
          .opencode/skills/live-harness-verification/SKILL.md \
          .opencode/skills/playwright-harness-fixtures/SKILL.md \
          .opencode/skills/accessible-react-workflows/SKILL.md \
  --provider stdout --min-score 2 --fail-below --min-axis 2 --fail-axis-below --fail-structural
```

Result: exit 0. All six axes scored 3.0 for all six planned `create` candidates, with no structural issues. Heuristic review is complete; behavioral evidence (unit, browser, and live probes) is produced during implementation and is not claimed here.
