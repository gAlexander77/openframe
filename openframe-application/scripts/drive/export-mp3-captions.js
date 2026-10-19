// MP3 export and captions with export (ADR-080). Renders through
// videoEditor.render (the export engine, to memory), writes each file to
// scratch/ and checks it with ffprobe and ffmpeg:
//   - MP3: an audio-only file, MPEG layer 3 at 48 kHz stereo, as long as
//     the timeline, its sound where the voice is;
//   - captions "srt": the SRT for an In-Out range, timed from its start,
//     and the picture without the caption; "burn" draws it;
//   - the Export dialog offers MP3 and the Captions row (with the right
//     choices for sound only), and export_video takes mp3 and captions.
// Needs ffmpeg and ffprobe on PATH; Node runs this file (run.mjs).
async (page) => {
  const { execFileSync } = await import("node:child_process");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const outDir = path.join(process.cwd(), "scratch");
  fs.mkdirSync(outDir, { recursive: true });
  const sh = (cmd, args) => execFileSync(cmd, args, { maxBuffer: 1 << 30 });

  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(async () => {
    const ve = window.videoEditor;
    const [wav] = await ve.import([{ name: "voice-8s.wav", src: location.origin + "/fixtures/media/voice-8s.wav" }]);
    ve.exec("set_project", { width: 1280, height: 720 });
    ve.exec("add_color_clip", { color: "#203080", start: 0, duration: 4 });
    ve.exec("add_media_clip", { asset_id: wav.id, start: 0, duration: 4 });
    ve.exec("add_captions", { captions: [{ start: 1, end: 2, text: "FIRST LINE" }, { start: 2.5, end: 3.5, text: "SECOND LINE" }] });
  });

  async function render(name, options) {
    const r = await page.evaluate(async (o) => {
      const r = await window.videoEditor.render(o);
      const buf = new Uint8Array(await (await fetch(r.url)).arrayBuffer());
      URL.revokeObjectURL(r.url);
      let s = "";
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const { plan, url, ...rest } = r;
      return { ...rest, b64: btoa(s) };
    }, options);
    const file = path.join(outDir, `export-${name}.${r.fileName.split(".").pop()}`);
    fs.writeFileSync(file, Buffer.from(r.b64, "base64"));
    delete r.b64;
    return { file, ...r };
  }
  const probe = (file) => JSON.parse(sh("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,sample_rate,channels:format=duration,format_name", "-of", "json", file]).toString());
  /** How many bright (text) pixels the lower third holds at `t` seconds. */
  const bright = (file, t) => {
    const W = 320, H = 180;
    const raw = sh("ffmpeg", ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", `scale=${W}:${H},format=gray`, "-f", "rawvideo", "-"]);
    let n = 0;
    for (let y = Math.floor(H * 0.6); y < H; y++) for (let x = 0; x < W; x++) if (raw[y * W + x] > 200) n++;
    return n;
  };
  const details = {};

  // MP3, sound only.
  const mp3 = await render("mp3", { format: "mp3" });
  const pm = probe(mp3.file);
  const a = pm.streams[0];
  details.mp3 = {
    ok: pm.format.format_name === "mp3" && a.codec_name === "mp3" && Number(a.sample_rate) === 48000 && a.channels === 2 && Math.abs(Number(pm.format.duration) - 4) < 0.1 && mp3.type === "audio/mpeg" && pm.streams.length === 1,
    format: pm.format, stream: a, bytes: mp3.size,
  };
  const pcm = sh("ffmpeg", ["-v", "error", "-i", mp3.file, "-ac", "1", "-ar", "8000", "-f", "f32le", "-"]);
  const s32 = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength >> 2);
  let peak = 0;
  for (const v of s32) peak = Math.max(peak, Math.abs(v));
  details.mp3Sound = { ok: peak > 0.05, peak: +peak.toFixed(3) };

  // Captions: an SRT for the In-Out range, the picture left clean.
  const srt = await render("captions-srt", { captions: "srt", start: 0.5, end: 3 });
  const want = "1\n00:00:00,500 --> 00:00:01,500\nFIRST LINE\n\n2\n00:00:02,000 --> 00:00:02,500\nSECOND LINE\n";
  details.srtText = { ok: srt.srt === want, srt: srt.srt };
  const burn = await render("captions-burn", { captions: "burn", start: 0.5, end: 3 });
  details.burnNoSrt = { ok: burn.srt === undefined };
  const clean = bright(srt.file, 1), drawn = bright(burn.file, 1);
  details.picture = { ok: clean === 0 && drawn > 50, srtBright: clean, burnBright: drawn };
  fs.writeFileSync(path.join(outDir, "export-captions.srt"), srt.srt ?? "");
  sh("ffmpeg", ["-v", "error", "-y", "-ss", "1", "-i", burn.file, "-frames:v", "1", path.join(outDir, "export-captions-burn.png")]);
  sh("ffmpeg", ["-v", "error", "-y", "-ss", "1", "-i", srt.file, "-frames:v", "1", path.join(outDir, "export-captions-srt.png")]);
  const none = await render("captions-none", { captions: "none", start: 0.5, end: 3 });
  details.none = { ok: bright(none.file, 1) === 0 && none.srt === undefined };

  // The dialog: MP3 among the audio formats, and the Captions row.
  await page.evaluate(() => window.videoEditor.action("export"));
  const dialog = page.locator(".export-dialog, dialog").filter({ has: page.locator("#export-captions") }).first();
  await page.locator("#export-captions").waitFor();
  const opts = await page.locator("#export-captions option").allTextContents();
  details.captionsRow = { ok: opts.join("|") === "Burn into the picture|SRT file beside it|Burn in and SRT file|Leave out", opts };
  await page.locator("#export-captions").selectOption("srt");
  details.hint = { ok: (await page.getByText("The .srt file downloads when the export is done").count()) === 1 };
  await page.screenshot({ path: path.join(outDir, "export-captions-dialog.png") });
  // Sound only: MP3 offered, captions as a file or nothing.
  await page.locator("#export-sec-video input[type=checkbox]").uncheck();
  await page.locator("#export-audio").waitFor();
  await page.locator("#export-audio").selectOption("mp3");
  const audioFormats = await page.locator("#export-audio option").allTextContents();
  const audioOpts = await page.locator("#export-captions option").allTextContents();
  details.audioOnly = { ok: audioFormats.includes("MP3") && audioOpts.join("|") === "SRT file beside it|Leave out", audioFormats, audioOpts };
  await page.screenshot({ path: path.join(outDir, "export-mp3-dialog.png") });
  await page.keyboard.press("Escape");

  // Agents: export_video takes mp3 and captions (the web build refuses
  // agent exports, so the answer is that refusal, past the schema).
  const call = (args) => page.evaluate((args) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "export_video", arguments: args } }), args);
  const bad = await call({ format: "mp3", captions: "subtitles" });
  const good = await call({ format: "mp3", captions: "srt" });
  details.mcp = { ok: /captions/.test(bad.result?.content?.[0]?.text ?? "") && /desktop app only/.test(good.result?.content?.[0]?.text ?? ""), bad: bad.result?.content?.[0]?.text, good: good.result?.content?.[0]?.text };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
