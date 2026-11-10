# PTY Transport

> Load when implementing spawn, input, resize, subscriber ownership, tail buffering, or cleanup.

## Session shape

```ts
interface TerminalSession {
  readonly id: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(listener: (chunk: string) => void): () => void;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): () => void;
  kill(): void;
}
```

`node-pty` is server-only. The browser never spawns a process and never receives a command string.

## Spawn rules

- Executable plus `string[]`; no shell, no `shell: true`, no interpolation.
- Canonical `cwd` resolved from the registered project path.
- Explicit `cols`/`rows`; resize messages update the PTY.
- Minimal environment; do not inject credentials.
- One PTY per active step.

## Subscriber rules

- At most one control-channel subscriber per PTY.
- A second subscriber receives a typed conflict and does not receive output.
- On reconnect, either reattach the original subscriber or create a new session; never attach two.
- Terminal output is forwarded as bytes; `skill-loom run attach` renders it in the invoking terminal.

## Tail rules

```ts
function trimTail(text: string, maxLines = 200, maxBytes = 32 * 1024): string {
  const lines = text.split("\n");
  let out = lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
  if (Buffer.byteLength(out, "utf8") > maxBytes) {
    out = out.slice(-maxBytes);
    while (Buffer.byteLength(out, "utf8") > maxBytes) out = out.slice(1);
  }
  return out;
}
```

Cap at append time. The persisted step record contains only this tail, never a transcript.

## Cleanup matrix

| Event | Action |
|-------|--------|
| Socket close | Kill child if the runner no longer needs it; dispose listeners |
| Stream error | Kill child, record failure, close socket |
| Step completion | Stop the step process; keep the tail |
| Run completion | Kill any residual child, close subscriptions |
| Abort | Kill child, mark aborted, keep completed steps |
| `SIGINT` / `SIGTERM` | Kill all children, close the server, clear timers |

Guard cleanup with an `exited` flag and tolerate a missing process.

## Tests

- Spawn a short Node process and observe stdout, resize, and input.
- Connect a real control-channel client through the registered endpoint.
- Assert a second subscriber is rejected.
- Assert close, abort, and signal each terminate the child.
