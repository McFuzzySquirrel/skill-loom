# Fake Harness

> Load when writing or debugging the fake OpenCode/Copilot executable and its signal modes.

## Script

```js
#!/usr/bin/env node
const mode = process.env.SLAN_FAKE_MODE ?? "auto";
const args = process.argv.slice(2);
const prompt = args.join(" ");

process.stdout.write(`fake-harness mode=${mode}\r\n`);
process.stdout.write(`prompt: ${prompt}\r\n`);

function hold(message) {
  process.stdout.write(`${message}\r\n`);
  setInterval(() => {}, 1 << 30);
}

if (mode === "supervised") {
  hold("waiting for user");
} else if (mode === "fail") {
  process.stderr.write("simulated failure\r\n");
  process.exit(1);
} else if (mode === "supervised-exit") {
  process.stdout.write("finished turn, awaiting confirmation\r\n");
  process.exit(0);
} else {
  process.stdout.write("\x1b]7501;state=working\x07");
  setTimeout(() => {
    process.stdout.write("\x1b]7501;state=idle\x07");
    setTimeout(() => process.exit(0), 50);
  }, 150);
}
```

Copy the same file to `fake-copilot`, or add a `copilot` mode that exits 0 after printing the prompt. Copilot advances on process exit, so no OSC is needed.

## Modes

| Mode | Use |
|------|-----|
| `auto` | OpenCode automatic: working then idle |
| `supervised` | Stay alive until Done/Next or Abort |
| `supervised-exit` | Prove process exit does not advance a supervised step |
| `fail` | Non-zero exit and pause with Retry/Skip/Abort |
| `idle-only` | Emit `idle` without `working`; must not advance |
| `token` | Echo a fixed token for live-style assertions |

## Rules

- Shebang first line; `chmod 0o755`.
- Raw escape bytes through `process.stdout.write`.
- Keep supervised mode alive; an early exit changes the test's meaning.
- Accept arbitrary arguments; the runner passes prompts, session flags, and a working directory.
- Never read credentials or the developer's config.
- Log to stdout only what the test needs; no secrets.
