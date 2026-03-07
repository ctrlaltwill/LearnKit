import type { SproutSettings } from "../../types/settings";
import { requestStudyAssistantCompletion } from "./study-assistant-provider";
import { buildStudyAssistantHiddenPrompt } from "./study-assistant-hidden-prompts";
import type {
  StudyAssistantChatInput,
  StudyAssistantChatResult,
  StudyAssistantCardType,
  StudyAssistantGeneratorInput,
  StudyAssistantGeneratorResult,
  StudyAssistantSuggestion,
} from "./study-assistant-types";

function clampDifficulty(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(5, Math.round(n)));
}

function extractFirstJsonObject(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }

  return text.trim();
}

function coerceString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value).trim();
  }
  return "";
}

function normalizeComparisonText(value: unknown): string {
  const text = coerceString(value)
    .replace(/\{\{c\d+::([\s\S]*?)\}\}/gi, "$1")
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~>#]/g, " ")
    .toLowerCase();

  return text
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeComparisonText(value: string): string[] {
  return normalizeComparisonText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

function topicsLikelyEquivalent(a: string, b: string): boolean {
  const na = normalizeComparisonText(a);
  const nb = normalizeComparisonText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 20 && longer.includes(shorter)) return true;

  const aTokens = new Set(tokenizeComparisonText(a));
  const bTokens = new Set(tokenizeComparisonText(b));
  if (!aTokens.size || !bTokens.size) return false;

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }

  const minSize = Math.min(aTokens.size, bTokens.size);
  return minSize >= 3 && overlap >= Math.max(3, Math.ceil(minSize * 0.7));
}

function parseDelimitedRow(line: string): { key: string; value: string } | null {
  const m = String(line || "").match(/^\s*([^|]+?)\s*\|\s*(.*?)\s*(?:\|\s*)?$/);
  if (!m) return null;
  const key = String(m[1] || "").trim().toUpperCase();
  const value = coerceString(m[2]);
  if (!key || !value) return null;
  return { key, value };
}

function buildExistingFlashcardTopics(noteContent: string): string[] {
  const lines = String(noteContent || "").split(/\r?\n/);
  const out: string[] = [];

  for (const line of lines) {
    const row = parseDelimitedRow(line);
    if (!row) continue;
    if (!["Q", "RQ", "MCQ", "OQ", "CQ"].includes(row.key)) continue;
    out.push(row.value);
  }

  const deduped: string[] = [];
  for (const topic of out) {
    if (!topic) continue;
    if (deduped.some((existing) => topicsLikelyEquivalent(existing, topic))) continue;
    deduped.push(topic);
  }

  return deduped.slice(0, 60);
}

function extractSuggestionTopics(s: StudyAssistantSuggestion): string[] {
  const out: string[] = [];
  const maybePush = (value: unknown) => {
    const text = coerceString(value);
    if (text) out.push(text);
  };

  const noteRows = Array.isArray(s.noteRows) ? s.noteRows : [];
  for (const rowText of noteRows) {
    const row = parseDelimitedRow(String(rowText || ""));
    if (!row) continue;
    if (["Q", "RQ", "MCQ", "OQ", "CQ"].includes(row.key)) maybePush(row.value);
  }

  maybePush(s.question);
  maybePush(s.clozeText);

  const deduped: string[] = [];
  for (const topic of out) {
    if (deduped.some((existing) => topicsLikelyEquivalent(existing, topic))) continue;
    deduped.push(topic);
  }

  return deduped;
}

function userExplicitlyAllowsRepeatTopics(input: StudyAssistantGeneratorInput): boolean {
  const text = `${coerceString(input.userRequestText)}\n${coerceString(input.customInstructions)}`.toLowerCase();
  if (!text) return false;

  if (/\b(do not|don't|avoid|without)\b[\s\S]{0,30}\b(repeat|duplicate|same topics?)\b/i.test(text)) return false;

  const allowPatterns = [
    /\b(repeat|duplicate|reuse)\b[\s\S]{0,40}\b(card|question|topic)s?\b/i,
    /\b(rephrase|rewrite|variant|variants)\b[\s\S]{0,40}\b(existing|current|same)\b[\s\S]{0,40}\b(card|question|topic)s?\b/i,
    /\bmore\s+of\s+the\s+same\b/i,
  ];

  return allowPatterns.some((re) => re.test(text));
}

type UserRequestOverrides = {
  count?: number;
  types?: StudyAssistantCardType[];
};

const TYPE_ALIASES: Record<string, StudyAssistantCardType> = {
  basic: "basic",
  reversed: "reversed",
  cloze: "cloze",
  mcq: "mcq",
  "multiple choice": "mcq",
  "multiple-choice": "mcq",
  oq: "oq",
  "ordered question": "oq",
  "ordered-question": "oq",
  io: "io",
  "image occlusion": "io",
  "image-occlusion": "io",
};

function parseUserRequestOverrides(text: string): UserRequestOverrides {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return {};

  const result: UserRequestOverrides = {};

  // Match patterns like "3 MCQs", "5 basic cards", "2 cloze questions"
  const countTypePattern = /\b(\d{1,2})\s+(basic|reversed|cloze|mcqs?|multiple[- ]choice|oqs?|ordered[- ]questions?|ios?|image[- ]occlusions?)\b/gi;
  const typeOnlyPattern = /\b(basic|reversed|cloze|mcqs?|multiple[- ]choice|oqs?|ordered[- ]questions?|ios?|image[- ]occlusions?)\s*(cards?|questions?|flashcards?)?\b/gi;
  const countOnlyPattern = /\b(\d{1,2})\s+(cards?|questions?|flashcards?)\b/i;

  // Extract count+type pairs first
  const detectedTypes: StudyAssistantCardType[] = [];
  let match: RegExpExecArray | null;

  while ((match = countTypePattern.exec(t)) !== null) {
    const n = parseInt(match[1], 10);
    const typeKey = match[2].replace(/s$/, "").toLowerCase();
    const mapped = TYPE_ALIASES[typeKey];
    if (mapped) {
      if (!result.count) result.count = n;
      if (!detectedTypes.includes(mapped)) detectedTypes.push(mapped);
    }
  }

  // If no count+type pair, look for standalone type mentions
  if (!detectedTypes.length) {
    while ((match = typeOnlyPattern.exec(t)) !== null) {
      const typeKey = match[1].replace(/s$/, "").toLowerCase();
      const mapped = TYPE_ALIASES[typeKey];
      if (mapped && !detectedTypes.includes(mapped)) detectedTypes.push(mapped);
    }
  }

  // If no count from a count+type pair, look for standalone count like "3 cards"
  if (result.count == null) {
    const cm = countOnlyPattern.exec(t);
    if (cm) result.count = parseInt(cm[1], 10);
    // Also handle "a card", "a question"
    else if (/\ba\s+(card|question|flashcard)\b/i.test(t)) result.count = 1;
  }

  if (result.count != null) result.count = Math.max(1, Math.min(10, result.count));
  if (detectedTypes.length) result.types = detectedTypes;

  return result;
}

function wordCount(value: string): number {
  return value.split(/\s+/g).map((token) => token.trim()).filter(Boolean).length;
}

function isLikelyOpenEndedPrompt(value: string): boolean {
  const text = value.trim();
  if (!text) return true;
  if (text.includes("?")) return true;
  return /^(who|what|when|where|why|how|which)\b/i.test(text);
}

function isReversedPairSafe(question: string, answer: string): boolean {
  const q = question.trim();
  const a = answer.trim();
  if (!q || !a) return false;

  // Reversed cards should be compact, atomic mappings in both directions.
  if (q.length > 80 || a.length > 56) return false;
  if (wordCount(q) > 10 || wordCount(a) > 8) return false;
  if (isLikelyOpenEndedPrompt(q)) return false;

  return true;
}

function downgradeReversedRowsToBasic(rows: string[]): string[] {
  return rows.map((line) => line.replace(/^(\s*)RQ(\s*\|)/i, "$1Q$2"));
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => coerceString(v))
    .filter(Boolean);
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.max(0, Math.floor(n)));
}

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeIoMaskMode(value: unknown): "solo" | "all" | undefined {
  const v = coerceString(value).toLowerCase();
  if (v === "solo" || v === "all") return v;
  return undefined;
}

function normalizeIoGroupKey(value: unknown, fallbackIndex: number): string {
  const raw = coerceString(value).toLowerCase();
  if (!raw) return String(fallbackIndex);
  if (/^\d+$/.test(raw)) return String(Math.max(1, parseInt(raw, 10)));

  const m = raw.match(/\d+/);
  if (m?.[0]) return String(Math.max(1, parseInt(m[0], 10)));
  return String(fallbackIndex);
}

function extractIoImageKey(suggestion: StudyAssistantSuggestion): string {
  const direct = coerceString(suggestion.ioSrc);
  if (direct) return direct;

  const rows = Array.isArray(suggestion.noteRows) ? suggestion.noteRows : [];
  for (const rowText of rows) {
    const row = parseDelimitedRow(String(rowText || ""));
    if (row?.key === "IO") return coerceString(row.value);
  }
  return "";
}

function upsertIoRows(
  rows: string[],
  ioSrc: string,
  ioOcclusions: NonNullable<StudyAssistantSuggestion["ioOcclusions"]>,
  ioMaskMode?: "solo" | "all",
): string[] {
  const keptRows = rows.filter((line) => {
    const row = parseDelimitedRow(String(line || ""));
    if (!row) return true;
    return row.key !== "IO" && row.key !== "O" && row.key !== "C";
  });

  if (ioSrc) keptRows.unshift(`IO | ${ioSrc} |`);
  return ensureIoMaskRows(keptRows, ioOcclusions, ioMaskMode);
}

function mergeIoSuggestionsByImage(suggestions: StudyAssistantSuggestion[]): StudyAssistantSuggestion[] {
  const out: StudyAssistantSuggestion[] = [];
  const mergedByImage = new Map<string, StudyAssistantSuggestion>();

  for (const suggestion of suggestions) {
    if (suggestion.type !== "io") {
      out.push(suggestion);
      continue;
    }

    const imageKey = extractIoImageKey(suggestion) || `__io_image_${out.length}`;
    const existing = mergedByImage.get(imageKey);
    if (!existing) {
      const normalizedOcclusions = (Array.isArray(suggestion.ioOcclusions) ? suggestion.ioOcclusions : [])
        .map((rect, idx) => ({
          ...rect,
          rectId: coerceString(rect.rectId ?? rect.id) || `r${idx + 1}`,
          groupKey: String(idx + 1),
        }));

      const nextSuggestion: StudyAssistantSuggestion = {
        ...suggestion,
        ioOcclusions: normalizedOcclusions,
      };

      if (Array.isArray(nextSuggestion.noteRows) && nextSuggestion.noteRows.length) {
        nextSuggestion.noteRows = upsertIoRows(
          nextSuggestion.noteRows,
          extractIoImageKey(nextSuggestion),
          normalizedOcclusions,
          nextSuggestion.ioMaskMode,
        );
      }

      mergedByImage.set(imageKey, nextSuggestion);
      out.push(nextSuggestion);
      continue;
    }

    const mergedOcclusions = [
      ...(Array.isArray(existing.ioOcclusions) ? existing.ioOcclusions : []),
      ...(Array.isArray(suggestion.ioOcclusions) ? suggestion.ioOcclusions : []),
    ].map((rect, idx) => ({
      ...rect,
      rectId: `r${idx + 1}`,
      groupKey: String(idx + 1),
    }));

    existing.ioOcclusions = mergedOcclusions;
    existing.ioMaskMode = existing.ioMaskMode || suggestion.ioMaskMode || (mergedOcclusions.length ? "solo" : undefined);

    if (Array.isArray(existing.noteRows) && existing.noteRows.length) {
      existing.noteRows = upsertIoRows(
        existing.noteRows,
        extractIoImageKey(existing),
        mergedOcclusions,
        existing.ioMaskMode,
      );
    }
  }

  return out;
}

function toIoOcclusionsArray(value: unknown): NonNullable<StudyAssistantSuggestion["ioOcclusions"]> {
  if (!Array.isArray(value)) return [];
  const rawItems: unknown[] = value;
  const out: NonNullable<StudyAssistantSuggestion["ioOcclusions"]> = [];
  for (let i = 0; i < rawItems.length; i += 1) {
    const item: unknown = rawItems[i];
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const xRaw = toFiniteNumber(rec.x ?? rec.left);
    const yRaw = toFiniteNumber(rec.y ?? rec.top);
    const wRaw = toFiniteNumber(rec.w ?? rec.width);
    const hRaw = toFiniteNumber(rec.h ?? rec.height);
    if (xRaw === null || yRaw === null || wRaw === null || hRaw === null) continue;
    if (wRaw <= 0 || hRaw <= 0) continue;

    const rectId = coerceString(rec.rectId ?? rec.id) || `r${i + 1}`;
  const groupKey = normalizeIoGroupKey(rec.groupKey ?? rec.label ?? rec.name, i + 1);
    const shapeRaw = coerceString(rec.shape).toLowerCase();
    const shape: "rect" | "circle" | undefined = shapeRaw === "circle" ? "circle" : "rect";

    out.push({
      rectId,
      x: clamp01(xRaw),
      y: clamp01(yRaw),
      w: clamp01(wRaw),
      h: clamp01(hRaw),
      groupKey,
      shape,
    });
  }
  return out;
}

function rowHasKey(rows: string[], key: string): boolean {
  const re = new RegExp(`^\\s*${key}\\s*\\|`, "i");
  return rows.some((line) => re.test(String(line ?? "")));
}

function ensureIoMaskRows(
  rows: string[],
  ioOcclusions: NonNullable<StudyAssistantSuggestion["ioOcclusions"]>,
  ioMaskMode?: "solo" | "all",
): string[] {
  const next = rows.slice();
  if (ioOcclusions.length && !rowHasKey(next, "O")) {
    next.push(`O | ${JSON.stringify(ioOcclusions)} |`);
  }
  const mode = ioMaskMode || (ioOcclusions.length ? "solo" : undefined);
  if (mode && !rowHasKey(next, "C")) {
    next.push(`C | ${mode} |`);
  }
  return next;
}

function normalizeType(value: unknown): StudyAssistantCardType | null {
  const t = coerceString(value).toLowerCase();
  if (t === "basic" || t === "reversed" || t === "cloze" || t === "mcq" || t === "oq" || t === "io") {
    return t;
  }
  return null;
}

function sanitizeSuggestion(raw: unknown): StudyAssistantSuggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const type = normalizeType(rec.type);
  if (!type) return null;

  let suggestion: StudyAssistantSuggestion = {
    type,
    difficulty: clampDifficulty(rec.difficulty),
    title: coerceString(rec.title),
    question: coerceString(rec.question),
    answer: coerceString(rec.answer),
    clozeText: coerceString(rec.clozeText),
    info: coerceString(rec.info),
    groups: toStringArray(rec.groups),
    options: toStringArray(rec.options),
    correctOptionIndexes: toNumberArray(rec.correctOptionIndexes),
    steps: toStringArray(rec.steps),
    ioSrc: coerceString(rec.ioSrc),
    ioOcclusions: toIoOcclusionsArray(rec.ioOcclusions ?? rec.occlusions ?? rec.ioMasks ?? rec.masks),
    ioMaskMode: normalizeIoMaskMode(rec.ioMaskMode ?? rec.maskMode ?? rec.mode),
    noteRows: toStringArray(rec.noteRows),
    rationale: coerceString(rec.rationale),
    sourceOrigin: coerceString(rec.sourceOrigin) === "external" ? "external" : "note",
  };

  const hasNoteRows = Array.isArray(suggestion.noteRows) && suggestion.noteRows.length > 0;

  if (type === "reversed") {
    const reverseSafe = isReversedPairSafe(suggestion.question || "", suggestion.answer || "");
    if (!reverseSafe) {
      suggestion = {
        ...suggestion,
        type: "basic",
        noteRows: hasNoteRows ? downgradeReversedRowsToBasic(suggestion.noteRows || []) : suggestion.noteRows,
      };
    }
  }

  if (suggestion.type === "basic" || suggestion.type === "reversed") {
    if (!hasNoteRows && (!suggestion.question || !suggestion.answer)) return null;
  }

  if (suggestion.type === "cloze" && !hasNoteRows && !suggestion.clozeText) return null;

  if (suggestion.type === "mcq") {
    if (!hasNoteRows) {
      if (!suggestion.question) return null;
      if (!suggestion.options || suggestion.options.length < 2) return null;
      if (!suggestion.correctOptionIndexes || suggestion.correctOptionIndexes.length < 1) return null;
    }
  }

  if (suggestion.type === "oq") {
    if (!hasNoteRows) {
      if (!suggestion.question) return null;
    }
  }

  if (suggestion.type === "io") {
    const src = String(suggestion.ioSrc || "").trim();
    const hasEmbed = src.includes("![[") || src.includes("![");
    const rowsContainIo = hasNoteRows && suggestion.noteRows!.some((line) => /^\s*IO\s*\|/i.test(line));
    if (!rowsContainIo && !hasEmbed) return null;
    if (hasNoteRows) {
      suggestion = {
        ...suggestion,
        noteRows: ensureIoMaskRows(
          suggestion.noteRows || [],
          suggestion.ioOcclusions || [],
          suggestion.ioMaskMode,
        ),
      };
    }
  }

  return suggestion;
}

function parseSuggestions(rawText: string): StudyAssistantSuggestion[] {
  const jsonSource = extractFirstJsonObject(rawText);
  if (!jsonSource) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSource);
  } catch {
    return [];
  }

  const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  const items = obj && Array.isArray(obj.suggestions) ? obj.suggestions : [];

  const suggestions: StudyAssistantSuggestion[] = [];
  for (const item of items) {
    const s = sanitizeSuggestion(item);
    if (s) suggestions.push(s);
  }

  const normalizedSuggestions = mergeIoSuggestionsByImage(suggestions);

  normalizedSuggestions.sort((a, b) => b.difficulty - a.difficulty);
  return normalizedSuggestions;
}

function modelLikelySupportsVision(settings: SproutSettings["studyAssistant"]): boolean {
  const model = String(settings.model || "").toLowerCase();
  if (!model) return false;

  return [
    "vision",
    "vl",
    "gpt-4o",
    "gpt-4.1",
    "gpt-5",
    "o1",
    "o3",
    "o4",
    "claude",
    "sonnet",
    "opus",
    "haiku",
    "gemini",
    "pixtral",
    "llava",
  ].some((token) => model.includes(token));
}

function buildSystemPrompt(customInstructions: string, canUseVisionForIo: boolean): string {
  const hiddenPrompt = buildStudyAssistantHiddenPrompt("flashcard");

  const lines = [
    hiddenPrompt,
    "",
    "Public-mode instructions:",
    "You are Sprout Study Assistant, generating flashcards from user notes.",
    "Return valid JSON matching this schema:",
    '{"suggestions":[{"type":"basic|reversed|cloze|mcq|oq|io","difficulty":1-5,"sourceOrigin":"note|external","title":"optional","question":"optional","answer":"optional","clozeText":"optional","options":["..."],"correctOptionIndexes":[0],"steps":["..."],"ioSrc":"optional","ioOcclusions":[{"rectId":"r1","x":0.1,"y":0.2,"w":0.2,"h":0.08,"groupKey":"1","shape":"rect"}],"ioMaskMode":"solo|all","info":"optional","groups":["optional/group"],"noteRows":["KIND | value |"],"rationale":"optional"}]}',
    "Each suggestion must include parser-safe noteRows using Sprout row syntax.",
    'Set sourceOrigin to "note" when the card tests content present in the note, or "external" when it relies on knowledge not found in the note.',
    "MCQ noteRows format (use A for correct options, O for wrong options, NEVER numbered rows): [\"MCQ | question stem |\", \"A | correct option |\", \"O | wrong option |\", \"O | wrong option |\"]",
    "OQ noteRows format (use numbered rows for ordered steps, NEVER A/O rows): [\"OQ | question prompt |\", \"1 | first step |\", \"2 | second step |\", \"3 | third step |\"]",
    "MCQ uses A/O rows only. OQ uses numbered rows only. Do NOT mix these formats.",
    "IO rows must include embedded image syntax in IO | ... |.",
    "For IO, include O row with occlusions JSON and C row with mask mode (solo/all).",
    "For IO occlusions, use normalized coordinates x,y,w,h in [0,1] plus rectId and groupKey.",
    "For IO with visual input, emit at most one IO suggestion per image; include all masks for that image in that single suggestion.",
    "For IO groupKey values, use numeric strings only (\"1\", \"2\", \"3\", ...). Do not use prefixes like g1.",
    "For IO placement, each mask should tightly cover the full target label/text block (including multi-word labels), with slight padding and without covering nearby unrelated labels.",
    canUseVisionForIo
      ? "Use OCR/vision reasoning on referenced images to locate labels and produce occlusion rectangles."
      : "Vision input is unavailable for this run, so do not emit IO suggestions or guessed occlusion coordinates.",
    "Use reversed cards only when both sides form a short, unambiguous two-way mapping; otherwise use basic cards.",
    "Flashcard quality rules (apply strictly):",
    "- One concept per card: if information has multiple enumerable items (e.g. 5 symptom clusters, 3 criteria, 4 mechanisms), prefer one cloze card per item over a single basic card listing all items on the back.",
    "- For any list of N named items that must be memorised atomically, generate N cloze cards each occluding one item, rather than one basic card with all N items as the answer.",
    "- Keep answers short and recognisable at a glance: a single term, phrase, or tight list of ≤3 items. Avoid full paragraphs on the answer side.",
    "- Make the tested concept immediately obvious from the question stem — the answer should feel like a clean retrieval, not a summary essay.",
    "- Do not overcrowd: split multi-part answers into separate cards rather than stacking facts.",
    "- Prioritise high-yield, testable facts: mechanisms, criteria, classifications, key values, and named steps over background narrative.",
    "Do not include markdown code fences.",
    "Avoid duplicate cards.",
  ];

  const extra = customInstructions.trim();
  if (extra) {
    lines.push("User custom instructions:");
    lines.push(extra);
  }

  return lines.join("\n");
}

function buildChatSystemPrompt(input: StudyAssistantChatInput): string {
  const hiddenPrompt = buildStudyAssistantHiddenPrompt(input.mode);

  const lines = [
    hiddenPrompt,
    "",
    "Public-mode instructions:",
    input.mode === "ask"
      ? "You are Sprout Study Assistant. Answer with note context first, then supplement with external knowledge when needed."
      : "You are Sprout Study Assistant. Review the note content using both note evidence and subject knowledge to provide study-focused quality feedback.",
    "Be concise, clear, and practical.",
    "When content is not supported by the note, state that it is external/background knowledge.",
    "Use markdown formatting when useful.",
  ];

  const extra = input.customInstructions.trim();
  if (extra) {
    lines.push("User custom instructions:");
    lines.push(extra);
  }

  return lines.join("\n");
}

function buildChatUserPrompt(input: StudyAssistantChatInput): string {
  const reviewDepth = input.mode === "review"
    ? (input.reviewDepth === "quick" || input.reviewDepth === "comprehensive" ? input.reviewDepth : "standard")
    : undefined;

  const payload = {
    notePath: input.notePath,
    includeImages: input.includeImages,
    imageRefs: input.includeImages ? input.imageRefs : [],
    noteContent: input.noteContent,
    userMessage: input.userMessage,
    reviewDepth,
  };

  return [
    input.mode === "ask"
      ? "Answer the user's study question using the note context first, then fill gaps with reliable general knowledge."
      : "Review the note and respond with concrete improvement actions, using both note evidence and reliable general knowledge.",
    input.mode === "review"
      ? "Match response depth to reviewDepth: quick = concise priorities, standard = balanced coverage, comprehensive = detailed audit with concrete rewrites."
      : "",
    "If a point comes from outside the note, label it briefly as external/background knowledge.",
    "Return plain markdown text only.",
    JSON.stringify(payload, null, 2),
  ].filter(Boolean).join("\n\n");
}

function buildUserPrompt(input: StudyAssistantGeneratorInput, canUseVisionForIo: boolean, overrides: UserRequestOverrides): string {
  const baseTarget = Math.max(1, Math.min(10, Math.round(Number(input.targetSuggestionCount) || 5)));
  const target = overrides.count ?? baseTarget;
  const minCount = Math.max(1, target - 1);
  const maxCount = Math.min(10, target + 1);

  const effectiveTypes = overrides.types
    ? [...new Set([...input.enabledTypes, ...overrides.types])]
    : input.enabledTypes;

  const existingFlashcardTopics = buildExistingFlashcardTopics(input.noteContent);
  const allowRepeatTopics = userExplicitlyAllowsRepeatTopics(input);

  const preview = {
    notePath: input.notePath,
    includeImages: input.includeImages,
    imageRefs: input.includeImages ? input.imageRefs : [],
    visionImageCount: canUseVisionForIo ? (Array.isArray(input.imageDataUrls) ? input.imageDataUrls.length : 0) : 0,
    enabledTypes: effectiveTypes,
    targetSuggestionCount: target,
    allowedCountRange: { min: minCount, max: maxCount },
    generationOptions: {
      includeTitle: input.includeTitle,
      includeInfo: input.includeInfo,
      includeGroups: input.includeGroups,
    },
    existingFlashcardTopics,
    avoidRepeatingExistingTopics: !allowRepeatTopics,
    noteContent: input.noteContent,
  };

  const lines = [
    `Generate approximately ${target} high-quality flashcard suggestions from this note (allowed range: ${minCount}-${maxCount}).`,
    "Sort by difficulty descending.",
    "Respect enabledTypes and generationOptions exactly.",
    allowRepeatTopics
      ? "User explicitly requested repeats/variants of existing cards, so reusing existing flashcard topics is allowed."
      : "The note already contains flashcards. Avoid proposing cards that test the same topic/question intent as existing cards unless the user explicitly asks for repeats.",
    canUseVisionForIo
      ? "For IO cards, use provided image inputs for precise occlusion placement. Emit one IO suggestion per image with multiple masks as needed; do not split one image into multiple single-mask IO suggestions."
      : "Do not generate IO cards in this run because image vision input is unavailable.",
    "Keep LaTeX and language flags (e.g. {{es}}) unchanged.",
    'Set sourceOrigin to "note" for cards based on note content, or "external" for cards requiring knowledge not present in the note.',
    "Return JSON only.",
    JSON.stringify(preview, null, 2),
  ];

  if (overrides.types?.length) {
    lines.splice(1, 0, `The user specifically requested these card types: ${overrides.types.join(", ")}. Prioritise generating these types even if they are not in the default enabledTypes list.`);
  }

  return lines.join("\n\n");
}

export async function generateStudyAssistantSuggestions(params: {
  settings: SproutSettings["studyAssistant"];
  input: StudyAssistantGeneratorInput;
}): Promise<StudyAssistantGeneratorResult> {
  const { settings, input } = params;
  const overrides = parseUserRequestOverrides(input.userRequestText || "");
  const baseTarget = Math.max(1, Math.min(10, Math.round(Number(input.targetSuggestionCount) || 5)));
  const target = overrides.count ?? baseTarget;
  const maxAllowed = Math.min(10, target + 1);
  const effectiveTypes = overrides.types
    ? [...new Set([...input.enabledTypes, ...overrides.types])]
    : input.enabledTypes;
  const imageDataUrls = Array.isArray(input.imageDataUrls) ? input.imageDataUrls.filter(Boolean) : [];
  const canUseVisionForIo = !!input.includeImages && imageDataUrls.length > 0 && modelLikelySupportsVision(settings);
  const existingTopics = buildExistingFlashcardTopics(input.noteContent);
  const allowRepeatTopics = userExplicitlyAllowsRepeatTopics(input);

  const systemPrompt = buildSystemPrompt(input.customInstructions || settings.prompts.generator || "", canUseVisionForIo);
  const userPrompt = buildUserPrompt(input, canUseVisionForIo, overrides);
  const payloadPreview = `System prompt:\n${systemPrompt}\n\nUser prompt:\n${userPrompt}`;

  const rawResponseText = await requestStudyAssistantCompletion({
    settings,
    systemPrompt,
    userPrompt,
    imageDataUrls: canUseVisionForIo ? imageDataUrls : [],
    mode: "json",
  });

  const suggestions = parseSuggestions(rawResponseText)
    .filter((s) => canUseVisionForIo || s.type !== "io")
    .filter((s) => effectiveTypes.includes(s.type))
    .filter((s) => {
      if (allowRepeatTopics || !existingTopics.length) return true;
      const topics = extractSuggestionTopics(s);
      if (!topics.length) return true;
      return !topics.some((topic) => existingTopics.some((existing) => topicsLikelyEquivalent(topic, existing)));
    })
    .slice(0, maxAllowed);

  return {
    suggestions,
    payloadPreview,
    rawResponseText,
  };
}

export async function generateStudyAssistantChatReply(params: {
  settings: SproutSettings["studyAssistant"];
  input: StudyAssistantChatInput;
}): Promise<StudyAssistantChatResult> {
  const { settings, input } = params;

  const systemPrompt = buildChatSystemPrompt(input);
  const userPrompt = buildChatUserPrompt(input);
  const payloadPreview = `System prompt:\n${systemPrompt}\n\nUser prompt:\n${userPrompt}`;

  const imageDataUrls = Array.isArray(input.imageDataUrls) ? input.imageDataUrls.filter(Boolean) : [];

  const rawResponseText = await requestStudyAssistantCompletion({
    settings,
    systemPrompt,
    userPrompt,
    imageDataUrls: input.includeImages ? imageDataUrls : [],
    mode: "text",
  });

  return {
    reply: String(rawResponseText || "").trim(),
    payloadPreview,
    rawResponseText,
  };
}
