# Quick Start

Go from an idea to a completed skill workflow. You need Node.js 24 or newer, the Skill Loom CLI, and an agent host that can use Agent Skills. If you have not set these up yet, follow the [administrator installation guide](admin-guide.md#installation) for the CLI and the [standalone skill guide](standalone-skill-guide.md#install-the-skills) for the companion skills.

## 1. Start Skill Loom

In a terminal, start the local service and check that it is ready:

```sh
skill-loom service start
skill-loom service status
```

Keep the service running while you create and import a chain.

## 2. Ask your agent to build a workflow

In your target project, start a session in your agent host and ask:

> Use `loom-chain-workflow` to build a workflow for **[your goal]** in this project. Use project-local skills only and skip optional workspace testing.

The agent will propose a workflow, inspect the selected skill packages, and prepare a reviewable `.loom.json` bundle. If no skill fits, ask for an instruction-only workflow instead.

## 3. Review, edit, and import

Read the complete chain, inputs, and selected skill contents before approving them. If you want to change the order or instructions, open the draft in the editor with `skill-loom edit --draft <draft-id>`, save your changes, then have the agent export the updated bundle.

Review the bundle and its destination when prompted. Approve import only after checking the review details; importing saves the chain and installs any new skills in the project, but does not run it.

## 4. Run the chain

Ask the agent to continue with `loom-run-bundle` on the reviewed bundle. Provide the requested inputs, confirm each step, and check its results before marking it complete. The run happens in your current agent session; Skill Loom guarantees step order, but the host decides whether to load a named skill.

## 5. Finish

When you are done, stop the service:

```sh
skill-loom service stop
```

For recovery, managed-harness runs, or more control over chain editing and sharing, see the [user guide](user-guide.md). For setup and troubleshooting, see the [administrator guide](admin-guide.md).
