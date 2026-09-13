// @vitest-environment jsdom
import { readFileSync } from "node:fs";
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

function runner(multi: boolean) {
  const view = Object.create(SproutExamGeneratorView.prototype) as any;
  Object.assign(view, {
    _questions: [{ id: "q", type: "mcq", prompt: "Choose", options: ["A", "B", "C"], ...(multi ? { correctIndices: [0, 2] } : { correctIndex: 0 }) }],
    _answers: new Map(), _currentIndex: 0, _autoSubmitGrace: null,
    _tx: (_key: string, fallback: string) => fallback,
  });
  const render = () => {
    const host = document.createElement("div");
    view._renderExamRunner(host);
    return [...host.querySelectorAll<HTMLButtonElement>(".learnkit-exam-generator-option-button")];
  };
  return { view, render };
}

describe("exam answer selection", () => {
  it("toggles independent answers and restores their state when revisiting", () => {
    const { view, render } = runner(true);
    let buttons = render();
    buttons[0].click(); buttons[2].click(); buttons[0].click();
    expect(view._answers.get("q")).toEqual([2]);
    buttons = render();
    expect(buttons.map(b => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);
    expect(buttons[2].classList.contains("learnkit-mcq-selected")).toBe(true);
    expect(buttons[0].classList.contains("learnkit-mcq-selected")).toBe(false);
  });
  it("keeps single-answer selection exclusive", () => {
    const { view, render } = runner(false);
    const buttons = render();
    buttons[0].click(); buttons[1].click();
    expect(view._answers.get("q")).toBe(1);
    expect(buttons.map(b => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
  });
});

it("applies a visible selection marker with the test runner styles loaded", () => {
  const style = document.createElement("style");
  style.textContent = readFileSync("src/platform/styles/exam-generator.css", "utf8");
  document.head.appendChild(style);
  const { render } = runner(true);
  const buttons = render();
  const root = document.createElement("div");
  root.className = "learnkit";
  root.appendChild(buttons[0].closest(".learnkit-exam-generator-runner-card")!);
  document.body.appendChild(root);
  buttons[0].click();
  expect(getComputedStyle(buttons[0]).boxShadow).toContain("inset 4px");
  expect(getComputedStyle(buttons[1]).boxShadow).not.toContain("inset 4px");
  root.remove(); style.remove();
});
