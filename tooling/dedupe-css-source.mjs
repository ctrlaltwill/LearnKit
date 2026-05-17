#!/usr/bin/env node

/**
 * Deduplicate identical CSS selectors within the same parent scope.
 *
 * Operates on source CSS files in-place. For each parent container
 * (root, @media, @supports):
 *  1. Removes duplicate selector parts within a single comma-separated
 *     list (e.g. ".a,\n.a { }" → ".a { }"). Bracket-aware: commas
 *     inside ( ) or [ ] are preserved.
 *  2. Groups child Rules by normalized selector text — normalizing
 *     class-name order within compound selectors so ".a.b" matches
 *     ".b.a" — and merges all declarations into the first occurrence.
 *
 * Usage:
 *   node tooling/dedupe-css-source.mjs src/platform/styles
 *   node tooling/dedupe-css-source.mjs file1.css file2.css
 */

import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Split a CSS selector by top-level commas (bracket-aware).
 * Commas inside ( ) or [ ] are NOT treated as separators.
 */
function splitSelectorParts(selector) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of selector) {
    if (ch === "(" || ch === "[") {
      depth++;
      current += ch;
    } else if (ch === ")" || ch === "]") {
      depth--;
      current += ch;
    } else if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  const last = current.trim();
  if (last) parts.push(last);
  return parts;
}

/**
 * Normalize a single selector part by collapsing whitespace.
 */
function normalizePart(part) {
  return part.trim().replace(/\s+/g, " ");
}

/**
 * Deep-normalize a selector part for cross-rule comparison:
 * sorts class-name tokens within compound selectors so ".a.b" matches ".b.a"
 * and ".foo.bar.qux" matches ".qux.foo.bar".
 *
 * Splits each space-delimited token by "." boundaries so compound class
 * chains like ".learnkit.learnkit-widget" are decomposed into individual
 * class names, sorted, and rejoined.  Tokens that contain pseudo-classes,
 * IDs, or attribute selectors are left in place to avoid reordering
 * side-effects (only pure class chains are normalized).
 */
function normalizePartDeep(part) {
  const trimmed = part.trim().replace(/\s+/g, " ");
  const tokens = trimmed.split(/\s+/);
  const result = [];
  for (const token of tokens) {
    // Only normalize pure class chains: start with ".", no : # [ ] etc.
    if (/^\.[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)*$/.test(token)) {
      const classes = token
        .split(".")
        .filter(Boolean)
        .sort();
      result.push("." + classes.join("."));
    } else {
      result.push(token);
    }
  }
  return result.join(" ");
}

/**
 * Normalize a full selector for comparison.
 * Splits by top-level commas, deep-normalizes each part, sorts alphabetically.
 * Identical selectors produce identical keys regardless of whitespace,
 * comma order, or class-name order within compound selectors.
 */
function normalizeForComparison(selector) {
  return splitSelectorParts(selector)
    .map(normalizePartDeep)
    .filter(Boolean)
    .sort()
    .join(",");
}

/**
 * Deduplicate parts within a single selector string.
 * Removes duplicate parts (after trimming/collapsing whitespace)
 * while preserving the first occurrence's original formatting.
 * Bracket-aware: commas inside ( ) or [ ] are left alone.
 */
function dedupeSelectorText(selector) {
  const parts = splitSelectorParts(selector);
  if (parts.length < 2) return { selector, changed: false };

  const seen = new Set();
  const unique = [];
  let changed = false;

  for (const part of parts) {
    const norm = normalizePart(part);
    if (!norm) continue;
    if (seen.has(norm)) {
      changed = true;
      continue;
    }
    seen.add(norm);
    unique.push(part); // keep original formatting of first occurrence
  }

  return { selector: unique.join(",\n"), changed };
}

/**
 * Collect all child Rule nodes from a container (root or AtRule).
 * Only processes children of the given container, not nested containers.
 */
function getChildRules(container) {
  const rules = [];
  container.each((node) => {
    if (node.type === "rule") {
      rules.push(node);
    }
  });
  return rules;
}

/**
 * Merge declarations from source rule into target rule.
 * Duplicate properties keep the source (later) value.
 * Appends to target; source is left intact.
 */
function mergeDeclarations(targetRule, sourceRule) {
  // Build a map of existing properties in target
  const existing = new Map();
  targetRule.walkDecls((decl) => {
    existing.set(decl.prop, decl);
  });

  // Walk source declarations
  sourceRule.walkDecls((decl) => {
    if (existing.has(decl.prop)) {
      // Overwrite existing — keep source value (later in cascade)
      existing.get(decl.prop).value = decl.value;
      // Also copy important flag if present
      if (decl.important) {
        existing.get(decl.prop).important = true;
      }
    } else {
      // Append new declaration
      targetRule.append(decl.clone());
    }
  });
}

/**
 * Process child rules of a container:
 *  - Deduplicate within each rule's own selector text (intra-selector)
 *  - Group rules with identical normalized selectors and merge declarations
 * Returns the number of duplicate rules removed.
 */
function dedupeRulesInContainer(container) {
  const rules = getChildRules(container);
  if (rules.length === 0) return 0;

  // Step 1: intra-selector dedup — remove duplicate parts within each rule
  for (const rule of rules) {
    const { selector, changed } = dedupeSelectorText(rule.selector);
    if (changed) {
      rule.selector = selector;
    }
  }

  // Step 2: group by normalized selector (class-order-normalized)
  const groups = new Map();

  for (const rule of rules) {
    const key = normalizeForComparison(rule.selector);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(rule);
  }

  let removed = 0;

  for (const [, group] of groups) {
    if (group.length < 2) continue;

    // Merge all into the first occurrence (keeping its original selector text)
    const first = group[0];
    for (let i = 1; i < group.length; i++) {
      mergeDeclarations(first, group[i]);
      group[i].remove();
      removed++;
    }
  }

  return removed;
}

/**
 * Recursively walk a PostCSS node tree and deduplicate rules within
 * every container that can hold sibling rules (root, @media, @supports).
 */
function dedupeAllContainers(root) {
  let totalRemoved = 0;

  // Process root-level rules
  totalRemoved += dedupeRulesInContainer(root);

  // Process @media and @supports blocks
  root.walkAtRules((atRule) => {
    const name = atRule.name.toLowerCase();
    if (name === "media" || name === "supports") {
      totalRemoved += dedupeRulesInContainer(atRule);
    }
    // Also recurse into nested @ rules inside @supports with @media etc.
    // PostCSS walkAtRules is already recursive, so nested at-rules are covered.
  });

  return totalRemoved;
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

async function dedupeFile(filePath) {
  const css = await fs.readFile(filePath, "utf8");
  const root = postcss.parse(css, { from: filePath });

  const removed = dedupeAllContainers(root);

  if (removed === 0) {
    return { filePath, removed, changed: false };
  }

  const result = root.toResult();
  await fs.writeFile(filePath, result.css, "utf8");
  return { filePath, removed, changed: true };
}

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

async function collectCssFiles(inputPath) {
  const stat = await fs.stat(inputPath);

  if (stat.isFile()) {
    return inputPath.endsWith(".css") ? [inputPath] : [];
  }

  if (!stat.isDirectory()) {
    return [];
  }

  const entries = await fs.readdir(inputPath, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => collectCssFiles(path.join(inputPath, entry.name)))
  );
  return nested.flat();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const inputPaths = process.argv.slice(2);

  if (inputPaths.length === 0) {
    console.error(
      "Usage: node tooling/dedupe-css-source.mjs <file-or-directory> [more-paths...]"
    );
    process.exit(1);
  }

  const allFiles = new Set();
  for (const inputPath of inputPaths) {
    const cssFiles = await collectCssFiles(inputPath);
    for (const cssFile of cssFiles) {
      allFiles.add(cssFile);
    }
  }

  const results = await Promise.all(
    [...allFiles].map((filePath) => dedupeFile(filePath))
  );
  const changedFiles = results.filter((r) => r.changed);
  const totalRemoved = results.reduce((sum, r) => sum + r.removed, 0);

  if (changedFiles.length > 0) {
    console.log(
      `Removed ${totalRemoved} duplicate rule(s) across ${changedFiles.length} file(s):`
    );
    for (const r of changedFiles) {
      console.log(`  ${r.filePath} — ${r.removed} duplicate(s) removed`);
    }
  } else {
    console.log("No duplicate selectors found.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
