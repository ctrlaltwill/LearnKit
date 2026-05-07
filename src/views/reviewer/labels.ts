/**
 * @file src/reviewer/labels.ts
 * @summary Provides human-readable display labels for card types and learning stages used throughout the reviewer UI.
 *
 * @exports
 *   - typeLabel — Returns a display-friendly label for a card type string (e.g. "basic" → "Basic", "mcq" → "MCQ")
 *   - stageLabel — Returns a display-friendly label for a card stage string (e.g. "new" → "New", "relearning" → "Relearning")
 */

export function typeLabel(t: string): string {
  if (t === "basic") return "Basic";
  if (t === "reversed" || t === "reversed-child") return "Basic (Reversed)";
  if (t === "mcq") return "Multiple choice";
  if (t === "cloze" || t === "cloze-child") return "Cloze";
  if (t === "io-child") return "Image occlusion";
  if (t === "oq") return "Ordered question";
  return t;
}

export function stageLabel(s: string): string {
  if (s === "new") return "New";
  if (s === "learning") return "Learning";
  if (s === "relearning") return "Relearning";
  if (s === "review") return "Review";
  if (s === "suspended") return "Suspended";
  return s;
}

/** Translated variant for use in UI contexts where a `tx` function is available. */
export function stageLabelTx(
  tx: (token: string, fallback: string) => string,
  s: string,
): string {
  if (s === "new") return tx("ui.common.stage.new", "New");
  if (s === "learning") return tx("ui.common.stage.learning", "Learning");
  if (s === "relearning") return tx("ui.common.stage.relearning", "Relearning");
  if (s === "review") return tx("ui.common.stage.review", "Review");
  if (s === "suspended") return tx("ui.common.stage.suspended", "Suspended");
  return s;
}
