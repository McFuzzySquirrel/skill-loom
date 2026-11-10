# Skill Loom visual tour

Skill Loom is driven by its CLI and companion skills. Its one visual surface is the chain editor, for changing step order, instructions, and inputs. The screenshot uses a demo chain with no personal data, credentials, or real harness output.

## Open the editor

```sh
skill-loom edit --draft <draft-id>
skill-loom edit --project <project-id> --chain <chain-id>
```

The command starts (or reuses) the local service and prints the editor URL.

![Chain editor showing the workflow flow, step list, and inputs](assets/tour/01-chain-editor.png)

- **Workflow** shows the chain as numbered steps connected by arrows. Drag a step onto another to move it, or select a step to edit it. Each node says "Instruction" or "Skill" in text.
- **Steps** lists the same order with **Move up**, **Move down**, and **Remove** buttons, the keyboard path for reordering. Selecting a step opens a dialog for its instruction and label.
- **Inputs** declares `{{name}}` values that are collected before a run. Renaming or removing one lists every affected step first.
- **Save chain** (top right) writes your changes back to the chain. A status tag shows "Unsaved changes" or "No changes". Saving is blocked while a step has no instruction or a placeholder has no declared input.

Run the saved chain with the CLI or the `loom-run-bundle` skill; see the [user guide](user-guide.md).
