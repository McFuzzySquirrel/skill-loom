---
name: accessible-react-workflows
description: "Skill Loom chain editor accessibility procedure for skip links, focus-visible styling, aria-live announcements, keyboard reordering, non-color status text, dirty-navigation guards, and component-test verification."
---

# Skill: Accessible React Workflows

Use when building or reviewing the Skill Loom chain editor (`src/web/**`). The acceptance bar is a keyboard-only journey through editing, reordering, saving, and navigation guards, with visible focus, announced status changes, and no status conveyed by color alone.

The editor is the only web screen. It does not render terminals, runs, catalogs, or project browsers; those are CLI- and harness-driven. Do not add terminal or multi-screen accessibility guidance to this skill.

Load `references/keyboard-and-focus.md` when implementing landmarks, skip links, focus-visible styling, keyboard reordering, dialogs, or focus return.
Load `references/announcements-and-status.md` when implementing live regions, save status, validation errors, or conflict messages.
Load `references/dirty-navigation-guard.md` when implementing unsaved-change guards for in-app navigation, history navigation, and tab close.

---

## Process

### Step 1: Establish the shell landmarks

Every route mounts through `src/web/App.tsx` with one `<main id="main-content">` and one status region. The skip link is the first focusable element and points at the main landmark:

```tsx
<a className="skip-link" href="#main-content">Skip to main content</a>
<main id="main-content" tabIndex={-1}>{children}</main>
<div role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
```

If a screen adds a second `<main>` or a duplicate live region, remove it; landmarks must be unique.

**Output:** one landmark set and one polite status region per route.

### Step 2: Give every control a name and visible focus

Use native buttons, links, inputs, and selects. If an icon-only control is unavoidable, add both an accessible name and a visible tooltip. Never use a clickable `<div>`.

```css
:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
```

If a reset removes the outline, replace it with a `:focus-visible` treatment of at least the same contrast. Do not rely on hover or color change to indicate focus.

**Output:** every interactive element reachable by Tab with a visible, named focus target.

### Step 3: Make reordering and editing keyboard-complete

The step list exposes Move up and Move down buttons on every row. Drag-and-drop is an enhancement, never the only path. Keep focus on the moved row after the reorder so the user can continue:

```tsx
<button onClick={() => move(index, index - 1)} disabled={index === 0} aria-label={`Move ${label} up`}>
  Move up
</button>
```

If a row becomes invalid, keep focus in the field and expose the error through `aria-describedby`; do not move focus to the error banner. Reordering must preserve unsaved instruction text.

**Output:** add, edit, remove, and reorder all work without a pointer.

### Step 4: Convey save status with text plus icon

Render editor status as an icon plus text pair, not a colored dot:

```tsx
<span className={`status status-${status}`}>
  <StatusIcon status={status} aria-hidden="true" />
  {statusLabel[status]}
</span>
```

The vocabulary is `clean`, `dirty`, `invalid`, `saving`, `saved`, `conflict`, and `failed`. Color may reinforce the label but must never be the only difference.

**Output:** every status is readable in grayscale and in the accessibility tree.

### Step 5: Announce transitions without flooding

Use one polite region for load, save, and recoverable errors. Use `role="alert"` or `aria-live="assertive"` only for a blocked save or an unrecoverable failure. Update the text with a stable sentence, not the whole DOM:

```tsx
announce(`Saved step 2 of 4.`);
```

If two updates fire in one tick, coalesce them so the screen reader does not read an intermediate state. Do not announce the same message repeatedly on every render; change the string or use a monotonically increasing key.

Load `references/announcements-and-status.md` for the full message table and the duplicate-announcement check.

**Output:** status changes are announced once, in order, without noise.

### Step 6: Guard unsaved work without trapping the user

Track `clean`, `dirty`, `invalid`, `saving`, and `saved`. When dirty, intercept in-app navigation and chain switching with a confirmation that names the consequence, and register `beforeunload` for tab close. Do not block a confirmed navigation or leave the route guard installed after save.

If validation fails, keep the user on the form, mark the field invalid, and keep Save disabled with a field-level message. Do not use a native `alert()` for an in-app decision.

Load `references/dirty-navigation-guard.md` for the router integration and the tested guard behavior.

**Output:** a dirty draft cannot be lost silently and a clean draft can leave immediately.

### Step 7: Verify with the keyboard and the accessibility tree

Run the component and documentation checks, then walk the editor with Tab and Shift+Tab:

```bash
npm run test:unit
npm run check
```

If a keyboard step fails, fix the control or focus order before adding an automated shortcut. A passing test does not replace the human acceptance review. The editor targets desktop browsers; there is no terminal focus mode to verify.

---

## Gotchas

- **`outline: none` with no replacement.** Removing the default outline makes focus invisible. Always add a `:focus-visible` outline with contrast against both themes.
- **Color-only status.** A green dot for saved and a red dot for failed hides state from a grayscale or screen-reader user. Render an icon plus the word, and keep the word in the accessible name.
- **Duplicate live announcements.** Announcing on every render, or using both `role="status"` and `aria-live` on nested nodes, makes a screen reader repeat the same state. Keep one region and change the message.
- **Reordering loses focus.** Re-rendering a list after Move up can drop focus to `<body>`. Restore focus to the moved row by stable step id, not by index.
- **Drag-only reordering.** Native drag events are not keyboard-operable. The Move up and Move down buttons are the required path.
- **Dirty guard that traps.** A route blocker that stays active after save, or a `beforeunload` that fires on a clean form, trains the user to ignore it. Clear the guard on save and after a confirmed discard.
- **Adding CLI concerns to the editor.** Do not add terminal, run, catalog, or project screens to satisfy an accessibility checklist; those surfaces are CLI-driven.

---

## Validation

After completing the process, verify:

- [ ] The skip link is the first focusable element and moves focus to the single `<main>` landmark.
- [ ] Every interactive control has an accessible name and a visible `:focus-visible` outline.
- [ ] Move up and Move down reorder steps with the keyboard and keep focus on the moved row.
- [ ] Every editor status is icon plus text; grayscale still distinguishes all states.
- [ ] Load, save, conflict, and validation messages are announced once through the documented live region.
- [ ] A dirty draft prompts on in-app navigation, history navigation, and tab close; a clean draft leaves without a prompt.
- [ ] `npm run test:unit` and `npm run check` pass.
- [ ] Run the self-check `rg -n "outline:\\s*none|dangerouslySetInnerHTML|role=\"button\"|onClick=.*<div" src/web` and confirm any hit has a deliberate accessible replacement.

If a screen-reader announcement repeats, remove the second live region before changing the message text.
