// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
vi.mock("../src/platform/core/ui", () => ({
  renderMarkdownPreviewInElement: (el: HTMLElement, text: string) => { el.textContent = text; },
  setCssProps: vi.fn(),
}));
vi.mock("../src/platform/core/header", () => ({ createViewHeader: vi.fn() }));
import { SproutExamGeneratorView } from "../src/views/exam-generator/exam-generator-view";

// Obsidian's DOM helpers, with real elements and browser click events.
Object.assign(HTMLElement.prototype, {
  createEl(tag: string, opts: any = {}) {
    const el = document.createElement(tag);
    el.className = opts.cls ?? "";
    el.textContent = opts.text ?? "";
    for (const [key, value] of Object.entries(opts.attr ?? {})) el.setAttribute(key, String(value));
    this.appendChild(el);
    return el;
  },
  createDiv(opts: any) { return this.createEl("div", opts); },
  createSpan(opts: any) { return this.createEl("span", opts); },
  appendText(text: string) { this.appendChild(document.createTextNode(text)); },
});

it("shows answer details immediately after submission", () => {
  const view = Object.create(SproutExamGeneratorView.prototype) as any;
  Object.assign(view, {
    _finalPercent: 50, _questions: [{ id: "q" }],
    _questionResults: [{ questionId: "q", questionType: "mcq", prompt: "Select primes", scorePercent: 50, userAnswer: "2; 4", expectedAnswer: "2; 5", explanation: "Prime numbers have two divisors.", choices: [{ text: "4", selected: true, correct: false }, { text: "5", selected: false, correct: true }] }],
    _tx: (_key: string, fallback: string) => fallback,
  });
  const host = document.createElement("div");
  view._renderResults(host);
  expect(host.textContent).toContain("Your answer: 2; 4");
  expect(host.textContent).toContain("Correct option: 2; 5");
  expect(host.textContent).toContain("Selected — incorrect");
  expect(host.textContent).toContain("Not selected — correct answer");
  expect(host.textContent).toContain("Prime numbers have two divisors.");
});
