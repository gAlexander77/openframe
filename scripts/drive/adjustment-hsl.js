// set_hsl on an adjustment clip grades the layers under it. The blind test
// set green hue -30 and magenta saturation -50 / lightness -40 on an
// adjustment clip over saturated fractal footage and saw no change. Here
// the same calls go through MCP, first over color bars: the green and
// magenta bars must move exactly as the CPU reference (lib/grade.ts) says
// and the red bar must not; then over the fractal photo, where the share
// of the frame in each band and their mean saturation and lightness are
// measured with the adjustment clip off and on.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const out = await page.evaluate(async () => {
    const v = window.videoEditor;
    const grade = await import("/src/lib/grade.ts");
    const call = async (name, args) => {
      const r = await v.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      if (r.result?.isError) throw new Error(`${name}: ${r.result.content[0].text}`);
      return r.result.content;
    };
    const settle = async () => {
      v.seek(15);
      await new Promise((r) => setTimeout(r, 40));
      await v.rendered();
      return v.pixels();
    };
    const [bars, photo] = JSON.parse((await call("import_media", { files: [{ src: `${location.origin}/fixtures/media/color-bars.png` }, { src: `${location.origin}/fixtures/media/photo.jpg` }] }))[0].text);
    await call("add_media_clip", { asset_id: bars.id, start: 0, duration: 3 });
    await call("add_adjustment_clip", { start: 0, duration: 3 });
    const all = () => v.project().tracks.flatMap((t) => t.clips);
    const adj = all().find((c) => c.type === "adjustment");
    const order = v.project().tracks.map((t) => t.clips.map((c) => c.type).join("+"));

    // ---- color bars -------------------------------------------------------------
    const before = await settle();
    const at = (px, i) => {
      const k = (Math.floor(0.25 * px.height) * px.width + Math.floor(((i + 0.5) / 8) * px.width)) * 4;
      return [px.data[k], px.data[k + 1], px.data[k + 2]];
    };
    await call("set_hsl", { clip_id: adj.id, band: "green", hue: -30 });
    await call("set_hsl", { clip_id: adj.id, band: "magenta", saturation: -50, lightness: -40 });
    const after = await settle();
    const g = grade.resolveGrade(v.project(), all().find((c) => c.id === adj.id), 0);
    const want = (rgb) => grade.gradeRgb(rgb.map((x) => x / 255), g).map((x) => Math.round(x * 255));
    const bar = (name, i) => ({ name, before: at(before, i), after: at(after, i), reference: want(at(before, i)) });
    const barRows = [bar("green", 3), bar("magenta", 4), bar("red", 5)];

    // ---- the fractal photo ------------------------------------------------------
    await call("replace_clip", { clip_id: all().find((c) => c.type === "image").id, asset_id: photo.id });
    // HSL of every 4th pixel, gathered by band: green 90..150, magenta 300..340.
    const bands = (px) => {
      const acc = { green: { n: 0, s: 0, l: 0, h: 0 }, magenta: { n: 0, s: 0, l: 0, h: 0 } };
      for (let i = 0; i < px.data.length; i += 16) {
        const r = px.data[i] / 255, gg = px.data[i + 1] / 255, b = px.data[i + 2] / 255;
        const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), d = mx - mn, l = (mx + mn) / 2;
        if (d < 0.15) continue;
        const s = d / (1 - Math.abs(2 * l - 1));
        const h = (mx === r ? ((gg - b) / d + 6) % 6 : mx === gg ? (b - r) / d + 2 : (r - gg) / d + 4) * 60;
        const band = h >= 90 && h < 150 ? "green" : h >= 300 && h < 340 ? "magenta" : null;
        if (!band) continue;
        const a = acc[band];
        a.n++, (a.s += s), (a.l += l), (a.h += h);
      }
      const total = px.data.length / 16;
      return Object.fromEntries(Object.entries(acc).map(([k, a]) => [k, { share: +(a.n / total).toFixed(3), hue: +(a.h / a.n).toFixed(1), saturation: +(a.s / a.n).toFixed(3), lightness: +(a.l / a.n).toFixed(3) }]));
    };
    await call("update_track", { track_id: v.project().tracks.find((t) => t.clips.some((c) => c.id === adj.id)).id, hidden: true }).catch(() => null);
    const off = bands(await settle());
    const hiddenWorked = v.project().tracks.find((t) => t.clips.some((c) => c.id === adj.id)).hidden === true;
    await call("update_track", { track_id: v.project().tracks.find((t) => t.clips.some((c) => c.id === adj.id)).id, hidden: false }).catch(() => null);
    const on = bands(await settle());
    return { order, grade: g, barRows, photo: { off, on, hiddenWorked } };
  });
  const diff = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));
  const details = {};
  for (const r of out.barRows) {
    const moved = diff(r.before, r.after);
    details[`${r.name} bar`] = { ok: diff(r.after, r.reference) <= 3 && (r.name === "red" ? moved <= 1 : moved >= 10), moved, ...r };
  }
  const { off, on, hiddenWorked } = out.photo;
  details.photo = {
    ok: hiddenWorked && on.magenta.saturation < off.magenta.saturation - 0.1 && on.magenta.lightness < off.magenta.lightness - 0.03,
    off,
    on,
  };
  details.layers = { ok: true, order: out.order, grade: out.grade };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
