# Evidence Schema

> Load when writing or reviewing `docs/evidence/live-discovery.json` or `docs/evidence/live-execution.json`.

## Shared envelope

```json
{
  "version": 1,
  "generatedAt": "2026-11-04T12:00:00.000Z",
  "node": "24.22.2",
  "loomVersion": "0.1.0",
  "harnesses": {},
  "checks": [],
  "warnings": [],
  "cleanup": { "temporaryRootRemoved": true, "processesRemaining": 0 }
}
```

## Discovery evidence

```json
{
  "harnesses": {
    "opencode": {
      "version": "2.2.5",
      "entryCount": 12,
      "bySource": { "project": 3, "personal": 8, "extra": 1 },
      "probeFound": true
    },
    "copilot": {
      "version": "1.0.105",
      "entryCount": 40,
      "bySource": { "project": 1, "personal": 20, "plugin": 9, "builtin": 10 },
      "probeFound": true,
      "command": "copilot skill list --json",
      "exitCode": 0
    }
  }
}
```

## Execution evidence

```json
{
  "harnesses": {
    "opencode": {
      "version": "2.2.5",
      "sessionId": "ses_...",
      "seededPrompt": { "passed": true, "durationMs": 18400 },
      "signal": { "working": true, "idle": true, "clear": false },
      "recall": { "passed": true, "sessionId": "ses_...", "durationMs": 9200 }
    },
    "copilot": {
      "version": "1.0.105",
      "sessionId": "00000000-0000-0000-0000-000000000000",
      "copilotHomeMode": "isolated",
      "trust": { "resolved": true, "mechanism": "dialog" },
      "seededPrompt": { "passed": true, "exitCode": 0, "durationMs": 15300 },
      "observation": { "state": "observed", "skill": "loom-live-probe" },
      "recall": { "passed": true, "sessionId": "00000000-0000-0000-0000-000000000000" }
    }
  },
  "checks": [
    { "id": "opencode.token", "passed": true },
    { "id": "opencode.working-idle", "passed": true },
    { "id": "opencode.recall", "passed": true },
    { "id": "copilot.trust", "passed": true },
    { "id": "copilot.token", "passed": true },
    { "id": "copilot.recall", "passed": true }
  ]
}
```

## Rules

- No token value, credential, authorization header, or full transcript.
- Session ids are allowed; they are identifiers, not secrets.
- Bounded, redacted failure excerpts are allowed; state the limit used.
- Record the Copilot home mode and whether trust was established.
- Record cleanup even when the run fails.
- A missing harness records a blocked check, not a pass.
- OpenCode `signal.records` retains at most 64 recognized events with `state`
  and `recordId` (`null` for root). `recordsTruncated` flags omitted events.
  Inspect record IDs rather than assuming every `clear` clears root status.

## Review commands

```bash
node -e "JSON.parse(require('fs').readFileSync('docs/evidence/live-execution.json','utf8'))"
jq -e '.checks | all(.passed == true)' docs/evidence/live-execution.json
```
