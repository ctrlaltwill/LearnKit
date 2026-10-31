/**
 * @file src/platform/plugin/lifecycle-methods.ts
 * @summary Module for lifecycle methods.
 *
 * @exports
 *  - WithLifecycleMethods
 */

import { Notice, TAbstractFile, TFile, TFolder, Platform, type WorkspaceLeaf } from "obsidian";
import { LearnKitPluginBase, type Constructor } from "./plugin-base";

import {
  VIEW_TYPE_REVIEWER,
  VIEW_TYPE_WIDGET,
  VIEW_TYPE_STUDY_ASSISTANT,
  VIEW_TYPE_BROWSER,
  VIEW_TYPE_NOTE_REVIEW,
  VIEW_TYPE_ANALYTICS,
  VIEW_TYPE_HOME,
  VIEW_TYPE_SETTINGS,
  VIEW_TYPE_EXAM_GENERATOR,
  VIEW_TYPE_COACH,
  LEGACY_VIEW_TYPE_REVIEWER,
  LEGACY_VIEW_TYPE_WIDGET,
  LEGACY_VIEW_TYPE_STUDY_ASSISTANT,
  LEGACY_VIEW_TYPE_BROWSER,
  LEGACY_VIEW_TYPE_ANALYTICS,
  LEGACY_VIEW_TYPE_HOME,
  LEGACY_VIEW_TYPE_SETTINGS,
  LEGACY_VIEW_TYPE_EXAM_GENERATOR,
  LEGACY_VIEW_TYPE_COACH,
  LEGACY_TO_CURRENT_VIEW_TYPES,
  BRAND,
  DEFAULT_SETTINGS,
  deepMerge,
  type LearnKitSettings,
} from "../core/constants";
import { log } from "../core/logger";
import { isPlainObject, type FlashcardType } from "../core/utils";
import { registerReadingViewPrettyCards, teardownReadingView } from "../../views/reading/reading-view";
import { editDecorationExtension } from "../../views/study-assistant/editor/edit-decorations";
import { removeAosErrorHandler } from "../core/aos-loader";
import { initMobileKeyboardHandler, cleanupMobileKeyboardHandler } from "../core/mobile-keyboard-handler";
import { loadFlagCacheFromDataJson } from "../flags/flag-tokens";

import { JsonStore } from "../core/store";
import { SqliteStore, isSqliteDatabasePresent, reconcileAllDbsFromVaultSync } from "../core/sqlite-store";
import { migrateJsonToSqlite } from "../core/migration";
import { LearnKitReviewerView } from "../../views/reviewer/review-view";
import { LearnKitWidgetView } from "../../views/widget/view/widget-view";
import { LearnKitAssistantPopup } from "../../views/study-assistant/popup/assistant-popup";
import { LearnKitStudyAssistantView } from "../../views/study-assistant/view/study-assistant-view";
import { LearnKitCardBrowserView } from "../../views/browser/card-browser-view";
import { LearnKitAnalyticsView } from "../../views/analytics/analytics-view";
import { LearnKitHomeView } from "../../views/home/home-view";
import { LearnKitSettingsTab } from "../../views/settings/settings-tab";
import { LearnKitSettingsView } from "../../views/settings/view/settings-view";
import { LearnKitNoteReviewView } from "../../views/note-review/view/note-review-view";
import { LearnKitExamGeneratorView } from "../../views/exam-generator/exam-generator-view";
import { LearnKitCoachView } from "../../views/coach";
import { CoachPlanSqlite } from "../core/coach-plan-sqlite";
import { syncQuestionBank, findOrphanedCards, pruneOrphanedCards } from "../integrations/sync/sync-engine";
import { CardCreatorModal } from "../modals/card-creator-modal";
import { ParseErrorModal } from "../modals/parse-error-modal";
import { ConfirmCleanupOrphanedCardsModal } from "../../views/settings/confirm-modals";
import { setDelimiter } from "../core/delimiter";
import {
  initialiseDedicatedApiKeyStorage,
  initialiseDedicatedTtsApiKeyStorage,
  migrateLegacyConfigFiles,
} from "../core/settings-storage";
import { ReminderEngine } from "../../views/reminders/reminder-engine";
import { ensurePluginRuntimeState } from "./runtime-state";
import { getTtsService } from "../integrations/tts/tts-service";
import { getTtsCacheDirPath } from "../integrations/tts/tts-cache";
import { setLocaleFileReader, loadLocaleBundlesAsync } from "../translations/translator";

/**
 * View types that must be torn down when the plugin unloads.
 *
 * Obsidian does NOT close custom view leaves when a plugin unloads: the leaf, its DOM
 * and its event handlers survive, still pointing at the dead plugin instance. After a
 * plugin update that left buttons dead until Obsidian was restarted (GitHub #205 —
 * "Some sections in the Guide don't work when clicked"). Detaching on unload makes the
 * views rebuild against the live plugin instead.
 */
const LEARNKIT_VIEW_TYPES_TO_DETACH = [
  VIEW_TYPE_REVIEWER,
  VIEW_TYPE_NOTE_REVIEW,
  VIEW_TYPE_WIDGET,
  VIEW_TYPE_BROWSER,
  VIEW_TYPE_ANALYTICS,
  VIEW_TYPE_HOME,
  VIEW_TYPE_SETTINGS,
  VIEW_TYPE_EXAM_GENERATOR,
  VIEW_TYPE_COACH,
  VIEW_TYPE_STUDY_ASSISTANT,
] as const;

/** Marker class used by the Guide's body-portal dropdown in the settings view. */
const GUIDE_PORTAL_MARKER_SELECTOR = ".learnkit-guide-nav-group";

export function WithLifecycleMethods<T extends Constructor<LearnKitPluginBase>>(Base: T) {
  return class WithLifecycleMethods extends Base {
    /**
     * Closes every open LearnKit view so the next open constructs it from the current
     * plugin instance. See {@link LEARNKIT_VIEW_TYPES_TO_DETACH}.
     */
    _detachLearnKitLeaves(): void {
      const ws = this.app?.workspace;
      if (!ws) return;

      const types = new Set<string>(LEARNKIT_VIEW_TYPES_TO_DETACH);
      // Long-lived vaults can still hold leaves under the pre-rename ("sprout-*") ids.
      for (const legacy of Object.keys(LEGACY_TO_CURRENT_VIEW_TYPES)) types.add(legacy);

      // Remember whether the sidebar widget was open: it is the one view the user
      // expects to still be there after an update, and a reload gives us a fresh
      // module scope, so the flag has to live on the window.
      try {
        if (ws.getLeavesOfType(VIEW_TYPE_WIDGET).length > 0) {
          (window as unknown as Record<string, unknown>).__learnkitReopenWidget = true;
        }
      } catch (e) {
        log.swallow("record widget state before unload", e);
      }

      for (const type of types) {
        try {
          ws.detachLeavesOfType(type);
        } catch (e) {
          log.swallow(`detach leaves for ${type}`, e);
        }
      }
    }

    /**
     * Re-opens the sidebar widget when the previous plugin instance closed it on unload.
     * Pairs with {@link _detachLearnKitLeaves}.
     */
    _restoreWidgetAfterReload(): void {
      const flagKey = "__learnkitReopenWidget";
      const holder = window as unknown as Record<string, unknown>;
      if (holder[flagKey] !== true) return;
      holder[flagKey] = false;

      this.app.workspace.onLayoutReady(() => {
        void this.openWidgetSafe();
      });
    }

    /**
     * Re-points this plugin's card records after a note or folder is renamed/moved.
     *
     * GitHub #216: without this the records keep the old path, the sync engine can no
     * longer reconcile them, and deleted flashcards linger in the Library forever.
     */
    async _retargetCardsAfterMove(oldPath: string, newPath: string): Promise<void> {
      try {
        const moved = this.store?.retargetSourceNotePath?.(oldPath, newPath) ?? 0;
        if (moved <= 0) return;
        await this.store.persist();
        log.info(`rename: retargeted ${moved} card record(s) ${oldPath} -> ${newPath}`);
      } catch (e) {
        log.swallow(`retarget cards after move ${oldPath} -> ${newPath}`, e);
      }
    }

    /**
     * Command entry point: find flashcards whose source note no longer exists, confirm
     * with the user, then remove them (plus their children, scheduling state and any
     * cached audio).
     */
    async _runCleanupOrphanedCards(): Promise<void> {
      const orphans = findOrphanedCards(this);

      if (!orphans.length) {
        new Notice(this._tx("ui.notice.orphanCleanup.none", "No orphaned flashcards found."));
        return;
      }

      const byNote = new Map<string, number>();
      for (const orphan of orphans) {
        byNote.set(orphan.sourceNotePath, (byNote.get(orphan.sourceNotePath) ?? 0) + 1);
      }

      new ConfirmCleanupOrphanedCardsModal(
        this.app,
        this,
        orphans.length,
        Array.from(byNote.entries()).map(([path, count]) => ({ path, count })),
        async () => {
          const result = await pruneOrphanedCards(this);
          await this.store.persist();

          if (result.skippedReason === "vault-empty") {
            new Notice(
              this._tx(
                "ui.notice.orphanCleanup.skipped",
                "Skipped: the vault index is not ready yet (no notes found).",
              ),
            );
            return;
          }

          new Notice(
            this._tx(
              "ui.notice.orphanCleanup.done",
              "Removed {count} orphaned flashcard{suffix}.",
              { count: result.removed, suffix: result.removed === 1 ? "" : "s" },
            ),
          );
        },
      ).open();
    }

    /**
     * Removes Guide dropdown portals left on <body> by a previous plugin instance.
     *
     * The portal is appended to `document.body` and only removed in the settings view's
     * onClose — which Obsidian never calls for a plugin that is being unloaded. A
     * stranded portal sits above the content and swallows clicks, which is the other
     * half of GitHub #205.
     */
    _sweepOrphanedBodyPortals(): void {
      let ports: NodeListOf<Element>;
      try {
        ports = activeDocument.querySelectorAll("body > div.learnkit");
      } catch (e) {
        log.swallow("scan for orphaned portals", e);
        return;
      }

      for (const el of Array.from(ports)) {
        if (!el.querySelector(GUIDE_PORTAL_MARKER_SELECTOR)) continue;
        el.remove();
      }
    }

    _registerCommands(): void {
      const tx = (token: string, fallback: string) => this._tx(token, fallback);

      this._addCommand(
        "sync-flashcards-current-note",
        tx("ui.command.open.syncCurrentNote", "Sync flashcards from current note"),
        async () => this._runSyncCurrentNote(),
      );
      this._addCommand(
        "sync-flashcards",
        tx("ui.command.open.syncAll", "Sync all flashcards from the vault"),
        async () => this._runSync(),
      );
      this._addCommand(
        "cleanup-orphaned-flashcards",
        tx("ui.command.open.cleanupOrphaned", "Clean up orphaned flashcards"),
        async () => this._runCleanupOrphanedCards(),
      );
      this._addCommand("open", tx("ui.command.open.home", "Open home"), async () => this.openHomeTab());
      this._addCommand(
        "open-widget",
        tx("ui.command.open.studyWidget", "Open flashcard study widget"),
        async () => this.openWidgetSafe(),
      );
      this.addCommand({
        id: "open-assistant-widget",
        name: tx("ui.command.open.assistantWidget", "Open study companion widget"),
        checkCallback: (checking: boolean) => {
          if (!this.settings?.studyAssistant?.enabled) return false;
          if (!checking) void this.openAssistantWidgetSafe();
          return true;
        },
      });
      this._addCommand("open-analytics", tx("ui.command.open.analytics", "Open analytics"), async () => this.openAnalyticsTab());
      this._addCommand("open-settings", tx("ui.command.open.pluginSettings", "Open plugin settings"), () => this.openPluginSettingsInObsidian());
      this._addCommand("open-guide", tx("ui.command.open.guide", "Open guide"), async () => this.openSettingsTab(false, "guide"));
      this._addCommand("edit-flashcards", tx("ui.command.open.editFlashcards", "Edit flashcards"), async () => this.openBrowserTab());
      this._addCommand("new-study-session", tx("ui.command.open.newStudySession", "New study session"), async () => this.openReviewerTab());
      this._addCommand("open-note-review", tx("ui.command.open.noteReview", "Open note review"), async () => this.openNoteReviewTab());
      this._addCommand("open-exam-generator", tx("ui.command.open.tests", "Open Tests"), async () => this.openExamGeneratorTab());
      this._addCommand("open-coach", tx("ui.command.open.coach", "Open Coach"), async () => this.openCoachTab());

      const flashcardCommands: Array<{ id: string; name: string; type: FlashcardType }> = [
        { id: "add-basic-flashcard", name: tx("ui.command.open.addBasicToNote", "Add basic flashcard to note"), type: "basic" },
        { id: "add-basic-reversed-flashcard", name: tx("ui.command.open.addBasicReversedToNote", "Add basic (reversed) flashcard to note"), type: "reversed" },
        { id: "add-cloze-flashcard", name: tx("ui.command.open.addClozeToNote", "Add cloze flashcard to note"), type: "cloze" },
        { id: "add-multiple-choice-flashcard", name: tx("ui.command.open.addMultipleChoiceToNote", "Add multiple choice flashcard to note"), type: "mcq" },
        { id: "add-ordered-question-flashcard", name: tx("ui.command.open.addOrderedQuestionToNote", "Add ordered question flashcard to note"), type: "oq" },
        { id: "add-hotspot-flashcard", name: tx("ui.command.open.addHotspotToNote", "Add hotspot flashcard to note"), type: "hq" },
        { id: "add-image-occlusion-flashcard", name: tx("ui.command.open.addImageOcclusionToNote", "Add image occlusion flashcard to note"), type: "io" },
      ];

      for (const command of flashcardCommands) {
        this._addCommand(command.id, command.name, () => this.openAddFlashcardModal(command.type));
      }

      this._addCommand("import-anki", tx("ui.command.open.importAnki", "Import from Anki"), async () => {
        const { AnkiImportModal } = await import("../modals/anki-import-modal");
        new AnkiImportModal(this).open();
      });

      this._addCommand("export-anki", tx("ui.command.open.exportAnki", "Export to Anki (.apkg)"), async () => {
        const { AnkiExportModal } = await import("../modals/anki-export-modal");
        new AnkiExportModal(this).open();
      });
    }

    async onload(): Promise<void> {
      ensurePluginRuntimeState(this);
      try {
        this._initBasecoatRuntime();

        this._initButtonTooltipDefaults();

        initMobileKeyboardHandler();

        if (Platform.isPhone) activeDocument.body.classList.add("is-phone");

        // Drop any Guide dropdown portal stranded on <body> by a previous instance
        // (GitHub #205) before we build our own UI.
        this._sweepOrphanedBodyPortals();

        // Re-open the sidebar widget that the previous instance detached on unload.
        this._restoreWidgetAfterReload();

        this._bc = {
          VIEW_TYPE_REVIEWER,
          VIEW_TYPE_WIDGET,
          VIEW_TYPE_BROWSER,
          VIEW_TYPE_ANALYTICS,
          VIEW_TYPE_HOME,
          VIEW_TYPE_SETTINGS,
          BRAND,
          DEFAULT_SETTINGS,
          deepMerge,
          LearnKitReviewerView,
          LearnKitWidgetView,
          LearnKitCardBrowserView,
          LearnKitAnalyticsView,
          LearnKitHomeView,
          LearnKitSettingsView,
          LearnKitSettingsTab,
          syncQuestionBank,
          CardCreatorModal,
          ParseErrorModal,
        };

        const root = (await this.loadData()) as unknown;
        const rootObj = isPlainObject(root) ? root : {};

        // Hydrate the flag cache from data.json, its only persistent store.
        loadFlagCacheFromDataJson(rootObj.flagCache);

        const rootSettings = isPlainObject(rootObj.settings)
          ? (rootObj.settings as Partial<LearnKitSettings>)
          : {};
        this.settings = deepMerge(DEFAULT_SETTINGS, rootSettings);
        await migrateLegacyConfigFiles({
          adapter: this.app?.vault?.adapter,
          getConfigFilePath: (filename: string) => this._getConfigFilePath(filename),
          settings: this.settings,
        });
        this._migrateSettingsInPlace();
        this._normaliseSettingsInPlace();
        this._applyLearnKitThemePreset();
        this._applyLearnKitThemeAccentOverride();
        await initialiseDedicatedApiKeyStorage({
          adapter: this.app?.vault?.adapter,
          dirPath: this._getConfigDirPath(),
          filePath: this._getApiKeysFilePath(),
          settings: this.settings,
        });
        await initialiseDedicatedTtsApiKeyStorage({
          adapter: this.app?.vault?.adapter,
          dirPath: this._getConfigDirPath(),
          filePath: this._getTtsApiKeysFilePath(),
          settings: this.settings,
        });

        // Wire vault adapter into TTS service for external provider caching
        {
          const tts = getTtsService();
          tts.vaultAdapter = this.app?.vault?.adapter ?? null;
          const configDir = this.app?.vault?.configDir;
          const pluginId = this.manifest?.id;
          if (configDir && pluginId) {
            tts.ttsCacheDirPath = getTtsCacheDirPath(configDir, pluginId);
          }
        }

        this._registerLearnKitPinchZoom();

        setDelimiter(this.settings.indexing.delimiter ?? "|");

        await reconcileAllDbsFromVaultSync(this);

        const hasSqlite = await isSqliteDatabasePresent(this);
        const hasLegacyStore = isPlainObject(rootObj.store);

        if (hasSqlite) {
          const sqliteStore = new SqliteStore(this);
          await sqliteStore.open();
          this.store = sqliteStore;
        } else if (hasLegacyStore) {
          // Legacy JSON → migrate to SQLite
          const migratedToSqlite = await migrateJsonToSqlite(this, rootObj);
          if (migratedToSqlite) {
            const sqliteStore = new SqliteStore(this);
            await sqliteStore.open();
            this.store = sqliteStore;
          } else {
            this.store = new JsonStore(this);
            this.store.load(rootObj);
          }
        } else {
          // Fresh install — create empty SQLite store
          const sqliteStore = new SqliteStore(this);
          await sqliteStore.open();
          this.store = sqliteStore;
        }

        this._reminderEngine = new ReminderEngine(this);
        this._registerReminderDevConsoleCommands();
        this._registerStudyAssistantDevConsoleCommands();

        if (!(this.store instanceof SqliteStore) && !this.store.loadedFromDisk && isPlainObject(root)) {
          log.warn(
            "data.json existed but contained no .store - initial save will be guarded by assessPersistSafety.",
          );
        }

        registerReadingViewPrettyCards(this);

        // CM6 extension: inline diff decorations for AI-proposed note edits
        this.registerEditorExtension(editDecorationExtension);

        this.registerView(VIEW_TYPE_REVIEWER, (leaf: WorkspaceLeaf) => new LearnKitReviewerView(leaf, this));
        this.registerView(VIEW_TYPE_NOTE_REVIEW, (leaf: WorkspaceLeaf) => new LearnKitNoteReviewView(leaf, this));
        this.registerView(VIEW_TYPE_WIDGET, (leaf: WorkspaceLeaf) => new LearnKitWidgetView(leaf, this));
        this.registerView(VIEW_TYPE_STUDY_ASSISTANT, (leaf: WorkspaceLeaf) => new LearnKitStudyAssistantView(leaf, this));
        this.registerView(VIEW_TYPE_BROWSER, (leaf: WorkspaceLeaf) => new LearnKitCardBrowserView(leaf, this));
        this.registerView(VIEW_TYPE_ANALYTICS, (leaf: WorkspaceLeaf) => new LearnKitAnalyticsView(leaf, this));
        this.registerView(VIEW_TYPE_HOME, (leaf: WorkspaceLeaf) => new LearnKitHomeView(leaf, this));
        this.registerView(VIEW_TYPE_SETTINGS, (leaf: WorkspaceLeaf) => new LearnKitSettingsView(leaf, this));
        this.registerView(VIEW_TYPE_EXAM_GENERATOR, (leaf: WorkspaceLeaf) => new LearnKitExamGeneratorView(leaf, this));
        this.registerView(VIEW_TYPE_COACH, (leaf: WorkspaceLeaf) => new LearnKitCoachView(leaf, this));

        // Legacy view-type aliases keep existing workspace tabs functional after renaming IDs.
        this.registerView(LEGACY_VIEW_TYPE_REVIEWER, (leaf: WorkspaceLeaf) => new LearnKitReviewerView(leaf, this));
        this.registerView(LEGACY_VIEW_TYPE_WIDGET, (leaf: WorkspaceLeaf) => new LearnKitWidgetView(leaf, this));
        this.registerView(LEGACY_VIEW_TYPE_STUDY_ASSISTANT, (leaf: WorkspaceLeaf) => new LearnKitStudyAssistantView(leaf, this));
        this.registerView(LEGACY_VIEW_TYPE_BROWSER, (leaf: WorkspaceLeaf) => new LearnKitCardBrowserView(leaf, this));
        this.registerView(LEGACY_VIEW_TYPE_ANALYTICS, (leaf: WorkspaceLeaf) => new LearnKitAnalyticsView(leaf, this));
        this.registerView(LEGACY_VIEW_TYPE_HOME, (leaf: WorkspaceLeaf) => new LearnKitHomeView(leaf, this));
        this.registerView(LEGACY_VIEW_TYPE_SETTINGS, (leaf: WorkspaceLeaf) => new LearnKitSettingsView(leaf, this));
        this.registerView(LEGACY_VIEW_TYPE_EXAM_GENERATOR, (leaf: WorkspaceLeaf) => new LearnKitExamGeneratorView(leaf, this));
        this.registerView(LEGACY_VIEW_TYPE_COACH, (leaf: WorkspaceLeaf) => new LearnKitCoachView(leaf, this));

        this._coachDb = new CoachPlanSqlite(this);
        await this._coachDb.open();

        this.addSettingTab(new LearnKitSettingsTab(this.app, this));

        this._registerCommands();

        this._registerBrandIcons();

        this._registerRibbonIcons();
        this._registerEditorContextMenu();
        this._registerMarkdownSourceClozeShortcuts();

        this.registerEvent(
          this.app.workspace.on("active-leaf-change", (leaf: WorkspaceLeaf | null) => {
            this._updateStatusBarVisibility(leaf ?? null);
            this._assistantPopup?.onActiveLeafChange();
          }),
        );

        this.registerEvent(
          this.app.workspace.on("file-open", (file: TFile | null) => {
            const f = file instanceof TFile ? file : null;
            this._assistantPopup?.onFileOpen(f);
            this.app.workspace
              .getLeavesOfType(VIEW_TYPE_WIDGET)
              .forEach((leaf: WorkspaceLeaf) => (leaf.view as { onFileOpen?(f: TFile | null): void })?.onFileOpen?.(f));
            this.app.workspace
              .getLeavesOfType(VIEW_TYPE_STUDY_ASSISTANT)
              .forEach((leaf: WorkspaceLeaf) => (leaf.view as { onFileOpen?(f: TFile | null): void })?.onFileOpen?.(f));
          }),
        );

        this.registerEvent(
          this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
            if (file instanceof TFile && file.path.toLowerCase().endsWith(".md")) {
              void this._assistantPopup?.onFileRename(oldPath, file);
            }
            // Keep card records pointed at the note's new path. Handles both a single
            // note and a whole folder (prefix match), and note renames that only change
            // capitalisation — which macOS treats as the same file but Obsidian reports
            // as a different path (GitHub #216).
            if (file instanceof TFile || file instanceof TFolder) {
              void this._retargetCardsAfterMove(oldPath, file.path);
            }
          }),
        );

        this.app.workspace.onLayoutReady(() => {
          void (async () => {
            // Migrate open leaves to canonical LearnKit view IDs so future lookups use one namespace.
            for (const [legacyType, currentType] of Object.entries(LEGACY_TO_CURRENT_VIEW_TYPES)) {
              const leaves = this.app.workspace.getLeavesOfType(legacyType);
              for (const leaf of leaves) {
                try {
                  const state = leaf.getViewState();
                  await leaf.setViewState({ ...state, type: currentType, active: state.active });
                } catch (e) {
                  log.swallow(`migrate legacy view type ${legacyType} -> ${currentType}`, e);
                }
              }
            }
          })();

          this._updateStatusBarVisibility(null);

          this._assistantPopup = new LearnKitAssistantPopup(this);
          this._assistantPopup.mount();
          this._assistantPopup.onActiveLeafChange();
          this.refreshAssistantPopupFromSettings();
          this._startMarkdownModeWatcher();

          this._reminderEngine?.start();
        });

        // Wire up locale file reader and preload any community locales
        // that are shipped alongside the plugin (fr, ja, es).
        {
          const adapter = this.app?.vault?.adapter;
          const configDir = this.app?.vault?.configDir;
          const pluginId = this.manifest?.id;
          if (adapter && configDir && pluginId) {
            setLocaleFileReader((path: string) => adapter.read(path));
            const pluginDir = `${configDir}/plugins/${pluginId}`;
            void loadLocaleBundlesAsync(pluginDir).catch((e: unknown) =>
              log.warn("Failed to preload community locales", e),
            );
          }
        }

        await this.saveAll();
        void this.refreshGithubStars();
        log.info("loaded");
      } catch (e) {
        log.error("failed to load", e);
        new Notice(this._tx("ui.main.notice.loadFailed", "LearnKit - failed to load"));
      }
    }

    onunload(): void {
      // Close our views first: Obsidian leaves plugin view leaves mounted on unload, and
      // a surviving view keeps its dead event handlers (GitHub #205).
      this._detachLearnKitLeaves();

      const pending = this._saving ?? Promise.resolve();
      void pending
        .then(() => this._doSave())
        .catch((e: unknown) => log.swallow("save all on unload", e));

      if (this.store instanceof SqliteStore) {
        void this.store.close().catch((e: unknown) => log.swallow("close sqlite store", e));
      }
      if (this._coachDb) {
        void this._coachDb.close().catch((e: unknown) => log.swallow("close coach sqlite", e));
        this._coachDb = null;
      }

      this._bc = null;
      this._destroyRibbonIcons();
      activeDocument.body.classList.remove("learnkit-hide-status-bar", "learnkit-hide-status-bar");
      activeDocument.body.classList.remove("is-phone");
      activeDocument.body.style.removeProperty("--learnkit-theme-accent-override");
      activeDocument.body.style.removeProperty("--learnkit-theme-accent-on");
      activeDocument.body.style.removeProperty("--learnkit-leaf-zoom");
      if (this._learnkitZoomSaveTimer != null) {
        window.clearTimeout(this._learnkitZoomSaveTimer);
        this._learnkitZoomSaveTimer = null;
      }
      if (this._readingViewRefreshTimer != null) {
        window.clearTimeout(this._readingViewRefreshTimer);
        this._readingViewRefreshTimer = null;
      }
      if (this._readingModeWatcherInterval != null && this._readingModeWatcherInterval >= 0) {
        window.clearTimeout(this._readingModeWatcherInterval);
        this._readingModeWatcherInterval = null;
      } else if (this._readingModeWatcherInterval != null) {
        this._readingModeWatcherInterval = null;
      }

      this._unregisterReminderDevConsoleCommands();
      this._unregisterStudyAssistantDevConsoleCommands();
      this._reminderEngine?.stop();
      this._reminderEngine = null;

      teardownReadingView();

      removeAosErrorHandler();

      cleanupMobileKeyboardHandler();

      this._assistantPopup?.destroy();
      this._assistantPopup = null;

      this._stopBasecoatRuntime();
    }
  };
}
