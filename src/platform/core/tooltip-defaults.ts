/**
 * @file src/platform/core/tooltip-defaults.ts
 * @summary Module for tooltip defaults.
 *
 * @exports
 *  - initButtonTooltipDefaults
 */
import {  } from "obsidian";

type TooltipTarget = HTMLElement & {
  textContent: string | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
};

function normalizeTooltipText(v: string): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldSkipAutoTooltip(el: HTMLElement): boolean {
  return !!el.closest(".learnkit-mcq-options, .learnkit-oq-step-list, .learnkit-oq-answer-list");
}

function isLabeledAnalyticsFilterButton(el: HTMLElement): boolean {
  if (!el.classList.contains("learnkit-btn-filter")) return false;
  if (!el.closest(".learnkit-analytics-root")) return false;
  const text = normalizeTooltipText(el.textContent ?? "");
  return text.length > 0;
}

function shouldPreserveExplicitTooltipPosition(el: HTMLElement): boolean {
  return el.hasAttribute("data-learnkit-tooltip-explicit");
}

const TOOLTIP_CONTENT_CSS_VAR = "--learnkit-tooltip-content";
const PLACEHOLDER_CONTENT_CSS_VAR = "--learnkit-placeholder-content";

function syncQuotedContentVar(el: HTMLElement, attrName: string, cssVarName: string): void {
  const text = normalizeTooltipText(el.getAttribute(attrName) ?? "");
  if (!text) {
    el.style.removeProperty(cssVarName);
    return;
  }
  el.style.setProperty(cssVarName, JSON.stringify(text));
}

function syncTooltipContentVar(el: HTMLElement): void {
  syncQuotedContentVar(el, "data-tooltip", TOOLTIP_CONTENT_CSS_VAR);
}

function syncPlaceholderContentVar(el: HTMLElement): void {
  syncQuotedContentVar(el, "data-placeholder", PLACEHOLDER_CONTENT_CSS_VAR);
}

function ensureTooltip(el: TooltipTarget): void {
  if (shouldSkipAutoTooltip(el)) {
    if (el.hasAttribute("title")) el.removeAttribute("title");
    if (el.hasAttribute("data-tooltip")) syncTooltipContentVar(el);
    return;
  }

  // Always remove native tooltips.
  if (el.hasAttribute("title")) el.removeAttribute("title");

  if (el.hasAttribute("aria-label")) {
    if (isLabeledAnalyticsFilterButton(el)) {
      if (!shouldPreserveExplicitTooltipPosition(el) && el.hasAttribute("data-tooltip-position")) {
        el.removeAttribute("data-tooltip-position");
      }
      if (el.hasAttribute("data-tooltip")) syncTooltipContentVar(el);
      return;
    }
    const ariaLabel = normalizeTooltipText(el.getAttribute("aria-label") ?? "");
    if (ariaLabel && el.getAttribute("data-tooltip") !== ariaLabel) {
      el.setAttribute("data-tooltip", ariaLabel);
    }
    if (el.hasAttribute("data-tooltip")) syncTooltipContentVar(el);
    if (!el.hasAttribute("data-tooltip-position")) el.setAttribute("data-tooltip-position", "top");
    return;
  }

  const aria = normalizeTooltipText(el.getAttribute("aria-label") ?? "");
  const title = normalizeTooltipText(el.getAttribute("title") ?? "");
  const text = normalizeTooltipText(el.textContent ?? "");

  const tooltip = aria || title || text;
  if (!tooltip) return;

  el.setAttribute("aria-label", tooltip);
  if (el.getAttribute("data-tooltip") !== tooltip) {
    el.setAttribute("data-tooltip", tooltip);
  }
  syncTooltipContentVar(el);
  if (isLabeledAnalyticsFilterButton(el)) {
    if (!shouldPreserveExplicitTooltipPosition(el) && el.hasAttribute("data-tooltip-position")) {
      el.removeAttribute("data-tooltip-position");
    }
    return;
  }
  if (!el.hasAttribute("data-tooltip-position")) el.setAttribute("data-tooltip-position", "top");
}

/**
 * Mark the closest tr / td / .learnkit-deck-row ancestor of a [data-tooltip]
 * element with data-learnkit-has-tooltip so CSS can escalate z-index and
 * overflow without relying on :has().
 */
function markTooltipParent(el: Element): void {
  const parent = el.closest<HTMLElement>('tr, td, .learnkit-deck-row');
  if (parent && !parent.hasAttribute('data-learnkit-has-tooltip')) {
    parent.setAttribute('data-learnkit-has-tooltip', '');
  }
}

function markTooltipParentsInSubtree(root: ParentNode): void {
  const tooltipEls = (root as HTMLElement).querySelectorAll?.<HTMLElement>('[data-tooltip]');
  if (!tooltipEls) return;
  tooltipEls.forEach((el) => {
    syncTooltipContentVar(el);
    markTooltipParent(el);
  });
}

function syncPlaceholdersInSubtree(root: ParentNode): void {
  const placeholderEls = (root as HTMLElement).querySelectorAll?.<HTMLElement>(
    '.lk-browser-contenteditable[data-placeholder]',
  );
  if (!placeholderEls) return;
  placeholderEls.forEach((el) => syncPlaceholderContentVar(el));
}

function processNode(node: Node): void {
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const elementNode = node as HTMLElement;

  // Process the node itself
  if (elementNode.matches("button,[role='button']")) ensureTooltip(elementNode as TooltipTarget);

  // Process descendants
  const descendants = elementNode.querySelectorAll<HTMLElement>("button,[role='button']");
  descendants.forEach((el) => ensureTooltip(el as TooltipTarget));

  // Mark [data-tooltip] parents (for CSS tooltip overflow escalation)
  if (elementNode.hasAttribute('data-tooltip')) {
    syncTooltipContentVar(elementNode);
    markTooltipParent(elementNode);
  }
  if (elementNode.matches('.lk-browser-contenteditable[data-placeholder]')) {
    syncPlaceholderContentVar(elementNode);
  }
  markTooltipParentsInSubtree(elementNode);
  syncPlaceholdersInSubtree(elementNode);
}

/**
 * Normalizes tooltips for buttons across the app using a MutationObserver.
 * Returns a cleanup function to call on plugin unload.
 */
export function initButtonTooltipDefaults(): () => void {
  if (typeof document === "undefined") return () => {};
  const root = activeDocument.body;
  if (!root) return () => {};

  // Initial pass (Obsidian loads views long after DOMContentLoaded)
  processNode(root);
  markTooltipParentsInSubtree(root);
  syncPlaceholdersInSubtree(root);

  const obs = new MutationObserver((mutations) => {
    mutations.forEach((m) => {
      if (m.type === "attributes" && m.target instanceof HTMLElement) {
        const target = m.target;
        if (target.matches("button,[role='button']")) {
          ensureTooltip(target as TooltipTarget);
        }
        if (target.hasAttribute("data-tooltip")) {
          syncTooltipContentVar(target);
          markTooltipParent(target);
        }
        if (target.matches('.lk-browser-contenteditable[data-placeholder]')) {
          syncPlaceholderContentVar(target);
        }
      }
      if (m.type === "childList") {
        m.addedNodes.forEach((n) => processNode(n));
      }
    });
  });

  obs.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-label", "data-tooltip", "data-placeholder"],
  });
  return () => obs.disconnect();
}
