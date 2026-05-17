/**
 * PostCSS plugin: remove rules whose selector contains :has().
 *
 * :has() can cause significant performance issues in Obsidian due to
 * broad selector invalidation. This plugin strips those rules entirely.
 *
 * Place AFTER prefixer and BEFORE deduplication for best results.
 */
module.exports = () => {
  const HAS_RE = /:has\(/;

  return {
    postcssPlugin: "postcss-strip-has",

    Rule(rule) {
      if (HAS_RE.test(rule.selector)) {
        rule.remove();
      }
    },
  };
};

module.exports.postcss = true;
