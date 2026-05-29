const prefixer = require("postcss-prefix-selector");
const expandHex = require("./postcss-expand-hex.cjs");
const stripHas = require("./postcss-strip-has.cjs");
const dedupeSelectors = require("./postcss-dedupe-selectors.cjs");
const dedupeProperties = require("./postcss-dedupe-properties.cjs");

const stripTextDecoration = () => {
  const token = "text-decoration-color";

  const stripTokenFromList = (value) => {
    const items = value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

    return items.filter((part) => part !== token).join(", ");
  };

  return {
    postcssPlugin: "postcss-strip-text-decoration",

    Declaration(decl) {
      const prop = (decl.prop || "").toLowerCase();

      if (prop === "text-underline-offset" || prop.startsWith("text-decoration")) {
        decl.remove();
        return;
      }

      if (prop === "transition-property" && (decl.value || "").includes(token)) {
        const nextValue = stripTokenFromList(decl.value);
        if (!nextValue) {
          decl.remove();
        } else {
          decl.value = nextValue;
        }
      }
    },

    Rule(rule) {
      if (!rule.nodes || rule.nodes.length === 0) {
        rule.remove();
      }
    },
  };
};

module.exports = {
  plugins: [
    prefixer({
      prefix: ".learnkit",
      transform(prefix, selector) {
        if (!selector) return selector;
        if (selector.startsWith("@")) return selector;

        // Leave global roots alone
        if (selector.startsWith(":root") || selector.startsWith("html") || selector.startsWith("body")) {
          return selector;
        }

        // Already scoped
        if (selector.includes(".learnkit")) return selector;

        // Scope by ancestor
        return `${prefix} ${selector}`;
      },
    }),
    expandHex(),
    stripHas(),
    stripTextDecoration(),
    dedupeProperties(),
    dedupeSelectors(),
  ],
};
