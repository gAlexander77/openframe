# ADR-033: Mattes are made once and stored as grayscale video

- **Date**: 2026-10-16 · **Status**: accepted

## Context

CapCut's Video > Remove BG > Auto removal cuts the person out of every
frame. It shows "Processing" with a percentage once, then plays and
exports in real time. A segmentation model cannot run inside playback
here either. The default model ([[ADR-032 Remove BG runs ormbg on WebGPU,
MediaPipe on WASM]]) takes 74 ms a frame on this machine's GPU, and
playback also has to decode, grade and composite every other layer at 30
to 60 fps. Export has to be deterministic ([[ADR-014 Export is a
deterministic frame loop]]), so it cannot depend on how fast a model
happens to run. Per-frame models also flicker: an edge pixel that reads
0.48 on one frame and 0.55 on the next shimmers. A hand can vanish for a
single frame.

## Decision

**Process once, store the result as a video, play it back beside the
source.**

- **Making it** (`src/engine/cutout.ts`, `src/engine/matte.worker.ts`):
  decode the source seconds the clip shows (`clipWindow`: trim, speed and
  reverse included), scaled to the model's input. Run each frame through
  the model in a worker. Stabilize the sequence over time
  (`src/lib/matte.ts`). Encode it as a grayscale MP4 (luma = alpha): H.264,
  or VP9/VP8 when the device cannot encode H.264. The long side is at
  most 1024 pixels and there is a key frame every second, so seeking in a
  matte costs what seeking in a source does. The worker always has the
  next frame queued while the page encodes the current one.
- **Storing it**: the MP4 goes where imported media goes
  (`platform.adoptFiles`), which is OPFS on the web and app data on
  desktop. The project holds only a reference on the video clip:
  `cutout: { enabled, src, from, to, model }`, where `from`/`to` are the
  source seconds the matte covers and matte time 0 is `from`
  ([[Project format]]).
- **Playing it**: the plan gives the layer `matte: { src, time }` while
  the source time is inside `[from, to)`. `resolveSources` opens a second
  cursor over the matte file, keyed by its own path. A reversed clip gets
  a `ReverseCursor` for the matte as well. Preview and export share that
  function, so they read the same matte frames. The compositor binds the
  matte on texture unit 4 and samples it in display space. It multiplies
  alpha before color, mask and opacity. Codecs store luma in video range,
  and the outer 2% is codec noise, so the shader maps
  `(v - 0.02) / 0.96` and flat areas land on exactly 0 and 1.
- **Temporal smoothing**: first a per-pixel median of the previous,
  current and next raw mattes. That removes one-frame pops and adds no lag
  on steady motion, because the median of a monotonic run is its middle
  value. Then a change smaller than 24/255 is held back toward the last
  output by up to 60%. A larger change passes untouched, so a moving edge
  never trails a ghost the way a running average does. ormbg's raw mattes
  are already steady on the panning portrait (0.2% mean frame-to-frame
  change). The stabilizer is for harder footage, and its unit tests pin
  both behaviors: a one-frame pop is removed, and a moving edge passes
  with no lag.
- **While it computes**: the clip plays unchanged. The inspector's switch
  turns into a progress bar with Cancel, and the AI tools card shows the
  same job. The edit lands as one undo step ("Remove background") only
  when the matte is complete. The job belongs to the project session
  (`projectWork`), so opening another project cancels it, and a canceled
  job leaves the clip as it was.
- **Reuse**: Off keeps the reference, so On again is instant (one edit,
  no processing). Turning it on looks for a matte that covers the clip's
  window: the clip's own, one on another clip of the same asset (split
  halves share one), or one made earlier this session (undo past it,
  then turn it on again). The matte is made again only when none covers
  the clip.
- **Edits after it**: a trim inside the matte keeps it. Frames past the
  matte (a clip trimmed longer since) show the whole picture in preview
  and export alike; they never hold a matte that no longer fits. The
  inspector then says so and offers **Update**. Replace drops the matte,
  because it was made from the old shot's pixels.
- **Export** fails with a message when a matte it needs cannot be read,
  rather than exporting the background that the preview hid.
- **Loading**: `normalizeProject` keeps a well-formed `cutout` and drops a
  broken one (the clip then plays with its background). Projects saved
  before this have no `cutout` and load unchanged. Older builds ignore the
  field and show the background.

## Consequences

- One extra decode per cut-out clip while playing. The bg-removal drive
  plays the clip with and without the matte and requires no extra dropped
  frames; both played 6 s with none dropped.
- Processing keeps the page responsive: the decode and encode stay on the
  main thread in short steps, and the model runs in the worker. While
  ormbg worked, the longest gap between animation frames was 75 ms and the
  longest task 70 ms.
- `ponytail:` matte files are never deleted, like adopted media and
  stickers. A project that moves to another machine without its app data
  plays its clips uncut, and its export asks for the matte to be made
  again. The ceiling is disk use; the upgrade path is a sweep of files
  that no saved project references.
- `ponytail:` the matte is encoded into memory before it is stored. Mattes
  are mostly flat, so they are small: 0.8 MB a minute from ormbg and 2.7 MB
  from the coarser MediaPipe matte, at 960 × 540 (the bg-removal drive).
  An hour is 50 to 160 MB of memory. A StreamTarget into `adoptFiles`
  would lift that ceiling.
- The edge can be no finer than the model's own resolution, upscaled
  bilinearly: 1024² for ormbg, 256² for the fallback.
