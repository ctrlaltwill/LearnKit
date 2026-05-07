/**
 * @file src/reviewer/labels.ts
 * @summary Provides human-readable display labels for card types and learning stages used throughout the reviewer UI.
 *
 * @exports
 *   - typeLabel — Returns a display-friendly label for a card type string (e.g. "basic" → "Basic", "mcq" → "MCQ")
 *   - typeLabelTx — Returns a translated display label for a card type string when a tx function is available
 *   - stageLabel — Returns a display-friendly label for a card stage string (e.g. "new" → "New", "relearning" → "Relearning")
 */

export function typeLabel(t: string): string {
  return typeLabelTx((_token, fallback) => fallback, t);
}

/** Translated variant for use in UI contexts where a `tx` function is available. */
export function typeLabelTx(
  tx: (token: string, fallback: string) => string,
  t: string,
): string {
  if (t === "basic") return tx("ui.common.basic", "Basic");
  if (t === "reversed" || t === "reversed-child") return tx("ui.common.basicReversed", "Basic (Reversed)");
  if (t === "mcq") return tx("ui.common.multipleChoice", "Multiple choice");
  if (t === "cloze" || t === "cloze-child") return tx("ui.common.cloze", "Cloze");
  if (t === "io-child") return tx("ui.common.imageOcclusion", "Image occlusion");
  if (t === "oq") return tx("ui.common.orderedQuestion", "Ordered question");
  return t;
}

export function stageLabel(s: string): string {
  return stageLabelTx((_token, fallback) => fallback, s);
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
