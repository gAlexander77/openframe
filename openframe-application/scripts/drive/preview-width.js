// preview_frame's max_width is the image's width (never wider than the
// canvas) on any shape, and preview_frames' tiles are drawn at their own
// width: both read the viewer's canvas before, which is only as big as it
// is on screen, so a 9:16 project answered 222x395 whatever was asked.
// A 9:16 project with a red top half and a blue bottom half is previewed
// at 400, 540, 1080 and 1920 (capped to 1080), then reshaped to 16:9 and
// previewed at 640 and 1920; each PNG is decoded in the page for its size
// and its colors, which must match the halves.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const out = await page.evaluate(async () => {
    const v = window.videoEditor;
    const call = async (name, args) => {
      const r = await v.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      if (r.result?.isError) throw new Error(`${name}: ${r.result.content[0].text}`);
      return r.result.content;
    };
    // A PNG's size and the colors a quarter and three quarters down it.
    const look = async (data) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext("2d");
      g.drawImage(bmp, 0, 0);
      const px = (fy) => [...g.getImageData(Math.floor(bmp.width / 2), Math.floor(bmp.height * fy), 1, 1).data.slice(0, 3)];
      return { width: bmp.width, height: bmp.height, top: px(0.25), bottom: px(0.75) };
    };
    await call("set_project", { width: 1080, height: 1920 });
    await call("add_color_clip", { color: "#e02020", start: 0, duration: 3 });
    await call("add_color_clip", { color: "#2040e0", start: 0, duration: 3 });
    // The blue solid on top, cut to the bottom half.
    const blue = v.project().tracks.flatMap((t) => t.clips).find((c) => c.color === "#2040e0");
    await call("set_crop", { clip_ids: [blue.id], top: 0.5 });
    const tall = [];
    for (const w of [400, 540, 1080, 1920]) tall.push({ asked: w, ...(await look((await call("preview_frame", { at: 1, max_width: w }))[0].data)) });
    const sheet = await look((await call("preview_frames", { times: [0.5, 1.5], tile_width: 300, columns: 2 }))[0].data);
    await call("set_project", { width: 1920, height: 1080 });
    const wide = [];
    for (const w of [640, 1920]) wide.push({ asked: w, ...(await look((await call("preview_frame", { at: 1, max_width: w }))[0].data)) });
    return { tall, sheet, wide };
  });
  const red = ([r, g, b]) => r > 180 && g < 70 && b < 70, blue = ([r, g, b]) => b > 180 && r < 80 && g < 100;
  const details = {};
  for (const f of out.tall) {
    const w = Math.min(f.asked, 1080);
    details[`9:16 at ${f.asked}`] = { ok: f.width === w && f.height === Math.round((w * 1920) / 1080) && red(f.top) && blue(f.bottom), ...f };
  }
  for (const f of out.wide) details[`16:9 at ${f.asked}`] = { ok: f.width === f.asked && f.height === Math.round((f.asked * 1080) / 1920) && red(f.top) && blue(f.bottom), ...f };
  // Two 300-wide tiles, each over an 18-pixel label strip, and their three 6-pixel gaps.
  details.sheet = { ok: out.sheet.width === 2 * 300 + 3 * 6 && out.sheet.height === Math.round((300 * 1920) / 1080) + 18 + 2 * 6, width: out.sheet.width, height: out.sheet.height };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
