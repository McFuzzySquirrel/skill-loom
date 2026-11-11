# README Template

All 15 sections are required. Keep every heading. If a section genuinely does not apply, report it and obtain approval to drop it rather than inventing content to fill it, and record the reason in the run summary.

The README is the entry point to the project, not a second copy of the documentation. Link to the user guide, admin guide, ADR index, and release notes instead of repeating their detail, and keep every command, configuration name, endpoint, and version traceable to the repository. Label planned work as planned. Never publish credentials, private URLs, or copied secret values.

## Title and Introduction

Project name, then one or two sentences stating what the project is and who it is for. Add a logo or a screenshot of the primary interface when one exists, and link a live demo, walkthrough, or article if available.

### Badges

Place badges directly under the project name, before the introduction prose, on one or two lines. Include only signals the project actually publishes, and keep the set to roughly six to eight badges rather than a badge wall. Order them by usefulness to a first-time reader:

| Signal | Typical source | Include only when |
| --- | --- | --- |
| CI / build | GitHub Actions workflow badge | The workflow exists, runs on the default branch, and the repository is public. |
| Release / version | GitHub Releases, npm, PyPI, crates.io, or Docker Hub | The project is actually published there. |
| Downloads | npm, PyPI, or Docker Hub | Download counts are public and meaningful. |
| Coverage | Codecov or Coveralls | Coverage is genuinely collected and enforced. |
| Docs | Read the Docs, docs.rs, or GitHub Pages | The documentation site is live. |
| License | `shields.io/github/license` | A real `LICENSE` file exists. |
| Runtime / platform | shields.io static or support-matrix badge | Supported runtimes or platforms are documented. |
| Security | OpenSSF Scorecard, Snyk, or Socket | The scan is public and current. |
| Community | Discord, Matrix, contributors, or good-first-issue badge | The channel or program is active and public. |
| Funding | GitHub Sponsors or Open Collective | The project actually accepts funding. |
| Made with / ecosystem | Project or ecosystem badge | The technology is part of the project's identity, not incidental. |

Use a dynamic badge for anything that changes, and link every badge to the page that proves it:

```markdown
[![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/OWNER/REPO/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/OWNER/REPO?sort=semver)](https://github.com/OWNER/REPO/releases)
[![License](https://img.shields.io/github/license/OWNER/REPO)](LICENSE)
[![Contributors](https://img.shields.io/github/contributors/OWNER/REPO)](https://github.com/OWNER/REPO/graphs/contributors)
[![Sponsor](https://img.shields.io/github/sponsors/OWNER)](https://github.com/sponsors/OWNER)
```

Do not add a badge for a workflow that does not exist, a package that is not published, coverage that is not measured, a license the repository does not have, or a funding program that is not active. Do not hardcode a version, percentage, or download count that will drift. Verify that each image URL resolves and each link points to a real target, and drop vanity badges such as stars, forks, and duplicate language badges unless the requester asks for them. A badge for a private workflow renders publicly as “no status”, so omit it.

## Table of Contents

Anchor links to the sections below, so readers can jump to the part they need.

## About

What the project does, the problem it solves, and how it works at a high level. Key highlights only; leave implementation detail to the guides and ADRs.

## Features

The major capabilities as a table of feature and description, or as a subheading per feature when a feature needs more context. Describe what each feature does, not how it is built.

## Tech Stack

Languages, frameworks, datastores, and notable tooling, with versions where they are pinned. State the stack plainly enough that a developer can judge fit before reading further.

## Architecture

The components and how they interact: entry points, services, storage, caches, and external services. Prefer a Mermaid diagram over an image; prefer the simplest diagram that is still accurate. Link to the ADRs that explain why the boundaries sit where they do.

## Project Structure

The key directories and files with a one-line purpose each, for example a `path/ — purpose` list. List project directories only; note tooling and editor configuration on a single labelled line rather than documenting it as project content.

## Getting Started

Prerequisites, then the exact commands to clone, install, configure, and run the project locally. Verify every command against the package manifest, task scripts, or observed output before publishing it. Note any platform limitation or minimum runtime version.

## Configuration

Each setting as name, purpose, and default: environment variables, command-line flags, feature flags, and configuration files. Show safe placeholder values, never real credentials. Link to the admin guide for operational configuration.

## Security

The authentication and authorization model, how secrets are handled, and how to report a vulnerability. Point to the admin guide for hardening and operational security detail.

## How to Contribute

Link to `CONTRIBUTING.md` when the repository has one. When it does not, state the contribution workflow: how to set up, the expectations for changes, and the review process.

## What's Next

Planned work and known gaps, explicitly marked as not yet shipped. Give contributors ideas for where to start. Keep it consistent with the roadmap and issue tracker; do not present plans as delivered behavior.

## License

Link to `LICENSE` when the repository has one. When it does not, state the license by name. Do not paste the full license text.

## Acknowledgements

Contributors, upstream projects, libraries, and reference material the project builds on.

## Author

Maintainer name and a contact route for questions, bug reports, or collaboration.
