# How do I author a repo chain from a hosted catalog? {#repo-first}

Keep the chain in the repository and run it in the active agent session. Use the hosted catalog only to copy selected packages, and publish a shared-library copy only when the user confirms.

- Review exact catalog entry ids and fingerprints before copying.
- Copy only to the client repository's `.agents/skills/`; existing packages are never overwritten.
- Local execution needs no hosted connection after the chain and packages are present.
- Hosted updates use the sidecar revision; stale conflicts require comparison and explicit recovery.

@answer scope="Repo-first workflow; one approved Ubuntu host/client pilot"
@meta locale=en quality_profile=showcase repo_url=https://github.com/McFuzzySquirrel/skill-loom.git repo_revision=609847ccb04b220e7c0c373703c6b0fa5e4354ab
@source workflow title="Companion workflow contract" path=.github/skills/loom-chain-workflow/SKILL.md lines=125:235
@source bridge title="Client-side Podman bridge" path=.github/skills/loom-chain-workflow/scripts/skill-loom-podman.mjs lines=239:412
@source repo-cli title="Repository chain CLI" path=src/server/repo-chains/cli.ts lines=64:154
@source pilot title="Approved pilot and remaining limits" path=docs/plans/hosted-catalog-repo-chains-implementation-plan.md lines=2:2
@source pilot-evidence title="P6 reboot and remaining gates" path=docs/plans/hosted-catalog-repo-chains-implementation-plan.md lines=391:395

## How do I go from catalog to a run? {#steps}

The host provides selected packages, but the client keeps its path and chain files. The agent can stop after local execution; publication is a separate choice and requires explicit confirmation.

@workflow id=repo-workflow title="Hosted catalog to repo-owned chain"
| copy | Select packages | security |
| author | Author chain | backend |
| run | Run locally | external |
| copy > author | |
| author > run | |

@steps id=repo-workflow-steps
| step-copy | Select packages | Select the host project over the trusted SSH-backed Podman connection. Confirm each catalog id, fingerprint, and package inventory before copying into `.agents/skills/`. Do not send the client repository path to the host. Stop on conflicts or partial success. | repo-workflow | copy |
| step-author | Author chain | Save the canonical chain as `chains/<id>.json`; keep hosted mapping in its sidecar. | repo-workflow | author |
| step-run | Run locally | Preview ordered steps and inputs, then ask for confirmation. No hosted connection is needed once local. | repo-workflow | run |

After local execution, publish a shared copy only with explicit confirmation; updates require the sidecar revision check.

## How are updates and conflicts protected? {#conflicts}

| Operation | Required check | Failure behavior |
| --- | --- | --- |
| Copy selected skills | Exact entry id plus fingerprint | Reject changed identity, unsafe transfer, or existing destination |
| First publish | Explicit target confirmation and collision check | Stop on a hosted id or name collision |
| Update | Sidecar's last successful hosted revision | Preserve both copies and report expected/current revisions |
| Republish after conflict | Review both definitions and confirm exact observed hosted revision | No automatic retry or silent revision refresh |

## Which pilot claims are verified? {#pilot}

One authorized tailnet client completed the end-to-end catalog, local-run, publish/update, and stale-conflict journey on Ubuntu 26.04 ARM64 with rootless Podman 5.7.0 [P6 status](source:pilot).

@facts id=pilot-limits
| Host security | SELinux was disabled; enforcing behavior and unauthorized-identity denial remain unverified. |
| Platform | Alternate OS and Podman environments remain unverified. |
| Workflow | Live chain-referenced package copy and local execution after disconnect remain unverified. |
| Reboot | Config-volume restore and Podman-socket reboot passed; the app remained stopped [reboot evidence](source:pilot-evidence). |
| Access boundary | Direct HTTP/editor access is unsupported; SSH/Podman grants host-account access. |

See `docs/plans/hosted-catalog-repo-chains-implementation-plan.md` and `docs/current-gaps.md` for evidence and remaining gates.
