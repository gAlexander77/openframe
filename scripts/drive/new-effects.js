// New effects drive: Reduce image noise, Motion blur, Sketch and Halftone
// compile and draw. On noisy bars (grain added), Reduce image noise lowers
// pixel-to-pixel variation inside a bar while the bar edges stay sharp;
// Motion blur smears a horizontal edge; Sketch turns flat bars to near
// white with dark edges; Halftone leaves only white paper and dots.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const id = await page.evaluate(async () => {
    const api = window.videoEditor;
    const [img] = await api.import([{ name: "color-bars.png", src: location.origin + "/fixtures/media/color-bars.png" }]);
    api.exec("add_media_clip", { asset_id: img.id, start: 0, duration: 3 });
    return api.describe().tracks.flatMap((t) => t.clips)[0].id;
  });
  const shot = (effects) =>
    page.evaluate(async ({ id, effects }) => {
      const api = window.videoEditor;
      const clip = () => api.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id);
      for (const fx of clip().effects) api.exec("edit_effects", { clip_id: id, action: "remove", effect_id: fx.id });
      for (const [type, params] of effects) {
        api.exec("add_effect", { clip_id: id, type });
        const fx = clip().effects.at(-1);
        for (const [k, v] of Object.entries(params)) api.exec("set_param", { clip_ids: [id], path: `effects.${fx.id}.${k}`, value: v });
      }
      api.seek(10);
      await new Promise((r) => setTimeout(r, 50));
      await api.rendered();
      const px = api.pixels(480);
      return { w: px.width, h: px.height, data: Array.from(px.data) };
    }, { id, effects });
  const at = (s, x, y) => {
    const i = (Math.floor(y * s.h) * s.w + Math.floor(x * s.w)) * 4;
    return [s.data[i], s.data[i + 1], s.data[i + 2]];
  };
  // Variation inside the white bar (x 2-10%, y 10-40%): neighbor differences.
  const roughness = (s) => {
    let sum = 0, n = 0;
    for (let y = Math.floor(s.h * 0.1); y < s.h * 0.4; y++)
      for (let x = Math.floor(s.w * 0.02); x < s.w * 0.1; x++) {
        const i = (y * s.w + x) * 4;
        sum += Math.abs(s.data[i] - s.data[i + 4]) + Math.abs(s.data[i + 1] - s.data[i + 5]);
        n++;
      }
    return sum / n;
  };
  // Width of the white/yellow... edge: how many pixels change across x=1/8.
  const edgeWidth = (s, row = 0.25) => {
    const y = row;
    let k = 0;
    for (let x = 0.1; x < 0.15; x += 1 / s.w) {
      const a = at(s, x, y), b = at(s, x + 1 / s.w, y);
      if (Math.abs(a[2] - b[2]) > 4) k++;
    }
    return k;
  };
  const details = {};
  const noisy = await shot([["grain", { amount: 70, size: 1 }]]);
  const cleaned = await shot([["grain", { amount: 70, size: 1 }], ["denoise", { amount: 80 }]]);
  details.denoise = { ok: roughness(cleaned) < roughness(noisy) * 0.6 && edgeWidth(cleaned) <= edgeWidth(noisy) + 2, rough: [roughness(noisy), roughness(cleaned)], edges: [edgeWidth(noisy), edgeWidth(cleaned)] };
  const plain = await shot([]);
  const blurred = await shot([["motionBlur", { amount: 60, angle: 0 }]]);
  details.motionBlur = { ok: edgeWidth(blurred) > edgeWidth(plain) + 4, edges: [edgeWidth(plain), edgeWidth(blurred)] };
  const sketch = await shot([["sketch", { amount: 50, mix: 100 }]]);
  const inside = at(sketch, 0.3, 0.25), edge = Math.min(...[0.124, 0.125, 0.126, 0.127].map((x) => at(sketch, x, 0.25)[0]));
  details.sketch = { ok: inside.every((v) => v > 200) && edge < 200, inside, edge };
  const half = await shot([["halftone", { size: 10 }]]);
  details.halftone = { ok: !half.data.every((v, i) => i % 4 === 3 || Math.abs(v - plain.data[i]) < 3), sample: at(half, 0.55, 0.25) };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
