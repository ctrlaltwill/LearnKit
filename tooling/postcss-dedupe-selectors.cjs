/**
 * PostCSS plugin: deduplicate identical selectors within the same parent scope.
 *
 * Groups child Rules within each container (root, @layer, @media, @supports,
 * @starting-style) by normalized selector text and merges all declarations
 * into the first occurrence. Duplicate properties keep the last value (CSS
 * cascade).
 *
 * Selector text is NEVER modified — only compared after normalization.
 *
 * Place this LAST in the plugin chain (after prefixing, after hex expansion).
 */

/**
 * Normalize a selector for comparison only.
 * Splits by comma, trims each part, sorts alphabetically.
 */
function normalizeForComparison(selector) {
  return selector
    .split(",")
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .sort()
    .join(",");
}

/**
 * Merge declarations from source rule into target rule.
 * Duplicate properties keep the source (later) value.
 */
function mergeDeclarations(targetRule, sourceRule) {
  const existing = new Map();
  targetRule.walkDecls((decl) => {
    existing.set(decl.prop, decl);
  });

  sourceRule.walkDecls((decl) => {
    if (existing.has(decl.prop)) {
      existing.get(decl.prop).value = decl.value;
      if (decl.important) {
        existing.get(decl.prop).important = true;
      }
    } else {
      targetRule.append(decl.clone());
    }
  });
}

/**
 * Deduplicate rules within a container.
 * Selectors are compared only; original text is preserved.
 */
function dedupeRulesInContainer(container) {
  const rules = [];
  container.each((node) => {
    if (node.type === "rule") {
      rules.push(node);
    }
  });

  if (rules.length < 2) return 0;

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
    const first = group[0];
    for (let i = 1; i < group.length; i++) {
      mergeDeclarations(first, group[i]);
      group[i].remove();
      removed++;
    }
  }

  return removed;
}

module.exports = () => {
  return {
    postcssPlugin: "postcss-dedupe-selectors",

    Once(root) {
      let totalRemoved = 0;

      // Root-level rules
      totalRemoved += dedupeRulesInContainer(root);

      // @layer, @media, @supports, and @starting-style blocks
      root.walkAtRules((atRule) => {
        const name = atRule.name.toLowerCase();
        if (
          name === "layer" ||
          name === "media" ||
          name === "supports" ||
          name === "starting-style"
        ) {
          totalRemoved += dedupeRulesInContainer(atRule);
        }
      });

      if (totalRemoved > 0) {
        const file =
          (root.source && root.source.input && root.source.input.file) ||
          "unknown";
        console.log(
          `[postcss-dedupe-selectors] Removed ${totalRemoved} duplicate selector(s) from ${file}`
        );
      }
    },
  };
};

module.exports.postcss = true;
