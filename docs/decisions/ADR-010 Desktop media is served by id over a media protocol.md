# ADR-010: Desktop media is served by id over a media protocol

- **Date**: 2026-10-13 · **Status**: accepted

## Context

On the desktop, media stays where the user keeps it (ADR-003) and the
engine reads it in the webview (ADR-002), so Rust must hand the webview
byte ranges of files that can be many gigabytes. Tauri's built-in `asset:`
protocol caps every response at 1000 KiB, reads the whole file into RAM on
a GET without Range, and relies on fs scopes that OS drops and reopened
projects never enter ([[Tauri desktop media]] §1).

## Decision

- A custom asynchronous **`media:` protocol** (`src-tauri/src/media.rs`).
  `media_register(path)` opens a handle and answers `{ id, size }`; URLs
  carry only the id (`http://media.localhost/m3` on Windows,
  `media://localhost/m3` elsewhere), and unknown ids answer 404. The same
  unchanged file registers to the same id and handle.
- One Range per request, read positionally on a blocking thread, capped at
  **8 MiB** per response because Tauri buffers bodies whole; a GET without
  Range above the cap answers 416. CORS and CORP headers are set, and
  OPTIONS preflights (suffix ranges) are answered.
- TypeScript reads through a mediabunny **`CustomSource` asking exact
  ranges** with the `"network"` prefetch profile (`src/platform/desktop.ts`);
  `blobFor` assembles stills from ranges.
- Projects store absolute paths in `asset.src`. Ids live for one process,
  so `sourceFor` re-registers a path lazily the first time it is read.

## Consequences

Seeks measured ~20 ms against ~74 ms for `UrlSource`, and the framecode
drive passes on desktop. The id keeps paths out of URLs, so a stray
`<img src>` reads nothing; it is not a sandbox, since page script can
register any path it names (the CSP is the guard). Handles stay open until
exit. `ponytail:` add `media_forget` when relink or "remove unused media"
needs a file released; an in-process loopback server is the measured
1.5–3× upgrade if 4K multicam ever saturates the ~100 MB/s WebView2 path.
