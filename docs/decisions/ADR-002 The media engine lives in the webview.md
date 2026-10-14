# ADR-002: The media engine lives in the webview

- **Date**: 2026-10-13 · **Status**: accepted

## Context

A desktop editor (the primary product) could decode and composite in Rust
(FFmpeg + wgpu) and stream pictures to the webview, or do it all in the
webview with WebCodecs + WebGL2. A web build must exist too, running
entirely on the user's machine. Two large hybrid apps (Cap, the OpenCut
rewrite) left the webview because shipping frames between native code and
the webview was their bottleneck ([[Web media engine]] §5).

## Decision

Decode, composite, preview and export run **in the webview**, in
TypeScript: mediabunny (demux, WebCodecs decode/encode, mux), a WebGL2
compositor, Web Audio. The same engine runs in the desktop app and the
browser. **Frames never cross IPC.** Rust supplies what the webview cannot:
file bytes (range-capable protocol), FFmpeg proxies for codecs WebCodecs
cannot decode, and FFmpeg masters (ProRes, DNxHR) from a high-quality
intermediate.

- `src/lib/render/plan.ts` decides *what* to draw at a frame (pure, tested);
  `src/engine/compositor.ts` draws it. Preview and export share both.
- Premultiplied alpha everywhere; rotation, crop and flip in the quad
  transform so WebView2 keeps its zero-copy frame upload.
- One decode cursor per clip ([[Web media engine]] §1.5); each cursor owns
  exactly one `VideoSample`.

## Consequences

WebView2 is Chromium, so Windows gets hardware decode for H.264/HEVC/VP9/AV1.
macOS WKWebView and Linux WebKitGTK have narrower codec sets; FFmpeg
proxies cover the gap on desktop. The engine runs on the main thread for
now. `ponytail:` move it into a worker with OffscreenCanvas when profiling
shows UI work stalling playback; the API (plan in, pixels out) already fits
a message boundary.
