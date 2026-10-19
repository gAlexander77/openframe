// Kinetic typography and the ad looks: a typewriter types its letters left
// to right behind a caret, a word pop brings words in one at a time, a
// rise by word (any animation per unit) and a highlight sweep draw where
// they should half way through, and the exported still of the same frame
// shows the same thing as the viewer (one raster for both). Then the look
// parts render: a gradient runs red to blue across a title, a glow lights
// the pixels around white letters, a second outline shows its color. The
// inspector offers the kinetic presets on a title only, and their Text
// motion controls.
// Screenshots: scratch/kinetic-*.png.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  page.setDefaultTimeout(8000);
  const details = {};

  // Column profiles of the frame: in each of 24 columns, the share of the
  // middle band's pixels that pass a color test.
  await page.evaluate(() => {
    const tests = {
      ink: (r, g, b) => Math.abs(r - 0x22) + Math.abs(g - 0x33) + Math.abs(b - 0x44) > 120,
      yellow: (r, g, b) => r > 200 && g > 160 && b < 130,
      red: (r, g, b) => r > 140 && r > b + 60,
      blue: (r, g, b) => b > 140 && b > r + 60,
      green: (r, g, b) => g > 90 && g > r + 40 && g > b + 40,
      magenta: (r, g, b) => r > 170 && b > 170 && g < 100,
    };
    const profile = ({ width, height, data }, test) => {
      const cols = new Array(24).fill(0);
      const y0 = Math.floor(height * 0.3), y1 = Math.floor(height * 0.7);
      for (let y = y0; y < y1; y++)
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          if (tests[test](data[i], data[i + 1], data[i + 2])) cols[Math.min(23, Math.floor((x / width) * 24))]++;
        }
      const per = ((y1 - y0) * width) / 24;
      return cols.map((c) => +(c / per).toFixed(4));
    };
    window.__profile = async (frame, test) => {
      const v = window.videoEditor;
      v.seek(frame);
      await new Promise((r) => setTimeout(r, 40));
      await v.rendered();
      return profile(v.pixels(), test);
    };
    window.__stillProfile = async (frame, test) => {
      const { url } = await window.videoEditor.still(frame, "720p");
      const bmp = await createImageBitmap(await (await fetch(url)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext("2d");
      g.drawImage(bmp, 0, 0);
      return profile({ width: c.width, height: c.height, data: g.getImageData(0, 0, c.width, c.height).data }, test);
    };
  });
  const sum = (a, from = 0, to = a.length) => a.slice(from, to).reduce((s, v) => s + v, 0);
  const shot = (name) => page.screenshot({ path: `__REPO__/scratch/kinetic-${name}.png` });

  // ---- a typewriter, half way ------------------------------------------------------
  const ids = await page.evaluate(() => {
    const v = window.videoEditor;
    v.exec("add_color_clip", { color: "#223344", start: 0, duration: 20 });
    v.exec("add_text", { text: "TYPEWRITER TITLE", start: 0, duration: 4, style: { size: 130 } });
    const clips = () => v.project().tracks.flatMap((t) => t.clips);
    const text = clips().find((c) => c.type === "text").id;
    v.exec("set_animation", { clip_id: text, slot: "in", type: "typewriter", duration: 2 });
    return { text, color: clips().find((c) => c.type === "color").id };
  });
  // 60 frames of typing; frame 30 is half of the 15 letters.
  const half = await page.evaluate(() => window.__profile(30, "ink"));
  const full = await page.evaluate(() => window.__profile(90, "ink"));
  await shot("typewriter");
  const firstInk = full.findIndex((v) => v > 0), lastInk = 23 - [...full].reverse().findIndex((v) => v > 0);
  const mid = Math.round((firstInk + lastInk) / 2);
  details.typewriter = {
    ok: sum(half, firstInk, mid - 1) > 0.5 * sum(full, firstInk, mid - 1) && sum(half, mid + 2, lastInk + 1) < 0.05 * sum(full, mid + 2, lastInk + 1),
    half,
    full,
  };
  const still = await page.evaluate(() => window.__stillProfile(30, "ink"));
  details.exportAgrees = {
    ok: sum(still, mid + 2, lastInk + 1) < 0.05 * sum(full, mid + 2, lastInk + 1) && Math.abs(sum(still) - sum(half)) < 0.3 * sum(half),
    still: sum(still),
    viewer: sum(half),
  };
  // Settled, the title rasterizes as a still: same size as before typing.
  details.settledRaster = { ok: (await page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).animIn.type, ids.text)) === "typewriter" };

  // ---- word pop, rise by word -----------------------------------------------------
  await page.evaluate((id) => {
    const v = window.videoEditor;
    v.exec("set_text", { clip_id: id, text: "ONE TWO THREE" });
    v.exec("set_animation", { clip_id: id, slot: "in", type: "wordPop", duration: 1.5 });
  }, ids.text);
  // 45 frames; at 18 (t = 0.4) the first word is in, the third not yet.
  const popFull = await page.evaluate(() => window.__profile(90, "ink"));
  const pop = await page.evaluate(() => window.__profile(18, "ink"));
  await shot("wordpop");
  const pf = popFull.findIndex((v) => v > 0), pl = 23 - [...popFull].reverse().findIndex((v) => v > 0);
  const third = Math.round((pl - pf + 1) / 3);
  details.wordPop = { ok: sum(pop, pf, pf + third) > 0.3 * sum(popFull, pf, pf + third) && sum(pop, pl - third + 2, pl + 1) < 0.05 * sum(popFull, pl - third + 2, pl + 1), pop, popFull };
  await page.evaluate((id) => window.videoEditor.exec("set_animation", { clip_id: id, slot: "in", type: "rise", unit: "word", stagger: 1, order: "backward", duration: 1.5 }), ids.text);
  const rise = await page.evaluate(() => window.__profile(12, "ink"));
  details.riseByWordBackward = { ok: sum(rise, pl - third + 1, pl + 1) > 0.15 * sum(popFull, pl - third + 1, pl + 1) && sum(rise, pf, pf + third - 1) < 0.05 * sum(popFull, pf, pf + third - 1), rise };

  // ---- highlight sweep --------------------------------------------------------------
  await page.evaluate((id) => {
    const v = window.videoEditor;
    v.exec("set_text", { clip_id: id, text: "HIGHLIGHT THIS", style: { color: "#111111" } });
    v.exec("set_animation", { clip_id: id, slot: "in", type: "highlightSweep", duration: 1 });
  }, ids.text);
  const sweepHalf = await page.evaluate(() => window.__profile(15, "yellow"));
  const sweepFull = await page.evaluate(() => window.__profile(60, "yellow"));
  await shot("highlight");
  const sf = sweepFull.findIndex((v) => v > 0), sl = 23 - [...sweepFull].reverse().findIndex((v) => v > 0);
  const sm = Math.round((sf + sl) / 2);
  details.highlightSweep = { ok: sum(sweepFull) > 1 && sum(sweepHalf, sf, sm - 1) > 0.6 * sum(sweepFull, sf, sm - 1) && sum(sweepHalf, sm + 2, sl + 1) < 0.05 * sum(sweepFull, sm + 2, sl + 1), sweepHalf, sweepFull };

  // ---- gradient, glow, second outline ---------------------------------------------------
  await page.evaluate((id) => {
    const v = window.videoEditor;
    v.exec("set_animation", { clip_id: id, slot: "in", type: "none" });
    v.exec("set_text", { clip_id: id, text: "GRADIENT", style: { size: 200, color: "#ffffff", gradient: { from: "#ff0000", to: "#0000ff", angle: 0 } } });
  }, ids.text);
  const red = await page.evaluate(() => window.__profile(60, "red"));
  const blue = await page.evaluate(() => window.__profile(60, "blue"));
  await shot("gradient");
  details.gradient = { ok: sum(red, 0, 12) > 3 * sum(red, 12) && sum(blue, 12) > 3 * sum(blue, 0, 12) && sum(red) > 0.3 && sum(blue) > 0.3, red: sum(red), blue: sum(blue) };
  await page.evaluate((id) => window.videoEditor.exec("set_text", { clip_id: id, text: "GLOW", style: { gradient: { from: "", to: "" }, glow: { color: "#00ff44", blur: 40, strength: 2 } } }), ids.text);
  const glow = await page.evaluate(() => window.__profile(60, "green"));
  await shot("glow");
  details.glow = { ok: sum(glow) > 0.3, glow: sum(glow) };
  await page.evaluate((id) => window.videoEditor.exec("set_text", { clip_id: id, text: "STICKER", style: { glow: { color: "" }, stroke: { color: "#000000", width: 8 }, stroke2: { color: "#ff00ff", width: 12 } } }), ids.text);
  const mag = await page.evaluate(() => window.__profile(60, "magenta"));
  await shot("outline2");
  details.secondOutline = { ok: sum(mag) > 0.3, magenta: sum(mag) };

  // ---- the inspector ------------------------------------------------------------------
  const insp = page.getByRole("region", { name: "Inspector" });
  await page.evaluate((id) => window.videoEditor.select([id]), ids.color);
  await insp.getByRole("tab", { name: "Animation", exact: true }).click();
  const colorTiles = await page.locator(".anim-tile", { hasText: "Typewriter" }).count();
  await page.evaluate((id) => window.videoEditor.select([id]), ids.text);
  await insp.getByRole("tab", { name: "Animation", exact: true }).click();
  await page.locator(".anim-tile", { hasText: "Word pop" }).click();
  const motion = await page.locator(".insp-section", { hasText: "Text motion" }).count();
  await page.getByRole("slider", { name: "Stagger" }).fill("0.2");
  const after = await page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).animIn, ids.text);
  await page.locator(".anim-tile", { hasText: /^Rise$/ }).click();
  const whole = await page.getByRole("radio", { name: "Whole" }).count();
  await page.waitForTimeout(300);
  await page.locator(".inspector-panel").screenshot({ path: "__REPO__/scratch/kinetic-inspector.png" });
  details.inspector = { ok: colorTiles === 0 && motion === 1 && after.type === "wordPop" && after.stagger === 0.2 && whole === 1, colorTiles, motion, after, whole };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
