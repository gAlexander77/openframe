// Text to speech drive (ADR-050): a title's Add voice makes speech with the
// real Kokoro model (the first run downloads about 90 MB from Hugging
// Face, so it needs the network once) and places it on an audio track at
// the title's start. Checks the clip, its length, and that it holds sound
// shaped like speech (loud stretches with quieter gaps), then Undo.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const id = await page.evaluate(() => {
    const api = window.videoEditor;
    api.exec("add_color_clip", { color: "#203040", start: 0, duration: 6 });
    api.exec("add_text", { text: "Welcome back.\nToday we cut a video.", start: 1, duration: 4 });
    const c = api.describe().tracks.flatMap((t) => t.clips).find((x) => x.type === "text");
    api.select([c.id]);
    return c.id;
  });
  const details = {};
  const section = page.locator(".insp-section", { has: page.getByText("Text to speech", { exact: true }) });
  await section.getByRole("button", { name: "Text to speech" }).click().catch(() => section.locator(".insp-section-toggle").click());
  const started = Date.now();
  await section.getByRole("button", { name: "Add voice" }).click();
  await page.waitForFunction(() => window.videoEditor.project().tracks.some((t) => t.kind === "audio" && t.clips.length), null, { timeout: 600000 });
  const seconds = (Date.now() - started) / 1000;
  const r = await page.evaluate(async () => {
    const api = window.videoEditor;
    const clip = api.project().tracks.filter((t) => t.kind === "audio").flatMap((t) => t.clips)[0];
    const asset = api.project().assets.find((a) => a.id === clip.assetId);
    // The mix as WAV: imported files live in private storage on the web.
    const r = await api.render({ video: false, audioFormat: "wav" });
    const buf = await (await fetch(r.url)).arrayBuffer();
    URL.revokeObjectURL(r.url);
    let loud = 0, quiet = 0;
    if (buf) {
      const v = new DataView(buf);
      const rate = v.getUint32(24, true), ch = v.getUint16(22, true), win = Math.round(rate * 0.05);
      // 50 ms windows while the voice plays (1 s on), first channel.
      for (let at = 44 + rate * ch * 2; at + win * ch * 2 < buf.byteLength && at < 44 + (1 + asset.duration) * rate * ch * 2; at += win * ch * 2) {
        let e = 0;
        for (let i = 0; i < win; i++) e += Math.abs(v.getInt16(at + i * ch * 2, true));
        e /= win * 32768;
        if (e > 0.03) loud++;
        else if (e < 0.01) quiet++;
      }
    }
    return { start: clip.start, frames: clip.duration, name: asset.name, duration: asset.duration, loud, quiet };
  });
  details.voice = { ok: r.start === 30 && r.duration > 1.5 && r.duration < 8 && /^Speech - Welcome back/.test(r.name), ...r, seconds };
  details.speechLike = { ok: r.loud > 10 && r.quiet > 2, loud: r.loud, quiet: r.quiet };
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.undo = { ok: !(await page.evaluate(() => window.videoEditor.project().tracks.some((t) => t.kind === "audio" && t.clips.length))) };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
