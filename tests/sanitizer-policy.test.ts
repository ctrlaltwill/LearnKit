// @vitest-environment jsdom

/**
 * Sanitiser policy tests.
 *
 * `createFragmentFromHTML` is the single door through which every HTML string
 * LearnKit renders passes. Two allowances were added for content Obsidian
 * produces — MathJax `mjx-*` elements and `app:` / `obsidian:` resource URIs —
 * and this suite exists to prove that those allowances did not weaken the
 * sanitiser anywhere else.
 *
 * Anything that changes here must be a deliberate security decision.
 */

import { describe, expect, it } from "vitest";
import { createFragmentFromHTML, replaceChildrenWithHTML } from "../src/platform/core/ui";

/** Render an HTML string the same way the plugin does, and read the result back. */
function render(html: string): HTMLElement {
  const host = document.createElement("div");
  replaceChildrenWithHTML(host, html);
  return host;
}

describe("sanitiser policy — what must survive", () => {
  it("keeps a MathJax CHTML tree, attributes and all", () => {
    const host = render(
      '<div class="math math-block is-loaded">'
      + '<mjx-container class="MathJax" jax="CHTML" display="true">'
      + '<mjx-math class="MJX-TEX" style="padding-left:0.1em">'
      + '<mjx-mfrac><mjx-frac><mjx-num><mjx-c class="mjx-c1D434"></mjx-c></mjx-num></mjx-frac></mjx-mfrac>'
      + "</mjx-math></mjx-container></div>",
    );

    const container = host.querySelector("mjx-container");
    expect(container).not.toBeNull();
    // `jax`/`display` drive MathJax's own CSS; losing them changes typesetting.
    expect(container?.getAttribute("jax")).toBe("CHTML");
    expect(container?.getAttribute("display")).toBe("true");
    expect(host.querySelector("mjx-c")).not.toBeNull();
    expect(host.querySelector("mjx-math")?.getAttribute("style")).toContain("padding-left");
  });

  it("keeps vault resource URLs in img src", () => {
    const host = render('<p><img src="app://0123456789abcdef/_attachments/image.png" alt="Image"></p>');
    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      "app://0123456789abcdef/_attachments/image.png",
    );
  });

  it("keeps obsidian:// links", () => {
    const host = render('<p><img src="obsidian://open?vault=v&file=n"></p>');
    expect(host.querySelector("img")?.getAttribute("src")).toContain("obsidian://open");
  });

  it("still keeps the ordinary content it always kept", () => {
    const host = render(
      '<p><a class="internal-link" data-href="Note" href="Note">Note</a>'
      + "<strong>bold</strong><code>x</code></p>"
      + '<pre><code class="language-js">const a = 1;</code></pre>'
      + '<span class="learnkit-cloze-blank" style="--learnkit-cloze-width:48px"></span>',
    );

    expect(host.querySelector("a.internal-link")?.getAttribute("data-href")).toBe("Note");
    expect(host.querySelector("pre > code.language-js")?.textContent).toBe("const a = 1;");
    expect(host.querySelector(".learnkit-cloze-blank")?.getAttribute("style")).toContain("--learnkit-cloze-width");
  });
});

describe("sanitiser policy — what must still be blocked", () => {
  it("drops javascript: URLs and event handlers from images", () => {
    const host = render('<p><img src="javascript:alert(1)" onerror="alert(2)" onload="alert(3)"></p>');
    const img = host.querySelector("img");
    expect(img?.getAttribute("src")).toBeNull();
    expect(img?.getAttribute("onerror")).toBeNull();
    expect(img?.getAttribute("onload")).toBeNull();
  });

  it("drops script elements nested inside an allowed mjx element", () => {
    const host = render("<mjx-container><script>alert(1)</script></mjx-container>");
    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelector("mjx-container")).not.toBeNull();
  });

  it("drops event handlers and unknown attributes on mjx elements", () => {
    const host = render('<mjx-container onerror="alert(1)" onclick="alert(2)" foo="bar" jax="CHTML"></mjx-container>');
    const container = host.querySelector("mjx-container");
    expect(container?.getAttribute("onerror")).toBeNull();
    expect(container?.getAttribute("onclick")).toBeNull();
    expect(container?.getAttribute("foo")).toBeNull();
    expect(container?.getAttribute("jax")).toBe("CHTML");
  });

  it("still strips custom elements that are not MathJax", () => {
    const host = render('<evil-widget onclick="alert(1)"><b>hi</b></evil-widget>');
    expect(host.querySelector("evil-widget")).toBeNull();
    // Content is preserved, as DOMPurify does by default.
    expect(host.textContent).toBe("hi");
  });

  it("drops iframes, object and embed", () => {
    const host = render(
      '<iframe src="https://evil.example"></iframe><object data="x"></object><embed src="y">',
    );
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelector("object")).toBeNull();
    expect(host.querySelector("embed")).toBeNull();
  });

  it("does not let markup smuggle a second attribute onto an allowed one", () => {
    const host = render('<img src="app://x" alt="&#34; onerror=&#34;alert(1)">');
    const img = host.querySelector("img");
    expect(img?.getAttribute("onerror")).toBeNull();
  });
});
