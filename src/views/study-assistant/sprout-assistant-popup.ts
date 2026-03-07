/**
 * @file src/views/study-assistant/sprout-assistant-popup.ts
 * @summary Floating assistant popup that overlays the workspace.
 *          The trigger button is mounted into the active markdown view
 *          content container (bottom-right). Clicking it toggles a chat panel with
 *          three tabbed modes: Ask, Review, and Generate.
 */

import { MarkdownView, Modal, Notice, Setting, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { marked } from "marked";
import { parseCardsFromText } from "../../engine/parser/parser";
import { log } from "../../platform/core/logger";
import { joinPath } from "../../platform/integrations/sync/backup";
import type SproutPlugin from "../../main";
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

type AssistantMode = "assistant" | "review" | "generate";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

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

type AssistantLeafSession = {
  activeFile: TFile | null;
  isOpen: boolean;
  mode: AssistantMode;
  chatMessages: ChatMessage[];
  chatDraft: string;
  chatError: string;
  reviewDepth: StudyAssistantReviewDepth;
  reviewMessages: ChatMessage[];
  reviewDraft: string;
  reviewError: string;
  generateMessages: ChatMessage[];
  generateDraft: string;
  suggestions: StudyAssistantSuggestion[];
  generatorError: string;
  insertingSuggestionKey: string | null;
  isInsertingSuggestion: boolean;
};

// ---------------------------------------------------------------------------
//  Token stop words for fuzzy source matching
// ---------------------------------------------------------------------------
const SOURCE_TOKEN_STOP_WORDS = new Set([
  "the", "and", "for", "that", "with", "from", "this", "these", "those",
  "into", "when", "where", "which", "what", "how", "why", "are", "was",
  "were", "been", "have", "has", "had", "but", "not", "can", "could",
  "should", "would", "about", "over", "under", "your", "their", "there",
  "then", "than", "them", "they", "you", "our", "out", "also", "just",
  "such", "more", "most", "some", "each", "many", "much", "very", "will",
  "shall",
]);

// ---------------------------------------------------------------------------
//  SproutAssistantPopup
// ---------------------------------------------------------------------------
export class SproutAssistantPopup {
  plugin: SproutPlugin;
  activeFile: TFile | null = null;

  // DOM nodes
  private triggerBtn: HTMLButtonElement | null = null;
  private popupEl: HTMLDivElement | null = null;
  private isOpen = false;

  // Mode
  private mode: AssistantMode = "assistant";

  // Ask state
  private chatMessages: ChatMessage[] = [];
  private chatDraft = "";
  private isSendingChat = false;
  private chatError = "";

  // Review state
  private reviewDepth: StudyAssistantReviewDepth = "standard";
  private reviewDepthMenuOpen = false;
  private isReviewingNote = false;
  private reviewMessages: ChatMessage[] = [];
  private reviewDraft = "";
  private reviewError = "";

  // Generate state
  private isGenerating = false;
  private generateMessages: ChatMessage[] = [];
  private generateDraft = "";
  private generatorError = "";
  private suggestions: StudyAssistantSuggestion[] = [];
  private insertingSuggestionKey: string | null = null;
  private isInsertingSuggestion = false;

  // Bound handlers for cleanup
  private _onClickOutside: ((e: MouseEvent) => void) | null = null;
  private _onKeydown: ((e: KeyboardEvent) => void) | null = null;

  // Debounce timer for chat saves
  private _saveChatTimer: ReturnType<typeof setTimeout> | null = null;
  private _reviewDepthMenuAbort: AbortController | null = null;
  private _headerMenuOpen = false;
  private _headerMenuAbort: AbortController | null = null;
  private _suppressToggleUntil = 0;
  private _maxObservedPopupHeight = 0;
  private _popupHeightFrame: number | null = null;

  // Per-leaf session state
  private _activeSessionLeaf: WorkspaceLeaf | null = null;
  private _leafSessions = new WeakMap<WorkspaceLeaf, AssistantLeafSession>();

  constructor(plugin: SproutPlugin) {
    this.plugin = plugin;
  }

  // ---------------------------------------------------------------------------
  //  Legacy stubs (called from main.ts for backward compat)
  // ---------------------------------------------------------------------------

  /** @deprecated Chat data is now persisted per-note in the chats/ folder. */
  importChatData(_data: unknown): void { /* no-op */ }

  /** @deprecated Chat data is now persisted per-note in the chats/ folder. */
  exportChatData(): Record<string, unknown> { return {}; }

  // ---------------------------------------------------------------------------
  //  Per-note chat file persistence
  // ---------------------------------------------------------------------------

  private _getChatsFolderPath(): string | null {
    const configDir = this.plugin.app?.vault?.configDir;
    const pluginId = this.plugin.manifest?.id;
    if (!configDir || !pluginId) return null;
    return joinPath(configDir, "plugins", pluginId, "chats");
  }

  private _getChatFilePath(file: TFile): string | null {
    const folder = this._getChatsFolderPath();
    if (!folder) return null;
    // Use full vault path (minus .md) to avoid collisions between notes with the same basename
    const name = file.path.replace(/\.md$/i, "").replace(/[/\\]/g, "_");
    return joinPath(folder, `${name}.json`);
  }

  /** Load persisted chat state for the given note (if any). */
  private async _loadChatForFile(file: TFile): Promise<void> {
    if (!this.plugin.settings?.studyAssistant?.privacy?.saveChatHistory) return;
    const adapter = this.plugin.app?.vault?.adapter;
    const chatPath = this._getChatFilePath(file);
    if (!adapter || !chatPath) return;
    try {
      if (await adapter.exists(chatPath)) {
        const raw = await adapter.read(chatPath);
        const data = JSON.parse(raw) as {
          messages?: ChatMessage[];
          reviewMessages?: ChatMessage[];
          reviewDraft?: string;
          generateMessages?: ChatMessage[];
          generateDraft?: string;
          suggestions?: StudyAssistantSuggestion[];
          reviewResult?: string;
          reviewDepth?: StudyAssistantReviewDepth;
        };
        this.chatMessages = Array.isArray(data.messages) ? data.messages : [];
        this.reviewMessages = Array.isArray(data.reviewMessages) ? data.reviewMessages : [];
        this.reviewDraft = typeof data.reviewDraft === "string" ? data.reviewDraft : "";
        this.generateMessages = Array.isArray(data.generateMessages) ? data.generateMessages : [];
        this.generateDraft = typeof data.generateDraft === "string" ? data.generateDraft : "";
        this.suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
        // Backward compat for legacy saved reviewResult text.
        if (!this.reviewMessages.length && typeof data.reviewResult === "string" && data.reviewResult.trim()) {
          this.reviewMessages = [{ role: "assistant", text: data.reviewResult.trim() }];
        }
        if (data.reviewDepth === "quick" || data.reviewDepth === "standard" || data.reviewDepth === "comprehensive") {
          this.reviewDepth = data.reviewDepth;
        }
      }
    } catch (e) {
      log.swallow("load chat for file", e);
    }
  }

  /** Persist current chat state for the active note. */
  private _scheduleSave(): void {
    if (this._saveChatTimer != null) clearTimeout(this._saveChatTimer);
    this._saveChatTimer = setTimeout(() => {
      this._saveChatTimer = null;
      void this._saveChatForActiveFile();
    }, 300);
  }

  private async _saveChatForActiveFile(): Promise<void> {
    if (!this.plugin.settings?.studyAssistant?.privacy?.saveChatHistory) return;
    const file = this.activeFile;
    if (!file) return;
    const adapter = this.plugin.app?.vault?.adapter;
    const chatPath = this._getChatFilePath(file);
    const chatsFolder = this._getChatsFolderPath();
    if (!adapter || !chatPath || !chatsFolder) return;

    const hasData = this.chatMessages.length > 0 || this.reviewMessages.length > 0 || this.generateMessages.length > 0;
    if (!hasData) {
      // Remove stale file if nothing to save
      try {
        if (await adapter.exists(chatPath)) await adapter.remove(chatPath);
      } catch (e) { log.swallow("remove empty chat file", e); }
      return;
    }

    try {
      if (!(await adapter.exists(chatsFolder))) {
        await (adapter as { mkdir?: (p: string) => Promise<void> }).mkdir?.(chatsFolder);
      }
      const data = {
        messages: this.chatMessages,
        reviewMessages: this.reviewMessages,
        reviewDraft: this.reviewDraft || undefined,
        generateMessages: this.generateMessages,
        generateDraft: this.generateDraft || undefined,
        suggestions: this.suggestions.length ? this.suggestions : undefined,
        reviewDepth: this.reviewDepth,
      };
      await adapter.write(chatPath, JSON.stringify(data, null, 2));
    } catch (e) {
      log.swallow("save chat for file", e);
    }
  }

  private _clearConversationState(): void {
    this.chatMessages = [];
    this.chatDraft = "";
    this.chatError = "";
    this.reviewMessages = [];
    this.reviewDraft = "";
    this.reviewError = "";
    this.generateMessages = [];
    this.generateDraft = "";
    this.generatorError = "";
    this.suggestions = [];
    this.insertingSuggestionKey = null;
  }

  private _currentModeLabel(): string {
    if (this.mode === "assistant") return this._tx("ui.studyAssistant.mode.assistant", "Ask");
    if (this.mode === "review") return this._tx("ui.studyAssistant.mode.review", "Review");
    return this._tx("ui.studyAssistant.mode.generator", "Generate");
  }

  private _safeText(value: unknown): string {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
      return String(value);
    }
    return "";
  }

  private async _confirmDeleteAllConversations(): Promise<boolean> {
    const message = this._tx(
      "ui.studyAssistant.chat.confirmClearAll",
      "Clear all Sprig chats? This permanently deletes all saved chat logs and resets current AI context.",
    );

    return await new Promise<boolean>((resolve) => {
      const modal = new Modal(this.plugin.app);
      let settled = false;

      const finish = (confirmed: boolean): void => {
        if (settled) return;
        settled = true;
        resolve(confirmed);
        modal.close();
      };

      modal.setTitle(this._tx("ui.studyAssistant.chat.deleteAllConversations", "Delete all conversations"));
      modal.contentEl.createEl("p", { text: message });
      new Setting(modal.contentEl)
        .addButton((btn) => {
          btn.setButtonText(this._tx("ui.common.cancel", "Cancel"));
          btn.onClick(() => finish(false));
        })
        .addButton((btn) => {
          btn.setWarning();
          btn.setButtonText(this._tx("ui.common.delete", "Delete"));
          btn.onClick(() => finish(true));
        });

      modal.onClose = () => {
        if (settled) return;
        settled = true;
        resolve(false);
      };
      modal.open();
    });
  }

  private _resetCurrentModeConversation(): void {
    if (this.mode === "assistant") {
      this.chatMessages = [];
      this.chatDraft = "";
      this.chatError = "";
      this._scheduleSave();
    } else if (this.mode === "review") {
      this.reviewMessages = [];
      this.reviewDraft = "";
      this.reviewError = "";
      this._scheduleSave();
    } else {
      this.generateMessages = [];
      this.generateDraft = "";
      this.generatorError = "";
      this.suggestions = [];
      this.insertingSuggestionKey = null;
      this.isGenerating = false;
      this._scheduleSave();
    }
    this._captureCurrentLeafSession();
    this.render();
    new Notice(
      this._tx(
        "ui.studyAssistant.chat.resetCurrentMode",
        "Reset {mode} conversation.",
        { mode: this._currentModeLabel() },
      ),
    );
  }

  private async _deleteAllConversations(): Promise<void> {
    const confirmed = await this._confirmDeleteAllConversations();
    if (!confirmed) return;

    if (this._saveChatTimer != null) {
      clearTimeout(this._saveChatTimer);
      this._saveChatTimer = null;
    }

    this._clearConversationState();
    this._leafSessions = new WeakMap<WorkspaceLeaf, AssistantLeafSession>();

    let deletedCount = 0;
    try {
      const adapter = this.plugin.app?.vault?.adapter;
      const chatsFolder = this._getChatsFolderPath();
      if (adapter && chatsFolder && await adapter.exists(chatsFolder)) {
        const listResult = await (adapter as { list?: (path: string) => Promise<{ files: string[]; folders: string[] }> }).list?.(chatsFolder);
        const files = listResult?.files ?? [];
        for (const filePath of files) {
          await adapter.remove(filePath);
          deletedCount++;
        }
        const folders = (listResult?.folders ?? []).sort((a, b) => b.length - a.length);
        for (const folderPath of folders) {
          try { await adapter.remove(folderPath); } catch (e) { log.swallow("remove nested chats folder", e); }
        }
        try { await adapter.remove(chatsFolder); } catch (e) { log.swallow("remove chats folder", e); }
      }
      this._captureCurrentLeafSession();
      new Notice(this._tx("ui.studyAssistant.chat.clearedAll", "All chats have been cleared."));
    } catch (e) {
      log.swallow("delete all chat files", e);
      new Notice(this._tx("ui.studyAssistant.chat.clearAllFailed", "Could not clear all chats."));
    } finally {
      if (deletedCount > 0) {
        log.info(`[study-assistant] Cleared ${deletedCount} saved chat logs.`);
      }
      this.render();
    }
  }

  /** Rename the chat JSON when the source note is renamed. */
  async onFileRename(oldPath: string, newFile: TFile): Promise<void> {
    const adapter = this.plugin.app?.vault?.adapter;
    const chatsFolder = this._getChatsFolderPath();
    if (!adapter || !chatsFolder) return;
    const oldName = oldPath.split("/").pop()?.replace(/\.md$/i, "") ?? "";
    if (!oldName) return;
    const oldChatPath = joinPath(chatsFolder, `${oldName}.json`);
    const newChatPath = this._getChatFilePath(newFile);
    if (!newChatPath || oldChatPath === newChatPath) return;
    try {
      if (await adapter.exists(oldChatPath)) {
        await adapter.rename(oldChatPath, newChatPath);
      }
    } catch (e) {
      log.swallow("rename chat file", e);
    }
  }

  // ---------------------------------------------------------------------------
  //  Lifecycle
  // ---------------------------------------------------------------------------

  /** Mount the floating trigger button into the document body. */
  mount(): void {
    if (this.triggerBtn) return;

    this._syncSessionForActiveLeaf();

    // Trigger button
    const btn = document.createElement("button");
    btn.className = "sprout-assistant-trigger";
    btn.setAttribute("aria-label", "Study assistant");
    setIcon(btn, "sprout-brand");
    btn.addEventListener("click", (e) => {
      if (Date.now() < this._suppressToggleUntil) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.stopPropagation();
      this._syncSessionForActiveLeaf();
      this._syncHosts();
      this.toggle();
    });
    this._attachToBestHost(btn);
    this.triggerBtn = btn;

    // Click-outside handler
    this._onClickOutside = (e: MouseEvent) => {
      if (!this.isOpen) return;
      const target = e.target as Node;
      if (this.popupEl?.contains(target)) return;
      if (this.triggerBtn?.contains(target)) return;
      this.close();
    };
    document.addEventListener("mousedown", this._onClickOutside, true);

    // Escape handler
    this._onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.isOpen) {
        if (this._headerMenuOpen) {
          e.preventDefault();
          this._headerMenuOpen = false;
          this.render();
          return;
        }
        if (this.reviewDepthMenuOpen) {
          e.preventDefault();
          this.reviewDepthMenuOpen = false;
          this.render();
          return;
        }
        this.close();
      }
    };
    document.addEventListener("keydown", this._onKeydown, true);
  }

  /** Clean up all DOM and event listeners. */
  destroy(): void {
    // Flush any pending chat save
    if (this._saveChatTimer != null) {
      clearTimeout(this._saveChatTimer);
      this._saveChatTimer = null;
    }
    void this._saveChatForActiveFile();
    this._reviewDepthMenuAbort?.abort();
    this._reviewDepthMenuAbort = null;
    this._headerMenuAbort?.abort();
    this._headerMenuAbort = null;
    if (this._popupHeightFrame != null) {
      cancelAnimationFrame(this._popupHeightFrame);
      this._popupHeightFrame = null;
    }
    if (this._onClickOutside) {
      document.removeEventListener("mousedown", this._onClickOutside, true);
      this._onClickOutside = null;
    }
    if (this._onKeydown) {
      document.removeEventListener("keydown", this._onKeydown, true);
      this._onKeydown = null;
    }
    this._captureCurrentLeafSession();
    this.popupEl?.remove();
    this.popupEl = null;
    this.triggerBtn?.remove();
    this.triggerBtn = null;
    this.isOpen = false;
  }

  // ---------------------------------------------------------------------------
  //  File events (called from main.ts)
  // ---------------------------------------------------------------------------

  onFileOpen(file: TFile | null): void {
    this._syncSessionForActiveLeaf();
    this._syncHosts();
    if (!this._isActiveMarkdownNoteContext()) {
      this.popupEl?.addClass("is-hidden");
      this.triggerBtn?.removeClass("is-open");
      return;
    }
    const previousPath = this.activeFile?.path || "";
    const nextPath = file?.path || "";
    if (previousPath !== nextPath) {
      // Save outgoing note's chat before switching
      if (this.activeFile) this._scheduleSave();
      this.chatMessages = [];
      this.chatDraft = "";
      this.chatError = "";
      this.reviewMessages = [];
      this.reviewDraft = "";
      this.reviewError = "";
      this.generateMessages = [];
      this.generateDraft = "";
      this.generatorError = "";
      this.suggestions = [];
      this._maxObservedPopupHeight = 0;
      this.popupEl?.style.removeProperty("height");
      this.activeFile = file || null;
      // Load incoming note's persisted chat
      if (file) void this._loadChatForFile(file).then(() => { if (this.isOpen) this.render(); });
    } else {
      this.activeFile = file || null;
    }
    if (this.isOpen) {
      this.ensurePopup();
      this.popupEl?.removeClass("is-hidden");
      this.triggerBtn?.addClass("is-open");
      this.render();
    } else {
      this.popupEl?.addClass("is-hidden");
      this.triggerBtn?.removeClass("is-open");
    }
  }

  onActiveLeafChange(): void {
    this._syncSessionForActiveLeaf();
    this._syncHosts();
    if (!this._isActiveMarkdownNoteContext()) {
      this.popupEl?.addClass("is-hidden");
      this.triggerBtn?.removeClass("is-open");
      return;
    }
    // Update visibility based on restored per-leaf session state.
    // File content is handled by the separate file-open event.
    if (this.isOpen) {
      this.ensurePopup();
      this.popupEl?.removeClass("is-hidden");
      this.triggerBtn?.addClass("is-open");
      this.render();
    } else {
      this.popupEl?.addClass("is-hidden");
      this.triggerBtn?.removeClass("is-open");
    }
  }

  // ---------------------------------------------------------------------------
  //  Open / Close / Toggle
  // ---------------------------------------------------------------------------

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    if (this.isOpen) return;
    this._syncSessionForActiveLeaf();
    this._syncHosts();
    if (!this._isActiveMarkdownNoteContext()) {
      this.popupEl?.addClass("is-hidden");
      this.triggerBtn?.removeClass("is-open");
      this.isOpen = false;
      return;
    }
    this.activeFile = this.plugin.app.workspace.getActiveFile();
    if (!this.chatMessages.length && !this.reviewMessages.length && !this.generateMessages.length && !this.suggestions.length) {
      this._maxObservedPopupHeight = 0;
      this.popupEl?.style.removeProperty("height");
    }
    this.isOpen = true;
    this.triggerBtn?.addClass("is-open");
    this.ensurePopup();
    this._syncHosts();
    if (this.activeFile) {
      void this._loadChatForFile(this.activeFile).then(() => this.render());
    }
    this.render();
    this.popupEl!.removeClass("is-hidden");
  }

  close(): void {
    if (!this.isOpen) return;
    this._headerMenuOpen = false;
    this._headerMenuAbort?.abort();
    this._headerMenuAbort = null;
    this.reviewDepthMenuOpen = false;
    this._reviewDepthMenuAbort?.abort();
    this._reviewDepthMenuAbort = null;
    if (this._popupHeightFrame != null) {
      cancelAnimationFrame(this._popupHeightFrame);
      this._popupHeightFrame = null;
    }
    this.isOpen = false;
    this.triggerBtn?.removeClass("is-open");
    this.popupEl?.addClass("is-hidden");
    // Persist closed state before syncing leaves so we don't resurrect stale open state.
    this._captureCurrentLeafSession();
    this._syncSessionForActiveLeaf();
    this._captureCurrentLeafSession();
  }

  // ---------------------------------------------------------------------------
  //  Helpers
  // ---------------------------------------------------------------------------

  private _tx(token: string, fallback: string, vars?: Record<string, string | number>): string {
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
    const actions = parent.createDiv({ cls: "sprout-assistant-popup-message-actions" });
    const btn = actions.createEl("button", {
      cls: "sprout-assistant-popup-btn sprout-assistant-popup-switch-generate-btn",
      text: this._tx("ui.studyAssistant.chat.switchToGenerate", "Switch to Generate Tab"),
    });
    btn.type = "button";
    btn.addEventListener("click", () => {
      this.reviewDepthMenuOpen = false;
      this.mode = "generate";
      this.render();
    });
  }

  private _providerLabel(raw: string): string {
    const provider = String(raw || "").trim().toLowerCase();
    if (provider === "openai") return "OpenAI";
    if (provider === "anthropic") return "Anthropic";
    if (provider === "deepseek") return "DeepSeek";
    if (provider === "groq") return "Groq";
    if (provider === "custom") return "Custom provider";
    if (!provider) return this._tx("ui.studyAssistant.provider.unknown", "AI provider");
    return provider.charAt(0).toUpperCase() + provider.slice(1);
  }

  private _formatAssistantError(error: unknown): string {
    const raw = this._safeText(error instanceof Error ? error.message : error)
      .replace(/^error:\s*/i, "")
      .trim();

    if (!raw) {
      return this._tx(
        "ui.studyAssistant.error.generic",
        "Error: AI request failed. Please try again.",
      );
    }

    const missingKey = raw.match(/^Missing API key for provider:\s*([a-z0-9_-]+)$/i);
    if (missingKey?.[1]) {
      return this._tx(
        "ui.studyAssistant.error.missingApiKey",
        "Error: API key missing for {provider}. Add it in Study Assistant settings.",
        { provider: this._providerLabel(missingKey[1]) },
      );
    }

    if (/^Missing endpoint override for custom provider\.?$/i.test(raw)) {
      return this._tx(
        "ui.studyAssistant.error.missingEndpoint",
        "Error: Endpoint missing for Custom provider. Set an endpoint URL in Study Assistant settings.",
      );
    }

    if (/^Missing model name in Study Assistant settings\.?$/i.test(raw)) {
      return this._tx(
        "ui.studyAssistant.error.missingModel",
        "Error: Model missing. Choose a model in Study Assistant settings.",
      );
    }

    const httpFailure = raw.match(/^([a-z0-9_-]+) request failed \((\d{3})\)$/i);
    if (httpFailure?.[1] && httpFailure?.[2]) {
      return this._tx(
        "ui.studyAssistant.error.http",
        "Error: AI request failed ({provider}, HTTP {status}). Check API key, model, and endpoint.",
        {
          provider: this._providerLabel(httpFailure[1]),
          status: httpFailure[2],
        },
      );
    }

    const emptyText = raw.match(/^([a-z0-9_-]+) response did not include text content\.?$/i);
    if (emptyText?.[1]) {
      return this._tx(
        "ui.studyAssistant.error.emptyResponse",
        "Error: AI returned an empty response from {provider}. Try again or switch models.",
        { provider: this._providerLabel(emptyText[1]) },
      );
    }

    return this._tx(
      "ui.studyAssistant.error.withDetails",
      "Error: AI request failed. {details}",
      { details: raw },
    );
  }

  private _newLeafSession(): AssistantLeafSession {
    return {
      activeFile: null,
      isOpen: false,
      mode: "assistant",
      chatMessages: [],
      chatDraft: "",
      chatError: "",
      reviewDepth: "standard",
      reviewMessages: [],
      reviewDraft: "",
      reviewError: "",
      generateMessages: [],
      generateDraft: "",
      suggestions: [],
      generatorError: "",
      insertingSuggestionKey: null,
      isInsertingSuggestion: false,
    };
  }

  private _snapshotCurrentSession(): AssistantLeafSession {
    return {
      activeFile: this.activeFile,
      isOpen: this.isOpen,
      mode: this.mode,
      chatMessages: [...this.chatMessages],
      chatDraft: this.chatDraft,
      chatError: this.chatError,
      reviewDepth: this.reviewDepth,
      reviewMessages: [...this.reviewMessages],
      reviewDraft: this.reviewDraft,
      reviewError: this.reviewError,
      generateMessages: [...this.generateMessages],
      generateDraft: this.generateDraft,
      suggestions: [...this.suggestions],
      generatorError: this.generatorError,
      insertingSuggestionKey: this.insertingSuggestionKey,
      isInsertingSuggestion: this.isInsertingSuggestion,
    };
  }

  private _restoreSession(snapshot: AssistantLeafSession): void {
    this.activeFile = snapshot.activeFile;
    this.isOpen = snapshot.isOpen;
    this.mode = snapshot.mode;
    this.chatMessages = [...snapshot.chatMessages];
    this.chatDraft = snapshot.chatDraft;
    this.chatError = snapshot.chatError;
    this.reviewDepth = snapshot.reviewDepth;
    this.reviewMessages = [...snapshot.reviewMessages];
    this.reviewDraft = snapshot.reviewDraft;
    this.reviewError = snapshot.reviewError;
    this.generateMessages = [...snapshot.generateMessages];
    this.generateDraft = snapshot.generateDraft;
    this.suggestions = [...snapshot.suggestions];
    this.generatorError = snapshot.generatorError;
    this.insertingSuggestionKey = snapshot.insertingSuggestionKey;
    this.isInsertingSuggestion = snapshot.isInsertingSuggestion;
  }

  private _getActiveMarkdownLeaf(): WorkspaceLeaf | null {
    const leaf = this.plugin.app.workspace.getMostRecentLeaf();
    if (!leaf) return null;
    if (!(leaf.view instanceof MarkdownView)) return null;
    return leaf;
  }

  private _captureCurrentLeafSession(): void {
    if (!this._activeSessionLeaf) return;
    this._leafSessions.set(this._activeSessionLeaf, this._snapshotCurrentSession());
  }

  private _syncSessionForActiveLeaf(): void {
    const nextLeaf = this._getActiveMarkdownLeaf();
    // Preserve the current markdown session when focus moves to sidebars.
    if (!nextLeaf) return;
    if (nextLeaf === this._activeSessionLeaf) return;
    this._captureCurrentLeafSession();
    this._activeSessionLeaf = nextLeaf;
    const cached = this._leafSessions.get(nextLeaf);
    this._restoreSession(cached ?? this._newLeafSession());
  }

  private _isActiveMarkdownNoteContext(): boolean {
    const activeFile = this.plugin.app.workspace.getActiveFile();
    if (activeFile && activeFile.path.toLowerCase().endsWith(".md")) return true;
    if (this.activeFile && this.activeFile.path.toLowerCase().endsWith(".md")) return true;
    const leafFile = (this._activeSessionLeaf?.view instanceof MarkdownView)
      ? this._activeSessionLeaf.view.file
      : null;
    return !!leafFile && leafFile.path.toLowerCase().endsWith(".md");
  }

  private _getHostLeaf(): WorkspaceLeaf | null {
    const activeMarkdownLeaf = this._getActiveMarkdownLeaf();
    if (activeMarkdownLeaf) return activeMarkdownLeaf;
    if (this._activeSessionLeaf?.view instanceof MarkdownView) return this._activeSessionLeaf;
    return null;
  }

  private _getHostElement(): HTMLElement | null {
    const hostLeaf = this._getHostLeaf();
    if (!(hostLeaf?.view instanceof MarkdownView)) return null;
    const leafContainer = hostLeaf.view.containerEl;
    if (!leafContainer || !leafContainer.isConnected) return null;
    return leafContainer.querySelector<HTMLElement>(":scope > .view-content")
      ?? leafContainer.querySelector<HTMLElement>(".view-content");
  }

  private _attachToBestHost(el: HTMLElement): boolean {
    const host = this._getHostElement();
    if (!host) {
      el.remove();
      return false;
    }
    if (el.parentElement !== host) host.appendChild(el);
    return true;
  }

  private _syncHosts(): void {
    const hasHost = this.triggerBtn ? this._attachToBestHost(this.triggerBtn) : false;
    if (!hasHost) {
      this.popupEl?.addClass("is-hidden");
      this.triggerBtn?.removeClass("is-open");
      return;
    }
    if (this.popupEl) this._attachToBestHost(this.popupEl);
  }

  private getActiveNoteDisplayName(): string | null {
    if (!this.activeFile) return null;
    const basename = (this.activeFile as { basename?: string }).basename;
    if (typeof basename === "string" && basename.trim()) return basename;
    const fallback = this.activeFile.name || this.activeFile.path || "";
    const trimmed = fallback.trim();
    if (!trimmed) return null;
    return trimmed.replace(/\.md$/i, "");
  }

  private getActiveMarkdownFile(): TFile | null {
    const file = this.activeFile || this.plugin.app.workspace.getActiveFile();
    if (!(file instanceof TFile)) return null;
    if (!file.path.toLowerCase().endsWith(".md")) return null;
    return file;
  }

  private async readActiveMarkdown(file: TFile): Promise<string> {
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (view?.file?.path === file.path && view.editor) {
      return String(view.editor.getValue() || "");
    }
    return await this.plugin.app.vault.read(file);
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
      const imageFile = resolveImageFile(this.plugin.app, file.path, ref);
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

  private trimLine(value: unknown): string {
    return this._safeText(value).replace(/\s+/g, " ").trim();
  }

  private trimList(values: unknown[]): string[] {
    return values.map((v) => this.trimLine(v)).filter(Boolean);
  }

  private renderMarkdownMessage(parent: HTMLElement, text: string): void {
    const rendered = marked.parse(String(text || ""), { gfm: true, breaks: true });
    if (typeof rendered === "string") {
      replaceChildrenWithHTML(parent, rendered);
      return;
    }
    parent.setText(text);
  }

  // ---------------------------------------------------------------------------
  //  Chat (Ask mode)
  // ---------------------------------------------------------------------------

  private async sendChatMessage(): Promise<void> {
    if (this.isSendingChat) return;
    const draft = this.chatDraft.trim();
    if (!draft) return;

    const file = this.getActiveMarkdownFile();
    if (!file) {
      this.chatError = this._tx("ui.studyAssistant.chat.noNote", "Open a markdown note to chat with Sprig.");
      this.render();
      return;
    }

    this.isSendingChat = true;
    this.chatError = "";
    this.chatDraft = "";
    this.chatMessages.push({ role: "user", text: draft });
    this.render();

    try {
      const noteContent = await this.readActiveMarkdown(file);
      const imageRefs = this.extractImageRefs(noteContent);
      const settings = this.plugin.settings.studyAssistant;
      const includeImages = !!settings.privacy.includeImagesInAsk;
      const imageDataUrls = includeImages ? await this.buildVisionImageDataUrls(file, imageRefs) : [];

      const result = await generateStudyAssistantChatReply({
        settings,
        input: {
          mode: "ask" as StudyAssistantChatMode,
          notePath: file.path,
          noteContent,
          imageRefs,
          imageDataUrls,
          includeImages,
          userMessage: draft,
          customInstructions: settings.prompts.assistant,
        },
      });

      const reply = this._appendFlashcardDisclaimerIfNeeded(String(result.reply || "").trim(), draft) || this._tx(
        "ui.studyAssistant.chat.emptyReply",
        "No response returned.",
      );
      this.chatMessages.push({ role: "assistant", text: reply });
    } catch (e) {
      this.chatError = this._formatAssistantError(e);
    } finally {
      this.isSendingChat = false;
      this._scheduleSave();
      this.render();
    }
  }

  // ---------------------------------------------------------------------------
  //  Review mode
  // ---------------------------------------------------------------------------

  private async sendReviewMessage(userMessage: string, depthOverride?: StudyAssistantReviewDepth): Promise<void> {
    if (this.isReviewingNote) return;
    const draft = String(userMessage || "").trim();
    if (!draft) return;
    const file = this.getActiveMarkdownFile();
    if (!file) {
      this.reviewError = this._tx("ui.studyAssistant.chat.noNote", "Open a markdown note to chat with Sprig.");
      this.render();
      return;
    }

    if (depthOverride) this.reviewDepth = depthOverride;

    this.reviewMessages.push({ role: "user", text: draft });

    this.isReviewingNote = true;
    this.reviewError = "";
    this.render();

    try {
      const noteContent = await this.readActiveMarkdown(file);
      const imageRefs = this.extractImageRefs(noteContent);
      const settings = this.plugin.settings.studyAssistant;
      const includeImages = !!settings.privacy.includeImagesInReview;
      const imageDataUrls = includeImages ? await this.buildVisionImageDataUrls(file, imageRefs) : [];

      const result = await generateStudyAssistantChatReply({
        settings,
        input: {
          mode: "review",
          notePath: file.path,
          noteContent,
          imageRefs,
          imageDataUrls,
          includeImages,
          userMessage: draft,
          customInstructions: settings.prompts.noteReview,
          reviewDepth: depthOverride ?? this.reviewDepth,
        },
      });

      const reply = this._appendFlashcardDisclaimerIfNeeded(String(result.reply || "").trim(), draft) || this._tx(
        "ui.studyAssistant.chat.emptyReply",
        "No response returned.",
      );
      this.reviewMessages.push({ role: "assistant", text: reply });
    } catch (e) {
      this.reviewError = this._formatAssistantError(e);
    } finally {
      this.isReviewingNote = false;
      this._scheduleSave();
      this.render();
    }
  }

  // ---------------------------------------------------------------------------
  //  Generate mode
  // ---------------------------------------------------------------------------

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

  private parseSuggestionRows(suggestion: StudyAssistantSuggestion): {
    question: string; answer: string; clozeText: string;
    options: string[]; correctOptionIndexes: number[];
    steps: string[]; ioSrc: string;
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

    // When explicit note rows exist, treat row-based options/steps as canonical
    // to avoid rendering duplicated MCQ/OQ lines from mixed payload shapes.
    if (suggestion.type === "mcq") {
      out.options = [];
      out.correctOptionIndexes = [];
    }
    if (suggestion.type === "oq") {
      out.steps = [];
    }

    for (const row of noteRows) {
      const m = String(row ?? "").match(/^\s*([^|]+?)\s*\|\s*(.*?)\s*(?:\|\s*)?$/);
      if (!m) continue;
      const key = String(m[1] || "").trim().toUpperCase();
      const value = this.trimLine(m[2]);
      if (!value) continue;
      if (suggestion.type === "basic" || suggestion.type === "reversed") {
        if ((key === "Q" || key === "RQ") && !out.question) out.question = value;
        if (key === "A" && !out.answer) out.answer = value;
      } else if (suggestion.type === "cloze") {
        if (key === "CQ" && !out.clozeText) out.clozeText = value;
      } else if (suggestion.type === "mcq") {
        if (key === "MCQ" && !out.question) { out.question = value; continue; }
        if (key === "O" || key === "A") {
          out.options.push(value);
          if (key === "A") out.correctOptionIndexes.push(out.options.length - 1);
        }
      } else if (suggestion.type === "oq") {
        if (key === "OQ" && !out.question) { out.question = value; continue; }
        if (/^\d{1,2}$/.test(key)) {
          const idx = Math.max(0, Number(key) - 1);
          while (out.steps.length <= idx) out.steps.push("");
          out.steps[idx] = value;
        }
      } else if (suggestion.type === "io") {
        if (key === "IO" && !out.ioSrc) out.ioSrc = value;
      }
    }
    out.steps = out.steps.map((step) => this.trimLine(step)).filter(Boolean);
    return out;
  }

  private buildSuggestionMarkdownLines(suggestion: StudyAssistantSuggestion): string[] {
    const explicitRows = Array.isArray(suggestion.noteRows)
      ? suggestion.noteRows.map((row) => String(row || "").trim()).filter(Boolean)
      : [];
    if (explicitRows.length) return [...explicitRows, ""];

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
    const image = resolveImageFile(this.plugin.app, file.path, rawIoSrc);
    if (!(image instanceof TFile)) return null;
    const src = this.plugin.app.vault.getResourcePath(image);
    return typeof src === "string" && src ? src : null;
  }

  private renderIoSuggestionPreview(parent: HTMLElement, ioSrc: string, ioRectsRaw: unknown): void {
    const src = this.resolveIoPreviewSrc(ioSrc);
    if (!src) return;

    const preview = parent.createDiv({ cls: "sprout-assistant-popup-io-preview" });
    const img = preview.createEl("img", {
      cls: "sprout-assistant-popup-io-preview-image",
      attr: { src, alt: this._tx("ui.studyAssistant.generator.ioPreviewAlt", "Image occlusion preview") },
    });

    const overlay = preview.createDiv({ cls: "sprout-assistant-popup-io-preview-overlay" });
    const rects = this.toIoPreviewRects(ioRectsRaw);
    for (const rect of rects) {
      const box = overlay.createDiv({ cls: "sprout-assistant-popup-io-preview-rect" });
      const shape = String(rect.shape || "rect").toLowerCase();
      if (shape === "circle") box.addClass("is-circle");
      setCssProps(box, "left", `${Math.max(0, Math.min(1, Number(rect.x))) * 100}%`);
      setCssProps(box, "top", `${Math.max(0, Math.min(1, Number(rect.y))) * 100}%`);
      setCssProps(box, "width", `${Math.max(0, Math.min(1, Number(rect.w))) * 100}%`);
      setCssProps(box, "height", `${Math.max(0, Math.min(1, Number(rect.h))) * 100}%`);
    }

    if (rects.length) {
      preview.createDiv({
        cls: "sprout-assistant-popup-io-preview-meta",
        text: this._tx("ui.studyAssistant.generator.ioMaskCount", "{count} mask(s)", { count: rects.length }),
      });
    }

    img.addEventListener("error", () => {
      preview.remove();
    }, { once: true });
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
    const vault = this.plugin.app.vault;
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
    const vault = this.plugin.app.vault;
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

    const sourceImage = resolveImageFile(this.plugin.app, file.path, rawIoSrc);
    if (!(sourceImage instanceof TFile)) return suggestion;

    const sourcePath = normaliseVaultPath(sourceImage.path);
    const preferredTargetPath = bestEffortAttachmentPath(this.plugin, file, sourceImage.name, "io");
    const targetPath = this.resolveAvailableVaultPath(preferredTargetPath, sourcePath);

    if (targetPath !== sourcePath) {
      const data = await this.readVaultBinary(sourceImage);
      await writeBinaryToVault(this.plugin.app, targetPath, data);
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
      await insertTextAtCursorOrAppend(this.plugin.app, file, text, true, true);
      await syncOneFile(this.plugin, file);
      this.suggestions = this.suggestions.filter((_, i) => i !== idx);
      new Notice(this._tx("ui.studyAssistant.generator.inserted", "Inserted generated card into {path}", { path: file.path }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(this._tx("ui.studyAssistant.generator.insertFailed", "Failed to insert card: {msg}", { msg }));
    } finally {
      this.insertingSuggestionKey = null;
      this.isInsertingSuggestion = false;
      this.render();
    }
  }

  private async generateSuggestions(userMessage?: string): Promise<void> {
    if (this.isGenerating) return;
    const file = this.getActiveMarkdownFile();
    if (!file) {
      this.generatorError = this._tx("ui.studyAssistant.generator.noNote", "Open a markdown note to generate flashcards.");
      this.render();
      return;
    }
    const enabledTypes = this.enabledGeneratorTypes();
    if (!enabledTypes.length) {
      this.generatorError = this._tx("ui.studyAssistant.generator.noTypes", "Enable at least one flashcard type in settings before generating.");
      this.render();
      return;
    }
    this.isGenerating = true;
    this.generatorError = "";
    this.suggestions = [];
    this.render();
    try {
      const noteContent = await this.readActiveMarkdown(file);
      const imageRefs = this.extractImageRefs(noteContent);
      const settings = this.plugin.settings.studyAssistant;
      const includeImages = !!settings.privacy.includeImagesInFlashcard;
      const imageDataUrls = includeImages ? await this.buildVisionImageDataUrls(file, imageRefs) : [];
      const targetSuggestionCount = Math.max(1, Math.min(10, Math.round(Number(settings.generatorTargetCount) || 5)));
      const extraRequest = String(userMessage || "").trim();
      const customInstructions = [
        String(settings.prompts.generator || "").trim(),
        extraRequest
          ? this._tx(
            "ui.studyAssistant.generator.requestPrefix",
            "Additional user request for this generation: {request}",
            { request: extraRequest },
          )
          : "",
      ].filter(Boolean).join("\n\n");
      const result = await generateStudyAssistantSuggestions({
        settings,
        input: {
          notePath: file.path,
          noteContent,
          imageRefs,
          imageDataUrls,
          includeImages,
          enabledTypes,
          targetSuggestionCount,
          includeTitle: !!settings.generatorOutput.includeTitle,
          includeInfo: !!settings.generatorOutput.includeInfo,
          includeGroups: !!settings.generatorOutput.includeGroups,
          customInstructions,
          userRequestText: extraRequest,
        },
      });
      this.suggestions = result.suggestions;
      const generatedCount = this.suggestions.length;
      const beVerb = generatedCount === 1 ? "is" : "are";
      const flashcardLabel = generatedCount === 1 ? "flashcard" : "flashcards";
      const assistantSummary = this._tx(
        "ui.studyAssistant.generator.generatedCount",
        "Here {be} {count} generated {label}:",
        { be: beVerb, count: generatedCount, label: flashcardLabel },
      );
      this.generateMessages.push({ role: "assistant", text: assistantSummary });
      if (!this.suggestions.length) {
        this.generatorError = this._tx("ui.studyAssistant.generator.empty", "No valid suggestions were returned. Try adjusting your model, prompt, or enabled card types.");
      }
    } catch (e) {
      this.generatorError = this._formatAssistantError(e);
    } finally {
      this.isGenerating = false;
      this.render();
    }
  }

  private async sendGenerateMessage(): Promise<void> {
    if (this.isGenerating) return;
    const draft = String(this.generateDraft || "").trim();
    if (!draft) return;
    this.generateDraft = "";
    this.generateMessages.push({ role: "user", text: draft });
    await this.generateSuggestions(draft);
  }

  // ---------------------------------------------------------------------------
  //  Source finding (Generate mode)
  // ---------------------------------------------------------------------------

  private splitSearchChunks(value: string): string[] {
    const text = this.trimLine(value);
    if (!text) return [];
    const chunks = [text, ...text.split(/\n+|[.!?;:]+/g).map((s) => this.trimLine(s))]
      .filter((part) => part.length >= 14);
    return Array.from(new Set(chunks)).sort((a, b) => b.length - a.length);
  }

  private tokenizeSourceCandidates(candidates: string[]): string[] {
    return Array.from(new Set(
      candidates.join(" ").toLowerCase().split(/[^a-z0-9]+/g)
        .filter((token) => token.length >= 4 && !SOURCE_TOKEN_STOP_WORDS.has(token)),
    ));
  }

  private scoreLineForTokens(line: string, tokens: string[]): number {
    const lower = String(line || "").toLowerCase();
    let score = 0;
    for (const token of tokens) if (lower.includes(token)) score += 1;
    return score;
  }

  private isMarkdownHeading(line: string): boolean {
    return /^\s*#{1,6}\s+/.test(line);
  }

  private isListLikeLine(line: string): boolean {
    return /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line);
  }

  private lineStartOffsets(lines: string[]): number[] {
    const starts = Array.from({ length: lines.length }, () => 0);
    let cursor = 0;
    for (let i = 0; i < lines.length; i++) {
      starts[i] = cursor;
      cursor += lines[i].length + 1;
    }
    return starts;
  }

  private rangeFromLineIndexes(
    haystack: string,
    lines: string[],
    lineStarts: number[],
    startLine: number,
    endLine: number,
  ): { start: number; end: number } | null {
    if (!lines.length) return null;
    const safeStartLine = Math.max(0, Math.min(lines.length - 1, startLine));
    const safeEndLine = Math.max(safeStartLine, Math.min(lines.length - 1, endLine));
    const start = lineStarts[safeStartLine] ?? 0;
    const endBase = lineStarts[safeEndLine] ?? 0;
    const end = Math.min(haystack.length, endBase + Math.max(1, (lines[safeEndLine] || "").length));
    if (end <= start) return null;
    return { start, end };
  }

  private findHeadingSectionRange(
    haystack: string,
    lines: string[],
    lineStarts: number[],
    bestLine: number,
    lineScores: number[],
    tokens: string[],
  ): { start: number; end: number } | null {
    const minLine = Math.max(0, bestLine - 20);
    for (let i = bestLine; i >= minLine; i--) {
      if (!this.isMarkdownHeading(lines[i] || "")) continue;
      let nextHeading = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        if (this.isMarkdownHeading(lines[j] || "")) { nextHeading = j; break; }
      }

      const headingScore = this.scoreLineForTokens(lines[i] || "", tokens);
      let sectionScore = 0;
      for (let j = i + 1; j < nextHeading; j++) sectionScore += lineScores[j] || 0;
      if (headingScore <= 0 && sectionScore <= 0) continue;

      let endLine = Math.max(i, nextHeading - 1);
      while (endLine > i && !String(lines[endLine] || "").trim()) endLine -= 1;
      const range = this.rangeFromLineIndexes(haystack, lines, lineStarts, i, endLine);
      if (range) return range;
    }
    return null;
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
      if (text.charCodeAt(i) === 10) { line += 1; lineStart = i + 1; }
    }
    return { line, ch: safeOffset - lineStart };
  }

  private findBestSuggestionRange(noteContent: string, suggestion: StudyAssistantSuggestion): { start: number; end: number } | null {
    const haystack = String(noteContent || "");
    if (!haystack.trim()) return null;
    const lower = haystack.toLowerCase();
    const candidates = this.buildSourceCandidates(suggestion);
    const tokens = this.tokenizeSourceCandidates(candidates);
    const lines = haystack.split(/\r?\n/);
    const lineStarts = this.lineStartOffsets(lines);

    for (const candidate of candidates) {
      const idx = lower.indexOf(candidate.toLowerCase());
      if (idx >= 0) {
        const lineMatch = this.offsetToPos(haystack, idx).line;
        const lineScores = lines.map((line) => this.scoreLineForTokens(line, tokens));
        const headingRange = this.findHeadingSectionRange(haystack, lines, lineStarts, lineMatch, lineScores, tokens);
        if (headingRange) return headingRange;

        let startLine = lineMatch;
        let endLine = lineMatch;
        while (startLine > 0) {
          const prev = String(lines[startLine - 1] || "");
          if (!prev.trim()) break;
          if ((lineScores[startLine - 1] || 0) <= 0 && !this.isListLikeLine(prev) && !this.isMarkdownHeading(prev)) break;
          startLine -= 1;
        }
        while (endLine < lines.length - 1) {
          const next = String(lines[endLine + 1] || "");
          if (!next.trim()) break;
          if ((lineScores[endLine + 1] || 0) <= 0 && !this.isListLikeLine(next)) break;
          endLine += 1;
        }
        return this.rangeFromLineIndexes(haystack, lines, lineStarts, startLine, endLine)
          ?? { start: idx, end: Math.min(haystack.length, idx + Math.max(1, candidate.length)) };
      }
    }

    if (!tokens.length) return null;

    let bestLine = -1;
    let bestScore = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = String(lines[i] || "");
      if (!line.trim()) continue;
      const score = this.scoreLineForTokens(line, tokens);
      if (score > bestScore) { bestScore = score; bestLine = i; }
    }
    if (bestLine < 0 || bestScore < 2) return null;

    const lineScores = lines.map((line) => this.scoreLineForTokens(line, tokens));
    const headingRange = this.findHeadingSectionRange(haystack, lines, lineStarts, bestLine, lineScores, tokens);
    if (headingRange) return headingRange;

    let startLine = bestLine;
    let endLine = bestLine;
    while (startLine > 0) {
      const prev = String(lines[startLine - 1] || "");
      if (!prev.trim()) break;
      if ((lineScores[startLine - 1] || 0) <= 0 && !this.isListLikeLine(prev) && !this.isMarkdownHeading(prev)) break;
      startLine -= 1;
    }
    while (endLine < lines.length - 1) {
      const next = String(lines[endLine + 1] || "");
      if (!next.trim()) break;
      if ((lineScores[endLine + 1] || 0) <= 0 && !this.isListLikeLine(next)) break;
      endLine += 1;
    }

    return this.rangeFromLineIndexes(haystack, lines, lineStarts, startLine, endLine)
      ?? this.rangeFromLineIndexes(haystack, lines, lineStarts, bestLine, bestLine);
  }

  private async focusSuggestionSource(suggestion: StudyAssistantSuggestion): Promise<void> {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      new Notice(this._tx("ui.studyAssistant.generator.noNote", "Open a markdown note to insert generated cards."));
      return;
    }
    const noteContent = await this.readActiveMarkdown(file);
    const match = this.findBestSuggestionRange(noteContent, suggestion);
    const leaf = this.plugin.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: "markdown", state: { file: file.path, mode: "source" }, active: true }, { focus: true });
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;
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

  // ---------------------------------------------------------------------------
  //  Suggestion summary rendering
  // ---------------------------------------------------------------------------

  private appendSuggestionText(parent: HTMLElement, value: string, cls = "sprout-assistant-popup-suggestion-line"): void {
    if (!value) return;
    parent.createEl("p", { cls, text: value });
  }

  private renderDifficultyStars(parent: HTMLElement, difficulty: number): void {
    const stars = parent.createDiv({ cls: "sprout-assistant-popup-suggestion-stars" });
    const level = Math.max(1, Math.min(3, Math.round(Number(difficulty) || 1)));
    for (let i = 1; i <= 3; i++) {
      const star = stars.createSpan({ cls: "sprout-assistant-popup-suggestion-star", text: "★" });
      if (i <= level) star.addClass("is-active");
    }
  }

  private renderSuggestionSummary(parent: HTMLElement, suggestion: StudyAssistantSuggestion): void {
    const data = this.parseSuggestionRows(suggestion);
    const summary = parent.createDiv({ cls: "sprout-assistant-popup-suggestion-summary" });

    if (suggestion.type === "basic" || suggestion.type === "reversed") {
      this.appendSuggestionText(summary, data.question, "sprout-assistant-popup-suggestion-question");
      this.appendSuggestionText(summary, data.answer, "sprout-assistant-popup-suggestion-answer");
    } else if (suggestion.type === "mcq") {
      this.appendSuggestionText(summary, data.question, "sprout-assistant-popup-suggestion-question");
      if (data.options.length) {
        const correct = new Set(data.correctOptionIndexes);
        const ul = summary.createEl("ul", { cls: "sprout-assistant-popup-suggestion-list" });
        data.options.forEach((opt, idx) => {
          const li = ul.createEl("li");
          if (correct.has(idx)) li.createEl("strong", { text: opt });
          else li.setText(opt);
        });
      }
    } else if (suggestion.type === "oq") {
      this.appendSuggestionText(summary, data.question, "sprout-assistant-popup-suggestion-question");
      if (data.steps.length) {
        const ol = summary.createEl("ol", { cls: "sprout-assistant-popup-suggestion-list" });
        for (const step of data.steps) ol.createEl("li", { text: step });
      }
    } else if (suggestion.type === "cloze") {
      this.appendSuggestionText(summary, data.clozeText, "sprout-assistant-popup-suggestion-question");
    } else if (suggestion.type === "io") {
      this.appendSuggestionText(summary, data.ioSrc || this._tx("ui.studyAssistant.generator.io", "Image occlusion card"), "sprout-assistant-popup-suggestion-question");
      if (data.ioSrc) this.renderIoSuggestionPreview(summary, data.ioSrc, suggestion.ioOcclusions);
    } else {
      const fallback = this.trimLine(suggestion.question || suggestion.clozeText || suggestion.title || "");
      this.appendSuggestionText(summary, fallback, "sprout-assistant-popup-suggestion-question");
    }
  }

  // ---------------------------------------------------------------------------
  //  DOM setup
  // ---------------------------------------------------------------------------

  private ensurePopup(): void {
    if (this.popupEl) return;
    const popup = document.createElement("div");
    popup.className = "sprout sprout-assistant-popup is-hidden";
    this._attachToBestHost(popup);
    this.popupEl = popup as unknown as HTMLDivElement;
  }

  private _schedulePopupHeightSync(): void {
    if (!this.popupEl || this.popupEl.hasClass("is-hidden")) return;
    if (this._popupHeightFrame != null) cancelAnimationFrame(this._popupHeightFrame);

    this._popupHeightFrame = requestAnimationFrame(() => {
      this._popupHeightFrame = null;
      if (!this.popupEl || this.popupEl.hasClass("is-hidden")) return;

      const popup = this.popupEl;
      const viewportCap = Math.min(700, Math.max(360, Math.floor(window.innerHeight * 0.6)));

      // Measure natural content height first, then lock to the tallest observed height.
      setCssProps(popup, "height", "auto");
      const naturalHeight = Math.ceil(popup.getBoundingClientRect().height);
      if (naturalHeight > this._maxObservedPopupHeight) this._maxObservedPopupHeight = naturalHeight;

      const targetHeight = Math.min(this._maxObservedPopupHeight, viewportCap);
      if (targetHeight > 0) setCssProps(popup, "height", `${targetHeight}px`);
    });
  }

  // ---------------------------------------------------------------------------
  //  Mode button
  // ---------------------------------------------------------------------------

  private _buildModeButton(parent: HTMLElement, mode: AssistantMode, label: string, icon: string): void {
    const btn = parent.createEl("button", { cls: "sprout-assistant-popup-mode-btn" });
    btn.type = "button";
    btn.toggleClass("is-active", this.mode === mode);
    setIcon(btn, icon);
    btn.createSpan({ text: label });
    btn.addEventListener("click", () => {
      this.reviewDepthMenuOpen = false;
      this.mode = mode;
      this.render();
    });
  }

  // ---------------------------------------------------------------------------
  //  Render
  // ---------------------------------------------------------------------------

  render(): void {
    if (!this.popupEl) return;

    this._reviewDepthMenuAbort?.abort();
    this._reviewDepthMenuAbort = null;
    this._headerMenuAbort?.abort();
    this._headerMenuAbort = null;

    const root = this.popupEl;
    root.empty();

    // ---- Header ----
    const header = root.createDiv({ cls: "sprout-assistant-popup-header" });
    const headerLeft = header.createDiv({ cls: "sprout-assistant-popup-header-left" });
    headerLeft.createDiv({ cls: "sprout-assistant-popup-header-title", text: "Sprig" });

    const noteName = this.getActiveNoteDisplayName();
    if (noteName) {
      headerLeft.createDiv({ cls: "sprout-assistant-popup-header-note", text: noteName });
    }

    const headerActions = header.createDiv({ cls: "sprout-assistant-popup-header-actions" });
    const menuWrap = headerActions.createDiv({ cls: "sprout-assistant-popup-header-menu" });

    const menuBtn = menuWrap.createEl("button", { cls: "sprout-assistant-popup-overflow" });
    menuBtn.type = "button";
    menuBtn.setAttribute("aria-label", this._tx("ui.studyAssistant.chat.actions", "Chat actions"));
    menuBtn.setAttribute("aria-haspopup", "menu");
    menuBtn.setAttribute("aria-expanded", this._headerMenuOpen ? "true" : "false");
    menuBtn.setAttribute("data-tooltip-position", "top");
    setIcon(menuBtn, "ellipsis");
    menuBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._headerMenuOpen = !this._headerMenuOpen;
      this.render();
    });

    const menuPopover = menuWrap.createDiv({
      cls: "sprout-assistant-popup-header-popover rounded-lg border border-border bg-popover text-popover-foreground shadow-lg",
    });
    menuPopover.setAttribute("role", "menu");
    menuPopover.setAttribute("aria-hidden", this._headerMenuOpen ? "false" : "true");
    menuPopover.toggleClass("is-open", this._headerMenuOpen);
    const menuList = menuPopover.createDiv({ cls: "sprout-assistant-popup-header-menu-list" });

    const openGuide = menuList.createDiv({ cls: "sprout-assistant-popup-header-menu-item" });
    openGuide.setAttribute("role", "menuitem");
    openGuide.setAttribute("tabindex", "0");
    const openGuideIcon = openGuide.createSpan({ cls: "sprout-assistant-popup-header-menu-icon" });
    openGuideIcon.setAttribute("aria-hidden", "true");
    setIcon(openGuideIcon, "book-open");
    openGuide.createSpan({ text: this._tx("ui.studyAssistant.chat.openGuide", "Open assistant guide") });
    openGuide.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._headerMenuOpen = false;
      this.render();
      void this.plugin.openSettingsTab(false, "guide");
    });
    openGuide.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      this._headerMenuOpen = false;
      this.render();
      void this.plugin.openSettingsTab(false, "guide");
    });

    const openSettings = menuList.createDiv({ cls: "sprout-assistant-popup-header-menu-item" });
    openSettings.setAttribute("role", "menuitem");
    openSettings.setAttribute("tabindex", "0");
    const openSettingsIcon = openSettings.createSpan({ cls: "sprout-assistant-popup-header-menu-icon" });
    openSettingsIcon.setAttribute("aria-hidden", "true");
    setIcon(openSettingsIcon, "settings");
    openSettings.createSpan({ text: this._tx("ui.studyAssistant.chat.openSettings", "Open assistant settings") });
    openSettings.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._headerMenuOpen = false;
      this.render();
      void this.plugin.openSettingsTab(false, "assistant");
    });
    openSettings.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      this._headerMenuOpen = false;
      this.render();
      void this.plugin.openSettingsTab(false, "assistant");
    });

    const menuDivider = menuList.createDiv({ cls: "sprout-assistant-popup-header-menu-divider" });
    menuDivider.setAttribute("role", "separator");

    const resetCurrent = menuList.createDiv({ cls: "sprout-assistant-popup-header-menu-item" });
    resetCurrent.setAttribute("role", "menuitem");
    resetCurrent.setAttribute("tabindex", "0");
    const resetCurrentIcon = resetCurrent.createSpan({ cls: "sprout-assistant-popup-header-menu-icon" });
    resetCurrentIcon.setAttribute("aria-hidden", "true");
    setIcon(resetCurrentIcon, "history");
    resetCurrent.createSpan({ text: this._tx("ui.studyAssistant.chat.resetCurrent", "Reset this conversation") });
    resetCurrent.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._headerMenuOpen = false;
      this._resetCurrentModeConversation();
    });
    resetCurrent.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      this._headerMenuOpen = false;
      this._resetCurrentModeConversation();
    });

    const clearAll = menuList.createDiv({ cls: "sprout-assistant-popup-header-menu-item" });
    clearAll.setAttribute("role", "menuitem");
    clearAll.setAttribute("tabindex", "0");
    const clearAllIcon = clearAll.createSpan({ cls: "sprout-assistant-popup-header-menu-icon" });
    clearAllIcon.setAttribute("aria-hidden", "true");
    setIcon(clearAllIcon, "trash");
    clearAll.createSpan({ text: this._tx("ui.studyAssistant.chat.deleteAllConversations", "Delete all conversations") });
    clearAll.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._headerMenuOpen = false;
      void this._deleteAllConversations();
    });
    clearAll.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      this._headerMenuOpen = false;
      void this._deleteAllConversations();
    });

    if (this._headerMenuOpen) {
      const controller = new AbortController();
      this._headerMenuAbort = controller;
      document.addEventListener("mousedown", (e) => {
        const target = e.target as Node;
        // Keep clicks on header actions (menu and close button) intact.
        // Rendering here would remove the close button before its click event fires.
        if (!headerActions.contains(target)) {
          this._headerMenuOpen = false;
          this.render();
        }
      }, { signal: controller.signal });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          this._headerMenuOpen = false;
          this.render();
        }
      }, { signal: controller.signal });
    }

    const closeBtn = headerActions.createEl("button", { cls: "sprout-assistant-popup-close" });
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.setAttribute("data-tooltip-position", "top");
    setIcon(closeBtn, "x");
    const closePopup = (e?: Event): void => {
      if (e) {
        e.stopPropagation();
        e.preventDefault();
      }
      // Guard against the same pointer sequence toggling the trigger underneath.
      this._suppressToggleUntil = Date.now() + 260;
      this.close();
    };
    closeBtn.addEventListener("pointerdown", (e) => {
      closePopup(e);
    });
    closeBtn.addEventListener("click", (e) => {
      closePopup(e);
    });
    closeBtn.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      closePopup(e);
    });

    // ---- Mode toolbar ----
    const toolbar = root.createDiv({ cls: "sprout-assistant-popup-toolbar" });
    this._buildModeButton(toolbar, "assistant", this._tx("ui.studyAssistant.mode.assistant", "Ask"), "message-circle-question-mark");
    this._buildModeButton(toolbar, "review", this._tx("ui.studyAssistant.mode.review", "Review"), "clipboard-check");
    this._buildModeButton(toolbar, "generate", this._tx("ui.studyAssistant.mode.generator", "Generate"), "wand-sparkles");

    // ---- Content ----
    const content = root.createDiv({ cls: "sprout-assistant-popup-content" });

    if (this.mode === "assistant") {
      this.renderAssistantMode(content);
    } else if (this.mode === "review") {
      this.renderReviewMode(content);
    } else {
      this.renderGenerateMode(content);
    }

    this._schedulePopupHeightSync();
  }

  // ---------------------------------------------------------------------------
  //  Ask mode
  // ---------------------------------------------------------------------------

  private renderAssistantMode(parent: HTMLElement): void {
    const chatWrap = parent.createDiv({ cls: "sprout-assistant-popup-chat-wrap" });
    const userInitial = this.getUserAvatarInitial();

    const messages = this.chatMessages;
    if (!messages.length) {
      // Default welcome message
      const welcomeRow = chatWrap.createDiv({ cls: "sprout-assistant-popup-message-row is-assistant" });
      this.createAssistantAvatar(welcomeRow);
      const welcomeBubble = welcomeRow.createDiv({ cls: "sprout-assistant-popup-message-bubble is-assistant" });
      const noteName = this.getActiveNoteDisplayName() || this._tx("ui.studyAssistant.chat.currentNoteFallback", "this note");
      this.renderMarkdownMessage(
        welcomeBubble,
        [
          this._tx(
            "ui.studyAssistant.chat.welcome",
            "Hi, I'm Sprig \u2014 your learning assistant. You can ask me questions about your notes, get help reviewing them, or have me suggest flashcards for Sprout.",
          ),
          "",
          this._tx(
            "ui.studyAssistant.chat.welcome.currentNote",
            "Would you like to start with a question about the current note, **{name}**?",
            { name: noteName },
          ),
        ].join("\n"),
      );
    } else {
      for (const msg of messages) {
        const row = chatWrap.createDiv({
          cls: `sprout-assistant-popup-message-row ${msg.role === "user" ? "is-user" : "is-assistant"}`,
        });
        if (msg.role === "assistant") {
          this.createAssistantAvatar(row);
        }

        const bubble = row.createDiv({
          cls: `sprout-assistant-popup-message-bubble ${msg.role === "user" ? "is-user" : "is-assistant"}`,
        });
        this.renderMarkdownMessage(bubble, msg.text);

        if (msg.role === "user" && userInitial) {
          this.createUserAvatar(row, userInitial);
        }

        if (msg.role === "assistant" && this._shouldShowGenerateSwitch(msg.text)) {
          this._renderSwitchToGenerateButton(chatWrap);
        }
      }
    }

    if (this.isSendingChat) {
      const typingRow = chatWrap.createDiv({ cls: "sprout-assistant-popup-message-row is-assistant" });
      this.createAssistantAvatar(typingRow);
      const typingBubble = typingRow.createDiv({ cls: "sprout-assistant-popup-message-bubble is-assistant" });
      typingBubble.createDiv({ cls: "sprout-assistant-popup-typing" });
    }

    if (this.chatError) this.renderAssistantErrorBubble(chatWrap, this.chatError);

    // Auto-scroll to bottom
    requestAnimationFrame(() => { chatWrap.scrollTop = chatWrap.scrollHeight; });

    // ---- Composer ----
    const composer = parent.createDiv({ cls: "sprout-assistant-popup-composer" });
    const shell = composer.createDiv({ cls: "sprout-assistant-popup-composer-shell" });
    const input = shell.createEl("textarea", { cls: "sprout-assistant-popup-input" });
    input.rows = 1;
    input.value = this.chatDraft;
    input.placeholder = this._tx("ui.studyAssistant.chat.askPlaceholder", "Ask Sprig about this note...");
    input.disabled = this.isSendingChat;
    input.addEventListener("input", () => {
      this.chatDraft = input.value;
      // Auto-resize
      setCssProps(input, "height", "auto");
      setCssProps(input, "height", `${Math.min(input.scrollHeight, 120)}px`);
    });
    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void this.sendChatMessage();
      }
    });

    const sendBtn = shell.createEl("button", { cls: "sprout-assistant-popup-send" });
    sendBtn.type = "button";
    sendBtn.disabled = this.isSendingChat;
    sendBtn.setAttribute("aria-label", "Send");
    setIcon(sendBtn, this.isSendingChat ? "loader-2" : "arrow-up");
    sendBtn.addEventListener("click", () => void this.sendChatMessage());

    // Focus input when opening
    requestAnimationFrame(() => input.focus());
  }

  // ---------------------------------------------------------------------------
  //  Review mode
  // ---------------------------------------------------------------------------

  private renderReviewMode(parent: HTMLElement): void {
    const chatWrap = parent.createDiv({ cls: "sprout-assistant-popup-chat-wrap" });
    const userInitial = this.getUserAvatarInitial();

    if (!this.reviewMessages.length) {
      const welcomeRow = chatWrap.createDiv({ cls: "sprout-assistant-popup-message-row is-assistant" });
      this.createAssistantAvatar(welcomeRow);
      const welcomeBubble = welcomeRow.createDiv({ cls: "sprout-assistant-popup-message-bubble is-assistant" });
      const reviewNoteName = this.getActiveNoteDisplayName() || this._tx("ui.studyAssistant.chat.currentNoteFallback", "this note");
      this.renderMarkdownMessage(
        welcomeBubble,
        this._tx(
          "ui.studyAssistant.review.welcome",
          "Would you like a quick review or a comprehensive review of **{name}**?",
          { name: reviewNoteName },
        ),
      );

      const starters = chatWrap.createDiv({ cls: "sprout-assistant-popup-review-starters" });
      const quickBtn = starters.createEl("button", { cls: "sprout-assistant-popup-btn", text: this._tx("ui.studyAssistant.review.depth.quickReview", "Quick review") });
      quickBtn.type = "button";
      quickBtn.disabled = this.isReviewingNote;
      quickBtn.addEventListener("click", () => void this.sendReviewMessage(this._tx("ui.studyAssistant.review.depth.quickReview", "Quick review"), "quick"));

      const comprehensiveBtn = starters.createEl("button", { cls: "sprout-assistant-popup-btn", text: this._tx("ui.studyAssistant.review.depth.comprehensiveReview", "Comprehensive review") });
      comprehensiveBtn.type = "button";
      comprehensiveBtn.disabled = this.isReviewingNote;
      comprehensiveBtn.addEventListener("click", () => void this.sendReviewMessage(this._tx("ui.studyAssistant.review.depth.comprehensiveReview", "Comprehensive review"), "comprehensive"));
    } else {
      for (const msg of this.reviewMessages) {
        const row = chatWrap.createDiv({ cls: `sprout-assistant-popup-message-row ${msg.role === "user" ? "is-user" : "is-assistant"}` });
        if (msg.role === "assistant") {
          this.createAssistantAvatar(row);
        }
        const bubble = row.createDiv({ cls: `sprout-assistant-popup-message-bubble ${msg.role === "user" ? "is-user" : "is-assistant"}` });
        this.renderMarkdownMessage(bubble, msg.text);
        if (msg.role === "user" && userInitial) {
          this.createUserAvatar(row, userInitial);
        }

        if (msg.role === "assistant" && this._shouldShowGenerateSwitch(msg.text)) {
          this._renderSwitchToGenerateButton(chatWrap);
        }
      }
    }

    if (this.isReviewingNote) {
      const typingRow = chatWrap.createDiv({ cls: "sprout-assistant-popup-message-row is-assistant" });
      this.createAssistantAvatar(typingRow);
      const typingBubble = typingRow.createDiv({ cls: "sprout-assistant-popup-message-bubble is-assistant" });
      typingBubble.createDiv({ cls: "sprout-assistant-popup-typing" });
    }

    if (this.reviewError) this.renderAssistantErrorBubble(chatWrap, this.reviewError);

    requestAnimationFrame(() => { chatWrap.scrollTop = chatWrap.scrollHeight; });

    const composer = parent.createDiv({ cls: "sprout-assistant-popup-composer" });
    const shell = composer.createDiv({ cls: "sprout-assistant-popup-composer-shell" });
    const input = shell.createEl("textarea", { cls: "sprout-assistant-popup-input" });
    input.rows = 1;
    input.value = this.reviewDraft;
    input.placeholder = this._tx("ui.studyAssistant.review.askPlaceholder", "Ask a follow-up about this review...");
    input.disabled = this.isReviewingNote;
    input.addEventListener("input", () => {
      this.reviewDraft = input.value;
      setCssProps(input, "height", "auto");
      setCssProps(input, "height", `${Math.min(input.scrollHeight, 120)}px`);
    });
    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const draft = this.reviewDraft.trim();
        this.reviewDraft = "";
        input.value = "";
        void this.sendReviewMessage(draft);
      }
    });

    const sendBtn = shell.createEl("button", { cls: "sprout-assistant-popup-send" });
    sendBtn.type = "button";
    sendBtn.disabled = this.isReviewingNote;
    sendBtn.setAttribute("aria-label", this._tx("ui.studyAssistant.chat.send", "Send"));
    sendBtn.setAttribute("data-tooltip-position", "top");
    setIcon(sendBtn, this.isReviewingNote ? "loader-2" : "arrow-up");
    sendBtn.addEventListener("click", () => {
      const draft = this.reviewDraft.trim();
      this.reviewDraft = "";
      input.value = "";
      void this.sendReviewMessage(draft);
    });

    requestAnimationFrame(() => input.focus());
  }

  private createAssistantAvatar(parent: HTMLElement): HTMLDivElement {
    const avatar = parent.createDiv({ cls: "sprout-assistant-popup-message-avatar is-assistant" });
    setIcon(avatar, "sprout-brand");
    avatar.setAttribute("aria-hidden", "true");
    return avatar;
  }

  private createWarningAvatar(parent: HTMLElement): HTMLDivElement {
    const avatar = parent.createDiv({ cls: "sprout-assistant-popup-message-avatar is-assistant is-error" });
    setIcon(avatar, "triangle-alert");
    avatar.setAttribute("aria-hidden", "true");
    return avatar;
  }

  private renderAssistantErrorBubble(parent: HTMLElement, text: string): void {
    const row = parent.createDiv({ cls: "sprout-assistant-popup-message-row is-assistant is-error" });
    this.createWarningAvatar(row);
    const bubble = row.createDiv({ cls: "sprout-assistant-popup-message-bubble is-assistant is-error" });
    bubble.createEl("p", { cls: "sprout-assistant-popup-error", text });
  }

  private createUserAvatar(parent: HTMLElement, initial: string): HTMLDivElement {
    const avatar = parent.createDiv({
      cls: "sprout-assistant-popup-message-avatar is-user",
      text: initial,
    });
    avatar.setAttribute("aria-hidden", "true");
    return avatar;
  }

  private getUserAvatarInitial(): string {
    const name = String(this.plugin.settings?.general?.userName ?? "").trim();
    if (!name) return "";
    const first = Array.from(name)[0];
    return first ? first.toLocaleUpperCase() : "";
  }

  // ---------------------------------------------------------------------------
  //  Generate mode
  // ---------------------------------------------------------------------------

  private renderGenerateMode(parent: HTMLElement): void {
    const chatWrap = parent.createDiv({ cls: "sprout-assistant-popup-chat-wrap" });
    const userInitial = this.getUserAvatarInitial();
    const activeNoteName = this.getActiveNoteDisplayName();
    const generateTooltip = activeNoteName
      ? this._tx("ui.studyAssistant.generator.generateFor", "Generate flashcards for {name}", { name: activeNoteName })
      : this._tx("ui.studyAssistant.generator.generate", "Generate flashcards");
    const hasGenerationActivity = this.generateMessages.length > 0 || this.isGenerating || this.suggestions.length > 0 || !!this.generatorError;

    if (!hasGenerationActivity) {
      const welcomeRow = chatWrap.createDiv({ cls: "sprout-assistant-popup-message-row is-assistant" });
      this.createAssistantAvatar(welcomeRow);
      const welcomeBubble = welcomeRow.createDiv({ cls: "sprout-assistant-popup-message-bubble is-assistant" });
      this.renderMarkdownMessage(
        welcomeBubble,
        this._tx(
          "ui.studyAssistant.generator.welcome",
          "Ready to generate flashcards on **{name}**?",
          { name: activeNoteName || this._tx("ui.studyAssistant.chat.currentNoteFallback", "this note") },
        ),
      );

      const starters = chatWrap.createDiv({ cls: "sprout-assistant-popup-generate-starters" });
      const generateBtn = starters.createEl("button", {
        cls: "sprout-assistant-popup-btn",
        text: this._tx("ui.studyAssistant.generator.generate", "Generate flashcards"),
      });
      generateBtn.type = "button";
      generateBtn.disabled = this.isGenerating;
      generateBtn.setAttr("aria-label", generateTooltip);
      generateBtn.setAttr("data-tooltip-position", "top");
      generateBtn.addEventListener("click", () => {
        const seedMessage = this._tx("ui.studyAssistant.generator.generate", "Generate flashcards");
        this.generateMessages.push({ role: "user", text: seedMessage });
        void this.generateSuggestions(seedMessage);
      });
    } else {
      for (let i = 0; i < this.generateMessages.length; i += 1) {
        const msg = this.generateMessages[i];
        const row = chatWrap.createDiv({ cls: `sprout-assistant-popup-message-row ${msg.role === "user" ? "is-user" : "is-assistant"}` });
        if (msg.role === "assistant") this.createAssistantAvatar(row);
        const bubble = row.createDiv({ cls: `sprout-assistant-popup-message-bubble ${msg.role === "user" ? "is-user" : "is-assistant"}` });
        this.renderMarkdownMessage(bubble, msg.text);
        if (msg.role === "user" && userInitial) this.createUserAvatar(row, userInitial);

        const isLastAssistant = msg.role === "assistant" && i === this.generateMessages.length - 1;
        if (isLastAssistant && this.suggestions.length) {
          const list = bubble.createDiv({ cls: "sprout-assistant-popup-generated-cards" });
          this.suggestions.forEach((suggestion, idx) => {
            const key = `${idx}-${suggestion.type}`;
            const isBusy = this.insertingSuggestionKey === key;
            const disableInsert = this.isInsertingSuggestion || isBusy;
            const typeLabelMap: Record<string, string> = {
              basic: "Basic",
              reversed: "Basic (Reversed)",
              cloze: "Cloze",
              mcq: "Multiple Choice",
              oq: "Ordered Question",
              io: "Image Occlusion",
            };
            const typeLabel = typeLabelMap[suggestion.type] ?? String(suggestion.type || "");

            const item = list.createDiv({ cls: "sprout-assistant-popup-generated-card" });
            const isNoteBased = suggestion.sourceOrigin !== "external";
            if (isNoteBased) {
              item.addClass("is-clickable");
              item.addEventListener("click", (evt) => {
                const target = evt.target instanceof HTMLElement ? evt.target : null;
                if (target?.closest(".sprout-assistant-popup-insert-btn")) return;
                void this.focusSuggestionSource(suggestion);
              });
            }
            const header = item.createDiv({ cls: "sprout-assistant-popup-generated-card-header" });
            header.createEl("span", { cls: "sprout-assistant-popup-generated-card-type", text: typeLabel });
            this.renderDifficultyStars(header, suggestion.difficulty);

            this.renderSuggestionSummary(item, suggestion);

            const insertBtn = item.createEl("button", { cls: "sprout-assistant-popup-insert-btn" });
            insertBtn.type = "button";
            insertBtn.disabled = disableInsert;
            insertBtn.setAttr("data-tooltip-position", "top");
            setIcon(insertBtn, isBusy ? "loader-2" : "plus");
            insertBtn.addEventListener("click", (evt) => {
              evt.stopPropagation();
              void this.insertSuggestion(suggestion, idx);
            });
          });
        }
      }

      if (this.isGenerating) {
        const typingRow = chatWrap.createDiv({ cls: "sprout-assistant-popup-message-row is-assistant" });
        this.createAssistantAvatar(typingRow);
        const typingBubble = typingRow.createDiv({ cls: "sprout-assistant-popup-message-bubble is-assistant" });
        typingBubble.createDiv({ cls: "sprout-assistant-popup-typing" });
      }
    }

    if (this.generatorError) this.renderAssistantErrorBubble(chatWrap, this.generatorError);

    requestAnimationFrame(() => { chatWrap.scrollTop = chatWrap.scrollHeight; });

    const composer = parent.createDiv({ cls: "sprout-assistant-popup-composer" });
    const shell = composer.createDiv({ cls: "sprout-assistant-popup-composer-shell" });
    const input = shell.createEl("textarea", { cls: "sprout-assistant-popup-input" });
    input.rows = 1;
    input.value = this.generateDraft;
    input.placeholder = this._tx("ui.studyAssistant.generator.askPlaceholder", "Ask for flashcards on a specific topic in this note...");
    input.disabled = this.isGenerating;
    input.addEventListener("input", () => {
      this.generateDraft = input.value;
      setCssProps(input, "height", "auto");
      setCssProps(input, "height", `${Math.min(input.scrollHeight, 120)}px`);
    });
    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void this.sendGenerateMessage();
      }
    });

    const sendBtn = shell.createEl("button", { cls: "sprout-assistant-popup-send" });
    sendBtn.type = "button";
    sendBtn.disabled = this.isGenerating;
    sendBtn.setAttribute("aria-label", this._tx("ui.studyAssistant.chat.send", "Send"));
    sendBtn.setAttribute("data-tooltip-position", "top");
    setIcon(sendBtn, this.isGenerating ? "loader-2" : "arrow-up");
    sendBtn.addEventListener("click", () => void this.sendGenerateMessage());

    requestAnimationFrame(() => input.focus());
  }
}
