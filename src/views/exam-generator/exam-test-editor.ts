import { Modal, type App } from "obsidian";
import type { GeneratedExamQuestion } from "./exam-generator-types";

export type ExamTestDraft = { label: string; questions: GeneratedExamQuestion[] };
type Translate = (key: string, fallback: string) => string;

/** Validate the whole draft before changing stored data. */
export function validateExamTestDraft(draft: ExamTestDraft, tx: Translate): string | null {
  if (!draft.label.trim()) return tx("ui.view.examGenerator.editor.nameRequired", "Enter a test name.");
  if (!draft.questions.length) return tx("ui.view.examGenerator.editor.questionsRequired", "Add at least one question.");
  const ids = new Set<string>();
  for (const q of draft.questions) {
    if (!q.id || ids.has(q.id) || !q.prompt.trim()) return tx("ui.view.examGenerator.editor.promptRequired", "Every question needs a unique ID and a prompt.");
    ids.add(q.id);
    if (q.type === "mcq") {
      const options = q.options ?? [];
      const correct = q.correctIndices?.length ? q.correctIndices : [q.correctIndex];
      if (options.length < 2 || options.some(o => !o.trim()) || !correct.length || correct.some(i => !Number.isInteger(i) || Number(i) < 0 || Number(i) >= options.length)) {
        return tx("ui.view.examGenerator.editor.optionsRequired", "Every multiple-choice question needs at least two options and a correct answer.");
      }
    } else if (q.type !== "saq" || !q.markingGuide?.some(point => point.trim())) {
      return tx("ui.view.examGenerator.editor.guideRequired", "Every short-answer question needs a marking guide.");
    }
  }
  return null;
}

export class ExamTestEditorModal extends Modal {
  private draft: ExamTestDraft;
  private saving = false;

  constructor(app: App, draft: ExamTestDraft, private tx: Translate, private save: (draft: ExamTestDraft) => Promise<void>) {
    super(app);
    this.draft = JSON.parse(JSON.stringify(draft)) as ExamTestDraft;
  }

  onOpen(): void {
    this.modalEl.addClass("learnkit");
    this.render();
  }

  onClose(): void { this.contentEl.empty(); }

  private field(host: HTMLElement, label: string, value: string, change: (value: string) => void, multiline = false): void {
    const wrapper = host.createEl("label", { cls: "learnkit-exam-editor-field" });
    wrapper.createSpan({ text: label });
    const input = multiline ? wrapper.createEl("textarea") : wrapper.createEl("input", { type: "text" });
    input.value = value;
    input.addEventListener("input", () => change(input.value));
  }

  private button(host: HTMLElement, label: string, click: () => void): HTMLButtonElement {
    const button = host.createEl("button", { text: label, attr: { type: "button" } });
    button.addEventListener("click", click);
    return button;
  }

  private render(): void {
    const host = this.contentEl;
    host.empty();
    host.createEl("h2", { text: this.tx("ui.view.examGenerator.editor.title", "Edit saved test") });
    const form = host.createEl("fieldset", { cls: "learnkit-exam-editor-form" });
    this.field(form, this.tx("ui.view.examGenerator.editor.name", "Test name"), this.draft.label, value => { this.draft.label = value; });
    for (const [index, q] of this.draft.questions.entries()) {
      const section = form.createEl("fieldset", { cls: "learnkit-exam-editor-question" });
      section.createEl("legend", { text: this.tx("ui.view.examGenerator.taking.questionLabel", "Question") + " " + (index + 1) });
      this.field(section, this.tx("ui.view.examGenerator.editor.prompt", "Prompt"), q.prompt, value => { q.prompt = value; }, true);
      const typeLabel = section.createEl("label");
      typeLabel.createSpan({ text: this.tx("ui.view.examGenerator.editor.type", "Question type") });
      const type = typeLabel.createEl("select");
      type.createEl("option", { value: "mcq", text: this.tx("ui.view.examGenerator.editor.mcq", "Multiple choice") });
      type.createEl("option", { value: "saq", text: this.tx("ui.view.examGenerator.editor.saq", "Short answer") });
      type.value = q.type;
      type.addEventListener("change", () => {
        q.type = type.value === "saq" ? "saq" : "mcq";
        if (q.type === "mcq" && !q.options) q.options = ["", ""];
        this.render();
      });
      if (q.type === "mcq") {
        section.createEl("p", { text: this.tx("ui.view.examGenerator.editor.correctHint", "Check every correct option. Check more than one for a multiple-answer question.") });
        const correct = new Set(q.correctIndices?.length ? q.correctIndices : q.correctIndex == null ? [] : [q.correctIndex]);
        const syncCorrect = () => {
          const indices = [...correct].sort((a, b) => a - b);
          q.correctIndices = indices;
          q.correctIndex = indices.length === 1 ? indices[0] : undefined;
        };
        for (const [optionIndex, option] of (q.options ?? []).entries()) {
          const row = section.createDiv({ cls: "learnkit-exam-editor-option" });
          const checkLabel = row.createEl("label");
          const check = checkLabel.createEl("input", { type: "checkbox" });
          check.checked = correct.has(optionIndex);
          checkLabel.createSpan({ text: this.tx("ui.view.examGenerator.feedback.correct", "Correct") + " " + (optionIndex + 1) });
          check.addEventListener("change", () => {
            if (check.checked) correct.add(optionIndex); else correct.delete(optionIndex);
            syncCorrect();
          });
          this.field(row, `${this.tx("ui.view.examGenerator.editor.option", "Option")} ${optionIndex + 1}`, option, value => { q.options![optionIndex] = value; });
          this.button(row, this.tx("ui.view.examGenerator.editor.removeOption", "Remove option"), () => {
            q.options!.splice(optionIndex, 1);
            const shifted = [...correct].filter(i => i !== optionIndex).map(i => i > optionIndex ? i - 1 : i);
            correct.clear(); shifted.forEach(i => correct.add(i)); syncCorrect(); this.render();
          });
        }
        this.button(section, this.tx("ui.view.examGenerator.editor.addOption", "Add option"), () => { (q.options ??= []).push(""); this.render(); });
      } else {
        this.field(section, this.tx("ui.view.examGenerator.editor.guide", "Marking guide (one point per line)"), (q.markingGuide ?? []).join("\n"), value => { q.markingGuide = value.split("\n"); }, true);
      }
      this.field(section, this.tx("ui.view.examGenerator.editor.explanation", "Explanation"), q.explanation ?? "", value => { q.explanation = value; }, true);
      this.field(section, this.tx("ui.view.examGenerator.editor.source", "Source note path"), q.sourcePath, value => { q.sourcePath = value; });
      this.button(section, this.tx("ui.view.examGenerator.editor.removeQuestion", "Remove question"), () => { this.draft.questions.splice(index, 1); this.render(); });
    }
    this.button(form, this.tx("ui.view.examGenerator.editor.addQuestion", "Add question"), () => {
      this.draft.questions.push({ id: `manual-${crypto.randomUUID()}`, type: "mcq", prompt: "", sourcePath: "", options: ["", ""] });
      this.render();
    });
    const error = host.createDiv({ attr: { role: "alert" } });
    const actions = host.createDiv({ cls: "learnkit-exam-generator-actions" });
    const saveButton = this.button(actions, this.tx("ui.view.examGenerator.editor.save", "Save changes"), () => { void (async () => {
      if (this.saving) return;
      const problem = validateExamTestDraft(this.draft, this.tx);
      if (problem) { error.textContent = problem; return; }
      this.saving = true; form.disabled = true; saveButton.disabled = true;
      try {
        await this.save({ ...this.draft, label: this.draft.label.trim() });
        this.close();
      } catch {
        error.textContent = this.tx("ui.view.examGenerator.editor.saveFailed", "Could not save changes. Your draft is still open; try again.");
      } finally {
        this.saving = false; form.disabled = false; saveButton.disabled = false;
      }
    })(); });
    this.button(actions, this.tx("ui.view.examGenerator.editor.cancel", "Cancel"), () => { if (!this.saving) this.close(); });
  }
}
