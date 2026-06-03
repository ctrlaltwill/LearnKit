/**
 * @file src/platform/integrations/sync/sync-privileges.ts
 * @summary Shared sync-privilege metadata and helpers used by settings and sync entrypoints.
 */

/**
 * Increment when users must re-confirm sync mode choices after a release.
 * Existing installs with older stored values will be prompted on next sync.
 */
export const CURRENT_SYNC_PRIVILEGES_CHOICE_VERSION = 1;

export function normaliseSyncPrivilegesChoiceVersion(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

export function requiresSyncPrivilegesChoice(value: unknown): boolean {
  return normaliseSyncPrivilegesChoiceVersion(value) < CURRENT_SYNC_PRIVILEGES_CHOICE_VERSION;
}
