---
tags: [research, media-engine, webcodecs, mediabunny, webgl, web-audio]
created: 2026-10-13
updated: 2026-10-13
status: living
aliases: [Browser media stack, Media engine research]
---

# Web media engine

What we know about building the editing, preview and export engine in TypeScript inside the webview and the browser: mediabunny over WebCodecs, a WebGL2 compositor, Web Audio, ffmpeg.wasm as the web fallback, and on-device AI. The goal is that nobody pays for these lessons twice.

Related notes:
- [[Tauri desktop media]]: serving bytes to the webview, the frame pipe to FFmpeg, WebView2 specifics.
- [[AI and automation]]: AI product features.
- [[ADR-004 Timeline time is integer frames]]
- [[Conventions]], in particular rule 9: frames are a resource.

> [!abstract] The decisions on one screen
> - **mediabunny 1.61.4** (MPL-2.0) does every demux, decode, encode and mux. It is the consensus web media layer: Remotion retired its own parser for it, and OpenCut, Diffusion Studio and FreeCut run on it.
>   - Its **v2** branch adds `VideoSampleCursor` (`seekTo` / `seekToKey` / `next`), but it is not on npm yet. Hide the scrub cursor behind an interface so it can be swapped later.
> - **Scrubbing:** keep a `VideoSampleSink.samples(t)` iterator alive per clip and roll it forward within a GOP. Use `EncodedPacketSink.getKeyPacket(t, { verifyKeyPackets: true })` to decide whether to roll forward or re-open. Coalesce seeks, latest wins. Do not call `getSample(t)` on every pointer event, because each call builds a new decoder.
> - **Playback:** the `AudioContext` clock is master, corrected by `getOutputTimestamp()`. Video follows it from a `VideoSampleSink.samples()` iterator per visible clip and drops late frames.
>   - Audio comes either from `AudioBufferSink.buffers()` scheduled as `AudioBufferSourceNode`s (the mediabunny player) or, at scale, from one TS mixer feeding an AudioWorklet.
>   - Use `CanvasSink` only for thumbnails.
> - **Export:** pipe the same `render(n)` and mixer into an `Output` with `Mp4OutputFormat` and a `StreamTarget`, writing at each chunk's position, never into memory.
>   - Video goes in through `VideoSampleSource` or `CanvasSource`, audio through `AudioSampleSource` or `AudioBufferSource`.
>   - `await` every `add()`. Correct for AAC priming.
>   - For one-file jobs (proxies, conform, remux), use `Conversion`.
> - **Codecs:** H.264, VP9 and Opus are the safe set (on Linux, only when the GStreamer plugins are installed).
>   - HEVC decode is hardware-only. On WebView2 it needs the "HEVC Video Extensions" from the Microsoft Store.
>   - AAC encode is missing on Linux Chrome and Windows N; use `@mediabunny/aac-encoder` there.
>   - Safari has no AV1 and no 10-bit through WebCodecs. `AudioDecoder` and `AudioEncoder` arrived only in Safari 26.
>   - WebKitGTK has WebCodecs from 2.44, backed by GStreamer and depending on installed plugins. It has no WebGPU.
>   - ProRes decode is available through `@mediabunny/prores`. DNxHR, CineForm and MPEG-2 need FFmpeg.
> - **GPU:** WebGL2 is the baseline, because it is the only API on all three webviews. WebGPU is an optional fast path on WebView2 and macOS 26.
> - **Proxies:** short-GOP 720p proxies built in the background make scrubbing cheap, the way every desktop NLE does it.
> - **ffmpeg.wasm 0.12** is a single-thread GPL core, 25× slower than native. Use it only to remux or proxy unsupported input on the web. Desktop uses Rust FFmpeg.
> - **AI:**
>   - Captions: transformers.js **4.3.1** with `onnx-community/whisper-*_timestamped` and `return_timestamps: 'word'`.
>   - Mattes: MediaPipe or MODNet for live preview, BiRefNet_lite for the final pass.
>   - Noise: RNNoise.
>   - Never ship Bria RMBG (non-commercial) or @imgly (AGPL).

> [!info] How this was verified (2026-10-13)
> - **mediabunny:** read from the 1.61.4 package (`.d.ts` and `src/`), the repo's `examples/` and `v2` branch, and its issue tracker.
> - **Browser support:** MDN browser-compat-data (raw JSON), the WebCodecs, WebGPU and Web Audio specs, and Chromium and WebKit source.
> - **Libraries and AI:** npm and the Hugging Face Hub API for versions and sizes.
> - Items marked *(unverified)* could not be confirmed against a primary source. Benchmark them before relying on them.


## 1. mediabunny, concretely

> [!info] Version and verification
> Every signature below was checked against the published type definitions (`dist/mediabunny.d.ts`) and the source (`src/media-sink.ts`, `src/source.ts`) of **mediabunny 1.61.4**, the npm `latest` on 2026-10-12. License: MPL-2.0, which allows closed-source use; only modified mediabunny files must be published. Repo: https://github.com/Vanilagy/mediabunny (~7.3k stars, pushed daily). Docs: https://mediabunny.dev. Remotion, Diffusion Studio, Kino, Screen Studio, Tella and React Video Editor sponsor it, and Remotion deprecated its own parser in its favor.

**Deprecations that older tutorials still use.** Synchronous track getters (`track.codec`, `.rotation`, `.displayWidth`, `.languageCode`) became async methods (`getCodec()`, `getRotation()`, `getDisplayWidth()`). `QUALITY_HIGH` and the other constants became `new Quality('high')`. The `bitrate` option became `quality`. `StreamSource` became `CustomSource`. `onread` became `source.on('read', ...)`. The library warns at runtime if it is loaded twice (two versions in the bundle). Dedupe it, because two copies break `instanceof` checks.

### 1.1 Input and sources

```ts
import { Input, ALL_FORMATS, BlobSource, UrlSource, CustomSource } from 'mediabunny';

// File or Blob (file picker, HTML5 drop, OPFS). Zero IPC. 8 MiB cache, up to 4 parallel stream readers.
const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

// HTTP(S), or a Tauri asset/custom protocol URL (convertFileSrc). 64 MiB cache, 2 parallel requests.
const remote = new Input({
  source: new UrlSource(url, { maxCacheSize: 64 * 2 ** 20, parallelism: 2, requestInit: { headers } }),
  formats: ALL_FORMATS,
});

// Anything else: Tauri fs plugin, IPC, OPFS SyncAccessHandle, a cache layer.
const custom = new Input({
  source: new CustomSource({
    getSize: () => size,
    read: (start, end) => readRange(start, end), // Uint8Array or ReadableStream<Uint8Array>
    prefetchProfile: 'fileSystem',               // 'none' (default) | 'fileSystem' | 'network'
    maxCacheSize: 16 * 2 ** 20,
  }),
  formats: ALL_FORMATS,
});
// Input implements Disposable: `using input = new Input(...)`, or call input.dispose() to cancel reads and close decoders.
```

- **`ALL_FORMATS`** = MP4, QuickTime, Matroska/WebM, Ogg, WAVE, MP3, ADTS, FLAC, MPEG-TS and HLS. To trim the bundle, pass a subset of the singletons (`[MP4, QTFF, WEBM, MATROSKA, WAVE, MP3]`). Matroska also reads WebM, since WebM is a subset.
- **`UrlSource` range behavior.** Every request is an *open-ended* range request (`Range: bytes=N-`), which doubles as a probe. Reads are orchestrated over several workers, with a network prefetch profile that grows aggressively on sequential access. If the server answers `200` instead of `206`, the source switches to **sequential streaming**: old data is evicted from the cache, reads into evicted regions **throw**, and a one-time console warning is printed. The fix is a server that honors `Range`, or `maxCacheSize: Infinity`. Responses with `Content-Encoding` make `Content-Length` and `Content-Range` meaningless, so those are ignored. A `Range` header passed in `requestInit` is read as an offset and length into the resource, which is useful for files embedded in larger files. Retries use exponential backoff and give up early when CORS is suspected. Current versions also handle a server that **caps** unbounded range requests, which Tauri's asset protocol does. That fix came from [#231](https://github.com/Vanilagy/mediabunny/issues/231), a Tauri `convertFileSrc` "stream reader stopped unexpectedly" error.
- **`FilePathSource`** is server-only (Node, Bun or Deno through `node:fs`). It throws in a webview. In Tauri, use `UrlSource` on a range-capable custom protocol or a `CustomSource` over IPC (see [[Tauri desktop media]]).
- **`ReadableStreamSource`** is *unsized* and sequential (its default cache is 32 MiB). Use it only for linear passes over growing files (MediaRecorder output, for example), never for random access.
- `source.slice(offset, length)` gives a `RangedSource` for files inside files.

### 1.2 Tracks and metadata

```ts
const video = await input.getPrimaryVideoTrack();   // also getVideoTracks({ filter, sortBy })
const audio = await input.getPrimaryAudioTrack();
const duration = (await input.getDurationFromMetadata()) ?? (await input.computeDuration()); // cheap first, then exact

if (video) {
  const codec = await video.getCodec();                 // 'avc'|'hevc'|'vp9'|'av1'|'vp8'|'prores'|null
  const codecString = await video.getCodecParameterString(); // 'avc1.640028'
  const ok = codec !== null && (await video.canDecode()); // real decoder config, real isConfigSupported
  const w = await video.getDisplayWidth();              // after pixel aspect ratio *and* rotation
  const h = await video.getDisplayHeight();
  const coded = [await video.getCodedWidth(), await video.getCodedHeight()];
  const rotation = await video.getRotation();           // 0|90|180|270, clockwise, applied before flip
  const flip = await video.getFlip();
  const par = await video.getPixelAspectRatio();        // {num, den}, anamorphic DV/HDV
  const color = await video.getColorSpace();            // VideoColorSpaceInit
  const hdr = await video.hasHighDynamicRange();
  const alpha = await video.canBeTransparent();         // VP8/VP9 alpha (WebM BlockAdditional)
  const fps = await video.computeFrameRateMetrics();    // probes 256 packets by default
  // fps.underlyingFrameRate === null means VFR; bestGuessFrameRate snaps to 23.976/29.97/...; medianFrameRate
  const stats = await video.computePacketStats(256);    // { packetCount, averagePacketRate, averageBitrate }
  const t0 = await video.getFirstTimestamp();           // can be >0 or <0 (edit lists, B-frame delay)
  const cfg = await video.getDecoderConfig();           // ready-made VideoDecoderConfig
}
```

- **Frame rate never comes from header metadata.** `computeFrameRateMetrics()` fits the actual packet timestamps to a lattice. Use `bestGuessFrameRate` to propose a project rate. Treat `underlyingFrameRate === null` (phone footage, screen recordings) as VFR (see §2.6).
- `getCodec()` returns `null` for codecs mediabunny does not know, such as DNxHD, MPEG-2, Cineform and H.263. `getInternalCodecId()` still gives the container's FourCC or CodecID, so the UI can say "DNxHR, transcoding with FFmpeg" instead of "unsupported". Custom coders can polyfill only the known codecs: "It is not possible to add new codecs."
- `input.getMetadataTags()` returns title, date and cover art.

### 1.3 Sinks (decode side)

All sinks are cheap to construct and do no I/O. They are stateless, except `CanvasSink` with a pool.

| Sink | Yields | Use for |
|---|---|---|
| `EncodedPacketSink(track)` | `EncodedPacket` (no decode) | Keyframe probing, GOP maps, remux, proxies through FFmpeg |
| `VideoSampleSink(track, { hardwareAcceleration?, optimizeForLatency? })` | `VideoSample`, a wrapper around `VideoFrame` that **must be closed** | The compositor (WebGL/WebGPU upload) |
| `CanvasSink(track, { width, height, fit, rotation, flip, crop, alpha, poolSize, decoderOptions })` | `{ canvas, timestamp, duration }` | Thumbnails, filmstrips, simple previews |
| `AudioSampleSink(track)` | `AudioSample`, a wrapper around `AudioData` that must be closed | Waveforms, mixing in a worker, export |
| `AudioBufferSink(track)` | `{ buffer: AudioBuffer, timestamp, duration }` | Direct Web Audio scheduling |

`CanvasSink` details:
- It applies rotation, flip, crop and fit for you (`'fill'|'contain'|'cover'`), and downscales with mipmapping, so 4K-to-160px thumbnails do not alias.
- It closes the underlying sample itself.
- With `poolSize: N`, canvases are **reused round-robin**: a canvas you got N results ago is overwritten. The media player uses `poolSize: 2` (current and next frame).
- It returns `OffscreenCanvas` in workers.
- On Firefox it always uses an alpha canvas, working around opaque-canvas `VideoFrame` glitches.
- For a WebGL compositor, use `VideoSampleSink` instead and upload the `VideoFrame`, which skips an extra 2D-canvas copy. Apply `sample.rotation`, `sample.flip` and `pixelAspectRatio` in your quad transform.

`EncodedPacketSink` API:
- `getPacket(t)`, `getKeyPacket(t, { verifyKeyPackets: true })`, `getNextPacket(p)`, `getNextKeyPacket(p)`, `getFirstPacket()`, `packets(start?, end?)`.
- `metadataOnly: true` fetches timestamps without payloads, which is cheap on MP4 because it reads only the `moov`. Use it to build a GOP index.
- `verifyKeyPackets` inspects the bitstream, because some files mislabel delta frames as key frames.

### 1.4 Retrieval cost: `getSample` vs `samples()` vs `samplesAtTimestamps()`

What the 1.61.4 source actually does (`BaseMediaSampleSink`):

| Call | Internals | Cost per call | Use for |
|---|---|---|---|
| `getSample(t)` / `getCanvas(t)` / `getBuffer(t)` | Runs `samplesAtTimestamps([t])`: **creates a new decoder**, finds `getKeyPacket(t)`, decodes key frame → target, flushes, **closes the decoder** | Decoder configure (hardware decoders are not free) + decode of up to a whole GOP, every time | One-off stills, posters, a seek target |
| `samples(start, end)` / `canvases()` / `buffers()` | One decoder. Starts at the key packet ≤ `start`, decodes forward and discards frames before `start`, yielding the frame covering `start` first. Pre-decodes with a bounded queue (≤40 packets in flight while nothing is buffered, ≤8 once decoded samples wait). The end is *not* packet-bounded, because of B-frames and HEVC leading pictures, so a little extra is decoded past `end` | One seek, then sequential throughput | **Playback, export, linear analysis** |
| `samplesAtTimestamps(iterable)` | One decoder. Groups requested timestamps by GOP and decodes each packet at most once for sorted input. Decodes a GOP **only when the key packet changes, time goes backwards, or the iterator ends**. Flushes between GOPs; duplicates are emitted as clones | Efficient for batches | Thumbnail strips, sparse sampling, scene detection |

> [!warning] Two traps in the table
> - **Lazy feeding.** If you feed `samplesAtTimestamps` an async iterable that yields scrub positions one at a time, the frame for the last position is not emitted until the next position arrives in a different GOP (or the iterator ends). It is a batch API, not an interactive one.
> - **Drift in export.** Driving export with `samplesAtTimestamps(frameTimes)` drifts and freezes when the computed times do not line up with real sample times ([#368](https://github.com/Vanilagy/mediabunny/issues/368)). Use `samples()` for anything sequential.

Iterators own decoders. `break` out of a `for await` and cleanup happens automatically. A manually driven iterator **must** get `await it.return()`, or its decoder and queued frames leak. Disposing the `Input` cancels everything; a pending `next()` then throws `InputDisposedError`.

### 1.5 Scrubbing (random access) recipe

mediabunny v1 has no stateful seek API. The author's own recipe ([#303](https://github.com/Vanilagy/mediabunny/issues/303), [#182](https://github.com/Vanilagy/mediabunny/issues/182); he built the scrubbing in Diffusion Studio Pro on it):

1. Keep one live `VideoSampleSink.samples(t)` iterator per visible clip. It *is* the decoder.
2. On a seek to `t'`, look up `getKeyPacket(t')` with an `EncodedPacketSink`. If `t'` is ahead of the iterator's current frame **and** its key frame is at or before that frame, keep **pulling** `next()` until the frame covers `t'`. Otherwise call `return()` and open a new `samples(t')`. A backward seek always means a new iterator.
3. Coalesce seeks (latest wins), with a single in-flight seek per clip. Pointer-move fires 60 to 120 events per second, and a seek costs a decoder configure plus up to a GOP of decode.
4. For instant feedback, show the **key frame first** (fast: one decode), then the exact frame. Keep a small cache of **downscaled** frames around the playhead (`ImageBitmap` or small canvases, not `VideoFrame`s) for frame-stepping backwards. Holding full `VideoFrame`s eats VRAM and **stalls the decoder**.
5. Proxies with short GOPs (`keyFrameInterval: 0.5` or all-intra) make scrubbing nearly free (§1.8).

```ts
class ScrubCursor {
  private it: AsyncGenerator<VideoSample> | null = null;
  private head: VideoSample | null = null;          // the one frame we own
  private keys: EncodedPacketSink;
  constructor(track: InputVideoTrack, private sink = new VideoSampleSink(track)) {
    this.keys = new EncodedPacketSink(track);
  }
  async seek(t: number): Promise<VideoSample | null> {   // call serialized, latest-wins
    const key = await this.keys.getKeyPacket(t, { verifyKeyPackets: true });
    const rollForward = this.it && this.head && t >= this.head.timestamp && key && key.timestamp <= this.head.timestamp;
    if (!rollForward) {
      await this.it?.return(); this.head?.close(); this.head = null;
      this.it = this.sink.samples(t);
    }
    for (;;) {
      if (this.head && this.head.timestamp + this.head.duration > t) return this.head; // borrowed: do not close
      const r = await this.it!.next();
      if (r.done) return this.head;                 // past the end: hold the last frame
      this.head?.close(); this.head = r.value;
    }
  }
  async dispose() { await this.it?.return(); this.head?.close(); }
}
```

> [!tip] Coming in mediabunny v2 (not on npm as of 2026-10-13)
> The `v2` branch adds `VideoSampleCursor` and `AudioSampleCursor`, with `seekTo(t)`, `seekToKey(t)`, `next()`, `nextKey()`, `iterate()`, `isIdle()` and `close()`. Calls are queued and serialized so the decoder can plan, plus a `PacketCache`. This is exactly the scrub primitive above. Wrap the hand-rolled cursor behind an interface so it can be swapped later.

### 1.6 Playback: the media-player example's algorithm

Source: [`examples/media-player/media-player.ts`](https://github.com/Vanilagy/mediabunny/blob/main/examples/media-player/media-player.ts) (live at https://mediabunny.dev/examples/media-player/). It registers the `@mediabunny/ac3`, `@mediabunny/dts` and `@mediabunny/prores` decoders first.

1. **Master clock = `AudioContext`, even without audio.** `playbackTime = playing ? ctx.currentTime - ctxStartTime + mediaTimeAtStart : mediaTimeAtStart`. The context is created at the **audio track's sample rate**, "for correct acoustic results". A `GainNode` handles volume (quadratic curve).
2. **Video.** `CanvasSink(track, { poolSize: 2, fit: 'contain', alpha })`. On start or seek, `canvases(playbackTime)` is opened, the first frame is drawn immediately, and the second is held as `nextFrame`. Every `requestAnimationFrame`, if `nextFrame.timestamp <= playbackTime`, it is drawn and `updateNextFrame()` is kicked off. That function pulls the iterator, **draws immediately any frames already late** (catch-up, no waiting), and stores the first future frame. A `setInterval(render, 500)` keeps it ticking when rAF is throttled in hidden tabs.
3. **Audio.** On play: `buffers(playbackTime)` from an `AudioBufferSink`. For each `{buffer, timestamp}`, one `AudioBufferSourceNode` is scheduled at `ctxStartTime + timestamp - mediaTimeAtStart`, **rounded to the sample grid** (`Math.round(t * sr) / sr`, which prevents sub-sample clicks). A chunk that starts in the past is started now with an offset (`node.start(ctx.currentTime, ctx.currentTime - start)`). Nodes are tracked in a `Set` and removed `onended`. **Lookahead throttle:** when a buffer is ≥1 s ahead of the playhead, the loop polls every 100 ms until it is within 1 s.
4. **Pause** snapshots `playbackTime`, calls `return()` on the audio iterator, and `stop()`s every queued node. **Seek** = pause, set the time, restart the video iterator, then resume if it was playing. An `asyncId` counter invalidates in-flight async work after a seek.

What it does *not* do, and an editor needs: `outputLatency` compensation (see §4.2); multiple clips and tracks; clip boundaries and pre-roll; handling of `interrupted` AudioContext state on iOS ([#152](https://github.com/Vanilagy/mediabunny/issues/152)); decoder reclamation after 10 s idle (§2.3).

### 1.7 Output side (encode and mux)

```ts
import {
  Output, Mp4OutputFormat, WebMOutputFormat, MovOutputFormat, MkvOutputFormat,
  BufferTarget, StreamTarget, CanvasSource, VideoSampleSource, AudioBufferSource, AudioSampleSource,
  Quality, canEncodeAudio, getFirstEncodableVideoCodec,
} from 'mediabunny';

const output = new Output({
  format: new Mp4OutputFormat({ fastStart: false }),   // false | 'in-memory' | 'reserve' | 'fragmented'
  target: new StreamTarget(writable, { chunked: true, chunkSize: 16 * 2 ** 20 }),
});
const codec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { // your preference order;
  width: 1920, height: 1080, frameRate: 30, quality: new Quality('high'),       // intersect with
}); // output.format.getSupportedVideoCodecs(). Checked with real isConfigSupported → usually 'avc'
const video = new CanvasSource(compositorCanvas, {   // or new VideoSampleSource({...}) and add(sample)
  codec: codec!, quality: new Quality('high'), keyFrameInterval: 2, latencyMode: 'quality',
  // fullCodecString: 'avc1.640033',  // force a level (5.1) for 4K if auto-pick is wrong
});
const audio = new AudioBufferSource({ codec: 'aac', quality: new Quality('high') }); // or AudioSampleSource
output.addVideoTrack(video, { frameRate: 30 });      // use 30000 / 1001 for 29.97: timestamps snap to it
output.addAudioTrack(audio);
await output.start();
for (let i = 0; i < frames; i++) {
  renderTimelineAt(i);                               // draw into compositorCanvas
  await video.add(i / 30, 1 / 30);                   // snapshot is taken synchronously inside add()
  if (i % 30 === 0) await audio.add(await mixSecond(i / 30)); // interleave about 1 s of audio per second of video
}
video.close(); audio.close();                        // early close frees encoders
await output.finalize();                             // or output.cancel()
```

- **Formats:** `Mp4OutputFormat`, `MovOutputFormat`, `WebMOutputFormat`, `MkvOutputFormat`, `OggOutputFormat`, `WavOutputFormat`, `Mp3OutputFormat`, `AdtsOutputFormat`, `FlacOutputFormat`, `MpegTsOutputFormat`, `HlsOutputFormat`, `CmafOutputFormat`. Containers accept these codecs:
  - **MP4:** avc, hevc, vp8, vp9, av1, prores, aac, opus, mp3, vorbis, flac, ac3, eac3, dts, PCM.
  - **WebM:** vp8, vp9, av1, opus, vorbis.
  - **MOV:** everything, including PCM u8, s8, μ-law and A-law.
- **`fastStart`.**
  - `'in-memory'` keeps every chunk in RAM until finalize. It is the default for `BufferTarget`.
  - `false` writes the `moov` at the end. It is cheapest, and the default for `StreamTarget`.
  - `'reserve'` pre-reserves header space and needs `maximumPacketCount` on every track.
  - `'fragmented'` writes fMP4, which is streamable at constant memory.
- **Targets.**
  - `BufferTarget` holds the whole file in one ArrayBuffer. The docs say keep it under about 100 MB.
  - `StreamTarget` emits `{ type: 'write', data, position }` chunks, which **must be written at `position`, not concatenated**. MP4 patches its header at the end. That fits `FileSystemWritableFileStream` directly (`showSaveFilePicker().createWritable()`, Chromium only). In Tauri, wrap it in a `WritableStream` that sends `(position, bytes)` to a Rust command with a raw body (see [[Tauri desktop media]]).
  - `AppendOnlyStreamTarget` is for strictly sequential sinks (fragmented MP4, appendOnly MKV, HLS).
  - `NullTarget` discards output and pairs with `onMoof` and `onCluster` callbacks.
- **Backpressure:** **always `await source.add()`**. It resolves only when encoder (`encodeQueueSize < 4`) and writer backpressure allow. Unawaited loops queue unbounded `VideoFrame`s and run out of GPU memory.
- **Interleave tracks:** the muxer buffers packets until all tracks catch up. Add audio in chunks alongside video, or add the smaller track first.
- **`VideoSampleSource.add(sample)`** does not take ownership: close the sample yourself after the `await`. `CanvasSource.add(t, d)` constructs `new VideoSample(canvas)` synchronously, so you may redraw after `await`.
- **Quality.**
  - `new Quality('very-low'|'low'|'medium'|'high'|'very-high')` or a number from 0 to 1, with `{ preferBitrate, bitrateMode }`.
  - `new Quality({ bitrate: 8e6, bitrateMode: 'constant' })` for an explicit bitrate.
  - `new Quality({ quantizer: 23, bitrate: 8e6 })` for CRF-like quantizer mode, with bitrate as the fallback. Quantizer ranges are in the [Mediabunny Codec Registry](https://mediabunny.dev/codec-registry/overview).
  - Qualitative levels scale bitrate with resolution, frame rate and codec.
- **Other encode options:**
  - `keyFrameInterval` (default 2 s in sources, 5 s in `Conversion`).
  - `sizeChangeBehavior` (`'deny'` by default).
  - `alpha: 'keep'` (VP9 alpha goes out as side data, so it needs WebM or MKV).
  - `hardwareAcceleration`, `latencyMode`, `contentHint`.
  - `transform: { width, height, fit, rotate, crop, frameRate, process }`.
  - `onEncodedPacket` and `onEncoderConfig` hooks.
- **Capability queries:**
  - `canEncode(codec)` tests 1280×720 and 48 kHz stereo.
  - `canEncodeVideo(codec, { width, height, frameRate, quality, hardwareAcceleration })` tests a specific config.
  - `getEncodableVideoCodecs()`, `getFirstEncodableVideoCodec(list, opts)`, and the audio equivalents.
  - `canDecodeVideo(codec, cfg)` and `getDecodableCodecs()`.
  - All of these account for **registered custom coders**.

**Codec polyfills** (same version train, MPL-2.0 package license; mind the bundled engine's license):

| Package | Adds | Engine |
|---|---|---|
| `@mediabunny/aac-encoder` | AAC-LC encode (Linux Chromium and Firefox builds lack one) | libavcodec WASM (LGPL) |
| `@mediabunny/mp3-encoder` | MP3 encode | LAME WASM (LGPL) |
| `@mediabunny/flac-encoder` | FLAC encode | libFLAC WASM (BSD) |
| `@mediabunny/ac3` | AC-3/E-AC-3 decode+encode | libavcodec WASM |
| `@mediabunny/dts` | DTS decode+encode | libavcodec WASM |
| `@mediabunny/prores` | **ProRes decode** | TurboRes WASM. Multithreaded when `crossOriginIsolated`; slower threads otherwise |
| `@mediabunny/server` | All codecs in Node, Bun or Deno | node-av (FFmpeg) |

Usage: `if (!(await canEncodeAudio('aac'))) registerAacEncoder();`. You can also write your own `CustomVideoDecoder` or `CustomAudioEncoder` with `registerDecoder` or `registerEncoder`; calls are serialized for you. On desktop, a `CustomVideoDecoder` could forward packets to Rust FFmpeg, but shipping decoded 4K frames back over IPC (33 MB per frame in RGBA) is the wrong shape. Prefer Rust-made proxies.

### 1.8 `Conversion` (transcode, proxies, conform)

```ts
const conversion = await Conversion.init({
  input,
  output: new Output({ format: new Mp4OutputFormat(), target: new StreamTarget(writable) }),
  video: { width: 960, codec: 'avc', quality: new Quality('medium'), keyFrameInterval: 0.5, frameRate: 30 }, // proxy
  audio: { codec: 'aac', sampleRate: 48000, numberOfChannels: 2 },
  trim: { start: 10, end: 70 },
  // tracks: 'primary', copy: false, tags: (t) => t, composable: false
});
if (!conversion.isValid) console.warn(conversion.discardedTracks); // e.g. undecodable codec, no encodable codec
conversion.onProgress = (p, inputSeconds) => {};
await conversion.execute();            // or execute({ until, pauseSignal }); conversion.cancel()
```

- It copies packets without re-encoding (transmux) when possible. `forceTranscode` overrides that, and so do `keyFrameInterval` and `sampleFormat`, which force a transcode.
- Fan-out: an array of options produces several output tracks.
- `video.process` and `audio.process` hooks transform frames and samples.
- `allowTransformationMetadata: false` bakes rotation into pixels.
- Known issues:
  - Safari H.264 **Main/High encoding hangs** in the default `quality` latency mode ([#541](https://github.com/Vanilagy/mediabunny/issues/541), still current on Safari 27). The workaround is Baseline or `latencyMode: 'realtime'`, which `Conversion` does not expose.
  - The AMD hardware HEVC encoder on Windows can emit a delta frame first ("First packet must be a key packet", [#365](https://github.com/Vanilagy/mediabunny/issues/365)).
  - An audio transcode can introduce a fixed start offset ([#356](https://github.com/Vanilagy/mediabunny/issues/356)). See also AAC priming in §4.6.

## 2. WebCodecs realities

### 2.1 API availability

From MDN browser-compat-data, as of October 2026:

| | Video{De,En}coder | Audio{De,En}coder | `copyTo({format:'RGBA'})` | `VideoFrame.rotation/flip` | `VideoFrame.metadata()` |
|---|---|---|---|---|---|
| Chrome/Edge → **WebView2** | 94 | 94 | 127 | 138 | 145 |
| Safari → **WKWebView** | 16.4 | **26** | no | no | no |
| WebKitGTK → **Tauri Linux** | 2.44+ (GStreamer) | 2.44+ | no | no | no |
| Firefox (desktop) | 130 | 130 | 130 | no | no |

- All codec interfaces are `[Exposed=(Window,DedicatedWorker), SecureContext]`.
- `VideoFrame` and `AudioData` are **Transferable**: `postMessage(frame, [frame])` moves them and detaches the sender's copy.
- Tauri on Windows serves the app from `http://tauri.localhost`, and `*.localhost` counts as potentially trustworthy. Still, assert `isSecureContext` at startup.
- WebKit's `WebCodecsVideoEnabled` is a WebKit preference rather than a Safari-only switch, so WKWebView in a macOS app gets WebCodecs. This is an inference from the source; verify it on a real build.

### 2.2 Codec matrix

| Codec | WebView2 / Chrome (Windows) | Safari / WKWebView (macOS 26) | WebKitGTK (Linux) | Firefox |
|---|---|---|---|---|
| H.264 decode | HW (D3D11) + FFmpeg SW | VideoToolbox | GStreamer (needs plugins) | yes (platform / OpenH264) |
| H.264 encode | HW (Media Foundation) + **OpenH264 SW** in Chrome (whether WebView2 ships it is unverified) | VideoToolbox, but Main/High hangs in `quality` mode on Safari 27 ([#541](https://github.com/Vanilagy/mediabunny/issues/541)) | x264enc / openh264enc / vah264enc if installed | yes (backend unverified) |
| HEVC decode | **HW only.** Chrome uses D3D11VA. **Edge/WebView2 uses the MFT and needs the "HEVC Video Extensions" Store package** (otherwise `0xC00DB3B3`) | yes (VideoToolbox) | GStreamer (needs plugins) | Windows MFT only (WebCodecs exposure unverified) |
| HEVC encode | Chrome 130+, Windows **hardware only** (pre-131 capped at 1080p30); AMD may emit a delta first ([#365](https://github.com/Vanilagy/mediabunny/issues/365)) | yes | x265enc / vah265enc if installed | no |
| VP8 / VP9 | SW libvpx + HW decode | VP8, VP9 profile 0 and 2 (libwebrtc) | yes | yes |
| AV1 | decode: dav1d SW + HW. Encode: libaom SW (slow) + HW where present | **off** (`WebCodecsAV1Enabled` is false on Cocoa) | GStreamer `av1enc`/`svtav1enc` | decode yes |
| AAC decode | yes (proprietary build; Edge and WebView2 ship it) | yes (LC/HE/HEv2/LD/ELD) | GStreamer | yes |
| AAC encode | **OS encoder only**: Windows/Mac yes; **Linux Chrome no**; **Windows N SKUs no**; 44.1/48 kHz, 1/2/6 ch; on Windows bitrate ∈ {96,128,160,192}k | yes | depends on GStreamer | no → `@mediabunny/aac-encoder` |
| Opus | decode + encode (≤2 ch for encode) | decode + encode (≤2 ch) | yes | yes |
| MP3 / FLAC / Vorbis / PCM decode | yes | yes (FLAC needs `description`) | yes | yes |
| MP3 / FLAC encode | no → mediabunny extensions | no ("not supported" in source) | — | no |
| ProRes, DNxHR, CineForm, MPEG-2 | **no** (ProRes via `@mediabunny/prores` WASM; others need FFmpeg) | no (WebCodecs; AVFoundation can, but it is not exposed) | no | no |
| 10-bit output frames | decode yes (`I420P10`, or `format: null` for GPU frames) | **no** (`WebCodecsHighBitDepthEnabled` false) | ? | partial |
| Alpha encode (`alpha:'keep'`) | **not supported** natively. mediabunny emulates it with a second parallel encoder for VP8/VP9 alpha in WebM | no | no | no |

Notes on the matrix:
- **Open-source Chromium builds without `proprietary_codecs` have no H.264 or AAC.** WebView2 and Edge ship them.
- **Linux is the weak platform.** Codecs depend on which GStreamer plugins the distro installs (patent-stripped builds may lack H.264/AAC, unverified per distro). WebKitGTK has no WebGPU, and WebGL2 on NVIDIA needs workarounds (§3.2).
- Plan for FFmpeg in Rust to be the decode path of last resort there.
- Rule: **never hardcode the matrix.** At startup, probe the real configs with `getDecodableCodecs()`, `canEncodeVideo(codec, { width, height, frameRate })`, and `track.canDecode()` for each imported file. Cache the results per platform and webview version.
- `isConfigSupported` is a hint only. `configure()` and `encode()` can still fail, so handle the `error` callback and fall back (software, another codec, or FFmpeg).

### 2.3 Lifetime, backpressure, reclamation

**Close every `VideoFrame`, `VideoSample` and `AudioData`.** The spec says unclosed frames "can cause decoding to stall". Chrome warns: *"A VideoFrame was garbage collected without being closed..."*
- Mechanism on Windows: the D3D11 decoder allocates about `required_pictures + 1` output buffers, and `CanReadWithoutStalling()` turns false when all of them are held by the page.
- Holding roughly **5–17 frames per decoder** (codec- and level-dependent) freezes it. There is no error, just silence.
- So: **upload and close** in the same tick. Never keep a cache of raw decoder `VideoFrame`s; copy to your own textures or `ImageBitmap`s.

**Backpressure.** Respect `decodeQueueSize` and `encodeQueueSize` using the `dequeue` event (Chrome 106, Firefox 130, Safari 16.4). mediabunny already does this: it waits for `dequeue` while `encodeQueueSize >= 4`, and caps the decoder queue at 40 or 8 packets. Your job is to `await` its promises and pull its iterators at the rate you consume.

**Reclamation.** Spec §11:
- A UA may close codecs that are **inactive** (no progress for 10 s) or **background** (`document.hidden`), with `QuotaExceededError`.
- It may *not* reclaim active background encoders, or decoders while an active encoder exists **in the same global**.
- Chromium's real policy (`reclaimable_codec.cc`, `codec_pressure_gauge.cc`): reclaim only when **backgrounded + over the pressure threshold + inactive 90 s**. The thresholds are Windows 6 decoders, Mac 24, Linux 0 (always eligible).
- In practice, mediabunny saw "Codec reclaimed due to inactivity" on a hardware encoder during a long pause ([#531](https://github.com/Vanilagy/mediabunny/issues/531), fixed by respawning).
- Consequences for an editor:
  1. A paused preview's idle iterators can die. Catch the error and **recreate the iterator at the playhead**.
  2. Run **export decode + encode in the same worker**, so the decoders are protected by the active encoder when the window is minimized.
  3. Tauri's `backgroundThrottling` setting is unsupported on Windows and Linux, so do not count on it.

**Concurrency budget.**
- Chromium's pressure gauge assumes about 6 decoders per process on Windows (around ¼ of where allocation starts failing). Plan for **2–4 concurrent 4K hardware decoders**, and more at 1080p or with proxies.
- Multi-cam and picture-in-picture with many 4K layers need proxies.
- Memory per 4K frame: NV12 ≈ 12.4 MB, P010 ≈ 24.9 MB, RGBA8 ≈ 33.2 MB, RGBA16F ≈ 66 MB.

### 2.4 Seeking cost and GOPs

- After `configure()` or `flush()`, the next chunk **must be a key frame**, or `decode()` throws `DataError` (`[[key chunk required]]`).
- A seek means: decode from the previous key frame, discard frames before the target, deliver the target. Long-GOP camera and phone H.264/HEVC (1–10 s GOPs, up to about 300 frames) makes each seek decode up to 300 frames.
- **Flush is expensive** (the pipeline drains), so do not flush per frame. mediabunny flushes between GOP batches and at iterator end.
- Mislabeled key frames break decoding:
  - Open-GOP recovery-point SEI frames are labeled as keys, and Chromium refuses them ([#477](https://github.com/Vanilagy/mediabunny/issues/477)).
  - Some non-IDR frames trigger "wasn't a key frame" ([#396](https://github.com/Vanilagy/mediabunny/issues/396); Chromium bug [519012430](https://issues.chromium.org/issues/519012430)).
  - Fixes: `verifyKeyPackets: true` and staying on current mediabunny.
- Interlaced H.264 (`frame_mbs_only_flag=0`) has a Chromium hardware-decode bug ([crbug 456919096](https://issues.chromium.org/issues/456919096)); mediabunny forces software decode for it. Expect interlaced broadcast and AVCHD files to be slow. Deinterlace through FFmpeg proxies.
- **Mitigation:** generate **edit proxies** at import, with short GOPs (`keyFrameInterval: 0.5–1 s`) at 540p/720p, in the background (§1.8), as Premiere, Resolve and VEGAS do. Export from originals.

### 2.5 B-frames and timestamps

- Decoders output in **presentation order** but keep each input chunk's timestamp. If a file has B-frames but no composition offsets (a missing `ctts`), the output timestamps come out wrong. mediabunny reassigns timestamps from the sorted input PTS list.
- **Safari does not always emit in presentation order**; mediabunny re-sorts for WebKit.
- If you use raw WebCodecs, replicate both behaviors. Better, do not use raw WebCodecs for decode at all.
- Encoders may emit out of order (Chrome allows up to 16 reordered outputs), so muxers must handle PTS ≠ DTS. mediabunny does.
- The first PTS is often greater than 0 (B-frame delay, edit lists, a 2-frame offset). Normalize a clip's source time against `track.getFirstTimestamp()`; never assume 0.
- Negative timestamps mean "decode but do not present".

### 2.6 VFR

- Phones, screen recorders and OBS produce VFR. `computeFrameRateMetrics().underlyingFrameRate === null` flags it.
- The timeline is CFR in integer frames ([[ADR-004 Timeline time is integer frames]]). For project frame *n*, show the **last source frame with PTS ≤ source time**. That is exactly `getSample(t)` / `samples()` semantics. Never index frames by count.
- Audio drift: VFR video still has continuous audio, so take sync from timestamps, never from frame counts.
- For export, use `frameRate` on `addVideoTrack` (it snaps timestamps) and drive by timeline frames.

### 2.7 Rotation, aspect and color

**Rotation and flip.**
- They come from container metadata (`tkhd` matrix): `getRotation()`, `getFlip()`, `getTransformationMatrix()`.
- `VideoFrame.rotation/flip` exist only in Chrome 138+, and Chrome's fast WebGL upload path is **skipped** for transformed frames. Apply rotation in your compositor's quad transform, portably.
- Swap the display width and height for 90° and 270°. `getDisplayWidth()` already does.
- The encoder throws `DataError` if frame orientation changes mid-stream.

**Pixel aspect ratio.**
- `getPixelAspectRatio()` gives it for anamorphic DV and HDV (1440×1080 shown at 16:9).
- `getSquarePixelWidth()` gives the corrected width before rotation.

**Color.**
- `VideoColorSpace` has `{primaries, transfer, matrix, fullRange}`.
- With no VUI and no container color info, the spec's default for YUV is **BT.709**. SD content (BT.601, smpte170m) without tags then gets a slight hue shift. Pass the container's `colr`/`nclc` info in the decoder config; mediabunny parses `colr`, including QuickTime `nclc`.
- Full range versus limited (16–235): phone (Android) footage is often **full range**. A wrong assumption crushes or lifts blacks.
- WebGL and canvas upload convert to sRGB using the frame's color space. Trust it only when tagged.
- WebKit returns non-spec enum values (`'unspecified'`, `smpte240m`, `film`...). This made mediabunny's `VideoSample` throw on WebKitGTK ([#555](https://github.com/Vanilagy/mediabunny/issues/555), open on 2026-10-13). Wrap the sample creation and map unknown values to `null`.

**10-bit and HDR.**
- iPhone HEVC Main10 HLG and Dolby Vision decode on Chrome to GPU-only frames with **`format === null`**. Then `copyTo()` and `allocationSize()` throw unless you pass `{ format: 'RGBA' }` ([#256](https://github.com/Vanilagy/mediabunny/issues/256)). `copyTo({format})` is Chrome 127+ and Firefox 130+, not Safari.
- WebGL and canvas paths **tone-map or clip to SDR**; there is no HDR pipeline in WebGL2. WebGPU with `rgba16float` and `toneMapping: 'extended'` canvases is the only browser path to HDR output. That is a v2 feature.
- Safari exposes no 10-bit formats.
- Detect `hasHighDynamicRange()` and warn: "HDR source is converted to SDR".

### 2.8 Hardware acceleration flags

- `hardwareAcceleration: 'no-preference' | 'prefer-hardware' | 'prefer-software'` is a **hint** on decoder and encoder configs.
- `prefer-hardware` with no hardware encoder means "unsupported". `prefer-software` for HEVC on Windows is unsupported, since there is no OS software HEVC encoder.
- Leave it at `no-preference` (mediabunny's default and advice). Retry with `prefer-software` on a decode error, e.g. driver bugs, green frames on Linux Chromium ([#280](https://github.com/Vanilagy/mediabunny/issues/280)), or interlaced content.

**Encoder must-knows.**
- H.264 needs **even dimensions**.
- The coded size (rounded to 16) must fit the level: `avc1.640028` (4.0) up to 1080p, **`avc1.640033` (5.1) for 4K**.
- `latencyMode: 'quality'` (default) versus `'realtime'` (may drop frames). Never use `'realtime'` for export, except as the Safari workaround.
- `bitrateMode: 'quantizer'` with per-frame `{ avc: { quantizer } }` gives CRF-like control. mediabunny exposes this as `Quality({ quantizer })`.
- Force key frames with `encode(frame, { keyFrame: true })`.

## 3. Compositing

### 3.1 VideoFrame → WebGL2

`VideoFrame` is a `TexImageSource`, so `texImage2D(..., frame)` works in Chrome, Safari and Firefox.

```ts
gl.bindTexture(gl.TEXTURE_2D, tex);
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame); // full re-spec, not texSubImage2D
sample.close(); // or frame.close(): release the decoder buffer as soon as the upload is issued
```

**Chrome's zero-copy fast path** (`TexImageHelperMediaVideoFrame`) requires all of:
- `texImage2D`, **not `texSubImage2D`**, at level 0, full rect, with no `UNPACK_SKIP_*`;
- `TEXTURE_2D`;
- **no frame transform** (no `VideoFrame.rotation`);
- `unpackColorSpace === 'srgb'`;
- no integer or half-float internal formats.

With those, GPU-backed frames are copied GPU-to-GPU and CPU frames go up as YUV with GPU conversion. Anything else hits a slow Skia path. So:
- keep one `RGBA8` texture per layer slot and re-spec it each frame;
- apply rotation, flip, crop and pixel aspect ratio in the vertex transform;
- never ask the browser to rotate.

**Alternatives.**
- `frame.copyTo(buf)`, then upload the Y, U and V planes and convert in your own shader. This gives exact BT.601/709 and range control, but a GPU→CPU readback for hardware frames (about 12 MB per 4K frame). Use it only for color-critical paths or for formats the browser misconverts.
- `createImageBitmap(frame)` is another copy, useful only for caching downscaled frames.
- `WEBGL_video_texture` never shipped.

**ANGLE.** WebView2 runs WebGL over ANGLE on D3D11. Losing the GPU (driver reset, sleep) fires `webglcontextlost`. Handle restore by re-creating every texture and program; keep your scene graph independent of GL objects.

### 3.2 WebGPU (`importExternalTexture`)

```ts
const ext = device.importExternalTexture({ source: frame /* VideoFrame */, colorSpace: 'srgb' });
// WGSL: @group(0) @binding(0) var vid: texture_external;  textureSampleBaseClampToEdge(vid, samp, uv)
// Expires when frame.close() is called (VideoFrame sources); HTMLVideoElement sources expire at end of task.
```

| Platform | WebGPU | `importExternalTexture(VideoFrame)` |
|---|---|---|
| Chrome/Edge/**WebView2** Windows/macOS | 113 | 116 |
| Chrome Linux | 144 (Intel Gen12+ only) | 144 |
| **Safari / WKWebView (macOS 26)** | 26 | 26 |
| Firefox | 141 Windows; 145+ macOS Apple Silicon; none on Linux/Intel Mac | 144 (Windows only) |
| **WebKitGTK** | **none** (`ENABLE_WEBGPU` off) | — |

**Verdict:** **WebGL2 is the required baseline.** It is the only GPU API on all three webviews plus Linux. WebGPU is an *optional* path for WebView2 and macOS 26, behind a capability check, with `device.lost` → fall back to WebGL2. Driver blocklists, device loss and Linux absence make WebGPU-only a non-starter in 2026.

Write effects once in a portable form, e.g. GLSL with a small transpile step or a tiny shader DSL. Do not maintain two hand-written effect libraries. Start with WebGL2 and add WebGPU later for HDR (`rgba16float` canvas) and compute effects.

**Linux WebKitGTK WebGL2 caveats** ([tauri#9394](https://github.com/tauri-apps/tauri/issues/9394)):
- NVIDIA on X11 can break WebGL. The workaround is Wayland.
- `WEBKIT_DISABLE_DMABUF_RENDERER=1` fixes blank windows and Wayland Error 71, but falls back to a slow non-hardware transport.
- `WEBKIT_DISABLE_COMPOSITING_MODE=1` stops crashes on resize.
- `__NV_DISABLE_EXPLICIT_SYNC=1` is a cheaper fix.
- Ship a "safe graphics" launcher flag.

### 3.3 Render loop design

- **Pull model, keyed by timeline frame.**
  - `render(frameN)` asks each visible clip's cursor for "the frame at source time s". Cursors are §1.5 iterators during playback and seek cursors when paused.
  - It uploads, composites bottom-up into an FBO, then blits to the canvas.
  - Playback ticks on `requestAnimationFrame` but *derives* `frameN` from the audio clock (§4.2). Never `frameN++`.
- **Never block rAF on decode.** If a layer's frame is not ready, draw the last good one (and count a dropped frame). The decode pumps run ahead asynchronously, ideally in a worker.
- **One FBO pipeline:** per-layer texture → effects (ping-pong FBOs) → transform and blend into the accumulation FBO → transitions sample two FBOs → output.
- Use the **same function for preview and export**. Export just calls `render(n)` for every n, without rAF, and awaits readiness of every layer (no dropping).
- **Preview resolution:** render to an FBO at ½ or ¼ resolution while playing, then full resolution on pause, as Resolve and Premiere do. That is the biggest single performance lever, together with proxies.

### 3.4 OffscreenCanvas and workers

| | Chrome | Firefox | Safari |
|---|---|---|---|
| `transferControlToOffscreen` | 69 | 105 | 16.4 |
| OffscreenCanvas WebGL2 | 69 | 105 | **17** |
| Worker `requestAnimationFrame` | 69 | 99 | 16.4 |
| Worker `self.fonts` / `FontFace` | 69 | 105 | 15 |
| `AudioContext` in a worker | **never**: Web Audio contexts are Window-only. Workers feed an AudioWorklet via SAB or `MessagePort` |||

Recommended topology:
- **Main thread:** UI and timeline state, plus the `AudioContext`, which must live here.
- **Engine worker:** mediabunny inputs, decoders, compositor on `OffscreenCanvas` (from `canvas.transferControlToOffscreen()`), and export encoders.
  - VideoFrames never cross threads.
  - The worker owns the clock *mirror*. The main thread posts `{ctxTime, perfTime}` samples from `getOutputTimestamp()` a few times a second, or the worker reads them from a SharedArrayBuffer.
- **Thumbnail/waveform worker(s):** a separate `Input` per file, `CanvasSink` at 160 px with `samplesAtTimestamps`, and `AudioSampleSink` peaks.
- `VideoFrame` transfer works (`postMessage(f, [f])`, detaches the sender), but every hop is a chance to leak. Keep decode and composite in the same worker.

### 3.5 Premultiplied alpha

- Defaults: the WebGL canvas has `premultipliedAlpha: true`, while uploads default to `UNPACK_PREMULTIPLY_ALPHA_WEBGL = false` (straight alpha). Canvas2D and ImageBitmap content is premultiplied internally.
- Pick **premultiplied everywhere**:
  - premultiply on upload (`UNPACK_PREMULTIPLY_ALPHA_WEBGL = true` for straight sources), or in the shader;
  - blend with `gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)`;
  - un-premultiply only for effects that need straight color (levels, curves, keying);
  - output premultiplied.
- Symptoms of mixing: dark fringes around text and PNG edges, and halos in crossfades.
- Export frames: `new VideoFrame(canvas, { timestamp, alpha: 'discard' })`. Chrome cannot encode alpha. For transparent exports (VP9 WebM, ProRes 4444 through FFmpeg), use mediabunny's dual-encoder path or Rust.
- Video with alpha (VP8/VP9 alpha in WebM): `canBeTransparent()` and `CanvasSink({ alpha: true })`. mediabunny merges the alpha decoder stream for you.

### 3.6 Text and graphics via Canvas2D

- Draw titles into an `OffscreenCanvas` 2D context (works in workers), then `texImage2D(..., offscreenCanvas)`.
  - **Cache the texture** until the text, style or size changes. Re-rasterize only when animated properties need it; transform animation happens in the GL quad, not by re-rasterizing.
- Fonts in workers: `self.fonts.add(new FontFace(name, url))` and `await face.load()` *before* the first draw. Otherwise the first export frames render in a fallback font. In export, wait for `document.fonts.ready` and the worker's font set.
- Rasterize at **output resolution** (or 2× the preview scale). Scaling a small raster up blurs.
- `letterSpacing`: Chrome 99, Firefox 115, Safari 18.4. `fontKerning`: no Safari.
- Emoji and COLR fonts differ per OS. For pixel-identical export across platforms, bundle fonts, and consider rendering text through a WASM shaper (HarfBuzz) later.
- `measureText` gives `actualBoundingBox*` for tight boxes. Pad for shadows and strokes.

### 3.7 Export capture

- `new VideoFrame(canvasOrOffscreen, { timestamp, duration })`. `timestamp` (µs) is mandatory for canvas sources. It **copies** the current bitmap; Chrome has a GPU path.
- Create the frame **in the same task as the draw calls**. With `preserveDrawingBuffer: false`, the buffer may be cleared once presented. mediabunny's `CanvasSource.add()` captures synchronously, so `render(); await src.add(t, d)` is correct.
- **Never** use `canvas.captureStream()` or MediaRecorder for export. They run on wall-clock time, so frames are dropped when rendering is slower than real time and duplicated when faster.

## 4. Audio

### 4.1 Timeline playback with Web Audio

**Context.**
- Use one `AudioContext({ latencyHint: 'playback', sampleRate: 48000 })` per app, created on the main thread (Web Audio contexts are Window-only), and `resume()`d on a user gesture.
- `'playback'` trades about 20–100 ms of extra latency for fewer underruns. That is right for an NLE, where latency shows only as A/V offset and you compensate for it.
- Fix the project rate at 48 kHz, so every source is resampled once at decode (§4.4).
- iOS/Safari has an `interrupted` state (calls, Siri, tab switch). Listen for `statechange` and re-arm `resume()` on the next gesture ([mediabunny#152](https://github.com/Vanilagy/mediabunny/issues/152)).

**Two scheduling designs:**

| Design | How | Pros | Cons |
|---|---|---|---|
| A. `AudioBufferSourceNode` per chunk (mediabunny player) | Decode with `AudioBufferSink.buffers(t)`; per chunk `src.start(ctxStart + (clipStart + ts - srcIn) - mediaStart)`, rounded to the sample grid; per-clip `GainNode` for volume, fades and pan | Trivial; sample-accurate; Web Audio nodes for effects | ~47 nodes/s per AAC track (1024-sample frames). Each seek must stop every node. Effects graph ≠ export unless the same graph runs in OfflineAudioContext. Clicks at clip cuts unless faded |
| B. Pull mixer + AudioWorklet (recommended at scale) | Decode and mix in the engine worker (same code as export), writing interleaved float PCM into a **SharedArrayBuffer ring buffer**. An `AudioWorkletProcessor` reads 128 frames per quantum | One mixer for preview and export (WYSIWYG); constant node count; easy scrub/jog audio; lets the worker own the clock | Needs `crossOriginIsolated` for SAB. Without it, fall back to `MessagePort` chunks (more jitter, larger buffer) |

**Design A recipe (the media player, extended):**
- Lookahead: keep 0.5–1 s scheduled ahead, and **throttle decode when ≥1 s ahead**.
- Round `when` to `1/sampleRate`.
- If a chunk is late, `start(now, offset)`.
- Keep a `Set` of live nodes and `stop()` them all on pause or seek.
- Apply 2–5 ms gain ramps at every clip boundary, and on pause/seek, to avoid clicks:
  - `gain.setValueAtTime(0, t)`
  - `gain.linearRampToValueAtTime(1, t + 0.003)`
- Merge tiny decoded chunks into roughly 0.25–0.5 s `AudioBuffer`s to cut the node count.
- Never set a node's `playbackRate` for sync correction; it pitch-shifts. Correct video to audio, never the reverse.

### 4.2 A/V sync: the audio clock is master

```ts
// Audible media time, compensating output latency (Bluetooth: 100–300 ms!)
function audibleMediaTime(): number {
  const { contextTime, performanceTime } = ctx.getOutputTimestamp(); // Chrome 57, Firefox 70, Safari 14.1
  const nowCtx = contextTime! + (performance.now() - performanceTime!) / 1000;  // extrapolate to "now"
  return mediaStart + (nowCtx - ctxStart);
}
// Fallback: mediaStart + (ctx.currentTime - (ctx.outputLatency ?? 0) - ctx.baseLatency - ctxStart)
```

- `currentTime` is the time of the **next render quantum the graph processes**, not what the user hears.
- What the speakers play lags by about `baseLatency` (graph → OS) plus `outputLatency` (OS → device).
  - `outputLatency`: Chrome 102, Firefox 70, **Safari 18.4**. `baseLatency`: Safari 14.1.
  - On wired output the lag is 10–40 ms, so ignoring it (as the mediabunny player does) is fine. On Bluetooth it is 100–300 ms, and video visibly **leads** audio.
- `getOutputTimestamp().contextTime` is "the context time of the sample frame currently being rendered by the output device". It already includes the latency and is the best audible clock.
- Re-read the latency values periodically: they change when the output device changes (`devicechange`, `setSinkId`).
- **Video presentation:** each rAF, compute `t = audibleMediaTime()` and convert it to timeline frame `n = frameAt(t)` ([[ADR-004 Timeline time is integer frames]]). Present the newest decoded frame with PTS ≤ the source time, and drop late frames rather than queuing them.
- When paused, the clock is the playhead. Never derive the video clock from `performance.now()` alone: it drifts against the audio crystal by 10s of ppm, which adds up to about 0.1 s per hour.
- In the worker, mirror the clock from periodic `{contextTime, performanceTime}` samples.
- A dedicated worker has its **own** `performance.timeOrigin`, so convert: `workerPerf = mainPerf + (mainTimeOrigin - self.performance.timeOrigin)`.

### 4.3 Export mixing: `OfflineAudioContext` and its limits

- `new OfflineAudioContext({ numberOfChannels, length, sampleRate })` allocates the **whole output buffer up front**: channels × length × 4 bytes.
  - A 2-hour stereo mix at 48 kHz is 2 × 345.6M × 4 B ≈ **2.8 GB**, which fails or crashes the renderer.
  - Even 30 minutes (≈690 MB) is risky alongside 4K decode.
  - It also renders the whole graph *before* returning anything, so there is no progress and no streaming.
  - `suspend(t)` and `resume()` (Chrome 41, Safari 9, **not Firefox**) let you schedule sources progressively, but do not shrink the buffer.
  - OfflineAudioContext is Window-only; it can't run in a worker.
- **Chunked render:** render the timeline in windows of, say, 10–30 s.
  - Each window gets a fresh OfflineAudioContext that schedules only the clips overlapping `[t0 - preroll, t1]`.
  - Add a **pre-roll** equal to the longest effect tail (reverb or delay; 0 if none) and discard it.
  - Feed each window to `AudioBufferSource` or `AudioSampleSource` in order.
  - Sources must be re-seeked per window with `AudioBufferSink.buffers(srcStart, srcEnd)`.
  - Stateful nodes (compressors, filters) restart at each window. That causes subtle discontinuities, which pre-roll mitigates.
  - mediabunny itself avoids OfflineAudioContext for resampling because "putting multiple resampled audio samples back to back... produces flaky results" (`src/resample.ts`).
- **Better long-term: a pure-TS (or WASM) mixer in the worker.**
  - Sum gain-and-pan-applied float32 per clip, with fades as sample-accurate ramps.
  - It is deterministic, streams (constant memory), shares code with the AudioWorklet preview (design B), runs in a worker, and is trivially testable in `src/lib` with vitest.
  - Use Web Audio nodes only for effects that genuinely need them, and replicate those in the mixer later.
- Interleave audio with video while muxing: roughly one second of audio per second of video (§1.7).

### 4.4 Decoding: `decodeAudioData` vs `AudioDecoder`

| | `ctx.decodeAudioData(arrayBuffer)` | `AudioDecoder` (via `AudioSampleSink`/`AudioBufferSink`) |
|---|---|---|
| Input | Whole file in memory | Streamed packets, any container mediabunny reads |
| Output | One `AudioBuffer`, **resampled to the context rate** | `AudioData` chunks at the source rate, with timestamps |
| Memory | Full decoded PCM (1 h stereo 48k f32 ≈ 1.4 GB) | Bounded |
| Seek | No | Yes (key-packet based; audio is cheap) |
| Containers | Browser-dependent (no MKV in Safari and so on) | MP4/MOV/MKV/WebM/Ogg/WAV/MP3/FLAC/ADTS/TS |
| Availability | Everywhere | Chrome 94, Firefox 130, **Safari 26** (on older Safari, mediabunny can't decode audio natively) |

- Use `AudioDecoder` (mediabunny sinks) for clips.
- Use `decodeAudioData` only for short one-shots: sound effects, or previews in old Safari.
- Watch for encoder priming and edit lists. AAC and Opus decoders output priming samples, and the container's edit list (`elst`) says how many to skip. mediabunny honors edit lists on read and fixes negative packet timestamps itself ("Chromium does not respect negative packet timestamps").
- **An MP3 has no edit list: its delay is in the LAME tag, and mediabunny does not read it.** LAME (and ffmpeg's libmp3lame, encoder `Lavc`) writes its encoder delay (576 samples) and end padding into the first frame's Xing/"Info" tag, 21 bytes after the encoder name; every MP3 decoder adds 529 samples of its own. ffmpeg skips delay + 529 at the start and padding - 529 at the end (`mp3_parse_info_tag`, only for `LAME`, `Lavf` and `Lavc`). mediabunny 1.61 reads the tag's frame and byte counts, skips the tag frame, and presents everything else, so WebCodecs hands over 1105 samples (23.02 ms at 48 kHz) that are not sound, and the decoded length counts the padding. The app reads the tag itself and moves the sound's origin past the delay ([[ADR-112 An MP3 plays without its encoder delay, as ffmpeg plays it]]). mediabunny's own MP3 muxer writes a bare Xing tag with no LAME extension, so nothing trims an MP3 it wrote.

### 4.5 Sample-rate conversion

**Who resamples what:**
- `AudioBufferSourceNode` resamples buffers whose `sampleRate` differs from the context's rate. `decodeAudioData` resamples to the context rate.
- **mediabunny's resampler** (`Conversion` `sampleRate`, `AudioTransformOptions.sampleRate`) uses **naive linear interpolation, with no low-pass**. The source comment admits it is "suboptimal... especially for downsampling".
  - 44.1 kHz → 48 kHz upsampling is acceptable.
  - **96 kHz → 48 kHz aliases.**

**Policy:**
- Mix at 48 kHz.
- Resample each source once with a band-limited resampler. Options:
  - a windowed-sinc/polyphase TS implementation (a few hundred lines, testable);
  - a Speex or libsamplerate WASM build;
  - `OfflineAudioContext` with one whole-clip render. Fine for short clips, but subject to the chunk-boundary caveat above.
- Cache the resampled peaks and PCM per clip.

**Channel layouts:** Web Audio's default up/down-mix rules (`channelInterpretation: 'speakers'`) handle 5.1 → stereo downmix. Make the downmix explicit in the mixer, so preview equals export.

### 4.6 AAC encoder priming (export sync bug)

- WebCodecs doesn't expose encoder delay.
- Exported MP4/AAC from Chrome has about **1024** samples of priming silence. Safari shifts audio similarly, and AVFoundation additionally trims **2112** frames. Neither writes an `elst` automatically.
- See [#444](https://github.com/Vanilagy/mediabunny/issues/444), [#549](https://github.com/Vanilagy/mediabunny/issues/549), [#447](https://github.com/Vanilagy/mediabunny/issues/447) and [w3c/webcodecs#626](https://github.com/w3c/webcodecs/issues/626).
- Since mediabunny PR [#485](https://github.com/Vanilagy/mediabunny/pull/485), you can **shift encoded AAC packets to negative timestamps** by the priming delay (with `EncodedAudioPacketSource`, or `onEncodedPacket` plus a remux), and an edit list is written.
- Otherwise drop the first 1024 samples of the mix.
- Verify with a beep test (a click at t=0 in both video and audio) on Chrome, Safari and FFmpeg-based players.

> [!warning] Measured 2026-10-13: the delay depends on the encoder
> Against a PCM export of the same timeline, decoded with ffmpeg: Edge 155's **Media Foundation AAC encoder adds 0 samples** (a 1024 shift would make sound 21.3 ms early), while `@mediabunny/aac-encoder` (libavcodec WASM) adds **exactly 1024**. So measure it per device: encode a click, decode it back, shift by the distance it moved ([[ADR-016 AAC encoder delay is measured, not assumed]]). The negative-timestamp route works in mediabunny 1.61.4: `new AudioBufferSource(cfg, { startTimestamp: -delay / 48000 })` makes the MP4 muxer write an edit list. Opus in WebM/MKV measured 0 (its pre-skip is in the header).

### 4.6.1 A cold decoder's first packet (decode side)

> [!warning] Measured 2026-10-20: start decoding before the first sample you need
> `AudioBufferSink.buffers(t)` and `AudioSampleSink.samples(t)` start a fresh decoder at the packet holding `t`. An MP3 frame leans on the frames before it (the bit reservoir), so that first frame came out as silence: rendering the 30 s MP3 fixture in the editor's 10 s windows left 12-22 ms of digital silence at every window start, and a clip starting mid-file (a song spliced at 12 s) began with 26 ms of silence: in every export, preview and measurement. Decoding from 0.1 s earlier and dropping what falls before `t` (`DECODE_PREROLL`, [[ADR-104 Voice and sound an agent can trust without ears]]) removed both; `preview_audio` now lists any 3-100 ms dropout inside sound.

> [!note] Measured 2026-10-20: a file's head, and an MP3's encoder delay
> The pre-roll stops at container time 0, so an AAC file's priming packet (-23.2 ms, 1024 samples) is never decoded; the head still decodes right: a 44.1 kHz AAC song from its in-point 0 renders identical in shape to ffmpeg's decode (correlation 1.000 from 5 ms on, lag 0). An MP3 is another matter: mediabunny presents LAME's encoder delay (1105 samples, 23.02 ms at 48 kHz, ffprobe's `start_time`), which ffmpeg and gapless players trim, so the app heard every MP3 23.02 ms later than they do (cross-correlation at 0.3 s and 5 s in), and a grid taken from a cue sheet sat 23 ms early in the file ([[ADR-107 A split plays on, a cut keeps its downbeat, and a duck follows its music]]). Fixed by reading the LAME tag (§4.4, [[ADR-112 An MP3 plays without its encoder delay, as ffmpeg plays it]]): the app's decode of the 30 s MP3 fixture now matches ffmpeg's sample for sample (within 1.2e-6) at its head, middle and end, at lag 0 through the export mix, and it is 30.000 s long, not 30.024. Four AAC files stayed at lag 0.

> [!warning] Measured 2026-10-20: a split is not a splice
> Two clips that play one file on from each other (a split) are scheduled as two sources, each through its own gain. Ramping each to nothing over a 4 ms click guard, as a splice needs, left an 18 dB hole of a few milliseconds at every split of a sounding clip. Without the guard the two sources meet sample for sample (the render matches the unsplit clip exactly but for one sample's interpolation), and a compressor on each half is filled by the first half's 6 ms delay tail; the second half's compressor still starts with no gain reduction, 24-40 dB under the signal for ~10 ms ([[ADR-107 A split plays on, a cut keeps its downbeat, and a duck follows its music]]).

> [!note] Measured 2026-10-20: a split's halves share one compressor
> A `DynamicsCompressorNode` (and a biquad EQ) carries state, so two nodes cannot continue one sound. Routing both halves' sources through one EQ and compressor, fanned out to each half's own filters and gain, renders the split identical to the unsplit clip (error -150 dBFS; it was 15-21 dB under the signal for 12-14 ms with the strong and voice presets). The gains then gate the shared output, which brought out an `AudioParam` default: a `GainNode` passes at its `value` (1) until its first automation event, so a half whose gain was first set 10 ms before its start passed the other half's sound until then, doubled. Create the gain at 0. A `setValueAtTime` exactly at the end of a `setValueCurveAtTime` is allowed (the curve owns [t, t + d)), and closes the earlier half's gain at the cut ([[ADR-117 A whole file relinks to itself, effects keep their size at every render size, and a split's halves share one compressor]]).

### 4.7 Waveform peaks

- Compute in a worker, from `AudioSampleSink.samples()` in one linear pass. `copyTo(f32, { planeIndex: c, format: 'f32-planar' })`.
- **Min/max per bucket** (not RMS alone; draw RMS inside min/max if wanted), in a **mipmap**:
  - level 0 = 256 samples per bucket (≈187.5 buckets/s at 48 kHz);
  - each next level halves, by taking the min of mins and the max of maxes.
- Store as `Int8Array`/`Int16Array` per channel (as BBC `audiowaveform` `.dat` and peaks.js do). Cache by file hash plus mtime in IndexedDB/OPFS on the web, or on disk via Rust.
- A 1-hour file at 256 samples per bucket is about 675k buckets per channel × 2 B × 2 (min and max), ≈ 2.7 MB. That is fine.
- Render with a canvas per visible tile, picking the level whose samples-per-pixel is ≤ the zoom.
- Progressive: show partial peaks while the scan runs. The scan runs at decode speed, roughly 50–200× real time for AAC (unverified figure; benchmark it).
- On desktop, Rust (FFmpeg or symphonia) can compute peaks faster and for codecs the webview can't decode.

## 5. Existing editors: lessons and pitfalls, not product models

> [!note] Scope
> The product model stays CapCut, Premiere, VEGAS and Resolve (see [[CapCut desktop]] and [[Professional NLE features]]). The projects below are weighed only by user base, and mined only for what users praise and what broke. Star counts are from the GitHub API on 2026-10-13. Small projects (Omniclip, Etro, and so on) are omitted unless one is the only source of a lesson.

### 5.1 Web and hybrid engines

| Project | User base | Decode / composite / audio / export | Lessons (with sources) |
|---|---|---|---|
| **OpenCut** ([repo](https://github.com/OpenCut-app/OpenCut)) | ~94k stars, MIT | **Classic** ([archived 2026-05](https://github.com/OpenCut-app/opencut-classic), still runs opencut.app): Next.js 16 with mediabunny ^1.29 for demux, decode and export, a Rust wgpu compositor compiled to WASM (WGSL), and wavesurfer waveforms. **2026 rewrite**: a "Rust core" for all targets, with a **GPUI** desktop app (not Tauri, [#480](https://github.com/OpenCut-app/OpenCut/issues/480) declined) and LGPL FFmpeg 8.1 | **Import OOM**: whole-file `arrayBuffer()` → `.slice(0)` → `decodeAudioData` for waveforms ([#656](https://github.com/OpenCut-app/OpenCut/issues/656), [#594](https://github.com/OpenCut-app/OpenCut/issues/594)). **MOV scrubbing froze the main thread, then kept seeking for 30+ s** after the user stopped (uncoalesced seeks, [#584](https://github.com/OpenCut-app/OpenCut/issues/584)). 3-hour export OOM-killed ([#812](https://github.com/OpenCut-app/OpenCut/issues/812)). Firefox stutter ([#580](https://github.com/OpenCut-app/OpenCut/issues/580)) and Safari MP4 upload failure ([#189](https://github.com/OpenCut-app/OpenCut/issues/189)). [#881](https://github.com/OpenCut-app/OpenCut/issues/881) lists web limits: 4 GB wasm, WebGPU 256 MB buffers and 8192 px textures, device loss mid-export, single-frame external textures, COOP/COEP |
| **Remotion** ([repo](https://github.com/remotion-dev/remotion)) | ~64k stars; source-available (free for ≤3 employees, otherwise paid) | `@remotion/web-renderer` (stable since 4.0.491) walks the DOM and paints to canvas itself (a CSS subset; z-index ignored), then encodes **through mediabunny**. **Its own `@remotion/media-parser` and `@remotion/webcodecs` are deprecated in favor of mediabunny** and are dropped in v5 ([blog](https://www.remotion.dev/blog/mediabunny), [#9659](https://github.com/remotion-dev/remotion/issues/9659)) | **Windows Intel iGPU decoder stalls after 8 open VideoFrames** ([#11020](https://github.com/remotion-dev/remotion/issues/11020), [#11393](https://github.com/remotion-dev/remotion/issues/11393)). VideoToolbox ignores `colorSpace` overrides for untagged SD H.264 ([#8952](https://github.com/remotion-dev/remotion/issues/8952)). Safari 27 H.264 export hang ([#11964](https://github.com/remotion-dev/remotion/issues/11964)). **Safari keeps only about 16 live WebGL contexts** and drops the oldest ([#11647](https://github.com/remotion-dev/remotion/issues/11647)). AAC priming of 2048 samples was lost through an ADTS intermediate, so audio ran 42.7 ms late ([#11704](https://github.com/remotion-dev/remotion/issues/11704)). Safari WebCodecs output is >10× larger unless a bitrate is set ([#4519](https://github.com/remotion-dev/remotion/issues/4519)). Background tabs throttle rAF renders |
| **Motion Canvas** ([repo](https://github.com/motion-canvas/motion-canvas)) / **Revideo** fork | 19.3k / 4.1k stars, MIT | Canvas2D scenes; export as an image sequence or through FFmpeg plugins. Revideo [documents three decoders](https://github.com/midrender/revideo/blob/HEAD/packages/docs/src/content/guide/performance/decoders.mdx): WebCodecs + mp4box (fastest, "less reliable", MP4 only), FFmpeg (2–3× slower on laptops, reliable), and `<video>` seeking (slowest, needed for transparency) | `toDataURL` was the export bottleneck; switching to raw canvas data fixed it ([#1137](https://github.com/motion-canvas/motion-canvas/issues/1137)). Audio drifted by seconds over multi-minute projects; WAV fixed what MP3 broke ([#1142](https://github.com/motion-canvas/motion-canvas/issues/1142); likely MP3 seek imprecision and priming) |
| **mediabunny examples** ([repo](https://github.com/Vanilagy/mediabunny/tree/main/examples)) | 7.3k stars; it is the media layer of OpenCut classic, Remotion, Diffusion Studio v4, FreeCut and Omniclip 2 | §1.6 media player: audio-clock master, `CanvasSink` pool of 2, `AudioBufferSink` scheduling, `asyncId` invalidation | Issues are listed throughout §1–§2: Tauri `convertFileSrc` ([#231](https://github.com/Vanilagy/mediabunny/issues/231)), WebKit color enums ([#555](https://github.com/Vanilagy/mediabunny/issues/555)), **Safari OPFS `write()` ignores a TypedArray's `byteOffset`, corrupting streamed exports** ([#459](https://github.com/Vanilagy/mediabunny/issues/459)), Safari 26 fragmented-MP4 audio muted ([#171](https://github.com/Vanilagy/mediabunny/issues/171)), and choppy Firefox playback ([#258](https://github.com/Vanilagy/mediabunny/issues/258)) |

**Same stack, cited only for a specific lesson:**
- **FreeCut** ([2.25k stars](https://github.com/walterlow/freecut); mediabunny, WebGPU-first with a Canvas2D fallback, OPFS).
  - **Exports over 30 minutes ran out of memory**: the muxed file sat in one ArrayBuffer and the whole timeline was mixed into one audio buffer. The fix streamed through `StreamTarget` to OPFS and mixed audio in **30 s windows** ([#316](https://github.com/walterlow/freecut/issues/316)). Clips with speed, pitch, EQ or reverse still fall back to the old path.
  - Leak fixes ([PR #283](https://github.com/walterlow/freecut/pull/283)): close late worker bitmaps, cap in-flight requests, an LRU of 8 extractors, and `return()` on iterators.
- **Clypra** ([3.3k stars](https://github.com/AIEraDev/Clypra), Tauri v2). Its [runtime doc](https://github.com/AIEraDev/Clypra/blob/HEAD/docs/clypra-runtime-performance-architecture.md) chose:
  - a Rust FFmpeg decoder pool with hardware acceleration;
  - a **CPAL audio clock as master**;
  - **continuous playback on a native surface**, with the webview canvas used only while paused or seeking;
  - stale frames rejected by generation, then by lateness.

**Commercial engines with public engineering notes:**
- **CapCut web** ([web.dev case study](https://web.dev/case-studies/capcut)): the shared C++ mobile engine is compiled with Emscripten. WASM SIMD gave about 300%. WebCodecs handles hardware decode, but "decoding a single 4K image to the canvas… takes tens of milliseconds".
- **Clipchamp** ([W3C talk](https://www.w3.org/2021/03/media-production-workshop/talks/soeren-balko-clipchamp-webcodecs.html)): FFmpeg-WASM muxing with WebCodecs codecs. It needed a "pre-flight" encode to obtain SPS/PPS extradata. Bridging FFmpeg's sync stack to async WebCodecs was hard, and exports stall in background tabs.
- **Kapwing** ([blog](https://www.kapwing.com/blog/working-with-google-chrome/)): ranged chunks arrive out of order; seeks decode forward from the key frame and close the frames before the target; IndexedDB serves over 90% of media reads; `<video>` was unreliable.

### 5.2 Desktop NLEs: architecture contrast

| Project | User base | Architecture | Lessons |
|---|---|---|---|
| **Shotcut** ([repo](https://github.com/mltframework/shotcut)) on **MLT** ([repo](https://github.com/mltframework/mlt), LGPL) | 15.4k stars, millions of downloads | CPU pipeline by default. **Explicit processing modes since 25.12**: 8-bit, 10-bit and linear 10-bit on CPU, plus an experimental linear GPU/CPU mode. Hardware decode only since 26.1 | Hardware decode helps only ≤1080p60 or with preview scaling, because "transferring uncompressed video between CPU and GPU RAM can be a bottleneck". It has "limited impact on seeking and scrubbing — using proxies is still recommended", and is off for export because it can be slower ([26.1 notes](https://shotcut.org/blog/new-release-26.01.30/), [FAQ](https://shotcut.org/FAQ/)). The FAQ's lesson: **GPU only pays when decode, effects and encode all stay on the GPU** |
| **Kdenlive** ([repo](https://github.com/KDE/kdenlive), MLT) | 5.9k stars; KDE's flagship NLE | Proxies are made automatically above a width threshold, with a separate alpha profile and reuse of camera proxies (GoPro, Sony, DJI). **Timeline preview rendering** caches zones into chunks in the background. Movit GPU processing is **disabled** ([docs](https://github.com/KDE/documentation-docs-kdenlive-org/blob/HEAD/getting_started/configure_kdenlive/configuration_playback.rst)) | **Proxies fix decode cost; a render cache fixes effect cost.** You need both ([doc](https://github.com/KDE/documentation-docs-kdenlive-org/blob/HEAD/tips_and_tricks/tips_and_tricks/timeline_preview_rendering.rst)). In 2026 the team prioritizes stability over features (15+ crash fixes per cycle); waveforms became 300% faster |
| **OpenShot** ([qt](https://github.com/OpenShot/openshot-qt) / [libopenshot](https://github.com/OpenShot/libopenshot), LGPL-3) | 6.6k / 1.6k stars, large install base | FFmpeg decode, Qt image compositing, JUCE audio | The playback rewrite ([PR #796](https://github.com/OpenShot/libopenshot/pull/796)) replaced relative sleeps with an **absolute schedule** (`start + n·frameDuration`), made the cache bidirectional around the playhead, added pre-roll, and removed a second audio buffer that played stale audio after seeks. **Attaching audio to video frames caused pops**, because 44100/29.97 is not an integer ([#554](https://github.com/OpenShot/libopenshot/issues/554)). In 1.0.1 (2026-09) the team was still fixing playback, seek and reader-lifecycle races |
| **Olive** ([repo](https://github.com/olive-editor/olive)) | 9.1k stars | Node-based GPU/OCIO engine rewrite (0.2) | 0.2 never left "highly unstable"; the last commits (2024-12) were CI-only. **A ground-up engine rewrite stalled the project.** Ship the simple pipeline, then extend it |

### 5.3 Signals for our architecture

1. **mediabunny is the de facto web media layer** for Remotion, OpenCut classic, Diffusion Studio and FreeCut. Remotion retired its own parser for it. Betting on it is the consensus, not a gamble.
2. **The hybrid bottleneck is moving frames between webview and native.**
   - Cap (23k stars) shipped Tauri with Rust wgpu frames over a localhost WebSocket, then **rewrote in GPUI with "no webview"**.
   - The OpenCut rewrite also chose GPUI. Clypra presents playback natively.
   - Our design avoids the problem by keeping **decode, composite and encode entirely in the webview**. Rust only serves bytes, makes proxies and handles exotic formats.
   - Any feature that needs per-frame IPC (raw frames to an FFmpeg master encoder) is the danger zone; see [[Tauri desktop media]].
3. **Proxies and a preview cache** are table stakes in every desktop NLE. Web editors that skipped them hit scrubbing walls (OpenCut #584).
4. **Every web editor hit export OOM** (OpenCut #812, FreeCut #316). Streaming targets and windowed audio come first, not later.

## 6. ffmpeg.wasm (web fallback)

### 6.1 Versions and status (npm, 2026-10-13)

| Package | Version | Published | License |
|---|---|---|---|
| `@ffmpeg/ffmpeg` | 0.12.15 | 2025-01-07 | MIT |
| `@ffmpeg/util` | 0.12.2 | 2025-01-07 | MIT |
| `@ffmpeg/core` | 0.12.10 | 2025-01-07 | **GPL-2.0-or-later** |
| `@ffmpeg/core-mt` | 0.12.10 | 2025-04-28 | **GPL-2.0-or-later** |

- Built on **FFmpeg n5.1.4** with Emscripten 3.1.40. The repo has 17.8k stars, and the last commit to `main` was 2025-09.
- A 0.13 stack exists only as about 40 **unmerged** PRs (opened 2026-09-29): FFmpeg 9.0.2, Emscripten 6, JSPI, `threads` option, 4 GB heap, AbortSignal, chunked file I/O, dav1d. Do not plan on it.
- Included libraries (`--enable-gpl`): x264, x265, libvpx, LAME, Theora, Vorbis, Opus, zlib, libwebp, freetype, fribidi, harfbuzz, libass, zimg.
- **Not included:** libaom and dav1d (so no practical AV1 decode), and fdk-aac (the native `aac` encoder is used).
- `--disable-asm`, so no SIMD.

### 6.2 Single-thread vs multi-thread, COOP/COEP

- **`@ffmpeg/core`** (single-thread) works anywhere, with no special headers. It starts with 32 MB of memory and grows.
- **`@ffmpeg/core-mt`** needs `SharedArrayBuffer`, which needs `crossOriginIsolated`, which needs both headers below:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`, which works in Chrome 96+ and Firefox 119+, **not Safari**)
  - It runs with fixed `INITIAL_MEMORY=1024MB` (no growth) and `PTHREAD_POOL_SIZE=32`.
  - **Known core-mt hangs:** `filter_complex` (#883), scaling on Chromium and Safari (#772), threading broken on Chromium (#597), OOM decoding a single 4K H.264 frame (#946).
- **COEP side effects:**
  - Every cross-origin subresource needs CORS (`crossorigin` attribute) or a `Cross-Origin-Resource-Policy` header.
  - `COOP: same-origin` severs `window.opener`, which breaks OAuth and payment popups.
  - Decide early. Cross-origin isolation also unlocks SAB ring buffers for audio (§4.1 B) and the fast path of `@mediabunny/prores`.
- **Where to set the headers:**
  - **Vite:** both `server.headers` *and* `preview.headers`.
  - **Static hosts:** a `_headers` file (Netlify, Cloudflare Pages) or `vercel.json`. GitHub Pages cannot set them; `coi-serviceworker` is the hack.
  - **Tauri:** `app.security.headers` (Tauri **2.1+**; COOP, COEP and CORP are allow-listed). It applies only to the built app, so in dev, Vite's `server.headers` supplies them.
- **Webview reality:**
  - WebView2 should honor the headers (unverified; check `self.crossOriginIsolated`).
  - WKWebView on `tauri://` historically stayed non-isolated ([tauri#1522](https://github.com/tauri-apps/tauri/issues/1522)).
  - WebKitGTK 2.42 lacked SAB even when isolated.
  - **On desktop, do not depend on core-mt. Use native FFmpeg in Rust** (see [[Tauri desktop media]]).

### 6.3 Size and speed

- `ffmpeg-core.wasm` is **32.2 MB** raw (core-mt 32.7 MB): 10.2 MB gzip, **7.2 MB brotli**. `ffmpeg-core.js` is 112 KB. The npm tarball unpacks to about 65 MB (esm and umd copies).
- Official benchmark (`-i input.webm output.mp4`): native 5.2 s; **core 128.8 s (~25× slower)**; **core-mt 60.4 s (~12× slower)**.
  - Expect 1080p x264 transcodes at a small fraction of real time.
  - Use it for remux and audio work; for video, only as a last resort.
- Lazy-load it on first need, keep one instance, and `terminate()` it when idle to free the heap. core-mt pins 1 GB.

### 6.4 Loading without a CDN (Vite)

```ts
// vite.config.ts: optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] }  (pre-bundling breaks its worker URL, #532)
import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg';
import coreURL from '@ffmpeg/core?url';          // package export '.' → dist/esm/ffmpeg-core.js
import wasmURL from '@ffmpeg/core/wasm?url';     // package export './wasm'
// MT: '@ffmpeg/core-mt?url', '@ffmpeg/core-mt/wasm?url', '@ffmpeg/core-mt/worker?url' → { coreURL, wasmURL, workerURL }

const ffmpeg = new FFmpeg();
ffmpeg.on('log', ({ type, message }) => console.debug(type, message));
ffmpeg.on('progress', ({ progress, time }) => report(progress, time / 1e6)); // time in µs; progress is "experimental"
await ffmpeg.load({ coreURL, wasmURL /*, classWorkerURL if the bundler mislocates ./worker.js */ });
```

- Without `coreURL`, the worker defaults to **unpkg**. Always pass it; that is the "no CDN" requirement.
- `toBlobURL` is needed only for cross-origin URLs; same-origin `?url` assets load directly.
- The exports were verified with `npm view @ffmpeg/core@0.12.10 exports`. The snippet itself has not been run, so smoke-test it in both `vite dev` and the built Tauri app.

### 6.5 Memory and the file system

- wasm32 heaps max out at 4 GB, and core-mt is fixed at 1 GB. The FAQ states a **2 GB hard limit** on input.
- `writeFile()` copies the whole file into MEMFS, and outputs always land in MEMFS. A 1.5 GB input therefore needs at least 3 GB of JS and wasm memory. Don't.
- **WORKERFS** (read-only, lazily reads a `File`/`Blob`, no copy). It needs `@ffmpeg/ffmpeg` ≥ 0.12.10 and `@ffmpeg/core` ≥ 0.12.4.

```ts
await ffmpeg.createDir('/in');
await ffmpeg.mount(FFFSType.WORKERFS, { files: [file] }, '/in');      // or { blobs: [{ name, data }] }
try {
  const rc = await ffmpeg.exec(['-i', `/in/${file.name}`, '-c', 'copy', '-movflags', '+faststart', '/out.mp4'], 15 * 60_000);
  if (rc !== 0) throw new Error(`ffmpeg exited ${rc}`);
  const out = (await ffmpeg.readFile('/out.mp4')) as Uint8Array;      // output still lives in MEMFS → keep outputs small
  await ffmpeg.deleteFile('/out.mp4');
} finally { await ffmpeg.unmount('/in'); await ffmpeg.deleteDir('/in'); }
```

- API: `load`, `exec(args, timeout?)` (resolves to the exit code), `ffprobe`, `terminate`, `writeFile`, `readFile`, `deleteFile`, `rename`, `createDir`, `listDir`, `deleteDir`, `mount`, `unmount`, `on('log'|'progress')`.
- **Memory64** has shipped (Chrome 133, Firefox 134; Safari behind a flag), but no released ffmpeg.wasm build uses it. **JSPI**: Chrome 137, Firefox 153, Safari 27.

### 6.6 Alternatives worth knowing

- **libav.js 6.10.9** (FFmpeg 9.0): LGPL-2.1 builds, 0BSD wrapper; you must offer sources.
  - Variants: `default` (Opus/FLAC/WAV), `webm-vp9`, `obsolete`, and others.
  - The **`webcodecs` variant** (15.7 MB unpacked) demuxes and muxes Ogg, WebM, MP4, FLAC and WAV, with *parsers only* for AAC, H.264, HEVC, VP8, VP9 and AV1, and hands decoding to native WebCodecs.
  - Async device-backed I/O means no file-size limit.
  - The H.264 and AAC variants are not on npm; build them yourself.
- **libavjs-webcodecs-polyfill 0.5.5** (0BSD) implements WebCodecs over libav.js. Frames are copied in and out.
- **mediabunny extensions** (§1.7) are the cheapest route for ProRes decode, AAC/MP3/FLAC encode, AC-3 and DTS. Prefer them over ffmpeg.wasm whenever they cover the case.

### 6.7 Role in the editor (decision)

1. **Probe with mediabunny first.** `getCodec() !== null && canDecode()` means native: done.
2. **Unknown container but known codecs** (AVI, FLV, odd TS/MXF with H.264/AAC): **remux** with `-c copy` to MP4 via WORKERFS. It runs at I/O speed.
3. **Known-but-undecodable codec:** a mediabunny extension (ProRes, AC-3, DTS), or the HEVC Video Extensions prompt on Windows.
4. **Truly unsupported** (DNxHR, CineForm, MPEG-2, HEVC without hardware, 10-bit on Safari):
   - web: ffmpeg.wasm **proxy** transcode (`-c:v libx264 -preset ultrafast -crf 23 -vf scale=-2:720 -g 15 -c:a aac`), with an honest ETA;
   - desktop: Rust FFmpeg, which is 12–25× faster than wasm.
5. **Never** use ffmpeg.wasm for final export. Export through WebCodecs via mediabunny; on desktop, Rust FFmpeg for ProRes, DNxHR, CRF x264/x265 and alpha masters.
6. **License:** `@ffmpeg/core` is GPL (x264/x265). Shipping it in the web build means GPL obligations for that distribution. The alternative is a custom LGPL build (libav.js style) without x264, using WebCodecs for H.264 encode.

## 7. On-device AI in the browser

See [[AI and automation]] for product features and agent APIs. This section covers only what runs inside the webview.

### 7.1 transformers.js v4 + Whisper captions with word timestamps

**Status.**
- `@huggingface/transformers` **4.3.1** (2026-10-06). v4.0.0 shipped 2026-03-30; the last v3 release was 3.8.1.
- v4 brings:
  - a **new WebGPU runtime** (C++, built with the ONNX Runtime team; `onnxruntime-web 1.31.0-dev`), which also runs on Node, Bun and Deno;
  - `ModelRegistry` (`is_pipeline_cached`, `get_available_dtypes`);
  - `env.useWasmCache` for offline use;
  - tokenizers split into `@huggingface/tokenizers`.
- **4.3 enabled WebGPU on Safari 26+.**
- Default dtype is `q8` on WASM and `fp32` on WebGPU. Always set `dtype` explicitly.

**Word-level timestamps.**
- `return_timestamps: 'word'` requires `alignment_heads` plus cross-attention outputs.
- Use the **`onnx-community/whisper-*_timestamped`** exports: tiny, tiny.en, base, base.en, small, small.en, medium, medium.en, large-v3-turbo. Plain exports may lack cross-attentions; that part is inferred.

```ts
// ai.worker.ts: the official whisper-word-timestamps example, condensed
import { pipeline } from '@huggingface/transformers';
const webgpu = !!(navigator as any).gpu && !!(await (navigator as any).gpu.requestAdapter());
const asr = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base_timestamped',
  webgpu ? { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } }
         : { device: 'wasm', dtype: 'q8' });
const { chunks } = await asr(pcm16kMono /* Float32Array, 16 kHz mono */, {
  language: 'en', return_timestamps: 'word', chunk_length_s: 30, // stride defaults to chunk/6
});
// chunks: [{ text: ' And', timestamp: [0, 0.78] }, ...]: seconds relative to the input
```

| Model (`_timestamped`) | q8 download | Other |
|---|---|---|
| tiny.en | **41 MB** | fp16 76 MB |
| base | **77 MB** | fp32 encoder + q4 decoder 206 MB |
| small | **249 MB** | fp16 485 MB |
| large-v3-turbo | 1,085 MB | **q4f16 564 MB** |

**Practicalities.**
- Input must be **16 kHz mono Float32**. Render the clip's audio to 16 kHz, or resample with a low-pass filter; naive decimation from 48k aliases (§4.5).
- Run it in its **own worker**, never the engine worker, because inference blocks it for seconds.
- Cache the models with the Cache API, plus `env.useWasmCache` for offline use.
- Ask before downloading anything over about 100 MB.
- Speed: HF claims WebGPU is "up to 100× faster than WASM". Per-model real-time factors are unverified, so benchmark tiny, base and small on the target machines.
- whisper.cpp WASM (MIT) runs tiny/base at about 2–3× real time on CPU, and its demo caps audio at 120 s.
- **WebGPU by webview:**
  - WebView2: yes (Chromium 113+).
  - WKWebView: macOS 26.
  - WebKitGTK: **no**, so it falls back to WASM.
- **On desktop, prefer native whisper.cpp** (Metal, Vulkan or CUDA) in Rust. It is faster and keeps the webview free. Keep transformers.js for the web build.

**Alternatives.**
- **Moonshine** (`onnx-community/moonshine-{tiny,base}-ONNX`, about 28 and 63 MB at q8): English models are MIT. The legacy non-English models are **non-commercial**.
- Distil-Whisper (MIT): no maintained ONNX export was found (unverified).

### 7.2 Background removal and person segmentation

| Model | Size | Input | Speed | Weights license | Use |
|---|---|---|---|---|---|
| **MediaPipe selfie_segmenter** (`@mediapipe/tasks-vision`) | 250 KB | 256×256 | ~33 ms CPU (Pixel 6) | Apache-2.0 code (model card unverified) | **Live preview matte** |
| MediaPipe selfie_multiclass | 16 MB | 256×256 | 218 ms CPU / 71 ms GPU | as above | Hair, skin and clothes classes |
| **MODNet** (`Xenova/modnet`) | 6.6 MB q8 | short edge 512 | near real-time on WebGPU (unverified) | **Apache-2.0** | Preview, good hair |
| **BiRefNet_lite** (`onnx-community/BiRefNet_lite-ONNX`) | 115 MB fp16 | 1024² | offline | **MIT** | **Final-quality matte pass** |
| BEN2 (`onnx-community/BEN2-ONNX`) | 219 MB fp16 | 1024² | offline | MIT | Final quality |
| RMBG-1.4 / RMBG-2.0 (Bria) | 44–176 MB | 1024² | offline | **Non-commercial / CC BY-NC 4.0** | **Do not ship** |
| `@imgly/background-removal` (IS-Net) | 40–80 MB | — | — | **AGPL-3.0** (or a paid license) | Do not ship |

Pattern:
- Preview with MediaPipe or MODNet at low resolution, upsampling the mask in the shader with a guided or bilateral filter.
- Bake the final matte offline with BiRefNet_lite into a cached alpha track (store it as a grayscale video or a PNG sequence in OPFS or on disk).
- Temporal flicker is the main quality complaint; smooth masks over time with an EMA.

### 7.3 Audio denoise

- **RNNoise** (xiph, BSD-3): 48 kHz audio, **480-sample (10 ms) frames**.
  - AudioWorklet delivers 128-frame quanta, so a ring buffer must accumulate 480-sample frames.
  - For an editor, run it offline in a worker over decoded PCM and cache the result as a rendered clip.
  - Wrappers: `@shiguredo/rnnoise-wasm` (Apache-2.0), `@jitsi/rnnoise-wasm` (Apache-2.0; its `rnnoise-sync.js` inlines the WASM for worklets), and **`@sapphi-red/web-noise-suppressor`** (MIT; ready-made worklet nodes for RNNoise, Speex, GTCRN and a noise gate).
- **DeepFilterNet** (MIT/Apache-2.0) has much better quality. `libDF` has a `wasm` feature, but the repo has been dormant since 2024-10. It is a good **Rust-native** candidate on desktop.
- Krisp: proprietary, paid.

### 7.4 Licensing summary

| Item | Code | Weights | Commercial |
|---|---|---|---|
| transformers.js / onnxruntime-web | Apache-2.0 / MIT | — | ✅ |
| Whisper (all sizes), whisper.cpp | MIT | MIT | ✅ |
| Moonshine EN / non-EN legacy | MIT | MIT / **NC** | ✅ / ❌ |
| MediaPipe Tasks | Apache-2.0 | Apache (verify model cards) | ✅ |
| MODNet | Apache-2.0 | Apache-2.0 | ✅ |
| BiRefNet, BEN2 | MIT | MIT | ✅ |
| RMBG-1.4, RMBG-2.0 | — | Bria NC / CC BY-NC 4.0 | ❌ |
| @imgly/background-removal | AGPL-3.0 | AGPL-3.0 | ❌ unless AGPL or paid |
| RNNoise + wrappers | BSD-3 / Apache-2.0 / MIT | BSD | ✅ |
| DeepFilterNet | MIT / Apache-2.0 | same (verify) | ✅ |

## 8. Recommended architecture

### 8.1 Threads and ownership

```
Main thread (React)
  ├─ store, timeline UI, waveforms/thumbnails drawn from caches
  ├─ AudioContext + AudioWorkletNode (playback sink), latency/clock sampler → engine
  └─ <canvas> → transferControlToOffscreen() → engine worker
Engine worker (one)
  ├─ mediabunny Inputs (one per source file), per-clip cursors (§1.5)
  ├─ compositor: WebGL2 on OffscreenCanvas (WebGPU optional later)
  ├─ audio mixer (pure TS) → SAB ring → AudioWorklet   (MessagePort fallback)
  └─ export: same render(n) + same mixer → mediabunny Output → StreamTarget
Analysis worker(s)
  └─ probe, proxies (Conversion), thumbnails (CanvasSink + samplesAtTimestamps), peaks (AudioSampleSink)
AI worker
  └─ transformers.js (web) — desktop prefers Rust whisper.cpp
Rust (desktop only, src-tauri)
  └─ file bytes (range-capable protocol / raw IPC), FFmpeg proxies & exotic formats, optional FFmpeg masters
```

### 8.2 Pipelines

**Import.**
1. Probe with mediabunny: format, codec, `canDecode`, frame-rate metrics, rotation, color, HDR, duration.
2. Classify the file:
   - **native**;
   - **remux** (the container is unknown but the codecs are fine);
   - **extension** (ProRes, AC-3, DTS);
   - **transcode** (FFmpeg: Rust on desktop, ffmpeg.wasm on web).
3. In the background, make:
   - a **short-GOP 720p proxy** for any long-GOP, ≥4K, VFR-heavy, interlaced or exotic source;
   - thumbnails;
   - peaks.
4. Cache everything by content hash plus size plus mtime.

**Preview.**
- Integer timeline frame *n* = `frameAt(audibleMediaTime())`.
- `render(n)`: each visible clip's cursor supplies a frame for source time `in + (n - start)/fps`. Upload, close, composite, present.
- While playing, render at ½ resolution; on pause, at full resolution. Late layers keep their last frame.
- Scrubbing goes through the same cursors, with key frame first and then the exact frame, latest-wins.

**Audio.** One pure-TS mixer (48 kHz float32) with sample-accurate fades. It runs as the preview producer (ring buffer) and as the export producer (windowed pull), so preview equals export.

**Export.**
- Same `render(n)` and mixer, in the engine worker, decoded with `samples()`, which is deterministic and never drops frames.
- `VideoSampleSource` (frames built from the OffscreenCanvas) or `CanvasSource`, with `AudioSampleSource`.
- `StreamTarget`, written at the given positions:
  - web: `showSaveFilePicker()`, or OPFS then download;
  - desktop: positional writes to Rust.
- MP4 with `fastStart: false`, or `'reserve'` when the packet count is known.
- Codec chosen by `getFirstEncodableVideoCodec`. Audio encoder polyfill if `!canEncodeAudio('aac')`.
- Correct the AAC priming.
- Masters (ProRes, DNxHR, CRF x264/x265, alpha) go to Rust FFmpeg on desktop only (see [[Tauri desktop media]]).
  - Prefer handing Rust a **high-quality intermediate encoded in the webview** over piping raw frames: 1080p RGBA is about 8.3 MB per frame, roughly 250 MB/s at 30 fps.

**Platform seam (`src/platform/`).**

| Need | Web | Desktop |
|---|---|---|
| Open a source | `File` → `BlobSource` | Range-capable custom protocol → `UrlSource`, or `CustomSource` over raw-body IPC |
| Write an export | `StreamTarget` → `FileSystemWritableFileStream` / OPFS | `StreamTarget` → Rust positional writes |
| Transcode | ffmpeg.wasm | Rust FFmpeg |
| Captions | transformers.js | whisper.cpp |

Nothing else branches on platform ([[Conventions]]).

### 8.3 The 25 pitfalls that cost the most

1. **Leaked frames freeze decoders silently.**
   - A hardware decoder has only `refs + 1` output buffers. Windows Intel iGPUs stall at 8 open frames ([Remotion #11020](https://github.com/remotion-dev/remotion/issues/11020)), and Chrome's D3D11 decoder at roughly 5–17.
   - **Fix:** upload, then `close()` in the same tick. Give each frame exactly one owner ([[Conventions]] rule 9). Use `using` / `[Symbol.dispose]`. In dev builds, track open frames with a `FinalizationRegistry` and a counter.
2. **Caching raw `VideoFrame`s for back-stepping or a scrub cache.** Same stall, plus VRAM.
   - **Fix:** cache **downscaled** `ImageBitmap`s or small canvases. Frames from a decoder are leases, not values.
3. **Calling `getSample(t)` per pointer-move.** Every call builds a new decoder and decodes up to a GOP. Seeks queue up and keep firing 30 s later ([OpenCut #584](https://github.com/OpenCut-app/OpenCut/issues/584)).
   - **Fix:** a cursor that rolls forward within a GOP (§1.5), latest-wins coalescing, generation IDs, and key frame first.
4. **Using `samplesAtTimestamps` for interactive or sequential work.** It emits only at GOP boundaries or iterator end, and drifts or freezes in export ([#368](https://github.com/Vanilagy/mediabunny/issues/368)).
   - **Fix:** use it for thumbnail batches only. Use `samples()` for playback and export.
5. **Ignoring backpressure.**
   - **Fix:** `await` every `source.add()`. Pull iterators at the rate you consume. Bound every queue. Never fire-and-forget `decode()` or `encode()`.
6. **Export held in memory.** `BufferTarget` or `fastStart: 'in-memory'` runs out of memory around 30 minutes ([FreeCut #316](https://github.com/walterlow/freecut/issues/316), [OpenCut #812](https://github.com/OpenCut-app/OpenCut/issues/812)).
   - **Fix:** `StreamTarget` with **positional** writes. Never concatenate the chunks.
   - On Safari OPFS, pass a fresh copy (`chunk.data.slice()`), because `write()` ignores `byteOffset` ([#459](https://github.com/Vanilagy/mediabunny/issues/459)).
7. **Whole-file audio APIs.** `decodeAudioData` on a full file for waveforms crashes on import ([OpenCut #656](https://github.com/OpenCut-app/OpenCut/issues/656)). A whole-timeline `OfflineAudioContext` allocates channels × length × 4 B, about 2.8 GB for 2 hours of stereo.
   - **Fix:** stream peaks from `AudioSampleSink`. Mix in 10–30 s windows with effect pre-roll, or use a streaming TS mixer.
8. **The wrong master clock.** `performance.now()` or frame counting drifts against the audio crystal, and relative sleeps accumulate error ([OpenShot #796](https://github.com/OpenShot/libopenshot/pull/796)).
   - **Fix:** the audio clock is master. Video follows it and drops late frames. Never time-stretch audio to fit the video.
9. **Ignoring output latency.** Bluetooth adds 100–300 ms, so lips visibly lead.
   - **Fix:** use `getOutputTimestamp().contextTime` extrapolated with `performance.now()`. The fallback is `currentTime - outputLatency - baseLatency` (`outputLatency` exists in Safari only from 18.4). Re-sample it whenever the output device changes.
10. **AAC priming shifts exported audio.** WebCodecs hides the encoder delay (about 1024 samples; AVFoundation also trims 2112), and no edit list is written ([#444](https://github.com/Vanilagy/mediabunny/issues/444), [#549](https://github.com/Vanilagy/mediabunny/issues/549), [Remotion #11704](https://github.com/remotion-dev/remotion/issues/11704)).
    - **Fix:** shift the packets to negative timestamps so an `elst` is written (mediabunny [#485](https://github.com/Vanilagy/mediabunny/pull/485)), or trim. Verify with a beep-and-flash test in Chrome, Safari, QuickTime and VLC.
11. **Long-GOP sources make every seek decode up to 300 frames.**
    - **Fix:** background **short-GOP proxies** (`keyFrameInterval` 0.5–1 s, 720p), as Premiere and Resolve do. Export from the originals.
12. **Hardcoding the codec matrix.** Examples:
    - HEVC in WebView2 needs the Store's HEVC Video Extensions.
    - Linux Chrome and Windows N have no AAC encoder.
    - Safari has no AV1 or 10-bit.
    - WebKitGTK depends on GStreamer plugins.
    - Open-source Chromium has no H.264.
    - **Fix:** probe at runtime (`canDecode`, `canEncodeVideo` with the real width, height and frame rate), register polyfills on demand, and have a fallback route for every class of file.
13. **Trusting `isConfigSupported`.** Configs that report "supported" still fail or hang:
    - Safari H.264 Main/High never emits in `quality` mode ([#541](https://github.com/Vanilagy/mediabunny/issues/541), [Remotion #11964](https://github.com/remotion-dev/remotion/issues/11964));
    - the AMD HEVC encoder emits a delta frame first ([#365](https://github.com/Vanilagy/mediabunny/issues/365));
    - Linux Chromium produces green output ([#280](https://github.com/Vanilagy/mediabunny/issues/280)).
    - **Fix:** a watchdog that fails if there is no encoder output within N seconds. Then a fallback ladder (`latencyMode: 'realtime'` on Safari, then Baseline, then another codec, then `prefer-software`, then FFmpeg), and a 2-second test encode before long exports.
14. **Codec reclamation.** An idle (10 s per the spec) or background codec can be closed with `QuotaExceededError` ([spec §11](https://www.w3.org/TR/webcodecs/#resource-reclamation), [#531](https://github.com/Vanilagy/mediabunny/issues/531)).
    - **Fix:** treat a dead cursor as "re-seek at the playhead". Run export decode and encode **in the same worker**: an active encoder protects the decoders in its global scope even while the window is minimized.
15. **Rotation and pixel aspect.** Phone video is stored landscape with a 90° matrix, and anamorphic DV/HDV needs its pixel aspect applied. `VideoFrame.rotation` exists only in Chrome 138+ and disables the fast upload path.
    - **Fix:** use `getRotation()`, `getFlip()` and `getPixelAspectRatio()`, and apply them **once** in the compositor's quad transform. Use `getDisplayWidth()` and `getDisplayHeight()` for layout.
16. **Color tags and range.**
    - Untagged SD gets BT.709, so hues shift.
    - Full-range phone footage gets limited range, so blacks crush or lift.
    - VideoToolbox ignores overrides ([Remotion #8952](https://github.com/remotion-dev/remotion/issues/8952)).
    - WebKit emits non-spec enums such as `'unspecified'` that make `VideoSample` throw ([#555](https://github.com/Vanilagy/mediabunny/issues/555)).
    - **Fix:** pass the container's `colr` info, sanitize unknown enums to `null`, and keep a color-bars test suite per platform.
17. **HDR and 10-bit.** Chrome hardware frames come back with `format === null`, so `copyTo` and `allocationSize` throw ([#256](https://github.com/Vanilagy/mediabunny/issues/256)). WebGL tone-maps or clips, and Safari has no 10-bit at all.
    - **Fix:** pass `{ format: 'RGBA' }` for readback, warn "HDR converted to SDR", and keep HDR for a later WebGPU `rgba16float` path.
18. **VFR and non-zero start times.** Indexing frames by count, or assuming the first PTS is 0, drifts sync and shows the wrong frames.
    - **Fix:** always look up by timestamp, normalize with `getFirstTimestamp()`, and never present negative timestamps. Timeline positions are integer frames ([[ADR-004 Timeline time is integer frames]]).
19. **Bad key frames and interlacing.** Open-GOP recovery points, mislabeled key frames and interlaced H.264 break Chromium decode ([#477](https://github.com/Vanilagy/mediabunny/issues/477), [#396](https://github.com/Vanilagy/mediabunny/issues/396), [crbug 456919096](https://issues.chromium.org/issues/456919096)).
    - **Fix:** use `verifyKeyPackets: true`, keep mediabunny current (it carries the workarounds), retry once with `prefer-software`, and route interlaced material to an FFmpeg-deinterlaced proxy.
20. **Falling off the fast GPU upload path.** `texSubImage2D`, transformed frames, a non-sRGB `unpackColorSpace`, or `UNPACK_*` settings put WebGL uploads on Chrome's slow path.
    - **Fix:** full `texImage2D` of an RGBA8 texture, with transforms done in the shader.
21. **Premultiplied alpha confusion.** Mixing conventions gives dark fringes on titles and PNGs and halos in crossfades.
    - **Fix:** premultiply everywhere, blend with `ONE, ONE_MINUS_SRC_ALPHA`, and un-premultiply only inside the effects that need straight color.
22. **GL context sprawl and loss.**
    - Safari keeps about 16 live WebGL contexts ([Remotion #11647](https://github.com/remotion-dev/remotion/issues/11647)).
    - Driver resets and sleep fire `webglcontextlost` on WebView2/ANGLE.
    - WebKitGTK on NVIDIA needs environment flags ([tauri#9394](https://github.com/tauri-apps/tauri/issues/9394)).
    - **Fix:** one GL context, an FBO pool, and a scene graph that rebuilds GL objects on restore. Ship a "safe graphics" launch mode for Linux.
23. **Wall-clock export and throttling.** `captureStream()`, MediaRecorder and rAF-driven export drop or duplicate frames. Background tabs and minimized windows throttle rAF and timers (Clipchamp, Remotion).
    - **Fix:** a deterministic `for (n…) { render(n); await add() }` loop in a worker, not tied to rAF. Show a "keep the app open" notice on the web.
    - **Measured** (Edge 155, main-thread loop, 1800 frames at 1080p): visible 5.7 s, background tab 5.8 s, minimized 7.5 s. Hidden pages get a lower priority, not a stall, because nothing waits on rAF or timers ([[ADR-014 Export is a deterministic frame loop]]).
    - **Testing it:** pages that Playwright launches *or* attaches to over CDP report `visibilityState: "visible"` even in a background tab or a minimized window, and its default launch flags disable background throttling. Measure hidden behavior with a hand-launched browser driven over raw CDP (a WebSocket and `Runtime.evaluate`).
24. **Fonts and text in workers.** If fonts aren't loaded in the worker, the first frames export in a fallback font. Rasterizing small and scaling up blurs.
    - **Fix:** `self.fonts.add(face)` and `await face.load()` before rendering. Rasterize at output resolution, cache the textures, and bundle the fonts.
25. **Tauri plumbing.**
    - `dragDropEnabled: true` swallows HTML5 drops, so no `File` objects arrive.
    - The asset protocol caps range requests ([mediabunny #231](https://github.com/Vanilagy/mediabunny/issues/231)), makes thousands of tiny requests ([tauri#10426](https://github.com/tauri-apps/tauri/issues/10426)) and fails for `<video>` on Linux ([tauri#3725](https://github.com/tauri-apps/tauri/issues/3725)).
    - JSON IPC for binary data blew 140 MB into 11.5 GB of RAM ([tauri#9190](https://github.com/tauri-apps/tauri/issues/9190)).
    - COOP/COEP from `app.security.headers` apply only to the built app; dev needs the Vite headers.
    - **Fix:** set `dragDropEnabled: false` where HTML5 drop is wanted, serve media from a custom range-capable protocol or raw-body IPC (`tauri::ipc::Response`), and never per-frame IPC. Details in [[Tauri desktop media]].

**Also bites, briefly:**
- mediabunny loaded twice in the bundle (it logs a warning; dedupe).
- Deprecated APIs from old tutorials (`QUALITY_HIGH`, `bitrate`, `StreamSource`, sync `track.codec`).
- mediabunny's linear-interpolation resampler aliases on downsampling (§4.5).
- Clicks at clip cuts (add 2–5 ms ramps).
- H.264 needs even dimensions and level 5.1 (`avc1.640033`) for 4K.
- ffmpeg.wasm defaults to the unpkg CDN, copies inputs into MEMFS (use WORKERFS), has a 2 GB input ceiling and hangs in core-mt, and `@ffmpeg/core` is **GPL**.
- iOS `AudioContext` `interrupted` state ([#152](https://github.com/Vanilagy/mediabunny/issues/152)).
- Firefox VideoFrame glitches on opaque canvases, and generally choppier WebCodecs ([#258](https://github.com/Vanilagy/mediabunny/issues/258)).

## Sources

Primary sources only. Issue links appear inline above.

**mediabunny**
- Repository: https://github.com/Vanilagy/mediabunny
- Documentation: https://mediabunny.dev/guide/introduction. The relevant pages are media-sinks, media-sources, writing-media-files and supported-formats-and-codecs.
- Media player example: https://github.com/Vanilagy/mediabunny/blob/main/examples/media-player/media-player.ts
- Upcoming cursor API (v2 branch): https://github.com/Vanilagy/mediabunny/tree/v2 (`src/cursors.ts`)

**WebCodecs**
- Spec, including the resource reclamation section: https://www.w3.org/TR/webcodecs/
- Spec source: https://github.com/w3c/webcodecs
- MDN browser compatibility data (the `api/*.json` files): https://github.com/mdn/browser-compat-data
- Chromium source: `third_party/blink/renderer/modules/webcodecs/`, `media/gpu/windows/d3d_video_decoder.cc`, `codec_pressure_gauge.cc` and `reclaimable_codec.cc`, under https://chromium.googlesource.com/chromium/src/
- WebKit: `UnifiedWebPreferences.yaml`, `VideoEncoderPrivateGStreamer.cpp` and `Audio{De,En}coderCocoa.cpp` at https://github.com/WebKit/WebKit
- Safari 26 announcements: https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/
- WebKitGTK 2.44 release notes: https://webkitgtk.org/2024/03/27/webkigit-2.44.html
- WebKitGTK 2.54 highlights: https://webkitgtk.org/2026/09/16/webkitgtk-2.54-highlights.html
- Edge HEVC playback: https://learn.microsoft.com/en-us/troubleshoot/microsoft-edge/development/video-playback-issues
- Chromium HEVC guide: https://github.com/StaZhu/enable-chromium-hevc-hardware-decoding

**Graphics and audio specs**
- WebGL IDL: https://registry.khronos.org/webgl/specs/latest/1.0/
- WebGPU: https://www.w3.org/TR/webgpu/
- Web Audio: https://webaudio.github.io/web-audio-api/
- MDN `outputLatency`: https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency

**Tauri**
- HTTP headers configuration: https://v2.tauri.app/security/http-headers/
- Calling Rust from the frontend (IPC, binary responses): https://v2.tauri.app/develop/calling-rust/
- Linux rendering issues: https://github.com/tauri-apps/tauri/issues/9394

**ffmpeg.wasm**
- Repository: https://github.com/ffmpegwasm/ffmpeg.wasm
- Documentation (performance, FAQ, usage): https://ffmpegwasm.netlify.app/docs/
- libav.js: https://github.com/Yahweasel/libav.js
- WebCodecs polyfill built on libav.js: https://github.com/ennuicastr/libavjs-webcodecs-polyfill

**On-device AI**
- transformers.js: https://github.com/huggingface/transformers.js (releases 4.0.0 and 4.3.0)
- Word-timestamps example: https://github.com/huggingface/transformers.js-examples/tree/main/whisper-word-timestamps
- MediaPipe image segmenter: https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter
- RNNoise: https://github.com/xiph/rnnoise
- DeepFilterNet: https://github.com/Rikorose/DeepFilterNet

**Editors surveyed:** the repositories and posts linked in §5. Star counts are from the GitHub API on 2026-10-13.
