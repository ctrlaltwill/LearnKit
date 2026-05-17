/**
 * PostCSS plugin: deduplicate CSS properties within each rule.
 * When the same property appears multiple times in a rule,
 * keep only the last occurrence (standard CSS cascade behavior).
 */
module.exports = () => {
  return {
    postcssPlugin: "postcss-dedupe-properties",

    Rule(rule) {
      const seen = new Map();
      rule.walkDecls((decl) => {
        const key = decl.prop + (decl.important ? "!important" : "");
        if (seen.has(key)) {
          // Keep the later value, remove earlier one
          seen.get(key).remove();
        }
        seen.set(key, decl);
      });
    },
  };
};

module.exports.postcss = true;
