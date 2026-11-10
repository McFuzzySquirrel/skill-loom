# Chain Library UI Implementation Roadmap

> **Historical.** This plan targets the removed `/chains` library screen and the removed `test:e2e` suite. See the [archive index](README.md) and the [user guide](../user-guide.md) for current behavior.

## Purpose and scope

This plan follows the UI review completed on November 7, 2026. The review covered
the `/chains` Chain library and its project-selection, import, and removal flow.
It did not cover every application route, and this document describes proposed
work only; no application source changes were made as part of the review.

The review returned a **Block** verdict because two high-severity findings remain:

- The removal action loses its danger styling because later button rules override
  `.button--danger`.
- Unexpected import and removal errors do not provide recovery guidance. Existing
  transport-error messages are separately actionable and should remain distinct.

Other findings were medium severity: import navigation does not move focus to
the destination screen; some counts use English suffix-based plural assembly; and
hover styles are not restricted to hover-capable pointers. A low-severity finding
is that user-provided project and chain names lack bidirectional text isolation.
The layout review found no actionable source-level issue.

## Phases

### 1. Restore danger styling on removal actions

- **Finding:** High — removal controls lose their semantic danger treatment due
  to CSS cascade order.
- **Recommended changes:** Make button variant precedence explicit, for example
  by placing the danger modifier after base and secondary button rules. Preserve
  theme-specific colors and all button interaction states.
- **Dependencies:** None.
- **Risks:** A specificity or ordering change could unintentionally affect focus,
  disabled, hover, or theme states.
- **Completion criteria:** Removal controls retain danger styling in both themes
  and in default, hover, focus, and disabled states; foreground/background
  contrast remains adequate.
- **Verification:** Add or update a focused regression check for removal
  controls, and inspect rendered states in both themes.

### 2. Make unexpected import and removal errors recoverable

- **Finding:** High — unexpected fallback errors lack recovery guidance, while
  transport failures have separate actionable messages.
- **Recommended changes:** Provide action-specific fallback copy and a safe,
  accurate next step for import and removal errors. Keep transport-error
  handling distinguishable. Do not promise that an operation had no effect or
  advise a blind retry when its outcome may be uncertain.
- **Dependencies:** None.
- **Risks:** Incorrect retry guidance could lead to duplicate or repeated
  operations if an error occurs after a partial success.
- **Completion criteria:** Each unexpected error identifies what failed and a
  safe next action; existing actionable transport-error text remains intact.
- **Verification:** Add focused tests for unexpected and transport failures in
  both flows, including any uncertain-outcome behavior.

### 3. Move focus after successful SPA import navigation

- **Finding:** Medium — import navigation updates the document title but does
  not move focus to the destination screen.
- **Recommended changes:** After successful navigation, focus the destination
  screen heading or main landmark. Ensure the target can receive programmatic
  focus, and do not move focus before navigation succeeds.
- **Dependencies:** Use the existing route-transition path.
- **Risks:** Focus may be stolen unexpectedly or become inconsistent with
  browser back/forward navigation.
- **Completion criteria:** Keyboard users arrive at the new screen's content;
  title and focus updates remain coherent during browser history navigation.
- **Verification:** Add a browser test for successful import navigation and
  inspect keyboard focus, including back/forward behavior.

### 4. Improve count wording and isolate dynamic names

- **Findings:** Medium — English `step(s)` and `template(s)` suffix assembly;
  Low — user-provided project and chain names lack `<bdi>` isolation.
- **Recommended changes:** Use count-aware singular/plural wording in visible
  text and load announcements. Wrap dynamic names in `<bdi>` wherever they are
  rendered in the reviewed flow. Keep this scoped to the existing English UI;
  the review did not identify a localization framework.
- **Dependencies:** None.
- **Risks:** Visible text and announcements could diverge, or one rendering path
  could omit bidi isolation.
- **Completion criteria:** Zero, one, and multiple items read naturally in both
  visible text and announcements; mixed-direction names do not reorder
  surrounding text.
- **Verification:** Test representative counts and render LTR and RTL names
  within surrounding English text.

### 5. Restrict hover treatment to hover-capable pointers

- **Finding:** Medium — global link and button hover styles can appear latched
  on touch devices.
- **Recommended changes:** Gate hover-only styling behind a hover-capable
  pointer media query. Preserve visible keyboard focus and active-state feedback.
- **Dependencies:** None.
- **Risks:** Hybrid devices may have both touch and hover inputs; avoid removing
  useful feedback for mouse or keyboard users.
- **Completion criteria:** Mouse hover continues to work, keyboard focus remains
  clearly visible, and touch interaction does not leave hover styling active.
- **Verification:** Inspect mouse, keyboard, and touch-emulated browser states.

## Validation and known gaps

The targeted shell E2E command `npm run test:e2e -- tests/e2e/shell.spec.ts`
passed 25 tests. The declared opaque CSS-token contrast pairs passed source-level
checks. These results do not verify rendered color states or the findings above.

After phases 1–3, rerun the targeted `/chains` E2E coverage. Then run the focused
checks for phases 4–5 and verify the previously untested 320px/200% zoom,
RTL/localized growth, assistive-technology, and rendered touch/hover behavior.
