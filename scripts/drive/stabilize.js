// Stabilize drive: shaky.mp4 (a photo behind a window jittering 40 x 30 px
// every frame; node scripts/make-fixtures.mjs shaky) is measured frame to
// frame in the rendered viewer, by the same phase correlation the tool
// uses, before and after Stabilize from the inspector. After, neighboring
// frames barely move; the inspector reports the zoom; Undo removes it.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const id = await page.evaluate(async () => {
    const api = window.videoEditor;
    const [a] = await api.import([{ name: "shaky.mp4", src: location.origin + "/fixtures/media/shaky.mp4" }]);
    api.exec("add_media_clip", { asset_id: a.id, start: 0 });
    const c = api.describe().tracks.flatMap((t) => t.clips)[0];
    api.select([c.id]);
    return c.id;
  });
  // Mean frame-to-frame movement of the rendered picture over frames 20-40.
  const jitter = () =>
    page.evaluate(async () => {
      const url = performance.getEntriesByType("resource").map((e) => e.name).find((n) => /\/src\/lib\/analysis\/stabilize\.ts/.test(n)) ?? "/src/lib/analysis/stabilize.ts";
      const st = await import(url);
      const api = window.videoEditor;
      const cv = new OffscreenCanvas(st.AW, st.AH);
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      let prev = null, sum = 0, n = 0;
      for (let f = 20; f <= 40; f++) {
        api.seek(f);
        await api.rendered();
        const px = api.pixels(640);
        const img = new ImageData(new Uint8ClampedArray(px.data), px.width, px.height);
        const big = new OffscreenCanvas(px.width, px.height);
        big.getContext("2d").putImageData(img, 0, 0);
        // The middle 70% of the frame: away from edges a zoom could move.
        ctx.drawImage(big, px.width * 0.15, px.height * 0.15, px.width * 0.7, px.height * 0.7, 0, 0, st.AW, st.AH);
        const rgba = ctx.getImageData(0, 0, st.AW, st.AH).data;
        const gray = new Uint8Array(st.AW * st.AH);
        for (let i = 0; i < gray.length; i++) gray[i] = (rgba[i * 4] * 77 + rgba[i * 4 + 1] * 150 + rgba[i * 4 + 2] * 29) >> 8;
        const s = st.spectrum(gray);
        if (prev) {
          const m = st.shiftBetween(prev, s);
          sum += Math.hypot(m.dx, m.dy);
          n++;
        }
        prev = s;
      }
      return +(sum / n).toFixed(2);
    });
  const details = {};
  const before = await jitter();
  await page.getByRole("tab", { name: "Video" }).click().catch(() => {});
  const section = page.locator(".insp-section", { has: page.getByText("Stabilize", { exact: true }) });
  await section.getByRole("switch", { name: "Stabilize" }).click();
  await page.waitForFunction((id) => !!window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).stabilize, id, { timeout: 60000 });
  const after = await jitter();
  const stored = await page.evaluate((id) => {
    const s = window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).stabilize;
    return { zoom: s.zoom, rate: s.rate, from: s.from, n: s.x.length, maxX: Math.max(...s.x.map(Math.abs)), maxY: Math.max(...s.y.map(Math.abs)), x: s.x.slice(18, 26), y: s.y.slice(18, 26) };
  }, id);
  details.stored = { ok: true, ...stored };
  details.steadier = { ok: before > 2 && after < before * 0.3, before, after };
  const hint = await section.locator(".insp-hint").innerText();
  details.reportsZoom = { ok: /Zoomed \d+%/.test(hint), hint };
  await page.screenshot({ path: "scratch/stabilize.png" });
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.undo = { ok: !(await page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).stabilize, id)) };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
