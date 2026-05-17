/**
 * PostCSS plugin: expand shorthand hex to full notation.
 * 3-digit #RGB → #RRGGBB
 * 4-digit #RGBA → #RRGGBBAA
 * Runs on every declaration value in the stylesheet.
 */
module.exports = () => {
  const HEX_RE = /#([0-9a-fA-F]{3,4})(?![0-9a-fA-F])/g;

  return {
    postcssPlugin: "postcss-expand-hex",

    Declaration(decl) {
      const updated = decl.value.replace(HEX_RE, (_, hex) => {
        if (hex.length === 3) {
          const [r, g, b] = hex;
          return `#${r}${r}${g}${g}${b}${b}`;
        }
        // 4-digit: #RGBA → #RRGGBBAA
        const [r, g, b, a] = hex;
        return `#${r}${r}${g}${g}${b}${b}${a}${a}`;
      });

      if (updated !== decl.value) {
        decl.value = updated;
      }
    },
  };
};

module.exports.postcss = true;
