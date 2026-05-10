/* @vitest-environment jsdom */

import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  __testBuildMarkdownModeContent,
  __testCollectAndMarkOwnedSiblings,
  __testIsLikelyDanglingCardResidue,
  __testRefreshProcessedCards,
  __testRunPostRefreshSpilloverCleanup,
} from "../src/views/reading/reading-view";

describe("clean markdown renderer", () => {
  it("renders basic question, answer, and extra information fields", () => {
    const card = {
      anchorId: "144037859",
      type: "basic",
      title: "git reset",
      fields: {
        Q: "What does `git reset --hard` do compared to `git reset <commit-sha>`?",
        A: [
          "git commands",
          "- `git reset --hard` discards **all** changes",
          "- `git reset <commit-sha>` moves HEAD but keeps working directory",
          "Math: $x < y$ when $y > x$",
        ].join("\n"),
        I: "Use `git reflog` to recover if needed.",
      },
    } as never;

    const html = __testBuildMarkdownModeContent(card, true);

    expect(html).toContain("Basic Question:");
    // Backticks are now rendered as <code> elements; < and > are still escaped inside
    expect(html).toContain("<code>git reset --hard</code>");
    expect(html).toContain("<code>git reset &lt;commit-sha&gt;</code>");
    expect(html).toContain("Answer:");
    // List items with backtick formatting become <code> elements
    expect(html).toContain("<code>git reset --hard</code> discards <strong>all</strong> changes");
    expect(html).toContain("<code>git reset &lt;commit-sha&gt;</code> moves HEAD but keeps working directory");
    expect(html).toContain("Extra Information:");
    expect(html).toContain("Use <code>git reflog</code> to recover if needed.");
  });

  it("uses reversed question field in markdown mode", () => {
    const card = {
      anchorId: "200",
      type: "reversed",
      title: "",
      fields: {
        Q: "This should not render as the reversed prompt",
        RQ: "Reverse prompt",
        A: "Reverse answer",
      },
    } as never;

    const html = __testBuildMarkdownModeContent(card, true);
    expect(html).toContain("Reversed Question:");
    expect(html).toContain("Reverse prompt");
    expect(html).not.toContain("This should not render as the reversed prompt");
    expect(html).toContain("Answer:");
    expect(html).toContain("Reverse answer");
  });
  it("renders cloze cards with backtick code and angle brackets in answers", () => {
    const card = {
      anchorId: "144037860",
      type: "cloze",
      title: "Shell Commands",
      fields: {
        CQ: "To reset a commit in Git, use {{c1::`git reset <commit-sha>`}} and to list files use {{c2::`ls -la`}}.",
        I: "See `man git` for more details.",
      },
    } as never;

    const html = __testBuildMarkdownModeContent(card, true);

    expect(html).toContain("Cloze Question:");
    // Cloze content should have <code> for backticked text, and < >
    // appear as entities since they're inside the code span.
    expect(html).toContain("learnkit-cloze-revealed");
    expect(html).toContain("<code>git reset &lt;commit-sha&gt;</code>");
    expect(html).toContain("<code>ls -la</code>");
    expect(html).toContain("Extra Information:");
    expect(html).toContain("<code>man git</code>");
  });
});

describe("dangling residue detection", () => {
  it("detects list spillover in sections with clean-markdown cards", () => {
    const dom = new JSDOM(`
      <div class="markdown-preview-section">
        <div class="learnkit-reading-card-run">
          <div class="learnkit-pretty-card learnkit-macro-markdown" data-learnkit-processed="true"></div>
        </div>
        <div class="el-ul"></div>
      </div>
    `);

    const ul = dom.window.document.querySelector(".el-ul") as Element;
    const spillover = [
      "{{c1::Contraction (dehydration and volume depletion)::C}}",
      "{{c2::Diuretics (loop, thiazide)::D}} |",
      "I | Respiratory alkalosis is defined as pH >7.45 with PaCO2 <35 mmHg. |",
    ].join("\n");

    expect(__testIsLikelyDanglingCardResidue(spillover, ul)).toBe(true);
  });

  it("does not mark unrelated list blocks as spillover", () => {
    const dom = new JSDOM(`
      <div class="markdown-preview-section">
        <div class="el-ul"></div>
      </div>
    `);

    const ul = dom.window.document.querySelector(".el-ul") as Element;
    const ordinaryList = ["First note", "Second note", "Third note"].join("\n");

    expect(__testIsLikelyDanglingCardResidue(ordinaryList, ul)).toBe(false);
  });

  it("detects list spillover in clean markdown sections without run wrappers", () => {
    const dom = new JSDOM(`
      <div class="markdown-preview-section learnkit-layout-vertical">
        <div class="el-p learnkit-pretty-card learnkit-macro-markdown" data-learnkit-processed="true"></div>
        <div class="el-ul"></div>
      </div>
    `);

    const ul = dom.window.document.querySelector(".el-ul") as Element;
    const spillover = [
      "`git reset --hard` discards **all** changes",
      "`git reset <commit-sha>` moves HEAD but keeps working directory",
      "Math: $x < y$ when $y > x$ — note `<` and `>` inside LaTeX still work |",
    ].join("\n");

    expect(__testIsLikelyDanglingCardResidue(spillover, ul)).toBe(true);
  });

  it("rehides visible list spillover during post-refresh cleanup", () => {
    const dom = new JSDOM(`
      <div class="markdown-preview-section learnkit-layout-masonry">
        <div class="learnkit-reading-card-run">
          <div
            class="el-p learnkit-pretty-card learnkit-macro-flashcards"
            data-learnkit-processed="true"
            data-learnkit-raw-text="^learnkit-144037859\nA | git commands\n- item one |"
          ></div>
          <div class="el-ul">
            <ul><li>item one</li></ul>
          </div>
        </div>
      </div>
    `);

    const section = dom.window.document.querySelector(".markdown-preview-section") as HTMLElement;
    const spill = dom.window.document.querySelector(".el-ul") as HTMLElement;

    expect(spill.classList.contains("learnkit-hidden-important")).toBe(false);
    expect(spill.getAttribute("data-learnkit-hidden")).toBeNull();

    __testRunPostRefreshSpilloverCleanup(section);

    expect(spill.classList.contains("learnkit-hidden-important")).toBe(true);
    expect(spill.getAttribute("data-learnkit-hidden")).toBe("true");
  });

  it("rehides ordered-list spillover from multiline flashcard info fields", () => {
    const rawText = [
      "^learnkit-889933406",
      "T | Trauma-Focused CBT Steps for ASD |",
      "OQ | Order the typical steps in Trauma-Focused Cognitive Behavioral Therapy (TF-CBT) for Acute Stress Disorder. |",
      "1 | Education on trauma |",
      "2 | Symptom management |",
      "3 | Cognitive restructuring |",
      "4 | Exposure therapy |",
      "I | Trauma-focused cognitive behavioural therapy follows a structured progression:",
      "1. Psychoeducation about trauma and normal stress responses",
      "2. Symptom management including relaxation and grounding techniques to reduce arousal",
      "3. Cognitive restructuring to address maladaptive beliefs (e.g. guilt, catastrophising)",
      "4. Graded exposure to trauma memories or reminders to facilitate emotional processing and reduce avoidance.",
      "The sequence is important, as stabilisation precedes trauma processing. |",
    ].join("\n");

    const dom = new JSDOM(`
      <div class="markdown-preview-section learnkit-layout-masonry">
        <div class="learnkit-reading-card-run">
          <div
            class="el-p learnkit-pretty-card learnkit-macro-flashcards"
            data-learnkit-processed="true"
            data-sprout-processed="true"
          ></div>
        </div>
        <div class="el-ol">
          <ol>
            <li>Psychoeducation about trauma and normal stress responses</li>
            <li>Symptom management including relaxation and grounding techniques to reduce arousal</li>
            <li>Cognitive restructuring to address maladaptive beliefs (e.g. guilt, catastrophising)</li>
            <li>Graded exposure to trauma memories or reminders to facilitate emotional processing and reduce avoidance.<br>The sequence is important, as stabilisation precedes trauma processing. |</li>
          </ol>
        </div>
      </div>
    `);

    const section = dom.window.document.querySelector(".markdown-preview-section") as HTMLElement;
    const card = dom.window.document.querySelector(".learnkit-pretty-card") as HTMLElement;
    const spill = dom.window.document.querySelector(".el-ol") as HTMLElement;

    card.setAttribute("data-learnkit-raw-text", rawText);

    expect(spill.classList.contains("learnkit-hidden-important")).toBe(false);
    expect(spill.getAttribute("data-learnkit-hidden")).toBeNull();

    __testRunPostRefreshSpilloverCleanup(section);

    expect(spill.classList.contains("learnkit-hidden-important")).toBe(true);
    expect(spill.getAttribute("data-learnkit-hidden")).toBe("true");
  });

  it("hides untagged vertical list spillover adjacent to processed cards", () => {
    const dom = new JSDOM(`
      <div class="markdown-preview-section learnkit-layout-vertical">
        <div
          class="el-p learnkit-pretty-card learnkit-macro-markdown"
          data-learnkit-processed="true"
          data-sprout-processed="true"
        ></div>
        <div class="el-ul">
          <ul>
            <li>{{c1::Hyperalimentation::H}}</li>
            <li>{{c1::Saline infusion::S}} |</li>
            <li>I | The most common causes are diarrhoea. |</li>
          </ul>
        </div>
      </div>
    `);

    const section = dom.window.document.querySelector(".markdown-preview-section") as HTMLElement;
    const spill = dom.window.document.querySelector(".el-ul") as HTMLElement;

    expect(spill.classList.contains("learnkit-hidden-important")).toBe(false);
    expect(spill.getAttribute("data-learnkit-hidden")).toBeNull();

    __testRunPostRefreshSpilloverCleanup(section);

    expect(spill.classList.contains("learnkit-hidden-important")).toBe(true);
    expect(spill.getAttribute("data-learnkit-hidden")).toBe("true");
  });

  it("preserves original content when refreshing an already-processed card", async () => {
    const rawText = [
      "^learnkit-963469930",
      "T | Causes of Respiratory Alkalosis |",
      "CQ | Causes of respiratory alkalosis can be remembered with the mnemonic **CHAMPS**:",
      "- {{c3::Salicylates (early toxicity)::S}} |",
      "I | Respiratory alkalosis is defined as pH >7.45 with PaCO2 <35 mmHg. |",
    ].join("\n");

    const dom = new JSDOM(`
      <div class="markdown-preview-section learnkit-layout-vertical">
        <div
          class="el-p learnkit-pretty-card learnkit-reading-card learnkit-reading-view-wrapper accent learnkit-macro-markdown"
          data-learnkit-processed="true"
          data-learnkit-raw-text="${rawText.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}"
        >
          <div class="learnkit-card-content learnkit-reading-card-content">rendered card</div>
          <div class="learnkit-original-content" aria-hidden="true">
            <p dir="auto">^learnkit-963469930<br>T | Causes of Respiratory Alkalosis |<br>CQ | Causes of respiratory alkalosis can be remembered with the mnemonic <strong>CHAMPS</strong>:</p>
          </div>
        </div>
      </div>
    `);

    const section = dom.window.document.querySelector(".markdown-preview-section") as HTMLElement;
    const card = dom.window.document.querySelector(".learnkit-pretty-card") as HTMLElement;

    await __testRefreshProcessedCards(section, rawText);

    const original = card.querySelector(".learnkit-original-content") as HTMLElement;
    expect(original.innerHTML).not.toContain("learnkit-card-content");
    expect(card.querySelectorAll(".learnkit-card-content")).toHaveLength(1);
  });
});

describe("deterministic spillover ownership", () => {
  it("marks ordered-list spillover from multiline I-field with ownership attribute", () => {
    const rawText = [
      "^learnkit-889933406",
      "T | Trauma-Focused CBT Steps for ASD |",
      "OQ | Order the typical steps in Trauma-Focused Cognitive Behavioral Therapy (TF-CBT) for Acute Stress Disorder. |",
      "1 | Education on trauma |",
      "2 | Symptom management |",
      "3 | Cognitive restructuring |",
      "4 | Exposure therapy |",
      "I | Trauma-focused cognitive behavioural therapy follows a structured progression:",
      "1. Psychoeducation about trauma and normal stress responses",
      "2. Symptom management including relaxation and grounding techniques to reduce arousal",
      "3. Cognitive restructuring to address maladaptive beliefs (e.g. guilt, catastrophising)",
      "4. Graded exposure to trauma memories or reminders to facilitate emotional processing and reduce avoidance.",
      "The sequence is important, as stabilisation precedes trauma processing. |",
    ].join("\n");

    const dom = new JSDOM(`
      <div class="markdown-preview-section learnkit-layout-masonry">
        <div class="learnkit-reading-card-run">
          <div
            class="el-p learnkit-pretty-card learnkit-macro-flashcards"
            data-learnkit-processed="true"
            data-sprout-processed="true"
            data-learnkit-id="889933406"
          ></div>
        </div>
        <div class="el-ol">
          <ol>
            <li>Psychoeducation about trauma and normal stress responses</li>
            <li>Symptom management including relaxation and grounding techniques to reduce arousal</li>
            <li>Cognitive restructuring to address maladaptive beliefs (e.g. guilt, catastrophising)</li>
            <li>Graded exposure to trauma memories or reminders to facilitate emotional processing and reduce avoidance.<br>The sequence is important, as stabilisation precedes trauma processing. |</li>
          </ol>
        </div>
      </div>
    `);

    const card = dom.window.document.querySelector(".learnkit-pretty-card") as HTMLElement;
    card.setAttribute("data-learnkit-raw-text", rawText);

    __testCollectAndMarkOwnedSiblings(card, rawText);

    const spill = dom.window.document.querySelector(".el-ol") as HTMLElement;
    expect(spill.getAttribute("data-learnkit-owned-by")).toBe("889933406");
    expect(spill.classList.contains("learnkit-hidden-important")).toBe(true);
    expect(spill.getAttribute("data-learnkit-hidden")).toBe("true");
  });

  it("marks unordered-list spillover from multiline I-field on MCQ cards", () => {
    const rawText = [
      "^learnkit-123",
      "T | Causes of Respiratory Alkalosis |",
      "MCQ | Which of the following is a cause of respiratory alkalosis? |",
      "A | Pneumonia |",
      "B | Anxiety |",
      "C | COPD |",
      "D | Opioid overdose |",
      "I | Respiratory alkalosis is defined as pH >7.45 with PaCO2 <35 mmHg:",
      "- Common causes include anxiety, hyperventilation, and salicylate toxicity",
      "- Early sepsis and pulmonary embolism can also present with respiratory alkalosis",
      "- Always check for hypoxemia before assuming primary hyperventilation |",
    ].join("\n");

    const dom = new JSDOM(`
      <div class="markdown-preview-section learnkit-layout-masonry">
        <div class="learnkit-reading-card-run">
          <div
            class="el-p learnkit-pretty-card learnkit-macro-flashcards"
            data-learnkit-processed="true"
            data-learnkit-id="123"
          ></div>
        </div>
        <div class="el-ul">
          <ul>
            <li>Common causes include anxiety, hyperventilation, and salicylate toxicity</li>
            <li>Early sepsis and pulmonary embolism can also present with respiratory alkalosis</li>
            <li>Always check for hypoxemia before assuming primary hyperventilation |</li>
          </ul>
        </div>
      </div>
    `);

    const card = dom.window.document.querySelector(".learnkit-pretty-card") as HTMLElement;
    card.setAttribute("data-learnkit-raw-text", rawText);

    __testCollectAndMarkOwnedSiblings(card, rawText);

    const spill = dom.window.document.querySelector(".el-ul") as HTMLElement;
    expect(spill.getAttribute("data-learnkit-owned-by")).toBe("123");
    expect(spill.classList.contains("learnkit-hidden-important")).toBe(true);
  });

  it("does not capture unrelated prose after a closed card field", () => {
    const rawText = [
      "^learnkit-456",
      "T | Simple Card |",
      "Q | What is 2+2? |",
      "A | 4 |",
    ].join("\n");

    const dom = new JSDOM(`
      <div class="markdown-preview-section learnkit-layout-masonry">
        <div class="learnkit-reading-card-run">
          <div
            class="el-p learnkit-pretty-card learnkit-macro-flashcards"
            data-learnkit-processed="true"
            data-learnkit-id="456"
          ></div>
        </div>
        <div class="el-p">
          <p dir="auto">This is just a normal paragraph after the card.</p>
        </div>
        <div class="el-ul">
          <ul>
            <li>Unrelated list item</li>
            <li>Another unrelated item</li>
          </ul>
        </div>
      </div>
    `);

    const card = dom.window.document.querySelector(".learnkit-pretty-card") as HTMLElement;
    card.setAttribute("data-learnkit-raw-text", rawText);

    __testCollectAndMarkOwnedSiblings(card, rawText);

    // The unrelated elements should NOT be marked as owned or hidden
    const prose = dom.window.document.querySelectorAll(".el-p")[1] as HTMLElement;
    const list = dom.window.document.querySelector(".el-ul") as HTMLElement;
    expect(prose.hasAttribute("data-learnkit-owned-by")).toBe(false);
    expect(prose.classList.contains("learnkit-hidden-important")).toBe(false);
    expect(list.hasAttribute("data-learnkit-owned-by")).toBe(false);
    expect(list.classList.contains("learnkit-hidden-important")).toBe(false);
  });

  it("stops at headings between cards", () => {
    const rawText = [
      "^learnkit-789",
      "T | Card Before Heading |",
      "Q | Question? |",
      "A | Answer. |",
    ].join("\n");

    const dom = new JSDOM(`
      <div class="markdown-preview-section learnkit-layout-masonry">
        <div class="learnkit-reading-card-run">
          <div
            class="el-p learnkit-pretty-card learnkit-macro-flashcards"
            data-learnkit-processed="true"
            data-learnkit-id="789"
          ></div>
        </div>
        <div class="el-h2"><h2>Next Section</h2></div>
        <div class="el-p"><p dir="auto">Content in next section</p></div>
      </div>
    `);

    const card = dom.window.document.querySelector(".learnkit-pretty-card") as HTMLElement;
    card.setAttribute("data-learnkit-raw-text", rawText);

    __testCollectAndMarkOwnedSiblings(card, rawText);

    const heading = dom.window.document.querySelector(".el-h2") as HTMLElement;
    expect(heading.hasAttribute("data-learnkit-owned-by")).toBe(false);
    expect(heading.classList.contains("learnkit-hidden-important")).toBe(false);
  });

  it("stops at the next card anchor and does not consume it", () => {
    const rawText = [
      "^learnkit-111",
      "T | First Card |",
      "Q | Question one? |",
      "A | Answer one. |",
    ].join("\n");

    const dom = new JSDOM(`
      <div class="markdown-preview-section learnkit-layout-masonry">
        <div class="learnkit-reading-card-run">
          <div
            class="el-p learnkit-pretty-card learnkit-macro-flashcards"
            data-learnkit-processed="true"
            data-learnkit-id="111"
          ></div>
        </div>
        <div class="el-ol">
          <ol>
            <li>Some spillover from first card's I field</li>
          </ol>
        </div>
        <div class="el-p" data-learnkit-processed="true">
          <p dir="auto">^learnkit-222<br>T | Second Card |<br>Q | Question two? |<br>A | Answer two. |</p>
        </div>
      </div>
    `);

    const card = dom.window.document.querySelector(".learnkit-pretty-card") as HTMLElement;
    card.setAttribute("data-learnkit-raw-text", rawText);

    __testCollectAndMarkOwnedSiblings(card, rawText);

    // The second card should NOT be owned by the first
    const secondCard = dom.window.document.querySelector("[data-learnkit-processed]") as HTMLElement;
    // data-learnkit-processed is on the first card too; find the second
    const allProcessed = dom.window.document.querySelectorAll("[data-learnkit-processed]");
    const second = allProcessed[allProcessed.length - 1] as HTMLElement;
    expect(second.hasAttribute("data-learnkit-owned-by")).toBe(false);
  });
});
