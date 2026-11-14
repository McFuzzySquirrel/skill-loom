# What did the hosted catalog and repo-first chains deliver? {#rollout}

The approved rollout delivered an operator-managed hosted skills catalog, exact selected-package transfer, repository-canonical chains, active-session execution, and optional revision-checked publication. P6 closed for one Ubuntu 26.04 ARM64 Podman host with a documented timing exception and explicit unverified gates.

- The repo chain remains canonical; the hosted library stores an optional copy.
- Selected skills are copied by exact catalog identity and fingerprint into the client repository.
- Remote CLI work uses SSH-backed Podman; the HTTP editor stays loopback-only.

@answer scope="P1-P6 closeout for the approved single-host rollout"
@meta locale=en quality_profile=showcase repo_url=https://github.com/McFuzzySquirrel/skill-loom.git repo_revision=609847ccb04b220e7c0c373703c6b0fa5e4354ab
@source plan title="Hosted-catalog rollout status" path=docs/plans/hosted-catalog-repo-chains-implementation-plan.md lines=2:2
@source pilot-evidence title="Recorded P6 checks" path=docs/plans/hosted-catalog-repo-chains-implementation-plan.md lines=386:391

## What is delivered? {#delivered}

P1 through P6 are complete for the approved rollout. The evidence supports a narrow host and client combination, not general platform support.

| Phase | Delivered capability | Evidence scope |
| --- | --- | --- |
| P1 | Operator-managed catalog, read-only mount, maintenance guide | Linux rootless Podman checks and disposable add/query/update/restore scenario |
| P2 | Exact selected-skill transfer into the client repository | Bounded copy contract; pilot copied the selected workflow package |
| P3 | `chains/<id>.json` source and revision-checked shared-library copy | Stable repo identity, separate publish sidecar, stale-conflict protection |
| P4 | Offline repository-chain procedure in the active session | Success, validation stops, missing input, changed source, and interruption scenarios |
| P5 | Guided remote-authoring companion workflow | Packaged workflow with selected-connection requirements and explicit recovery |
| P6 | Integrated host/client rollout | Ubuntu 26.04 ARM64, rootless Podman 5.7.0, one authorized tailnet client |

## What did the pilot actually prove? {#pilot}

The authorized client completed catalog review/copy, local chain execution, first publish/update, and a stale-revision conflict [P6 record](source:pilot-evidence). A disposable config-volume export/import/restore check and a Podman-socket reboot check also passed. The app remained stopped after reboot [reboot record](source:pilot-evidence).

@facts id=pilot-results
| Host | Ubuntu 26.04 ARM64; rootless Podman 5.7.0 |
| Catalog | Exact entry review and selected package copied |
| Chain | Local active-session run and revision-checked publish/update |
| Conflict | Stale update preserved both repository and hosted records |
| Recovery | Disposable config volume restored; rootless socket active after reboot |
| App state | `skill-loom-app` remained stopped after reboot |

## What remains unverified? {#limits}

@facts id=rollout-limits
| Accepted exception | The pre-pilot backup timing gate was missed; it was not passed retroactively. |
| Identity and platform | Unauthorized-identity denial, SELinux-enforcing behavior, and alternate OS or Podman environments remain unverified. |
| Host lifecycle | Quadlet app boot startup and live image update/rollback remain unverified. |
| Workflow combinations | Live chain-referenced package transfer and repeating local execution after disconnect remain unverified. |
| Security boundary | HTTP and editor are not remotely exposed; SSH/Podman grants broad host-account access, not per-command authorization. |

Consult `docs/current-gaps.md` and the implementation evidence register before making a broader support claim.
