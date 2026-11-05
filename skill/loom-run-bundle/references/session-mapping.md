# Session and host capability mapping

The bundle's `harness` records the harness used when the chain was designed. It is not proof of the current host's behavior. Record the actual host separately and require explicit compatibility review when the two differ.

| Bundle mode | Verified host capability | Portable behavior |
|---|---|---|
| `shared` | Current conversation is available | Continue serially in the current conversation |
| `fresh` | Verified isolated worker | Execute the step in that worker; record it as an approximation if context isolation is not guaranteed |
| `fresh` | No isolated worker | Block, or offer the current conversation only after explicit user acceptance |
| `fork` | Verified native fork | Use it only when the host exposes that operation to this skill |
| `fork` | Worker or handoff only | Start a new worker/session with a bounded summary and label it `handoff`, not a fork |
| Any mode | Required capability is unavailable | Stop before execution; offer only an explicit, accurately named conversion |

Agent-reported success is not equivalent to a process exit code or OpenCode's OSC working-to-idle signal. The standalone helper does not spawn harnesses, verify skill firing, or guarantee that a host worker completed the instruction. A handoff is a bounded summary, not a copy of the previous conversation.
