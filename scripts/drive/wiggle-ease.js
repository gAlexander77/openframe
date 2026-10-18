// Overshooting eases and wiggle (ADR-060), measured from where a small
// white square's light actually lands in the viewer.
// - spring and elastic: a move from x -0.3 to 0 over one second passes 0
//   early on, then settles exactly on it.
// - bounce: never passes 0, but turns back on the way (it bounces).
// - wiggle on position (40 px, 4 Hz): the square wanders tens of pixels,
//   the same way every time the frame is drawn.
// - strength keyed 0 -> 1: no shake at the start, shake at the end.
// - amplitude 0 removes the wiggle.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  page.setDefaultTimeout(5000);
  const ids = await page.evaluate(() => {
    const v = window.videoEditor;
    v.exec("set_project", { width: 1920, height: 1080 });
    const main = v.project().tracks.find((t) => t.main).id;
    const square = (start, dur) => {
      v.exec("add_shape", { kind: "rectangle", start, duration: dur, width: 0.04, height: 0.04 * (16 / 9), color: "#ffffff", track_id: main });
      return v.describe().tracks.flatMap((t) => t.clips).find((c) => c.start === start).id;
    };
    const out = {};
    for (const [name, start] of [["spring", 0], ["bounce", 2], ["elastic", 4]]) {
      const id = square(start, 1.5);
      v.exec("add_keyframe", { clip_id: id, path: "transform.x", at: start, value: -0.3, ease: name });
      v.exec("add_keyframe", { clip_id: id, path: "transform.x", at: start + 1, value: 0 });
      out[name] = id;
    }
    out.wiggle = square(6, 2);
    v.exec("set_wiggle", { clip_ids: [out.wiggle], target: "position", frequency: 4, amplitude: 40 });
    out.ramp = square(9, 2);
    v.exec("set_wiggle", { clip_ids: [out.ramp], target: "position", frequency: 4, amplitude: 40, strength: 0, at: 9 });
    v.exec("set_wiggle", { clip_ids: [out.ramp], target: "position", strength: 1, at: 10 });
    return out;
  });
  /** The centroid of the frame's bright pixels, canvas pixels. */
  const centers = (frames) =>
    page.evaluate(async (frames) => {
      const v = window.videoEditor;
      const out = [];
      for (const f of frames) {
        v.seek(f);
        await new Promise((r) => setTimeout(r, 30));
        await v.rendered();
        const px = v.pixels();
        let sx = 0, sy = 0, n = 0;
        for (let y = 0; y < px.height; y++)
          for (let x = 0; x < px.width; x++) {
            const l = px.data[(y * px.width + x) * 4] / 255;
            sx += x * l;
            sy += y * l;
            n += l;
          }
        out.push(n ? { x: ((sx / n + 0.5) / px.width) * 1920, y: ((sy / n + 0.5) / px.height) * 1080 } : null);
      }
      return out;
    }, frames);
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const details = {};
  const mid = 960;
  for (const [name, start] of [["spring", 0], ["elastic", 120]]) {
    const c = await centers(range(start, start + 30));
    const most = Math.max(...c.map((p) => p.x));
    details[name] = { ok: most > mid + 20 && Math.abs(c[30].x - mid) < 2, passedBy: Math.round(most - mid), endsAt: +c[30].x.toFixed(1) };
  }
  {
    const c = (await centers(range(60, 90))).map((p) => p.x);
    const back = c.slice(1).some((x, i) => x < c[i] - 2);
    details.bounce = { ok: Math.max(...c) <= mid + 1 && back && Math.abs(c[30] - mid) < 2, most: Math.round(Math.max(...c)), turnsBack: back };
  }
  {
    const c = await centers(range(180, 239));
    const dev = c.map((p) => Math.hypot(p.x - mid, p.y - 540));
    const again = await centers([190, 190]);
    const first = c[10];
    details.wiggle = {
      ok: Math.max(...dev) > 10 && Math.max(...dev) < 60 && again.every((p) => Math.abs(p.x - first.x) < 0.01 && Math.abs(p.y - first.y) < 0.01),
      most: +Math.max(...dev).toFixed(1),
      xs: c.slice(0, 6).map((p) => Math.round(p.x)),
    };
  }
  {
    const [start] = await centers([270]);
    const late = await centers(range(300, 329));
    const dev = late.map((p) => Math.hypot(p.x - mid, p.y - 540));
    details.strengthRamp = { ok: Math.hypot(start.x - mid, start.y - 540) < 0.5 && Math.max(...dev) > 8, atStart: start, lateMost: +Math.max(...dev).toFixed(1) };
  }
  const desc = await page.evaluate((id) => window.videoEditor.describe().tracks.flatMap((t) => t.clips).find((c) => c.id === id).wiggle, ids.wiggle);
  details.described = { ok: !!desc?.x && !!desc?.y && desc.x.frequency === 4, desc };
  await page.evaluate((id) => window.videoEditor.exec("set_wiggle", { clip_ids: [id], target: "position", amplitude: 0 }), ids.wiggle);
  {
    const c = await centers([185, 200, 215]);
    details.removed = { ok: c.every((p) => Math.hypot(p.x - mid, p.y - 540) < 0.5), c };
  }
  return { ok: Object.values(details).every((d) => d.ok), details };
};
