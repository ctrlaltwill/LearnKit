import { parseClozeTokens, processClozeForMath, resolveNestedClozeAnswers } from "../../platform/core/shared-utils";
import { escapeHtml, processMarkdownFeatures } from "./reading-helpers";

/** Replace HTML tags with opaque placeholders so processMarkdownFeatures
 *  (which HTML-escapes its input) doesn't destroy already-generated HTML. */
function protectHtmlTags(html: string): { text: string; restore: (s: string) => string } {
  const tags: string[] = [];
  const PH = "@@SPROUTHTML";
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

export const FENCE_PH = "@@SPROUTFENCE";

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