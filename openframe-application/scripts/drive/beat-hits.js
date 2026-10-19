// Beat hits and cinematic bars, as an agent makes them (window.videoEditor
// .mcp) and as the viewer draws them: a zoom punch changes the picture on
// its beat and is gone after it; a flash blows the frame out to near white
// and fades; flashes keep to three a second; bars letterbox a 16:9 canvas
// to 2.39:1 and slide in; titles land above the bars and hits. Also: the
// strobe effect's default rate is 2 a second.
async (page) => {
  page.setDefaultTimeout(15000);
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const call = (name, args = {}) =>
    page.evaluate(async ([name, args]) => {
      const r = await window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      const c = r.result?.content?.[0];
      if (r.error || r.result.isError) throw new Error(`${name}: ${r.error?.message ?? c.text}`);
      return c.type === "text" ? JSON.parse(c.text) : c;
    }, [name, args]);
  // The viewer at a time: mean level, and mean level of rows at fractions of the height.
  const look = (t, rows = []) =>
    page.evaluate(async ([t, rows]) => {
      const ve = window.videoEditor;
      ve.seek(Math.round(t * 30));
      await new Promise((r) => setTimeout(r, 30));
      await ve.rendered();
      const { width: w, height: h, data } = ve.pixels(480);
      const row = (y) => {
        let s = 0;
        const r = Math.min(h - 1, Math.floor(y * h));
        for (let x = 0; x < w; x++) s += (data[(r * w + x) * 4] + data[(r * w + x) * 4 + 1] + data[(r * w + x) * 4 + 2]) / 3;
        return s / w;
      };
      let s = 0;
      for (let i = 0; i < data.length; i += 4) s += (data[i] + data[i + 1] + data[i + 2]) / 3;
      return { mean: s / (data.length / 4), rows: rows.map(row), sig: Array.from({ length: 64 }, (_, k) => data[Math.floor((k * 7919) % (w * h)) * 4]) };
    }, [t, rows]);
  const diff = (a, b) => a.sig.reduce((s, v, i) => s + Math.abs(v - b.sig[i]), 0) / a.sig.length;
  const origin = new URL(page.url()).origin;
  const [photo] = await call("import_media", { files: [{ src: `${origin}/fixtures/media/photo.jpg`, name: "photo.jpg" }] });
  await call("add_media_clip", { asset_id: photo.id, start: 0, duration: 6 });
  const details = {};

  // Zoom punch at 1 s: different on the beat, back to normal after it.
  await call("add_beat_hits", { effect: "zoom", times: [1] });
  const [z0, z1, z2] = [await look(0.9), await look(1.0), await look(1.4)];
  details.zoomPunch = { ok: diff(z0, z1) > 8 && diff(z0, z2) < 1, onBeat: diff(z0, z1), after: diff(z0, z2) };

  // Flash at 2 s: near white on the beat, fading, gone after.
  await call("add_beat_hits", { effect: "flash", times: [2] });
  const [f0, f1, f2, f3] = [await look(1.9), await look(2.0), await look(2.1), await look(2.4)];
  details.flash = { ok: f1.mean > 200 && f1.mean > f2.mean && f2.mean > f0.mean + 10 && Math.abs(f3.mean - f0.mean) < 2, levels: [f0.mean, f1.mean, f2.mean, f3.mean].map(Math.round) };

  // Shake at 3 s moves the picture.
  await call("add_beat_hits", { effect: "shake", times: [3] });
  details.shake = { ok: diff(await look(2.9), await look(3.05)) > 5 };

  // Three flashes a second at most: ten asked for in one second.
  const many = await call("add_beat_hits", { effect: "flash", times: Array.from({ length: 10 }, (_, i) => 4 + i * 0.1) });
  const flashes = (many.added_clips ?? []).filter((c) => c.type === "adjustment").map((c) => c.start);
  details.photosensitive = { ok: flashes.length === 3, flashes };

  // Bars: 2.39:1 on 16:9 leaves 12.8% black at the top and bottom, sliding in over 1 s.
  await call("add_cinematic_bars", { ratio: 2.39, animate_in: 1 });
  const [b0, bHalf, b1] = [await look(0.02, [0.05, 0.11, 0.15, 0.5, 0.89, 0.95]), await look(0.5, [0.05, 0.11]), await look(1.5, [0.05, 0.11, 0.15, 0.5, 0.89, 0.95])];
  details.bars = {
    ok: b1.rows[0] < 3 && b1.rows[1] < 3 && b1.rows[4] < 3 && b1.rows[5] < 3 && b1.rows[2] > 20 && b1.rows[3] > 20 && b0.rows[0] > 20 && bHalf.rows[0] < 3 && bHalf.rows[1] > 20,
    start: b0.rows.map(Math.round),
    half: bHalf.rows.map(Math.round),
    full: b1.rows.map(Math.round),
  };

  // A title goes above the bars, the bars above the hits, the hits above the footage.
  await call("add_text", { text: "EPIC", start: 0, duration: 2, style: { size: 160, bold: true } });
  const order = (await call("describe_project")).tracks.filter((t) => t.kind === "video").map((t) => t.name);
  details.order = { ok: order[0] !== "Bars" && order.indexOf("Bars") < order.indexOf("Hits") && order.indexOf("Hits") < order.indexOf("Main") && !order.slice(0, order.indexOf("Bars")).some((n) => n.startsWith("Hits")), order };

  const fx = Object.fromEntries((await call("list_catalog", { section: "effects" })).map((e) => [e.id, e.params]));
  details.catalog = { ok: fx.flash.rate.default === 2 && !!fx.zoom && !!fx.letterbox };
  await page.screenshot({ path: "__REPO__/scratch/beat-hits.png" });
  return { ok: Object.values(details).every((d) => d.ok), details };
};
