# ADR-130: Film tools share speech and preserve readable layouts

**Date:** 2026-10-21. **Status:** accepted.

## Context

Two films made through MCP exposed missing automatic captions, different
filler words from two hearings of the same source, inconsistent answers,
and layouts that lost their branding, spacing or reusable title rows.

## Decision

- Caption generation for agents and filler analysis share the transcript's
  whole-source hearing, cached by asset and model. Explicit model changes
  re-hear it. Concurrent requests share a hearing; models run serially.
- `auto_captions` maps each cut piece's source words to timeline seconds,
  using known speech scripts before selecting words. Grouping and styling
  compile to existing caption commands in one metadata edit. Music and
  effects roles are excluded unless tracks are explicitly chosen.
- MCP alone maps internal AI results to snake_case and rounds answers;
  UI results stay intact. A batch reports additions by step and in order.
- Nearby independent titles that overlap in time and horizontally retain
  their vertical order and original pixel gaps when refitting grows them.
  Existing grouped and compound-card layout rules keep their ownership;
  version checks also expose remaining text-overlap findings.
- An end card without a logo uses its brand name unless logo is none.
  Free title rows above the active content can be reused across empty
  private rows. Sign-offs up to three words have no pace verdict; deep
  ducking explains quiet dialog and suggests normalization first.

## Consequences

An agent captions a cut interview in one call and sees what each batch
step added. Source hearing downloads the selected model once and analyzes
the whole file, so the first request for a short excerpt can take longer.
Captions inherit transcript editing's current plain-speed limitation;
reverse and speed curves are excluded explicitly. Layouts too large for
the safe column remain visible to the version's text-overlap report.

## Renderer and answer follow-up

The lead's real headless Edge run found stale MCP answer reads in
`export-versions`, `ad-spot` and `text-behind`. The boundary renames these
15 keys: `clipId` to `clip_id`, `assetId` to `asset_id`, `videoId` to
`video_id`, `clipIds` to `clip_ids`, `limitedBy` to `limited_by`,
`subjectClipId` to `subject_clip_id`, `textClipIds` to `text_clip_ids`,
`trackId` to `track_id`, `firstFrame` to `first_frame`, `lastFrame` to
`last_frame`, `truePeak` to `true_peak`, `maxReduction` to `max_reduction`,
`thresholdDb` to `threshold_db`, `floorDb` to `floor_db`, and `fellBack` to
`fell_back`. All old names were searched in every drive, `mcp-web.mjs` and
the root documentation. Direct automation and saved-project fields keep
their existing spelling. The generated tool reference's subject-copy id
is corrected at its source in `mcp.ts`.

The first title-spacing test approximated line counts by character count,
without tracking, weight or raster padding. The real rasterizer wraps
words using the font's measured advances, scaled letter spacing (14 at
1080p on the test headline) and weight 800, and sums the lines' pitches.
The subhead also has an 8-pixel background and the brand's shadow (blur
22 plus offset 4). At 1080p its raster has 36 pixels of padding per side;
the headline has 2. Their rasters overlap by 0.9 pixels, so the old
neighbor test rejected the pair before any version spacing ran. Their
visible boxes have a 29.1-pixel gap.

Pair detection and placement now both use `seenLetters`, exactly as
`check_project` does: rendered wrapping and line heights, background and
outline counted, empty shadow/glow margins removed. The drive measures
those same boxes, asserts the original gap and safe column, and returns
the raw rasters, headline style and rendered lines for diagnosis. The
regression test runs the actual text rasterizer against a deterministic
Canvas2D font-advance substitute, then measures with `seenLetters`. It
first proves that the master's rasters overlap while its visible boxes
do not, and checks the wrapped version's gap, padding and safe bounds.
The lead reruns the browser drives; this follow-up launches no browser.
