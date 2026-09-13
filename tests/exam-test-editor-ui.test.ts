// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
vi.mock("../src/platform/core/ui", () => ({
  renderMarkdownPreviewInElement: (el: HTMLElement, text: string) => { el.textContent = text; },
  setCssProps: vi.fn(),
}));
vi.mock("../src/platform/core/header", () => ({ createViewHeader: vi.fn() }));
vi.mock("obsidian", async (original) => ({
  ...await original<object>(),
  Modal: class {
    modalEl = document.createElement("div");
    contentEl = this.modalEl.appendChild(document.createElement("div"));
    close() {}
  },
}));
import { ExamTestEditorModal, type ExamTestDraft } from "../src/views/exam-generator/exam-test-editor";

// Obsidian's DOM helpers, with real elements and browser click events.
Object.assign(HTMLElement.prototype, {
  empty() { this.replaceChildren(); },
  addClass(cls: string) { this.classList.add(cls); },
  createEl(tag: string, opts: any = {}) {
    const el = document.createElement(tag);
    el.className = opts.cls ?? "";
    el.textContent = opts.text ?? "";
    if (opts.type) el.setAttribute("type", opts.type);
    if (opts.value) el.setAttribute("value", opts.value);
    for (const [key, value] of Object.entries(opts.attr ?? {})) el.setAttribute(key, String(value));
    this.appendChild(el);
    return el;
  },
  createDiv(opts: any) { return this.createEl("div", opts); },
  createSpan(opts: any) { return this.createEl("span", opts); },
  appendText(text: string) { this.appendChild(document.createTextNode(text)); },
});

const tx = (_key: string, fallback: string) => fallback;
const draft = (): ExamTestDraft => ({ label: "Original", questions: [{ id: "q", type: "mcq", prompt: "Choose", sourcePath: "", options: ["A", "B", "C"], correctIndices: [0, 2] }] });
function click(host: HTMLElement, label: string) {
  [...host.querySelectorAll("button")].find(button => button.textContent === label)!.click();
}
it("edits a draft, shifts correct indices on option removal and saves", async () => {
  const original = draft();
  const save = vi.fn(async () => {});
  const modal = new ExamTestEditorModal({} as any, original, tx, save);
  modal.onOpen();
  const host = modal.contentEl;
  const name = host.querySelector<HTMLInputElement>("input[type=text]")!;
  name.value = "Renamed"; name.dispatchEvent(new Event("input"));
  click(host, "Remove option");
  expect([...host.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].map(el => el.checked)).toEqual([false, true]);
  expect(original).toEqual(draft());
  click(host, "Save changes");
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toMatchObject({ label: "Renamed", questions: [{ options: ["B", "C"], correctIndices: [1], correctIndex: 1 }] });
});
it("keeps invalid drafts open and cancellation leaves the original unchanged", () => {
  const original = draft();
  const save = vi.fn();
  const modal = new ExamTestEditorModal({} as any, original, tx, save);
  modal.onOpen();
  click(modal.contentEl, "Remove question");
  click(modal.contentEl, "Save changes");
  expect(modal.contentEl.querySelector('[role="alert"]')!.textContent).toContain("Add at least one question");
  click(modal.contentEl, "Add question");
  expect(modal.contentEl.querySelectorAll("legend")).toHaveLength(1);
  click(modal.contentEl, "Cancel");
  expect(save).not.toHaveBeenCalled();
  expect(original).toEqual(draft());
});
