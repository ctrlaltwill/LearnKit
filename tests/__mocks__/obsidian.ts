/**
 * @file tests/__mocks__/obsidian.ts
 * @summary Unit tests for obsidian behavior.
 *
 * @exports
 *  - TFile
 *  - TFolder
 *  - Notice
 *  - Plugin
 *  - ItemView
 *  - MarkdownRenderer
 */

// tests/__mocks__/obsidian.ts
// ---------------------------------------------------------------------------
// Minimal shim for the "obsidian" module so that source files which
// `import { TFile, Notice, ... } from "obsidian"` can be loaded by Vitest
// without the real Obsidian runtime.
// ---------------------------------------------------------------------------

export class TFile {
  name = "";
  path = "";
  basename = "";
  extension = "";
}

export class TFolder {
  name = "";
  path = "";
  children: any[] = [];
}

export class Notice {
  constructor(_message: string, _timeout?: number) {}
}

export class Plugin {
  app: any = {};
  manifest: any = {};
  async loadData() { return {}; }
  async saveData(_data: any) {}
}

export class ItemView {
  app: any = {};
  containerEl: any = { empty() {}, createDiv() { return {}; } };
}

export class Modal {
  app: any = {};
  containerEl: any = {
    empty() {},
    createDiv() { return {}; },
  };
  contentEl: any = {
    empty() {},
    createDiv() { return {}; },
  };
  constructor(app?: any) {
    this.app = app ?? {};
  }
  open() {}
  close() {}
}

export class MarkdownRenderer {
  static render() { return Promise.resolve(); }
}

export function setIcon(_parent: HTMLElement, _iconId: string): void {}

/** Renders a LaTeX source into a placeholder element tagged with `data-math`
 *  so jsdom tests can assert that math was typeset without a real MathJax runtime. */
export function renderMath(source: string, display: boolean): HTMLElement {
  const doc = (globalThis as any).activeDocument as Document | undefined;
  const el = (doc?.createElement?.("span") ?? {}) as HTMLElement;
  el.setAttribute?.("data-math", source);
  el.setAttribute?.("data-display", String(display));
  return el;
}

export function finishRenderMath(): Promise<void> {
  return Promise.resolve();
}

export async function requestUrl(_params: any): Promise<any> {
  throw new Error("requestUrl is not mocked – use vi.mocked(requestUrl) in your test");
}
