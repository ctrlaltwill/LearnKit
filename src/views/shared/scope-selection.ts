/**
 * @file src/views/shared/scope-selection.ts
 * @summary The one place that decides whether a note or card belongs to a study
 *   scope. Coach, the reviewer, the note reviewer and the sidebar all ask this
 *   module instead of re-implementing the rules.
 *
 *   Why it exists: the same six scope types had four divergent implementations
 *   (`engine/indexing/scope-match.ts`, `reviewer/session.ts#inScope`,
 *   `note-review-view.ts#_refreshQueue` and `coach-view.ts#_cardsInScope`). They
 *   disagreed on trailing slashes in folder keys, and on group scopes one was
 *   exact-match and case-sensitive while another was case-insensitive and
 *   included descendant groups. The visible result was a Coach plan whose
 *   status bar counted 30 cards while "Study flashcards" opened an empty
 *   session - the reported symptom in #225.
 *
 * @exports
 *   - normaliseFolderScopeKey — canonical form of a folder scope key
 *   - noteMatchesScope — does a vault-relative note path belong to this scope?
 *   - noteMatchesAnyScope — same, for a union of scopes
 *   - selectCardsForScopes — reviewable cards for a union of scopes
 *   - notePathsForGroupScopes — note paths reached through group scopes
 */

import type { App } from "obsidian";
import type LearnKitPlugin from "../../main";
import type { CardRecord } from "../../platform/core/store";
import { isParentCard } from "../../platform/core/card-utils";
import { getGroupIndex } from "../../engine/indexing/group-index";
import { normPath } from "../../engine/indexing/scope-match";
import type { Scope } from "../reviewer/types";
import { pathMatchesMetadataScope } from "./scope-metadata";

/** Canonical form of a folder scope key: forward slashes, no `./`, no trailing slash. */
export function normaliseFolderScopeKey(raw: unknown): string {
  const value = typeof raw === "string" ? raw : "";
  return normPath(value).replace(/\/+$/, "");
}

/**
 * Does `notePath` fall inside `scope`?
 *
 * Group scopes are card-level (a note belongs to a group because one of its
 * cards carries that group), so they answer `false` here; use
 * {@link notePathsForGroupScopes} or {@link selectCardsForScopes} for those.
 */
export function noteMatchesScope(app: App, scope: Scope | null | undefined, notePath: string): boolean {
  if (!scope) return true;

  const path = normPath(notePath);

  switch (scope.type) {
    case "vault":
      return true;

    case "note":
      return path === normPath(scope.key);

    case "folder": {
      const folder = normaliseFolderScopeKey(scope.key);
      // An empty key means the vault root, which contains everything.
      if (!folder) return true;
      return path.startsWith(`${folder}/`);
    }

    case "tag":
    case "property":
      return pathMatchesMetadataScope(app, path, scope);

    case "group":
      return false;

    default:
      // Unknown scope type — fail closed, never fall open onto the whole vault.
      return false;
  }
}

/** True when `notePath` belongs to at least one of `scopes`. An empty list matches everything. */
export function noteMatchesAnyScope(
  app: App,
  scopes: readonly Scope[] | null | undefined,
  notePath: string,
): boolean {
  if (!scopes || scopes.length === 0) return true;
  return scopes.some((scope) => noteMatchesScope(app, scope, notePath));
}

/** Split a group scope key into its constituent group paths (legacy comma-separated form supported). */
function groupKeysForScope(scope: Scope): string[] {
  return String(scope.key ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

/** Note paths reachable through the group scopes in `scopes`. */
export function notePathsForGroupScopes(
  plugin: LearnKitPlugin,
  scopes: readonly Scope[] | null | undefined,
): Set<string> {
  const out = new Set<string>();
  const groupScopes = (scopes ?? []).filter((scope) => scope.type === "group");
  if (!groupScopes.length) return out;

  const index = getGroupIndex(plugin);
  const ids = new Set<string>();
  for (const scope of groupScopes) {
    for (const key of groupKeysForScope(scope)) {
      for (const id of index.getIds(key)) ids.add(String(id));
    }
  }
  if (!ids.size) return out;

  for (const card of plugin.store.getAllCards()) {
    if (!ids.has(String(card.id))) continue;
    const path = String(card.sourceNotePath || "").trim();
    if (path) out.add(path);
  }
  return out;
}

/**
 * Every reviewable card in the union of `scopes`.
 *
 * Parent cards (cloze/IO/MCQ containers, whose children are what actually get
 * reviewed) are excluded, as are quarantined cards - `getAllCards()` filters
 * those out already.
 */
export function selectCardsForScopes(
  plugin: LearnKitPlugin,
  scopes: readonly Scope[] | null | undefined,
): CardRecord[] {
  const list = scopes ?? [];
  const all = plugin.store.getAllCards().filter((card) => !isParentCard(card));

  if (!list.length || list.some((scope) => scope.type === "vault")) return all;

  const indexedScopes = list.filter((scope) => scope.type !== "group");
  const groupScopes = list.filter((scope) => scope.type === "group");

  let groupIds: Set<string> | null = null;
  if (groupScopes.length) {
    groupIds = new Set<string>();
    const index = getGroupIndex(plugin);
    for (const scope of groupScopes) {
      for (const key of groupKeysForScope(scope)) {
        for (const id of index.getIds(key)) groupIds.add(String(id));
      }
    }
  }

  const app = plugin.app;

  return all.filter((card) => {
    if (groupIds && groupIds.has(String(card.id))) return true;
    if (!indexedScopes.length) return false;
    const path = String(card.sourceNotePath || "").trim();
    if (!path) return false;
    return indexedScopes.some((scope) => noteMatchesScope(app, scope, path));
  });
}

/** Convenience: note paths that hold at least one card in the union of `scopes`. */
export function notePathsForScopes(
  plugin: LearnKitPlugin,
  scopes: readonly Scope[] | null | undefined,
): Set<string> {
  const out = new Set<string>();
  for (const card of selectCardsForScopes(plugin, scopes)) {
    const path = String(card.sourceNotePath || "").trim();
    if (path) out.add(path);
  }
  for (const path of notePathsForGroupScopes(plugin, scopes)) out.add(path);
  return out;
}
