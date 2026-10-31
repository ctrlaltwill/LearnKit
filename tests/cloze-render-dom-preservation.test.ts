// @vitest-environment jsdom

/**
 * Regression tests for #220 and #221.
 *
 * The cloze renderer used to serialise its own container with
 * `innerHTML` and rebuild it through `replaceChildrenWithHTML`, whose DOMPurify
 * pass drops MathJax custom elements (`mjx-*`) and strips `app://` resource URLs
 * from `img.src`. A cloze answer containing display math rendered as an empty
 * block, and a cloze front field containing an image rendered as a broken
 * placeholder.
 *
 * `restoreCodeFencesInDom` replaces only the code-fence placeholders, in place,
 * so every node the Markdown renderer produced survives untouched.
 */

import { describe, expect, it } from "vitest";
import {
  FENCE_PH,
  protectCodeFences,
  restoreCodeFencesInDom,
} from "../src/views/reading/reading-flashcard-cloze";

const FENCE_OPTS = { blankClass: "learnkit-cloze-blank", revealClass: "" };

/** Roughly what Obsidian's MarkdownRenderer leaves behind for rendered math. */
function mathBlockHtml(): string {
  return [
    '<div class="math math-block is-loaded">',
    '<mjx-container class="MathJax" jax="CHTML">',
    '<mjx-math class="MJX-TEX"><mjx-mi class="mjx-i">',
    '<mjx-c class="mjx-c1D447"></mjx-c>',
    "</mjx-mi></mjx-math>",
    "</mjx-container>",
    "</div>",
  ].join("");
}

/** Roughly what the reviewer's markdown helper leaves behind for an embed. */
function imageHtml(): string {
  return '<p><img src="app://0123456789abcdef/_attachments/image.png" alt="Image" class="learnkit-zoomable"></p>';
}

describe("restoreCodeFencesInDom", () => {
  it("leaves the tree untouched when the card has no code fence", () => {
    const container = document.createElement("div");
    container.innerHTML = `<p>Delta ratio = <span class="learnkit-cloze-revealed"><span class="math math-inline"><mjx-container>1</mjx-container></span></span></p>`;

    const before = Array.from(container.childNodes);
    const paragraph = container.firstElementChild!;
    const mathBefore = container.querySelector("mjx-container")!;

    const replaced = restoreCodeFencesInDom(container, () => "should not be called");

    expect(replaced).toBe(0);
    // Same objects, not equal copies: nothing was re-parsed (#220, #221).
    expect(Array.from(container.childNodes)).toEqual(before);
    expect(container.firstElementChild).toBe(paragraph);
    expect(container.querySelector("mjx-container")).toBe(mathBefore);
  });

  it("preserves rendered math and app:// images while restoring a fence", () => {
    const source = ["```js", "const a = 1;", "```", "", "Answer below {{c1::text}}"].join("\n");
    const { text: fenceFree, restore } = protectCodeFences(source, FENCE_OPTS);
    expect(fenceFree).toContain(FENCE_PH);

    const container = document.createElement("div");
    container.innerHTML = `${mathBlockHtml()}${imageHtml()}<p>${FENCE_PH}0@@</p>`;

    const replaced = restoreCodeFencesInDom(container, restore);

    expect(replaced).toBe(1);

    // The fence came back as real markup...
    const pre = container.querySelector("pre > code");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toBe("const a = 1;");
    expect(pre?.getAttribute("class")).toBe("language-js");

    // ...and nothing re-serialised the rest away.
    expect(container.querySelector("mjx-container")).not.toBeNull();
    expect(container.querySelector("mjx-c")).not.toBeNull();
    expect(container.querySelector(".math.math-block")?.children.length).toBe(1);

    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("app://0123456789abcdef/_attachments/image.png");

    // No placeholder text survives.
    expect(container.textContent).not.toContain(FENCE_PH);
  });

  it("unwraps the paragraph MarkdownRenderer puts around a standalone placeholder", () => {
    const source = ["```", "npm test", "```"].join("\n");
    const { restore } = protectCodeFences(source, FENCE_OPTS);

    const container = document.createElement("div");
    container.innerHTML = `<p>${FENCE_PH}0@@</p>`;

    restoreCodeFencesInDom(container, restore);

    // <pre> must not sit inside a <p> (invalid HTML; browsers reparent it).
    expect(container.querySelector("p")).toBeNull();
    expect(container.firstElementChild?.tagName).toBe("PRE");
  });

  it("keeps surrounding text when the placeholder shares a paragraph", () => {
    const source = ["```", "x", "```"].join("\n");
    const { restore } = protectCodeFences(source, FENCE_OPTS);

    const container = document.createElement("div");
    container.innerHTML = `<p>before ${FENCE_PH}0@@ after</p>`;

    restoreCodeFencesInDom(container, restore);

    expect(container.textContent).toBe("before x after");
  });

  it("ignores placeholders it cannot resolve", () => {
    const { restore } = protectCodeFences("no fences here", FENCE_OPTS);

    const container = document.createElement("div");
    container.innerHTML = `<p>${FENCE_PH}7@@</p>`;
    const paragraph = container.firstElementChild!;

    const replaced = restoreCodeFencesInDom(container, restore);

    expect(replaced).toBe(0);
    expect(container.firstElementChild).toBe(paragraph);
    expect(container.textContent).toContain(`${FENCE_PH}7@@`);
  });

  it("restores several fences in one card", () => {
    const source = [
      "```js", "one", "```",
      "",
      "middle {{c1::text}}",
      "",
      "```py", "two", "```",
    ].join("\n");
    const { restore } = protectCodeFences(source, FENCE_OPTS);

    const container = document.createElement("div");
    container.innerHTML = `<p>${FENCE_PH}0@@</p><p>middle</p><p>${FENCE_PH}1@@</p>`;

    expect(restoreCodeFencesInDom(container, restore)).toBe(2);

    const blocks = Array.from(container.querySelectorAll("pre > code"));
    expect(blocks.map((b) => b.textContent)).toEqual(["one", "two"]);
    expect(container.querySelectorAll("p").length).toBe(1);
    expect(container.textContent).toContain("middle");
  });

  it("keeps cloze blank spans, so typed-mode hydration still finds them", () => {
    const source = ["```", "code", "```", "", "Value {{c1::answer}}"].join("\n");
    const { restore } = protectCodeFences(source, FENCE_OPTS);

    const container = document.createElement("div");
    container.innerHTML = `<p>${FENCE_PH}0@@</p><p>Value <span class="learnkit-cloze-blank hidden-cloze" style="--learnkit-cloze-width:48px"></span></p>`;

    restoreCodeFencesInDom(container, restore);

    const blank = container.querySelector(".learnkit-cloze-blank.hidden-cloze");
    expect(blank).not.toBeNull();
    expect(blank?.getAttribute("style")).toContain("--learnkit-cloze-width");
  });
});
