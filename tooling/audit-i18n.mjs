#!/usr/bin/env node
/**
 * @file tooling/audit-i18n.mjs
 * @summary Harden i18n audit — scans ALL TSX/TS source files for hardcoded
 *          UI-facing strings that should use translation keys (t() / tx()).
 *
 * Usage:
 *   node tooling/audit-i18n.mjs [--json] [--strict] [--extended]
 *
 * Flags:
 *   --json       Output as JSON
 *   --strict     Exit with non-zero code if any hardcoded strings found
 *   --extended   Also check exported consts, Notice(), createEl text, etc.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const ROOT = resolve(__dirname, "..");
const SRC = join(ROOT, "src");

const STRICT = process.argv.includes("--strict");
const AS_JSON = process.argv.includes("--json");
const EXTENDED = process.argv.includes("--extended");

// ── Regex patterns ───────────────────────────────────────────────────

const ATTR_RE = /\b(aria-label|placeholder|data-tooltip|title|alt)=["']([A-Z][^"']{1,200})["']/g;
const JSX_TEXT_RE = />([A-Z][a-z][^<]{0,150}?)</g;
const I18N_CALL_RE = /\b(?:t|tx|_tx|tPlural)\s*\(/;

// Extended patterns (whole-content regex scanning)
const CREATE_EL_TEXT_RE = /createEl\s*\(\s*["'][a-z0-9_-]+["']\s*,\s*\{[^}]*?(?:text|title):\s*["']([A-Z][^"']{1,300})["']/gi;
const CREATE_SPAN_TEXT_RE = /createSpan\s*\(\s*\{[^}]*?text:\s*["']([A-Z][^"']{1,300})["']/gi;
const CREATE_DIV_TEXT_RE = /createDiv\s*\(\s*\{[^}]*?text:\s*["']([A-Z][^"']{1,300})["']/gi;
const SET_TEXT_RE = /\.setText\s*\(\s*["']([A-Z][^"']{1,300})["']\)/g;
const GET_DISPLAY_TEXT_RE = /getDisplayText\s*\(\s*\)\s*.*?return\s+["']([A-Z][^"']{1,100})["']/g;
const GET_VIEW_TYPE_RE = /getViewType\s*\(\s*\)\s*.*?return\s+["']([a-z][^"']{1,80})["']/g;
const ADD_OPTION_RE = /\.addOption\s*\(\s*["'][^"']+["']\s*,\s*["']([A-Z][^"']{1,200})["']\)/g;
const SET_BUTTON_TEXT_RE = /\.setButtonText\s*\(\s*["']([A-Z][^"']{1,200})["']\)/g;

// ── Filters ──────────────────────────────────────────────────────────

const SVG_ELEMENTS = new Set([
  "svg", "path", "circle", "rect", "line", "polyline", "polygon",
  "ellipse", "g", "defs", "clipPath", "mask", "use", "textPath",
  "tspan", "stop", "linearGradient", "radialGradient",
]);

const EXCLUDE_GLOBS = [
  ".d.ts", "__mocks__", "__fixtures__",
  "sql.ts", "logger.ts",
  ".test.ts", ".test.tsx",
  // Not user-facing text: AI system prompts, TTS phonemes, guide docs
  "study-assistant-hidden-prompts",
  "study-assistant-generator",
  "study-assistant-matrix-runner",
  "exam-generator-ai",
  "tts-service",
  "guide-content",
];

function isExcluded(file) {
  return EXCLUDE_GLOBS.some((g) => file.includes(g));
}

function isJsxComment(line) {
  const t = line.trim();
  return /^\s*\{\s*\/\*/.test(t) || /^\s*\/\//.test(t) || /^\s*\*\s/.test(t);
}

function isLogStatement(line) {
  return /\b(?:log\.|console\.|debugLog|debugWarn|debugError)\s*\(/.test(line);
}

function isSvgLine(line) {
  const lower = line.toLowerCase();
  for (const el of SVG_ELEMENTS) {
    if (lower.includes(`<${el}`) || lower.includes(`</${el}>`)) return true;
  }
  return false;
}

// ── English-text heuristics ──────────────────────────────────────────

function isNoiseToken(t) {
  if (t.length < 2) return true;
  if (/^\d/.test(t)) return true;
  if (/^[{}()[\];,]+$/.test(t)) return true;
  // keyboard shortcuts, symbols, single chars
  if (/^[↵↩⏎QqWwEeRrTtYyUuIiOoPpAaSsDdFfGgHhJjKkLlZzXxCcVvBbNnMm1-9+\-−=*×÷/\\|]$/.test(t.trim())) return true;
  if (/^[⚡🔥💡⚠️✅❌⭐🌟💪🎯📊📈📉🗓️📅]/.test(t.trim())) return true;
  if (t.trim() === "") return true;
  return false;
}

function isCodeIdent(text) {
  const t = text.trim();
  if (t.length < 2) return true;
  if (/^\d/.test(t)) return true;
  if (/^[{}()[\];,]+$/.test(t)) return true;
  return false;
}

function hasHumanLetters(text) {
  return /\p{L}/u.test(text);
}

function looksLikeUiLiteral(text) {
  const t = String(text || "").trim();
  if (t.length < 2 || t.length > 300) return false;
  if (!hasHumanLetters(t)) return false;
  if (/^(?:[A-Za-z0-9_-]+\s+){1,}[A-Za-z0-9_-]+$/.test(t) && /(learnkit-|HyperMD-|cm-|mod-|is-)/.test(t)) return false;
  if (/^(?:https?:|learnkit:|sprout:)/i.test(t)) return false;
  if (/^[a-z_][a-z0-9_.:-]*$/i.test(t) && !/\s/.test(t) && !/[A-Z]/.test(t)) return false;
  if (/^(?:[a-z0-9-]+\s+){1,}[a-z0-9-]+$/.test(t)) return false;
  if (/\.(?:ts|tsx|js|json|md|png|jpg|jpeg|svg)$/i.test(t) && !/\s/.test(t)) return false;
  return true;
}

function shouldIgnoreByPolicy(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return true;
  // User requested these resource areas to be excluded from required i18n coverage.
  if (t.includes("guide")) return true;
  if (t.includes("release notes")) return true;
  if (t === "docs" || t.includes("documentation") || t.includes(" docs")) return true;
  return false;
}

function isClassListText(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (!/^(?:[A-Za-z0-9_-]+\s+){1,}[A-Za-z0-9_-]+$/.test(t)) return false;
  return /(learnkit-|HyperMD-|cm-|mod-|is-)/.test(t);
}

/** Returns true if the string looks like natural-language UI text (not code). */
function isLikelyUiText(text) {
  if (text.length < 2) return false;
  // Must contain a space (multi-word) — single words need context checks
  const hasSpace = /\s/.test(text);
  if (!hasSpace) return false;
  // Exclude keyboard key names (multi-word keys don't exist, but just in case)
  // Exclude JS/TS keywords and primitives
  if (/^(?:true|false|null|undefined|NaN|Infinity)$/.test(text)) return false;
  // Exclude pure regex/symbol strings
  if (/^[\\^$.*+?()[\]{}|]+$/.test(text)) return false;
  return true;
}

/** Returns true if a single-word string appears in a UI context. */
function isUiContextSingleWord(text, line) {
  // Single capitalized words (proper nouns) — only flag if in a UI-specific context
  const isProperNoun = /^[A-Z][a-z]{2,}$/.test(text);
  if (!isProperNoun) return false;
  // Exclude keyboard key names
  if (/^(?:Enter|Escape|Tab|Backspace|Delete|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Space|Shift|Control|Alt|Meta|CapsLock|NumLock)$/.test(text)) return false;
  // Exclude CSS/HTML keywords that happen to be proper-cased
  if (/^(?:Auto|Inherit|Initial|Unset|None|Block|Inline|Flex|Grid)$/i.test(text)) return false;
  // Must appear as a function argument: fn("Word", ...) or fn("Word")
  // OR as an object property value: { label: "Word" }, title: "Word", name: "Word"
  if (/\w+\s*\(\s*["']\s*$/.test(line.substring(0, line.indexOf(text))) || 
      /\b(?:label|title|name|heading|summary|buttonText|displayText|description|placeholder|tooltip|ariaLabel)\s*:\s*["']/.test(line)) {
    return true;
  }
  return false;
}

function looksLikeJsxText(text) {
  const t = text.trim();
  if (isNoiseToken(t)) return false;
  if (isCodeIdent(t)) return false;
  if (!/^[A-Z]/.test(t)) return false;
  if (!/[a-z]/.test(t) && t.length > 2) return false;
  if (/^(?:px|rem|em|%|vh|vw|ms|s)$/i.test(t)) return false;
  if (/^(?:className|class|id|href|src|alt|type|name|key|ref)=/i.test(t)) return false;
  if (/^(?:xs|sm|md|lg|xl|2xl|3xl|4xl)$/i.test(t)) return false;
  if (/^https?:/.test(t)) return false;
  return true;
}

function looksLikeAttr(text) {
  const t = text.trim();
  if (isNoiseToken(t)) return false;
  if (isCodeIdent(t)) return false;
  if (!/^[A-Z]/.test(t)) return false;
  if (/^[A-Z][A-Z0-9_]*$/.test(t)) return false;
  return true;
}

// ── File collection ──────────────────────────────────────────────────

function collectFiles(dir, exts = [".ts", ".tsx"]) {
  const results = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (["node_modules", "dist", "coverage", ".git"].includes(entry)) continue;
        stack.push(full);
      } else if (exts.some((e) => full.endsWith(e))) {
        if (isExcluded(full)) continue;
        results.push(full);
      }
    }
  }
  return results;
}

// ── State ────────────────────────────────────────────────────────────

/** @type {Array<{ file: string, line: number, text: string, type: string }>} */
const findings = [];

function add(relPath, line, text, type) {
  if (shouldIgnoreByPolicy(text)) return;
  if (findings.some((f) => f.file === relPath && f.line === line && f.text === text)) return;
  findings.push({ file: relPath, line, text, type });
}

// ── Line-level scan ──────────────────────────────────────────────────

function scanLine(relPath, line, lineNum) {
  if (isJsxComment(line)) return;
  if (isLogStatement(line)) return;
  if (isSvgLine(line)) return;

  const lineHasI18n = I18N_CALL_RE.test(line);

  // ── Attribute strings ──
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(line)) !== null) {
    const attrName = m[1];
    const attrValue = m[2];
    if (lineHasI18n && line.includes(attrValue)) continue;
    if (looksLikeAttr(attrValue)) {
      add(relPath, lineNum, attrValue, `hardcoded ${attrName}`);
    }
  }

  // ── JSX text content ──
  if (!/<[a-zA-Z]/.test(line)) return;
  if (lineHasI18n) return;

  JSX_TEXT_RE.lastIndex = 0;
  while ((m = JSX_TEXT_RE.exec(line)) !== null) {
    const text = m[1];
    if (looksLikeJsxText(text)) {
      add(relPath, lineNum, text.trim(), "hardcoded JSX text");
    }
  }
}

// ── Extended: createEl / createDiv / createSpan with text: ──────────

function scanCreateElText(content, relPath) {
  const re = /createEl\s*\(\s*["'][a-z0-9_-]+["']\s*,\s*\{[^}]*text:\s*["']([A-Z][^"']{1,300})["']\s*[,\}]/gi;
  let m;
  while ((m = re.exec(content)) !== null) {
    const text = m[1];
    if (!looksLikeAttr(text)) continue;
    // Skip if line uses i18n
    const lineContent = getLineAt(content, m.index);
    if (lineContent && I18N_CALL_RE.test(lineContent)) continue;
    add(relPath, lineNum(content, m.index), text, "hardcoded createEl text");
  }
}

function scanCreateSpanDivText(content, relPath) {
  const re = /(?:createSpan|createDiv)\s*\(\s*\{[^}]*text:\s*["']([A-Z][^"']{1,300})["']\s*[,\}]/gi;
  let m;
  while ((m = re.exec(content)) !== null) {
    const text = m[1];
    if (!looksLikeAttr(text)) continue;
    const line = getLineAt(content, m.index);
    if (line && I18N_CALL_RE.test(line)) continue;
    add(relPath, lineNum(content, m.index), text, "hardcoded createSpan/Div text");
  }
}

function scanSetText(content, relPath) {
  let m;
  SET_TEXT_RE.lastIndex = 0;
  while ((m = SET_TEXT_RE.exec(content)) !== null) {
    const text = m[1];
    if (!looksLikeAttr(text)) continue;
    const line = getLineAt(content, m.index);
    if (line && I18N_CALL_RE.test(line)) continue;
    add(relPath, lineNum(content, m.index), text, "hardcoded setText()");
  }
}

function scanGetDisplayText(content, relPath) {
  let m;
  GET_DISPLAY_TEXT_RE.lastIndex = 0;
  while ((m = GET_DISPLAY_TEXT_RE.exec(content)) !== null) {
    const text = m[1];
    if (!looksLikeAttr(text)) continue;
    add(relPath, lineNum(content, m.index), text, "hardcoded getDisplayText()");
  }
}

function scanAddOption(content, relPath) {
  let m;
  ADD_OPTION_RE.lastIndex = 0;
  while ((m = ADD_OPTION_RE.exec(content)) !== null) {
    const text = m[1];
    if (!looksLikeAttr(text)) continue;
    const line = getLineAt(content, m.index);
    if (line && I18N_CALL_RE.test(line)) continue;
    add(relPath, lineNum(content, m.index), text, "hardcoded addOption() label");
  }
}

function scanSetButtonText(content, relPath) {
  let m;
  SET_BUTTON_TEXT_RE.lastIndex = 0;
  while ((m = SET_BUTTON_TEXT_RE.exec(content)) !== null) {
    const text = m[1];
    if (!looksLikeAttr(text)) continue;
    const line = getLineAt(content, m.index);
    if (line && I18N_CALL_RE.test(line)) continue;
    add(relPath, lineNum(content, m.index), text, "hardcoded setButtonText()");
  }
}

// ── Extended: exported consts / Notice / innerHTML / generic strings ─

function scanExportedConsts(content, relPath) {
  const constRe = /export\s+const\s+([A-Z_][A-Z0-9_]*)\s*=\s*["']([A-Z][^"']{1,300})["'];?/g;
  let m;
  while ((m = constRe.exec(content)) !== null) {
    const constValue = m[2];
    if (looksLikeAttr(constValue)) {
      const lno = lineNum(content, m.index);
      add(relPath, lno, constValue, `exported const ${m[1]}`);
    }
  }
}

function scanNotices(content, relPath) {
  const re = /new\s+Notice\s*\(\s*["']([A-Z][^"']{1,300})["']/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const text = m[1];
    if (looksLikeAttr(text)) {
      add(relPath, lineNum(content, m.index), text, "new Notice()");
    }
  }
}

function scanInnerHTML(content, relPath) {
  const re = /(?:innerHTML|textContent|outerHTML)\s*=\s*["']([A-Z][^"']{1,300})["']/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const text = m[1];
    if (looksLikeAttr(text)) {
      add(relPath, lineNum(content, m.index), text, "hardcoded innerHTML");
    }
  }
}

function scanObsidianUiApiLiterals(content, relPath) {
  const patterns = [
    {
      type: "hardcoded command name",
      re: /\b(?:_addCommand|addCommand)\s*\(\s*["'][^"']+["']\s*,\s*["']([^"']{1,240})["']/g,
    },
    {
      type: "hardcoded addCommand name",
      re: /\baddCommand\s*\(\s*\{[\s\S]{0,500}?\bname\s*:\s*["']([^"']{1,240})["']/g,
    },
    {
      type: "hardcoded ribbon title",
      re: /\baddRibbonIcon\s*\(\s*[^,]+,\s*["']([^"']{1,240})["']/g,
    },
    {
      type: "hardcoded menu label",
      re: /\b(?:mkNavItem|mkActionItem|mkSection)\s*\(\s*["']([^"']{1,240})["']/g,
    },
    {
      type: "hardcoded setting label",
      re: /\.set(?:Name|Desc|ButtonText|Tooltip|Placeholder|Title)\s*\(\s*["']([^"']{1,240})["']/g,
    },
    {
      type: "hardcoded option label",
      re: /\b(?:createEl|createDiv|createSpan)\s*\(\s*["'][^"']+["']\s*,\s*\{[\s\S]{0,220}?\b(?:text|title|label)\s*:\s*["']([^"']{1,240})["']/g,
    },
  ];

  for (const p of patterns) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(content)) !== null) {
      const text = m[1];
      if (!looksLikeUiLiteral(text)) continue;
      const line = getLineAt(content, m.index);
      if (line && I18N_CALL_RE.test(line)) continue;
      add(relPath, lineNum(content, m.index), text.trim(), p.type);
    }
  }
}

/** Check if a string at lineNum is inside a nearby t()/tx()/tPlural() call. */
function isInsideI18nCall(lines, lineNum) {
  // Check current line + up to 2 lines above for i18n call.
  // Stop scanning backwards if we hit a line with ); or )} — the i18n call is already closed.
  for (let i = lineNum; i >= Math.max(0, lineNum - 2); i--) {
    const li = lines[i].trim();
    if (I18N_CALL_RE.test(li)) return true;
    // If this line closes a function call, don't look further up
    if (/\)[;,}]\s*$/.test(li)) break;
  }
  return false;
}

function getLineAt(content, index) {
  const before = content.substring(0, index);
  const start = before.lastIndexOf("\n") + 1;
  const end = content.indexOf("\n", index);
  return content.substring(start, end === -1 ? content.length : end);
}

function lineNum(content, index) {
  return content.substring(0, index).split("\n").length;
}

// ── Extended: generic string-literal scanner ─────────────────────────
// Catches ALL string literals that look like natural-language UI text —
// regardless of whether they're in function args, object properties,
// ternary expressions, or template literals.  Previous scanners only
// catch strings passed to well-known DOM APIs (createEl, setText, …).

function scanGenericStrings(content, relPath, lines) {
  // ── Double/single-quoted strings ──────────────────────────────────
  const strRe = /(["'])([A-Z][^"']{0,250}?)\1/g;
  let m;
  while ((m = strRe.exec(content)) !== null) {
    const text = m[2];
    const idx = m.index;
    const lno = lineNum(content, idx);
    const line = lines[lno - 1] || getLineAt(content, idx);

    // Multi-word strings (contains space) — high confidence UI text
    // Single-word proper nouns — only in UI context (fn arg, label:, title:, etc.)
    const isMultiWord = isLikelyUiText(text);
    const isSingleUiWord = !isMultiWord && isUiContextSingleWord(text, line);
    if (!isMultiWord && !isSingleUiWord) continue;
    if (isClassListText(text)) continue;

    if (isInsideI18nCall(lines, lno - 1)) continue;
    if (isJsxComment(line)) continue;
    if (isLogStatement(line)) continue;
    if (isSvgLine(line)) continue;
    if (/\b(?:className|class|cls)\b\s*[:=]/.test(line) || /\.addClass\s*\(/.test(line)) continue;
    if (/setAttribute\s*\(\s*["']d["']\s*,/.test(line)) continue;

    // Already caught by line-level attribute scanner (avoid dupes)
    if (/\b(?:aria-label|placeholder|data-tooltip|title|alt)=["']/.test(line) && line.includes(text)) continue;

    add(relPath, lno, text, isSingleUiWord ? "hardcoded string (UI context)" : "hardcoded string");
  }

  // ── Template literals (single-line only) ──────────────────────────
  const tplRe = /`([^`\n]*[A-Z][a-z][^`\n]{0,250})`/g;
  while ((m = tplRe.exec(content)) !== null) {
    let text = m[1];
    const idx = m.index;
    const lno = lineNum(content, idx);
    const line = lines[lno - 1] || getLineAt(content, idx);

    // Replace interpolation placeholders for display
    text = text.replace(/\$\{[^}]+\}/g, "…");
    text = text.trim();
    if (!text || text.length < 3) continue;
    if (!/^[A-Z]/.test(text)) continue;
    if (isClassListText(text)) continue;
    if (isInsideI18nCall(lines, lno - 1)) continue;
    if (isJsxComment(line)) continue;
    if (isLogStatement(line)) continue;
    if (/\b(?:className|class|cls)\b\s*[:=]/.test(line) || /\.addClass\s*\(/.test(line)) continue;
    if (/setAttribute\s*\(\s*["']d["']\s*,/.test(line)) continue;

    add(relPath, lno, text, "hardcoded template literal");
  }
}

// ── Extended: local const assignments ────────────────────────────────

function scanLocalConsts(content, relPath, lines) {
  // const name = "Value" — where Value looks like UI text
  const re = /\bconst\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']([A-Z][^"']{0,250})["']/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const varName = m[1];
    const text = m[2];
    const idx = m.index;
    const lno = lineNum(content, idx);
    const line = lines[lno - 1] || getLineAt(content, idx);

    const isMultiWord = isLikelyUiText(text);
    const isSingleUiWord = isMultiWord ? false : isUiContextSingleWord(text, line);
    if (!isMultiWord && !isSingleUiWord) continue;
    if (isClassListText(text)) continue;

    if (isInsideI18nCall(lines, lno - 1)) continue;
    if (isJsxComment(line)) continue;
    if (isLogStatement(line)) continue;

    add(relPath, lno, text, `hardcoded const ${varName}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────

const files = collectFiles(SRC);

for (const file of files) {
  const content = readFileSync(file, "utf-8");
  const lines = content.split("\n");
  const relPath = relative(ROOT, file);

  // Line-level scan (always)
  for (let i = 0; i < lines.length; i++) {
    scanLine(relPath, lines[i], i + 1);
  }

  // Extended scans (whole-file)
  if (EXTENDED) {
    scanCreateElText(content, relPath);
    scanCreateSpanDivText(content, relPath);
    scanSetText(content, relPath);
    scanGetDisplayText(content, relPath);
    scanAddOption(content, relPath);
    scanSetButtonText(content, relPath);
    scanExportedConsts(content, relPath);
    scanNotices(content, relPath);
    scanInnerHTML(content, relPath);
    scanObsidianUiApiLiterals(content, relPath);
    scanGenericStrings(content, relPath, lines);
    scanLocalConsts(content, relPath, lines);
  }
}

// ── Report ───────────────────────────────────────────────────────────

const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}

const sortedFiles = [...byFile.keys()].sort();

if (AS_JSON) {
  console.log(JSON.stringify(findings, null, 2));
} else {
  const modeStr = EXTENDED
    ? "(extended — full coverage)"
    : "(base — add --extended for createEl, setText, getDisplayText, etc.)";
  console.log(`\n🔍  i18n Hardcoded String Audit  ${modeStr}`);
  console.log(`${"=".repeat(65)}\n`);

  if (findings.length === 0) {
    console.log("✅ No hardcoded UI strings found. All strings use translation keys!\n");
  } else {
    console.log(`❌  Found ${findings.length} hardcoded UI string(s) across ${byFile.size} file(s):\n`);

    for (const file of sortedFiles) {
      const items = byFile.get(file);
      console.log(`\n📄 ${file}  (${items.length})`);
      console.log(`${"-".repeat(65)}`);
      for (const item of items) {
        console.log(`  L${String(item.line).padEnd(5)} [${item.type}]  "${item.text}"`);
      }
    }

    console.log(`\n${"=".repeat(65)}`);
    console.log(`Total: ${findings.length} hardcoded string(s) in ${byFile.size} file(s)\n`);
  }
}

if (STRICT && findings.length > 0) {
  process.exit(1);
}
process.exit(0);
