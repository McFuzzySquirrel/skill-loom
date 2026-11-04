# Keyboard and Focus

> Load when implementing landmarks, skip links, focus-visible styling, keyboard reordering, dialogs, or focus return.

## Shell

```tsx
<a className="skip-link" href="#main">Skip to main content</a>
<header>
  <span>Slan</span>
  <span className="local-only">Local only</span>
</header>
<main id="main" tabIndex={-1}>{children}</main>
```

- One `<main>` per page.
- The skip link is first in DOM order and becomes visible on focus.
- The local-only badge is text, not a color chip.
- The status region lives outside the route content so navigation does not remove it.

## Focus-visible

```css
:focus-visible {
  outline: 2px solid #8bd5ff;
  outline-offset: 2px;
  border-radius: 2px;
}
```

- Never use `outline: none` without a replacement.
- Focus style must be visible on buttons, links, inputs, rows, and the terminal focus button.
- Do not use `tabIndex={0}` on a non-interactive `<div>` as a substitute for a button.

## Keyboard reordering

```tsx
function StepRow({ step, index, total, onMove, ref }: StepRowProps) {
  return (
    <li ref={ref} aria-posinset={index + 1} aria-setsize={total}>
      <span>{step.label || step.skill}</span>
      <button onClick={() => onMove(index, index - 1)} disabled={index === 0}>
        Move up
      </button>
      <button onClick={() => onMove(index, index + 1)} disabled={index === total - 1}>
        Move down
      </button>
      <button onClick={() => onRemove(step.id)}>Remove</button>
    </li>
  );
}
```

After a move, focus the same step id in its new position. Drag handles may exist, but they are not the keyboard path.

## Dialogs

- Open with focus on the first meaningful control or the dialog heading.
- Trap focus only inside the dialog, close on Escape, and return focus to the trigger.
- The terminal is the only other intentional focus trap.

## Form errors

- Mark the field with `aria-invalid="true"`.
- Link the message with `aria-describedby`.
- Keep focus in the field; do not move it to a summary.
- The required marker is text plus `required`/`aria-required`, not color alone.
