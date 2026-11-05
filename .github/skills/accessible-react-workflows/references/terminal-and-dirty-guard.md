# Terminal and Dirty Guard

> Load when wiring xterm screen-reader mode, terminal focus entry and exit, or unsaved-change guards.

## xterm setup

```tsx
const term = new Terminal({
  screenReaderMode: true,
  convertEol: true,
  cursorBlink: true,
  fontFamily: "ui-monospace, monospace",
});

term.attachCustomKeyEventHandler((event) => {
  if (event.type === "keydown" && event.key === "Escape") {
    controlBarRef.current?.focus();
    return false; // do not send Escape to the harness
  }
  return true;
});
```

- Render the terminal in a region with `aria-label="Interactive harness terminal"`.
- Add a visible Focus terminal button; do not require a pointer click on the canvas.
- Escape leaves the terminal and must not be forwarded as input.
- Keep the terminal mounted and visible during a run; do not hide it behind a modal.
- Output is rendered only through xterm, never injected as HTML.

## Focus entry and exit

```tsx
<button ref={focusButtonRef} onClick={() => term.focus()}>Focus terminal</button>
<div role="region" aria-label="Interactive harness terminal" data-testid="terminal" />
<button ref={controlBarRef}>Abort</button>
```

After Escape, focus the control bar, not `<body>`. A screen-reader user must be able to find the terminal text, return to controls, and resume without losing run state.

## Dirty guard

```tsx
const dirty = draftState === "dirty" || draftState === "invalid";
const blocker = useBlocker(dirty);

useEffect(() => {
  if (!dirty) return;
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = "";
  };
  window.addEventListener("beforeunload", onBeforeUnload);
  return () => window.removeEventListener("beforeunload", onBeforeUnload);
}, [dirty]);
```

- Confirm in-app navigation and chain switching with a dialog that names the draft.
- Clear the guard after save and after a confirmed discard.
- Do not prompt when the draft is clean.
- Do not use `window.confirm` for the in-app dialog; use an accessible dialog with focus management.

## Tests

- Shell: skip link, focus-visible, local-only notice, live failure.
- Builder: Move up/down, focus retention, empty-instruction error.
- Save: dirty navigation prompt, clean navigation, tab-close guard.
- Run: Focus terminal, xterm text, Escape to controls, no duplicate announcement.
