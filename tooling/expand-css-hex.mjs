#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";

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

async function expandHexInFile(filePath) {
  const css = await fs.readFile(filePath, "utf8");
  const root = postcss.parse(css, { from: filePath });
  let replacements = 0;

  root.walkDecls((decl) => {
    const updated = decl.value.replace(/#([0-9a-fA-F]{3})(?![0-9a-fA-F])/g, (_, hex) => {
      const [r, g, b] = hex;
      replacements += 1;
      return `#${r}${r}${g}${g}${b}${b}`;
    });

    if (updated !== decl.value) {
      decl.value = updated;
    }
  });

  if (replacements === 0) {
    return { filePath, replacements: 0, changed: false };
  }

  await fs.writeFile(filePath, root.toResult().css, "utf8");
  return { filePath, replacements, changed: true };
}

async function main() {
  const inputPaths = process.argv.slice(2);

  if (inputPaths.length === 0) {
    console.error("Usage: node tooling/expand-css-hex.mjs <file-or-directory> [more-paths...]");
    process.exit(1);
  }

  const allFiles = new Set();
  for (const inputPath of inputPaths) {
    const cssFiles = await collectCssFiles(inputPath);
    for (const cssFile of cssFiles) {
      allFiles.add(cssFile);
    }
  }

  const results = await Promise.all([...allFiles].map((filePath) => expandHexInFile(filePath)));
  const changedFiles = results.filter((result) => result.changed);
  const totalReplacements = results.reduce((sum, result) => sum + result.replacements, 0);

  if (changedFiles.length > 0) {
    console.log(`Expanded ${totalReplacements} shorthand hex values in ${changedFiles.length} file(s).`);
  } else {
    console.log("No shorthand hex values found.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
