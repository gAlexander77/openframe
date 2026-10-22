// preview_motion's first tile after a seek (the documentary test's §3.J):
// across speed ramps, every tile of a motion sheet (the first included)
// shows the source frame the viewer shows at that time, and a clip that
// runs forward never steps back between tiles. preview_frames' sheets are
// held to the same. framecode-30.mp4 stamps each frame's number in ten
// black and white blocks, so a tile says which frame it is.
async (page) => {
  page.setDefaultTimeout(30000);
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const origin = new URL(page.url()).origin;
  return await page.evaluate(async (origin) => {
    const ve = window.videoEditor;
    const call = async (name, args = {}) => {
      const r = await ve.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      if (r.error || r.result.isError) throw new Error(`${name}: ${r.error?.message ?? r.result.content[0].text}`);
      return r.result.content;
    };
    const [a] = await ve.import([{ name: "framecode-30.mp4", src: `${origin}/fixtures/media/framecode-30.mp4` }]);
    // Two ramped shots: one slows to a crawl and speeds away, one speeds up into the cut.
    ve.exec("add_media_clip", { asset_id: a.id, start: 0, duration: 10 });
    let clips = ve.describe().tracks.find((t) => t.main).clips;
    ve.exec("set_speed_curve", { clip_id: clips[0].id, points: [{ t: 0, speed: 1.6 }, { t: 0.45, speed: 0.25 }, { t: 1, speed: 1.8 }] });
    clips = ve.describe().tracks.find((t) => t.main).clips;
    ve.exec("add_media_clip", { asset_id: a.id, start: clips[0].end, in: 1, duration: 6 });
    clips = ve.describe().tracks.find((t) => t.main).clips;
    ve.exec("set_speed_curve", { clip_id: clips[1].id, points: [{ t: 0, speed: 0.5 }, { t: 1, speed: 2.5 }] });
    clips = ve.describe().tracks.find((t) => t.main).clips;
    const end = clips[1].end;

    /** The frame number in a picture's ten blocks, along its middle row. */
    const readAt = (data, stride, x0, y, w) => {
      let n = 0;
      for (let i = 0; i < 10; i++) if (data[(y * stride + Math.floor(x0 + ((i + 0.5) * w) / 10)) * 4] > 128) n |= 1 << i;
      return n;
    };
    /** Each tile's frame number, from a contact sheet (automation.ts tiles()). */
    const readSheet = async (b64, count, tileWidth, columns) => {
      const blob = await (await fetch(`data:image/jpeg;base64,${b64}`)).blob();
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext("2d");
      g.drawImage(bmp, 0, 0);
      const { data } = g.getImageData(0, 0, bmp.width, bmp.height);
      const cols = Math.min(columns, count), gap = 6, strip = 18, h = Math.round((360 * tileWidth) / 640);
      const out = [];
      for (let i = 0; i < count; i++) {
        const x = gap + (i % cols) * (tileWidth + gap), y = gap + Math.floor(i / cols) * (h + strip + gap);
        out.push(readAt(data, bmp.width, x, y + Math.floor(h / 2), tileWidth));
      }
      bmp.close();
      return out;
    };
    /** What the viewer shows at `t` seconds: a tile at 7.55 s (frame 226.5)
     * shows the earlier frame, the one on screen then (ADR-102). */
    const viewer = async (t) => {
      ve.seek(Math.ceil(t * 30 - 0.5 - 1e-9));
      await new Promise((r) => setTimeout(r, 20));
      await ve.rendered();
      const { width: w, height: h, data } = ve.pixels();
      return readAt(data, w, 0, Math.floor(h / 2), w);
    };

    const bad = [];
    let sheets = 0, tiles = 0;
    // Stretches starting all over both ramps, each a fresh seek for the first tile.
    for (let s = 0.3; s < end - 1; s += 1.37) {
      const e = Math.min(end - 0.05, s + 1.6);
      const content = await call("preview_motion", { start: +s.toFixed(2), end: +e.toFixed(2), fps: 10, columns: 4, tile_width: 240 });
      const { frames } = JSON.parse(content[1].text);
      const got = await readSheet(content[0].data, frames.length, 240, 4);
      sheets++;
      for (const [i, t] of frames.entries()) {
        tiles++;
        const want = await viewer(t);
        if (got[i] !== want) bad.push({ sheet: sheets, tile: i, t, want, got: got[i] });
        // Both clips run forward: within one clip a later tile never shows an earlier frame.
        const sameClip = (x) => (x < clips[0].end ? 0 : 1);
        if (i > 0 && sameClip(frames[i - 1]) === sameClip(t) && got[i] < got[i - 1]) bad.push({ sheet: sheets, tile: i, t, steppedBack: [got[i - 1], got[i]] });
      }
    }
    // preview_frames, its first moment too.
    const times = [2.2, 4.1, 4.15, 7.3, clips[1].start + 0.4, end - 0.3];
    const sheet = await call("preview_frames", { times, columns: 3, tile_width: 240 });
    const fromSheet = await readSheet(sheet[0].data, times.length, 240, 3);
    for (const [i, t] of times.entries()) {
      const want = await viewer(t);
      if (fromSheet[i] !== want) bad.push({ frames: true, t, want, got: fromSheet[i] });
    }
    return { ok: bad.length === 0 && tiles > 60, details: { sheets, tiles, ramps: clips.map((c) => [c.start, c.end, c.in, c.out]), bad: bad.slice(0, 20) } };
  }, origin);
}
