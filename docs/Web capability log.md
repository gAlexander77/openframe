# Web capability log

Desktop is the primary product. This log records observations from the
client-only browser build; it does not establish desktop/browser parity.

## 2026-10-15 — captions verified and worker recovery checked

On unchanged app revision `d717e35`, the full `web-capabilities` drive
passed in headless Edge on Windows at 1600 × 950. Media persistence, all
fixture results, and both export measurements matched the earlier entry.
Whisper tiny English generated five captions in **7,600 ms**, with no
failed requests recorded:

> Welcome to the video editor,
> this sentence was spoken
> by a computer.
> Captions should appear
> on screen.

The previous stalls were not reproduced, so their cause remains unknown.
This fresh browser context completed its model initialization; offline
cache reuse and desktop captions remain untested.

A separate failure-injection drive, `scripts/drive/caption-recovery.js`,
reproduced an indefinite wait when the worker module request was aborted.
The caption RPC previously listened only for worker messages, so startup
errors could never reject that request and Cancel did not interrupt it.
The implementation now handles worker errors and unreadable messages,
passes cancellation into load/inference requests, and terminates failed or
canceled workers before a retry. Successful jobs keep their loaded worker.
The drive verifies a readable error, cancellation during a held module
load, and a successful real-model retry. This is a recovery fix, not an
established diagnosis of the 2026-10-14 Vite request abort.

Unit tests cover response routing, progress, worker startup failures,
unreadable/error replies, cancellation, and synchronous send failures.
The broader platform and storage limits below still apply.

## 2026-10-14 — Edge on Windows

- App revision: `7243fb6` (before this drive and log were added).
- Browser: headless Microsoft Edge `155.0.4283.45`, fresh isolated profile.
- OS: Windows 11 Pro, `10.0.26200` (build 26200).
- Origin: `http://localhost:1420`; viewport: 1600 × 950.
- Reproduce: `node scripts/drive/run.mjs scripts/drive/web-capabilities.js`.
  Full machine-readable results go to `scratch/drive-web-capabilities.json`.
  Fixtures come from `node scripts/make-fixtures.mjs`.

### Media and project persistence

| Check | Observed result |
| --- | --- |
| H.264 import from a fixture URL, save, reload, reopen from Home | Passed: same asset persisted and a nonblack frame rendered. Project JSON is in OPFS; URL imports retain their original URL and still require it to be reachable. |
| H.264 import through the local file picker, save, reload, reopen | Passed: media persisted in OPFS and rendered after fixture URL requests were blocked. No live file handle or fixture HTTP request was needed after reload. |
| `h264-1080p30.mp4` | Decoded and rendered; AVC video, AAC audio reported. |
| `hevc-1080p.mp4` | Decoded and rendered; HEVC video reported. |
| `vp9-opus.webm` | Decoded and rendered; VP9 video, Opus audio reported. |
| `h264-aac.mkv` | Decoded and rendered; AVC video, AAC audio reported. |
| `prores-422.mov` | Expected refusal: “prores-422.mov: this browser can't decode ProRes. The desktop app can.” No asset added. |

Rendered-frame checks measure pixels, rather than only accepting an import
API response. The local-file check separately verifies OPFS persistence:
the URL check alone would not prove that media bytes were copied into OPFS.

**2026-10-18:** URL imports are now copied into OPFS like picked files, up
to 1 GiB ([[ADR-073 Templates land as a block and the web keeps what it imports]]);
the asset's `src` is the OPFS key. `scripts/drive/web-media.js` imports a
fixture by URL, checks the OPFS copy's size, blocks the URL, reloads, and
renders the picture from the copy.
Audio tracks were identified by metadata; listening quality was not tested.

### Export

Exported the first second of the H.264 fixture at 720p, then loaded each
export into a browser video element to check that it decodes.

| Container | Video / audio | Bytes | Engine duration / frames | Decoded dimensions / duration |
| --- | --- | ---: | --- | --- |
| MP4 | AVC / AAC | 721,595 | 1 s / 30 | 1280 × 720 / 1.002667 s |
| WebM | VP9 / Opus | 298,441 | 1 s / 30 | 1280 × 720 / 1.02 s |

These are short sample exports, not long-project, sound-quality, or
frame-accuracy qualification. Container duration includes audio timing.

### Captions

**Not verified.** Two runs on `speech-test.wav`, using
`onnx-community/whisper-tiny.en_timestamped` (Fast English), did not finish
within five minutes each. The second run waited 300,297 ms, produced no
caption text, and still displayed “Downloading model…0%” and the progress
toast “Downloading speech model (first time only)…”.

The captured failed request was Vite's optimized
`@huggingface_transformers.js` dependency (`net::ERR_ABORTED`), not a
reported model-weight download failure. This is evidence of the observed
stall, not a diagnosis of its cause or proof that captions cannot work in
Edge. A follow-up should inspect worker module loading and the first-run
download; no caption or worker implementation was changed in this task.

### Scope and limits

- **Not applicable on the web:** desktop FFmpeg proxies, the desktop MCP
  server, and the desktop headless `--render` CLI. Browser automation used
  here is a test harness, not that desktop CLI.
- **Untested:** the native save-file picker (requires a real user click),
  other browsers, other operating systems, offline caption model reuse,
  long projects and exports, and desktop behavior.
- Codec support can vary with browser, hardware and operating system. These
  fixtures passing on this machine does not guarantee universal support.
- Browser storage can be cleared or evicted; this checks a page reload,
  not backup, recovery after eviction, or migration between origins.
- The drive returns failure when a capability such as captions is not
  verified. ProRes's readable refusal is an expected passing check.

See [[Architecture]], [[User guide]], and [[ADR-003 Desktop first, one build, a platform seam]].
