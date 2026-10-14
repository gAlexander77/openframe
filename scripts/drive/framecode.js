// Frame-accuracy drive: proves the viewer shows exactly the source frame the
// timeline says it should, at 1x, 2x and 0.5x, across GOP boundaries,
// B-frames and backward seeks. Needs the dev server (npm run dev) and
// fixtures (node scripts/make-fixtures.mjs).
//
// Web: run through the Playwright MCP tool `browser_run_code_unsafe` with
// filename "scripts/drive/framecode.js". Desktop: attach over the WebView2
// debug port and pass the absolute fixtures folder as the second argument,
// so the clip is read from disk through the media: protocol. Returns
// { checked, bad } — `bad` must be empty. See docs/Driving the app.md.
async (page, fixtures) => {
  if (fixtures) await page.reload();
  else await page.goto("http://localhost:1420");
  await page.waitForFunction(() => !!window.videoEditor);
  return await page.evaluate(async (fixtures) => {
    const ve = window.videoEditor;
    const src = fixtures ? `${fixtures}/framecode-30.mp4` : "http://localhost:1420/fixtures/media/framecode-30.mp4";
    const [a] = await ve.import([{ name: "framecode-30.mp4", src }]);
    const clipAt = (s) => ve.describe().tracks.flatMap((t) => t.clips).find((c) => c.start === s);
    ve.exec("add_media_clip", { asset_id: a.id, start: 0 });
    ve.exec("add_media_clip", { asset_id: a.id, start: 12, in: 2, duration: 4 });
    ve.exec("set_speed", { clip_id: clipAt(12).id, speed: 2 });
    ve.exec("add_media_clip", { asset_id: a.id, start: 20, in: 1, duration: 2 });
    ve.exec("set_speed", { clip_id: clipAt(20).id, speed: 0.5 });
    // The fixture encodes each frame's number in ten black/white blocks.
    const read = () => {
      const { width: w, height: h, data } = ve.pixels();
      let n = 0;
      for (let i = 0; i < 10; i++) if (data[(Math.floor(h / 2) * w + Math.floor(((i + 0.5) * w) / 10)) * 4] > 128) n |= 1 << i;
      return n;
    };
    const cases = [];
    for (let f = 0; f < 300; f += 7) cases.push([f, f]);
    for (const f of [59, 89, 90, 179, 180, 299, 1, 0]) cases.push([f, f]);
    for (const k of [0, 1, 2, 15, 29, 30, 44, 59]) cases.push([360 + k, 60 + 2 * k]); // 2x shows 0, 2, 4...
    for (const k of [0, 1, 2, 3, 10, 11, 57]) cases.push([600 + k, 30 + Math.floor(k / 2)]); // 0.5x holds each frame twice
    const bad = [];
    for (const [f, want] of cases) {
      ve.seek(f);
      await new Promise((r) => setTimeout(r, 20));
      await ve.rendered();
      const got = read();
      if (got !== want) bad.push({ f, want, got });
    }
    return { platform: ve.platform(), checked: cases.length, bad };
  }, fixtures);
}
