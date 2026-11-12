---
name: remote-release-audit
description: Audit release artifacts before remote redistribution.
allowed-tools: Read Grep
inputs: [release_manifest]
outputs: [attestation_bundle]
metadata:
  tags: [release, remote, attestation]
---

# Remote release audit

Review release artifacts before a remote redistribution.

## Attestation bundle

Collect the attestation bundle, verify every referenced artifact digest, and
record the pinned source and revision in the release evidence.

## Redistribution review

Confirm that the approved package inventory matches the pinned snapshot before
redistribution.
