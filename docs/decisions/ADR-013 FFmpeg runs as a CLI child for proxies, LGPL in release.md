# ADR-013: FFmpeg runs as a CLI child for proxies, LGPL in release

- **Date**: 2026-10-13 · **Status**: accepted

## Context

WebCodecs cannot decode ProRes, DNxHR, MPEG-2, interlaced or 4:2:2
footage ([[Tauri desktop media]] §6–7), and mediabunny cannot open AVI or
MXF. The desktop must still edit them (ADR-002). Linking libav through
`ffmpeg-next` means build pain and LGPL relinking duties; the shell plugin
adds a surface page script can reach.

## Decision

- Rust spawns the **ffmpeg / ffprobe CLI** with `std::process`
  (`src-tauri/src/ffmpeg.rs`): `ffmpeg_probe`, `ffmpeg_proxy` (progress
  over a `Channel`), `ffmpeg_cancel`. Found via `VIDEO_EDITOR_FFMPEG` (the
  executable or its folder), then a bundled copy (`<resources>/ffmpeg/` or
  beside the exe), then `PATH`. `CREATE_NO_WINDOW` on Windows.
- When the webview cannot decode or open a file, import makes a **proxy**
  and sets `asset.proxy`: H.264 at source size (capped at 4096, because
  export reads the proxy too), a keyframe every 15 frames, no B-frames,
  passthrough timestamps, AAC, faststart. It lands in
  `<app cache>/cache/proxies/<name>-<fnv>.mp4` via a `.part` file and is
  reused while the source is unchanged.
- Encoders, hardware first: NVENC, QSV, AMF, Media Foundation (Windows),
  VideoToolbox (macOS, unverified), NVENC (Linux), then `libopenh264`,
  then `libx264`. Each passes a 256×256 trial encode once per session;
  `-encoders` lists AMF here although it fails. One that refuses a real
  file falls through to the next.
- Cancel kills the child and deletes the part file. Every child joins a
  **Job Object with kill-on-close**, so even a crashed app leaves no
  ffmpeg.exe; a clean exit kills running jobs on every OS.
- **Release ships an LGPL build, never GPL**: BtbN `lgpl-shared` (Windows,
  Linux), our own LGPL build on macOS, as `bundle.resources` in a
  release-only config, with license texts, a source offer and an About
  credit. libx264 is GPL and absent there, so it is only the dev fallback.

## Consequences

Measured here (gyan 7.1.1, RTX 5080): the 3 s 1080p ProRes fixture
converts in ~0.4 s with NVENC; NVENC, QSV, MF and x264 pass the trial, AMF
fails, openh264 is missing. Proxies are 8-bit 4:2:0 without alpha.
`ponytail:` the release config and FFmpeg download, a "clear cache"
command for `cache/`, PR_SET_PDEATHSIG on Linux, VAAPI proxies.
