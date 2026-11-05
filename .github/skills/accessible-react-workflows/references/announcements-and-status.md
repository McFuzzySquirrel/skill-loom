# Announcements and Status

> Load when implementing live regions, step and run status, form errors, or preflight result announcements.

## One polite region

```tsx
const [message, setMessage] = useState("");
const announce = (next: string) => setMessage(next);

<div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
  {message}
</div>
```

Keep the region mounted. Replacing the node itself can suppress the announcement. Change only the text.

## Assertive only for failures

Use `role="alert"` for a run failure, a blocked start, or an unrecoverable server error. Do not use it for every status change; it interrupts the user.

## Message table

| Event | Message |
|-------|---------|
| Preflight running | `Preflight is running.` |
| Preflight pass | `Preflight passed. Start is enabled.` |
| Preflight blocked | `Preflight blocked the run. Review the blocking findings.` |
| Warning acknowledged | `Warnings acknowledged. Start is enabled.` |
| Step started | `Step 2 of 4 started.` |
| Awaiting user | `Step 2 of 4 is awaiting your confirmation.` |
| Step done | `Step 2 of 4 is done.` |
| Step failed | `Step 2 of 4 failed. Retry, skip, or abort.` |
| Run paused | `The run is paused at step 2.` |
| Run completed | `The run completed.` |
| Run interrupted | `The run was interrupted. Choose retry, continue, or restart.` |

## Status vocabulary

`pending`, `running`, `done`, `failed`, `skipped`, `interrupted`.

Each renders an icon (`aria-hidden`) plus the visible word. The word is also the accessible name. Color is supplementary.

```tsx
const labels = {
  pending: "Pending",
  running: "Running",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
  interrupted: "Interrupted",
};
```

## Avoiding duplicates

- One live region per document.
- Do not nest a second live region inside the status region, and do not add `aria-live` to a child of it.
- Do not announce from both the route and a child component.
- Coalesce updates that happen in the same tick into the final state.
- Change the message text or key when the same event repeats.

## Test

Use Playwright with `page.getByRole("status")` and assert the exact message once. Then assert the previous message is gone so a hidden duplicate does not pass.
