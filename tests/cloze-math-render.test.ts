// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { renderLatexMathInElement } from "../src/platform/core/ui";

describe("renderLatexMathInElement", () => {
  it("typesets math inside a cloze reveal span", () => {
    const container = document.createElement("div");
    container.innerHTML = `<span class="learnkit-cloze-revealed">$\\frac{a}{b}$</span>`;

    renderLatexMathInElement(container);

    expect(container.querySelector("[data-math]")).not.toBeNull();
    expect(container.textContent).not.toContain("$\\frac{a}{b}$");
  });

  it("leaves already-rendered math untouched", () => {
    const container = document.createElement("div");
    container.innerHTML = `<span class="math"><mjx-container>1</mjx-container></span><span>$\\frac{a}{b}$</span>`;

    renderLatexMathInElement(container);

    expect(container.querySelectorAll(".math mjx-container").length).toBe(1);
    expect(container.querySelectorAll("[data-math]").length).toBe(1);
  });
});
