/**
 * @file src/platform/core/contrast.ts
 * @summary Picks a legible foreground for a user-chosen accent colour.
 *
 *   LearnKit lets the user override the accent colour, and that override is a
 *   plain hex value, so nothing guarantees it can carry white text. Obsidian's
 *   own `--text-on-accent` only describes the theme's accent, not an arbitrary
 *   override, so the override needs its own foreground.
 *
 *   Used by the accent buttons in modals (#224), which previously hard-coded
 *   `#ffffff` and became unreadable on a pale accent.
 *
 * @exports
 *   - parseHexColour — `#rgb` / `#rrggbb` to RGB, or null when unparseable
 *   - onAccentForeground — the better of black / white against a hex colour
 */

export type Rgb = { r: number; g: number; b: number };

/** Parses `#rgb` or `#rrggbb` (case-insensitive). Returns null for anything else. */
export function parseHexColour(raw: unknown): Rgb | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(value);
  if (!match) return null;

  const hex = match[1];
  if (hex.length === 3) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    };
  }

  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

/** WCAG relative luminance, used only to decide black text or white text. */
function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (0.2126 * channel(r)) + (0.7152 * channel(g)) + (0.0722 * channel(b));
}

function contrastRatio(a: number, b: number): number {
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * `#000000` or `#ffffff`, whichever contrasts the given colour better.
 *
 * Returns `#ffffff` for unparseable input, which is the historical default and
 * the safer assumption for a dark accent.
 */
export function onAccentForeground(raw: unknown): "#000000" | "#ffffff" {
  const rgb = parseHexColour(raw);
  if (!rgb) return "#ffffff";

  const background = relativeLuminance(rgb);
  const againstWhite = contrastRatio(background, 1);
  const againstBlack = contrastRatio(background, 0);

  return againstBlack >= againstWhite ? "#000000" : "#ffffff";
}
