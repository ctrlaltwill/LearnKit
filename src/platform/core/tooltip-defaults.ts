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

function ensureTooltip(el: TooltipTarget): void {
  if (shouldSkipAutoTooltip(el)) {
    if (el.hasAttribute("title")) el.removeAttribute("title");
    return;
  }

  // Always remove native tooltips.
  if (el.hasAttribute("title")) el.removeAttribute("title");

  if (el.hasAttribute("aria-label")) {
    if (isLabeledAnalyticsFilterButton(el)) {
      if (!shouldPreserveExplicitTooltipPosition(el) && el.hasAttribute("data-tooltip-position")) {
        el.removeAttribute("data-tooltip-position");
      }
      return;
    }
    if (!el.hasAttribute("data-tooltip-position")) el.setAttribute("data-tooltip-position", "top");
    return;
  }

  const aria = normalizeTooltipText(el.getAttribute("aria-label") ?? "");
  const title = normalizeTooltipText(el.getAttribute("title") ?? "");
  const text = normalizeTooltipText(el.textContent ?? "");

  const tooltip = aria || title || text;
  if (!tooltip) return;

  el.setAttribute("aria-label", tooltip);
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
  tooltipEls.forEach((el) => markTooltipParent(el));
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
    markTooltipParent(elementNode);
  }
  markTooltipParentsInSubtree(elementNode);
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

  const obs = new MutationObserver((mutations) => {
    mutations.forEach((m) => {
      m.addedNodes.forEach((n) => processNode(n));
      // If attributes change (e.g., textContent updated later), callers should
      // set `aria-label` explicitly; we intentionally don't observe characterData.
    });
  });

  obs.observe(root, { childList: true, subtree: true });
  return () => obs.disconnect();
}
