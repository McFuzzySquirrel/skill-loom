---
name: create-project-documentation
description: "Create or refresh a complete software-project documentation suite: README, ADRs, user guide, administrator guide, changelog, and versioned release notes. Use when a project needs launch documentation, a documentation audit, release preparation, consistent operational and user-facing docs, or documentation upkeep as the project changes."
---

# Create Project Documentation

Use this skill to turn an implemented project into a coherent, fact-checked documentation set. It works for applications, libraries, services, CLIs, platforms, and monorepos. Document implemented behavior separately from roadmap or aspirational behavior.

This skill creates or refreshes only the documentation artifacts selected for this run, using the default paths listed under **Outputs** when the user does not specify otherwise. It does not create or maintain a document reference map, edit `AGENTS.md`, or require another skill to complete its work.

## Process

1. **Inventory the project.** Inspect the existing README and docs, source and deployment layout, configuration and environment examples, package/project manifests, test/build scripts, version files, tags, and recent history. Identify user personas, operators, deployment targets, security boundaries, and supported integrations.
2. **Resolve scope and version.** Prefer an existing tag or package/application version. If versions disagree, report the conflict and use the authoritative release source; do not silently invent a version. If no release exists, use `Unreleased` unless the requester supplies a version. Separate current behavior, known limitations, and planned work.
3. **Create the document set.** Use the templates in `references/` as a starting point. Create only applicable sections, but do not omit a requested artifact. For a project with no end users or administrators, state that the role is not applicable and document the relevant developer/operator workflow instead.
4. **Write ADRs from evidence.** Use `references/adr-template.md`. Hold one decision per record: record durable architectural decisions, not every implementation detail, because a record covering several decisions has no meaningful status and cannot be superseded. Give each record a stable `ADR-NNNN` ID, a repository-relative `applies_to` file-glob scope, and a status in YAML front matter. Include imperative agent rules (`MUST`, `MUST NOT`, and, when appropriate, `SHOULD`) plus a concrete verification command or manual check. Keep the context, decision drivers, considered options, outcome, positive and negative consequences, per-option pros and cons, deciders, date, technical story, and links as the decision rationale. Load `references/adr-index-template.md` when creating or refreshing the ADR index, and link the index from the README.
5. **Write task-oriented guides.** The user guide should describe goals, workflows, visible states, recovery, accessibility, and privacy. The administrator guide should describe prerequisites, installation, configuration, secrets, operations, backups, upgrades, troubleshooting, and security hardening. Use exact commands and configuration names found in the project.
6. **Prepare release communication.** Add a Keep a Changelog-compatible changelog and release notes for the resolved version. Include highlights, compatibility, installation/upgrade notes, known limitations, validation status, and links to detailed docs. Do not claim tests, integrations, or production support that were not verified.
7. **Create or refresh the README.** Use the section structure in `references/readme-template.md`. Write the README after the document set exists so it can link to the guides, ADR index, and release notes; when updating an existing README, fill gaps and correct stale content while preserving its voice, badges, and custom sections instead of rewriting it. Follow the badge guidance in `references/readme-template.md`, preserve existing badges, and re-verify that each retained badge still resolves and links to a real target. All 15 sections are required: keep every heading, and report a section as not applicable and obtain approval before dropping it, recording the reason. Link to `CONTRIBUTING.md` and `LICENSE` when the repository has them, and write those sections in full when it does not. Verify the Getting Started commands against the manifest, scripts, or observed output before publishing them.
8. **Refresh navigation within the selected document set.** Keep links, status statements, and navigation consistent among the artifacts selected for this run. Do not edit unrelated component or feature documents, or historical documents outside that set; report other documentation that may need attention separately. Do not rewrite the README in this step.
9. **Validate.** Check local Markdown links, headings and navigation, commands against scripts, configuration names against source, version references, secret leakage, unsupported claims, and spelling of product terms. Confirm the README contains every required section and links only to documents that exist. Run the project’s available build/test/lint gates and `git diff --check`.

## Required Evidence Rules

- Prefer source code, manifests, deployment files, tests, and observed command output over requirements documents when describing current behavior.
- Treat unchecked task lists and roadmap statements as plans unless implementation evidence confirms completion.
- Never publish passwords, tokens, private URLs, signing keys, or copied secret values. Show variable names and safe placeholders only.
- Explain delivery semantics precisely. “At least once with idempotent effect” is not the same as transport-level exactly once.
- Mark consumer-owned responsibilities, such as workflow authorization or audit, instead of assigning them to this project.

## Outputs

Default paths are `README.md`, `CHANGELOG.md`, `docs/adr/` with one file per record named `NNNN-kebab-title.md`, `docs/user-guide.md`, `docs/admin-guide.md`, and `docs/releases/`. Adapt paths to the repository’s existing convention when one exists. These paths and any user-approved additions define this run’s scope: do not create or refresh other documentation artifacts implicitly. Keep `SKILL.md` generic; project facts belong in generated documentation.

Load these references when writing the corresponding artifact:

- Load `references/adr-template.md` when creating or updating an ADR.
- Load `references/adr-index-template.md` when creating or refreshing the ADR index.
- Load `references/user-guide-template.md` when the project has end users or a client workflow.
- Load `references/admin-guide-template.md` when the project is deployed, hosted, configured, or operated.
- Load `references/changelog-template.md` when establishing or refreshing change history.
- Load `references/release-notes-template.md` when preparing a versioned release.
- Load `references/readme-template.md` when creating or refreshing the README.

## Validation Checklist

- [ ] Requested documents exist and are linked from the README or documentation index.
- [ ] Version and release date agree with the authoritative version source.
- [ ] No credentials or secrets are present.
- [ ] Commands, ports, paths, environment variables, and endpoints match the repository.
- [ ] Current, planned, and unsupported behavior are clearly distinguished.
- [ ] Each ADR holds one decision and populates status, deciders, date, decision drivers, considered options, and both positive and negative consequences.
- [ ] Each ADR has a stable `ADR-NNNN` front-matter ID, a relevant `applies_to` scope, actionable imperative rules, and a concrete verification check; rules do not conflict with other applicable ADRs.
- [ ] Superseded ADRs point at the record that replaced them and the replacement points back.
- [ ] User and administrator audiences are clearly separated.
- [ ] Release notes link to upgrade, user, and administrator guidance.
- [ ] README contains all 15 required sections, and every dropped section has a recorded justification.
- [ ] README links resolve to documents that exist, and it links to rather than duplicates the user guide, admin guide, ADR index, and release notes.
- [ ] README Getting Started commands were verified against the manifest, scripts, or observed output, and What’s Next is not presented as shipped behavior.
- [ ] Every README badge resolves, links to a real target, and claims only a signal the project actually publishes; no badge covers a missing workflow, package, coverage report, license, or funding program.
- [ ] Changes are limited to the artifacts selected for this run; unrelated documents and repository-wide documentation instructions were left untouched.
- [ ] Local Markdown links resolve, including links from nested docs.
- [ ] The ADR index lists every record and is linked from the README.
- [ ] Build, test, lint, and documentation checks have been run where available.

## Gotchas

**Agent rules need scope and a check.** Set `applies_to` to the files governed by the decision, write rules as direct obligations rather than descriptive prose, and give them a concrete command or review procedure. Use a project-wide glob only when the decision really applies everywhere, and resolve conflicts with other applicable ADRs rather than leaving agents to guess.

**Stale implementation status.** Feature documents often retain unchecked planning tasks after code lands. Verify against source, tests, and progress records, then label historical checklists instead of presenting them as current truth.

**Version drift.** Monorepos commonly contain several package versions and an app version. Identify which version defines the release, document other package versions as component versions, and do not mass-replace unrelated dependency versions.

**Deployment-only settings.** A variable shown in a Compose file may be development-only or intentionally unsafe outside a trusted network. Explain its scope and never present insecure development flags as production instructions.

**False integration claims.** A contract stub, mock, or provider test does not prove compatibility with a live external product. Name the validation boundary and the untested external runtime explicitly.

**Broken nested links.** Relative links are resolved from the linking file, not the repository root. Validate links after moving content and use paths relative to each document.

**One record, one decision.** A record that bundles several decisions has no meaningful status, cannot be superseded as a unit, and forces every reader through the irrelevant parts. Split it into one record per decision, each with its own drivers, options, and consequences, and leave system-level descriptions in an architecture document rather than forcing them into a decision.

**Superseding is a two-sided edit.** Replacing a decision means creating the new record, setting the old record's status to `Superseded by ADR-NNNN`, linking both from each other's `Links`, and updating each record's date, which is the last update rather than the creation date. Editing only the new record leaves a stale record that readers still trust.

**A required section with nothing true to put in it.** All 15 README sections are required, which makes Architecture, Security, and Acknowledgements an invitation to write plausible-sounding fiction. Report the section as not applicable and get the drop approved; never pad it with guesses, and never carry a claim over from another project.

**The README drifts from the guides.** The README is the entry point, not a second source of truth. Link to the user guide, admin guide, ADR index, and release notes instead of repeating their detail, and when the two disagree, correct the README. Copying guide content into the README guarantees they diverge.

**A badge is a claim with a URL.** A badge asserts a live, verifiable fact, so a hardcoded version, a dead CI workflow, or a coverage badge for unmeasured code is fabricated evidence that looks authoritative. Use dynamic badges, link each one to its source, verify the image and target resolve, omit signals the project does not publish, and re-check retained badges when refreshing an existing README. A badge for a private workflow renders publicly as “no status”, so leave it out.

**A quickstart that does not run.** Getting Started is the most read and most copied part of a README. Run the commands, or match them to the package manifest and task scripts, before publishing. An unverified command costs every reader who follows it.

**Scope creep during navigation updates.** A stale link or status statement in another component document can make it tempting to expand the run. Keep edits within the selected output set and report other documentation that may need attention separately.
