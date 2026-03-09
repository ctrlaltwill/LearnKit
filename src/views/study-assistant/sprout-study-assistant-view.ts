/**
 * @file src/views/study-assistant/sprout-study-assistant-view.ts
 * @summary Sidebar assistant view that renders the same UI as the floating popup.
 */

import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import type SproutPlugin from "../../main";
import { VIEW_TYPE_STUDY_ASSISTANT } from "../../platform/core/constants";
import { SproutAssistantPopup } from "./sprout-assistant-popup";

export class SproutStudyAssistantView extends ItemView {
  plugin: SproutPlugin;
  private popup: SproutAssistantPopup;

  constructor(leaf: WorkspaceLeaf, plugin: SproutPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.popup = new SproutAssistantPopup(plugin);
  }

  getViewType(): string {
    return VIEW_TYPE_STUDY_ASSISTANT;
  }

  getDisplayText(): string {
    return "Open assistant widget";
  }

  getIcon(): string {
    return "sprout-widget-assistant";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("sprout", "sprout-study-assistant-root");
    this.popup.mountEmbedded(this.contentEl);
    this.popup.onFileOpen(this.app.workspace.getActiveFile());
  }

  async onClose(): Promise<void> {
    this.popup.unmountEmbedded();
  }

  onRefresh(): void {
    this.popup.refresh();
  }

  onFileOpen(file: TFile | null): void {
    this.popup.onFileOpen(file);
  }
}
