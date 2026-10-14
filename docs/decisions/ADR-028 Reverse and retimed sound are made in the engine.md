# ADR-028: Reverse and retimed sound are made in the engine

- **Date**: 2026-10-14 · **Status**: accepted

## Context

Reverse and speed ramps ([[ADR-027 Speed curves are exponential and
anchored to clip frames]]) have to play in preview and export with no
render step, on the web build too. The decoder only runs forward: a
backward step means restarting at the previous key frame and decoding up
to the target, a whole GOP per frame ([[Web media engine]] §1.4, §2.4).
Measured on this machine (Edge, hardware decode), stepping backward that
way costs 26 ms a frame at 1080p30 (GOP 60) and 57 ms at 720p60 with a
480-frame GOP: too slow to play, and it grows with GOP length.

## Decision

**Video: decode a window forward, hand it out backward**
(`ReverseCursor`, `src/engine/cursor.ts`). For a backward request the
cursor decodes from the key frame (or from a byte budget's worth earlier,
192 MB) up to the requested frame. It keeps those frames as ImageBitmaps
and serves the next requests from them, while the window below decodes in
the background. Each VideoSample closes as soon as its bitmap exists, so
held frames never starve the decoder.

- Preview holds frames at about screen size (longest side 1280). The
  default (`new CursorPool()`, what export uses) holds them at full size,
  so exported frames are the decoder's own pixels.
- Plan layers carry `reverse: true`, so a clip's cursor type follows its
  flag. Forward clips keep the scrub cursor unchanged.
- A desktop FFmpeg reversed or all-intra proxy is not required. Any proxy
  an asset gets (`asset.proxy`) is read by the same cursor, and a short
  GOP only makes the windows cheaper.

Measured (90 backward steps, average / worst): 640×360 GOP 90:
1.3 / 67 ms; 1080p30 GOP 60: 2.9 / 121 ms; 720p60 GOP 480: 1.8 / 157 ms.
The worst case is the first window, before prefetch has anything. A
reversed 1080p clip played 4 s with 0 dropped frames, the same as forward.

## Consequences

Memory is the ceiling: two windows of held frames plus one prefetching,
up to ~576 MB at full size. 4K exact frames get the minimum window (4
frames), so export re-decodes more of each GOP. `ponytail:` an all-intra
proxy makes every window start at its own frame. Scrubbing a reversed
clip backward on the timeline (source forward) decodes look-ahead windows
instead.
