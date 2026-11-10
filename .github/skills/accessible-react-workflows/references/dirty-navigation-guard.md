# Dirty Navigation Guard

> Load when implementing or reviewing unsaved-change protection in the chain editor.

The editor tracks `clean`, `dirty`, `invalid`, `saving`, and `saved`. Save is disabled while the chain is unchanged or invalid. The current implementation registers `beforeunload` whenever the draft is dirty; it does not intercept in-app route changes.

## Current pattern

```tsx
const UNSAVED_MESSAGE = 'This chain has unsaved changes.';

useEffect(() => {
  if (!isDirty) return;
  const warn = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = UNSAVED_MESSAGE;
  };
  window.addEventListener('beforeunload', warn);
  return () => window.removeEventListener('beforeunload', warn);
}, [isDirty]);
```

- Do not prompt when the draft is clean.
- Remove the listener after save; the hook depends on `isDirty`, so a successful save clears it.
- Do not use `window.confirm` or a native `alert()` for in-app decisions. If in-app navigation guards are added, use the router's `setNavigationGuard` and an accessible dialog that names the chain and the consequence.
- Keep the dirty indicator in sync with the actual document state (`Unsaved changes`, `Saved`, or `No changes`).

## Router guard, when used

`src/web/router.tsx` exposes `setNavigationGuard`. A guard returns `false` to cancel navigation and is responsible for explaining why. Clear it after save and after a confirmed discard; never leave it installed on a clean draft.

## Checks

- Dirty editor: tab close and reload prompt once.
- Clean editor: no prompt.
- Save: prompt clears and the indicator changes to `Saved`.
- Invalid draft: Save stays disabled and the field-level message is exposed through `aria-describedby`.
