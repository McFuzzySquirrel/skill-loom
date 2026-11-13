# Quick Start

Create a chain from the skills already installed for your host, copy the
required packages into a project, and run the ordered steps in your current
agent session.

## 1. Provision global skills

Use your existing installation method to put intended skills in
`~/.agents/skills/`, or set `LOOM_SKILLS_DIR` to the host directory. Skill Loom
indexes this directory; it does not fetch remote repositories or update skill
packages.

## 2. Start Skill Loom

From a checkout:

```sh
npm install
npm run build
npm start
```

Or install the CLI using the [administrator guide](admin-guide.md#installation)
and start the owner service:

```sh
skill-loom service start
skill-loom service status
```

## 3. Register a project and create a chain

Register the target project with `skill-loom project open`, then use
`skill-loom edit` to create or edit a chain. Saved chains are in one shared
library. Existing project-local chain files are copied into it on first
access; their original files are retained.

The `loom-chain-workflow` companion skill can help search the global catalog,
propose a chain, collect its inputs, and carry out the run.

## 4. Apply and run

Select the chain and project, then copy its referenced global skills into that
project:

```sh
printf '%s\n' '{"projectId":"...","chainId":"..."}' | skill-loom chain project apply
```

The command never overwrites an existing package. Resolve a missing skill,
ambiguous name, or destination conflict before continuing. Refresh the host's
skill discovery if needed, then ask the agent to use `loom-chain-workflow` in
the current session. Skill Loom does not launch a second harness or persist a
run record. The host decides whether to load a named skill.

## Podman deployment

Set `LOOM_SKILLS_DIR` and `LOOM_PROJECT_DIR` to host paths, then run
`npm run podman:plan` and `npm run podman:up`. The config and shared chain
library persist in the `skill-loom-config` Podman volume. The default
proxy binds to `127.0.0.1:4317`. For private hosted use, run
`npm run podman:up -- --private-network` and provide an authenticated private
platform/VPN ingress; never expose the app directly to an untrusted network.
Use `skill-loom-podman` for CLI operations against the running container. The
selected host project is mounted as `/workspace`; register it with
`skill-loom-podman project open` and `{"path":"/workspace"}` on stdin.
See the [administrator guide](admin-guide.md#with-podman) for PowerShell,
Podman Machine, and architecture details.
