// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { renderClozeFront } from "../src/views/reviewer/question-cloze";

/**
 * `setCssProps` writes generated rules to a shared <style> element and schedules
 * the flush on the next animation frame. Await one frame so assertions read the
 * applied (computed) width rather than the unflushed inline style.
 */
async function flushScheduledCss(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

describe("renderClozeFront cloze widths", () => {
  it("sizes typed cloze inputs from answer length even when hints are single letters", async () => {
    const rendered = renderClozeFront(
      "Short {{c1::renal::R}} and long {{c2::hyperalimentation::H}}.",
      false,
      null,
      { mode: "typed", typedAnswers: new Map() },
    );

    document.body.appendChild(rendered);
    await flushScheduledCss();
    const inputs = Array.from(rendered.querySelectorAll<HTMLInputElement>(".learnkit-cloze-typed-input"));

    expect(inputs).toHaveLength(2);
    expect(getComputedStyle(inputs[0]).width).not.toBe(getComputedStyle(inputs[1]).width);
  });

  it("keeps hinted standard clozes width-scaled to the answer", async () => {
    const rendered = renderClozeFront(
      "Short {{c1::renal::R}} and long {{c2::hyperalimentation::H}}.",
      false,
      null,
    );

    document.body.appendChild(rendered);
    await flushScheduledCss();
    const hints = Array.from(rendered.querySelectorAll<HTMLElement>(".learnkit-cloze-hint"));

    expect(hints).toHaveLength(2);
    expect(getComputedStyle(hints[0]).width).not.toBe(getComputedStyle(hints[1]).width);
  });

  it("treats caret notation as equivalent to superscript digits in typed mode", () => {
    const rendered = renderClozeFront(
      "Power {{c1::x²}}",
      false,
      null,
      { mode: "typed", typedAnswers: new Map([["1#1", "x^"]]) },
    );

    const input = rendered.querySelector<HTMLInputElement>(".learnkit-cloze-typed-input");
    expect(input).not.toBeNull();
    expect(input?.classList.contains("learnkit-cloze-typed--partial")).toBe(true);

    const revealed = renderClozeFront(
      "Power {{c1::x²}}",
      true,
      1,
      { mode: "typed", typedAnswers: new Map([["1#1", "x^2"]]) },
    );
    expect(revealed.querySelector(".learnkit-cloze-typed-wrong")).toBeNull();
    expect(revealed.querySelector(".learnkit-cloze-typed-correct")).not.toBeNull();
  });

  it("treats plain digits as equivalent to subscript digits in typed mode", () => {
    const revealed = renderClozeFront(
      "Chem {{c1::CO₂}}",
      true,
      1,
      { mode: "typed", typedAnswers: new Map([["1#1", "CO2"]]) },
    );

    expect(revealed.querySelector(".learnkit-cloze-typed-wrong")).toBeNull();
    expect(revealed.querySelector(".learnkit-cloze-typed-correct")).not.toBeNull();
  });

  it("sizes hint width from the wider of answer and hint text", async () => {
    const rendered = renderClozeFront(
      "Alice checked {{c1::foo::lorem ipsum dolor sit amet}}.",
      false,
      null,
    );

    document.body.appendChild(rendered);
    await flushScheduledCss();
    const hints = Array.from(rendered.querySelectorAll<HTMLElement>(".learnkit-cloze-hint"));

    expect(hints).toHaveLength(1);
    // The hint "lorem ipsum dolor sit amet" is much longer than "foo",
    // so the width should be larger than what "foo" alone would produce.
    // "foo" alone gives ~30px (capped at minimum); the hint should be wider.
    const widthPx = parseFloat(getComputedStyle(hints[0]).width);
    expect(widthPx).toBeGreaterThan(60); // substantially above the minimum
  });
});