/**
 * @file mobile-session-scroll.ts
 * @summary Keeps flashcard study-session scrolling inside the card section on iOS
 * so Obsidian Mobile Quick Action (pull-down → command palette) does not fire first.
 */

import { Platform } from "obsidian";

function isPhoneLikeMobile(): boolean {
  if (!Platform.isMobileApp) return false;
  if (activeDocument.body.classList.contains("is-phone")) return true;
  return (
    activeDocument.body.classList.contains("is-mobile") &&
    window.matchMedia("(max-width: 767px)").matches
  );
}

function resolveSessionScrollContainer(target: EventTarget | null, root: ParentNode): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const section = target.closest<HTMLElement>(".lk-session-card > section");
  if (section && root.contains(section)) return section;
  return null;
}

/**
 * Stop touchmove from bubbling to Obsidian when the session section can scroll.
 * Uses delegation on the review root so card re-renders do not drop listeners.
 * Returns a cleanup function.
 */
export function installMobileSessionScroll(root: ParentNode): () => void {
  if (!isPhoneLikeMobile()) return () => {};

  const host = root instanceof HTMLElement ? root : null;
  if (!host) return () => {};

  const touchState = new WeakMap<HTMLElement, number>();

  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) return;
    const scrollContainer = resolveSessionScrollContainer(event.target, host);
    if (!scrollContainer) return;
    touchState.set(scrollContainer, event.touches[0].clientY);
  };

  const onTouchMove = (event: TouchEvent) => {
    if (event.touches.length !== 1) return;

    const scrollContainer = resolveSessionScrollContainer(event.target, host);
    if (!scrollContainer) return;

    const touchY = event.touches[0].clientY;
    const lastTouchY = touchState.get(scrollContainer) ?? touchY;
    const deltaY = touchY - lastTouchY;
    touchState.set(scrollContainer, touchY);

    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    if (scrollHeight <= clientHeight + 1) return;

    const atTop = scrollTop <= 0;
    const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
    const pullingPastEdge = (deltaY > 0 && atTop) || (deltaY < 0 && atBottom);

    // Trap scroll inside the shell (including at edges) to avoid iOS bounce / parent chaining.
    event.stopPropagation();

    if (pullingPastEdge) event.preventDefault();
  };

  host.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
  host.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });

  return () => {
    host.removeEventListener("touchstart", onTouchStart, true);
    host.removeEventListener("touchmove", onTouchMove, true);
  };
}
