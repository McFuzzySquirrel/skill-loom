# Host Catalog Operations

This guide covers the host-owned skill catalog mounted into Skill Loom. The
operator provisions and updates it; Loom does not fetch a repository, run a
timer, or write to the catalog. Client connections must not be used to maintain
the host copy. Shell examples target the first approved live platform, native
Linux; validate any adaptations for another Podman host separately.

## Catalog layout and source

`LOOM_SKILLS_DIR` is the host path mounted at `/var/lib/loom/skills` in the
container. If it is unset, the Podman launcher uses `~/.agents/skills`. The
recommended layout is one package directory per entry, with `SKILL.md` at that
directory's root:

```text
$LOOM_SKILLS_DIR/
  code-review/
    SKILL.md
    scripts/
  release-notes/
    SKILL.md
    references/
```

Keep the source repository checkout outside the catalog root. Choose its path,
branch, credentials, and sync procedure according to the host's policy. Loom
does not prescribe or perform that sync. Do not copy a repository checkout,
temporary staging directory, or unrelated files into the catalog root.

Set an absolute catalog path and inspect the planned mount before starting the
pod:

```bash
export LOOM_SKILLS_DIR="$HOME/.agents/skills"
export LOOM_PROJECT_DIR="/absolute/path/to/host-project"
npm run podman:plan
```

The plan must show the catalog mounted at `/var/lib/loom/skills` with `ro` and
the app bound to loopback. `npm run podman:up` creates the host directory if it
does not exist. The packages are not copied into the image; editing the mounted
files does not require rebuilding the application image.

## Add, update, and remove packages

Use the source revision approved by the operator. Before copying, check that the
package directory exists and contains a readable `SKILL.md`. Keep package files
regular and symlink-free; review the package as prompt content, not executable
code. The catalog scan reads metadata and never runs package scripts.

For a new package, stage it beside the catalog root (not inside it), then move
it into place only if the destination does not exist:

```bash
set -euo pipefail
package="code-review"
source_package="/path/to/skills-repo/$package"
mkdir -p -- "$LOOM_SKILLS_DIR"
stage="$(mktemp -d "${LOOM_SKILLS_DIR}.stage.XXXXXX")"
test -f "$source_package/SKILL.md"
if find "$source_package" -type l -print -quit | grep -q .; then
  echo "Symlinks are not supported in catalog packages." >&2
  exit 1
fi
cp -a -- "$source_package" "$stage/$package"
if test -e "$LOOM_SKILLS_DIR/$package" || test -L "$LOOM_SKILLS_DIR/$package"; then
  echo "Destination already exists; choose an explicit update instead. Review and remove staging directory: $stage" >&2
  exit 1
fi
mv -- "$stage/$package" "$LOOM_SKILLS_DIR/$package"
rmdir -- "$stage"
```

For an update, first take a backup, stage a complete replacement beside the
catalog root, and retain the old package for rollback. Coordinate the swap so
users do not query while the directory is being replaced; discovery can observe
filesystem changes during the operation.

```bash
set -euo pipefail
package="code-review"
source_package="/path/to/skills-repo/$package"
mkdir -p -- "$LOOM_SKILLS_DIR"
stage="$(mktemp -d "${LOOM_SKILLS_DIR}.update.XXXXXX")"
test -d "$LOOM_SKILLS_DIR/$package"
test -f "$source_package/SKILL.md"
if find "$source_package" -type l -print -quit | grep -q .; then
  echo "Symlinks are not supported in catalog packages." >&2
  exit 1
fi
tar -C "$LOOM_SKILLS_DIR" -cpf "$stage/previous-package.tar" "$package"
cp -a -- "$source_package" "$stage/new-package"
mv -- "$LOOM_SKILLS_DIR/$package" "$stage/previous-package"
if ! mv -- "$stage/new-package" "$LOOM_SKILLS_DIR/$package"; then
  mv -- "$stage/previous-package" "$LOOM_SKILLS_DIR/$package"
  echo "Replacement failed; the previous package was restored." >&2
  exit 1
fi
echo "Keep $stage until the new package is verified; it contains the rollback copy."
```

The retained `previous-package` directory is outside the catalog root, so it
will not appear in discovery. After verifying the new package, keep or remove
the staging directory under the host's retention policy. If the replacement
fails verification, move it aside and restore the retained directory:

```bash
set -euo pipefail
package="code-review"
stage="/path/printed/by/the/update-step"
mv -- "$LOOM_SKILLS_DIR/$package" "$stage/rejected-package"
mv -- "$stage/previous-package" "$LOOM_SKILLS_DIR/$package"
```

To remove an entry, move its directory to a retained sibling first; verify it
is absent from a new catalog query, then delete the moved copy only after the
rollback window:

```bash
set -euo pipefail
package="code-review"
removed="$(mktemp -d "${LOOM_SKILLS_DIR}.removed.XXXXXX")"
mv -- "$LOOM_SKILLS_DIR/$package" "$removed/$package"
```

Do not delete or replace client-side `.agents/skills/` copies as part of host
catalog maintenance.

## Verify discovery and refresh behavior

The catalog service discovers the configured root on a new catalog request. A
fresh `catalog project page` request sees added or removed package directories;
the capability index also reconciles changed `SKILL.md` metadata. Start a new
query instead of reusing an old `snapshotId`. A change to another package file
may not change its discovery metadata, so review/export recalculates the full
package fingerprint before using its contents.

For a Podman deployment, query the registered host project through the bridge:

```bash
printf '%s' '{"projectId":"<host-project-id>","harness":"opencode","query":"code-review","sources":["personal"],"offset":0,"limit":100,"warningsOffset":0}' \
  | skill-loom-podman catalog project page
```

Use the exact entry ID when names are duplicated. Inspect returned `warnings`
for invalid metadata, unreadable files, or directory problems. A missing result
after a fresh query usually means the package was not synced into the mounted
root, lacks a root-level `SKILL.md`, has unreadable paths, or has invalid
frontmatter that prevented normal metadata parsing. A duplicate display name
is not collapsed; select an exact ID, and do not use a name-only chain reference
when it is ambiguous.

## Mount, permissions, backup, and restore

The launcher uses `--userns=keep-id:uid=1000,gid=1000`, runs the app as
`1000:1000`, and mounts the catalog read-only. The host identity must be able to
read package files and traverse every parent directory. Do not solve access
problems with world-writable permissions. Confirm the effective mount on the
target host with `podman inspect skill-loom-app`; the `/var/lib/loom/skills`
mount should report `RW: false`. Confirm the container can list package names
without printing package contents:

```bash
podman exec skill-loom-app node -e \
  'const fs=require("node:fs"); const root=process.env.LOOM_SKILLS_DIR; console.log(fs.readdirSync(root));'
```

The launcher does not add an SELinux relabel option. On an enforcing host, check
the host's SELinux policy and labels if Podman can start but the app cannot read
the bind mount. Do not add a shared/private relabel flag or change labels
without checking the host's other consumers and security policy. UID/GID and
SELinux behavior must be verified on the actual Podman host; plan output and
unit tests do not establish that runtime access works.

Back up the catalog separately from the Podman config volume. For example,
create an archive outside the catalog root before an update:

```bash
tar -C "$(dirname "$LOOM_SKILLS_DIR")" -cpf /path/to/skills-backup.tar \
  "$(basename "$LOOM_SKILLS_DIR")"
```

Restore into a temporary directory first, inspect it, and move only the
required package directories back when their destinations are absent. Do not
extract an old archive over newer packages without an explicit decision. For
example, unpack the catalog archive beside the live root and restore only a
missing package:

```bash
set -euo pipefail
restore="$(mktemp -d "${LOOM_SKILLS_DIR}.restore.XXXXXX")"
tar -C "$restore" -xpf /path/to/skills-backup.tar
backup_root="$restore/$(basename "$LOOM_SKILLS_DIR")"
package="code-review"
test -f "$backup_root/$package/SKILL.md"
test ! -e "$LOOM_SKILLS_DIR/$package" && test ! -L "$LOOM_SKILLS_DIR/$package"
mv -- "$backup_root/$package" "$LOOM_SKILLS_DIR/$package"
```

The shared chain library lives in the separate `skill-loom-config` volume; back
it up with the [admin guide's Podman volume procedure](admin-guide.md#with-podman).

| Symptom | Check and recovery |
| --- | --- |
| A new package is missing | Confirm the synced source revision, root-level `SKILL.md`, mount path, a fresh query, and its warnings. |
| An update is not reflected | Start a new query without `snapshotId`; verify `SKILL.md` metadata and use review/export to re-fingerprint package files. |
| Permission denied | Check host ownership, parent-directory traversal, container UID mapping, and ACLs. Avoid broad permission changes. |
| Podman mount is unreadable on SELinux | Inspect the actual host labels and policy; do not guess a relabel option. Record the platform-specific result. |
| Duplicate skill names | Select by exact catalog ID. A name-only chain reference may be ambiguous. |
| Source sync failed | Leave the last verified catalog in place, restore the previous package from the retained copy/archive, and query again. |
| A client has an older package | It is a point-in-time copy. Host catalog changes never replace a client package; resolve updates manually. |

## Scope and verification status

This is an operator-controlled procedure. There is no Loom-managed fetcher or
scheduled sync. The Podman plan and automated tests verify the intended
read-only mount contract, but a real second-machine SSH/Podman session and
target-host UID/GID or SELinux behavior still require the approved Linux pilot.
Record that evidence in the hosted-catalog implementation plan; do not infer it
from this guide.
