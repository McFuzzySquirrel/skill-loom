# Support

This repository is maintained by the agent team below. The original build
requirements and execution tooling have been retired.

## Team

| Agent | Scope | Invoke when |
|---|---|---|
| support-lead | triage, release, cross-module | priority, routing, release, architecture |
| backend-engineer | `src/server/**`, `src/shared/**`, `tests/unit/**`, `tests/integration/**` | server routes, config, persistence, catalog, preflight, PTY, runs |
| frontend-engineer | `src/web/**`, `tests/e2e/**` | UI, accessibility, keyboard, browser tests |
| integration-engineer | `scripts/live-discovery.ts`, `scripts/live-execution.ts`, `docs/evidence/**` | real OpenCode and Copilot CLI behaviour |
| platform-engineer | `package.json`, `tsconfig*.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `scripts/check-docs.mjs`, `README.md`, `CHANGELOG.md`, `docs/OPERATIONS.md`, `docs/user-guide.md`, `docs/admin-guide.md`, `docs/adr/**`, `docs/releases/**` | build, tooling, dependency pins, docs gate |

## Ownership

| Area | Owner | Checks |
|---|---|---|
| `src/server` | backend-engineer | `npm test` |
| `src/shared` | backend-engineer | `npm test` |
| `src/web` | frontend-engineer | `npm run typecheck:web` |
| `tests/unit` | backend-engineer | `npx vitest run tests/unit` |
| `tests/integration` | backend-engineer | `npx vitest run tests/integration` |
| `scripts/live-discovery.ts` | integration-engineer | `npm run test:live:discovery` |
| `scripts/live-execution.ts` | integration-engineer | `npm run test:live:execution` |
| `scripts/check-docs.mjs` | platform-engineer | `npm run check` |
| `README.md`, `docs/OPERATIONS.md` | platform-engineer | `npm run check` |
| `CHANGELOG.md`, `docs/user-guide.md`, `docs/admin-guide.md`, `docs/adr/**`, `docs/releases/**` | platform-engineer | review plus `npm run check` for the README and operations contract |
| build and test configuration | platform-engineer | `npm run typecheck` |

## Intake

1. Capture the report with reproduction steps and expected behavior.
2. Route to the owning agent from the ownership table.
3. The owner reproduces, fixes, adds a regression test, and runs the owned
   checks.
4. Cross-module or product decisions go to the support lead.
5. The support lead records the release evidence.

## Release checklist

- [ ] Owned checks pass.
- [ ] Changelog or release notes updated.
- [ ] Version bumped when the project publishes one.
- [ ] No open blocker or accepted-risk item without an owner.

## Escalation

- Unclear ownership: support-lead.
- Cross-module change: support-lead coordinates the owners.
- Product or scope decision: the human maintainer.
