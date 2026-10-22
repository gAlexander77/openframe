# ADR-139 Film finishing reports measured limits and preserves portable elements

Date: 2026-10-21
Status: accepted

## Context

The fifth blind film test found missing finishing information, misleading
success reports, unreadable caption chunks and portrait layouts that covered
speakers. Saliency identifies visual contrast, not who is speaking.

## Decision

FCPXML carries native Basic Titles, levels, volume keys sampled per frame,
linear fades, dissolves and chapter/range markers. Unsupported finishing is
reported for both FCPXML and OTIO, with rendered video/WAV references advised.
MP4 results expose the actual chapter table; file previews inspect Nero chpl
by range and state their limits. No new media or project schema is required.
Ducking success follows measured margins even when the requested ceiling is
infeasible. Short fades below the preview's 50 ms tail threshold remain
eligible for the project check. Audio boundary prose uses the track's role.
Whole-line captions choose readable phrase groups, preserve all words and
report infeasible reading times. ASR overlaps normalize before consumption.
Tall versions regroup overflowing captions and move independent identifiers
clear of the framed subject. Saliency crops are low confidence; explicit
focus owns the choice. Authored placement or insufficient room gets a note.
Media keeps its whole-source fit default; add_media_clip exposes fill/blur
and reports transparent bands. Version checks reject excess moments.

## Consequences

The handoff preserves editable portable elements without claiming identical
finishing in foreign editors. Portraits and recognition still need review;
no face detector is implied. The chapter reader supports OpenFrame's Nero
MP4 table, not QuickTime chapter tracks or other containers. External-editor
import and desktop behavior still need the lead's validation.

**2026-10-22 sweep:** Updated older drives to this decision: sound-joins
requires `met: false` and the infeasible-ceiling note for a line over 15 LU
at zero dip, even with speech at 12 LU. versions-subject expects no
saliency report for explicit focus and verifies the saved framing moves
only the requested shot. Existing balance/reframe unit tests cover both.
