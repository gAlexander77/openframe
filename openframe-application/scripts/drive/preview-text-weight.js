// Titles in previews weigh what they weigh in the export (the documentary
// test's §3.L: at the same review width a preview's label looked heavier
// than the exported file's). White titles at weights 400 and 500 and
// three sizes over black: the ink in each title's box (its summed
// lightness) on preview_frames' and preview_frame's 640-wide pictures
// against the full-size export frame and the exported MP4, both brought
// down to 640 wide.
async (page) => {
  page.setDefaultTimeout(60000);
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  return await page.evaluate(async () => {
    const ve = window.videoEditor;
    const call = async (name, args = {}) => {
      const r = await ve.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      if (r.error || r.result.isError) throw new Error(`${name}: ${r.error?.message ?? r.result.content[0].text}`);
      return r.result.content;
    };
    await call("set_project", { width: 1920, height: 1080, fps: "30" });
    await call("add_color_clip", { color: "#000000", start: 0, duration: 2 });
    const titles = [];
    for (const [row, size] of [36, 60, 96].entries()) {
      for (const [col, weight] of [400, 500].entries()) {
        const x = col ? 0.25 : -0.25, y = -0.3 + row * 0.25;
        await call("add_text", { text: "Home is here", start: 0, duration: 2, x, y, style: { size, weight, color: "#ffffff", font: "Inter" } });
        titles.push({ size, weight, x, y });
      }
    }
    await document.fonts.ready;
    const W = 640, H = 360;
    /** Summed lightness inside each title's box of a W x H picture. */
    const ink = async (source) => {
      const c = new OffscreenCanvas(W, H);
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(source, 0, 0, W, H);
      const { data } = g.getImageData(0, 0, W, H);
      return titles.map((t) => {
        const cx = (0.5 + t.x) * W, cy = (0.5 + t.y) * H, hw = 0.22 * W, hh = ((t.size / 1080) * H) * 0.9;
        let s = 0;
        for (let y = Math.floor(cy - hh); y < cy + hh; y++) for (let x = Math.floor(cx - hw); x < cx + hw; x++) s += data[(y * W + x) * 4];
        return s;
      });
    };
    const bitmapOf = async (b64, type) => createImageBitmap(await (await fetch(`data:${type};base64,${b64}`)).blob());
    // The preview, as an agent asks for it.
    const sheet = await bitmapOf((await call("preview_frames", { times: [1], columns: 1, tile_width: 640 }))[0].data, "image/jpeg");
    const tile = await createImageBitmap(sheet, 6, 6, W, H);
    const preview = await ink(tile);
    const single = await ink(await bitmapOf((await call("preview_frame", { at: 1, max_width: 640 }))[0].data, "image/png"));
    // What export writes: the frame at full size, then brought down the
    // way the file is below (drawImage). createImageBitmap's "high"
    // resize differs by machine: on one it took 5% of a thin 36 px
    // title's ink that the file and the previews both kept.
    const still = await ve.still(30, "1080p");
    const full = await createImageBitmap(await (await fetch(still.url)).blob());
    const exported = await ink(full);
    // And the encoded file itself, as a player shows it at that width.
    const out = await ve.render({ start: 0, end: 2, resolution: "1080p" });
    const video = document.createElement("video");
    video.muted = true;
    video.src = out.url;
    await new Promise((r, j) => ((video.onloadeddata = r), (video.onerror = () => j(new Error("the export would not play")))));
    video.currentTime = 1;
    await new Promise((r) => (video.onseeked = r));
    const file = await ink(video);
    URL.revokeObjectURL(out.url);
    const ratio = (a, b) => titles.map((t, i) => ({ size: t.size, weight: t.weight, ratio: +(a[i] / b[i]).toFixed(3) }));
    const vsStill = ratio(preview, exported), vsFile = ratio(preview, file), singleVsStill = ratio(single, exported);
    // Within 4% of the export frame; the H.264 file within 8% (its own
    // blur and rounding). Whether 500 differs from 400 is the font's
    // (a family without a 500 face draws 400), reported, not judged.
    const heavier = [0, 2, 4].map((i) => +(preview[i + 1] / preview[i]).toFixed(3));
    const ok = vsStill.every((r) => Math.abs(r.ratio - 1) < 0.04) && singleVsStill.every((r) => Math.abs(r.ratio - 1) < 0.04) && vsFile.every((r) => Math.abs(r.ratio - 1) < 0.08);
    return { ok, details: { vsStill, singleVsStill, vsFile, weight500over400: heavier } };
  });
}
