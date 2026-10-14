---
tags: [research, desktop, tauri, webview2, ffmpeg, ipc, licensing]
created: 2026-10-13
updated: 2026-10-13
status: living
aliases: [Desktop media plumbing, Tauri media research]
---

# Tauri desktop media

How bytes move between Rust and the webview in the desktop build (media in, exports out, frames to FFmpeg), how FFmpeg is shipped and licensed, and what each system webview really supports. Target: **Tauri 2.12.3** (wry 0.57), Windows / WebView2 first, then macOS, then Linux. Everything runs on the user's machine (ADR-003). There is no backend.

Related notes:
- [[Web media engine]]: mediabunny, WebCodecs, the compositor, the export pipeline that feeds the writes described here.
- [[ADR-002 The media engine lives in the webview]], [[ADR-003 Desktop first, one build, a platform seam]].
- [[Conventions]]: Rust lives in `src-tauri/src/<noun>.rs`, errors cross IPC as `Result<T, String>`, and every dependency needs a reason.
- [[Driving the app]]: Playwright over the WebView2 debug port (section 6.3).

> [!abstract] The decisions on one screen
> - **Media in (`sourceFor`).** Add a custom **`media:` protocol**: `register_asynchronous_uri_scheme_protocol`, file I/O on `spawn_blocking`, single HTTP Range, a **cap of 8 MiB** per response, CORS headers, and a Rust-side **registry of IDs to open files**. The webview never sees or sends raw paths. URLs come from `convertFileSrc(id, "media")`: `http://media.localhost/<id>` on Windows, `media://localhost/<id>` on macOS and Linux.
>   - On the TS side use mediabunny **`CustomSource` with exact ranges** and `prefetchProfile: "network"`. Seeks measured **~20 ms**. `UrlSource` measured ~74 ms, because it asks for open-ended ranges and Tauri buffers each response whole.
>   - Do **not** use the built-in `asset:` protocol for media. It caps responses at 1000 KiB, reads the whole file into RAM on a GET without Range, and depends on glob scopes that are not persisted.
> - **Bytes out (export).** mediabunny `StreamTarget({ chunked: true, chunkSize: 8 MiB })` feeds a `WritableStream`. Each chunk becomes `invoke("export_write", chunk.data, { headers: { "x-export-id", "x-position" } })`. Rust writes it with `seek_write` / `write_at` into `<dest>.part`, then fsyncs and renames. Rust shows the save dialog. Verified end to end.
> - **Measured Windows IPC ceiling: about 60–110 MB/s per direction** (WebView2 155). That is plenty for compressed media and encoded output. It is too slow for raw 1080p RGBA frames: about 8–11 fps through `invoke`.
>   - For the FFmpeg frame pipe (ProRes, DNxHR, GIF), v1 sends raw bodies, shrunk to 4:2:2 or 4:2:0 in a shader.
>   - The upgrade path is an in-process loopback WebSocket. It measured 45–56 fps at 1080p RGBA. It is not a server: it is bound to 127.0.0.1 and token-gated.
> - **FFmpeg.** Spawn the **CLI** from Rust with `std::process::Command`. Use neither the shell plugin nor `ffmpeg-next`.
>   - **Dev:** resolve `VE_FFMPEG` env, then the binary next to the exe, then `PATH`. The dev machine has gyan.dev 7.1.1 *GPL* on PATH. That is fine for dev and never shipped.
>   - **Release:** an **LGPL** build: BtbN `lgpl-shared` on Windows and Linux, a self-built LGPL build on macOS. Ship it as a separate executable with license text, a source offer and an About-box credit.
>   - H.264 and HEVC delivery encoding stays in WebCodecs. FFmpeg needs only LGPL-clean encoders: `prores_ks`, `dnxhd`, `gif`, `pcm`, native `aac`, plus hardware H.264 for proxies.
> - **Proxies:** 720p H.264, GOP 15, no B-frames, faststart, through hardware encoders. Try NVENC, QSV, AMF, then MF, VideoToolbox and VAAPI. The software fallback is `libopenh264`. libx264 is not in LGPL builds.
> - **WebView2 has WebCodecs for H.264, HEVC (hardware), VP9 and AV1** (measured). There is no ProRes or DNxHR. **HEVC *encode* is off** unless `--enable-features=PlatformHEVCEncoderSupport` is passed.
>   - **COOP/COEP via `app.security.headers` gives `crossOriginIsolated` on Windows** (measured). macOS and Linux webviews do not get there, so the engine must not require SharedArrayBuffer.
> - **Testing:** `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9229` exposes the `http://tauri.localhost/` page target to Playwright's `connectOverCDP` (verified).

> [!info] How this was verified (2026-10-13)
> - **Snippets:** the Rust in §1.2, §2.2, §3.3 and §4 compiled against Tauri 2.12.3. The ffprobe structs parsed real H.264, ProRes 4444, DNxHR MXF, VFR and GIF files.
> - **Measured on the dev machine:** Windows 11 Pro, WebView2 Runtime **155.0.4283.45**, RTX 5080 plus Intel UHD 770, 32 GB RAM.
>   - Scratch Tauri 2.12.3 release builds were run three times: throughput, codec support, COOP/COEP, CSP and CDP. The section 1 and 2 snippets were compiled and exercised end to end: Range semantics, preflight, mediabunny seeks, and a StreamTarget export.
>   - File reads were served from the OS cache, so the numbers are IPC cost, not disk cost.
> - **Read in source:** `tauri/src/protocol/asset.rs`, `scripts/ipc-protocol.js`, `scripts/core.js`, `scope/fs.rs`, `path/desktop.rs`; the shell plugin (`lib.rs`, `process/mod.rs`, `job_object.rs`); dialog plugin `commands.rs`; the bundler's `debian.rs`; mediabunny 1.61.4 (`source.ts`, `target.ts`); WebKit `UnifiedWebPreferences.yaml` and `OptionsGTK.cmake` at the WebKitGTK release tags; BtbN `scripts.d` and `variants`.
> - **FFmpeg command lines** were run against the local gyan.dev 7.1.1 build: ProRes, DNxHR, GIF, raw stdin, `-progress`, `q`-cancel, NVENC, QSV, AMF and MF trial encodes, ffprobe JSON.
> - **Docs:** Tauri v2 docs and config reference, Microsoft Learn (WebView2 flags and environment), ffmpeg.org (legal, download, ffmpeg and ffmpeg-codecs), BtbN, gyan.dev, evermeet and martin-riedl build pages, MDN browser-compat-data.
> - Items marked *(unverified)* could not be confirmed against a primary source.

---

## 0. Measurements (WebView2 155, Tauri 2.12.3, Windows 11)

Ranges cover three runs. Sequential means one request in flight; "par4" means four concurrent requests. 1 MB = 2^20 bytes.

| Path | Payload | Throughput | Latency |
|---|---|---|---|
| **Webview ← Rust** | | | |
| `asset:` protocol, Range | Server caps at 1000 KiB | 74–110 MB/s | 9–13 ms/req |
| `asset:` random 64 KiB | | | 1.5–2.7 ms/req |
| Custom `media:` protocol | 1 MiB / 4 MiB / 16 MiB | 79–113 / 100–138 / 92–149 MB/s | 9–13 / 29–40 / 108–174 ms |
| Custom `media:` random 64 KiB | | | 2.0–3.8 ms/req |
| `invoke` → `ipc::Response` | 1 / 4 / 16 MiB | 70–89 / 92–109 / 93–108 MB/s | 11–14 / 37–43 / 148–172 ms |
| `invoke` random 64 KiB | | | 1.9–3.1 ms/call |
| Loopback HTTP GET (std `TcpListener`) | 1 / 4 / 16 MiB | 108–207 / 113–311 / 165–349 MB/s | |
| **par4**: media / asset / invoke / HTTP | 4 MiB | **41 / 34 / 40 / 85–151 MB/s** (slower than sequential) | |
| `Channel<InvokeResponseBody::Raw>` | 8.3 MB messages | 160–168 MB/s | 47–49 ms/msg |
| `Channel` raw | 64 KiB messages | 86–131 MB/s | 0.5–0.7 ms/msg |
| Baseline: `Blob.slice().arrayBuffer()` in the renderer | 4 MiB | 650–1000 MB/s | no IPC |
| **Webview → Rust** | | | |
| `invoke(cmd, Uint8Array)` raw body, sequential | 1080p RGBA, 8.3 MB | **62–84 MB/s → 7.8–10.6 fps** | 94–128 ms/frame |
| Same, 4 in flight | 1080p RGBA | 91–127 MB/s → 11.5–16 fps | |
| Same | 1080p I420, 3.1 MB | 58–80 MB/s → 19.5–27 fps | 37–51 ms |
| Same | 4K RGBA, 33 MB | 58–84 MB/s → 1.8–2.6 fps | 378–544 ms |
| Loopback HTTP POST (std only) | 1080p RGBA, seq / 4 in flight | 119–185 / 205–365 MB/s → 15–23 / 26–46 fps | |
| Loopback WebSocket (`tungstenite`, ack per frame) | 1080p / 4K RGBA | **354–445 / 415–499 MB/s → 45–56 / 13–16 fps** | |
| **mediabunny over `media:`** (60 s 1080p H.264, 20 Mb/s, GOP 30) | | | |
| `CustomSource`, exact ranges, `prefetchProfile: "network"` | | 72 requests, 61 MB read | first frame 10–41 ms, **seek avg 20 ms**, max 35 ms |
| `UrlSource` (parallelism 1 or 2) with an 8 MiB server cap | | 25 requests | first frame 57–59 ms, **seek avg 74 ms**, max 131 ms |
| Sequential decode, `VideoSampleSink.samples(20, 30)` | | ~1050–1150 fps (hardware decode) | |

Takeaways:
1. WebView2 moves custom-scheme and IPC bytes at roughly 100 MB/s regardless of which Tauri path you choose. A maintainer reported ~5 ms per 10 MB on macOS against ~200 ms on Windows (tauri discussion #11915), so Windows is the worst case.
2. Concurrency makes it worse on Windows, so keep one request in flight per file.
3. Only a real socket (WebSocket or HTTP over loopback) breaks the ~100 MB/s ceiling. That matters only for raw frames.

---

## 1. Serving large local media to the webview (`sourceFor`, `blobFor`)

### 1.1 Options

| Option | Range | Weak spots | Verdict |
|---|---|---|---|
| **`asset:` + `convertFileSrc(path)`** | Yes on all three OSes: single and multi-range, 206, 416, `Accept-Ranges` (read in `asset.rs`) | Each response is capped at `MAX_LEN = 1000 * 1024` bytes. A GET **without** Range reads the **whole file into a `Vec`**. Every request reopens the file, sniffs 8 KiB for MIME and canonicalizes the path for the scope check. Glob scopes are case-sensitive and skip dot-folders on Unix. Dialog picks are auto-added to the scope, but drops and reopened projects are not, and nothing persists across restarts. | Avoid for media |
| **Custom async protocol `media:`** | Yours to implement (snippet below) | You write about 120 lines. Bodies are still buffered whole: Tauri custom protocols do not stream. | **Use this** |
| `invoke("read", {offset, len})` → `tauri::ipc::Response` | Manual | Same speed as the protocol, ~2–3 ms per call, and not usable for `<video src>` or `<img src>` | Fine for one-off reads |
| In-process loopback HTTP server | Yours | Opens a port, needs token auth and an Origin check. 1.5–3× faster than the protocol. | Plan B if I/O-bound (4K multicam) |
| HTML5 `File` (disk-backed Blob) | Native, fast | Only from user gestures (`<input type=file>` or HTML5 drop). There is no File from a path, and `dragDropEnabled: true` disables HTML5 file drops on Windows. | Web build only |

**Platform URL forms** (from `scripts/core.js`):

```js
convertFileSrc(filePath, protocol = "asset")
// windows | android → `${http|https}://${protocol}.localhost/${encodeURIComponent(filePath)}`
// macOS | linux     → `${protocol}://localhost/${encodeURIComponent(filePath)}`
```

`https` is used only when `app.windows[].useHttpsScheme` is set. Changing that setting later moves the origin and orphans localStorage and IndexedDB. Tauri 2.12 added a Rust `Webview::convert_file_src`.

**CSP** for either protocol: `connect-src`, `img-src` and `media-src` must list both forms, e.g. `media: http://media.localhost`. See 8.2.

### 1.2 The `media:` protocol (validated with Tauri 2.12.3)

The design:
- Rust keeps a registry `id → open File`.
- `media_register(path)` is called only with paths that came from a dialog, a native drop or a project the user opened. It returns `{ id, size }`.
- The protocol serves only registered IDs. Nothing on the JS side can name an arbitrary path, and there are no fs scopes to maintain.
- Handles are opened once and read with positional reads, so concurrent requests never fight over a cursor.
- Rust's `File::open` on Windows shares read, write *and* delete, so the app never locks the user's media.

`src-tauri/src/media.rs` uses `tauri::http`, a re-export, so it needs no new crate:

```rust
use std::{collections::HashMap, fs::File, path::PathBuf,
          sync::{atomic::{AtomicU64, Ordering}, Arc, RwLock}};
use tauri::http::{header, response::Builder, Method, Request, Response};

pub struct MediaFile { file: File, len: u64, mime: &'static str }
#[derive(Default)]
pub struct Media { next: AtomicU64, by_id: RwLock<HashMap<String, Arc<MediaFile>>> }

/// Tauri buffers a protocol response body whole (no streaming), so cap it.
const MAX_RESPONSE: u64 = 8 << 20;

#[derive(serde::Serialize)]
pub struct Registered { id: String, size: u64 }

#[tauri::command]
pub async fn media_register(path: PathBuf, media: tauri::State<'_, Arc<Media>>) -> Result<Registered, String> {
    let file = File::open(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    let mime = match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "mp4" | "m4v" | "m4a" => "video/mp4", "mov" => "video/quicktime", "webm" => "video/webm",
        "mkv" => "video/x-matroska", "wav" => "audio/wav", "mp3" => "audio/mpeg",
        "png" => "image/png", "jpg" | "jpeg" => "image/jpeg", _ => "application/octet-stream",
    };
    let id = format!("m{}", media.next.fetch_add(1, Ordering::Relaxed));
    media.by_id.write().unwrap().insert(id.clone(), Arc::new(MediaFile { file, len, mime }));
    Ok(Registered { id, size: len })
}

fn cors() -> Builder {
    Response::builder()
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges")
        .header("Cross-Origin-Resource-Policy", "cross-origin") // needed under COEP
}
fn empty(b: Builder, status: u16) -> Response<Vec<u8>> { b.status(status).body(Vec::new()).unwrap() }

pub fn respond(req: &Request<Vec<u8>>, media: &Media) -> Response<Vec<u8>> {
    if req.method() == Method::OPTIONS {
        // Preflight: sent for non-"simple" Range values such as `bytes=-500`.
        return empty(cors().header("Access-Control-Allow-Methods", "GET, HEAD")
            .header("Access-Control-Allow-Headers", "Range")
            .header("Access-Control-Max-Age", "600"), 204);
    }
    let id = req.uri().path().trim_start_matches('/');
    let Some(m) = media.by_id.read().unwrap().get(id).cloned() else { return empty(cors(), 404) };
    let ok = cors().header(header::CONTENT_TYPE, m.mime).header(header::ACCEPT_RANGES, "bytes");
    let Some(range) = req.headers().get(header::RANGE).and_then(|v| v.to_str().ok()) else {
        if req.method() == Method::HEAD { return empty(ok.header(header::CONTENT_LENGTH, m.len), 200); }
        if m.len > MAX_RESPONSE { // a whole-file GET would sit in RAM twice
            return empty(ok.header(header::CONTENT_RANGE, format!("bytes */{}", m.len)), 416);
        }
        return read(&m, 0, m.len.saturating_sub(1)).map_or_else(
            |e| cors().status(500).body(e.to_string().into_bytes()).unwrap(),
            |buf| ok.status(200).header(header::CONTENT_LENGTH, buf.len()).body(buf).unwrap());
    };
    let Some((start, end)) = parse_range(range, m.len) else {
        return empty(cors().header(header::CONTENT_RANGE, format!("bytes */{}", m.len)), 416);
    };
    let end = end.min(start + MAX_RESPONSE - 1); // short 206: the client asks again
    match read(&m, start, end) {
        Ok(buf) => ok.status(206)
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{}", m.len))
            .header(header::CONTENT_LENGTH, buf.len()).body(buf).unwrap(),
        Err(e) => cors().status(500).body(e.to_string().into_bytes()).unwrap(),
    }
}

/// `bytes=a-b`, `bytes=a-`, `bytes=-n`. Multi-range is answered with 416.
fn parse_range(h: &str, len: u64) -> Option<(u64, u64)> {
    let spec = h.strip_prefix("bytes=")?.trim();
    if spec.contains(',') || len == 0 { return None; }
    let (a, b) = spec.split_once('-')?;
    let (start, end) = if a.is_empty() {
        (len.saturating_sub(b.parse().ok()?), len - 1)
    } else {
        let s: u64 = a.parse().ok()?;
        (s, if b.is_empty() { len - 1 } else { b.parse::<u64>().ok()?.min(len - 1) })
    };
    (start <= end && start < len).then_some((start, end))
}

fn read(m: &MediaFile, start: u64, end: u64) -> std::io::Result<Vec<u8>> {
    let mut buf = vec![0; (end + 1 - start) as usize];
    let (mut done, mut off) = (0, start);
    while done < buf.len() {
        #[cfg(windows)] let n = std::os::windows::fs::FileExt::seek_read(&m.file, &mut buf[done..], off)?;
        #[cfg(unix)]    let n = std::os::unix::fs::FileExt::read_at(&m.file, &mut buf[done..], off)?;
        if n == 0 { return Err(std::io::ErrorKind::UnexpectedEof.into()); }
        done += n; off += n as u64;
    }
    Ok(buf)
}
```

Registration in `lib.rs`. The closure signature is `Fn(UriSchemeContext<'_, R>, http::Request<Vec<u8>>, UriSchemeResponder)`; the context argument has been there since 2.0.0-rc.17.

```rust
use std::sync::Arc;
use tauri::Manager;

tauri::Builder::default()
    .manage(Arc::new(media::Media::default()))
    .register_asynchronous_uri_scheme_protocol("media", |ctx, request, responder| {
        let media = ctx.app_handle().state::<Arc<media::Media>>().inner().clone();
        // Keep file I/O off the event loop; the responder can be used from any thread.
        tauri::async_runtime::spawn_blocking(move || responder.respond(media::respond(&request, &media)));
    })
    .invoke_handler(tauri::generate_handler![media::media_register /* , … */])
```

Observed behavior on WebView2:

| Request | Response |
|---|---|
| `HEAD` | 200 with `Content-Length` |
| `bytes=0-99` | 206 with 100 bytes |
| `bytes=0-` on 320 MB | 206 with 8,388,608 bytes |
| `bytes=-100` | Preflight, then 206 |
| `bytes=0-1,4-5` | 416 |
| No Range, 4.8 MB | 200 |
| No Range, 151 MB | 416 |
| Unknown ID | 404 |

All of these also hold with COOP/COEP `require-corp` enabled.

### 1.3 TypeScript: `sourceFor` and `blobFor`

The two sources behave differently over this protocol:
- **`UrlSource` asks for open-ended ranges** (`Range: bytes=N-`) and aborts the stream once it has enough. Over HTTP that is cheap. Tauri cannot stream, so every open-ended request costs a full capped response. With an 8 MiB cap, seeks averaged 74 ms.
- **`CustomSource` with exact ranges** let mediabunny's own `"network"` prefetcher size the reads, which grows sequential read-ahead up to 8 MiB extensions. Seeks averaged 20 ms.

```ts
// src/platform/desktop.ts (sketch)
import { CustomSource, type Source } from "mediabunny";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

async function readRange(url: string, start: number, end: number): Promise<Uint8Array> {
  const out = new Uint8Array(end - start);          // mediabunny: end is exclusive
  for (let pos = start; pos < end; ) {              // the server may cap a response
    const res = await fetch(url, { headers: { Range: `bytes=${pos}-${end - 1}` } });
    if (res.status !== 206) throw new Error(`media read ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    out.set(buf, pos - start);
    pos += buf.byteLength;
  }
  return out;
}

async function sourceFor(path: string): Promise<Source> {
  const { id, size } = await invoke<{ id: string; size: number }>("media_register", { path });
  const url = convertFileSrc(id, "media"); // http://media.localhost/m3 | media://localhost/m3
  return new CustomSource({
    getSize: () => size,
    read: (start, end) => readRange(url, start, end),
    prefetchProfile: "network",
    maxCacheSize: 64 << 20,
  });
}

// Small things only (images, fonts, LUTs): the protocol answers a no-Range GET up to 8 MiB.
async function blobFor(path: string): Promise<Blob> {
  const { id } = await invoke<{ id: string }>("media_register", { path });
  const res = await fetch(convertFileSrc(id, "media"));
  if (!res.ok) throw new Error(`blobFor: ${res.status} (file too large for a Blob?)`);
  return res.blob(); // in-memory copy: never use for video
}
```

Further details:
- **Re-register on project open.** IDs live only for the process lifetime, and the registry also replaces scope persistence.
- **Unregister** when a clip leaves the project, by adding a `media_forget(id)` command. Drop the handle before overwriting or renaming that file. On Windows the handle allows delete, but the file then lingers "delete pending".
- **`<video>`, `<img>` and `<audio>`** can point at `media:` URLs on Windows and macOS (206 works). On **Linux, WebKitGTK media elements need a GStreamer URI handler** for custom schemes. That handler is the `tauri-apps/tauri-gstreamer-plugin` repository plus `WEBKIT_GST_ALLOWED_URI_PROTOCOLS`; it was split out of PR #14402 in October 2026. `fetch`-based reading (the engine) is unaffected.

### 1.4 Throughput expectations

| Load | Data rate | Fits in ~100 MB/s? |
|---|---|---|
| 1080p H.264 at 20–50 Mb/s | 2.5–6 MB/s | Many streams |
| 4K H.264/HEVC at 100–150 Mb/s | 12–19 MB/s | Five to eight streams |
| 4K ProRes HQ, about 700 Mb/s (88 MB/s) | | One stream, barely. Proxy it anyway: WebCodecs cannot decode it. |

Seek cost is about 2–4 ms per request plus decode from the keyframe. Short-GOP proxies (section 5a) keep the decode part small. If multicam ever saturates the protocol, the in-process loopback server is the measured 1.5–3× upgrade. Keep per-file reads sequential, because par4 was slower.

---

## 2. Webview → Rust bytes (positional writes, frames)

### 2.1 Raw request bodies: the mechanics

These rules are read from `ipc-protocol.js` and the docs, and checked in the scratch app:
- **Transport.** `invoke(cmd, payload, { headers })` is a `fetch` POST to `ipc://localhost/<cmd>`, or `http://ipc.localhost/<cmd>` on Windows. Since 2.x, **Linux uses it too**; only Android falls back to `postMessage`. If the custom-protocol fetch ever fails, for example because CSP lacks `ipc: http://ipc.localhost`, the app silently and permanently downgrades to `postMessage` for the session.
- **Raw payloads.** Only when the **second argument itself** is an `ArrayBuffer`, `Uint8Array` or `number[]` is it sent as `application/octet-stream`. In Rust the command takes `tauri::ipc::Request` and matches `InvokeBody::Raw(Vec<u8>)`.
  - Wrapping the bytes in an object (`{ data: u8 }`) JSON-serializes them as an array of numbers. That is an order of magnitude slower.
  - Metadata travels in **headers**, as strings.
- **The body is borrowed.** `request.body()` returns `&InvokeBody`, so moving the bytes to another thread costs one `clone()`. That is a memcpy of about 1 ms per 8 MB.
- **Thread.** Non-`async` commands run **on the main thread**, per the docs. A blocking write there freezes the window, so make I/O commands `async` and do the I/O in `spawn_blocking`.
- **Responses.** A return value of `tauri::ipc::Response::new(Vec<u8>)` arrives in JS as an `ArrayBuffer`.

### 2.2 Export: positional writes from `StreamTarget` (validated)

mediabunny's `StreamTarget` emits `{ type: "write", data, position }` chunks into a `WritableStream`. It awaits `writer.ready`, so backpressure works. The MP4 muxer with `fastStart: false` writes `mdat` and then patches sizes and appends `moov`. **Writes must therefore land in order**: a later write may overwrite an earlier region.

A `WritableStream` sink is called one chunk at a time, which gives that order for free. Never fan writes out with `Promise.all`. `chunked: true, chunkSize: 8 MiB` turns thousands of small writes into a few big ones, which matters because each `invoke` costs about 2–3 ms.

`src-tauri/src/export.rs` relies on `tauri-plugin-dialog`, which is already a dependency:

```rust
use std::{collections::HashMap, fs::File, path::PathBuf, sync::{Arc, Mutex}};
use tauri::ipc::{InvokeBody, Request};
use tauri_plugin_dialog::DialogExt;

struct Job { file: Arc<File>, part: PathBuf, dest: PathBuf }
#[derive(Default)]
pub struct Exports { next: Mutex<u32>, jobs: Mutex<HashMap<u32, Job>> }

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Begun { id: u32, display_name: String }

/// Rust shows the save dialog, so the webview can never choose the path itself.
#[tauri::command]
pub async fn export_begin(app: tauri::AppHandle, suggested_name: String, extension: String,
                          exports: tauri::State<'_, Exports>) -> Result<Option<Begun>, String> {
    let Some(picked) = app.dialog().file()
        .set_file_name(&suggested_name)
        .add_filter(extension.to_uppercase(), &[extension.as_str()])
        .blocking_save_file() else { return Ok(None) };   // async command: blocking is fine here
    let dest = picked.into_path().map_err(|e| e.to_string())?;
    let display_name = dest.file_name().unwrap_or_default().to_string_lossy().into_owned();
    Ok(Some(Begun { id: exports.open(dest)?, display_name }))
}

impl Exports {
    /// Writes go to `<dest>.part`; `export_finish` renames it into place.
    pub fn open(&self, dest: PathBuf) -> Result<u32, String> {
        let mut part = dest.clone().into_os_string();
        part.push(".part");
        let part = PathBuf::from(part);
        let file = File::options().write(true).create(true).truncate(true).open(&part)
            .map_err(|e| format!("{}: {e}", part.display()))?;
        let id = { let mut n = self.next.lock().unwrap(); *n += 1; *n };
        self.jobs.lock().unwrap().insert(id, Job { file: Arc::new(file), part, dest });
        Ok(id)
    }
}

/// Body = raw bytes; `x-export-id` and `x-position` headers carry the metadata.
#[tauri::command]
pub async fn export_write(request: Request<'_>, exports: tauri::State<'_, Exports>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected a raw body".into()) };
    let num = |k: &str| request.headers().get(k)?.to_str().ok()?.parse::<u64>().ok();
    let (Some(id), Some(pos)) = (num("x-export-id"), num("x-position")) else {
        return Err("missing x-export-id / x-position".into());
    };
    let file = exports.jobs.lock().unwrap().get(&(id as u32)).map(|j| j.file.clone())
        .ok_or("unknown export")?;
    let bytes = bytes.clone(); // the body is borrowed from the request: one memcpy
    tauri::async_runtime::spawn_blocking(move || write_all_at(&file, &bytes, pos))
        .await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_finish(id: u32, commit: bool, exports: tauri::State<'_, Exports>) -> Result<(), String> {
    let job = exports.jobs.lock().unwrap().remove(&id).ok_or("unknown export")?;
    job.file.sync_all().map_err(|e| e.to_string())?;
    drop(job.file); // close before rename, or Windows answers os error 32
    if !commit { return std::fs::remove_file(&job.part).map_err(|e| e.to_string()); }
    for attempt in 0..20 { // antivirus and indexers briefly open fresh files
        match std::fs::rename(&job.part, &job.dest) {
            Ok(()) => return Ok(()),
            Err(e) if attempt < 19 && matches!(e.raw_os_error(), Some(5 | 32)) =>
                std::thread::sleep(std::time::Duration::from_millis(100)),
            Err(e) => return Err(format!("{}: {e}", job.dest.display())),
        }
    }
    unreachable!()
}

fn write_all_at(f: &File, mut buf: &[u8], mut off: u64) -> std::io::Result<()> {
    while !buf.is_empty() {
        #[cfg(windows)] let n = std::os::windows::fs::FileExt::seek_write(f, buf, off)?;
        #[cfg(unix)]    let n = std::os::unix::fs::FileExt::write_at(f, buf, off)?;
        if n == 0 { return Err(std::io::ErrorKind::WriteZero.into()); }
        buf = &buf[n..]; off += n as u64;
    }
    Ok(())
}
```

The TypeScript `ExportTarget`:

```ts
async function createExportTarget(suggestedName: string, extension: string): Promise<ExportTarget | null> {
  const begun = await invoke<{ id: number; displayName: string } | null>(
    "export_begin", { suggestedName, extension });
  if (!begun) return null;
  const headers = (position: number) => ({ "x-export-id": String(begun.id), "x-position": String(position) });
  const writable = new WritableStream<StreamTargetChunk>({
    write: (c) => invoke<void>("export_write", c.data, { headers: headers(c.position) }),
    close: () => invoke<void>("export_finish", { id: begun.id, commit: true }),
    abort: () => invoke<void>("export_finish", { id: begun.id, commit: false }),
  });
  return { writable, displayName: begun.displayName, reveal: async () => { /* opener plugin later */ } };
}
// engine: new StreamTarget(target.writable, { chunked: true, chunkSize: 8 << 20 })
```

Verified end to end on WebView2. A 1280×720 `CanvasSource` export went through `StreamTarget` (chunked) → `export_write` → `.part` → rename. ffprobe reads it as `h264`, 60 frames, 2.000 s, and mediabunny reads it back through `media:`. A deliberate back-patch test confirmed that writing `MP4!` at 0 after `HELLO` at 4 and `WORLD` at 9 yields `MP4!HELLOWORLD`.

Budget: about 60–85 MB/s on Windows. A 50 Mb/s export produces 6 MB/s, so IPC is about 1/10 of the ceiling.

Rules:
- Do not use `fastStart: "in-memory"` for long exports, because it keeps the file in JS memory. Use `false`, or `"reserve"` when sizes are known.
- `.part` plus rename means a crash never leaves a truncated file under the user's chosen name.

### 2.3 Raw frames to FFmpeg (ProRes, DNxHR, GIF)

1080p RGBA is 8,294,400 bytes per frame.

| Transport | Measured 1080p RGBA | Cost |
|---|---|---|
| `invoke` raw body, one in flight | 7.8–10.6 fps | Zero new code paths |
| `invoke` raw body, 4 in flight + a reorder buffer in Rust | 11.5–16 fps | Frame index header, reorder |
| `invoke` raw body with **4:2:2 packed (UYVY, 2 B/px, 4.1 MB)** | about 15–20 fps (extrapolated from the measured 3.1 MB I420 run) | RGB→YUV shader (BT.709) |
| Loopback HTTP POST (std `TcpListener`, ~60 lines) | 15–23 fps (seq) / 26–46 fps (4 in flight) | Port, token, Origin check |
| **Loopback WebSocket** (`tungstenite`) | **45–56 fps** | New crate (SHA-1 handshake), port, token |

Recommendation:
- **v1** uses `invoke` raw bodies. Convert in the compositor's last pass to the encoder's input layout: `uyvy422` for ProRes 422 and DNxHR, `rgba` only for 4444 with alpha, small RGBA for GIF.
  - Each frame is `invoke("ffmpeg_frame", bytes, { headers: { "x-job": id, "x-frame": n } })`.
  - Rust `write_all`s into the child's stdin on a dedicated writer thread fed by a bounded `sync_channel(4)`. That bounded channel is the backpressure.
  - Add a `ponytail:` comment naming the ~10–20 fps ceiling and the WebSocket upgrade.
  - Even at 10 fps a 60 s 30p ProRes export takes about 3 min. Add `prores_ks` time on top: about 30–60 fps at 1080p HQ on a modern CPU *(unverified)*.
- **Upgrade** to the in-process loopback WebSocket when exports become a priority. It is still 100% local, not a "server":
  - Bind `127.0.0.1:0`.
  - Pass a 128-bit token in the URL.
  - Reject Origins other than `http://tauri.localhost`, `tauri://localhost` and the dev URL.
  - CSP: `connect-src ws://127.0.0.1:*`.
  - Windows did not prompt for firewall access on loopback binds. macOS may show the incoming-connections prompt for unsigned builds *(unverified)*.
- Shared memory (`ICoreWebView2SharedBuffer`) is Windows-only and not exposed by wry. A maintainer called it "weirdly slow" in #11915. Skip it.

### 2.4 Rust → webview streams

- **`tauri::ipc::Channel`** (`Channel<InvokeResponseBody>`, sending `InvokeResponseBody::Raw(vec)`) delivers an `ArrayBuffer` to `channel.onmessage`. It measured about 160 MB/s with 8 MB messages and 0.5–0.7 ms per 64 KiB message. Use it for progress events, waveform peaks, thumbnails and ffmpeg log lines.
- Set `onmessage` **before** passing the channel to `invoke`, because early messages are not replayed.
- Since 2.12.3 a throwing `onmessage` handler no longer stops the stream.
- Since 2.12.0 large queued payloads for closed webviews are dropped (a security fix).

---

## 3. FFmpeg integration and licensing

### 3.1 Options

| Option | How | Verdict |
|---|---|---|
| **CLI child process from Rust** (`std::process::Command`) | Resolve the path, then spawn with piped stdin, stdout and stderr | **Use.** Crash isolation, arm's-length licensing, any FFmpeg version, no build pain |
| `tauri-plugin-shell` sidecar | `app.shell().sidecar("ffmpeg")` resolves `<exe dir>/ffmpeg(.exe)` and sets `CREATE_NO_WINDOW`. `CommandEvent::{Stdout, Stderr, Error, Terminated}`; `set_raw_out`; `set_process_group` (job object on Windows) | Not needed. It adds a plugin and a JS-reachable surface. Its exit cleanup only kills JS-spawned children. |
| `bundle.externalBin` | Bundler copies `binaries/ffmpeg-<target-triple>[.exe]` next to the main exe, minus the triple: `Contents/MacOS/` on macOS, **`/usr/bin/` in .deb** | Fine for single static exes; the name must be unique (pitfall 26) |
| `bundle.resources` | A whole folder (exe + DLLs) under `resource_dir()` | For **shared** builds: Windows loads DLLs from the exe's own folder |
| System `ffmpeg` on `PATH` | Dev convenience | Dev only (unknown version and license on user machines) |
| `ffmpeg-sidecar` crate (MIT, 2.6.0) | Iterator of `FfmpegEvent::{Progress, OutputFrame, Log, …}`. Finds `ffmpeg` next to `current_exe`, then on PATH. | Optional sugar. **Its `auto_download` fetches GPL builds** (gyan.dev essentials, BtbN *gpl*, evermeet, osxexperts), and evermeet's download API was removed for abuse. |
| `ffmpeg-next` bindings | Links libav*. The README calls it "maintenance mode", covering FFmpeg 3.4–8.0. Needs FFmpeg dev libs, libclang for bindgen and `FFMPEG_DIR` (or vcpkg) on Windows. | **No.** Build pain on Windows, ties us to a libav major version, and makes LGPL dynamic-linking duties real |
| Download on first run | Fetch a pinned archive and check its SHA-256 | Later, only to slim the installer. Host your own LGPL build: proxies, offline machines and AV need it to be predictable. |

Target-triple names: run `rustc --print host-tuple` (Rust ≥ 1.84). The names are `x86_64-pc-windows-msvc`, `aarch64-pc-windows-msvc`, `aarch64-apple-darwin`, `x86_64-apple-darwin`, `universal-apple-darwin` and `x86_64-unknown-linux-gnu`.

If JS ever must spawn a sidecar, the capability looks like this:

```json
{ "identifier": "shell:allow-spawn",
  "allow": [{ "name": "binaries/ffmpeg", "sidecar": true,
              "args": ["-version"] }] }
```

`args: true` would let page script write any file through ffmpeg. Don't.

### 3.2 Licensing

FFmpeg is LGPL 2.1+. `--enable-gpl` (needed for libx264, libx265, vidstab, rubberband …) makes the whole build GPL. `--enable-nonfree` (fdk-aac) makes it undistributable.

| Build | Platforms | License | Notes |
|---|---|---|---|
| **BtbN FFmpeg-Builds** `lgpl` / `lgpl-shared` | win64, winarm64, linux64, linuxarm64 | **LGPLv3**: `--enable-version3`, LICENSE `COPYING.LGPLv3` | Drops x264, x265, davs2, vidstab, rubberband. **Keeps** openh264, kvazaar (HEVC), SVT-AV1, libvpx, aom, dav1d, zimg, NVENC, AMF, QSV/oneVPL (not on arm64). Linux builds target glibc 2.28+ and Windows builds target Win10 22H2+. "latest" URLs are stable, e.g. `ffmpeg-n9.0-latest-win64-lgpl-shared-9.0.zip`. |
| BtbN `gpl`, `nonfree` | same | GPLv3 / unredistributable | |
| gyan.dev essentials, full | win64 | **GPLv3** ("all builds … licensed as GPLv3") | This is the dev machine's 7.1.1 (winget). Latest release 9.0.2. |
| evermeet.cx | macOS **Intel only** | GPLv3 (`--enable-gpl --enable-version3`, with x264 and x265) | No Apple Silicon builds planned. GPG-signed, not notarized. |
| martin-riedl.de | macOS arm64 and x64, Linux | Not stated; ships x264 and x265, so GPL | Signed; installer notarized. Intel macOS releases stop in January 2027. |

Sizes, read from the BtbN n9.0 win64 zips:
- **Static `lgpl`:** `ffmpeg.exe` 134.5 MB plus `ffprobe.exe` 134.3 MB, about 269 MB.
- **`lgpl-shared`:** `ffmpeg.exe` 0.5 MB, `ffprobe.exe` 0.2 MB, and DLLs: `avcodec-63` 91.1, `avfilter-12` 31.5, `avformat-63` 22.8, `avdevice-63` 4.9, `avutil-61` 3.0, `swscale-10` 2.3 and `swresample-7` 0.7 MB. That totals **about 157 MB**.
- A trimmed custom build (`--disable-everything` plus an allow-list) is typically 15–30 MB *(unverified estimate)*.

**What a closed-source or MIT app may ship.** This is the common reading, not legal advice.
1. **An LGPL FFmpeg executable, invoked as a separate process: yes.** Duties, adapted from ffmpeg.org/legal.html:
   - Ship the license texts. LGPLv3 incorporates GPLv3, so include both.
   - Provide the *exact* corresponding source and the build configuration. Host the tarball next to your download and link BtbN's commit and scripts.
   - Credit FFmpeg under the LGPL in the About box and the EULA.
   - Do not rename the DLLs to obscure names.
   - Do not prohibit reverse engineering of the LGPL parts.
   - Since we don't link, the "relinkable" duty is moot.
2. **A GPL FFmpeg executable alongside a proprietary app.** It is often argued to be "mere aggregation" because it communicates over pipes and the command line. You still owe GPL source for that binary, and the argument gets weaker the more the app depends on it. **Avoid it.** Nothing we need requires GPL:
   - H.264 and HEVC delivery encoding is WebCodecs (OS and GPU encoders).
   - Pro exports use native LGPL encoders: `prores_ks`, `dnxhd`, `gif`, `pcm_*` and native `aac`.
   - Proxies use hardware encoders or `libopenh264` (BSD).
3. **Patents are separate from copyright.**
   - H.264, HEVC and AAC encoders may need patent licenses in some jurisdictions. ffmpeg.org: "MPEG LA is vigilant and diligent about collecting".
   - OS and GPU encoders (WebCodecs, NVENC, QSV, AMF, Media Foundation, VideoToolbox) are the common way apps lean on the platform vendor.
   - Cisco's OpenH264 royalty coverage applies only to **Cisco's own binary**, not to openh264 compiled into a BtbN build.
   - Consult counsel before charging money.
4. **"ProRes" is an Apple trademark** and `prores_ks` is an unofficial encoder. Name the option "ProRes 422 HQ (FFmpeg)" and decide the trademark question with counsel.

### 3.3 Recommendation: dev today, release later

`src-tauri/src/ffmpeg.rs` resolves the binary once and caches the result:

```rust
use std::{path::PathBuf, process::{Command, Stdio}};

/// VE_FFMPEG override → bundled (resources/ffmpeg or next to the exe) → PATH.
pub fn tool(app: &tauri::AppHandle, name: &str) -> PathBuf {
    use tauri::Manager;
    let exe = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
    if let Some(p) = std::env::var_os(format!("VE_{}", name.to_uppercase())) { return p.into(); }
    let bundled = [
        app.path().resource_dir().ok().map(|d| d.join("ffmpeg").join(&exe)),
        std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join(&exe))),
    ];
    bundled.into_iter().flatten().find(|p| p.is_file()).unwrap_or_else(|| exe.into())
}

pub fn command(path: &PathBuf) -> Command {
    let mut c = Command::new(path);
    c.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flash per job
    }
    c
}
```

- **Dev (today).** No bundle entries. The resolver falls through to `PATH`, which is gyan 7.1.1 *GPL* on this machine. Never rely on GPL-only encoders in code: detect encoders at runtime (section 5b).
- **Release, Windows.** Put BtbN `lgpl-shared` in `src-tauri/ffmpeg/` (`ffmpeg.exe`, `ffprobe.exe`, `*.dll`, `LICENSE`) and bundle it with `"resources": { "ffmpeg/": "ffmpeg/" }`.
  - Put that in a **release-only** config (`tauri build --config src-tauri/tauri.release.conf.json`) or `tauri.windows.conf.json`. Bundled paths must exist at build time, even for `tauri dev`.
  - Code-sign `ffmpeg.exe` and the DLLs with your certificate to reduce SmartScreen and AV friction.
- **Release, macOS.** Use your own LGPL build with VideoToolbox, built in CI on macOS 14 arm64 and x64, or `lipo` it into `universal-apple-darwin`. Ship it in `externalBin`, or resources if it is shared, and sign plus notarize it with the app. A shared build needs `@rpath` dylibs signed with the same Team ID.
- **Release, Linux.** BtbN `linux64-lgpl` static. Name it `video-editor-ffmpeg` if it goes through `externalBin` (pitfall 26).
- **Later** (`ponytail:`): a trimmed LGPL build per OS (15–30 MB), or a pinned first-run download.

---

## 4. ffprobe: what to extract

```text
ffprobe -v error -hide_banner -print_format json -show_format -show_streams -show_error <file>
```

Run it with `CREATE_NO_WINDOW`. Parse stdout with `serde_json::from_slice`; the output is UTF-8 even on Windows. `-show_error` turns failures into JSON `{ "error": { "code", "string" } }`.

| Field (stream) | Use | Notes |
|---|---|---|
| `index`, `codec_type`, `codec_name`, `profile`, `codec_tag_string` | Route the file: WebCodecs-decodable or proxy | `prores` + `HQ`, `dnxhd` + `DNXHR HQX`, `h264` + `High 4:2:2` (needs a proxy) |
| `width`, `height`, `sample_aspect_ratio`, `display_aspect_ratio` | Geometry | SAR ≠ 1:1 for anamorphic DV and HDV |
| `pix_fmt`, `bits_per_raw_sample` | 10-bit, 4:2:2, alpha (`yuva*`, `rgba`, `argb`) | ProRes 4444 decodes as `yuva444p12le` (measured) |
| `field_order` | `progressive` / `tt` / `bb` / `tb` / `bt` | Interlaced input gets `bwdif` in the proxy |
| `side_data_list[] { side_data_type: "Display Matrix", rotation }` | Rotation | `rotation: 90` for `-display_rotation 90` (measured). Phone portrait video often reads −90. Clockwise rotation to apply: `((-rotation % 360) + 360) % 360`. `tags.rotate` is gone. |
| `r_frame_rate` vs `avg_frame_rate` | VFR suspicion | Test file: `30000/1001` vs `1500000/89089`. Flag when they differ by >0.5%, then confirm by scanning packet timestamps (`-read_intervals %+30 -show_entries packet=pts_time`). |
| `time_base`, `start_time`, `duration`, `nb_frames` | Timing | Non-zero `start_time` (edit lists, B-frame delay) shifts A/V alignment. `nb_frames` is absent for MKV. |
| `bit_rate` | Proxy decisions | Missing for many MKV and VBR streams |
| `color_range`, `color_space`, `color_transfer`, `color_primaries` | HDR and matrix | `smpte2084` = PQ, `arib-std-b67` = HLG, `bt2020nc`. Absent means "unknown": assume BT.709 for HD and up. |
| `side_data_list` "Mastering display metadata", "Content light level metadata", "DOVI configuration record" | HDR10 and Dolby Vision | Proxy with tone mapping or keep 10-bit HEVC |
| `sample_rate`, `channels`, `channel_layout`, `sample_fmt` | Audio | |
| `disposition.attached_pic`, `disposition.default` | Skip cover-art "video" streams | |
| `tags.language`, `tags.timecode`, `tags.creation_time` | Metadata | Timecode also appears on a `tmcd` data stream |
| format: `format_name`, `duration`, `size`, `bit_rate`, `tags` | Container | `format_name` is a list: `mov,mp4,m4a,3gp,3g2,mj2` |

A minimal serde model follows. **ffprobe prints many numbers as JSON strings** (`duration`, `bit_rate`, `sample_rate`, `nb_frames`, `start_time`), so keep them as `String` and parse at the edge.

```rust
#[derive(serde::Deserialize, Debug)]
pub struct Probe { #[serde(default)] pub streams: Vec<Stream>, pub format: Option<Format> }

#[derive(serde::Deserialize, Debug, Default)]
#[serde(default)]
pub struct Stream {
    pub index: u32,
    pub codec_type: String,                // "video" | "audio" | "subtitle" | "data"
    pub codec_name: Option<String>,
    pub profile: Option<String>,
    pub width: Option<u32>, pub height: Option<u32>,
    pub sample_aspect_ratio: Option<String>,
    pub pix_fmt: Option<String>,
    pub field_order: Option<String>,
    pub r_frame_rate: Option<String>,      // "30000/1001"
    pub avg_frame_rate: Option<String>,
    pub time_base: Option<String>,
    pub start_time: Option<String>,        // strings, not numbers
    pub duration: Option<String>,
    pub bit_rate: Option<String>,
    pub nb_frames: Option<String>,
    pub sample_rate: Option<String>,
    pub channels: Option<u32>,
    pub channel_layout: Option<String>,
    pub color_range: Option<String>, pub color_space: Option<String>,
    pub color_transfer: Option<String>, pub color_primaries: Option<String>,
    pub disposition: Option<std::collections::HashMap<String, i32>>,
    pub tags: Option<std::collections::HashMap<String, String>>,
    pub side_data_list: Option<Vec<SideData>>,
}

#[derive(serde::Deserialize, Debug, Default)]
#[serde(default)]
pub struct SideData { pub side_data_type: String, pub rotation: Option<f64> }

#[derive(serde::Deserialize, Debug, Default)]
#[serde(default)]
pub struct Format { pub format_name: String, pub duration: Option<String>, pub size: Option<String>,
                    pub bit_rate: Option<String>, pub tags: Option<std::collections::HashMap<String, String>> }
```

Proxy routing should not hard-code codecs. Ask the webview: `await (await input.getPrimaryVideoTrack()).canDecode()` in mediabunny. Proxy when it returns false, and also for ProRes, DNxHR, interlaced input, 4:2:2 H.264 or HEVC, and 10-bit sources on macOS. ffprobe is the fallback when mediabunny cannot even demux the file: AVI, WMV, MPEG-PS/TS edge cases, MXF.

---

## 5. Command lines (tested on FFmpeg 7.1.1 unless marked)

Common prefix for every job:

```text
ffmpeg -hide_banner -nostdin -y -loglevel error -nostats -progress pipe:1 …
```

- `-y` stops ffmpeg from waiting forever at "Overwrite? [y/N]".
- `-nostdin` applies unless stdin carries data or the `q` command.
- Always drain stderr on its own thread.

### 5a. Edit-friendly proxies and intermediates

GOP 15 with no B-frames keeps a seek under half a second of decode. All-intra (`-g 1` for x264, **`-g 0` for NVENC**) gives instant scrub at about 3× the size. Measured on a 2 s 720p clip: x264 all-intra 2.56 MB against GOP 15 at 0.83 MB.

```text
# Software, dev builds only (libx264 is GPL; absent from LGPL builds)
-i IN -map 0:v:0 -map 0:a? -fps_mode passthrough
-vf "scale=-2:'min(720,ih)':flags=bicubic,format=yuv420p"
-c:v libx264 -preset veryfast -tune fastdecode -crf 20 -g 15 -keyint_min 15 -sc_threshold 0 -bf 0
-c:a aac -b:a 192k -ar 48000 -movflags +faststart OUT.mp4

# NVIDIA (tested): short GOP / all-intra
-c:v h264_nvenc -preset p4 -tune hq -rc vbr -cq 21 -b:v 0 -g 15 -bf 0 -profile:v high
-c:v h264_nvenc -preset p4 -rc constqp -qp 20 -g 0            # all-I (60 I-frames); -g 1 is rejected
# Intel QSV (tested): feed nv12
-vf "scale=-2:720,format=nv12" -c:v h264_qsv -preset veryfast -global_quality 23 -g 15 -bf 0
# AMD AMF (unverified here: listed in -encoders but "amfrt64.dll failed to open" without an AMD GPU)
-c:v h264_amf -quality speed -rc cqp -qp_i 20 -qp_p 22 -g 15 -bf 0
# Windows Media Foundation (tested; any GPU vendor)
-vf "scale=-2:720,format=nv12" -c:v h264_mf -hw_encoding 1 -rate_control quality -quality 70 -g 15
# macOS (unverified here)
-c:v h264_videotoolbox -q:v 60 -g 15 -allow_sw 0     # -q:v constant quality needs Apple Silicon
# Linux VAAPI (unverified here)
-vaapi_device /dev/dri/renderD128 -vf "scale=-2:720,format=nv12,hwupload" -c:v h264_vaapi -qp 22 -g 15 -bf 0
# LGPL software fallback (BtbN lgpl includes openh264)
-c:v libopenh264 -b:v 8M -g 15
```

Additions per source:
- **Interlaced** (`field_order` ≠ progressive): `bwdif=mode=send_frame:deint=interlaced` before `scale`.
- **HDR to SDR proxy:** `zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p` needs zimg (in BtbN *(unverified for lgpl)*). Alternatively keep 10-bit: `hevc_nvenc -profile:v main10 -pix_fmt p010le`.
- **Rotation:** ffmpeg auto-rotates when it transcodes, so proxy pixels come out upright with no display matrix. Store `proxyRotated = true` so the engine does not rotate twice.
- **VFR:** `-fps_mode passthrough` keeps the original timestamps, so proxy time equals source time. Convert to CFR only for "conform" intermediates.

### 5b. Masters, GIF, hardware delivery

```text
# ProRes (prores_ks profiles: proxy 0, lt 1, standard 2, hq 3, 4444 4, 4444xq 5)
-c:v prores_ks -profile:v hq -vendor apl0 -pix_fmt yuv422p10le -c:a pcm_s16le OUT.mov
-c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le -alpha_bits 16 -vendor apl0 OUT.mov
#   speed: "-qscale:v 4 and no size constraint" is the docs' fastest setting
#   macOS hardware: prores_videotoolbox (FFmpeg ≥ 6.0, Apple Silicon) (unverified here)
#   FFmpeg 8.1 adds Vulkan-compute ProRes encode/decode

# DNxHR (profile → pix_fmt): dnxhr_lb|sq|hq → yuv422p; dnxhr_hqx → yuv422p10le; dnxhr_444 → yuv444p10le
-c:v dnxhd -profile:v dnxhr_hq -pix_fmt yuv422p -c:a pcm_s16le OUT.mxf   # or .mov
#   DNxHR takes any resolution; legacy DNxHD needs fixed size/rate/bitrate combinations

# GIF, two-pass palette in one graph (tested: 3 s of 1080p in 0.7 s)
-filter_complex "fps=15,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -loop 0 OUT.gif

# Hardware H.264/HEVC when WebCodecs can't (e.g. HEVC encode on WebView2, below)
-c:v hevc_nvenc -preset p5 -tune hq -rc vbr -cq 24 -b:v 0 -tag:v hvc1 -movflags +faststart OUT.mp4
```

**Hardware encoder detection.** `ffmpeg -encoders` lists what was *compiled in*. On this machine it listed `h264_amf` although AMF failed. Use two steps, and cache the result keyed by GPU driver version:

```text
ffmpeg -hide_banner -encoders                 # parse lines like " V....D h264_nvenc ..."
ffmpeg -hide_banner -loglevel error -f lavfi -i color=black:s=256x256:r=30:d=0.2 -c:v h264_nvenc -f null -
```

The trial encode uses 256×256 because NVENC rejects tiny frames. Exit code 0 means usable. Here: `h264_nvenc` OK, `hevc_nvenc` OK, `h264_qsv` OK, `h264_mf` OK, `h264_amf` FAIL.

### 5c. Raw frames on stdin + a WAV → master

```text
ffmpeg -hide_banner -y -loglevel error -nostats -progress pipe:1
  -f rawvideo -pix_fmt rgba -video_size 1920x1080 -framerate 30000/1001 -i pipe:0
  -i mix.wav
  -map 0:v:0 -map 1:a:0
  -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv422p10le,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709"
  -c:v prores_ks -profile:v hq -vendor apl0 -c:a pcm_s16le
  -frames:v <N> OUT.mov
```

The command was tested by piping 30 RGBA frames.
- **RGB→YUV defaults to BT.601** in swscale. Specify `out_color_matrix=bt709`.
- **Tag with `setparams`.** The output options `-color_primaries`, `-color_trc` and `-colorspace` left the ProRes MOV untagged on 7.1.1. `setparams` tagged it (measured).
- **Don't use `-shortest`.** It emitted 29 of 30 frames. Pass `-frames:v N` and render the WAV to exactly N/fps seconds.
- Packed 4:2:2 from the shader is `-pix_fmt uyvy422`, and the conversion filter is then just `format=yuv422p10le`.
- 4444 with alpha keeps `rgba` → `yuva444p10le`.
- Write the mixer's output as WAV in Rust: a 44-byte header plus PCM, s16le or f32le.

### 5d. Thumbnails, filmstrips, peaks

```text
# One frame, accurate and fast (input seek decodes from the previous keyframe): 155 ms here
-ss 12.5 -i IN -frames:v 1 -vf scale=320:-2 -q:v 3 thumb.jpg
# Filmstrip, one image
-i IN -vf "fps=1/5,scale=160:-2,tile=20x1" -frames:v 1 -q:v 4 strip.jpg
# Keyframes only, very fast for long files (pair with -fps_mode vfr)
-skip_frame nokey -i IN -vf "scale=160:-2,tile=8x1" -fps_mode vfr -frames:v 1 strip_key.jpg
# Stream thumbnails to Rust: split stdout on JPEG SOI/EOI markers (FF D8 … FF D9)
-i IN -vf "fps=1,scale=160:-2" -f image2pipe -c:v mjpeg -q:v 5 pipe:1
# Waveform peaks: mono 8 kHz f32 to stdout; Rust reduces to min/max per bucket; send via ipc::Response
-i IN -map 0:a:0 -ac 1 -ar 8000 -f f32le pipe:1
```

When stdout carries media, `-progress pipe:1` cannot share it. Use `-progress pipe:2` with `-loglevel error`, or skip progress for short jobs.

### 5e. Progress parsing

`-progress pipe:1` writes `key=value` lines and each block ends with `progress=continue|end`. Observed keys on 7.1.1: `frame`, `fps`, `stream_0_0_q`, `bitrate`, `total_size`, `out_time_us`, `out_time_ms`, `out_time`, `dup_frames`, `drop_frames`, `speed` and `progress`. `out_time_ms` holds **microseconds** (the same value as `out_time_us`). The default period is 0.5 s (`-stats_period`).

```rust
use std::io::{BufRead, BufReader};
let mut out_us = 0u64;
for line in BufReader::new(child.stdout.take().unwrap()).lines().map_while(Result::ok) {
    match line.split_once('=') {
        Some(("out_time_us", v)) => out_us = v.parse().unwrap_or(out_us),
        Some(("progress", state)) => {
            let fraction = (out_us as f64 / (duration_s * 1e6)).clamp(0.0, 1.0);
            let _ = channel.send(serde_json::json!({ "fraction": fraction, "done": state == "end" }));
        }
        _ => {}
    }
}
```

### 5f. Cancellation

| Case | How | Result |
|---|---|---|
| ffmpeg reads a file, stdin piped | Write `b"q"` to stdin | **Tested on Windows pipes:** exit 0 within 0.9 s, valid MP4 with `moov` |
| ffmpeg reads rawvideo from stdin | Close stdin (drop `ChildStdin`) | EOF, then ffmpeg finalizes normally |
| Hung or user force-quit | `child.kill()` (TerminateProcess / SIGKILL) | Partial file: delete the `.part` |
| App crashes | Windows: put every child in a **Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`**. Linux: `PR_SET_PDEATHSIG` in `pre_exec`. macOS: stdin EOF plus a watchdog. | No orphaned ffmpeg.exe burning a GPU |

The shell plugin's `set_process_group` job object does **not** set kill-on-close. Its exit hook kills only JS-spawned children.

---

## 6. WebView2 specifics

### 6.1 Codecs (measured, WebView2 155)

The test machine is Windows 11 Pro with an RTX 5080 and has the Microsoft HEVC, AV1 and VP9 Video Extensions installed. The test called `isConfigSupported` at 1920×1080 with `hardwareAcceleration` both default and `prefer-hardware`.

| | H.264 High | HEVC Main | HEVC Main10 | VP9 | AV1 | ProRes |
|---|---|---|---|---|---|---|
| `VideoDecoder` | ✓ (hw ✓) | ✓ (hw ✓) | ✓ (hw ✓) | ✓ (hw ✓) | ✓ (hw ✓) | ✗ |
| `VideoEncoder` | ✓ (hw ✓) | **✗ by default**; ✓ with `--enable-features=PlatformHEVCEncoderSupport` | ✗ even with the flag | ✓ | ✓ (hw ✓) | ✗ |

| Audio | AAC | Opus | MP3 | AC-3 | E-AC-3 | PCM | FLAC |
|---|---|---|---|---|---|---|---|
| `AudioDecoder` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Needs `description` (not tested) |
| `AudioEncoder` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |

- **HEVC decode** depends on a hardware decoder. Edge-based runtimes rely on the Windows HEVC path; see [[Web media engine]]: "needs the HEVC Video Extensions". A machine without them was not tested *(unverified)*. Always route through `canDecode()` and proxy on false.
- **HEVC encode:** use NVENC, QSV, AMF or MF through FFmpeg. Alternatively ship the feature flag via `additionalBrowserArgs`, which Microsoft says "is not supported long-term" for production. Prefer FFmpeg.
- Proprietary codecs come from the Windows media stack. **Windows "N" editions** without the Media Feature Pack lose H.264 and AAC *(unverified)*. Detect and offer an FFmpeg proxy.
- Everything else measured: WebGL2 runs on ANGLE D3D11 with `MAX_TEXTURE_SIZE` 16384; `navigator.gpu` is present; `performance.memory.jsHeapSizeLimit` is **4192 MB**; `navigator.deviceMemory` is 32.

### 6.2 Memory and GPU

- **JS heap is capped at about 4 GB per renderer** (V8 pointer-compression cage; 4192 MB measured). `ArrayBuffer`s live outside that heap but count toward renderer memory. Keep big buffers in Rust and frames on the GPU.
- `VideoFrame`s pin decoder or GPU surfaces. Close them deterministically ([[Conventions]] rule 9).
- On hybrid laptops the GPU process may run on the iGPU. Chromium's `--force_high_performance_gpu` exists *(unverified in WebView2)*. Otherwise users pick the GPU per app in Windows Graphics settings.
- Development-only flags in Microsoft's list: `--ignore-gpu-blocklist`, `--disable-gpu` (repro), `--disable-background-timer-throttling`, `--enable-logging`, `--log-net-log`. Chromium also has `--disable-renderer-backgrounding` and `--disable-backgrounding-occluded-windows` *(not in Microsoft's list)*.

### 6.3 Debug port for Playwright and CDP (verified)

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9229"
npm run tauri dev        # or launch the built exe from this shell
# curl http://127.0.0.1:9229/json/version → "Browser": "Edg/155.0.4283.45"
# /json/list → page  http://tauri.localhost/   (dev: http://localhost:1420/)
```

```ts
const browser = await chromium.connectOverCDP("http://127.0.0.1:9229");
const page = browser.contexts()[0].pages()[0];
```

- The environment variable is **appended** to the app's own arguments; `browserExecutableFolder` and `userDataFolder` are *replaced*. **Elevated** apps ignore environment flags.
- `app.windows[].additionalBrowserArgs` in config **replaces** Tauri's defaults. Re-add `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`.
- Windows with different arguments need different data directories.
- Never ship a debug port: any local process could drive the app.

### 6.4 Drag and drop (`dragDropEnabled: true`, already decided)

- The OS drop arrives as a Tauri event with **real paths**. On Windows this disables HTML5 drag and drop, so in-app drags use pointer events.
- `position` is in **physical** pixels relative to the webview.
- Virtual-file drops (Outlook attachments, files inside a zip) carry no paths. A folder arrives as its directory path; walk it in Rust.

```ts
import { getCurrentWebview } from "@tauri-apps/api/webview";

const unlisten = await getCurrentWebview().onDragDropEvent(async (e) => {
  const p = e.payload;
  if (p.type === "over") highlight(document.elementFromPoint(p.position.x / devicePixelRatio, p.position.y / devicePixelRatio));
  if (p.type === "drop") {
    const target = document.elementFromPoint(p.position.x / devicePixelRatio, p.position.y / devicePixelRatio);
    await importPaths(p.paths, target);   // → media_register(path) per file
  }
  if (p.type === "leave") highlight(null);
});
// 2.12.2: the unlisten function is awaitable; call it on unmount.
```

### 6.5 Runtime distribution

- WebView2 is evergreen, and `bundle.windows.webviewInstallMode` defaults to the download bootstrapper.
- A **fixed-version runtime** freezes codec and WebCodecs fixes and adds about 180 MB. Avoid it.
- Tauri 2.12 dropped Windows 7 because current WebView2 installers no longer run there.

---

## 7. macOS WKWebView and Linux WebKitGTK (2025–2026)

| | WebView2 (Win) | WKWebView (macOS) | WebKitGTK (Linux, webkit2gtk-4.1) |
|---|---|---|---|
| `VideoDecoder` / `VideoEncoder` | Chromium 94+ | Safari 16.4+ (system WebKit) | **2.44+ (March 2024)**: `ENABLE_WEB_CODECS ON`, `WebCodecsVideoEnabled` true for GStreamer ports |
| `AudioDecoder` / `AudioEncoder` | ✓ | **Safari 26 only**: macOS 26, or 14/15 with the Safari 26 update | ✓ (`WebCodecsAudioEnabled` default true) |
| HEVC in WebCodecs | Hardware + extension | ✓ (VideoToolbox) | ✓ preference; needs GStreamer decoders |
| AV1 in WebCodecs | ✓ | Preference "preview" (off) | ✓ preference; needs `dav1d` or `av1dec` plugins |
| 10-bit WebCodecs | ✓ | ✗ (`WebCodecsHighBitDepthEnabled` is testable/off) | ✗ |
| `ImageDecoder` | ✓ | Preview only | Enabled (`WebCodecsImageEnabled`) |
| WebGL2 / WebGPU | ✓ / ✓ | ✓ / macOS 26 | ✓ / ✗ |
| Web Audio + AudioWorklet | ✓ | ✓ (14.1+) | ✓ (GStreamer backend) |
| `crossOriginIsolated` / SAB | **✓ with headers** (measured) | ✗ on `tauri://`: headers set, still false (tauri #1522, 2024); `__XPC_JSC_useSharedArrayBuffer=1` force-enables SAB only | ✗: SAB missing even when isolated (WebKitGTK 2.42 report) |
| `<video src>` on a custom scheme | ✓ | ✓ (206) | Needs the GStreamer URI plugin (§1.3) |
| Latest engine | Edge 155 | Safari 26.x | 2.54.1 (2026-10-02) |

Linux notes:
- Codec availability is whatever **GStreamer plugins** the distro installed. `gst-libav` decodes H.264 and AAC; VA-API (`va` in `gst-plugins-bad`) gives hardware decode.
- AppImage can bundle GStreamer with `bundle.linux.appimage.bundleMediaFramework: true`.
- NVIDIA blank or white windows: `WEBKIT_DISABLE_DMABUF_RENDERER=1`.
- Snap and Flatpak need D-Bus permissions for single-instance (8.5).

**Fallback ladder:**
1. `canDecode()` is false → FFmpeg proxy (H.264 8-bit 4:2:0) in Rust. This covers ProRes, DNxHR, MPEG-2, WMV, AVI codecs, 4:2:2 and 10-bit on WebKit, and interlaced input.
2. No `AudioDecoder` (macOS before Safari 26) → Rust decodes audio to WAV or f32 PCM in the cache, and the engine reads PCM (mediabunny reads WAV natively).
3. No `VideoDecoder` at all (pre-2.44 WebKitGTK) → Rust decodes frames and streams I420 over a `Channel`. On Windows that is about 50 fps at 1080p from the measured 160 MB/s. It is degraded but usable. Set the floor at "WebKitGTK ≥ 2.44" and say so.
4. Do not design anything that requires SharedArrayBuffer or threaded WASM. It is a Windows-only bonus.

---

## 8. Tauri project specifics

### 8.1 Capabilities

The current `src-tauri/capabilities/default.json` already has `core:default` and dialog permissions. Following the media and export design above:
- **Do not add the fs plugin or the shell plugin.** Rust commands do all file and process work.
- App commands need no capability entries. Only plugin and core commands do, unless an app manifest is configured in `tauri_build`.
- `onDragDropEvent` is covered by `core:default`, which includes `core:event:default`.
- If the fs plugin is ever added, its scopes look like `{ "identifier": "fs:allow-read-file", "allow": [{ "path": "$APPDATA/**" }] }`.
  - The variables are `$APPDATA`, `$APPLOCALDATA`, `$APPCACHE`, `$HOME`, `$VIDEO`, `$DOWNLOAD` and `$TEMP`.
  - `fs:default` denies `$APPLOCALDATA/EBWebView`.
  - On Unix, dot-folders need `requireLiteralLeadingDot: false`.

### 8.2 CSP

This is the CSP the scratch app ran with: inline module script, `media:` fetch, img and video loads, blob workers and WASM all worked, including under COEP.

```json
"security": {
  "csp": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' ipc: http://ipc.localhost media: http://media.localhost; img-src 'self' blob: data: media: http://media.localhost; media-src 'self' blob: media: http://media.localhost; style-src 'self' 'unsafe-inline'; font-src 'self' data:",
  "headers": { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" }
}
```

- Tauri appends **hashes for local scripts and nonces for styles** at build time.
  - A nonce in `style-src` makes browsers ignore `'unsafe-inline'` for `<style>` elements. React's `style={{…}}` uses the CSSOM and is unaffected, but a library that injects `<style>` tags may break. If that happens, add `"dangerousDisableAssetCspModification": ["style-src"]` *(not reproduced here)*.
- Without `ipc: http://ipc.localhost` in `connect-src`, IPC silently falls back to `postMessage` and gets slower.
- A dev loopback endpoint also needs `ws://127.0.0.1:*`. `devCsp` overrides `csp` for `tauri dev`.

### 8.3 Cross-origin isolation (COOP/COEP)

- `app.security.headers` (Tauri ≥ 2.1) adds headers to responses of the app's own protocol. It does not apply to IPC or error responses.
- **Measured on WebView2:** both `require-corp` and `credentialless` gave `crossOriginIsolated === true` and `typeof SharedArrayBuffer !== "undefined"`. `media:` and `asset:` fetches with Range, `<img src=asset:>` with and without `crossorigin`, and `<video src=asset:>` all still worked.
- Our protocol sends `Cross-Origin-Resource-Policy: cross-origin` anyway.
- **Dev:** Tauri cannot add headers to Vite's server. Mirror them in `vite.config.ts` under `server: { headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" } }`.
- macOS and Linux: see section 7. Nothing may depend on isolation.

### 8.4 App data and cache directories

Each directory is `<base>/<identifier>`, where the identifier is `com.alex.video-editor`.

| API | Windows | macOS | Linux | Use |
|---|---|---|---|---|
| `app_data_dir()` | `%APPDATA%` (Roaming) | `~/Library/Application Support` | `~/.local/share` | `projects/*.json` |
| `app_local_data_dir()` | `%LOCALAPPDATA%` | `~/Library/Application Support` | `~/.local/share` | Settings that should not roam |
| `app_cache_dir()` | **`%LOCALAPPDATA%`** (the same folder as local data, and it holds `EBWebView/`) | `~/Library/Caches` | `~/.cache` | `cache/proxies`, `cache/thumbs`, `cache/peaks`, `cache/audio` |

- Proxies can be gigabytes. Default them to `app_cache_dir()/cache/proxies` and let users relocate them, like a "media cache" setting. Never put them in Roaming.
- **"Clear cache" deletes `…/cache/`, never `app_cache_dir()` itself.** On Windows that would wipe the WebView2 profile.
- Tauri 2.12's `app.appDirectoriesOverride` covers portable installs.
- **Project save** is atomic: write `name.json.tmp`, call `sync_all`, then `rename`. `std::fs::rename` replaces on Windows. Retry os errors 5 and 32 for about 2 s because of AV, the indexer and OneDrive. Keep `name.json.bak` of the previous version.

### 8.5 Single instance, file associations, CLI and headless render

- **Single instance.** Use `tauri-plugin-single-instance` (desktop). **Register it before any other plugin.**
  - Its callback is `|app, args, cwd|`. Forward `args` (a project path) to the main window as an event and focus it.
  - On Linux it uses D-Bus `org.<identifier_with_underscores>.SingleInstance`; Snap and Flatpak need slot and plug or `--own-name`.
- **File associations.** Add `bundle.fileAssociations: [{ "ext": ["veproj"], "name": "Video Editor Project", "description": "Video Editor project", "role": "Editor", "mimeType": "application/x-veproj" }]`. On macOS add `exportedType` to declare the UTI.
  - On Windows and Linux the path arrives in **argv**: skip `-` flags and accept `file://` URLs.
  - On macOS it arrives as **`RunEvent::Opened { urls }`**, at cold start too, never in argv. See the official `examples/file-associations`.
- **Headless render.** `video-editor --render project.json --out file.mp4` uses plain `std::env::args()`. That is enough for two flags; the CLI plugin's JSON schema and `clap` are both more weight.

```rust
// lib.rs (sketch)
let args: Vec<String> = std::env::args().collect();
let render = args.iter().position(|a| a == "--render").and_then(|i| args.get(i + 1).cloned());
let mut builder = tauri::Builder::default();
if render.is_none() {
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| { /* focus + open argv[1] */ }));
}
builder.setup(move |app| {
    if let Some(project) = render.clone() {
        #[cfg(windows)] attach_parent_console(); // so println! reaches the terminal
        tauri::WebviewWindowBuilder::new(app, "render",
            tauri::WebviewUrl::App(format!("index.html?render={}", urlencode(&project)).into()))
            .visible(false).build()?;
    } else { /* create or show "main" */ }
    Ok(())
})
```

- The render page loads the project, runs the same export path (section 2.2), reports progress through a command that `println!`s, and ends with `app.exit(code)`. Since 2.12, `app_handle().exit(1)` propagates through `run_return()`.
- **Hidden webviews do not run `requestAnimationFrame`**, and `backgroundThrottling` is "unsupported" on Windows and Linux. Drive the export loop with awaited promises, which the export path already does, never with rAF.
- **The Windows release build is a GUI-subsystem exe.** Its stdout goes nowhere (tauri #8305), and `cmd` does not wait for it.
  - Call `AttachConsole(ATTACH_PARENT_PROCESS)` (`-1`) through one `extern "system"` declaration, with no crate, and document `start /wait` or `Start-Process -Wait`.
  - The robust upgrade is a tiny console-subsystem `video-editor-cli.exe` that launches the GUI exe and relays progress.
- In the `main` window config keep `"visible": false` and show the window after the first paint, which avoids a white flash. The render window never shows.

---

## 9. Pitfalls

1. **The `asset:` protocol caps every Range response at 1000 KiB** (`MAX_LEN = 1000 * 1024`). Clients must honor `Content-Range`; `bytes=0-` returns 1,024,000 bytes (measured).
2. **The `asset:` protocol reads the whole file into a `Vec` for a GET without Range.** A plain `fetch(assetUrl)` or `<img src>` of a multi-GB file can take the process down; v1-era reports cite crashes past about 3.5 GiB (tauri #4133). Our `media:` returns 416 instead.
3. **Concurrent custom-protocol and IPC requests are slower on WebView2.** Four in flight measured 34–41 MB/s against about 100 MB/s sequential. mediabunny's `UrlSource` defaults to `parallelism: 2`.
4. **`UrlSource` over a Tauri protocol means open-ended ranges times whole-buffered responses.** Every seek pays the full server cap: 74 ms measured, against 20 ms with an exact-range `CustomSource`.
5. **`convertFileSrc` on Windows yields `http://asset.localhost/C%3A%5C…`.**
   - Never hand-build these URLs. Paths with `..` get 403 (`SafePathBuf`).
   - Scope globs are case-sensitive with `require_literal_separator`.
   - On Unix, `$HOME/**` skips dot-folders.
   - Dialog picks are auto-added to the asset scope; drops and reopened projects are not, and nothing persists across restarts. The ID registry sidesteps all of this.
6. **Custom-scheme CORS.**
   - Without `Access-Control-Expose-Headers: Content-Range`, JS cannot read `Content-Range`.
   - A suffix Range (`bytes=-100`) or a multi-range is not "simple", so the browser sends an **OPTIONS preflight** that the handler must answer (verified).
7. **The Windows scheme is `http://<scheme>.localhost`.** Toggling `useHttpsScheme` later changes the origin and loses localStorage and IndexedDB.
8. **Non-`async` commands run on the main thread.** Any file or process work in them freezes the UI. Use `async` plus `spawn_blocking`.
9. **Only a bare `ArrayBuffer` or `Uint8Array` second argument is a raw body.** `{ data }` becomes a JSON number array. Metadata goes in headers.
10. **Write order matters for MP4.** A muxer back-patches sizes, so keep one write in flight; `WritableStream` already does. Avoid `fastStart: "in-memory"` for long exports.
11. **The IPC fallback is silent.** A CSP missing `ipc: http://ipc.localhost` makes Tauri fall back to `postMessage` for the rest of the session: slower, no errors.
12. **ffmpeg hangs on "Overwrite? [y/N]" without `-y`.** It also consumes stdin unless given `-nostdin`, and **deadlocks** when stderr isn't drained (pipe buffers are 4–64 KB).
13. **libx264 and libx265 work in dev and vanish in release.** The dev PATH build is GPL; the LGPL release build lacks them. Detect encoders and treat libx264 as optional.
14. **`-encoders` lies about hardware.** `h264_amf` is listed without an AMD GPU. Trial-encode at 256×256. NVENC all-intra is `-g 0`; `-g 1` errors with "Gop Length should be greater than number of B frames + 1".
15. **swscale defaults to the BT.601 matrix** for RGB→YUV. Set `out_color_matrix=bt709` and tag with `setparams`; the output `-color_*` options didn't tag ProRes on 7.1.1.
16. **`-shortest` dropped the last frame** (29 of 30). Use `-frames:v N`.
17. **4:2:0 encoders reject odd dimensions.** Use `scale=-2:H`, or round in the compositor.
18. **ffprobe prints numbers as strings** (`duration`, `bit_rate`, `sample_rate`, `nb_frames`, `start_time`). A serde `f64` field fails the whole parse.
19. **Rotation is in `side_data_list[].rotation`** (Display Matrix), not `tags.rotate`. ffmpeg auto-rotates when transcoding, so don't rotate proxies twice.
20. **VFR footage:** `r_frame_rate` ≠ `avg_frame_rate`. Never compute frame index as `t × fps` on VFR sources; snap to sample timestamps.
21. **Orphaned ffmpeg on Windows** after a crash. Use a Job Object with `KILL_ON_JOB_CLOSE`; the shell plugin's job object doesn't set it.
22. **A console window flashes** for every `std::process::Command` from a GUI app unless it sets `CREATE_NO_WINDOW` (`0x08000000`).
23. **os error 32 (sharing violation) and os error 5 on Windows** when renaming, overwriting or deleting a file that another handle holds without `FILE_SHARE_DELETE`. The usual holders are AV scanners, the Search indexer, OneDrive, a still-running ffmpeg, or our own registry handle.
    - Close our handles first (`media_forget`, drop the `File`).
    - Write to `.part` and retry the rename with backoff.
    - Rust's `File::open` shares delete, so our read handles don't block others. A file deleted under an open handle stays "delete pending", and recreating that name fails until the handle closes.
24. **OneDrive "Files On-Demand"** placeholders download on first read, or fail offline. Surface the I/O error per clip and don't crash the decode loop.
25. **`externalBin` and `resources` must exist at build time, `tauri dev` included.** Keep FFmpeg in a release-only config.
26. **The .deb bundler installs `externalBin` into `/usr/bin/<name>`.** A sidecar named `ffmpeg` collides with the distro's ffmpeg package, so name it `video-editor-ffmpeg`.
27. **`ffmpeg-sidecar::auto_download` installs GPL builds.** Its evermeet path relies on an API that has been removed.
28. **`additionalBrowserArgs` replaces Tauri's default WebView2 arguments.** Re-add `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`. The `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` environment variable is appended instead, and elevated apps ignore it.
29. **A debug port left on in a release build** lets any local process script the app. Gate it on debug builds.
30. **On Windows, `app_cache_dir()` equals `app_local_data_dir()`**, which contains `EBWebView/`. Deleting "the cache dir" wipes the WebView2 profile.
31. **The GUI-subsystem exe has no console.** CLI output needs `AttachConsole`, or a separate console exe. `cmd` returns before the render ends.
32. **Hidden windows don't run rAF.** `backgroundThrottling` can't be changed on Windows or Linux, so never drive headless export from rAF.
33. **macOS file opens come through `RunEvent::Opened`**, not argv. Single-instance must be the **first** plugin, and skip it in `--render` mode so renders can run beside the GUI.
34. **SharedArrayBuffer only exists on Windows**, with COOP/COEP. Threaded WASM (multithreaded ffmpeg.wasm and the like) can't be a desktop requirement.
35. **WebView2 HEVC encode is off by default**, and HEVC decode needs hardware (plus the HEVC Video Extensions). Gate both on capability checks, not on OS.
36. **Camera 4:2:2 and 10-bit H.264** (XAVC S-I, All-I, Hi422) and **interlaced** sources fail in WebCodecs even when "H.264" sounds supported. Route on `canDecode()` and `field_order`.
37. **Linux `<video>`/`<audio>` elements can't load custom schemes** without the GStreamer URI plugin. `fetch` and WebCodecs are unaffected.
38. **Tauri's injected style nonce disables `'unsafe-inline'`** for injected `<style>` tags. Use `dangerousDisableAssetCspModification: ["style-src"]` if a library breaks.
39. **Blob-URL workers need `worker-src blob:`, and WASM needs `'wasm-unsafe-eval'`** in `script-src` (both verified).
40. **`Channel.onmessage` must be set before the `invoke`.** Early messages are not replayed.

---

## Sources

- Tauri:
  - Calling Rust: https://v2.tauri.app/develop/calling-rust/
  - JS core API (`convertFileSrc`, `Channel`, `InvokeOptions`): https://v2.tauri.app/reference/javascript/api/namespacecore/
  - Config reference: https://v2.tauri.app/reference/config/
  - HTTP headers: https://v2.tauri.app/security/http-headers/
  - CSP: https://v2.tauri.app/security/csp/
  - Sidecars: https://v2.tauri.app/develop/sidecar/
  - Plugins: [shell](https://v2.tauri.app/plugin/shell/), [dialog](https://v2.tauri.app/plugin/dialog/), [file system](https://v2.tauri.app/plugin/file-system/), [single instance](https://v2.tauri.app/plugin/single-instance/), [cli](https://v2.tauri.app/plugin/cli/)
  - Webview API (`onDragDropEvent`): https://v2.tauri.app/reference/javascript/api/namespacewebview/
  - `Builder` docs, 2.12.3: https://docs.rs/tauri/latest/tauri/struct.Builder.html
  - Release notes: https://tauri.app/release/core/ and https://tauri.app/blog/tauri-2.12/
- Tauri source, `tauri-apps/tauri` `dev` branch:
  - `crates/tauri/src/protocol/asset.rs`, `scripts/ipc-protocol.js`, `scripts/core.js`, `src/scope/fs.rs`, `src/path/desktop.rs`, `crates/tauri-bundler/src/bundle/linux/debian.rs`
  - wry: `examples/streaming.rs`, `src/webkitgtk/web_context.rs`
  - plugins-workspace (v2): `plugins/shell/src/{lib.rs,process/mod.rs,process/job_object.rs}`, `plugins/dialog/src/commands.rs`
- Tauri issues and discussions:
  - IPC performance, #11915: https://github.com/orgs/tauri-apps/discussions/11915
  - SharedArrayBuffer, #1522: https://github.com/tauri-apps/tauri/issues/1522
  - Asset protocol memory, #4133: https://github.com/tauri-apps/tauri/issues/4133
  - GStreamer URI plugin, #14402: https://github.com/tauri-apps/tauri/pull/14402
  - Console output, #8305: https://github.com/tauri-apps/tauri/issues/8305
- mediabunny 1.61.4 (`src/source.ts`, `src/target.ts`, `src/output-format.ts`): https://github.com/Vanilagy/mediabunny
- Microsoft:
  - WebView2 browser flags: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags
  - Environment variables and options (`CreateCoreWebView2EnvironmentWithOptions`): https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/webview2-idl
  - WebView2 HEVC issue 4285: https://github.com/MicrosoftEdge/WebView2Feedback/issues/4285
- FFmpeg:
  - Legal: https://ffmpeg.org/legal.html
  - Downloads and releases (9.0.2 "Lei" 2026-09-18; 8.1 "Hoare" 2026-03-16; 8.0 "Huffman" 2025-08-22): https://ffmpeg.org/download.html
  - `ffmpeg` tool docs: https://ffmpeg.org/ffmpeg.html
  - Codec docs: https://ffmpeg.org/ffmpeg-codecs.html
  - `ffmpeg -h encoder=prores_ks|dnxhd|h264_nvenc` (7.1.1)
- Builds:
  - BtbN: https://github.com/BtbN/FFmpeg-Builds (README, `scripts.d/`, `variants/`, release `latest`)
  - gyan.dev: https://www.gyan.dev/ffmpeg/builds/
  - evermeet: https://evermeet.cx/ffmpeg/
  - martin-riedl: https://ffmpeg.martin-riedl.de/
- Rust crates:
  - ffmpeg-sidecar 2.6.0 (`src/download.rs`, `src/paths.rs`): https://github.com/nathanbabcock/ffmpeg-sidecar
  - ffmpeg-next: https://github.com/zmwangx/rust-ffmpeg
- WebKit:
  - Preferences: `Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml` (main and `webkitgtk-2.4x` tags)
  - Build options: `Source/cmake/OptionsGTK.cmake`
  - Releases: https://webkitgtk.org/news.html
- MDN browser-compat-data (`api/VideoDecoder.json`, `AudioDecoder.json`, `VideoEncoder.json`, `AudioEncoder.json`, `ImageDecoder.json`): https://github.com/mdn/browser-compat-data
