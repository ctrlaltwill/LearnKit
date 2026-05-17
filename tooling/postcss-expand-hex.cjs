/**
 * PostCSS plugin: expand 3-digit hex (#RGB) to 6-digit (#RRGGBB).
 * Runs on every declaration value in the stylesheet.
 */
module.exports = () => {
  const HEX_RE = /#([0-9a-fA-F]{3})(?![0-9a-fA-F])/g;

  return {
    postcssPlugin: "postcss-expand-hex",

    Declaration(decl) {
      const updated = decl.value.replace(HEX_RE, (_, hex) => {
        const [r, g, b] = hex;
        return `#${r}${r}${g}${g}${b}${b}`;
      });

      if (updated !== decl.value) {
        decl.value = updated;
      }
    },
  };
};

module.exports.postcss = true;
