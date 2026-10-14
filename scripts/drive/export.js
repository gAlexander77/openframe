// Export drive: proves an export is frame-exact and in sync. Builds a
// timeline through window.videoEditor — framecode video at 1x, at 2x, a
// cross dissolve, a title over it, and a WAV with sharp tone onsets — then
// renders it with videoEditor.render() in several formats, writes each file
// and checks it with ffprobe and ffmpeg:
//   - exact frame count, frame rate, codecs, audio present;
//   - every exported frame encodes the source frame the timeline says (the
//     fixture draws its frame number as ten black/white blocks), except the
//     dissolve's frames, which are blends;
//   - each tone onset lands on its sample (AAC priming corrected), measured
//     against the PCM (WAV) export of the same timeline.
// Needs the dev server, fixtures (node scripts/make-fixtures.mjs), ffmpeg on
// PATH, and Node (it shells out), so run it from a Node Playwright script,
// with the repo root as the working directory:
//   const drive = eval(fs.readFileSync("scripts/drive/export.js", "utf8"));
//   const { ok, details } = await drive(page, { base: "http://localhost:1420" });
// Exports land in scratch/ (gitignored).
async (page, opts = {}) => {
  const base = opts.base ?? "http://localhost:1420";
  const { execFileSync } = await import("node:child_process");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const outDir = opts.outDir ?? path.join(process.cwd(), "scratch");
  fs.mkdirSync(outDir, { recursive: true });

  await page.goto(base);
  await page.waitForFunction(() => !!window.videoEditor);
  await page.evaluate(async (base) => {
    const ve = window.videoEditor;
    const [fc, wav] = await ve.import([
      { name: "framecode-30.mp4", src: `${base}/fixtures/media/framecode-30.mp4` },
      { name: "voice-8s.wav", src: `${base}/fixtures/media/voice-8s.wav` },
    ]);
    const clipAt = (s) => ve.describe().tracks.flatMap((t) => t.clips).find((c) => c.start === s && c.type === "video");
    ve.exec("add_media_clip", { asset_id: fc.id, start: 0, duration: 3 }); // frames 0-89: source 0-89
    ve.exec("add_media_clip", { asset_id: fc.id, start: 3, in: 2, duration: 4 });
    ve.exec("set_speed", { clip_id: clipAt(3).id, speed: 2 }); // frames 90-149: source 60, 62, 64...
    ve.exec("add_media_clip", { asset_id: fc.id, start: 5, in: 2, duration: 8 }); // frames 150-389: source 60-299
    ve.exec("set_transition", { clip_id: clipAt(3).id, type: "dissolve", duration: 10 / 30 }); // frames 145-154
    ve.exec("add_text", { text: "Export check", start: 1, duration: 3, y: 0.35 });
    ve.exec("add_media_clip", { asset_id: wav.id, start: 4 }); // tone onsets at 6, 8, 10 s (10 s = audio window edge)
  }, base);

  const expected = (f) => (f < 90 ? f : f < 150 ? 60 + 2 * (f - 90) : 60 + (f - 150));
  const inDissolve = (f) => f >= 145 && f < 155;
  const onsets = [6, 8, 10];
  const sh = (cmd, args) => execFileSync(cmd, args, { maxBuffer: 1 << 30 });

  async function render(name, options) {
    const r = await page.evaluate(async (o) => {
      const r = await window.videoEditor.render(o);
      const buf = new Uint8Array(await (await fetch(r.url)).arrayBuffer());
      URL.revokeObjectURL(r.url);
      let s = "";
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const { plan, url, ...rest } = r;
      return { ...rest, width: plan.video?.width, height: plan.video?.height, b64: btoa(s) };
    }, options);
    const file = path.join(outDir, `export-${name}.${r.fileName.split(".").pop()}`);
    fs.writeFileSync(file, Buffer.from(r.b64, "base64"));
    delete r.b64;
    return { file, ...r };
  }

  function probe(file) {
    const j = JSON.parse(sh("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=codec_type,codec_name,r_frame_rate,nb_read_frames,width,height,sample_rate,channels:format=duration,format_name", "-of", "json", file]).toString());
    return { format: j.format.format_name, duration: Number(j.format.duration), streams: j.streams };
  }

  /** Frame numbers read from the blocks of every decoded frame. */
  function framecodes(file) {
    const W = 160, H = 90;
    const raw = sh("ffmpeg", ["-v", "error", "-i", file, "-map", "0:v:0", "-vf", `scale=${W}:${H}:flags=area,format=gray`, "-f", "rawvideo", "-"]);
    const out = [];
    for (let o = 0; o + W * H <= raw.length; o += W * H) {
      let n = 0;
      for (let i = 0; i < 10; i++) if (raw[o + (H >> 1) * W + Math.floor((i + 0.5) * (W / 10))] > 128) n |= 1 << i;
      out.push(n);
    }
    return out;
  }

  /** Sample index where each tone onset first crosses 0.1. */
  function onsetSamples(file) {
    const raw = sh("ffmpeg", ["-v", "error", "-i", file, "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"]);
    const pcm = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength >> 2);
    return onsets.map((t) => {
      for (let i = Math.round((t - 0.05) * 48000); i < pcm.length; i++) if (Math.abs(pcm[i]) > 0.1) return i;
      return null;
    });
  }

  function checkFrames(codes, map, count) {
    const bad = [];
    let checked = 0;
    for (let n = 0; n < count; n++) {
      const f = map(n);
      if (inDissolve(f)) continue;
      checked++;
      if (codes[n] !== expected(f)) bad.push({ n, f, want: expected(f), got: codes[n] });
    }
    return { checked, bad: bad.slice(0, 10), badCount: bad.length };
  }

  const details = {};
  let ok = true;
  const fail = (why) => {
    ok = false;
    return why;
  };

  // The reference: PCM has no encoder delay, so its onsets are the truth.
  const ref = await render("reference", { video: false, audioFormat: "wav" });
  const refOnsets = onsetSamples(ref.file);
  details.wav = { probe: probe(ref.file), onsets: refOnsets, elapsed: ref.elapsed };
  // Each onset sits on its exact sample: a constant few samples in (the
  // sine reaching 0.1), the same for all three.
  const lead = refOnsets.map((s, i) => (s === null ? null : s - onsets[i] * 48000));
  if (lead.some((x) => x === null || x < 0 || x > 20 || x !== lead[0])) details.wav.error = fail(`WAV onsets off their samples by ${lead}`);

  const cases = opts.cases ?? [
    { name: "mp4-h264", o: { format: "mp4", codec: "avc", resolution: "720p" } },
    { name: "webm-vp9", o: { format: "webm", codec: "vp9", resolution: "720p" } },
    { name: "mov-hevc", o: { format: "mov", codec: "hevc", resolution: "720p" } },
    { name: "mkv-av1", o: { format: "mkv", codec: "av1", resolution: "480p" } },
    { name: "mp4-24fps", o: { format: "mp4", codec: "avc", resolution: "480p", fps: { num: 24, den: 1 } } },
    { name: "mp4-range", o: { format: "mp4", codec: "avc", resolution: "480p", start: 2, end: 5.5 } },
    { name: "m4a", o: { video: false, audioFormat: "m4a" } },
  ];
  for (const { name, o } of cases) {
    const d = (details[name] = {});
    try {
      const r = await render(name, o);
      const pr = probe(r.file);
      Object.assign(d, { codec: r.videoCodec, audio: r.audioCodec, audioDelay: r.audioDelay, note: r.note, size: r.size, elapsed: Math.round(r.elapsed * 10) / 10, probe: pr });
      const v = pr.streams.find((s) => s.codec_type === "video");
      const a = pr.streams.find((s) => s.codec_type === "audio");
      if (!a) d.error = fail("no audio stream");
      if (o.video !== false) {
        const fps = o.fps ?? { num: 30, den: 1 };
        const from = o.start ? Math.round(o.start * 30) : 0;
        const map = (n) => from + Math.floor((n * fps.den * 30) / fps.num + 1e-9);
        if (!v) d.error = fail("no video stream");
        else {
          if (Number(v.nb_read_frames) !== r.frames) d.error = fail(`frame count ${v.nb_read_frames}, planned ${r.frames}`);
          const [num, den] = v.r_frame_rate.split("/").map(Number);
          if (num * fps.den !== fps.num * den) d.error = fail(`frame rate ${v.r_frame_rate}`);
          d.frames = checkFrames(framecodes(r.file), map, r.frames);
          if (d.frames.badCount) d.error = fail(`${d.frames.badCount} frames show the wrong source frame`);
        }
      }
      if (a && !o.start) {
        const got = onsetSamples(r.file);
        d.onsetOffsets = got.map((s, i) => (s === null ? null : s - refOnsets[i]));
        if (d.onsetOffsets.some((x) => x === null || Math.abs(x) > 48)) d.error = fail(`audio off by ${d.onsetOffsets} samples`);
      }
    } catch (e) {
      d.error = fail(String(e.message ?? e).split("\n")[0]);
    }
  }
  return { ok, details };
};
