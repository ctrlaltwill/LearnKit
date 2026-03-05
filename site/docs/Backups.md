# Backups

Last modified: 05/03/2026

## What backups are for

Backups save your **scheduling data** so you can recover from mistakes or bad imports.
They do not back up your note text.

## Create a backup

1. Open **Settings → Reset**.
2. Click **Create backup now**.

The backup is saved immediately.

## Automatic backup policy (Anki-style tiers)

Sprout uses a hybrid retention policy with short-term and long-term snapshots.
You can configure this in **Settings → Data backup**.

Default policy:

- 8 recent backups (every 6 hours)
- 7 daily backups (every 1 day)
- 4 weekly backups (every 7 days)
- 1 monthly backup (every 30 days)
- 250 MB total backup size cap

When total backup size exceeds the cap, Sprout prunes oldest tier entries first.

Routine backups use the **Recent interval (hours)** setting.

## Restore a backup

1. In the backup table, find the backup you want.
2. Click **Restore**.
3. Confirm.

Restoring replaces current scheduling data with older data.

> [!WARNING]
> Restore overwrites your current scheduling state and review history.
> Reviews done after that backup was made are lost.

## Delete a backup

Click **Delete** next to a backup to remove it permanently.
This action cannot be undone.

## What is included

- card stages, intervals, stability, difficulty
- review history
- FSRS parameters
- card-to-note mappings

## What is not included

- Markdown note content
- media files
- plugin settings

## When to create backups

- before reset actions
- before large imports (see [Anki Export & Import](./Anki-Export-&-Import.md))
- regularly as a safety habit

## Notes

- Backups are local-first and intended for recovery.
- New backups include a sidecar integrity manifest (`.manifest.json`) with size + checksum.
- Older backups without a manifest are still supported and can still be restored.
- If backup files are missing or corrupted, use your most recent valid backup.
