# ADR-080: MP3 by LAME in WebAssembly; captions leave an export four ways

**Date:** 2026-10-18. **Status:** accepted.

## Context

Two everyday deliverables were missing. **MP3**: audio-only export
offered WAV and AAC (M4A), and a podcast, a voice-over or a music bed
for someone else is still asked for as an MP3. No webview has an MP3
encoder (WebCodecs never added one), and FFmpeg is optional on the
desktop and absent on the web. **Captions**: caption clips (ADR-025's
ordinary text clips, marked `caption`) were always drawn into the
picture, and an SRT came only from the Captions tab, timed to the whole
timeline. YouTube, Vimeo and LinkedIn take an SRT beside the video, and
Premiere's export offers "Burn captions into video" or a sidecar file.

## Decision

- **MP3 through `@mediabunny/mp3-encoder`**, mediabunny's own extension:
  LAME built to WebAssembly in a worker, registered with mediabunny's
  custom coder API, loaded only by the first MP3 export (as the AAC
  fallback is). 256 kbps, 48 kHz stereo, in mediabunny's MP3 container.
  It is MPL-2.0 around LAME's LGPL, both compatible with GPL-3.0-only; About
  credits LAME with a link, as LAME's license page asks. One package,
  same version as mediabunny; it works the same on the desktop and the
  web.
- **Captions leave an export one of four ways** (`captions` in the export
  settings, remembered with them): **burn** into the picture (the
  default, as before), an **srt** file beside the export with the picture
  left clean, **both**, or **none**. Not burning renders a copy of the
  project with the caption clips switched off (`withoutCaptions`); other
  titles still draw. Sound-only exports offer the file or nothing.
- **The SRT is the export's**: timed from the start of the exported range
  and cut at its ends (`captionsInRange`), so an In-to-Out export gets
  captions that match it, not the timeline.
- **"Beside" through the platform seam**: an export target gains
  `sidecar(extension, text)`. The desktop app writes `<name>.srt` in the
  export's folder by the finished job's id (`export_sidecar`); the page
  names an extension, never a path. A file of that name there is
  replaced, as the export was when its name was chosen. A page cannot
  write beside a file it saved, so the web build downloads the SRT under
  the video's name. A failed sidecar is a note on a finished export.
- **Agents**: `export_video` takes `captions` and the audio formats (`mp3`,
  `m4a`, `wav` export the sound alone) and answers `captions_file`.

## Consequences

- LAME's encoder delay (about 1100 samples, 23 ms) is not trimmed: no
  gapless header is written. An MP3 runs a few hundredths of a second
  long and its sound starts that much late; fine for a file played on
  its own, not for one laid back against picture.
- `export_versions`, the headless renderer and the Captions tab's own
  SRT/VTT export are unchanged (versions keep their `textless` choice).
- WebVTT sidecars and subtitle tracks inside the container (MP4 mov_text,
  MKV) are not offered yet.
- Drive: `export-mp3-captions` (ffprobe reads an MP3 at 48 kHz stereo, the
  range's SRT text, a clean picture beside a burned one, the dialog's
  choices, `export_video`'s schema). The desktop's sidecar write is
  covered by a Rust test of where it goes, not yet by a desktop run.
