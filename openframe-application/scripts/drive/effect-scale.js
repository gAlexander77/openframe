// Effects look the same at every render size (ADR-117): the viewer draws
// a frame small, the export at full size, and an effect's pixel sizes are
// pixels at 1080p, so each must cover the same share of the picture in
// both. Measured on stills at 1080p and 480p and on the viewer's own
// canvas: an RGB split's offset (it was a fixed number of render pixels),
// VHS's scan lines (one every 4.2 render pixels), the pixelate
// transition's blocks (60 render pixels), and a glow's reach, which now
// follows its radius. The stills go to scratch/effect-scale/ to look at.
async (page) => {
  const fs = await import("node:fs");
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const dir = "__REPO__/scratch/effect-scale";
  fs.mkdirSync(dir, { recursive: true });
  // Set up in the page: helpers that render and measure there.
  await page.evaluate(() => {
    const api = window.videoEditor;
    const decode = async (url) => {
      const bmp = await createImageBitmap(await (await fetch(url)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext("2d");
      g.drawImage(bmp, 0, 0);
      return { w: bmp.width, h: bmp.height, data: g.getImageData(0, 0, bmp.width, bmp.height).data };
    };
    const png = async (url) => {
      const b = new Uint8Array(await (await fetch(url)).arrayBuffer());
      let s = "";
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
      return btoa(s);
    };
    window.__fx = {
      /** A still at `res` and the viewer's canvas, both at `second`. */
      async shots(second, name) {
        const frame = Math.round(second * 30);
        api.seek(frame);
        await new Promise((r) => setTimeout(r, 80));
        await api.rendered();
        const v = api.pixels();
        const viewer = { w: v.width, h: v.height, data: v.data };
        const out = { viewer };
        for (const res of ["1080p", "480p"]) {
          const s = await api.still(frame, res);
          out[res] = await decode(s.url);
          out[`${res}png`] = await png(s.url);
        }
        window.__shots = window.__shots ?? {};
        window.__shots[name] = out;
        return { viewer: [viewer.w, viewer.h], pngs: { "1080p": out["1080ppng"], "480p": out["480ppng"] } };
      },
    };
  });
  const shots = async (second, name) => {
    const r = await page.evaluate(([s, n]) => window.__fx.shots(s, n), [second, name]);
    for (const [res, b64] of Object.entries(r.pngs)) fs.writeFileSync(`${dir}/${name}-${res}.png`, Buffer.from(b64, "base64"));
    return r.viewer;
  };
  const measure = (name, fn) => page.evaluate(([name, fn]) => {
    const f = (0, eval)(fn);
    const s = window.__shots[name];
    return { "1080p": f(s["1080p"]), "480p": f(s["480p"]), viewer: f(s.viewer) };
  }, [name, fn.toString()]);
  const call = (name, args) => page.evaluate(async ([name, args]) => {
    const r = await window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
    if (r.error || r.result.isError) throw new Error(`${name}: ${r.error?.message ?? r.result.content[0].text}`);
    return JSON.parse(r.result.content.at(-1).text);
  }, [name, args]);
  const clear = () => page.evaluate(() => {
    const api = window.videoEditor;
    const ids = api.describe().tracks.flatMap((t) => t.clips).map((c) => c.id);
    if (ids.length) api.exec("delete_clips", { clip_ids: ids });
  });
  const details = {};
  const close = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b));

  // ---- RGB split: a white box on black, split 30 (23 px at 1080p) ---------------
  const box = await call("add_shape", { kind: "rectangle", start: 0, duration: 3, width: 0.3, height: 0.4, color: "#ffffff" });
  const boxId = box.added_clips?.[0]?.id ?? box.id;
  await call("add_effect", { clip_id: boxId, type: "rgbSplit", params: { amount: 30, angle: 0 } });
  const viewerSize = await shots(1, "rgb-split");
  // Where the box's left edge is in red and in blue along the middle row:
  // half their distance is the split, as a share of the width.
  const split = await measure("rgb-split", (s) => {
    const y = Math.floor(s.h / 2);
    const edge = (c) => {
      for (let x = Math.floor(s.w * 0.2); x < s.w * 0.5; x++) if (s.data[(y * s.w + x) * 4 + c] > 127) return x;
      return -1;
    };
    return (edge(2) - edge(0)) / 2 / s.w;
  });
  details.rgbSplit = { ok: close(split["480p"], split["1080p"], 0.1) && close(split.viewer, split["1080p"], 0.15) && close(split["1080p"], (0.768 * 30) / 1920, 0.05), split, viewerSize };
  await clear();

  // ---- VHS on flat gray: its lines against the export's, scaled down -----------
  const gray = await call("add_color_clip", { color: "#808080", start: 0, duration: 3 });
  const grayId = gray.added_clips?.[0]?.id ?? gray.id;
  await call("add_effect", { clip_id: grayId, type: "vhs", params: { amount: 100 } });
  await shots(1, "vhs");
  // Each row's mean green across the middle, and the 1080p rows averaged
  // down to the other's height (area average): how far apart they are.
  const vhs = await page.evaluate(() => {
    const s = window.__shots.vhs;
    const rows = (img) => Array.from({ length: img.h }, (_, y) => {
      let sum = 0;
      for (let x = Math.floor(img.w * 0.4); x < img.w * 0.6; x++) sum += img.data[(y * img.w + x) * 4 + 1];
      return sum / Math.ceil(img.w * 0.2);
    });
    const big = rows(s["1080p"]);
    const down = (n) => Array.from({ length: n }, (_, i) => {
      const a = (i * big.length) / n, b = ((i + 1) * big.length) / n;
      let sum = 0;
      for (let y = Math.floor(a); y < Math.ceil(b); y++) sum += big[y] * (Math.min(b, y + 1) - Math.max(a, y));
      return sum / (b - a);
    });
    const spread = (r) => { const m = r.reduce((a, b) => a + b, 0) / r.length; return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length); };
    const off = (img) => {
      const r = rows(img), d = down(img.h);
      const mid = r.slice(Math.floor(img.h * 0.3), Math.floor(img.h * 0.7)), dm = d.slice(Math.floor(img.h * 0.3), Math.floor(img.h * 0.7));
      return { rms: +Math.sqrt(mid.reduce((a, v, i) => a + (v - dm[i]) ** 2, 0) / mid.length).toFixed(2), lines: +spread(mid).toFixed(2), export: +spread(dm).toFixed(2) };
    };
    return { "480p": off(s["480p"]), viewer: off(s.viewer), "1080p": { lines: +spread(big.slice(324, 756)).toFixed(2) } };
  });
  // Before ADR-117: 7.9 and 7.5 levels off (half as many lines, twice as
  // thick); after, 1.2 and 1.1, the same lines beating as the export's do.
  details.vhs = { ok: vhs["480p"].rms < 2.5 && vhs.viewer.rms < 2.5 && vhs["1080p"].lines > 2, vhs };
  await clear();

  // ---- the pixelate transition's blocks, mid-transition ------------------------
  const [photo] = await page.evaluate(async () => window.videoEditor.import([{ name: "photo.jpg", src: `${location.origin}/fixtures/media/photo.jpg` }]));
  await call("add_media_clip", { asset_id: photo.id, start: 0, duration: 2 });
  await call("add_media_clip", { asset_id: photo.id, start: 2, duration: 2 });
  const [first] = await page.evaluate(() => window.videoEditor.describe().tracks.flatMap((t) => t.clips));
  await call("set_transition", { clip_id: first.id, type: "pixelate", duration: 1 });
  await shots(2, "pixelate");
  // Blocks across the middle row: where the color changes.
  const blocks = await measure("pixelate", (s) => {
    const y = Math.floor(s.h / 2);
    let changes = 0;
    for (let x = 1; x < s.w; x++) {
      const i = (y * s.w + x) * 4, j = i - 4;
      if (Math.abs(s.data[i] - s.data[j]) + Math.abs(s.data[i + 1] - s.data[j + 1]) + Math.abs(s.data[i + 2] - s.data[j + 2]) > 6) changes++;
    }
    return changes;
  });
  details.pixelate = { ok: Math.abs(blocks["480p"] - blocks["1080p"]) <= 2 && Math.abs(blocks.viewer - blocks["1080p"]) <= 3 && blocks["1080p"] >= 25 && blocks["1080p"] <= 34, blocks };
  await clear();

  // ---- a glow's reach follows its radius, the same share at any size ----------
  const dot = await call("add_shape", { kind: "rectangle", start: 0, duration: 3, width: 0.05, height: 0.6, color: "#ffffff" });
  const dotId = dot.added_clips?.[0]?.id ?? dot.id;
  await call("add_effect", { clip_id: dotId, type: "glow", params: { amount: 100, threshold: 50 } });
  const fxId = await page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).effects[0].id, dotId);
  // How far right of the bar's edge (52.5% across) the glow lights the
  // middle row, as a share of the height.
  const reach = (s) => {
    const y = Math.floor(s.h / 2);
    const edge = s.w * 0.525;
    let x = Math.ceil(edge);
    while (x < s.w && s.data[(y * s.w + x) * 4] > 8) x++;
    return (x - edge) / s.h;
  };
  await shots(1, "glow-18");
  const r18 = await measure("glow-18", reach);
  // Before ADR-117 there was no radius to set.
  const r36 = await call("set_param", { clip_ids: [dotId], path: `effects.${fxId}.radius`, value: 36 }).then(async () => (await shots(1, "glow-36"), measure("glow-36", reach)), (e) => ({ error: e.message, "1080p": 0 }));
  details.glow = { ok: close(r18["480p"], r18["1080p"], 0.2) && r36["1080p"] > 1.6 * r18["1080p"] && close(r18["1080p"], 18 / 1080, 0.25), r18, r36 };

  return { ok: Object.values(details).every((d) => d.ok), details };
};
