# ADR-131: Playback proxies are purpose scoped and disposable cache

**Date:** 2026-10-21. **Status:** accepted.

## Context

The existing full-resolution decode fallback is also an export source
(ADR-013). Making it smaller would degrade delivery. Heavy decodable
footage needs a separate copy for responsive editing.

## Decision

Add optional `Asset.playbackProxy`, validated at load. One pure source
policy permits it only for preview pictures and thumbnails/filmstrips.
Export, saved stills, agent review, analysis and scopes use original/fallback.
While scopes are visible the player also uses original/fallback.
A persisted global preference switches per-clip cursors by source identity;
fingerprint changes also reopen originals without disposing shared inputs.

Desktop FFmpeg makes H.264 CRF-23 copies at half/quarter dimensions or 720
on the short side, with GOP 12, passthrough timestamps, upright phone orientation
and AAC (copied when already AAC). Cache names contain path/size/mtime
fingerprints and size. Jobs reuse cancellation, progress and the Job Object.
Runtime health is machine-local: stale/missing copies fall back and badge.
Batches run serially; one metadata undo removes references without timing
settle. Explicit deletion is limited to the playback cache; Undo then shows
missing references. The browser refuses creation/deletion.

## Consequences

Exports cannot accidentally inherit lower resolution. Caches need not travel
with a project; desktop collection omits them. Undoing creation leaves reusable cache files; deletion may
invalidate a shared reference in another project, which safely falls back.
The requested veryfast/CRF settings need libx264 in an installed FFmpeg;
the planned LGPL bundle needs encoder-specific quality settings before this
feature can use that bundle. No release packaging or dependencies change.
