# ADR-040: Media browsing stays outside the project document

**Date:** 2026-10-15. **Status:** accepted.

## Context

Imported media needs more than thumbnail/name search as projects grow.
Premiere's metadata and usage columns inform the approach; references and
verification are in [[Media organization]]. Our existing assets and clips
already contain the necessary data, and the saved schema must stay stable.

## Decision

- Derive filters, sorts and usage from assets/tracks. Never reorder the
  saved assets, edit source files, or create history entries while browsing.
  Stickers stay in their own library; Audio restricts the shared view to
  audio imports regardless of the Media type selector.
- A use means one clip reference in the current timeline, including disabled
  clips and hidden/muted/locked tracks. It does not mean visible/audible
  output, and is not a separate count for video/audio components. Clicking
  a count selects all those clips and seeks the earliest start; it makes
  no document change and does not bypass track locks for subsequent edits.
- Name sorting is case-insensitive and numeric, so Shot2 precedes Shot10.
  Duration compares source seconds, not trimmed timeline length. Stills and
  unknown durations stay last in either direction; ties keep import order.
- Store query/type/usage/sort/view in editor session state. Media and Audio
  share these choices across tab switches. New/Open clears query/type/usage
  to avoid hiding another project's media, keeping the chosen view and sort.
  Restarting the app restores the default grid/import order.
- List rows show available source duration, dimensions, frame rate and file
  size. They retain the existing drag, add and double-click workflows. Row
  buttons stop double-click propagation so two Add clicks cannot also add
  a third clip through the parent card.

## Consequences

No saved-data migration, new dependency or new editing command: additions
use the existing media edit path, and selection/seek already have automation
equivalents. Bins, relinking, source-preview editing, persistent preferences
and virtualization remain separate work. The 22-check headless drive and
five pure tests are recorded in the research note; desktop input remains
for native verification on the owner's test computer.
