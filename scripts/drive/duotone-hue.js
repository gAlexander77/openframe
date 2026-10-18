// Duotone's hue runs round the standard wheel (HSL's and set_color_wheel's):
// 0 red, 60 yellow, 120 green, 180 cyan, 240 blue, 300 magenta. A white
// solid with duotone at 100% shows the tint itself; the viewer's center
// pixel is read at each hue and its HSL hue must land within 15 degrees of
// the one asked (the hue ran backwards before: 60 was purple, 240 teal).
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const rows = await page.evaluate(async () => {
    const v = window.videoEditor;
    v.exec("add_color_clip", { color: "#ffffff", start: 0, duration: 2 });
    const id = v.project().tracks.flatMap((t) => t.clips)[0].id;
    v.exec("add_effect", { clip_id: id, type: "duotone", params: { amount: 100, hue: 0 } });
    const fx = v.project().tracks.flatMap((t) => t.clips)[0].effects[0].id;
    // HSL hue in degrees of an 8-bit color.
    const hueOf = ([r, g, b]) => {
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      if (d === 0) return null;
      const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return Math.round((h * 60 + 360) % 360);
    };
    const out = [];
    for (const hue of [0, 60, 120, 180, 240, 300]) {
      v.exec("set_param", { clip_ids: [id], path: `effects.${fx}.hue`, value: hue });
      v.seek(15);
      await new Promise((r) => setTimeout(r, 30));
      await v.rendered();
      const p = v.pixels(64);
      const i = (Math.floor(p.height / 2) * p.width + Math.floor(p.width / 2)) * 4;
      const rgb = [p.data[i], p.data[i + 1], p.data[i + 2]];
      out.push({ hue, rgb, seen: hueOf(rgb) });
    }
    return out;
  });
  const off = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  const details = {};
  for (const r of rows) details[`hue ${r.hue}`] = { ok: r.seen !== null && off(r.seen, r.hue) <= 15, rgb: r.rgb, seen: r.seen };
  const y = rows.find((r) => r.hue === 60).rgb, b = rows.find((r) => r.hue === 240).rgb;
  details.yellowish = { ok: y[0] > 150 && y[1] > 150 && y[2] < 60, rgb: y };
  details.bluish = { ok: b[2] > 200 && b[0] < 100 && b[1] < 100, rgb: b };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
