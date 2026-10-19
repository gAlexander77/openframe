// Sound design and moves for epic edits, through window.videoEditor.mcp:
// a reverse cymbal placed with end_at peaks exactly there and is silent
// after; one that would start before 0 loses its head instead; an impact
// starts on its beat; every new effect is offered. Then the whip pan, zoom
// punch and spin blur transitions each draw a blurred in-between frame at
// the cut, unlike either shot, and the shots on either side are untouched.
async (page) => {
  page.setDefaultTimeout(20000);
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const call = (name, args = {}) =>
    page.evaluate(async ([name, args]) => {
      const r = await window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: name === "tools/list" ? name : "tools/call", params: { name, arguments: args } });
      if (name === "tools/list") return r.result;
      const c = r.result?.content?.[0];
      if (r.error || r.result.isError) throw new Error(`${name}: ${r.error?.message ?? c.text}`);
      return c.type === "text" ? JSON.parse(c.text) : c;
    }, [name, args]);
  const details = {};
  const origin = new URL(page.url()).origin;
  const [photo, bars] = await call("import_media", { files: ["photo.jpg", "color-bars.png"].map((n) => ({ src: `${origin}/fixtures/media/${n}`, name: n })) });
  await call("add_media_clip", { asset_id: photo.id, start: 0, duration: 2 });
  await call("add_media_clip", { asset_id: bars.id, start: 2, duration: 2 });

  const sfx = (await call("tools/list")).tools.find((t) => t.name === "add_sound_effect");
  const names = sfx.inputSchema.properties.name.enum;
  details.offered = { ok: ["impact", "subDrop", "braam", "reverseCymbal", "glitch", "shutter", "swooshUp"].every((n) => names.includes(n)) && !!sfx.inputSchema.properties.end_at, names };

  const cym = await page.evaluate(() => window.videoEditor.ai.addSoundEffect("reverseCymbal", { endAt: 3 }));
  const hit = await page.evaluate(() => window.videoEditor.ai.addSoundEffect("impact", { at: 3 }));
  const rise = await call("add_sound_effect", { name: "rise", end_at: 1 });
  const clips = await page.evaluate(() => window.videoEditor.describe().tracks.flatMap((t) => t.clips));
  const c = clips.find((x) => x.id === cym.clipId), h = clips.find((x) => x.id === hit.clipId), r = clips.find((x) => x.type === "audio" && x.id !== c.id && x.id !== h.id);
  details.placed = { ok: Math.abs(c.end - 3) < 0.02 && Math.abs(c.start - 1) < 0.02 && h.start === 3 && r.start === 0 && Math.abs(r.end - 1) < 0.02 && Math.abs(r.in - 1) < 0.02 && !!rise, cymbal: [c.start, c.end], impact: h.start, riser: [r.start, r.end, r.in] };

  const level = await page.evaluate(async () => {
    const out = await window.videoEditor.render({ video: false, audioFormat: "wav", start: 0, end: 4 });
    const buf = await (await fetch(out.url)).arrayBuffer();
    URL.revokeObjectURL(out.url);
    const v = new DataView(buf), rate = v.getUint32(24, true);
    const rms = (a, b) => {
      let s = 0, n = 0;
      for (let i = Math.floor(a * rate); i < Math.floor(b * rate); i++, n++) s += (v.getInt16(44 + i * 4, true) / 32768) ** 2;
      return Math.sqrt(s / n);
    };
    return { cymbalEarly: rms(1.2, 1.5), cymbalPeak: rms(2.9, 2.99), impact: rms(3.0, 3.15), riserPeak: rms(0.85, 0.99), riserAfter: rms(1.02, 1.1) };
  });
  details.heard = { ok: level.cymbalPeak > level.cymbalEarly * 4 && level.impact > 0.05 && level.riserPeak > level.riserAfter * 3, ...level };

  // Transitions at the 2 s cut: the middle frame is neither shot and not black.
  const look = (t) =>
    page.evaluate(async (t) => {
      const ve = window.videoEditor;
      ve.seek(Math.round(t * 30));
      await new Promise((r) => setTimeout(r, 30));
      await ve.rendered();
      const { width: w, height: h, data } = ve.pixels(320);
      let s = 0;
      for (let i = 0; i < data.length; i += 4) s += (data[i] + data[i + 1] + data[i + 2]) / 3;
      return { mean: s / (data.length / 4), sig: Array.from({ length: 96 }, (_, k) => data[Math.floor((k * 7919) % (w * h)) * 4]) };
    }, t);
  const diff = (a, b) => a.sig.reduce((s, v, i) => s + Math.abs(v - b.sig[i]), 0) / a.sig.length;
  const main = (await call("describe_project")).tracks.find((t) => t.main).clips;
  await look(2.5);
  const [before, after] = [await look(1.5), await look(2.5)];
  for (const type of ["whipLeft", "whipRight", "zoomPunch", "spinBlur"]) {
    await call("set_transition", { clip_id: main[0].id, type, duration: 0.6 });
    const [early, mid, late] = [await look(1.8), await look(2.0), await look(2.2)];
    details[type] = { ok: mid.mean > 20 && diff(mid, before) > 10 && diff(mid, after) > 10 && diff(early, mid) > 3 && diff(late, mid) > 3 && diff(await look(1.5), before) < 1 && diff(await look(2.5), after) < 1, mid: Math.round(mid.mean) };
    if (type === "spinBlur") {
      await page.evaluate(async () => {
        window.videoEditor.seek(60);
        await window.videoEditor.rendered();
      });
      await page.screenshot({ path: "__REPO__/scratch/epic-transition.png" });
    }
  }
  return { ok: Object.values(details).every((d) => d.ok), details };
};
