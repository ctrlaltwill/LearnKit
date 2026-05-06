/**
 * @file src/core/delimiter.ts
 * @summary Centralised delimiter utilities for Sprout's pipe-delimited card format.
 * Every file that reads or writes card fields should import helpers from here
 * instead of hard-coding the `|` character.
 *
 * The active delimiter is configured via `indexing.delimiter` in SproutSettings.
 * Allowed values: `|` (default), `@`, `~`, `;`.
 *
 * **Warning:** changing the delimiter does NOT migrate existing cards.
 * Cards written with the previous delimiter will no longer parse, and their
 * scheduling data will be lost on the next sync.
 *
 * @exports
 *   - DelimiterChar              — union type of allowed delimiter characters
 *   - DELIMITER_OPTIONS          — human-readable labels for the settings dropdown
 *   - getDelimiter               — returns the currently active delimiter character
 *   - setDelimiter               — sets the active delimiter (called from settings load)
 *   - escapeDelimiterRe          — regex-safe escaped version of the active delimiter
 *   - escapeDelimiterText        — escapes `\` and the delimiter in field content
 *   - unescapeDelimiterText      — reverses escapeDelimiterText
 *   - stripClosingDelimiter      — detects & strips an unescaped trailing delimiter
 *   - splitAtDelimiterTerminator — splits a line at the trailing delimiter (reading-view variant)
 *   - splitUnescapedDelimiters   — character-by-character split on unescaped delimiters
 *   - CARD_START_DELIM_RE        — dynamic regex: card-start line
 *   - FIELD_DELIM_RE             — dynamic regex: field line
 *   - TITLE_OUTSIDE_DELIM_RE     — dynamic regex: title outside card
 *   - ANY_HEADER_DELIM_RE        — dynamic regex: any header/field/anchor
 *   - FIELD_START_READING_RE     — dynamic regex: reading-view field-start
 *   - CARD_START_SETTINGS_RE     — dynamic regex: settings-utils card detection
 *   - FIELD_LINE_SETTINGS_RE     — dynamic regex: settings-utils field detection
 *   - FLASHCARD_HEADER_CARD_RE   — dynamic regex: sync-engine card header
 *   - FLASHCARD_HEADER_FIELD_RE  — dynamic regex: sync-engine field header
 */

// ── Types ────────────────────────────────────────────────────────────

export type DelimiterChar = "|" | "@" | "~" | ";";

/** Labels shown in the settings dropdown. */
export const DELIMITER_OPTIONS: Record<DelimiterChar, string> = {
  "|": "|  Pipe",
  "@": "@  At sign",
  "~": "~  Tilde",
  ";": ";  Semicolon",
};

// ── Active delimiter state ───────────────────────────────────────────

let _delim: DelimiterChar = "|";

/** Returns the currently active delimiter character. */
export function getDelimiter(): DelimiterChar {
  return _delim;
}

/**
 * Sets the active delimiter. Called once during plugin load (from settings)
 * and again if the user changes the setting.
 */
export function setDelimiter(d: DelimiterChar) {
  if (d !== "|" && d !== "@" && d !== "~" && d !== ";") d = "|";
  _delim = d;
  // Rebuild all cached regexes
  _rebuildRegexes();
}

// ── Regex-safe escape ────────────────────────────────────────────────

/** Returns the delimiter escaped for use inside a RegExp character class or literal. */
export function escapeDelimiterRe(d: string = _delim): string {
  return d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Text escape / unescape ──────────────────────────────────────────

/**
 * Escapes backslashes and the active delimiter in field content so the
 * text can safely appear inside a delimited field.
 *
 * `\`  →  `\\`
 * `<delim>`  →  `\<delim>`
 */
export function escapeDelimiterText(s: string): string {
  const d = _delim;
  let out = String(s ?? "").replace(/\\/g, "\\\\");
  // Only escape the delimiter character itself
  if (d === "|") out = out.replace(/\|/g, "\\|");
  else if (d === "@") out = out.replace(/@/g, "\\@");
  else if (d === "~") out = out.replace(/~/g, "\\~");
  else if (d === ";") out = out.replace(/;/g, "\\;");
  return out;
}

/**
 * Reverses escapeDelimiterText:
 * `\\`  →  `\`
 * `\<delim>`  →  `<delim>`
 */
export function unescapeDelimiterText(s: string): string {
  const d = _delim;
  const escaped = escapeDelimiterRe(d);
  return s
    .replace(/\\\\/g, "\x00")                          // placeholder for literal backslash
    .replace(new RegExp(`\\\\${escaped}`, "g"), d)       // \<delim> → <delim>
    .replace(/\0/g, "\\");                               // placeholder → backslash
}

// ── Closing-delimiter detection ─────────────────────────────────────

/**
 * For delimited fields (KEY <d> ... <d>):
 * Field ends when a line ends with an unescaped delimiter (ignoring trailing whitespace).
 * Returns the text without the closing delimiter, and whether the field closed.
 */
export function stripClosingDelimiter(line: string): { text: string; closed: boolean } {
  const d = _delim;
  const trimmedRight = line.replace(/[ \t]+$/g, "");
  if (!trimmedRight.endsWith(d)) return { text: line, closed: false };

  // Count consecutive backslashes before the final delimiter
  let bs = 0;
  for (let i = trimmedRight.length - 1 - d.length; i >= 0 && trimmedRight[i] === "\\"; i--) bs++;

  // Odd number of backslashes means the delimiter is escaped
  if (bs % 2 === 1) return { text: line, closed: false };

  return { text: trimmedRight.slice(0, -d.length), closed: true };
}

/**
 * Reading-view variant: splits at the trailing (unescaped) delimiter.
 * Returns the content before the delimiter and whether it was terminated.
 */
export function splitAtDelimiterTerminator(line: string): { content: string; terminated: boolean } {
  const d = _delim;
  const trimmedRight = line.replace(/[ \t]+$/g, "");
  if (!trimmedRight.endsWith(d)) return { content: line, terminated: false };

  // Count consecutive backslashes before the final delimiter
  let bs = 0;
  for (let i = trimmedRight.length - 1 - d.length; i >= 0 && trimmedRight[i] === "\\"; i--) bs++;

  // Odd number of backslashes means the delimiter is escaped
  if (bs % 2 === 1) return { content: line, terminated: false };

  return {
    content: trimmedRight.slice(0, -d.length),
    terminated: true,
  };
}

// ── Character-by-character split ────────────────────────────────────

/**
 * Splits a string on unescaped delimiter characters.
 * `\<delim>` is treated as a literal delimiter in the output.
 * `\\` is treated as a literal backslash.
 */
export function splitUnescapedDelimiters(s: string): string[] {
  const d = _delim;
  const out: string[] = [];
  let cur = "";
  let escape = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (escape) {
      cur += ch;
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === d) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
}

// ── Dynamic regex cache ─────────────────────────────────────────────
//
// All regexes that depend on the delimiter are rebuilt when setDelimiter()
// is called. Consumers import the getter functions below.

let _CARD_START_DELIM_RE: RegExp;
let _FIELD_DELIM_RE: RegExp;
let _TITLE_OUTSIDE_DELIM_RE: RegExp;
let _ANY_HEADER_DELIM_RE: RegExp;
let _FIELD_START_READING_RE: RegExp;
let _CARD_START_SETTINGS_RE: RegExp;
let _FIELD_LINE_SETTINGS_RE: RegExp;
let _FLASHCARD_HEADER_CARD_RE: RegExp;
let _FLASHCARD_HEADER_FIELD_RE: RegExp;

const ANCHOR_PREFIX_PATTERN = "(?:learnkit|sprout)";

function _rebuildRegexes() {
  const d = escapeDelimiterRe(_delim);

  // parser.ts — card start: ^(RQ|Q|MCQ|CQ|IO|HQ|OQ|QX)\s*<d>\s*(.*)$
  _CARD_START_DELIM_RE = new RegExp(`^(RQ|Q|MCQ|CQ|IO|HQ|OQ|QX)\\s*${d}\\s*(.*)$`);

  // parser.ts — field: ^(T|A|O|I|G|C|M|AX|\d{1,2})\s*<d>\s*(.*)$
  _FIELD_DELIM_RE = new RegExp(`^(T|A|O|I|G|C|M|AX|\\d{1,2})\\s*${d}\\s*(.*)$`);

  // parser.ts — title outside card: ^T\s*<d>\s*(.*)$
  _TITLE_OUTSIDE_DELIM_RE = new RegExp(`^T\\s*${d}\\s*(.*)$`);

  // parser.ts — any header/anchor: ^(?:^learnkit-\d{9}|^sprout-\d{9}|(?:RQ|Q|MCQ|CQ|IO|HQ|OQ|QX|T|A|O|I|G|C|M|AX|\d{1,2})\s*<d>)\s*
  _ANY_HEADER_DELIM_RE = new RegExp(
    `^(?:\\^${ANCHOR_PREFIX_PATTERN}-\\d{9}|(?:RQ|Q|MCQ|CQ|IO|HQ|OQ|QX|T|A|O|I|G|C|M|AX|\\d{1,2})\\s*${d})\\s*`,
  );

  // reading-helpers.ts — field start (relaxed): ^([A-Za-z]+|\d{1,2})\s*<d>\s*(.*)$
  _FIELD_START_READING_RE = new RegExp(`^([A-Za-z]+|\\d{1,2})\\s*${d}\\s*(.*)$`);

  // settings-utils.ts — card start (also accepts colon for legacy):
  //   ^(RQ|Q|MCQ|CQ|OQ|QX)\s*(?::|<d>)\s*.*$|^(IO|HQ)\s*<d>\s*.*$
  _CARD_START_SETTINGS_RE = new RegExp(
    `^(RQ|Q|MCQ|CQ|OQ|QX)\\s*(?::|${d})\\s*.*$|^(IO|HQ)\\s*${d}\\s*.*$`,
  );

  // settings-utils.ts — field line:
  //   ^(T|A|I|O|G|M|AX|\d{1,2})\s*(?::|<d>)\s*.*$|^(C|K)\s*(?::|<d>)\s*.*$
  _FIELD_LINE_SETTINGS_RE = new RegExp(
    `^(T|A|I|O|G|M|AX|\\d{1,2})\\s*(?::|${d})\\s*.*$|^(C|K)\\s*(?::|${d})\\s*.*$`,
  );

  // sync-engine.ts — flashcard header (card types):
  //   ^(RQ|Q|MCQ|CQ|IO|HQ|OQ|QX)\s*(?::|<d>)\s*
  _FLASHCARD_HEADER_CARD_RE = new RegExp(`^(RQ|Q|MCQ|CQ|IO|HQ|OQ|QX)\\s*(?::|${d})\\s*`);

  // sync-engine.ts — flashcard header (field types):
  //   ^(T|A|O|I|G|C|M|K|L|AX|QX|\d{1,2})\s*(?::|<d>)\s*
  _FLASHCARD_HEADER_FIELD_RE = new RegExp(`^(T|A|O|I|G|C|M|K|L|AX|QX|\\d{1,2})\\s*(?::|${d})\\s*`);
}

// Initial build with default delimiter
_rebuildRegexes();

// ── Regex getters ────────────────────────────────────────────────────

/** Card-start regex for parser.ts: `^(RQ|Q|MCQ|CQ|IO|OQ)\s*<d>\s*(.*)$` */
export function CARD_START_DELIM_RE(): RegExp { return _CARD_START_DELIM_RE; }

/** Field regex for parser.ts: `^(T|A|O|I|G|C|\d{1,2})\s*<d>\s*(.*)$` */
export function FIELD_DELIM_RE(): RegExp { return _FIELD_DELIM_RE; }

/** Title-outside-card regex for parser.ts: `^T\s*<d>\s*(.*)$` */
export function TITLE_OUTSIDE_DELIM_RE(): RegExp { return _TITLE_OUTSIDE_DELIM_RE; }

/** Any-header regex for parser.ts */
export function ANY_HEADER_DELIM_RE(): RegExp { return _ANY_HEADER_DELIM_RE; }

/** Reading-view field-start regex: `^([A-Za-z]+|\d{1,2})\s*<d>\s*(.*)$` */
export function FIELD_START_READING_RE(): RegExp { return _FIELD_START_READING_RE; }

/** Settings-utils card-start regex (includes legacy colon) */
export function CARD_START_SETTINGS_RE(): RegExp { return _CARD_START_SETTINGS_RE; }

/** Settings-utils field-line regex (includes legacy colon) */
export function FIELD_LINE_SETTINGS_RE(): RegExp { return _FIELD_LINE_SETTINGS_RE; }

/** Sync-engine flashcard header — card types */
export function FLASHCARD_HEADER_CARD_RE(): RegExp { return _FLASHCARD_HEADER_CARD_RE; }

/** Sync-engine flashcard header — field types */
export function FLASHCARD_HEADER_FIELD_RE(): RegExp { return _FLASHCARD_HEADER_FIELD_RE; }

// ── Markdown heading detection ──────────────────────────────────────

/**
 * Tests whether a line is a Markdown ATX heading (#, ##, ###, etc.).
 * These should never be treated as card shorthand or merged into
 * multi-line SR questions.
 */
export function isMarkdownHeading(line: string): boolean {
  return /^#{1,6}\s/.test(line);
}

// ── Shorthand syntax ────────────────────────────────────────────────

/**
 * Matches a single-line shorthand basic card: `Question::Answer`.
 * Uses double-colon – matches Obsidian Spaced Repetition's single-line basic
 * separator so existing SR users transition seamlessly.
 *
 * The `(?<!:)` and `(?!:)` lookarounds ensure `::` is exactly two colons
 * (not part of `:::`), preventing collision with the reversed shorthand.
 *
 * Both question (group 1) and answer (group 2) must be non-empty.
 *
 * Note: bare-line `::` does NOT conflict with `::` used inside pipe-delimited
 * combo fields because shorthand is only matched on unindented prose lines
 * before field content is parsed (see parser.ts loop order).
 */
export const BASIC_SHORTHAND_RE = /^(.+?)(?<!:)::(?!:)(.+)$/;

/**
 * Matches a single-line shorthand reversed (bidirectional) card: `Question:::Answer`.
 * Uses triple-colon – matches Obsidian Spaced Repetition's single-line bidirectional
 * separator. Creates two cards with Q↔A swapping.
 *
 * Both question (group 1) and answer (group 2) must be non-empty.
 */
export const REVERSED_SHORTHAND_RE = /^(.+?):::(.+)$/;

/**
 * Matches a single-line shorthand cloze card:
 *   `cloze::text with {{hidden}}`
 *   `cq::text with {{hidden}}`
 *   `CQ::text with {{hidden}}`
 * Case-insensitive prefix (cloze|cq). Group 1 = cloze body.
 *
 * The `(?!:)` prevents matching triple-colon syntax.
 */
export const CLOZE_SHORTHAND_RE = /^(?:cloze|cq)::(?!:)(.+)$/i;

// ── Spaced Repetition migration patterns ────────────────────────────

/**
 * Matches standalone `?` or `??` separator lines from Obsidian Spaced Repetition's
 * multi-line basic / bidirectional flashcard format.
 *
 * Multi-line basic:   question text \n? \n answer text
 * Multi-line reversed: question text \n??\n answer text
 *
 * These are pre-processed into single-line `::` / `:::` shorthand before the
 * main parser loop so existing SR vaults migrate seamlessly.
 */
export const SR_MULTILINE_BASIC_SEP_RE = /^\?$/;
export const SR_MULTILINE_REVERSED_SEP_RE = /^\?\?$/;

/**
 * Matches a line that contains at least one Obsidian Spaced Repetition
 * cloze deletion (`==text==`) with optional hint (`^[hint]`) and/or
 * sequence number (`[^N]`) trailing notation.
 *
 * Lines containing these patterns are pre-processed into LearnKit's
 * `cloze::...` shorthand (with auto-numbered `{{cN::text}}` tokens)
 * before the main parser loop.
 *
 * Capture groups per match:
 *   1 = cloze text content
 *   2 = optional hint (without ^[] wrapper)
 *   3 = optional sequence number (without [^] wrapper)
 */
export const SR_CLOZE_DELETION_RE = /==(.+?)==(?:\^\[(.+?)\])?(?:\[\^(\d+)\])?/g;

/**
 * Converts raw text containing SR cloze deletions into LearnKit shorthand.
 *
 * Simplified clozes (no [^N]): sequential numbering c1, c2, c3...
 * Classic clozes (with [^N]): deletions sharing the same [^N] get the same cN.
 *
 * Returns null if no cloze deletions are found in the line.
 */
export function convertSrClozeToShorthand(line: string): string | null {
  const pattern = SR_CLOZE_DELETION_RE;
  pattern.lastIndex = 0;

  // Collect all matches first
  const matches: Array<{ start: number; end: number; text: string; hint?: string; group?: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(line)) !== null) {
    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      text: m[1],
      hint: m[2] || undefined,
      group: m[3] !== undefined ? Number(m[3]) : undefined,
    });
  }

  if (matches.length === 0) return null;

  // Assign c numbers – same group → same number
  const groupMap = new Map<number, number>();
  let nextNum = 1;

  let result = "";
  let lastEnd = 0;
  for (const match of matches) {
    result += line.slice(lastEnd, match.start);

    let cNum: number;
    if (match.group !== undefined) {
      if (!groupMap.has(match.group)) {
        groupMap.set(match.group, nextNum++);
      }
      cNum = groupMap.get(match.group)!;
    } else {
      cNum = nextNum++;
    }

    if (match.hint) {
      result += `{{c${cNum}::${match.text}::${match.hint}}}`;
    } else {
      result += `{{c${cNum}::${match.text}}}`;
    }

    lastEnd = match.end;
  }
  result += line.slice(lastEnd);

  return `cloze::${result}`;
}

/**
 * Pre-processes an array of lines, merging Obsidian Spaced Repetition
 * multi-line basic / bidirectional blocks into single-line `::` / `:::`
 * shorthand lines.
 *
 * Standalone `?`  → basic (`::` join)
 * Standalone `??` → reversed (`:::` join)
 *
 * Returns a new lines array with merged shorthand lines replacing the
 * original multi-line blocks.
 */
export function mergeSrMultilineBlocks(
  lines: string[],
  fenceMask: boolean[],
  isHeaderLine: (line: string) => boolean,
): string[] {
  const result: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();

    // Check for standalone ? or ?? (not in code fence, not already a card line)
    if (
      !fenceMask[i] &&
      (SR_MULTILINE_BASIC_SEP_RE.test(trimmed) || SR_MULTILINE_REVERSED_SEP_RE.test(trimmed)) &&
      !isHeaderLine(lines[i])
    ) {
      const isReversed = SR_MULTILINE_REVERSED_SEP_RE.test(trimmed);

      // Collect preceding non-blank, non-header lines as question
      let qStart = i - 1;
      while (
        qStart >= 0 &&
        !fenceMask[qStart] &&
        lines[qStart].trim() !== "" &&
        !isHeaderLine(lines[qStart])
      ) {
        qStart--;
      }
      qStart++;

      // Collect following non-blank, non-header lines as answer
      let aEnd = i + 1;
      while (
        aEnd < lines.length &&
        !fenceMask[aEnd] &&
        lines[aEnd].trim() !== "" &&
        !isHeaderLine(lines[aEnd])
      ) {
        aEnd++;
      }

      const qLines = lines.slice(qStart, i).map((l) => l.trim()).filter(Boolean);
      const aLines = lines.slice(i + 1, aEnd).map((l) => l.trim()).filter(Boolean);

      if (qLines.length > 0 && aLines.length > 0) {
        // Remove previously added question lines from result
        result.length = Math.max(0, result.length - (i - qStart));

        const sep = isReversed ? ":::" : "::";
        result.push(`${qLines.join(" ")}${sep}${aLines.join(" ")}`);
        i = aEnd;
        continue;
      }
    }

    result.push(lines[i]);
    i++;
  }

  return result;
}

/**
 * Applies SR multi-line block merging to raw note text.
 *
 * This is the entry point used by the sync engine BEFORE parsing so the
 * line indices in parsed cards match the text that will be edited.
 *
 * Returns the processed text (with multi-line blocks replaced by :: / :::
 * shorthand), or the original text if no blocks were merged.
 */
export function preprocessSrText(
  text: string,
  ignoreFences: boolean,
  isHeaderLine: (line: string) => boolean,
): string {
  const lines = text.split(/\r?\n/);
  const fenceMask = ignoreFences
    ? computeFenceMaskForMerge(lines)
    : new Array<boolean>(lines.length).fill(false);

  const merged = mergeSrMultilineBlocks(lines, fenceMask, isHeaderLine);

  // Only join if lines changed
  if (merged.length === lines.length) return text;
  return merged.join("\n");
}

/**
 * Lightweight fence-mask computer for pre-processing.
 * Mirrors the parser's computeFenceMask but avoids a circular dependency.
 */
function computeFenceMaskForMerge(lines: string[]): boolean[] {
  const inside: boolean[] = new Array<boolean>(lines.length).fill(false);
  let inFence = false;
  let token: "```" | "~~~" | null = null;

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trimStart();
    const isBack = t.startsWith("```");
    const isTilde = t.startsWith("~~~");

    if (!inFence && (isBack || isTilde)) {
      inFence = true;
      token = isBack ? "```" : "~~~";
      inside[i] = true;
      continue;
    }

    if (inFence) {
      inside[i] = true;
      if (token && t.startsWith(token)) {
        inFence = false;
        token = null;
      }
    }
  }

  return inside;
}

// ── Field formatting (write-side) ───────────────────────────────────

/**
 * Push a key-value field to a delimited card block.
 * Handles single-line (`KEY <d> value <d>`) and multi-line formatting.
 */
export function pushDelimitedField(out: string[], key: string, value: string) {
  const d = _delim;
  const raw = String(value ?? "");
  const lines = raw.split(/\r?\n/);
  const startsWithListMarker = (line: string): boolean => /^\s*(?:[-+*]|\d+[.)])\s+/.test(String(line ?? ""));
  if (lines.length === 0) {
    out.push(`${key} ${d} ${d}`);
    return;
  }
  if (lines.length === 1 && !startsWithListMarker(lines[0])) {
    out.push(`${key} ${d} ${escapeDelimiterText(lines[0])} ${d}`);
    return;
  }

  if (startsWithListMarker(lines[0])) {
    out.push(`${key} ${d}`);
    for (let i = 0; i < lines.length - 1; i++) out.push(escapeDelimiterText(lines[i]));
    out.push(`${escapeDelimiterText(lines[lines.length - 1])} ${d}`);
    return;
  }

  out.push(`${key} ${d} ${escapeDelimiterText(lines[0])}`);
  for (let i = 1; i < lines.length - 1; i++) out.push(escapeDelimiterText(lines[i]));
  out.push(`${escapeDelimiterText(lines[lines.length - 1])} ${d}`);
}

/**
 * Format a single delimited field. Multi-line values are split across
 * multiple output lines (the closing delimiter is on the last line).
 * Used by modal-utils.
 */
export function formatDelimitedField(key: string, value: string): string[] {
  const d = _delim;
  const raw = String(value ?? "");
  const parts = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const startsWithListMarker = (line: string): boolean => /^\s*(?:[-+*]|\d+[.)])\s+/.test(String(line ?? ""));

  if (parts.length <= 1 && !startsWithListMarker(parts[0] ?? "")) {
    return [`${key} ${d} ${escapeDelimiterText(parts[0] ?? "")} ${d}`];
  }

  if (startsWithListMarker(parts[0] ?? "")) {
    const out: string[] = [];
    out.push(`${key} ${d}`);
    for (let i = 0; i < parts.length - 1; i++) out.push(escapeDelimiterText(parts[i] ?? ""));
    out.push(`${escapeDelimiterText(parts[parts.length - 1] ?? "")} ${d}`);
    return out;
  }

  const out: string[] = [];
  out.push(`${key} ${d} ${escapeDelimiterText(parts[0] ?? "")}`);
  for (let i = 1; i < parts.length - 1; i++) out.push(escapeDelimiterText(parts[i] ?? ""));
  out.push(`${escapeDelimiterText(parts[parts.length - 1] ?? "")} ${d}`);
  return out;
}

// ── Combo card variant delimiter ────────────────────────────────────

/**
 * Delimiter used to separate question/answer variants inside QX and AX fields
 * of combo (Cartesian product) cards.
 *
 * Uses `::` (double colon) rather than `||` to avoid escaping conflicts with
 * the pipe-delimited card format.
 */
export const COMBO_VARIANT_SEPARATOR = " :: ";

/**
 * Delimiter used to separate question/answer variants inside QX and AX fields
 * of combo (sequential/zip) cards.
 *
 * Uses `:::` (triple colon) inside field pipes. Note: the bare-line `:::` shorthand
 * syntax (e.g. `Question:::Answer`) is parsed before field content is read and
 * therefore does not conflict.
 */
export const COMBO_ZIP_SEPARATOR = " ::: ";

/**
 * Splits a raw QX/AX field value into individual Cartesian product variants.
 * Supports both the current `::` delimiter and the legacy `||` delimiter
 * for backward compatibility with cards written by older plugin versions.
 *
 * Note: uses negative lookaheads to avoid matching `::` inside `:::`.
 */
export function splitComboVariants(raw: string): string[] {
  // Split on :: (not preceded or followed by another :) or legacy ||
  return String(raw ?? "")
    .split(/(?<!:)::(?!:)|\s*\|\|\s*/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * Splits a raw QX/AX field value into sequential (zip) variants.
 * Uses `:::` (triple colon) as the separator.
 * Q and A variant counts must be equal for a valid zip combo card.
 */
export function splitZipVariants(raw: string): string[] {
  return String(raw ?? "")
    .split(/\s*:::\s*/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}
