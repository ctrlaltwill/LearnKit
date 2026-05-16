import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";

function usage() {
  console.error("Usage: node tooling/strip-css-restricted.mjs <css-file>");
}

const inputArg = process.argv[2];
if (!inputArg) {
  usage();
  process.exit(1);
}

const cssPath = path.resolve(process.cwd(), inputArg);
if (!fs.existsSync(cssPath)) {
  console.error(`CSS file not found: ${cssPath}`);
  process.exit(1);
}

const cssText = fs.readFileSync(cssPath, "utf8");
const root = postcss.parse(cssText, { from: cssPath });

root.walkDecls((decl) => {
  if (decl.important) decl.important = false;
});

root.walkRules((rule) => {
  if (rule.selector && rule.selector.includes(":has(")) {
    rule.remove();
  }
});

fs.writeFileSync(cssPath, root.toResult({ map: false }).css, "utf8");
console.log(`Stripped !important and :has rules from ${cssPath}`);
