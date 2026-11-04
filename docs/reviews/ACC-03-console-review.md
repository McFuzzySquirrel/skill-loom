# Human Review: Review keyboard access, announcements, and contrast

Reviewer: squirrel
Reviewed at: 2026-11-04T16:02:18.020Z
Decision: Approved

## Review notes

I confirm: Perform this review in order against the running application: 1. Without using a pointer, open the project screen, browse to a project, create a chain, add three steps, edit instructions, reorder using Move up and Move down, declare an input, and save. 2. Run preflight, acknowledge a warning, and start a run using only the keyboard; complete a supervised step and use Next, Retry, Skip, and Abort where valid. 3. Tab through every screen and confirm the focus indicator is always visible, the order is logical, the skip link works, and focus is never trapped except inside the terminal until Escape is pressed. 4. Confirm every control has an accessible name, every status is text or icon plus text, and step transitions and preflight results appear in an aria-live region. 5. Enable xterm screen-reader mode, enter and leave the terminal with the documented controls, and confirm the terminal region is labeled. 6. Check text and control contrast against WCAG 2.1 AA using browser devtools or an accessibility checker; record each failure with the screen and element. 7. Record the scenarios exercised, browser and assistive technology used, contrast results, and every deviation in docs/reviews/v1-accessibility.json. Approve only if the keyboard-only journey and all acceptance criteria pass.
