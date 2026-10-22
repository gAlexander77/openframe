// A tiny highlight at radius 48 must spread smoothly, with no copies on
// the old 16-pixel tap grid. Read an export-sized still and the viewer.
async (page) => {
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  return page.evaluate(async () => {
    const ve = window.videoEditor;
    const call = async (name, args) => {
      const r = await ve.exec(name, args);
      if (r?.error) throw new Error(JSON.stringify(r));
      return r;
    };
    await call("set_project", { width: 1920, height: 1080 });
    await call("add_shape", { kind: "rectangle", color: "#ffffff", start: 0, duration: 2, width: 8 / 1920, height: 8 / 1080 });
    const id = ve.project().tracks.flatMap(t => t.clips).find(c => c.type === "color").id;
    await call("add_effect", { clip_id: id, type: "glow", params: { amount: 100, threshold: 50, radius: 48 } });
    ve.seek(30);
    await new Promise(r => setTimeout(r, 80));
    await ve.rendered();
    const details = {};
    const measure = (p) => {
      const k = p.width / 1920;
      const value = (offset) => {
        const cx = Math.round(p.width / 2 + offset * k), cy = Math.round(p.height / 2);
        let sum = 0, n = 0;
        const side = Math.max(0, Math.round(2 * k));
        for (let y = cy - side; y <= cy + side; y++) for (let x = cx - side; x <= cx + side; x++) { sum += p.data[(y * p.width + x) * 4]; n++; }
        return sum / n;
      };
      const values = [12, 16, 20, 24, 28, 32, 36, 40, 44, 48].map(value);
      return { ok: values[3] > 1 && values[3] >= values[5] * 0.55 && values.slice(1).every((v, i) => v <= values[i] + 1.5), values };
    };
    details.viewer = measure(ve.pixels());
    const still = await ve.still(30, "1080p");
    const bmp = await createImageBitmap(await (await fetch(still.url)).blob());
    const canvas = new OffscreenCanvas(bmp.width, bmp.height), ctx = canvas.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    details.export = measure({ width: bmp.width, height: bmp.height, data: ctx.getImageData(0, 0, bmp.width, bmp.height).data });
    bmp.close();
    return { ok: Object.values(details).every(d => d.ok), details };
  });
};
