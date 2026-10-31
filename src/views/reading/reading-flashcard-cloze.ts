import { parseClozeTokens, processClozeForMath, resolveNestedClozeAnswers } from "../../platform/core/shared-utils";
import { createFragmentFromHTML } from "../../platform/core/ui";
import { escapeHtml, processMarkdownFeatures } from "./reading-helpers";

/** Replace HTML tags with opaque placeholders so processMarkdownFeatures
 *  (which HTML-escapes its input) doesn't destroy already-generated HTML. */
function protectHtmlTags(html: string): { text: string; restore: (s: string) => string } {
  const tags: string[] = [];
  const PH = "@@LEARNKITHTML";
  const protected_ = html.replace(/<[^>]+>/g, (match) => {
    const idx = tags.length;
    tags.push(match);
    return `${PH}${idx}@@`;
  });
  return {
    text: protected_,
    restore: (s: string) =>
      s.replace(new RegExp(`${PH}(\\d+)@@`, "g"), (_m, idx) => tags[Number(idx)] ?? ""),
  };
}

// ── Code fence pre-processing ───────────────────────────────────────

export const FENCE_PH = "@@LEARNKITFENCE";

/** Opening fence: 3+ backticks, optional language specifier, whitespace only. */
const FENCE_OPEN_RE = /^\s*`{3,}\s*(\w*)\s*$/;

/** Closing fence: 3+ backticks, no language, whitespace only. */
const FENCE_CLOSE_RE = /^\s*`{3,}\s*$/;

function processClozeInCode(
  code: string,
  opts: { blankClass: string; revealClass: string },
): string {
  const clozeRe = /\{\{c(\d+)::([^}]*?)(?:::([^}]*?))?\}\}/g;
  let result = "";
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = clozeRe.exec(code)) !== null) {
    result += escapeHtml(code.slice(lastIdx, match.index));
    const answer = match[2];
    const hint = match[3];

    if (opts.revealClass) {
      result += `<span class="${opts.revealClass}">${escapeHtml(answer)}</span>`;
    } else if (hint) {
      result += `<span class="learnkit-cloze-hint" style="width:${computeReadingViewClozeWidthPx(answer)}px">${escapeHtml(hint)}</span>`;
    } else {
      result += `<span class="${opts.blankClass || 'learnkit-flashcard-blank'}">&nbsp;</span>`;
    }
    lastIdx = match.index + match[0].length;
  }
  result += escapeHtml(code.slice(lastIdx));
  return result;
}

/** Options passed to {@link protectCodeFences}. */
export interface CodeFenceProtectOptions {
  /** CSS class for cloze blanks (front side / unrevealed). */
  blankClass: string;
  /** CSS class for cloze reveals (back side / revealed). Empty string = front mode (blanks). */
  revealClass: string;
}

/**
 * Extract fenced code blocks from source, replace them with opaque
 * placeholders, and return a restorer that swaps placeholders back
 * to pre-rendered &lt;pre&gt;&lt;code&gt; HTML (with cloze processing applied).
 *
 * Exported for use by both reading view and study mode rendering.
 */
export function protectCodeFences(
  source: string,
  opts: CodeFenceProtectOptions,
): {
  text: string;
  restore: (s: string) => string;
} {
  const blocks: string[] = [];
  const lines = source.split("\n");
  const outLines: string[] = [];
  let inFence = false;
  let fenceLang = "";
  let fenceLines: string[] = [];

  for (const line of lines) {
    if (!inFence) {
      const openMatch = line.match(FENCE_OPEN_RE);
      if (openMatch) {
        inFence = true;
        fenceLang = openMatch[1] || "";
        fenceLines = [];
        outLines.push(`${FENCE_PH}${blocks.length}@@`);
        continue;
      }
      outLines.push(line);
    } else {
      if (FENCE_CLOSE_RE.test(line)) {
        const content = fenceLines.join("\n");
        const processed = processClozeInCode(content, opts);
        const langAttr = fenceLang ? ` class="language-${fenceLang}"` : "";
        blocks.push(`<pre><code${langAttr}>${processed}</code></pre>`);
        inFence = false;
        continue;
      }
      fenceLines.push(line);
    }
  }

  // Unclosed fence: treat remaining lines as code content.
  if (inFence && fenceLines.length) {
    const content = fenceLines.join("\n");
    const processed = processClozeInCode(content, opts);
    const langAttr = fenceLang ? ` class="language-${fenceLang}"` : "";
    blocks.push(`<pre><code${langAttr}>${processed}</code></pre>`);
  }

  return {
    text: outLines.join("\n"),
    restore: (s: string) => {
      let r = s;
      for (let i = 0; i < blocks.length; i++) {
        r = r.split(`${FENCE_PH}${i}@@`).join(blocks[i]);
      }
      return r;
    },
  };
}

/**
 * Swap the code-fence placeholders produced by {@link protectCodeFences} for their
 * pre-rendered `<pre><code>` HTML **in the live DOM**, without serialising the
 * container.
 *
 * Why this exists: the previous approach re-read `container.innerHTML`, did string
 * replacement on it and parsed it back through `replaceChildrenWithHTML`. That
 * round-trip is lossy — the sanitiser drops MathJax custom elements (`mjx-*`)
 * and strips `app://` resource URLs from `img.src` — so a cloze answer
 * containing display math rendered as an empty block (#220) and a cloze front
 * field containing an image rendered as a broken placeholder (#221).
 *
 * Walking the DOM instead leaves every node the Markdown renderer produced
 * exactly where it is; only the placeholders change.
 *
 * Returns the number of placeholders replaced (0 when the card had no fences,
 * in which case the container is not touched at all).
 */
export function restoreCodeFencesInDom(
  container: HTMLElement,
  restoreFences: (html: string) => string,
): number {
  if (!container) return 0;

  const doc = container.ownerDocument ?? activeDocument;
  const placeholderRe = new RegExp(`${FENCE_PH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\d+@@`, "g");
  const mentionsPlaceholder = (value: string): boolean => value.includes(FENCE_PH);

  // Collect first — mutating while walking invalidates the TreeWalker.
  const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const candidates: Text[] = [];
  let current: Node | null;
  while ((current = walker.nextNode())) {
    if (current.nodeType !== Node.TEXT_NODE) continue;
    const text = (current as Text).nodeValue ?? "";
    if (!mentionsPlaceholder(text)) continue;
    candidates.push(current as Text);
  }

  if (!candidates.length) return 0;

  let replaced = 0;

  for (const node of candidates) {
    const text = node.nodeValue ?? "";
    placeholderRe.lastIndex = 0;
    const matches = Array.from(text.matchAll(placeholderRe));
    if (!matches.length) continue;

    // Resolve first: a placeholder the restorer does not recognise comes back
    // unchanged, and must be left exactly as it was rather than swapped for a
    // copy of itself.
    const resolved = matches
      .map((match) => ({ match, html: restoreFences(match[0]) }))
      .filter((entry) => entry.html !== entry.match[0]);
    if (!resolved.length) continue;

    const parent = node.parentElement;
    const paragraphText = parent?.tagName === "P" ? (parent.textContent ?? "").trim() : "";
    // MarkdownRenderer wraps a standalone placeholder in its own <p>. Replacing
    // the text with block-level <pre> inside a <p> would be invalid HTML, so
    // unwrap the paragraph when the placeholder was all it contained.
    const unwrapParagraph =
      !!parent &&
      paragraphText !== "" &&
      paragraphText === text.trim() &&
      matches.length === 1;

    const fragment = doc.createDocumentFragment();
    let cursor = 0;
    for (const { match, html } of resolved) {
      const start = match.index ?? 0;
      if (start > cursor) {
        fragment.appendChild(doc.createTextNode(text.slice(cursor, start)));
      }
      fragment.appendChild(createFragmentFromHTML(html));
      cursor = start + match[0].length;
      replaced += 1;
    }
    if (cursor < text.length) {
      fragment.appendChild(doc.createTextNode(text.slice(cursor)));
    }

    node.replaceWith(fragment);

    if (unwrapParagraph && parent?.parentNode) {
      const children = Array.from(parent.childNodes);
      parent.replaceWith(...children);
    }
  }

  return replaced;
}

function stripInlineMarkdownMarkers(text: string): string {
  return String(text ?? "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .trim();
}

function computeReadingViewClozeWidthPx(content: string): number {
  const plainContent = stripInlineMarkdownMarkers(content || "");
  const widthUnits = Math.max(4, Math.min(40, plainContent.length || 6));
  return Math.max(30, (widthUnits * 8) - 20);
}

function buildReadingViewHintHtml(answer: string, hint: string): string {
  const answerWidth = computeReadingViewClozeWidthPx(answer);
  const hintWidth = computeReadingViewClozeWidthPx(hint);
  const widthPx = Math.max(answerWidth, hintWidth);
  return `<span class="learnkit-cloze-hint" style="width:${widthPx}px">${escapeHtml(stripInlineMarkdownMarkers(hint))}</span>`;
}

function renderMarkdownTextWithExplicitBreaks(value: string): string {
  return String(value ?? "")
    .split("\n")
    .map((segment) => processMarkdownFeatures(segment))
    .join("<br>");
}

function renderNestedReadingViewClozeHtml(answer: string): string {
  const source = String(answer ?? "").trim();
  if (!source) return "";

  const clozeMatches = parseClozeTokens(source).tokens;
  if (!clozeMatches.length) {
    return renderMarkdownTextWithExplicitBreaks(source);
  }

  let out = "";
  let last = 0;

  for (const match of clozeMatches) {
    if (match.start > last) {
      out += renderMarkdownTextWithExplicitBreaks(source.slice(last, match.start));
    }

    const nestedHtml = renderNestedReadingViewClozeHtml(match.answer);
    out += nestedHtml
      ? `<span class="learnkit-reading-view-cloze"><span class="learnkit-cloze-text">${nestedHtml}</span></span>`
      : `<span class="learnkit-flashcard-blank">&nbsp;</span>`;
    last = match.end;
  }

  if (last < source.length) {
    out += renderMarkdownTextWithExplicitBreaks(source.slice(last));
  }

  return out;
}

export function buildReadingFlashcardCloze(text: string, mode: "front" | "back"): string {
  const source = String(text || "");

  // ── Extract code fences before any cloze / markdown processing ──
  // Fenced blocks are replaced with opaque placeholders, rendered as
  // <pre><code> HTML (with cloze processing applied to code content),
  // and restored after all other processing completes.
  const fenceOpts = mode === "front"
    ? { blankClass: "learnkit-flashcard-blank", revealClass: "" }
    : { blankClass: "", revealClass: "learnkit-reading-view-cloze" };
  const { text: fenceFree, restore: restoreFences } = protectCodeFences(source, fenceOpts);

  if (fenceFree.includes("$") || fenceFree.includes("\\(") || fenceFree.includes("\\[")) {
    const reveal = mode === "back";
    const clozeHtml = processClozeForMath(fenceFree, reveal, null, {
      blankClassName: "learnkit-flashcard-blank",
      revealWrapper: (answer) =>
        `<span class="learnkit-reading-view-cloze"><span class="learnkit-cloze-text">${processMarkdownFeatures(answer)}</span></span>`,
    });
    // processClozeForMath generates HTML (blank spans, hint spans) that
    // would be destroyed by processMarkdownFeatures' HTML escaping.
    // Protect those tags, process markdown on the surrounding text, then restore.
    const { text: protectedHtml, restore } = protectHtmlTags(clozeHtml);
    return restoreFences(restore(processMarkdownFeatures(protectedHtml)));
  }

  const clozeMatches = parseClozeTokens(fenceFree).tokens;
  let out = "";
  let last = 0;

  for (const match of clozeMatches) {
    if (match.start > last) {
      out += renderMarkdownTextWithExplicitBreaks(fenceFree.slice(last, match.start));
    }

    const resolvedAnswer = resolveNestedClozeAnswers(match.answer).trim();
    const hint = match.hint;

    if (mode === "front") {
      out += hint
        ? buildReadingViewHintHtml(resolvedAnswer, hint)
        : `<span class="learnkit-flashcard-blank">&nbsp;</span>`;
    } else {
      const nestedHtml = renderNestedReadingViewClozeHtml(match.answer);
      out += nestedHtml
        ? `<span class="learnkit-reading-view-cloze"><span class="learnkit-cloze-text">${nestedHtml}</span></span>`
        : `<span class="learnkit-flashcard-blank">&nbsp;</span>`;
    }

    last = match.end;
  }

  if (last < fenceFree.length) {
    out += renderMarkdownTextWithExplicitBreaks(fenceFree.slice(last));
  }

  return restoreFences(out);
}