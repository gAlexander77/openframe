# ADR-012: Exports are positional raw-body writes into a part file

- **Date**: 2026-10-13 · **Status**: accepted

## Context

The engine encodes in the webview (ADR-002) and mediabunny's `StreamTarget`
emits `{ data, position }` chunks; an MP4 written with `fastStart: false`
patches earlier bytes at the end, so writes must land at their offsets and
in order. A crash or a cancel must never leave a truncated file under the
name the user chose, and page script must never pick a destination itself.

## Decision

- **Rust shows the save dialog** (`export_begin`) and keeps the path; the
  page gets a job id and a display name. `export_reveal(id)` shows a
  finished file in the file manager without the page naming a path.
- Each chunk is **one raw-body `invoke`**: the bytes are the body, the job
  id and position travel in `x-export-id` / `x-position` headers. Wrapping
  bytes in an object would send them as a JSON number array. Rust writes
  them positionally (`seek_write` / `write_at`) into **`<dest>.part`** on a
  blocking thread.
- The `WritableStream` sink handles one chunk at a time, which keeps MP4
  back-patches in order. **close = flush, close, rename into place** (with
  the Windows retry of ADR-011); **abort = delete the part file**.
- `adoptFiles` (a webview `File`, which has no path) reuses the same writes
  into `<local data>/media/`.

## Consequences

Measured in the app: a 90-frame 720p H.264 export arrived in four 1 MiB
writes with one back-patch, and ffprobe and a full decode read it clean;
an aborted export left no file. IPC runs ~60–110 MB/s on WebView2, about
ten times what a 50 Mb/s export needs. **mediabunny's `Output.cancel()`
closes the stream instead of aborting it**, so a sink cannot tell a cancel
from a finish: the export engine must abort the target itself on cancel.
