import { describe, expect, it } from "vitest";
import { buildReadingFlashcardCloze } from "../src/views/reading/reading-flashcard-cloze.ts";
import { formatDelimitedField, pushDelimitedField, setDelimiter } from "../src/platform/core/delimiter.ts";

describe("code fence formatting in delimited fields", () => {
  it("emits CQ header on its own line when field starts with code fence", () => {
    setDelimiter("|");

    const input = [
      '```',
      'print("Hello {{c1::World}}")',
      '```',
    ].join("\n");

    const lines = formatDelimitedField("CQ", input);

    expect(lines).toEqual([
      "CQ |",
      "```",
      'print("Hello {{c1::World}}")',
      "``` |",
    ]);
  });

  it("emits CQ header on its own line when field starts with code fence + language", () => {
    setDelimiter("|");

    const input = [
      '```python',
      'print("Hello {{c1::World}}")',
      '```',
    ].join("\n");

    const lines = formatDelimitedField("CQ", input);

    expect(lines).toEqual([
      "CQ |",
      "```python",
      'print("Hello {{c1::World}}")',
      "``` |",
    ]);
  });

  it("pushDelimitedField also separates fence from header", () => {
    setDelimiter("|");

    const input = [
      '```',
      'code',
      '```',
    ].join("\n");

    const out: string[] = [];
    pushDelimitedField(out, "CQ", input);

    expect(out).toEqual([
      "CQ |",
      "```",
      "code",
      "``` |",
    ]);
  });

  it("fence on its own line still wraps cleanly", () => {
    setDelimiter("|");

    const input = [
      'plain text',
      '```',
      'code here',
      '```',
    ].join("\n");

    const lines = formatDelimitedField("Q", input);

    // Should emit: first line with key+delim, then fences, then closing
    expect(lines[0]).toBe("Q | plain text");
    expect(lines).toContain("```");
    expect(lines).toContain("code here");
    expect(lines[lines.length - 1]).toBe("``` |");
  });

  it("single backtick inline code is unaffected", () => {
    setDelimiter("|");

    const input = "Some `inline code` here";

    const lines = formatDelimitedField("Q", input);

    expect(lines).toEqual([
      "Q | Some `inline code` here |",
    ]);
  });

  it("text before code fence stays on header line", () => {
    setDelimiter("|");

    const input = [
      'Look at this:',
      '```',
      'code',
      '```',
    ].join("\n");

    const lines = formatDelimitedField("CQ", input);

    expect(lines[0]).toBe("CQ | Look at this:");
    expect(lines).toContain("```");
    expect(lines[lines.length - 1]).toBe("``` |");
  });
});

describe("reading view cloze with code fences", () => {
  it("renders code block as <pre><code> in non-math cloze front", () => {
    const input = [
      'Before',
      '```',
      'print("Hello {{c1::World}}")',
      '```',
      'After',
    ].join("\n");

    const front = buildReadingFlashcardCloze(input, "front");

    // Should contain <pre><code> not <br>-separated backticks
    expect(front).toContain("<pre><code>");
    expect(front).toContain("</code></pre>");
    // Cloze blank inside code
    expect(front).toContain("learnkit-flashcard-blank");
    // Plain text before and after
    expect(front).toContain("Before");
    expect(front).toContain("After");
    // Should NOT have literal backticks rendered as text
    expect(front).not.toContain("```");
  });

  it("renders code block with cloze reveal on back side", () => {
    const input = [
      '```',
      'print("Hello {{c1::World}}")',
      '```',
    ].join("\n");

    const back = buildReadingFlashcardCloze(input, "back");

    expect(back).toContain("<pre><code>");
    expect(back).toContain("</code></pre>");
    expect(back).toContain("learnkit-reading-view-cloze");
    expect(back).toContain("World");
  });

  it("preserves language class on code block", () => {
    const input = [
      '```python',
      'x = {{c1::42}}',
      '```',
    ].join("\n");

    const front = buildReadingFlashcardCloze(input, "front");

    expect(front).toContain('class="language-python"');
  });

  it("works with math + code fences combined", () => {
    const input = [
      'Math: $x$',
      '```',
      'y = {{c1::5}}',
      '```',
    ].join("\n");

    const front = buildReadingFlashcardCloze(input, "front");

    // Code block rendered
    expect(front).toContain("<pre><code>");
    expect(front).toContain("</code></pre>");
    // Math preserved
    expect(front).toContain("$x$");
    // Cloze blank inside code
    expect(front).toContain("learnkit-flashcard-blank");
  });

  it("single backtick inline code still uses <code> not <pre><code>", () => {
    const input = "Use `print()` to {{c1::output}}";

    const front = buildReadingFlashcardCloze(input, "front");

    // Inline code gets <code> via processMarkdownFeatures
    expect(front).toContain("<code>print()</code>");
    // NOT a block-level <pre><code>
    expect(front).not.toContain("<pre><code>");
  });

  it("multiple code blocks in one cloze field", () => {
    const input = [
      '```',
      'a = {{c1::1}}',
      '```',
      'text',
      '```',
      'b = {{c2::2}}',
      '```',
    ].join("\n");

    const front = buildReadingFlashcardCloze(input, "front");

    // Two <pre><code> blocks
    const preCount = (front.match(/<pre><code/g) || []).length;
    expect(preCount).toBe(2);
  });

  it("unclosed fence is still rendered as code block", () => {
    const input = [
      '```',
      'print("{{c1::hello}}")',
    ].join("\n");

    const front = buildReadingFlashcardCloze(input, "front");

    // Should still get <pre><code> for unclosed fence
    expect(front).toContain("<pre><code>");
    expect(front).toContain("learnkit-flashcard-blank");
  });
});
