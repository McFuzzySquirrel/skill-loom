# Quick Start

Go from an idea to a completed skill workflow. You need Node.js 24 or newer and an agent host that can use project Agent Skills.

## 1. Add the Loom skills to your project

Make sure these companion skills are available in your target project's `.agents/skills/` directory: `scenario-discovery`, `loom-chain-workflow`, and `loom-run-bundle`. From a Skill Loom checkout, run `npm run build:portable-skill`, then copy the three matching directories from `dist/skills/` into `.agents/skills/`. Do not merge over existing skill packages; refresh your agent host so it discovers them. See the [standalone skill guide](standalone-skill-guide.md#install-the-skills) for details.

## 2. Start Skill Loom

The Loom workflow skills can help set up the CLI and start the service; approve those actions when prompted. Or install the CLI using the [administrator guide](admin-guide.md#installation) and start it yourself:

```sh
skill-loom service start
skill-loom service status
```

Keep the service running while you register and refresh catalogs, discover skills, and import a chain.

## 3. Add internal and external skill catalogs

Register each internal or external Git repository as a source, then refresh it to fetch and pin a revision. Replace the example URLs and refs with your repositories:

```sh
printf '%s\n' '{"repository":"https://git.internal.example/team/skills.git","ref":"main"}' | skill-loom catalog source add
printf '%s\n' '{"repository":"https://github.com/ORG/skills.git","ref":"main"}' | skill-loom catalog source add
skill-loom catalog source list
skill-loom catalog source refresh --source <source-id>
```

Refresh each source ID you want to use. Private repositories use your existing Git HTTPS or SSH authentication; never put credentials in a repository URL. Adding a source does not fetch it, and refreshing or browsing a catalog does not execute its files. You can also ask `loom-chain-workflow` to add or refresh sources; it will request approval first.

## 4. Ask your agent to build a workflow

In your target project, start a session in your agent host and ask:

> Use `loom-chain-workflow` to build a workflow for **[your goal]** in this project. Consider its project skills and the reviewed skills in my internal and external catalogs. Skip optional workspace testing.

The agent will propose a workflow, inspect selected skill packages, and prepare a reviewable `.loom.json` bundle. Approve catalog access and project registration when requested. If no skill fits, ask for an instruction-only workflow instead.

## 5. Review, edit, and import

Read the complete chain, inputs, and selected skill contents before approving them. For a project-local discovery bundle, ask the agent to revise the workflow and rebuild the `.loom.json` bundle; this flow does not create a CLI draft. For a draft created through the CLI, open it in the editor with `skill-loom edit --draft <draft-id>`, save your changes, then export the updated bundle.

Review the bundle and its destination when prompted. Approve import only after checking the review details; importing saves the chain and installs any new skills in the project, but does not run it.

## 6. Run the chain

Ask the agent to continue with `loom-run-bundle` on the reviewed bundle. Provide the requested inputs, confirm each step, and check its results before marking it complete. The run happens in your current agent session; Skill Loom guarantees step order, but the host decides whether to load a named skill.

## 7. Finish

When you are done, stop the service:

```sh
skill-loom service stop
```

For recovery, managed-harness runs, or more control over chain editing and sharing, see the [user guide](user-guide.md). For setup and troubleshooting, see the [administrator guide](admin-guide.md).
