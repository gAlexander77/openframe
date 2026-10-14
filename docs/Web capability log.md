# Web capability log

Desktop is the primary product. This log records observations from the
client-only browser build; it does not establish desktop/browser parity.

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
