# ADR-042: Media organization is optional project metadata

**Date:** 2026-10-16. **Status:** accepted.

## Decision

The owner approved folders and favorites. Unlike ADR-040's browsing filters,
these annotations express editorial organization that should survive saving,
copying and reopening. Store optional flat `mediaFolders` plus per-asset
`folder` and `favorite` fields in schema 1. No file paths or timeline data
change. Missing fields preserve existing behavior. Normalization trims names,
merges case-insensitive duplicates and recovers folders referenced by assets.

Use one undoable metadata transaction for folder rename/delete and affected
membership; deleting a folder unfiles its assets. Commands allow multi-asset
assignment. The UI provides individual assignment in Manage media. Filters
remain session preferences and reset at document load. A folder lost through
Undo or deletion clears its active filter.

## Consequences

This is a backward-compatible additive format change for rendering, with no
identifier/path migration. Older builds may drop folder definitions when
saving, so new builds should be used to preserve organization. Nested folders,
disk moves and bulk UI selection remain possible future extensions. Tests
cover old documents, persistence, repair, Undo, and real desktop interaction.
