---
name: accessible-react-workflows
description: "Slan web accessibility procedure for skip links, focus-visible styling, aria-live announcements, keyboard reordering, non-color status text, dirty-navigation guards, and xterm screen-reader focus entry and exit."
---

# Skill: Accessible React Workflows

Use when building or reviewing any Slan screen that authors a chain, runs preflight, starts a run, or renders a terminal. The acceptance bar is a keyboard-only journey with visible focus, announced status changes, and no status conveyed by color alone.

Load `references/keyboard-and-focus.md` when implementing landmarks, skip links, focus-visible styling, keyboard reordering, dialogs, or focus return.
Load `references/announcements-and-status.md` when implementing live regions, step and run status, form errors, or preflight result announcements.
Load `references/terminal-and-dirty-guard.md` when wiring xterm screen-reader mode, terminal focus entry and exit, or unsaved-change guards.

---

## Process

### Step 1: Establish the shell landmarks

Every route mounts through `src/web/App.tsx` with one `<header>`, one `<main id="main">`, and a status region. The skip link is the first focusable element and points at `#main`:

```tsx
<a className="skip-link" href="#main">Skip to main content</a>
<header>…</header>
<main id="main" tabIndex={-1}>{children}</main>
<div role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
```

If a screen adds a second `<main>` or a duplicate live region, then remove it; landmarks must be unique. The local-only notice stays visible on every route.

**Output:** one landmark set and one polite status region per screen.

### Step 2: Give every control a name and visible focus

Use native buttons, links, inputs, and selects. If an icon-only control is unavoidable, then add both an accessible name and a visible tooltip. Never use a clickable `<div>`.

```css
:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
```

If a reset removes the outline, then replace it with a `:focus-visible` treatment of at least the same contrast. Do not rely on hover or color change to indicate focus.

**Output:** every interactive element reachable by Tab with a visible, named focus target.

### Step 3: Make reordering and editing keyboard-complete

The step list exposes Move up and Move down buttons on every row. Drag-and-drop is an enhancement, never the only path. Keep focus on the moved row after the reorder so the user can continue:

```tsx
<button onClick={() => move(index, index - 1)} disabled={index === 0} aria-label={`Move ${label} up`}>
  Move up
</button>
```

If a row becomes invalid, then keep focus in the field and expose the error through `aria-describedby`; do not move focus to the error banner. Reordering must preserve unsaved instruction text.

**Output:** add, edit, remove, and reorder all work without a pointer.

### Step 4: Convey status with text plus icon

Render run and step states as a icon plus text pair, not a colored dot:

```tsx
<span className={`status status-${status}`}>
  <StatusIcon status={status} aria-hidden="true" />
  {statusLabel[status]}
</span>
```

The vocabulary is `pending`, `running`, `done`, `failed`, `skipped`, `interrupted`. Color may reinforce the label but must never be the only difference. Source badges and harness badges follow the same rule.

**Output:** every status is readable in grayscale and in the accessibility tree.

### Step 5: Announce transitions without flooding

Use one polite region for preflight progress, step transitions, and recoverable errors. Use `role="alert"` or `aria-live="assertive"` only for a run failure or a blocked start. Update the text with a stable sentence, not the whole DOM:

```tsx
announce(`Step 2 of 4 is awaiting your confirmation.`);
```

If two updates fire in one tick, then coalesce them so the screen reader does not read an intermediate state. Do not announce the same message repeatedly on every render; change the string or use a monotonically increasing key.

Load `references/announcements-and-status.md` for the full message table and the duplicate-announcement test.

**Output:** status changes are announced once, in order, without noise.

### Step 6: Guard unsaved work without trapping the user

Track `clean`, `dirty`, `invalid`, `saving`, and `saved`. When dirty, intercept in-app navigation and chain switching with a confirmation that names the consequence, and register `beforeunload` for tab close. Do not block a confirmed navigation or leave the route guard installed after save.

If validation fails, then keep the user on the form, mark the field invalid, and keep Start or Save disabled with a field-level message. Do not use a native `alert()` for an in-app decision.

**Output:** a dirty draft cannot be lost silently and a clean draft can leave immediately.

### Step 7: Make the terminal enterable and leavable

Enable `screenReaderMode: true` on the xterm instance, label the terminal region, and provide a Focus terminal button. Escape returns focus to the control bar:

```tsx
const term = new Terminal({ screenReaderMode: true, convertEol: true });
term.attachCustomKeyEventHandler((event) => {
  if (event.key === "Escape") { controlsRef.current?.focus(); return false; }
  return true;
});
```

The terminal is the only intentional focus trap and only while focus is inside it. Do not hide it behind a modal during a run. Load `references/terminal-and-dirty-guard.md` for the tested pattern.

**Output:** a keyboard user can enter, read, and leave the terminal.

### Step 8: Verify with the keyboard and the accessibility tree

Run the focused browser suites, then walk the journey with Tab and Shift+Tab:

```bash
npx playwright test tests/e2e/shell.spec.ts tests/e2e/chain-builder.spec.ts tests/e2e/chain-save.spec.ts tests/e2e/run.spec.ts
```

If a keyboard step fails, then fix the control or focus order before adding an automated shortcut. A passing test does not replace the human acceptance review.

---

## Gotchas

- **`outline: none` with no replacement.** Removing the default outline makes focus invisible. Always add a `:focus-visible` outline with contrast against the dark theme.
- **Color-only status.** A green dot for done and a red dot for failed hides state from a grayscale or screen-reader user. Render an icon plus the word, and keep the word in the accessible name.
- **Duplicate live announcements.** Announcing on every render, or using both `role="status"` and `aria-live` on nested nodes, makes a screen reader repeat the same state. Keep one region and change the message.
- **Reordering loses focus.** Re-rendering a list after Move up can drop focus to `<body>`. Restore focus to the moved row by stable step id, not by index.
- **Drag-only reordering.** Native drag events are not keyboard-operable. The Move up and Move down buttons are the required path.
- **Dirty guard that traps.** A route blocker that stays active after save, or a `beforeunload` that fires on a clean form, trains the user to ignore it. Clear the guard on save and after a confirmed discard.
- **xterm without screen-reader mode.** The canvas is not readable by default. Set `screenReaderMode: true`, label the region, and provide a documented exit.
- **Escape that also sends input.** If Escape leaves the terminal, the harness must not receive it as a keystroke. Handle it in the xterm custom key handler and return `false`.

---

## Validation

After completing the process, verify:

- [ ] The skip link is the first focusable element and moves focus to the single `<main>` landmark.
- [ ] Every interactive control has an accessible name and a visible `:focus-visible` outline.
- [ ] Move up and Move down reorder steps with the keyboard and keep focus on the moved row.
- [ ] Every run and step status is text or icon plus text; grayscale still distinguishes all states.
- [ ] Preflight results, step transitions, and run failures are announced once through the documented live region.
- [ ] A dirty draft prompts on navigation, tab close, and chain switch; a clean draft leaves without a prompt.
- [ ] xterm screen-reader mode is enabled, the terminal region is labeled, Focus terminal works, and Escape returns focus to the controls.
- [ ] `npx playwright test tests/e2e/shell.spec.ts tests/e2e/chain-builder.spec.ts tests/e2e/chain-save.spec.ts tests/e2e/run.spec.ts` passes.
- [ ] Run the self-check `rg -n "outline:\\s*none|dangerouslySetInnerHTML|role=\"button\"|onClick=.*<div" src/web` and confirm any hit has a deliberate accessible replacement.

If the terminal cannot be left with Escape, check the custom key handler and the focus target. If a screen-reader announcement repeats, remove the second live region before changing the message text.
