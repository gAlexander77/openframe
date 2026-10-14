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
480-frame GOP: too slow to play, and it grows with GOP length. Sound has
its own problem. `playbackRate` changes pitch, cannot play backward, and is
k-rate, so automating it along a curve drifts from the picture.

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

**Sound: render retimed clips in blocks and play them at rate 1**
(`scheduleAudio`, `src/lib/stretch.ts`). Ramps, reverse, and speed changes
that keep the pitch decode their source range and follow the picture's own
time map (`sourceOffset`). Blocks are 0.5 s for preview and 2 s for
export, so both play the same samples. Plain 1x playback and tape-style
constant speed keep the cheap `playbackRate` path.

- **Pitch kept** (the default, CapCut's Change pitch off): WSOLA, with
  40 ms Hann grains every 20 ms, each nudged up to ±10 ms to continue the
  previous waveform. Two timing fixes came from measurements. First, a
  grain may not read input that belongs after its own 3/4 point; centered
  grains made sounds 90 ms early at 0.1x. Second, the search is skipped
  in silence and at onsets, where it steered away from new sounds and made
  them late.
- **Change pitch on**: cubic-interpolated varispeed along the same map.
- Reverse turns the decoded PCM around before retiming, so the waveform
  plays backward, as CapCut's does.

## Measured

| | Result |
|---|---|
| Video, 90 backward steps (average / worst) | 640×360 GOP 90: 1.3 / 67 ms. 1080p30 GOP 60: 2.9 / 121 ms. 720p60 GOP 480: 1.8 / 157 ms. The worst is the first window, before prefetch. |
| Reversed 1080p playback, 4 s | 0 dropped frames, the same as forward |
| Sound vs time map, beep-and-flash fixture (`scripts/drive/speed.js`) | WSOLA within 15 ms, varispeed within 0.1 ms, the live AudioContext within 5 ms |
| Pitch, 440 Hz tone | Kept: 440 Hz at 0.5x and 2x, and through a ramp. Changed: 220 / 880 Hz, following the ramp |
| Offline render speed | 39–102× real time across runs (WSOLA is the slowest), so preview needs no approximation |

## Consequences

Memory is the video ceiling: two windows of held frames plus one
prefetching, up to ~576 MB at full size. 4K exact frames get the minimum
window (4 frames), so export re-decodes more of each GOP. `ponytail:` an
all-intra proxy makes every window start at its own frame. Scrubbing a
reversed clip backward on the timeline (source forward) decodes look-ahead
windows instead.

WSOLA's known limits apply: strong compression can soften very short
clicks, and 0.1x sounds grainy. Varispeed has no anti-alias filter above
~3x, and each audio block re-decodes its margins (~10%). A phase vocoder
was rejected: it smears transients more and sounds phasey on speech, for
more code.
