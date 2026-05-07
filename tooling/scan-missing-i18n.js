const fs = require("fs");
const path = require("path");

// Read en-base.json
const en = JSON.parse(fs.readFileSync("src/platform/translations/locales/en-base.json", "utf-8"));

// All source files to scan
const srcFiles = [
  "src/views/settings/settings-tab.ts",
  "src/views/settings/settings-view.ts",
];

const patterns = [
  // _tx("token" or _tx("token", "fallback")
  /[\.\s]_tx\(\s*"([^"]+)"\s*(?:,\s*"([^"]+)")?/g,
  // t(locale, "token" or t(locale, "token", "fallback")
  /[\.\s]t\(\s*\w+\s*,\s*"([^"]+)"\s*(?:,\s*"([^"]+)")?/g,
];

const allInCode = new Map(); // token -> { file, line, fallback }
const missing = [];

for (const file of srcFiles) {
  if (!fs.existsSync(file)) continue;
  const content = fs.readFileSync(file, "utf-8");
  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(content)) !== null) {
      const token = m[1];
      const fallback = m[2] || null;
      if (token.startsWith("ui.")) {
        if (!allInCode.has(token)) {
          allInCode.set(token, { file, fallback });
        }
      }
    }
  }
}

// Check which are missing
for (const [token, info] of allInCode) {
  if (!(token in en)) {
    missing.push({ token, ...info });
  }
}

if (missing.length === 0) {
  console.log("ALL TOKENS PRESENT IN en-base.json");
} else {
  console.log(`MISSING ${missing.length} tokens from en-base.json:\n`);
  for (const m of missing) {
    console.log(`  ${m.token}`);
    if (m.fallback) console.log(`    fallback: "${m.fallback}"`);
    console.log(`    in: ${m.file}`);
  }
}
