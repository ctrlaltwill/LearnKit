/**
 * @file src/reviewer/markdown-block.ts
 * @summary Provides functions for locating and rewriting card blocks within Markdown note files. Identifies card boundaries by anchor markers (^sprout-ID), and can rebuild a card's Markdown representation from a CardRecord in pipe-delimited format.
 *
 * @exports
 *   - isMarkerLine — Tests whether a line is a card anchor (^sprout-...) or ID comment marker
 *   - findCardBlockRangeById — Locates the start and end line indices of a card block in a lines array by card ID; detects pipe-delimited field boundaries to avoid truncating non-card content after the last card
 *   - buildCardBlockMarkdown — Generates an array of Markdown lines representing a card in canonical pipe-delimited format
 */

import { getCorrectIndices, type CardRecord } from "../../platform/core/store";
import { normalizeGroups } from "../../engine/indexing/group-format";
import {
  CARD_ANCHOR_LINE_RE,
  buildPrimaryCardAnchor,
  extractCardAnchorId,
} from "../../platform/core/identity";
import { escapePipes } from "./fields";
import { COMBO_VARIANT_SEPARATOR } from "../../platform/core/delimiter";

/**
 * Canonical marker is ONLY ^sprout-#########.
 * Do NOT write <!--ID:...--> comments (they create duplication and mismatch with sync logic).
 */
const ID_COMMENT_RE = /^<!--ID:(\d{9})-->$/;
const ANCHOR_LINE_RE = CARD_ANCHOR_LINE_RE;

export function isMarkerLine(line: string): boolean {
  const t = (line || "").trim();
  return ID_COMMENT_RE.test(t) || ANCHOR_LINE_RE.test(t);
}

// ── Pipe-field helpers for block-boundary detection ───────

/** Matches a pipe-delimited field start: "KEY | ..." */
const FIELD_START_RE = /^([A-Za-z0-9]+)\s+\|\s?(.*)$/;

/** True if the trimmed line ends with a raw (unescaped) pipe delimiter. */
function endsWithPipe(line: string): boolean {
  return /\|\s*$/.test(line.trim());
}

/**
 * Find the full block for a card by id, robust to blank lines inside the block.
 * Strategy:
 * - Locate by ^sprout-id first; fall back to <!--ID:id--> if needed.
 * - Expand start upward to include adjacent marker duplicates (and blanks between marker lines).
 * - Scan downward; once we've seen any non-marker content, the next marker line starts the
 *   next card. If no marker follows, stop when pipe-delimited fields end and non-card prose
 *   begins — this prevents truncation of content after the last card in a file.
 */
export function findCardBlockRangeById(lines: string[], id: string): { start: number; end: number } {
  const idLine = `<!--ID:${id}-->`;

  let start = lines.findIndex((l) => extractCardAnchorId(l || "") === id);

  if (start === -1) {
    start = lines.findIndex((l) => (l || "").trim() === idLine);
    if (start === -1) throw new Error(`Could not locate card ${id} in note.`);
  }

  // Expand upward to include marker stacks (and blanks between marker lines)
  let s = start;
  while (s > 0) {
    const prev = (lines[s - 1] || "").trim();

    if (isMarkerLine(prev)) {
      s--;
      continue;
    }

    // allow blanks that are "inside" a marker stack (blank preceded by a marker)
    if (prev === "" && s - 2 >= 0 && isMarkerLine(lines[s - 2] || "")) {
      s--;
      continue;
    }

    break;
  }
  start = s;

  // Scan downward to find the end of the card block. Tracks multi-line
  // pipe field state so continuation lines (e.g. second line of a multi-line
  // answer) are not mistaken for non-card prose.
  let seenContent = false;
  let inMultiline = false;
  let end = lines.length;

  for (let i = start; i < lines.length; i++) {
    const t = (lines[i] || "").trim();

    // ── before we've seen any card content ──
    if (!seenContent) {
      if (t === "" || isMarkerLine(t)) continue;
      seenContent = true;
      const fm = t.match(FIELD_START_RE);
      if (fm) {
        const rest = fm[2];
        // "KEY |" alone (value on next line) or "KEY | value" (no closing pipe)
        // both open a multi-line field.
        if (rest === "" || !endsWithPipe(rest)) inMultiline = true;
      }
      continue;
    }

    // ── stop at the next card marker ──
    if (isMarkerLine(t)) {
      end = i;
      break;
    }

    // ── SR schedule comment belongs to the card block ──
    if (/^<!--SR:/.test(t)) continue;

    // ── blank lines are fine within a card block ──
    if (t === "") continue;

    // ── inside a multi-line pipe field? ──
    if (inMultiline) {
      if (endsWithPipe(t)) inMultiline = false;
      continue;
    }

    // ── starts a new pipe field? ──
    const fm = t.match(FIELD_START_RE);
    if (fm) {
      const rest = fm[2];
      if (rest === "" || !endsWithPipe(rest)) inMultiline = true;
      continue;
    }

    // ── anything else is non-card content → end of block ──
    end = i;
    break;
  }

  return { start, end };
}

export function buildCardBlockMarkdown(id: string, rec: CardRecord): string[] {
  const out: string[] = [];

  // Canonical marker only
  out.push(buildPrimaryCardAnchor(id));

  const startsWithListMarker = (line: string): boolean => /^\s*(?:[-+*]|\d+[.)])\s+/.test(String(line ?? ''));

  const pushPipeField = (key: string, value: string) => {
    const raw = String(value ?? "");
    const lines = raw.split(/\r?\n/);
    if (lines.length === 0) {
      out.push(`${key} | |`);
      return;
    }
    if (lines.length === 1 && !startsWithListMarker(lines[0])) {
      out.push(`${key} | ${escapePipes(lines[0])} |`);
      return;
    }

    const startOnNewLine = startsWithListMarker(lines[0]);
    if (startOnNewLine) {
      out.push(`${key} |`);
      for (let i = 0; i < lines.length - 1; i++) out.push(escapePipes(lines[i]));
      out.push(`${escapePipes(lines[lines.length - 1])} |`);
      return;
    }

    out.push(`${key} | ${escapePipes(lines[0])}`);
    for (let i = 1; i < lines.length - 1; i++) out.push(escapePipes(lines[i]));
    out.push(`${escapePipes(lines[lines.length - 1])} |`);
  };

  const title = (rec.title || "").trim();
  if (title) pushPipeField("T", title);

  if (rec.type === "basic" || rec.type === "reversed") {
    pushPipeField(rec.type === "reversed" ? "RQ" : "Q", (rec.q || "").trim());
    pushPipeField("A", (rec.a || "").trim());
  } else if (rec.type === "cloze") {
    pushPipeField("CQ", (rec.clozeText || "").trim());
  } else if (rec.type === "mcq") {
    pushPipeField("MCQ", (rec.stem || "").trim());

    const options = Array.isArray(rec.options) ? rec.options : [];
    const correctSet = new Set(getCorrectIndices(rec));

    options.forEach((opt, idx) => {
      const txt = (opt || "").trim();
      if (!txt) return;
      if (correctSet.has(idx)) pushPipeField("A", txt);
      else pushPipeField("O", txt);
    });
  } else if (rec.type === "combo") {
    // Write combo as basic Q/A with :: variant separator.
    const ext = (rec.extensionData ?? {});
    const qVariants: string[] = Array.isArray(ext.qVariants) ? ext.qVariants as string[] : [];
    const aVariants: string[] = Array.isArray(ext.aVariants) ? ext.aVariants as string[] : [];
    if (qVariants.length) pushPipeField("Q", qVariants.join(COMBO_VARIANT_SEPARATOR));
    if (aVariants.length) pushPipeField("A", aVariants.join(COMBO_VARIANT_SEPARATOR));
  }

  const info = (rec.info || "").trim();
  if (info) pushPipeField("I", info);

  // Preserve groups (always last)
  const groups = normalizeGroups(rec.groups);
  if (groups.length) pushPipeField("G", groups.join(", "));

  out.push(""); // blank line terminator
  return out;
}
