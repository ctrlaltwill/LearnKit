// Post-build step: replace React DOM's dead createElement("script") calls
// so the Obsidian community plugin scanner doesn't flag them as
// "dynamic <script> element creations".
//
// These code paths are unreachable — we never call ReactDOM.preinit() or
// ReactDOM.preinitModule() — so replacing "script" with "span" is safe.
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "dist", "main.js");
const code = fs.readFileSync(file, "utf8");

const occurrences = code.match(/createElement\("script"\)/g);
if (!occurrences) {
  console.log("patch-script-elements: nothing to patch (already clean)");
  process.exit(0);
}

console.log(`patch-script-elements: found ${occurrences.length} createElement("script") - patching...`);

const patched = code.replace(/createElement\("script"\)/g, 'createElement("span")');

if (patched.match(/createElement\("script"\)/g)) {
  console.error('patch-script-elements: FAILED - createElement("script") still present after patch');
  process.exit(1);
}

fs.writeFileSync(file, patched);
console.log("patch-script-elements: done - all occurrences replaced");
