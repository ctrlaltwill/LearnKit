import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import postcss from "postcss";

const VALID_SCOPES = new Set(["source", "dist", "all"]);

function parseArgs(argv) {
  const options = {
    scope: "all",
    json: false,
    summary: false,
    includeSite: false,
    compact: false,
    top: 20,
    writePath: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--scope") {
      options.scope = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--summary") {
      options.summary = true;
      continue;
    }

    if (arg === "--include-site") {
      options.includeSite = true;
      continue;
    }

    if (arg === "--compact") {
      options.compact = true;
      continue;
    }

    if (arg === "--top") {
      const parsed = Number.parseInt(argv[index + 1] ?? "", 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.top = parsed;
      }
      index += 1;
      continue;
    }

    if (arg === "--write") {
      options.writePath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!VALID_SCOPES.has(options.scope)) {
    throw new Error(`Invalid --scope value: ${options.scope}`);
  }

  if (!options.summary && !options.json) {
    options.summary = true;
  }

  return options;
}

function printHelp() {
  const help = [
    "Usage: node tooling/css-audit.mjs [options]",
    "",
    "Options:",
    "  --scope <source|dist|all>  Which files to analyze (default: all)",
    "  --summary                  Print human-readable summary",
    "  --json                     Print JSON report",
    "  --compact                  Omit per-rule duplicate detail arrays in JSON",
    "  --write <path>             Write JSON report to a file",
    "  --include-site             Include site/src/styles/**/*.css in source scope",
    "  --top <number>             Number of top rows to print (default: 20)",
    "  --help                     Show this help"
  ];
  console.log(help.join("\n"));
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectCssFilesRecursively(directoryPath) {
  if (!(await exists(directoryPath))) {
    return [];
  }

  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const collected = [];

  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectCssFilesRecursively(fullPath);
      collected.push(...nested);
      continue;
    }
    if (entry.isFile() && fullPath.endsWith(".css")) {
      collected.push(fullPath);
    }
  }

  return collected.sort();
}

function countMatches(text, regex) {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

function toRelativePath(rootDir, absolutePath) {
  return path.relative(rootDir, absolutePath).replaceAll(path.sep, "/");
}

function sumCounts(items) {
  return items.reduce((accumulator, item) => accumulator + Math.max(0, item.count - 1), 0);
}

async function analyzeFile(rootDir, filePath) {
  const text = await fs.readFile(filePath, "utf8");
  const lineCount = text.length === 0 ? 0 : text.split(/\r?\n/).length;

  const result = {
    file: toRelativePath(rootDir, filePath),
    lineCount,
    importantCount: countMatches(text, /!important\b/g),
    hasCount: countMatches(text, /:has\s*\(/g),
    shortHexCount: countMatches(text, /#([0-9a-fA-F]{3})(?![0-9a-fA-F])/g),
    duplicateSelectorCount: 0,
    duplicatePropertyCount: 0,
    duplicateSelectors: [],
    duplicateProperties: [],
    parseError: null
  };

  try {
    const root = postcss.parse(text, { from: filePath });
    const selectorCounts = new Map();

    root.walkRules((rule) => {
      const selector = (rule.selector ?? "").trim();
      const selectorLine = rule.source?.start?.line ?? 0;

      if (selector) {
        const existingSelector = selectorCounts.get(selector);
        if (existingSelector) {
          existingSelector.count += 1;
        } else {
          selectorCounts.set(selector, { count: 1, line: selectorLine });
        }
      }

      const propertyCounts = new Map();
      rule.walkDecls((decl) => {
        const propertyName = decl.prop.toLowerCase();
        const existingProperty = propertyCounts.get(propertyName);
        const propertyLine = decl.source?.start?.line ?? selectorLine;
        if (existingProperty) {
          existingProperty.count += 1;
        } else {
          propertyCounts.set(propertyName, { count: 1, line: propertyLine });
        }
      });

      for (const [property, propertyInfo] of propertyCounts.entries()) {
        if (propertyInfo.count > 1) {
          result.duplicateProperties.push({
            selector: selector || "<anonymous>",
            property,
            count: propertyInfo.count,
            line: propertyInfo.line
          });
        }
      }
    });

    for (const [selector, selectorInfo] of selectorCounts.entries()) {
      if (selectorInfo.count > 1) {
        result.duplicateSelectors.push({
          selector,
          count: selectorInfo.count,
          line: selectorInfo.line
        });
      }
    }

    result.duplicateSelectorCount = sumCounts(result.duplicateSelectors);
    result.duplicatePropertyCount = sumCounts(result.duplicateProperties);
  } catch (error) {
    result.parseError = error instanceof Error ? error.message : String(error);
  }

  return result;
}

async function collectFiles(rootDir, options) {
  const sourceFiles = [];
  const distFiles = [];

  if (options.scope === "source" || options.scope === "all") {
    const platformStyles = await collectCssFilesRecursively(path.join(rootDir, "src", "platform", "styles"));
    sourceFiles.push(...platformStyles);

    const stylesEntrypoint = path.join(rootDir, "src", "styles.tailwind.css");
    if (await exists(stylesEntrypoint)) {
      sourceFiles.push(stylesEntrypoint);
    }

    if (options.includeSite) {
      const siteStyles = await collectCssFilesRecursively(path.join(rootDir, "site", "src", "styles"));
      sourceFiles.push(...siteStyles);
    }
  }

  if (options.scope === "dist" || options.scope === "all") {
    const distStylesPath = path.join(rootDir, "dist", "styles.css");
    if (await exists(distStylesPath)) {
      distFiles.push(distStylesPath);
    }
  }

  const uniqueFiles = new Set([...sourceFiles, ...distFiles]);
  return [...uniqueFiles].sort();
}

function buildReport(results, options) {
  const totals = {
    importantCount: 0,
    hasCount: 0,
    shortHexCount: 0,
    duplicateSelectorInstances: 0,
    duplicatePropertyInstances: 0,
    parseErrors: 0
  };

  for (const result of results) {
    totals.importantCount += result.importantCount;
    totals.hasCount += result.hasCount;
    totals.shortHexCount += result.shortHexCount;
    totals.duplicateSelectorInstances += result.duplicateSelectorCount;
    totals.duplicatePropertyInstances += result.duplicatePropertyCount;
    if (result.parseError) {
      totals.parseErrors += 1;
    }
  }

  const duplicateSelectors = results
    .flatMap((result) => result.duplicateSelectors.map((entry) => ({ file: result.file, ...entry })))
    .sort((left, right) => right.count - left.count || left.file.localeCompare(right.file));

  const duplicateProperties = results
    .flatMap((result) => result.duplicateProperties.map((entry) => ({ file: result.file, ...entry })))
    .sort((left, right) => right.count - left.count || left.file.localeCompare(right.file));

  const byFile = options.compact
    ? results.map((result) => ({
        file: result.file,
        lineCount: result.lineCount,
        importantCount: result.importantCount,
        hasCount: result.hasCount,
        shortHexCount: result.shortHexCount,
        duplicateSelectorCount: result.duplicateSelectorCount,
        duplicatePropertyCount: result.duplicatePropertyCount,
        parseError: result.parseError
      }))
    : results;

  return {
    generatedAt: new Date().toISOString(),
    scope: options.scope,
    includeSite: options.includeSite,
    compact: options.compact,
    filesAnalyzed: results.length,
    totals,
    byFile,
    topFindings: {
      duplicateSelectors: duplicateSelectors.slice(0, options.top),
      duplicateProperties: duplicateProperties.slice(0, options.top)
    }
  };
}

function formatCell(value, width) {
  const text = String(value);
  if (text.length >= width) {
    return text.slice(0, width - 1) + "~";
  }
  return text.padEnd(width, " ");
}

function printSummary(report, top) {
  console.log(`Scope: ${report.scope}`);
  console.log(`Files analyzed: ${report.filesAnalyzed}`);
  console.log(
    [
      `!important=${report.totals.importantCount}`,
      `:has=${report.totals.hasCount}`,
      `shortHex=${report.totals.shortHexCount}`,
      `dupSelectors=${report.totals.duplicateSelectorInstances}`,
      `dupProperties=${report.totals.duplicatePropertyInstances}`,
      `parseErrors=${report.totals.parseErrors}`
    ].join(" | ")
  );

  const scoredFiles = [...report.byFile]
    .map((entry) => ({
      ...entry,
      score:
        entry.importantCount +
        entry.hasCount +
        entry.shortHexCount +
        entry.duplicateSelectorCount +
        entry.duplicatePropertyCount
    }))
    .sort((left, right) => right.score - left.score || left.file.localeCompare(right.file));

  const topRows = scoredFiles.slice(0, top);
  if (topRows.length > 0) {
    console.log("\nTop files by warning score:");
    console.log(
      `${formatCell("file", 46)} ${formatCell("!imp", 6)} ${formatCell(":has", 6)} ${formatCell("dupSel", 7)} ${formatCell("dupProp", 8)} ${formatCell("hex3", 6)} ${formatCell("score", 6)}`
    );
    for (const row of topRows) {
      console.log(
        `${formatCell(row.file, 46)} ${formatCell(row.importantCount, 6)} ${formatCell(row.hasCount, 6)} ${formatCell(row.duplicateSelectorCount, 7)} ${formatCell(row.duplicatePropertyCount, 8)} ${formatCell(row.shortHexCount, 6)} ${formatCell(row.score, 6)}`
      );
    }
  }

  if (report.topFindings.duplicateSelectors.length > 0) {
    console.log("\nTop duplicate selectors:");
    for (const finding of report.topFindings.duplicateSelectors.slice(0, Math.min(10, top))) {
      console.log(`- ${finding.file}:${finding.line} | x${finding.count} | ${finding.selector}`);
    }
  }

  if (report.topFindings.duplicateProperties.length > 0) {
    console.log("\nTop duplicate properties in a selector:");
    for (const finding of report.topFindings.duplicateProperties.slice(0, Math.min(10, top))) {
      console.log(`- ${finding.file}:${finding.line} | x${finding.count} | ${finding.property} in ${finding.selector}`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  const files = await collectFiles(rootDir, options);

  const results = [];
  for (const filePath of files) {
    // Keep analysis deterministic and lightweight.
    const analyzed = await analyzeFile(rootDir, filePath);
    results.push(analyzed);
  }

  const report = buildReport(results, options);

  if (options.summary) {
    printSummary(report, options.top);
  }

  const jsonOutput = JSON.stringify(report, null, 2);

  if (options.writePath) {
    const outputPath = path.resolve(rootDir, options.writePath);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, jsonOutput + "\n", "utf8");
  }

  if (options.json) {
    console.log(jsonOutput);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
