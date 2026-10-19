// Contact sheets keep a sky's gradient (ADR-073). preview_frames,
// preview_motion and preview_media now answer JPEG: as PNG a sheet of
// footage ran to megabytes, past what an MCP client sends a model, and
// Claude Code shrinks an oversized PNG by re-encoding it with a 256-color
// palette, which bands skies. Measured here: a dark sky gradient with a
// little grain (photographic, so PNG compresses as it does for footage)
// on a 16-frame, 480-wide sheet. The sheet must be JPEG, a fraction of the
// PNG's size, and keep the gradient's levels as the lossless frame does.
async (page) => {
  page.setDefaultTimeout(20000);
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const r = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const call = async (name, args) => {
      const res = await ve.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      if (res.result?.isError) throw new Error(JSON.stringify(res.result));
      return res.result.content;
    };
    // A 1920x1080 night sky: blue 10 to 68 down the frame, with grain.
    const w = 1920, h = 1080;
    const sky = new OffscreenCanvas(w, h);
    const g = sky.getContext("2d");
    const img = g.createImageData(w, h);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 3;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const t = y / (h - 1), i = (y * w + x) * 4;
        img.data[i] = 2 + 24 * t + rand();
        img.data[i + 1] = 4 + 38 * t + rand();
        img.data[i + 2] = 10 + 58 * t + rand();
        img.data[i + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    const loaded = performance.getEntriesByType("resource").map((e) => e.name);
    const { adoptAndImport } = await import(loaded.find((n) => new URL(n).pathname === "/src/state/media.ts") ?? "/src/state/media.ts");
    const [a] = await adoptAndImport([new File([await sky.convertToBlob({ type: "image/png" })], "night-sky.png", { type: "image/png" })]);
    ve.exec("add_media_clip", { asset_id: a.id, start: 0, duration: 8 });

    const decode = async (b64, type) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([bytes], { type }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      c.getContext("2d").drawImage(bmp, 0, 0);
      return { w: bmp.width, h: bmp.height, data: c.getContext("2d").getImageData(0, 0, bmp.width, bmp.height).data, bytes: bytes.length };
    };
    // Blue down a column, averaged over 9 pixels across to see past grain:
    // how many distinct levels, and the biggest jump between rows.
    const column = (im, x, y0, y1) => {
      const v = [];
      for (let y = y0; y < y1; y++) {
        let s = 0;
        for (let dx = -4; dx <= 4; dx++) s += im.data[(y * im.w + x + dx) * 4 + 2];
        v.push(Math.round(s / 9));
      }
      return { levels: new Set(v).size, maxStep: Math.max(...v.slice(1).map((x, i) => Math.abs(x - v[i]))) };
    };
    const times = Array.from({ length: 16 }, (_, i) => i * 0.45);
    const sheet = (await call("preview_frames", { times, tile_width: 480, columns: 4 }))[0];
    const sheetImg = await decode(sheet.data, sheet.mimeType);
    // The same tile as the lossless still, and the sheet re-encoded as PNG
    // to see the size a PNG sheet was.
    const frame = await decode((await call("preview_frame", { at: 0, max_width: 480 }))[0].data, "image/png");
    const asPng = new OffscreenCanvas(sheetImg.w, sheetImg.h);
    asPng.getContext("2d").putImageData(new ImageData(sheetImg.data, sheetImg.w, sheetImg.h), 0, 0);
    const pngBytes = (await asPng.convertToBlob({ type: "image/png" })).size;
    const tileH = Math.round((480 * h) / w);
    const media = (await call("preview_media", { asset_id: a.id, tile_width: 480 }))[0];
    return {
      mime: sheet.mimeType,
      mediaMime: media.mimeType,
      bytes: sheet.data.length * 0.75,
      pngBytes,
      sheet: column(sheetImg, 6 + 240, 6 + 30, 6 + tileH - 4),
      frame: column(frame, 240, 30, tileH - 4),
    };
  });
  const details = {
    jpeg: { ok: r.mime === "image/jpeg" && r.mediaMime === "image/jpeg" },
    small: { ok: r.bytes < 1_000_000 && r.bytes < r.pngBytes / 3, kb: Math.round(r.bytes / 1024), pngKb: Math.round(r.pngBytes / 1024) },
    keepsLevels: { ok: r.sheet.levels >= r.frame.levels * 0.9 && r.sheet.maxStep <= r.frame.maxStep + 1, sheet: r.sheet, losslessFrame: r.frame },
  };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
