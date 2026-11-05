# Atomic Write Helper

> Load when implementing or reviewing the temp-file-plus-rename write path.

## Helper

```ts
import { open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export async function atomicWriteJson(target: string, value: unknown): Promise<void> {
  const dir = dirname(target);
  const tmp = join(dir, `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  const body = `${JSON.stringify(value, null, 2)}\n`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    handle = await open(tmp, "w", 0o600);
    await handle.writeFile(body, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(tmp, target);
    await syncDirectory(dir);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

async function syncDirectory(dir: string): Promise<void> {
  // Directory fsync is unsupported on some platforms; ignore EINVAL/EISDIR.
  const handle = await open(dir, "r");
  try {
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EINVAL" && code !== "EISDIR" && code !== "EPERM") throw error;
  } finally {
    await handle.close();
  }
}
```

## Required behavior

1. Temp file lives in the same directory as the target so `rename` stays atomic.
2. File mode is `0o600`; file contents are UTF-8 JSON with a trailing newline.
3. File is fsynced before rename; the directory is fsynced after.
4. Any failure removes the temp file and leaves the previous target untouched.
5. `EXDEV` is a typed failure, not a fallback copy.
6. Writes to the same target are serialized in-process.

## Serialization

```ts
const queues = new Map<string, Promise<void>>();

export function enqueueWrite<T>(target: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(target) ?? Promise.resolve();
  const next = previous.then(task, task);
  queues.set(target, next.then(() => {}, () => {}));
  return next;
}
```

## Tests that prove the contract

- Write a valid document, read it back, and assert byte-identical JSON plus no `.tmp` residue.
- Inject a failure between write and rename; assert the old target is unchanged and the temp file is gone.
- Point the temp directory at a different filesystem and assert `EXDEV` is surfaced, not hidden.
- Run two concurrent updates and assert both fields survive or the second observes the first.
- Assert a corrupt target is not overwritten by a read path.
