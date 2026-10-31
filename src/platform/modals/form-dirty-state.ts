/**
 * @file src/platform/modals/form-dirty-state.ts
 * @summary Tracks whether a modal form has been edited, so its primary action can
 *   stay visually neutral until there is something to save.
 *
 *   Used by the flashcard edit modal (#224). Kept apart from the modal itself so
 *   the comparison can be unit-tested without constructing an Obsidian modal.
 *
 * @exports
 *   - snapshotFormState — stable string describing every form control's value
 *   - isFormDirty — whether the form differs from a previous snapshot
 */

type FormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function isToggle(input: HTMLInputElement): boolean {
  return input.type === "checkbox" || input.type === "radio";
}

/**
 * Describes every `input`, `textarea` and `select` under `root`.
 *
 * Covers the whole form on purpose: MCQ option rows, ordering steps, checkboxes
 * and hidden inputs (the group picker) all count as edits, not just the fields
 * the caller happens to hold references to. Control order is part of the
 * snapshot, so adding or removing a row also registers as a change.
 */
export function snapshotFormState(root: ParentNode): string {
  const controls = Array.from(root.querySelectorAll<FormControl>("input, textarea, select"));

  return controls
    .map((control, index) => {
      const toggled = control instanceof HTMLInputElement && isToggle(control)
        ? String(control.checked)
        : "";
      return `${index}:${String(control.value ?? "").trim()}\u0000${toggled}`;
    })
    .join("\u0001");
}

/** True when the form no longer matches `baseline`. */
export function isFormDirty(root: ParentNode, baseline: string): boolean {
  return snapshotFormState(root) !== baseline;
}
