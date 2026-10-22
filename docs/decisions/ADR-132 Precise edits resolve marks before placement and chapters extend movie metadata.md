# ADR-132: Precise edits resolve marks before placement and chapters extend movie metadata

- **Date**: 2026-10-21, **Status**: accepted

## Context

Keyboard trimming needs explicit edge selection without changing saved clips.
Source editing needs to distinguish absent marks from a default full range.
Mediabunny 1.61.4 has no chapter API, but exposes complete movie-header bytes.

## Decision

- Keep edit-point selections in session state. Stable nearest ties choose
  the earlier time, then outgoing edges; paired touching sides roll, gaps
  trim. Delegate limits to trimClip/trimStop and rollEdit/rollBounds.
- Extend and nudge selected edges in one edit with magnet off; preserve
  linkage settlement. Commands report each landing and limit.
- Resolve explicit source/timeline marks before Insert/Overwrite displaces
  clips. Outs are exclusive. Different four-point lengths require fill or
  trim; insufficient media rejects the whole edit. Fit uses constant speed.
- Optional marker duration and chapter fields are normalized independently.
  A range follows its start; resizing preserves its attachment.
- Opt-in MP4 chapters write Nero chpl v1 in moov/udta, using mediabunny's
  onMoov callback. Disable fast start for those exports and extend the EOF
  header before closing the target. Retain metadata only, never media bytes.
  Include only explicit chapters; partial exports carry the prior chapter
  to zero. Co-located starts keep the first; at most 255 chapters, titles
  capped at 255 UTF-8 bytes without splitting characters.

## Consequences

Existing files keep today's behavior. No dependencies or Rust changes.
Chapter exports lose fast start; other exports retain reserved headers.
Unit tests cover mark combinations and binary metadata; drives cover UI,
undo and ffprobe chapters. Browser/desktop verification remains separate.
