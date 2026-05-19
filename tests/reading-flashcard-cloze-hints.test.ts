import { describe, expect, it } from "vitest";
import { buildReadingFlashcardCloze } from "../src/views/reading/reading-flashcard-cloze.ts";
import { buildClozeSectionHTML } from "../src/views/reading/reading-helpers.ts";

describe("reading view flashcard cloze hints", () => {
  it("shows hint text on the hidden side and omits hint syntax on reveal", () => {
    const input = "Mnemonic: {{c1::Psoriatic arthritis::**P**}}.";

    const front = buildReadingFlashcardCloze(input, "front");
    const back = buildReadingFlashcardCloze(input, "back");

    expect(front).toBe('Mnemonic: <span class="learnkit-cloze-hint" style="width:132px">P</span>.');
    expect(back).toBe('Mnemonic: <span class="learnkit-reading-view-cloze"><span class="learnkit-cloze-text">Psoriatic arthritis</span></span>.');
    expect(back).not.toContain("::");
  });

  it("reveals nested cloze answers without leaving raw nested syntax", () => {
    const input = "Nested {{c3::cloze {{c1::test}}}}";

    const back = buildReadingFlashcardCloze(input, "back");

    expect(back).toContain("Nested");
    expect((back.match(/learnkit-reading-view-cloze/g) ?? []).length).toBe(2);
    expect(back).toContain("cloze <span class=\"learnkit-reading-view-cloze\"><span class=\"learnkit-cloze-text\">test</span></span>");
    expect(back).not.toContain("{{c1::test}}");
  });

  it("preserves nested reading-view cloze spans in section HTML", () => {
    const html = buildClozeSectionHTML("Nested {{c2:: cloze {{c1::test}}}} |");

    expect((html.match(/learnkit-reading-view-cloze/g) ?? []).length).toBe(2);
    expect(html).toContain("cloze <span class=\"learnkit-reading-view-cloze\"><span class=\"learnkit-cloze-text\">test</span></span>");
    expect(html).not.toContain("{{c1::test}}");
  });

  it("sizes hint width from the wider of answer and hint text", () => {
    // Short answer "foo" (3 chars → ~30px), long hint "lorem ipsum dolor sit amet" (26 chars → 188px)
    const input = "Alice checked {{c1::foo::lorem ipsum dolor sit amet}}.";

    const front = buildReadingFlashcardCloze(input, "front");

    expect(front).toContain("learnkit-cloze-hint");
    expect(front).toContain("lorem ipsum dolor sit amet");
    // Width should be based on the hint (188px), not the answer (~30px)
    expect(front).toContain("width:188px");
  });
});