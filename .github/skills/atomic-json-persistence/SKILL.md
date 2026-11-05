---
name: atomic-json-persistence
description: "Versioned JSON persistence procedure for Skill Loom config, chain, and run files using Zod validation, same-directory temporary-file rename, corrupt-file quarantine, and traversal-safe identifiers."
---

# Skill: Atomic JSON Persistence

Use when reading, writing, migrating, or repairing Skill Loom configuration, chains, or run records. Apply it before adding any persisted field so schema, path containment, and crash behavior stay consistent across `src/server/config/`, `src/server/chains/`, and `src/server/runs/`.

Load `references/paths-and-schemas.md` when you need the exact directory layout, file naming, identifier rules, or schema shape.
Load `references/atomic-write.md` when implementing or reviewing the write helper.
Load `references/corruption-recovery.md` when a read fails, startup finds stale active records, or a schema migration is required.

---

## Process

### Step 1: Resolve the storage root

Resolve each store from its documented root before touching a file:

| Store | Root | Environment override |
|-------|------|----------------------|
| Global config | `~/.config/loom/config.json` | `LOOM_CONFIG_DIR` |
| Active-run pointer | `<configRoot>/active-run.json` | `LOOM_CONFIG_DIR` |
| Chains | `<project>/.loom/chains/<chainId>.json` | none |
| Runs | `<project>/.loom/runs/<runId>.json` | none |

Call `realpath` on the project directory first, then join `.loom/chains` or `.loom/runs`. If the resolved target does not start with the canonical root plus `path.sep`, then throw a typed containment error before opening the file. Read the root from the injected config path in unit tests; never hard-code `os.homedir()` inside the store.

**Output:** a canonical absolute root plus a typed error for any escape, symlink, or unreadable directory.

### Step 2: Define a versioned schema

Declare the current version as a Zod literal and validate the whole document, not only the fields you plan to use:

```ts
const ChainSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  name: z.string().trim().min(1),
  harness: z.enum(["opencode", "copilot"]),
  sessionMode: z.enum(["shared", "fresh", "fork"]),
  steps: z.array(StepSchema).min(1),
  inputs: z.array(InputSchema),
  automaticPermissionOptIn: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
```

If you add a field, then give it a default in the schema or a migration from the previous version; never make an existing file unreadable. If the parsed `version` is unknown, then return `UNSUPPORTED_VERSION` with the path and version in `details`. Keep credential-like keys out of the schema entirely so the "never persist tokens" rule is structural, not a review note.

**Output:** one exported schema per document type plus a parsed TypeScript type.

### Step 3: Read without self-healing

Read the file, parse JSON, then parse with the schema. Distinguish these outcomes:

- Missing file: return documented defaults for config only; for chains and runs return `NOT_FOUND`.
- Corrupt JSON or failed schema: return a typed `CORRUPT_*` result and leave the bytes untouched.
- Unknown version: return `UNSUPPORTED_VERSION` and leave the bytes untouched.

Never overwrite a corrupt config with defaults. A loader that "repairs" by replacing the file silently deletes the user's real harness paths and recent projects. On list endpoints, exclude the corrupt item and attach a warning such as `{ code: "CORRUPT_CHAIN", path, message }`; valid siblings must still be returned. Load `references/corruption-recovery.md` when you need the warning shape or a repair procedure.

**Output:** a discriminated result (`ok`, `notFound`, or typed failure) and a warning list for list operations.

### Step 4: Write atomically

Write through a temporary file in the same directory as the target, then rename over the target:

```ts
const tmp = join(dir, `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
await fsyncFile(tmp);
await rename(tmp, target);
await fsyncDir(dir);
```

If the write or rename fails, then remove the temporary file in a `finally` block and leave the previous target intact. If `rename` fails with `EXDEV`, then fail with a typed error instead of falling back to a non-atomic copy. Serialize concurrent writes to the same target with an in-process queue; two uncoordinated read-modify-write cycles lose one update. Load `references/atomic-write.md` for the full helper, directory-fsync fallback, and the tests that simulate a mid-write failure.

**Output:** `undefined` on success or a typed `WRITE_FAILED` that names the target without dumping file contents.

### Step 5: Reject unsafe identifiers

Validate identifiers before constructing a path:

```ts
if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) throw traversalError(id);
const target = join(chainRoot, `${id}.json`);
if (dirname(target) !== chainRoot) throw traversalError(id);
```

Reject `..`, `/`, `\`, NUL, absolute paths, and URL-encoded separators. Do not rely on `realpath` alone for a target that does not exist yet; compare `dirname(join(root, id + ".json"))` to the canonical root after resolving the root itself. Project ids are derived from the registered canonical path on the server, never accepted as a client-supplied path.

**Output:** a rejected request before any filesystem read or write, with the offending id in `details`.

### Step 6: Reconcile startup state

On server startup, list run documents and mark any record still in `starting`, `running`, `paused`, or `awaiting-user` as `interrupted`. Update the record with the normal atomic write, then clear `<configRoot>/active-run.json` only when it points at that run. Never auto-resume or auto-replay a step.

If a config read fails, then do not clear the pointer; report the config error and leave recovery to the user. If a corrupt run file is present, then report it as a warning during recovery instead of aborting the whole scan.

**Output:** durable `interrupted` status and a cleared stale pointer, or a reported blocker.

### Step 7: Verify the contract

Run the focused suites and inspect the failure behavior, not only the happy path:

```bash
npx vitest run tests/unit/config.test.ts tests/unit/chain-store.test.ts tests/unit/run-store.test.ts
```

Then perform the self-check checklist below before reporting the storage work complete.

---

## Gotchas

- **Cross-device rename.** `rename` fails with `EXDEV` when the temp file lives in `/tmp` and the target is under the project. The temp file must be created next to the target; a copy fallback is not atomic.
- **Self-healing corrupt config.** Replacing an unreadable config with defaults destroys real harness paths and recent projects. Return a typed error and keep the original bytes.
- **Lexical traversal check.** A path containing `..` can still resolve inside the root, and a symlink inside the root can point outside it. Resolve the canonical root with `realpath`, then compare the resolved parent; validate ids before the filesystem call.
- **Zod 4 error paths.** Zod 4 issue shapes differ from Zod 3. Assert the actual `issue.path` values used in 422 responses instead of assuming a `path` array of strings.
- **Directory durability.** Renaming the temp file without fsyncing its directory leaves a window where a crash loses the rename on some filesystems. Fsync the file before rename and the directory after.
- **Run tail size.** A run document is not a transcript. Cap the per-step tail at 200 lines or 32 KiB when constructing the record, not when rendering it.
- **Stale active pointer.** A pointer that outlives its run blocks every future start with a false 409. Clear it only after the referenced run is durably marked `interrupted`.

---

## Validation

After completing the process, verify:

- [ ] A missing config file yields documented defaults; a corrupt config yields a typed error and its bytes are unchanged (`cmp` or a hash assertion).
- [ ] A simulated failure between temp write and rename leaves the previous target intact and no `.tmp` file behind.
- [ ] A chain or run id containing `../`, `/`, or `\` is rejected before any filesystem call.
- [ ] Startup marks every stale `starting`, `running`, `paused`, and `awaiting-user` record `interrupted` and clears only the matching pointer.
- [ ] Each persisted document validates against a schema with a literal `version`; no schema contains a credential, token, or secret field.
- [ ] `npx vitest run tests/unit/config.test.ts tests/unit/chain-store.test.ts tests/unit/run-store.test.ts` passes.
- [ ] Run the self-check `rg -n "dangerouslySetInnerHTML|token|apiKey" src/server/config src/server/chains src/server/runs` and confirm no credential value is persisted.

If the write tests fail with `EXDEV`, the temp file is not in the target directory. If they fail with an empty target, the rename happened before the file handle was flushed; fix the helper rather than weakening the assertion.
