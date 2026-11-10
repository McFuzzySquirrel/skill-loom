# skill-review

Audit your project's skills against [agentskills.io best practices](https://agentskills.io/skill-creation/best-practices) and get inline PR guidance.

- Scores each skill 1–3 on six quality axes and posts the report as a PR comment
- Also includes a deterministic reviewer-style proxy score so semantic guidance can be tracked even when no human reviewer is available
- When applying changes, the agent first presents a short review plan before editing anything
- Supports GitHub, GitLab, Azure DevOps, and stdout output
- Works as a standalone skill package your AI agent can run autonomously
- Zero runtime cost - fully static heuristics, no LLM API needed

---

## Contents

- [Requirements](#requirements)
- [Installation](#installation)
  - [Option A: Full repo tooling (best for CI)](#option-a-full-repo-tooling-best-for-ci)
  - [Option B: Standalone skill folder (portable)](#option-b-standalone-skill-folder-portable)
- [Usage](#usage)
  - [CLI reference](#cli-reference)
  - [Auto-detection logic](#auto-detection-logic)
- [Providers](#providers)
- [CI setup](#ci-setup)
- [Rubric](#rubric)
- [File layout](#file-layout)
- [Troubleshooting](#troubleshooting)
- [Architecture](#architecture)

---

## Requirements

- Node.js 18+ (Node.js 20+ recommended)
- npm 9+
- For PR comment posting: a CI environment with the appropriate provider env vars set (see [Providers](#providers))

---

## Installation

### Option A: Full repo tooling (best for CI)

Use this option when you want to run the auditor as a CI job in your own repository.

```bash
# 1. Copy the skill-review directory into your repo
cp -r path/to/skill-review .

# 2. Install dependencies
cd skill-review
npm install

# 3. Verify it works locally
npm run skill-review -- --provider stdout
```

Then copy a CI example file to wire it into your pipeline (see [CI setup](#ci-setup)).

### Option B: Standalone skill folder (portable)

Use this option when you want your AI agent to run the audit autonomously from within your project's skills directory.

```bash
# 1. Copy the self-contained skill package.
# From Skill Loom, use dist/skills/skill-review/; in this repository, the
# package root also contains SKILL.md. Do not copy node_modules.
cp -r skill-review/templates/skills/skill-review .agents/skills/

# 2. Install dependencies only if you want the script-based provider
cd .agents/skills/skill-review
npm install

# 3. Run immediately - auto-detects the git root as project root
npm run skill-review -- --provider stdout --min-score 1.5
```

The audit score is advisory. It is not a correctness, safety, or security
certification, and it does not approve a skill for installation.

The skill package includes a `SKILL.md` that tells the agent when and how to invoke the audit scripts autonomously.

---

## Usage

```bash
# Audit all changed SKILL.md files in the current PR (auto-detected via git diff)
npm run skill-review -- --provider github

# Audit specific files
npm run skill-review -- --files path/to/my-skill/SKILL.md another-skill/SKILL.md

# Scan an entire folder for skills (e.g. skills stored outside standard paths)
npm run skill-review -- --skills-dir /path/to/my-skills --provider stdout

# Set a minimum score threshold and fail the build if any skill falls below it
npm run skill-review -- --provider github --min-score 1.5 --fail-below

# Print report to stdout without posting to a PR
npm run skill-review -- --provider stdout
```

### CLI reference

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--provider <name>` | `-p` | `stdout` | Output target: `github`, `gitlab`, `ado`, `stdout` |
| `--files <paths...>` | `-f` | - | One or more explicit `SKILL.md` paths to audit |
| `--skills-dir <path>` | `-d` | - | Root folder to scan for skills; overrides auto-detection |
| `--min-score <score>` | `-s` | `1.5` | Warn when any skill scores below this value (1.0–3.0) |
| `--fail-below` | | `false` | Exit with code 1 if any skill is below `--min-score` |
| `--root <path>` | `-r` | git root | Project root for git diff and relative path resolution |

### Auto-detection logic

When neither `--files` nor `--skills-dir` is provided, the tool resolves which skills to audit in this order:

1. **Changed files** - runs `git diff` against the PR merge base and finds all `SKILL.md` files that were added or modified.
2. **All skills in a standard directory** - if no changed files are found, scans the first directory that exists and contains at least one `SKILL.md`:
   - `.agents/skills/`
   - `skills/`
   - `.opencode/skills/`
   - `.claude/skills/`
   - `templates/skills/`

Use `--skills-dir` to scan a custom root path regardless of the above.

---

## Providers

| Provider | When to use | Required env vars |
|----------|-------------|-------------------|
| `stdout` | Local runs, debugging | none |
| `github` | GitHub Actions PRs | `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_REF` |
| `gitlab` | GitLab CI/CD MRs | `GITLAB_TOKEN`, `CI_PROJECT_ID`, `CI_MERGE_REQUEST_IID` |
| `ado` | Azure DevOps PRs | `SYSTEM_ACCESSTOKEN` (OAuth bearer, preferred) or `ADO_PAT` (Basic auth fallback); also `SYSTEM_TEAMFOUNDATIONCOLLECTIONURI`, `SYSTEM_TEAMPROJECT`, `BUILD_REPOSITORY_ID`, `SYSTEM_PULLREQUEST_PULLREQUESTID` |

---

## CI setup

Copy the relevant example file into your repository:

| File | CI system | Destination |
|------|-----------|-------------|
| `ci-examples/github-actions.yml` | GitHub Actions | `.github/workflows/skill-review.yml` |
| `ci-examples/azure-pipelines.yml` | Azure DevOps | `azure-pipelines.yml` (repo root) |

Both examples run the tool against changed `SKILL.md` files on every PR and post the audit report as a PR comment. Adjust the `--min-score` and `--fail-below` flags to match your quality gate.

---

## Rubric

Each skill is scored 1–3 on six axes. The overall score is the average, rounded to one decimal place.

| Axis | Score 1 | Score 2 | Score 3 |
|------|---------|---------|---------|
| **Context economy** | Generic fundamentals that waste tokens | Mostly focused, minor filler | Tight, project-specific content only |
| **Gotchas coverage** | No `## Gotchas` section | Has gotchas, not specific enough | 3+ concrete, environment-specific gotchas |
| **Procedural clarity** | Declares output, no process | Has a process section, missing steps | Step-by-step with decision criteria |
| **Progressive disclosure** | Everything in one file | Partial use of `references/` or `assets/` | `references/` or `assets/` used with load triggers |
| **Calibration** | Uniform prescriptiveness | Some structure, could tighten | Exact commands for fragile ops + escape hatches |
| **Validation** | No verification step | `## Validation` with at least one checkbox | Checklist of 3+ steps with a script or self-check |

**Score tiers:**
- 2.5–3.0 🟢 Strong - follows best practices well
- 1.5–2.4 🟡 Adequate - works but has improvement opportunities
- 1.0–1.4 🔴 Needs work - significant gaps against best practices

---

## File layout

```
skill-review/
├── scripts/                    # TypeScript audit scripts
│   ├── skill-review.ts         # CLI entry point
│   ├── rubric.ts               # Scoring logic and report formatter
│   ├── detect.ts               # Skill file discovery and git diff helpers
│   └── providers/              # Output provider implementations
│       ├── provider.ts         # Provider interface
│       ├── github.ts
│       ├── gitlab.ts
│       ├── ado.ts
│       └── stdout.ts
├── ci-examples/
│   ├── github-actions.yml      # Copy to .github/workflows/skill-review.yml
│   └── azure-pipelines.yml     # Copy to azure-pipelines.yml
├── templates/
│   └── skills/skill-review/    # Portable standalone skill package
│       ├── SKILL.md            # Agent skill instructions
│       ├── scripts/            # Embedded copy of audit scripts
│       └── package.json
├── docs/
│   └── adr/
│       └── 0001-skill-review-architecture.md
├── CHANGELOG.md
├── package.json
└── README.md
```

---

## Troubleshooting

**"No skills directory found"**  
The tool did not find any of the standard skill directories and no `SKILL.md` files changed in git. Use `--skills-dir <path>` to point to the directory where your skills live, or `--files` to audit a specific file.

**"Missing files: ..."**  
One or more paths passed to `--files` do not exist. Check the path is correct relative to `--root` (which defaults to the git root).

**Score lower than expected despite having a `references/` folder**  
Make sure the `SKILL.md` contains at least one link to a file in the `references/` folder and a load trigger phrase (e.g., `load when` or `load references/...`). The tool counts both on-disk folder presence and in-file references.

**Provider posts no comment**  
Check that the required environment variables are set for your provider (see [Providers](#providers)). Run with `--provider stdout` first to confirm the audit itself is working.

**TypeScript errors when running `npm run typecheck`**  
Run `npm install` inside the `skill-review/` directory (or the standalone skill folder) to ensure all dependencies are present before typechecking.

---

## Architecture

See [`docs/adr/0001-skill-review-architecture.md`](docs/adr/0001-skill-review-architecture.md) for the full Architecture Decision Record covering: static heuristics vs LLM scoring, the six-axis rubric, the reviewer-style proxy score, the modular provider pattern, TypeScript + tsx runtime, the portable skill package, and on-disk folder detection.

For the workflow refinement around the reviewer-style proxy and the review-plan-before-edits step, see [`docs/adr/0002-hybrid-review-proxy-and-review-plan.md`](docs/adr/0002-hybrid-review-proxy-and-review-plan.md).
