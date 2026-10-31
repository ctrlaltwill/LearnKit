// @vitest-environment jsdom

/**
 * Regression tests for #224 — the flashcard edit modal's Save button.
 *
 * Two complaints: it was visually lighter than the Cancel button beside it, and
 * it gave no signal once you had actually changed something. The visual half is
 * CSS (`is-idle` + Obsidian's accent/on-accent pair); the behaviour half is the
 * dirty tracking tested here.
 */

import { describe, expect, it } from "vitest";
import { isFormDirty, snapshotFormState } from "../src/platform/modals/form-dirty-state";

function buildForm(): HTMLElement {
  const form = document.createElement("div");
  form.innerHTML = `
    <input type="text" value="Question" />
    <textarea>Answer</textarea>
    <input type="hidden" value="Cardiology" />
    <input type="checkbox" />
    <select><option value="basic">Basic</option><option value="cloze">Cloze</option></select>
  `;
  return form;
}

describe("snapshotFormState", () => {
  it("captures the value of every control in the form", () => {
    const form = buildForm();
    const snapshot = snapshotFormState(form);

    expect(snapshot).toContain("Question");
    expect(snapshot).toContain("Answer");
    expect(snapshot).toContain("Cardiology");
    expect(snapshot).toContain("basic");
  });

  it("is stable when nothing changes", () => {
    const form = buildForm();
    expect(snapshotFormState(form)).toBe(snapshotFormState(form));
  });

  it("ignores surrounding whitespace in text values", () => {
    const form = buildForm();
    const before = snapshotFormState(form);
    const input = form.querySelector<HTMLInputElement>("input[type=text]")!;
    input.value = "  Question  ";
    expect(snapshotFormState(form)).toBe(before);
  });

  it("changes when a checkbox is toggled", () => {
    const form = buildForm();
    const before = snapshotFormState(form);
    form.querySelector<HTMLInputElement>("input[type=checkbox]")!.checked = true;
    expect(snapshotFormState(form)).not.toBe(before);
  });

  it("changes when a hidden input is rewritten (the group picker)", () => {
    const form = buildForm();
    const before = snapshotFormState(form);
    form.querySelector<HTMLInputElement>("input[type=hidden]")!.value = "Cardiology, ECG";
    expect(snapshotFormState(form)).not.toBe(before);
  });

  it("changes when a select is switched", () => {
    const form = buildForm();
    const before = snapshotFormState(form);
    form.querySelector<HTMLSelectElement>("select")!.value = "cloze";
    expect(snapshotFormState(form)).not.toBe(before);
  });

  it("changes when a row is added or removed", () => {
    const form = buildForm();
    const before = snapshotFormState(form);
    const extra = document.createElement("input");
    extra.value = "another option";
    form.appendChild(extra);
    expect(snapshotFormState(form)).not.toBe(before);
  });
});

describe("isFormDirty", () => {
  it("starts clean and reports edits", () => {
    const form = buildForm();
    const baseline = snapshotFormState(form);
    expect(isFormDirty(form, baseline)).toBe(false);

    form.querySelector<HTMLTextAreaElement>("textarea")!.value = "A new answer";
    expect(isFormDirty(form, baseline)).toBe(true);
  });

  it("goes clean again when the edit is reverted", () => {
    const form = buildForm();
    const baseline = snapshotFormState(form);
    const textarea = form.querySelector<HTMLTextAreaElement>("textarea")!;

    textarea.value = "Changed";
    expect(isFormDirty(form, baseline)).toBe(true);

    textarea.value = "Answer";
    expect(isFormDirty(form, baseline)).toBe(false);
  });

  it("reports an empty field being cleared as a change", () => {
    // Clearing a field is a real edit in single-card mode, so it must enable Save.
    const form = buildForm();
    const baseline = snapshotFormState(form);
    form.querySelector<HTMLInputElement>("input[type=text]")!.value = "";
    expect(isFormDirty(form, baseline)).toBe(true);
  });
});
