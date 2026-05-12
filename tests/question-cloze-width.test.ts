// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { renderClozeFront } from "../src/views/reviewer/question-cloze";

describe("renderClozeFront cloze widths", () => {
  it("sizes typed cloze inputs from answer length even when hints are single letters", async () => {
    const rendered = renderClozeFront(
      "Short {{c1::renal::R}} and long {{c2::hyperalimentation::H}}.",
      false,
      null,
      { mode: "typed", typedAnswers: new Map() },
    );

    document.body.appendChild(rendered);
    const inputs = Array.from(rendered.querySelectorAll<HTMLInputElement>(".learnkit-cloze-typed-input"));

    expect(inputs).toHaveLength(2);
    expect(inputs[0].style.width).not.toBe(inputs[1].style.width);
  });

  it("keeps hinted standard clozes width-scaled to the answer", async () => {
    const rendered = renderClozeFront(
      "Short {{c1::renal::R}} and long {{c2::hyperalimentation::H}}.",
      false,
      null,
    );

    document.body.appendChild(rendered);
    const hints = Array.from(rendered.querySelectorAll<HTMLElement>(".learnkit-cloze-hint"));

    expect(hints).toHaveLength(2);
    expect(hints[0].style.width).not.toBe(hints[1].style.width);
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
});