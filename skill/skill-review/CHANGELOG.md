# Changelog

All notable changes to `skill-review` will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Version numbers follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

---

## [1.1.0] - 2026-07-22

### Fixed

- **References folder detection** (`rubric.ts`): `hasRefsDir`, `hasAssetsDir`, and `hasScriptsDir` were passed into `AuditInput` but never forwarded to the scoring or suggestion functions - on-disk folder presence was silently ignored. All three flags are now passed through correctly.
- **Progressive disclosure scoring**: a skill with an existing `references/` or `assets/` directory on disk now scores ≥ 2, even if the folder is not yet linked in `SKILL.md`. Previously it would score 1 and receive a misleading "Create a references/ directory" suggestion.
- **Validation scoring**: a `scripts/` directory present on disk now counts the same as a `scripts/` reference in `SKILL.md` when computing the validation score.
- **Misleading suggestion text**: when a `references/` or `assets/` directory already exists on disk and the progressive disclosure score is 1, the suggestion now reads "Link your existing `references/` files in `SKILL.md` and add load triggers" instead of "Create a `references/` directory".

### Added

- **`--skills-dir` / `-d` CLI flag** (`skill-review.ts`): scan a specific root folder for `SKILL.md` files, overriding the standard auto-detection paths (`.agents/skills/`, `skills/`, etc.). Useful when skills are stored in a custom or non-standard location.

### Documentation

- Added comprehensive `README.md` with full installation guide, CLI reference table, auto-detection logic explanation, providers table, troubleshooting section, and architecture pointer.
- Added `docs/adr/0001-skill-review-architecture.md` - Architecture Decision Record covering static heuristics vs LLM scoring, the six-axis rubric design, the modular provider pattern, TypeScript + tsx runtime choice, portable skill package design, and on-disk folder detection rationale.
- Added `CHANGELOG.md` (this file).

---

## [1.0.0] - 2026-07-18

### Added

- Initial release of `skill-review`.
- Six-axis rubric scoring each skill 1–3 on: Context economy, Gotchas coverage, Procedural clarity, Progressive disclosure, Calibration, Validation.
- `scripts/rubric.ts` - heuristic scoring engine and Markdown report formatter.
- `scripts/skill-review.ts` - CLI entry point with `--provider`, `--files`, `--min-score`, `--fail-below`, and `--root` flags.
- `scripts/detect.ts` - skill file discovery, git diff–based change detection, and path validation helpers.
- Modular provider pattern with implementations for GitHub (`github.ts`), GitLab (`gitlab.ts`), Azure DevOps (`ado.ts`), and stdout (`stdout.ts`).
- CI example workflows for GitHub Actions (`ci-examples/github-actions.yml`) and Azure DevOps (`ci-examples/azure-pipelines.yml`).
- Portable standalone skill package at `templates/skills/skill-review/` - a self-contained directory with `SKILL.md`, embedded scripts, and `package.json` that can be dropped into any project's skill directory.
- TypeScript throughout; validated with `npm run typecheck` (`tsc --noEmit`).

[Unreleased]: https://github.com/McFuzzySquirrel/experimental-skills/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/McFuzzySquirrel/experimental-skills/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/McFuzzySquirrel/experimental-skills/releases/tag/v1.0.0
