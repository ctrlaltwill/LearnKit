/**
 * @file src/views/study-assistant/sprout-study-assistant-view.ts
 * @summary Workspace view for the Study Assistant experience.
 */

import { ItemView, MarkdownView, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { marked } from "marked";
import type SproutPlugin from "../../main";
import { parseCardsFromText } from "../../engine/parser/parser";
import { VIEW_TYPE_STUDY_ASSISTANT } from "../../platform/core/constants";
import { pushDelimitedField } from "../../platform/core/delimiter";
import { replaceChildrenWithHTML, setCssProps } from "../../platform/core/ui";
import { mimeFromExt, resolveImageFile } from "../../platform/image-occlusion/io-helpers";
import { insertTextAtCursorOrAppend } from "../../platform/image-occlusion/io-save";
import { syncOneFile } from "../../platform/integrations/sync/sync-engine";
import { bestEffortAttachmentPath, normaliseVaultPath, writeBinaryToVault } from "../../platform/modals/modal-utils";
import {
  generateStudyAssistantChatReply,
  generateStudyAssistantSuggestions,
} from "../../platform/integrations/ai/study-assistant-generator";
import type {
  StudyAssistantCardType,
  StudyAssistantChatMode,
  StudyAssistantReviewDepth,
  StudyAssistantSuggestion,
} from "../../platform/integrations/ai/study-assistant-types";
import { t } from "../../platform/translations/translator";

type IoSuggestionRect = {
  rectId?: string;
  id?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  groupKey?: string;
  shape?: "rect" | "circle";
};

type AssistantMode = "assistant" | "review" | "generate";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

export class SproutStudyAssistantView extends ItemView {
  plugin: SproutPlugin;
  activeFile: TFile | null = null;
  mode: AssistantMode = "assistant";
  private chatMessages: Record<"assistant" | "review", ChatMessage[]> = {
    assistant: [],
    review: [],
  };
  private chatDraftByMode: Record<"assistant" | "review", string> = {
    assistant: "",
    review: "",
  };
  private isSendingChat = false;
  private chatError = "";
  private chatPayloadPreview = "";
  private chatRawResponse = "";
  private reviewDepth: StudyAssistantReviewDepth = "standard";
  private isReviewingNote = false;
  private reviewError = "";
  private reviewResult = "";
  private reviewPayloadPreview = "";
  private reviewRawResponse = "";
  private isGenerating = false;
  private generatorError = "";
  private payloadPreview = "";
  private rawResponse = "";
  private suggestions: StudyAssistantSuggestion[] = [];
  private insertingSuggestionKey: string | null = null;
  private isInsertingSuggestion = false;
  private _lastAnchoredResponseKeyByMode: Partial<Record<AssistantMode, string>> = {};

  private static readonly SOURCE_TOKEN_STOP_WORDS = new Set([
    "the", "and", "for", "that", "with", "from", "this", "these", "those", "into", "when", "where", "which", "what", "how", "why", "are", "was", "were", "been", "have", "has", "had", "but", "not", "can", "could", "should", "would", "about", "over", "under", "your", "their", "there", "then", "than", "them", "they", "you", "our", "out", "also", "just", "such", "more", "most", "some", "each", "many", "much", "very", "will", "shall",
  ]);

  private trimLine(value: unknown): string {
    const text = typeof value === "string"
      ? value
      : (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
        ? String(value)
        : "";
    return text.replace(/\s+/g, " ").trim();
  }

  private trimList(values: unknown[]): string[] {
    return values.map((v) => this.trimLine(v)).filter(Boolean);
  }

  private parseSuggestionRows(suggestion: StudyAssistantSuggestion): {
    question: string;
    answer: string;
    clozeText: string;
    options: string[];
    correctOptionIndexes: number[];
    steps: string[];
    ioSrc: string;
  } {
    const out = {
      question: this.trimLine(suggestion.question),
      answer: this.trimLine(suggestion.answer),
      clozeText: this.trimLine(suggestion.clozeText),
      options: this.trimList(Array.isArray(suggestion.options) ? suggestion.options : []),
      correctOptionIndexes: Array.isArray(suggestion.correctOptionIndexes)
        ? suggestion.correctOptionIndexes.filter((n) => Number.isFinite(n)).map((n) => Math.max(0, Math.floor(n)))
        : [],
      steps: this.trimList(Array.isArray(suggestion.steps) ? suggestion.steps : []),
      ioSrc: this.trimLine(suggestion.ioSrc),
    };

    const noteRows = Array.isArray(suggestion.noteRows) ? suggestion.noteRows : [];
    if (!noteRows.length) return out;

    for (const row of noteRows) {
      const m = String(row ?? "").match(/^\s*([^|]+?)\s*\|\s*(.*?)\s*(?:\|\s*)?$/);
      if (!m) continue;
      const key = String(m[1] || "").trim().toUpperCase();
      const value = this.trimLine(m[2]);
      if (!value) continue;

      if (suggestion.type === "basic" || suggestion.type === "reversed") {
        if ((key === "Q" || key === "RQ") && !out.question) out.question = value;
        if (key === "A" && !out.answer) out.answer = value;
        continue;
      }

      if (suggestion.type === "cloze") {
        if (key === "CQ" && !out.clozeText) out.clozeText = value;
        continue;
      }

      if (suggestion.type === "mcq") {
        if (key === "MCQ" && !out.question) {
          out.question = value;
          continue;
        }
        if (key === "O" || key === "A") {
          out.options.push(value);
          if (key === "A") out.correctOptionIndexes.push(out.options.length - 1);
        }
        continue;
      }

      if (suggestion.type === "oq") {
        if (key === "OQ" && !out.question) {
          out.question = value;
          continue;
        }
        if (/^\d{1,2}$/.test(key)) {
          const idx = Math.max(0, Number(key) - 1);
          while (out.steps.length <= idx) out.steps.push("");
          out.steps[idx] = value;
        }
        continue;
      }

      if (suggestion.type === "io") {
        if (key === "IO" && !out.ioSrc) out.ioSrc = value;
      }
    }

    out.steps = out.steps.map((step) => this.trimLine(step)).filter(Boolean);
    return out;
  }

  private createLabeledText(parent: HTMLElement, label: string, value: string): void {
    if (!value) return;
    const p = parent.createEl("p", { cls: "sprout-study-assistant-suggestion-line" });
    p.createEl("strong", { text: `${label}: ` });
    p.appendText(value);
  }

  private formatInsertBlock(text: string): string {
    return `${String(text || "").replace(/\s+$/g, "")}\n\n`;
  }

  private toIoPreviewRects(value: unknown): IoSuggestionRect[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item) => item && typeof item === "object")
      .map((item) => item as IoSuggestionRect)
      .filter((r) =>
        Number.isFinite(Number(r.x))
        && Number.isFinite(Number(r.y))
        && Number.isFinite(Number(r.w))
        && Number.isFinite(Number(r.h))
        && Number(r.w) > 0
        && Number(r.h) > 0,
      );
  }

  private resolveIoPreviewSrc(rawIoSrc: string): string | null {
    const file = this.getActiveMarkdownFile();
    if (!file) return null;
    const image = resolveImageFile(this.app, file.path, rawIoSrc);
    if (!(image instanceof TFile)) return null;
    const src = this.app.vault.getResourcePath(image);
    return typeof src === "string" && src ? src : null;
  }

  private renderIoSuggestionPreview(parent: HTMLElement, ioSrc: string, ioRectsRaw: unknown): void {
    const src = this.resolveIoPreviewSrc(ioSrc);
    if (!src) return;

    const preview = parent.createDiv({ cls: "sprout-study-assistant-io-preview" });
    const img = preview.createEl("img", {
      cls: "sprout-study-assistant-io-preview-image",
      attr: { src, alt: this._tx("ui.studyAssistant.generator.ioPreviewAlt", "Image occlusion preview") },
    });

    const overlay = preview.createDiv({ cls: "sprout-study-assistant-io-preview-overlay" });
    const rects = this.toIoPreviewRects(ioRectsRaw);
    for (const rect of rects) {
      const box = overlay.createDiv({ cls: "sprout-study-assistant-io-preview-rect" });
      const shape = String(rect.shape || "rect").toLowerCase();
      if (shape === "circle") box.addClass("is-circle");
      setCssProps(box, "left", `${Math.max(0, Math.min(1, Number(rect.x))) * 100}%`);
      setCssProps(box, "top", `${Math.max(0, Math.min(1, Number(rect.y))) * 100}%`);
      setCssProps(box, "width", `${Math.max(0, Math.min(1, Number(rect.w))) * 100}%`);
      setCssProps(box, "height", `${Math.max(0, Math.min(1, Number(rect.h))) * 100}%`);
    }

    if (rects.length) {
      preview.createDiv({
        cls: "sprout-study-assistant-io-preview-meta",
        text: this._tx("ui.studyAssistant.generator.ioMaskCount", "{count} mask(s)", { count: rects.length }),
      });
    }

    img.addEventListener("error", () => {
      preview.remove();
    }, { once: true });
  }

  private renderSuggestionSummary(parent: HTMLElement, suggestion: StudyAssistantSuggestion): void {
    const data = this.parseSuggestionRows(suggestion);
    const summary = parent.createDiv({ cls: "sprout-study-assistant-suggestion-summary" });

    if (suggestion.type === "basic" || suggestion.type === "reversed") {
      this.createLabeledText(summary, suggestion.type === "reversed" ? "RQ" : "Q", data.question);
      this.createLabeledText(summary, "A", data.answer);
      return;
    }

    if (suggestion.type === "mcq") {
      this.createLabeledText(summary, "MCQ", data.question);
      if (data.options.length) {
        const correct = new Set(data.correctOptionIndexes);
        const ul = summary.createEl("ul", { cls: "sprout-study-assistant-suggestion-list" });
        data.options.forEach((opt, idx) => {
          const li = ul.createEl("li");
          const label = `${correct.has(idx) ? "A" : "O"}: ${opt}`;
          if (correct.has(idx)) li.createEl("strong", { text: label });
          else li.setText(label);
        });
      }
      return;
    }

    if (suggestion.type === "oq") {
      this.createLabeledText(summary, "OQ", data.question);
      if (data.steps.length) {
        const ol = summary.createEl("ol", { cls: "sprout-study-assistant-suggestion-list" });
        for (const step of data.steps) {
          ol.createEl("li", { text: step });
        }
      }
      return;
    }

    if (suggestion.type === "cloze") {
      this.createLabeledText(summary, "CQ", data.clozeText);
      return;
    }

    if (suggestion.type === "io") {
      this.createLabeledText(summary, "IO", data.ioSrc || this._tx("ui.studyAssistant.generator.io", "Image occlusion card"));
      if (data.ioSrc) this.renderIoSuggestionPreview(summary, data.ioSrc, suggestion.ioOcclusions);
      return;
    }

    const fallback = this.trimLine(suggestion.question || suggestion.clozeText || suggestion.title || "");
    if (fallback) summary.createEl("p", { text: fallback, cls: "sprout-study-assistant-suggestion-line" });
  }

  private splitSearchChunks(value: string): string[] {
    const text = this.trimLine(value);
    if (!text) return [];

    const chunks = [text, ...text.split(/\n+|[.!?;:]+/g).map((s) => this.trimLine(s))]
      .filter((part) => part.length >= 14);

    return Array.from(new Set(chunks)).sort((a, b) => b.length - a.length);
  }

  private buildSourceCandidates(suggestion: StudyAssistantSuggestion): string[] {
    const data = this.parseSuggestionRows(suggestion);
    const base: string[] = [];

    if (data.question) base.push(data.question);
    if (data.answer) base.push(data.answer);
    if (data.clozeText) {
      base.push(data.clozeText);
      base.push(data.clozeText.replace(/\{\{c\d+::([^}]+)\}\}/gi, "$1"));
    }
    if (data.options.length) base.push(...data.options);
    if (data.steps.length) base.push(...data.steps);

    const chunks = base.flatMap((entry) => this.splitSearchChunks(entry));
    return Array.from(new Set(chunks)).sort((a, b) => b.length - a.length);
  }

  private offsetToPos(text: string, offset: number): { line: number; ch: number } {
    const safeOffset = Math.max(0, Math.min(text.length, Math.floor(offset)));
    let line = 0;
    let lineStart = 0;

    for (let i = 0; i < safeOffset; i++) {
      if (text.charCodeAt(i) === 10) {
        line += 1;
        lineStart = i + 1;
      }
    }

    return { line, ch: safeOffset - lineStart };
  }

  private findBestSuggestionRange(noteContent: string, suggestion: StudyAssistantSuggestion): { start: number; end: number } | null {
    const haystack = String(noteContent || "");
    if (!haystack.trim()) return null;

    const lower = haystack.toLowerCase();
    const candidates = this.buildSourceCandidates(suggestion);

    for (const candidate of candidates) {
      const idx = lower.indexOf(candidate.toLowerCase());
      if (idx >= 0) {
        const end = Math.min(haystack.length, idx + Math.max(1, candidate.length));
        return { start: idx, end };
      }
    }

    const tokens = Array.from(
      new Set(
        candidates
          .join(" ")
          .toLowerCase()
          .split(/[^a-z0-9]+/g)
          .filter((token) => token.length >= 4 && !SproutStudyAssistantView.SOURCE_TOKEN_STOP_WORDS.has(token)),
      ),
    );

    if (!tokens.length) return null;

    const lines = haystack.split(/\r?\n/);
    let bestLine = -1;
    let bestScore = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = String(lines[i] || "").toLowerCase();
      if (!line.trim()) continue;
      let score = 0;
      for (const token of tokens) {
        if (line.includes(token)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        bestLine = i;
      }
    }

    if (bestLine < 0 || bestScore < 2) return null;

    let cursor = 0;
    for (let i = 0; i < bestLine; i++) cursor += lines[i].length + 1;
    const lineText = String(lines[bestLine] || "");
    return { start: cursor, end: cursor + Math.max(1, lineText.length) };
  }

  private async focusSuggestionSource(suggestion: StudyAssistantSuggestion): Promise<void> {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      new Notice(this._tx("ui.studyAssistant.generator.noNote", "Open a markdown note to insert generated cards."));
      return;
    }

    const noteContent = await this.readActiveMarkdown(file);
    const match = this.findBestSuggestionRange(noteContent, suggestion);

    const activeLeaf = this.app.workspace.getMostRecentLeaf();
    const preferredLeaf = activeLeaf?.view instanceof MarkdownView ? activeLeaf : null;
    const leaf = preferredLeaf ?? this.app.workspace.getLeaf(false);
    const preferredMode = preferredLeaf?.view instanceof MarkdownView ? preferredLeaf.view.getMode() : "preview";
    await leaf.setViewState(
      {
        type: "markdown",
        state: { file: file.path, mode: preferredMode },
        active: true,
      },
      { focus: true },
    );

    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;

    const snippetFromMatch = match
      ? noteContent.slice(match.start, Math.max(match.start + 1, match.end))
      : this.buildSuggestionMarkdownLines(suggestion).join(" ");

    if (view.getMode() === "preview") {
      const ok = this.highlightPreviewSuggestionContext(view, snippetFromMatch);
      if (!ok) {
        new Notice(this._tx("ui.studyAssistant.generator.sourceNotFound", "Opened note, but could not find a precise source snippet for this card."));
      }
      return;
    }

    const waitForEditor = async () => {
      for (let i = 0; i < 30; i++) {
        const editor = view.editor;
        if (editor) return editor;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return null;
    };

    const editor = await waitForEditor();
    if (!editor) return;

    if (!match) {
      editor.setCursor({ line: 0, ch: 0 });
      editor.scrollIntoView({ from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } }, true);
      editor.focus();
      new Notice(this._tx("ui.studyAssistant.generator.sourceNotFound", "Opened note, but could not find a precise source snippet for this card."));
      return;
    }

    const from = this.offsetToPos(noteContent, match.start);
    const to = this.offsetToPos(noteContent, Math.max(match.start + 1, match.end));
    editor.setSelection(from, to);
    editor.scrollIntoView({ from, to }, true);
    editor.focus();
  }

  private highlightPreviewSuggestionContext(view: MarkdownView, rawSnippet: string): boolean {
    const host = view.containerEl;
    if (!host) return false;

    const root = host.querySelector<HTMLElement>(
      ".markdown-reading-view, .markdown-preview-view, .markdown-rendered, .markdown-preview-sizer, .markdown-preview-section",
    ) ?? host;

    const snippet = String(rawSnippet || "").replace(/\s+/g, " ").trim().toLowerCase();
    const tokens = Array.from(
      new Set(
        snippet
          .split(/[^a-z0-9]+/g)
          .filter((token) => token.length >= 4 && !SproutStudyAssistantView.SOURCE_TOKEN_STOP_WORDS.has(token)),
      ),
    );
    if (!tokens.length) return false;

    const candidates = Array.from(
      root.querySelectorAll<HTMLElement>("p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, pre, code"),
    );
    if (!candidates.length) return false;

    let best: HTMLElement | null = null;
    let bestScore = 0;
    for (const el of candidates) {
      const text = String(el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!text) continue;
      let score = 0;
      for (const token of tokens) {
        if (text.includes(token)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    if (!best || bestScore < 2) return false;

    best.scrollIntoView({ block: "center", behavior: "smooth" });
    const prevTransition = best.style.transition;
    const prevBg = best.style.backgroundColor;
    const prevOutline = best.style.outline;
    setCssProps(best, "transition", "background-color 180ms ease, outline-color 180ms ease");
    setCssProps(best, "background-color", "var(--text-highlight-bg, rgba(255, 230, 120, 0.35))");
    setCssProps(best, "outline", "2px solid var(--interactive-accent)");
    window.setTimeout(() => {
      setCssProps(best, "background-color", prevBg);
      setCssProps(best, "outline", prevOutline);
      setCssProps(best, "transition", prevTransition);
    }, 1600);

    return true;
  }

  private clearChatMode(mode: "assistant" | "review"): void {
    this.chatMessages[mode] = [];
    this.chatDraftByMode[mode] = "";
  }

  private clearAllChatState(): void {
    this.clearChatMode("assistant");
    this.clearChatMode("review");
    this.chatError = "";
    this.chatPayloadPreview = "";
    this.chatRawResponse = "";
    this.reviewError = "";
    this.reviewResult = "";
    this.reviewPayloadPreview = "";
    this.reviewRawResponse = "";
  }

  constructor(leaf: WorkspaceLeaf, plugin: SproutPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_STUDY_ASSISTANT;
  }

  getDisplayText() {
    return "Sprout - assistant widget";
  }

  getIcon() {
    return "bot";
  }

  async onOpen() {
    this.activeFile = this.app.workspace.getActiveFile();
    this.render();
    await Promise.resolve();
  }

  async onClose() {
    // Keep chat memory ephemeral to the currently open widget session only.
    this.clearAllChatState();
    await Promise.resolve();
  }

  onRefresh() {
    this.render();
  }

  onFileOpen(file: TFile | null) {
    const previousPath = this.activeFile?.path || "";
    const nextPath = file?.path || "";
    const noteChanged = previousPath !== nextPath;

    this.activeFile = file || null;

    // On note switches, clear Ask-mode session chat so context never drifts.
    if (noteChanged) {
      this.clearChatMode("assistant");
      this.chatError = "";
      this.chatPayloadPreview = "";
      this.chatRawResponse = "";
    }

    if (this.plugin.settings.studyAssistant.privacy.autoSendOnOpen) {
      void this.generateSuggestions();
    }
    this.render();
  }

  private _tx(token: string, fallback: string, vars?: Record<string, string | number>) {
    return t(this.plugin.settings?.general?.interfaceLanguage, token, fallback, vars);
  }

  private _isFlashcardRequest(text: string): boolean {
    const value = String(text || "");
    return /(flash\s*cards?|anki|q\s*\|\s*|\brq\s*\|\s*|\bcq\s*\|\s*|\bmcq\s*\|\s*|\boq\s*\|\s*|\bio\s*\|\s*)/i.test(value);
  }

  private _flashcardDisclaimerText(): string {
    return this._tx(
      "ui.studyAssistant.chat.flashcardDisclaimer",
      "Using the Generate key will produce context-aware flashcards you can directly insert into your notes.",
    );
  }

  private _appendFlashcardDisclaimerIfNeeded(replyText: string, userMessage: string): string {
    const reply = String(replyText || "").trim();
    if (!this._isFlashcardRequest(userMessage)) return reply;

    const disclaimer = this._flashcardDisclaimerText();
    if (reply.toLowerCase().includes(disclaimer.toLowerCase())) return reply;
    if (!reply) return disclaimer;
    return `${reply}\n\n${disclaimer}`;
  }

  private _shouldShowGenerateSwitch(text: string): boolean {
    const body = String(text || "").toLowerCase();
    return body.includes(this._flashcardDisclaimerText().toLowerCase());
  }

  private _renderSwitchToGenerateButton(parent: HTMLElement): void {
    const actions = parent.createDiv({ cls: "sprout-study-assistant-message-actions" });
    const btn = actions.createEl("button", {
      cls: "bc btn-outline sprout-study-assistant-switch-generate-btn",
      text: this._tx("ui.studyAssistant.chat.switchToGenerate", "Switch to Generate Tab"),
    });
    btn.type = "button";
    btn.addEventListener("click", () => {
      this.mode = "generate";
      this.chatError = "";
      this.render();
    });
  }

  private _buildModeButton(parent: HTMLElement, mode: AssistantMode, label: string, icon: string) {
    const btn = parent.createEl("button", { cls: "bc btn-outline sprout-study-assistant-mode-btn" });
    btn.type = "button";
    btn.toggleClass("is-active", this.mode === mode);
    btn.setAttr("aria-label", label);
    btn.setAttr("data-tooltip-position", "top");
    setIcon(btn, icon);
    btn.createSpan({ text: label });
    btn.addEventListener("click", () => {
      this.mode = mode;
      this.chatError = "";
      this.render();
    });
  }

  private modeToChatMode(mode: "assistant" | "review"): StudyAssistantChatMode {
    return mode === "assistant" ? "ask" : "review";
  }

  private getActiveMarkdownFile(): TFile | null {
    const file = this.activeFile || this.app.workspace.getActiveFile();
    if (!(file instanceof TFile)) return null;
    if (!file.path.toLowerCase().endsWith(".md")) return null;
    return file;
  }

  private async readActiveMarkdown(file: TFile): Promise<string> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view?.file?.path === file.path && view.editor) {
      return String(view.editor.getValue() || "");
    }
    return await this.app.vault.read(file);
  }

  private extractImageRefs(markdown: string): string[] {
    const refs = new Set<string>();

    const wikiRe = /!\[\[([^\]]+)\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = wikiRe.exec(markdown)) !== null) {
      const raw = String(match[1] || "").trim();
      if (!raw) continue;
      const filePart = raw.split("|")[0]?.split("#")[0]?.trim();
      if (filePart) refs.add(filePart);
    }

    const mdRe = /!\[[^\]]*\]\(([^)]+)\)/g;
    while ((match = mdRe.exec(markdown)) !== null) {
      const raw = String(match[1] || "").trim();
      if (!raw) continue;
      refs.add(raw.replace(/^<|>$/g, ""));
    }

    return Array.from(refs);
  }

  private arrayBufferToBase64(data: ArrayBuffer): string {
    const bytes = new Uint8Array(data);
    if (!bytes.length) return "";

    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  private async buildVisionImageDataUrls(file: TFile, imageRefs: string[]): Promise<string[]> {
    if (!Array.isArray(imageRefs) || !imageRefs.length) return [];

    const maxImages = 4;
    const maxBytesPerImage = 5 * 1024 * 1024;
    const out: string[] = [];

    for (const ref of imageRefs.slice(0, maxImages)) {
      const imageFile = resolveImageFile(this.app, file.path, ref);
      if (!(imageFile instanceof TFile)) continue;

      try {
        const data = await this.readVaultBinary(imageFile);
        if (!data.byteLength || data.byteLength > maxBytesPerImage) continue;

        const mimeType = mimeFromExt(String(imageFile.extension || ""));
        const base64 = this.arrayBufferToBase64(data);
        if (!base64) continue;
        out.push(`data:${mimeType};base64,${base64}`);
      } catch {
        // Ignore unreadable image refs and continue with any remaining images.
      }
    }

    return out;
  }

  private async sendChatMessage(): Promise<void> {
    if (this.isSendingChat || this.mode === "generate") return;
    if (this.mode === "review") return;

    const draft = String(this.chatDraftByMode.assistant || "").trim();
    if (!draft) return;

    const file = this.getActiveMarkdownFile();
    if (!file) {
      this.chatError = this._tx("ui.studyAssistant.chat.noNote", "Open a markdown note to chat with Sprig.");
      this.render();
      return;
    }

    const chatMode: StudyAssistantChatMode = "ask";
    this.isSendingChat = true;
    this.chatError = "";
    this.chatDraftByMode.assistant = "";
    this.chatMessages.assistant.push({ role: "user", text: draft });
    this.render();

    try {
      const noteContent = await this.readActiveMarkdown(file);
      const imageRefs = this.extractImageRefs(noteContent);
      const settings = this.plugin.settings.studyAssistant;
      const includeImages = !!settings.privacy.includeImagesInAsk;
      const imageDataUrls = includeImages ? await this.buildVisionImageDataUrls(file, imageRefs) : [];
      const customInstructions = settings.prompts.assistant;

      const result = await generateStudyAssistantChatReply({
        settings,
        input: {
          mode: chatMode,
          notePath: file.path,
          noteContent,
          imageRefs,
          imageDataUrls,
          includeImages,
          userMessage: draft,
          customInstructions,
        },
      });

      const reply = this._appendFlashcardDisclaimerIfNeeded(String(result.reply || "").trim(), draft) || this._tx(
        "ui.studyAssistant.chat.emptyReply",
        "No response returned.",
      );

      this.chatMessages.assistant.push({ role: "assistant", text: reply });
      this.chatPayloadPreview = result.payloadPreview;
      this.chatRawResponse = result.rawResponseText;
    } catch (e) {
      this.chatError = e instanceof Error ? e.message : String(e);
    } finally {
      this.isSendingChat = false;
      this.render();
    }
  }

  private async reviewActiveNote(): Promise<void> {
    if (this.isReviewingNote || this.mode !== "review") return;

    const file = this.getActiveMarkdownFile();
    if (!file) {
      this.reviewError = this._tx("ui.studyAssistant.chat.noNote", "Open a markdown note to chat with Sprig.");
      this.render();
      return;
    }

    this.isReviewingNote = true;
    this.reviewError = "";
    this.render();

    try {
      const noteContent = await this.readActiveMarkdown(file);
      const imageRefs = this.extractImageRefs(noteContent);
      const settings = this.plugin.settings.studyAssistant;
      const includeImages = !!settings.privacy.includeImagesInReview;
      const imageDataUrls = includeImages ? await this.buildVisionImageDataUrls(file, imageRefs) : [];

      const depthPrompt = this.reviewDepth === "quick"
        ? this._tx(
          "ui.studyAssistant.review.prompt.quick",
          "Do a quick review with the top 3 weaknesses and top 3 improvements.",
        )
        : this.reviewDepth === "comprehensive"
          ? this._tx(
            "ui.studyAssistant.review.prompt.comprehensive",
            "Do a comprehensive review with correctness checks, missing concepts, exam traps, and a suggested rewrite.",
          )
          : this._tx(
            "ui.studyAssistant.review.prompt.standard",
            "Do a standard review focused on clarity, correctness, structure, and exam readiness.",
          );

      const result = await generateStudyAssistantChatReply({
        settings,
        input: {
          mode: "review",
          notePath: file.path,
          noteContent,
          imageRefs,
          imageDataUrls,
          includeImages,
          userMessage: depthPrompt,
          customInstructions: settings.prompts.noteReview,
          reviewDepth: this.reviewDepth,
        },
      });

      this.reviewResult = String(result.reply || "").trim() || this._tx(
        "ui.studyAssistant.chat.emptyReply",
        "No response returned.",
      );
      this.reviewPayloadPreview = result.payloadPreview;
      this.reviewRawResponse = result.rawResponseText;
    } catch (e) {
      this.reviewError = e instanceof Error ? e.message : String(e);
    } finally {
      this.isReviewingNote = false;
      this.render();
    }
  }

  private enabledGeneratorTypes(): StudyAssistantCardType[] {
    const out: StudyAssistantCardType[] = [];
    const map = this.plugin.settings.studyAssistant.generatorTypes;
    if (map.basic) out.push("basic");
    if (map.reversed) out.push("reversed");
    if (map.cloze) out.push("cloze");
    if (map.mcq) out.push("mcq");
    if (map.oq) out.push("oq");
    if (map.io) out.push("io");
    return out;
  }

  private buildSuggestionMarkdownLines(suggestion: StudyAssistantSuggestion): string[] {
    const explicitRows = Array.isArray(suggestion.noteRows)
      ? suggestion.noteRows.map((row) => String(row || "").trim()).filter(Boolean)
      : [];
    if (explicitRows.length) {
      return [...explicitRows, ""];
    }

    const lines: string[] = [];

    const title = String(suggestion.title || "").trim();
    if (title && this.plugin.settings.studyAssistant.generatorOutput.includeTitle) {
      pushDelimitedField(lines, "T", title);
    }

    if (suggestion.type === "basic") {
      pushDelimitedField(lines, "Q", String(suggestion.question || "").trim());
      pushDelimitedField(lines, "A", String(suggestion.answer || "").trim());
    } else if (suggestion.type === "reversed") {
      pushDelimitedField(lines, "RQ", String(suggestion.question || "").trim());
      pushDelimitedField(lines, "A", String(suggestion.answer || "").trim());
    } else if (suggestion.type === "cloze") {
      pushDelimitedField(lines, "CQ", String(suggestion.clozeText || "").trim());
    } else if (suggestion.type === "mcq") {
      pushDelimitedField(lines, "MCQ", String(suggestion.question || "").trim());
      const options = Array.isArray(suggestion.options) ? suggestion.options : [];
      const correct = new Set(Array.isArray(suggestion.correctOptionIndexes) ? suggestion.correctOptionIndexes : []);
      options.forEach((opt, idx) => {
        const clean = String(opt || "").trim();
        if (!clean) return;
        pushDelimitedField(lines, correct.has(idx) ? "A" : "O", clean);
      });
    } else if (suggestion.type === "oq") {
      pushDelimitedField(lines, "OQ", String(suggestion.question || "").trim());
      const steps = Array.isArray(suggestion.steps) ? suggestion.steps : [];
      steps.forEach((step, idx) => {
        const clean = String(step || "").trim();
        if (!clean) return;
        pushDelimitedField(lines, String(idx + 1), clean);
      });
    } else if (suggestion.type === "io") {
      const ioSrc = String(suggestion.ioSrc || "").trim();
      if (ioSrc) pushDelimitedField(lines, "IO", ioSrc);
      const ioOcclusions = Array.isArray(suggestion.ioOcclusions) ? suggestion.ioOcclusions : [];
      if (ioOcclusions.length) {
        pushDelimitedField(lines, "O", JSON.stringify(ioOcclusions));
      }
      const ioMaskMode = suggestion.ioMaskMode === "solo" || suggestion.ioMaskMode === "all"
        ? suggestion.ioMaskMode
        : null;
      if (ioMaskMode) pushDelimitedField(lines, "C", ioMaskMode);
    }

    const info = String(suggestion.info || "").trim();
    if (info && this.plugin.settings.studyAssistant.generatorOutput.includeInfo) {
      pushDelimitedField(lines, "I", info);
    }
    if (this.plugin.settings.studyAssistant.generatorOutput.includeGroups) {
      const groups = Array.isArray(suggestion.groups)
        ? suggestion.groups.map((g) => String(g || "").trim()).filter(Boolean)
        : [];
      if (groups.length) pushDelimitedField(lines, "G", groups.join(", "));
    }
    lines.push("");

    return lines;
  }

  private rewriteIoNoteRows(noteRows: string[], ioSrc: string): string[] {
    return noteRows.map((row) => {
      const raw = String(row ?? "");
      const m = raw.match(/^(\s*([^|]+?)\s*\|\s*)(.*?)(\s*(?:\|\s*)?)$/);
      if (!m) return raw;
      const key = this.trimLine(m[2]).toUpperCase();
      if (key !== "IO") return raw;
      return `${m[1]}${ioSrc}${m[4]}`;
    });
  }

  private resolveAvailableVaultPath(preferredPath: string, sourcePath: string): string {
    const vault = this.app.vault;
    const normalizedSource = normaliseVaultPath(sourcePath);
    const normalizedPreferred = normaliseVaultPath(preferredPath);

    if (!normalizedPreferred || normalizedPreferred === normalizedSource) return normalizedPreferred;
    if (!vault.getAbstractFileByPath(normalizedPreferred)) return normalizedPreferred;

    const slash = normalizedPreferred.lastIndexOf("/");
    const dir = slash >= 0 ? normalizedPreferred.slice(0, slash + 1) : "";
    const fileName = slash >= 0 ? normalizedPreferred.slice(slash + 1) : normalizedPreferred;
    const dot = fileName.lastIndexOf(".");
    const base = dot > 0 ? fileName.slice(0, dot) : fileName;
    const ext = dot > 0 ? fileName.slice(dot) : "";

    for (let i = 2; i < 10_000; i += 1) {
      const candidate = `${dir}${base}-${i}${ext}`;
      if (candidate === normalizedSource) return candidate;
      if (!vault.getAbstractFileByPath(candidate)) return candidate;
    }

    return `${dir}${base}-${Date.now()}${ext}`;
  }

  private async readVaultBinary(file: TFile): Promise<ArrayBuffer> {
    const vault = this.app.vault;
    if (typeof vault.readBinary === "function") {
      return vault.readBinary(file);
    }
    const adapter = vault.adapter as { readBinary?: (path: string) => Promise<ArrayBuffer> };
    if (typeof adapter.readBinary === "function") {
      return adapter.readBinary(file.path);
    }
    throw new Error("No supported binary read method available.");
  }

  private async prepareSuggestionForInsert(file: TFile, suggestion: StudyAssistantSuggestion): Promise<StudyAssistantSuggestion> {
    if (suggestion.type !== "io") return suggestion;

    const parsed = this.parseSuggestionRows(suggestion);
    const rawIoSrc = this.trimLine(parsed.ioSrc || suggestion.ioSrc || "");
    if (!rawIoSrc) return suggestion;

    const sourceImage = resolveImageFile(this.app, file.path, rawIoSrc);
    if (!(sourceImage instanceof TFile)) return suggestion;

    const sourcePath = normaliseVaultPath(sourceImage.path);
    const preferredTargetPath = bestEffortAttachmentPath(this.plugin, file, sourceImage.name, "io");
    const targetPath = this.resolveAvailableVaultPath(preferredTargetPath, sourcePath);

    if (targetPath !== sourcePath) {
      const data = await this.readVaultBinary(sourceImage);
      await writeBinaryToVault(this.app, targetPath, data);
    }

    const rewrittenIoSrc = `![[${targetPath}]]`;
    return {
      ...suggestion,
      ioSrc: rewrittenIoSrc,
      noteRows: Array.isArray(suggestion.noteRows)
        ? this.rewriteIoNoteRows(suggestion.noteRows, rewrittenIoSrc)
        : suggestion.noteRows,
    };
  }

  private validateGeneratedCardBlock(file: TFile, suggestion: StudyAssistantSuggestion, text: string): string | null {
    const parsed = parseCardsFromText(file.path, text, false);
    if (!Array.isArray(parsed.cards) || parsed.cards.length !== 1) {
      return this._tx(
        "ui.studyAssistant.generator.validation.cardCount",
        "Generated card was rejected by parser validation (expected exactly one card block).",
      );
    }

    const card = parsed.cards[0];
    const errors = Array.isArray(card.errors) ? card.errors.filter(Boolean) : [];
    if (errors.length) {
      return this._tx(
        "ui.studyAssistant.generator.validation.cardErrors",
        "Generated card was rejected by parser validation: {msg}",
        { msg: errors.join("; ") },
      );
    }

    if (card.type !== suggestion.type) {
      return this._tx(
        "ui.studyAssistant.generator.validation.typeMismatch",
        "Generated card was rejected by parser validation (type mismatch: expected {expected}, got {actual}).",
        { expected: suggestion.type, actual: card.type },
      );
    }

    if (suggestion.type === "io") {
      const expectedOcclusions = Array.isArray(suggestion.ioOcclusions) ? suggestion.ioOcclusions.length : 0;
      const parsedOcclusions = Array.isArray(card.occlusions) ? card.occlusions.length : 0;
      if (expectedOcclusions > 0 && parsedOcclusions === 0) {
        return this._tx(
          "ui.studyAssistant.generator.validation.ioOcclusions",
          "Generated IO card was rejected by parser validation (occlusion masks were not parsed successfully).",
        );
      }
    }

    return null;
  }

  private async insertSuggestion(suggestion: StudyAssistantSuggestion, idx: number): Promise<void> {
    if (this.isInsertingSuggestion) {
      new Notice(this._tx("ui.studyAssistant.generator.insertBusy", "Please wait for the current card insertion to finish."));
      return;
    }
    const file = this.getActiveMarkdownFile();
    if (!file) {
      new Notice(this._tx("ui.studyAssistant.generator.noNote", "Open a markdown note to insert generated cards."));
      return;
    }

    const key = `${idx}-${suggestion.type}`;
    this.insertingSuggestionKey = key;
    this.isInsertingSuggestion = true;
    this.render();

    try {
      const preparedSuggestion = await this.prepareSuggestionForInsert(file, suggestion);
      const text = this.formatInsertBlock(this.buildSuggestionMarkdownLines(preparedSuggestion).join("\n"));
      const validationError = this.validateGeneratedCardBlock(file, preparedSuggestion, text);
      if (validationError) throw new Error(validationError);
      await insertTextAtCursorOrAppend(this.app, file, text, true, true);
      await syncOneFile(this.plugin, file, { pruneGlobalOrphans: false });
      new Notice(this._tx("ui.studyAssistant.generator.flashcardAdded", "Flashcard added"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(this._tx("ui.studyAssistant.generator.insertFailed", "Failed to insert card: {msg}", { msg }));
    } finally {
      this.insertingSuggestionKey = null;
      this.isInsertingSuggestion = false;
      this.render();
    }
  }

  private async generateSuggestions(): Promise<void> {
    if (this.isGenerating) return;

    const file = this.getActiveMarkdownFile();
    if (!file) {
      this.generatorError = this._tx("ui.studyAssistant.generator.noNote", "Open a markdown note to generate flashcards.");
      this.render();
      return;
    }

    const enabledTypes = this.enabledGeneratorTypes();
    if (!enabledTypes.length) {
      this.generatorError = this._tx(
        "ui.studyAssistant.generator.noTypes",
        "Enable at least one flashcard type in settings before generating.",
      );
      this.render();
      return;
    }

    this.isGenerating = true;
    this.generatorError = "";
    this.suggestions = [];
    this.payloadPreview = "";
    this.rawResponse = "";
    this.render();

    try {
      const noteContent = await this.readActiveMarkdown(file);
      const imageRefs = this.extractImageRefs(noteContent);
      const settings = this.plugin.settings.studyAssistant;
      const includeImages = !!settings.privacy.includeImagesInFlashcard;
      const imageDataUrls = includeImages ? await this.buildVisionImageDataUrls(file, imageRefs) : [];
      const targetSuggestionCount = Math.max(1, Math.min(10, Math.round(Number(settings.generatorTargetCount) || 5)));

      const result = await generateStudyAssistantSuggestions({
        settings,
        input: {
          notePath: file.path,
          noteContent,
          imageRefs,
          imageDataUrls,
          includeImages,
          enabledTypes: enabledTypes,
          targetSuggestionCount,
          includeTitle: !!settings.generatorOutput.includeTitle,
          includeInfo: !!settings.generatorOutput.includeInfo,
          includeGroups: !!settings.generatorOutput.includeGroups,
          customInstructions: settings.prompts.generator,
          userRequestText: "",
        },
      });

      this.suggestions = result.suggestions;
      this.payloadPreview = result.payloadPreview;
      this.rawResponse = result.rawResponseText;

      if (!this.suggestions.length) {
        this.generatorError = this._tx(
          "ui.studyAssistant.generator.empty",
          "No valid suggestions were returned. Try adjusting your model, prompt, or enabled card types.",
        );
      }
    } catch (e) {
      this.generatorError = e instanceof Error ? e.message : String(e);
    } finally {
      this.isGenerating = false;
      this.render();
    }
  }

  private renderMarkdownMessage(parent: HTMLElement, text: string): void {
    const rendered = marked.parse(String(text || ""), { gfm: true, breaks: true });
    if (typeof rendered === "string") {
      replaceChildrenWithHTML(parent, rendered);
      return;
    }
    parent.setText(text);
  }

  private getActiveNoteDisplayName(): string | null {
    if (!this.activeFile) return null;

    const basename = (this.activeFile as { basename?: string }).basename;
    if (typeof basename === "string" && basename.trim()) return basename;

    const fallbackName = this.activeFile.name || this.activeFile.path || "";
    const trimmed = fallbackName.trim();
    if (!trimmed) return null;
    return trimmed.replace(/\.md$/i, "");
  }

  private renderAssistantMode(parent: HTMLElement): void {
    const card = parent.hasClass("sprout-study-assistant-content-host")
      ? parent
      : parent.createDiv({ cls: "bc sprout-study-assistant-card" });
    card.addClass("sprout-study-assistant-card", "sprout-study-assistant-chat-card");

    const chatWrap = card.createDiv({ cls: "sprout-study-assistant-chat-wrap" });
    chatWrap.createEl("h3", {
      cls: "sprout-study-assistant-chat-title",
      text: this._tx("ui.studyAssistant.mode.assistant", "Ask"),
    });

    const messages = this.chatMessages.assistant;
    if (!messages.length) {
      const empty = chatWrap.createDiv({ cls: "sprout-study-assistant-empty" });
      empty.setText(this._tx("ui.studyAssistant.chat.askHint", "Ask a question about your active note."));
    } else {
      for (let i = 0; i < messages.length; i += 1) {
        const msg = messages[i];
        const row = chatWrap.createDiv({
          cls: `sprout-study-assistant-message-row ${msg.role === "user" ? "is-user" : "is-assistant"}`,
        });
        row.setAttr("data-msg-idx", String(i));
        row.setAttr("data-msg-role", msg.role);
        if (msg.role === "assistant") {
          row.createDiv({ cls: "sprout-study-assistant-message-avatar", text: "S" });
        }
        const bubble = row.createDiv({
          cls: `sprout-study-assistant-message-bubble ${msg.role === "user" ? "is-user" : "is-assistant"}`,
        });
        this.renderMarkdownMessage(bubble, msg.text);

        if (msg.role === "assistant" && this._shouldShowGenerateSwitch(msg.text)) {
          this._renderSwitchToGenerateButton(chatWrap);
        }
      }
    }

    this.anchorToNewestAssistantMessage(chatWrap, messages, "assistant");

    if (this.chatError) {
      const err = card.createEl("p", { cls: "sprout-study-assistant-error", text: this.chatError });
      setCssProps(err, "margin-top", "0");
    }

    const composer = card.createDiv({ cls: "sprout-study-assistant-composer" });
  const shell = composer.createDiv({ cls: "sprout-study-assistant-composer-shell" });
  const input = shell.createEl("textarea", { cls: "bc textarea sprout-study-assistant-input" });
    input.rows = 2;
    input.value = this.chatDraftByMode.assistant || "";
    input.placeholder = this._tx("ui.studyAssistant.chat.askPlaceholder", "Ask Sprig about this note...");
    input.disabled = this.isSendingChat;
    input.addEventListener("input", () => {
      this.chatDraftByMode.assistant = input.value;
    });
    input.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void this.sendChatMessage();
      }
    });

    const sendBtn = shell.createEl("button", { cls: "bc btn-outline sprout-study-assistant-send-btn" });
    sendBtn.type = "button";
    sendBtn.disabled = this.isSendingChat;
    sendBtn.setAttr("aria-label", this._tx("ui.studyAssistant.chat.send", "Send"));
    sendBtn.setAttr("aria-label", this._tx("ui.studyAssistant.chat.send", "Send"));
    sendBtn.setAttr("data-tooltip-position", "top");
    setIcon(sendBtn, this.isSendingChat ? "loader-2" : "arrow-up");
    sendBtn.addEventListener("click", () => {
      void this.sendChatMessage();
    });

  }

  private renderReviewMode(parent: HTMLElement): void {
    const card = parent.hasClass("sprout-study-assistant-content-host")
      ? parent
      : parent.createDiv({ cls: "bc sprout-study-assistant-card" });
    card.addClass("sprout-study-assistant-card");
    card.createEl("h3", { text: this._tx("ui.studyAssistant.mode.review", "Review") });
    card.createEl("p", {
      cls: "sprout-settings-text-muted",
      text: this._tx(
        "ui.studyAssistant.review.hint",
        "Click Review note to analyze this file. Use Thoroughness to control response depth.",
      ),
    });

    const controls = card.createDiv({ cls: "sprout-study-assistant-review-controls" });
    const select = controls.createEl("select", { cls: "bc sprout-study-assistant-review-select" });
    select.disabled = this.isReviewingNote;

    const options: Array<{ value: StudyAssistantReviewDepth; label: string }> = [
      { value: "quick", label: this._tx("ui.studyAssistant.review.depth.quick", "Quick") },
      { value: "standard", label: this._tx("ui.studyAssistant.review.depth.standard", "Standard") },
      { value: "comprehensive", label: this._tx("ui.studyAssistant.review.depth.comprehensive", "Comprehensive") },
    ];

    for (const option of options) {
      const opt = select.createEl("option", { text: option.label });
      opt.value = option.value;
      opt.selected = option.value === this.reviewDepth;
    }

    select.addEventListener("change", () => {
      const next = select.value as StudyAssistantReviewDepth;
      if (next === "quick" || next === "standard" || next === "comprehensive") {
        this.reviewDepth = next;
      }
    });

    const reviewBtn = controls.createEl("button", { cls: "bc btn-outline" });
    reviewBtn.type = "button";
    reviewBtn.disabled = this.isReviewingNote;
    reviewBtn.setText(
      this.isReviewingNote
        ? this._tx("ui.studyAssistant.review.running", "Reviewing...")
        : this._tx("ui.studyAssistant.review.run", "Review note"),
    );
    reviewBtn.addEventListener("click", () => {
      void this.reviewActiveNote();
    });

    if (this.reviewError) {
      card.createEl("p", { cls: "sprout-study-assistant-error", text: this.reviewError });
    }

    const resultWrap = card.createDiv({ cls: "sprout-study-assistant-chat-wrap" });
    if (!this.reviewResult) {
      resultWrap.createDiv({
        cls: "sprout-study-assistant-empty",
        text: this._tx("ui.studyAssistant.review.empty", "No review yet. Choose a level and click Review note."),
      });
    } else {
      const row = resultWrap.createDiv({ cls: "sprout-study-assistant-message-row is-assistant" });
      row.setAttr("data-msg-idx", "0");
      row.setAttr("data-msg-role", "assistant");
      row.createDiv({ cls: "sprout-study-assistant-message-avatar", text: "S" });
      const bubble = row.createDiv({ cls: "sprout-study-assistant-message-bubble is-assistant" });
      this.renderMarkdownMessage(bubble, this.reviewResult);
      this.anchorToNewestAssistantMessage(resultWrap, [{ role: "assistant", text: this.reviewResult }], "review");
    }

    if (this.reviewResult && this._shouldShowGenerateSwitch(this.reviewResult)) {
      this._renderSwitchToGenerateButton(resultWrap);
    }

  }

  private anchorToNewestAssistantMessage(
    chatWrap: HTMLElement,
    messages: ChatMessage[],
    mode: AssistantMode,
  ): void {
    let lastAssistantIdx = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "assistant") {
        lastAssistantIdx = i;
        break;
      }
    }
    if (lastAssistantIdx < 0) return;

    const msg = messages[lastAssistantIdx];
    const key = `${lastAssistantIdx}:${String(msg?.text || "").slice(0, 80)}:${String(msg?.text || "").length}`;
    if (this._lastAnchoredResponseKeyByMode[mode] === key) return;
    this._lastAnchoredResponseKeyByMode[mode] = key;

    const target = chatWrap.querySelector<HTMLElement>(
      `.sprout-study-assistant-message-row[data-msg-idx="${lastAssistantIdx}"][data-msg-role="assistant"]`,
    );
    if (!target) return;

    requestAnimationFrame(() => {
      target.scrollIntoView({ block: "start", behavior: "auto" });
    });
  }

  private renderGenerateMode(parent: HTMLElement): void {
    const card = parent.hasClass("sprout-study-assistant-content-host")
      ? parent
      : parent.createDiv({ cls: "bc sprout-study-assistant-card sprout-study-assistant-flashcards" });
    card.addClass("sprout-study-assistant-card", "sprout-study-assistant-flashcards");
    card.createEl("h3", { text: this._tx("ui.studyAssistant.mode.generator", "Generate") });

    const actions = card.createDiv({ cls: "bc flex items-center gap-2" });
    const generateBtn = actions.createEl("button", { cls: "bc btn-outline" });
    generateBtn.type = "button";
    generateBtn.disabled = this.isGenerating;
    generateBtn.setText(
      this.isGenerating
        ? this._tx("ui.studyAssistant.generator.generating", "Loading flashcards...")
        : this._tx("ui.studyAssistant.generator.generate", "Load flashcards"),
    );
    generateBtn.addEventListener("click", () => {
      void this.generateSuggestions();
    });

    card.createEl("p", {
      cls: "sprout-settings-text-muted",
      text: this._tx(
        "ui.studyAssistant.generator.hint",
        "Suggestions are ranked by difficulty. Click Insert to add parser-compatible markdown at your cursor.",
      ),
    });

    if (this.generatorError) {
      card.createEl("p", { cls: "sprout-study-assistant-error", text: this.generatorError });
    }

    if (!this.suggestions.length) return;

    const list = card.createDiv({ cls: "bc flex flex-col gap-2" });
    this.suggestions.forEach((suggestion, idx) => {
      const key = `${idx}-${suggestion.type}`;
      const isBusy = this.insertingSuggestionKey === key;
      const disableInsert = this.isInsertingSuggestion || isBusy;
      const typeLabel = suggestion.type === "reversed" ? "BASIC (REVERSED)" : String(suggestion.type || "").toUpperCase();

      const item = list.createDiv({ cls: "bc card p-3 gap-2 sprout-study-assistant-suggestion-card" });
      const isNoteBased = suggestion.sourceOrigin !== "external";
      if (isNoteBased) {
        item.setAttr("role", "button");
        item.tabIndex = 0;
        item.addEventListener("click", () => {
          void this.focusSuggestionSource(suggestion);
        });
        item.addEventListener("keydown", (event: KeyboardEvent) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void this.focusSuggestionSource(suggestion);
          }
        });
      }

      const header = item.createDiv({ cls: "bc flex items-center justify-between gap-2" });
      header.createEl("strong", {
        text: `${typeLabel} - ${this._tx("ui.studyAssistant.generator.difficulty", "Difficulty")} ${suggestion.difficulty}`,
      });
      const insertBtn = header.createEl("button", { cls: "bc btn-outline" });
      insertBtn.type = "button";
      insertBtn.disabled = disableInsert;
      insertBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      insertBtn.setText(
        disableInsert
          ? this._tx("ui.studyAssistant.generator.inserting", "Inserting...")
          : this._tx("ui.studyAssistant.generator.insert", "Insert"),
      );
      insertBtn.addEventListener("click", () => {
        void this.insertSuggestion(suggestion, idx);
      });

      this.renderSuggestionSummary(item, suggestion);
      if (suggestion.rationale) item.createEl("p", { cls: "sprout-settings-text-muted", text: suggestion.rationale });
    });
  }

  render() {
    const root = this.contentEl;
    root.empty();

    const wrap = root.createDiv({ cls: "bc bg-background sprout-widget sprout sprout-study-assistant-root" });

    const noteName = this.getActiveNoteDisplayName() || this._tx("ui.studyAssistant.noActiveNote", "No active markdown note");
    const header = wrap.createDiv({ cls: "bc flex items-center justify-between px-4 py-3 gap-2 sprout-widget-summary-header sprout-study-assistant-header" });
    const labels = header.createDiv({ cls: "bc flex flex-col items-start sprout-study-assistant-header-labels" });
    labels.createDiv({ cls: "bc sprout-widget-summary-title", text: this._tx("ui.studyAssistant.title", "Sprout – Study Assistant") });
    labels.createDiv({
      cls: "bc sprout-widget-remaining-line",
      text: this._tx("ui.studyAssistant.activeNoteShort", "Active: {name}", { name: noteName }),
    });

    const toolbar = wrap.createDiv({ cls: "bc px-4 py-3 flex gap-2 sprout-widget-summary-footer sprout-study-assistant-toolbar" });
    const modeRow = toolbar.createDiv({ cls: "sprout-study-assistant-mode-row" });
    this._buildModeButton(modeRow, "assistant", this._tx("ui.studyAssistant.mode.assistant", "Ask"), "message-circle");
    this._buildModeButton(modeRow, "review", this._tx("ui.studyAssistant.mode.review", "Review"), "clipboard-check");
    this._buildModeButton(modeRow, "generate", this._tx("ui.studyAssistant.mode.generator", "Generate"), "wand-sparkles");

    const content = wrap.createDiv({ cls: "bc card px-4 py-4 sprout-widget-teaser sprout-study-assistant-content-host" });

    if (this.mode === "generate") {
      this.renderGenerateMode(content);
      return;
    }
    if (this.mode === "review") {
      this.renderReviewMode(content);
      return;
    }
    this.renderAssistantMode(content);
  }
}
