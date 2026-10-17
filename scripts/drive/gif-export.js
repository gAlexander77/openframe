// GIF export drive: renders the framecode fixture as a 15 fps, 480p GIF
// through window.videoEditor.render (the dialog's engine path) and checks
// it with ffprobe and ffmpeg: frame count, total duration (centisecond
// delays must not drift) and that every GIF frame shows the source frame
// the timeline says (the fixture draws its frame number as ten blocks).
// Also opens the dialog with GIF picked: no codec, bit rate or sound.
async (page) => {
  const { execFileSync } = await import("node:child_process");
  const fs = await import("node:fs");
  const path = await import("node:path");
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(async () => {
    const api = window.videoEditor;
    const [fc] = await api.import([{ name: "framecode-30.mp4", src: location.origin + "/fixtures/media/framecode-30.mp4" }]);
    api.exec("add_media_clip", { asset_id: fc.id, start: 0, duration: 2 });
  });
  const details = {};
  const r = await page.evaluate(async () => {
    const r = await window.videoEditor.render({ format: "gif", codec: "gif", resolution: "480p", fps: { num: 15, den: 1 } });
    const buf = new Uint8Array(await (await fetch(r.url)).arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { b64: btoa(s), frames: r.frames, type: r.type, fileName: r.fileName };
  });
  const file = path.join(process.cwd(), "scratch", "export-gif.gif");
  fs.writeFileSync(file, Buffer.from(r.b64, "base64"));
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=codec_name,nb_read_frames,width,height:format=duration", "-of", "json", file]).toString());
  const st = probe.streams[0];
  details.probe = { ok: st.codec_name === "gif" && Number(st.nb_read_frames) === 30 && st.height === 480 && Math.abs(Number(probe.format.duration) - 2) < 0.02, st, duration: probe.format.duration, type: r.type };
  // Frame n of a 15 fps GIF from a 30 fps timeline shows source frame 2n.
  const W = 160, H = 90;
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-vf", `scale=${W}:${H}:flags=area,format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 28 });
  const bad = [];
  for (let n = 0, o = 0; o + W * H <= raw.length; n++, o += W * H) {
    let code = 0;
    for (let i = 0; i < 10; i++) if (raw[o + (H >> 1) * W + Math.floor((i + 0.5) * (W / 10))] > 128) code |= 1 << i;
    if (code !== 2 * n) bad.push({ n, want: 2 * n, got: code });
  }
  details.frames = { ok: bad.length === 0, bad: bad.slice(0, 5) };

  await page.keyboard.press("Control+E");
  await page.getByRole("dialog", { name: "Export" }).waitFor();
  await page.locator("#export-format").selectOption("gif");
  const shown = {
    codec: await page.locator("#export-codec").count(),
    quality: await page.locator("#export-quality").count(),
    fps: await page.locator("#export-fps").inputValue(),
    res: await page.locator("#export-res").inputValue(),
    silent: await page.getByText("GIFs have no sound.").count(),
  };
  await page.screenshot({ path: "scratch/export-gif-dialog.png" });
  details.dialog = { ok: shown.codec === 0 && shown.quality === 0 && shown.fps === "15" && shown.res === "480p" && shown.silent === 1, shown };
  await page.locator("#export-format").selectOption("mp4");
  await page.keyboard.press("Escape");
  return { ok: Object.values(details).every((d) => d.ok), details };
};
