// Soft light, weights, animated type and drop shadows (ADR-069 to ADR-071),
// measured in frames the export path renders at 1080p:
// - a 300-pixel blur (amount 500) of a white half-canvas falls off like a
//   Gaussian of sigma 150, with no visible step, and spreads five times
//   wider than the old maximum (100);
// - a radial gradient runs linearly from its center to its rim;
// - a feathered box's edge is a Gaussian of sigma a quarter of the feather;
// - a title at weight 300 and at 800 draws differently (more ink, wider);
// - keyed letter spacing and size widen a title over time, and a keyed
//   color turns it red;
// - a rounded compound window casts a shadow below it, offset and soft,
//   with rounded corners;
// - the Text tab lists the font's weights, and the window's Video tab has
//   a Shadow section.
// Then it builds a "floating window on soft glow" scene with only these
// tools and screenshots a contact sheet of it (scratch/soft-light.png).
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  const ids = await page.evaluate(async () => {
    const v = window.videoEditor;
    const call = (name, args) => v.exec(name, args);
    const clips = () => v.project().tracks.flatMap((t) => t.clips);
    const seen = new Set();
    const added = () => {
      const c = clips().find((x) => !seen.has(x.id));
      seen.add(c.id);
      return c;
    };
    call("set_project", { width: 1920, height: 1080, background: "#000000" });
    const main = v.project().tracks.find((t) => t.main).id;
    const [photo] = await v.import([{ name: "photo.jpg", src: location.origin + "/fixtures/media/photo.jpg" }]);
    // 0-1 s: the left half white, blurred 500; 1-2 s: the same at 100.
    for (const [start, amount] of [[0, 500], [1, 100]]) {
      call("add_shape", { kind: "rectangle", start, duration: 1, x: -0.25, width: 0.5, height: 2, color: "#ffffff" });
      call("add_effect", { clip_id: added().id, type: "blur", params: { amount } });
    }
    // 2-3 s: a circle 576 px across, radial white to transparent.
    call("add_shape", { kind: "ellipse", start: 2, duration: 1, width: 0.3, height: 576 / 1080, gradient: { kind: "radial", from: "#ffffff", to: "#ffffff00" } });
    added();
    // 3-4 s: a white box 768 px wide, feathered 200 px.
    call("add_shape", { kind: "rectangle", start: 3, duration: 1, width: 0.4, height: 0.4, color: "#ffffff", feather: 200 });
    added();
    // 4-5 s and 5-6 s: the same words at weight 300 and 800.
    for (const [start, weight] of [[4, 300], [5, 800]]) {
      call("add_text", { text: "Weight test", start, duration: 1, style: { font: "Segoe UI", size: 120, weight } });
      added();
    }
    // 6-8 s: tracking and size keyed out, white to red.
    call("add_text", { text: "TRACKING", start: 6, duration: 2, style: { font: "Segoe UI", size: 80, weight: 600 } });
    const tracking = added();
    call("animate_text_style", { clip_id: tracking.id, keys: [{ at: 6, letter_spacing: 0, size: 80, color: "#ffffff" }, { at: 7.5, letter_spacing: 40, size: 120, color: "#ff0000" }] });
    // 8-9 s: a gray ground; a window (the photo and a bar) as a compound
    // clip at half size in a rounded mask, with a shadow 60 px down.
    call("add_color_clip", { color: "#c0c0c0", start: 8, duration: 1, track_id: main });
    added();
    call("add_media_clip", { asset_id: photo.id, start: 8, duration: 1 });
    const shot = added();
    call("frame_clips", { clip_ids: [shot.id], mode: "fill" });
    call("add_shape", { kind: "rectangle", start: 8, duration: 1, y: -0.47, width: 1, height: 0.06, color: "#202028" });
    const bar = added();
    call("create_compound_clip", { clip_ids: [shot.id, bar.id] });
    const win = clips().find((c) => c.type === "compound");
    seen.add(win.id);
    call("set_param", { clip_ids: [win.id], path: "transform.scale", value: 0.5 });
    call("set_mask", { clip_ids: [win.id], shape: "rectangle", width: 1, height: 1, radius: 0.2 });
    call("set_shadow", { clip_ids: [win.id], color: "#000000", blur: 20, x: 0, y: 60, opacity: 1 });
    return { tracking: tracking.id, win: win.id, photo: photo.id, main };
  });

  /** Frame `frame` as the export draws it at 1080p, analyzed in the page. */
  const measure = (frame, fn) =>
    page.evaluate(
      async ({ frame, fn }) => {
        const v = window.videoEditor;
        const still = await v.still(frame);
        const bmp = await createImageBitmap(await (await fetch(still.url)).blob());
        URL.revokeObjectURL(still.url);
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext("2d");
        g.drawImage(bmp, 0, 0);
        const img = g.getImageData(0, 0, bmp.width, bmp.height);
        const px = (x, y) => {
          const i = (Math.round(y) * img.width + Math.round(x)) * 4;
          return [img.data[i], img.data[i + 1], img.data[i + 2]];
        };
        const lum = (x, y) => px(x, y)[0];
        return new Function("px", "lum", "img", `return (${fn})(px, lum, img);`)(px, lum, img);
      },
      { frame, fn: fn.toString() },
    );
  // Phi, the standard normal's CDF (Abramowitz-Stegun 26.2.17).
  const Phi = (z) => {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp((-z * z) / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  };
  const details = {};

  // A blur of 500: sigma 150 px. The row through the middle against the
  // Gaussian's step response.
  const row500 = await measure(15, (px, lum) => Array.from({ length: 1920 }, (_, x) => lum(x, 540)));
  const row100 = await measure(45, (px, lum) => Array.from({ length: 1920 }, (_, x) => lum(x, 540)));
  const expect500 = (x) => 255 * (1 - Phi((x - 960) / 150));
  const worst500 = Math.max(...[660, 810, 900, 960, 1020, 1110, 1260].map((x) => Math.abs(row500[x] - expect500(x))));
  let step = 0, rises = 0;
  for (let x = 400; x < 1600; x++) {
    step = Math.max(step, Math.abs(row500[x] - row500[x - 1]));
    if (row500[x] > row500[x - 1] + 2) rises++;
  }
  // 10% to 90%: 2.56 sigma, 384 px at 500 and 77 px at 100.
  const width = (row) => row.findIndex((v) => v < 0.1 * 255) - row.findIndex((v) => v < 0.9 * 255);
  details.blur300 = {
    ok: worst500 < 12 && step <= 3 && rises === 0 && Math.abs(width(row500) - 384) < 40 && width(row500) > 4 * width(row100),
    worst500: Math.round(worst500),
    largestStep: step,
    rises,
    width10to90: [width(row500), width(row100)],
    samples: [660, 810, 960, 1110, 1260].map((x) => [x, row500[x], Math.round(expect500(x))]),
  };

  // Radial: white at the center, 288 px to transparent, linear between.
  const radial = await measure(75, (px, lum) => [0, 72, 144, 216, 280, 300].map((d) => lum(960 + d, 540)));
  const wantRadial = [0, 72, 144, 216, 280].map((d) => 255 * (1 - d / 288));
  details.radialGradient = { ok: radial.slice(0, 5).every((v, i) => Math.abs(v - wantRadial[i]) < 10) && radial[5] < 3, got: radial, want: wantRadial.map(Math.round) };

  // Feather 200: the box's left edge at x 576, sigma 50.
  const feather = await measure(105, (px, lum) => [376, 476, 526, 576, 626, 676, 776, 960].map((x) => lum(x, 540)));
  const featherX = [376, 476, 526, 576, 626, 676, 776, 960];
  const wantFeather = featherX.map((x) => 255 * Phi((x - 576) / 50));
  details.feather = { ok: feather.every((v, i) => Math.abs(v - wantFeather[i]) < 10), got: feather, want: wantFeather.map(Math.round) };

  // Weights: ink and width of the same words at 300 and 800.
  const inkOf = (px, lum, img) => {
    let ink = 0, left = 1920, right = 0;
    for (let y = 400; y < 680; y++)
      for (let x = 0; x < 1920; x++) {
        const l = img.data[(y * img.width + x) * 4];
        ink += l;
        if (l > 128) [left, right] = [Math.min(left, x), Math.max(right, x)];
      }
    return { ink, width: right - left };
  };
  const light = await measure(135, inkOf);
  const heavy = await measure(165, inkOf);
  details.weights = { ok: heavy.ink > light.ink * 1.4 && heavy.width > light.width, light, heavy };

  // Tracking: the title widens over time and ends red.
  const band = (px, lum, img) => {
    let left = 1920, right = 0;
    for (let y = 440; y < 640; y++)
      for (let x = 0; x < 1920; x++) if (img.data[(y * img.width + x) * 4] > 128) [left, right] = [Math.min(left, x), Math.max(right, x)];
    // The color in the middle of the most-inked column run, as a sample.
    let red = null;
    for (let y = 500; y < 580 && !red; y++) for (let x = left; x <= right && !red; x++) { const c = px(x, y); if (c[0] > 200) red = c; }
    return { width: right - left, sample: red };
  };
  const t0 = await measure(180, band);
  const t1 = await measure(202, band);
  const t2 = await measure(225, band);
  details.animatedText = {
    ok: t0.width < t1.width && t1.width < t2.width && t2.width > t0.width * 1.8 && t0.sample[1] > 200 && t2.sample[1] < 40 && t2.sample[2] < 40,
    widths: [t0.width, t1.width, t2.width],
    colors: [t0.sample, t2.sample],
  };

  // The shadow: window x 480..1440, y 270..810; its shadow 60 px lower.
  const shadow = await measure(255, (px, lum) => ({
    above: lum(960, 250),
    belowWindow: lum(960, 830),
    edge: lum(960, 870),
    past: lum(960, 900),
    mid: lum(960, 860),
    corner: lum(490, 860),
    side: lum(1460, 600),
  }));
  const dark = (v) => 192 - v;
  details.shadow = {
    ok: Math.abs(shadow.above - 192) < 4 && shadow.belowWindow < 30 && Math.abs(shadow.edge - 96) < 25 && shadow.past > 180 && dark(shadow.corner) < 0.5 * dark(shadow.mid) && shadow.side > 185,
    ...shadow,
  };

  // The inspector: Segoe UI lists several weights; the window has Shadow.
  await page.evaluate((id) => window.videoEditor.select([id]), ids.tracking);
  const weights = await page.locator('select[aria-label="Font weight"] option').allTextContents();
  await page.evaluate((id) => window.videoEditor.select([id]), ids.win);
  const shadowSection = await page.locator(".insp-section", { hasText: "Shadow" }).count();
  details.inspector = { ok: weights.length >= 3 && shadowSection > 0, weights, shadowSection };

  // The scene: a dark ground, two big soft glows, a floating window with a
  // shadow, a heavy title over a light line whose tracking opens.
  await page.evaluate(async (ids) => {
    const v = window.videoEditor;
    const call = (name, args) => v.exec(name, args);
    const clips = () => v.project().tracks.flatMap((t) => t.clips);
    const before = new Set(clips().map((c) => c.id));
    const fresh = () => clips().filter((c) => !before.has(c.id) && (before.add(c.id), true))[0];
    call("add_color_clip", { color: "#07060d", start: 9, duration: 3, track_id: ids.main });
    fresh();
    call("add_shape", { kind: "ellipse", start: 9, duration: 3, x: -0.22, y: -0.12, width: 0.7, height: 1.1, gradient: { kind: "radial", from: "#6a4dffcc", to: "#6a4dff00" }, feather: 200 });
    const glowA = fresh();
    call("add_effect", { clip_id: glowA.id, type: "blur", params: { amount: 300 } });
    call("add_keyframe", { clip_id: glowA.id, path: "transform.x", at: 9, value: -0.26 });
    call("add_keyframe", { clip_id: glowA.id, path: "transform.x", at: 12, value: -0.16 });
    call("add_shape", { kind: "ellipse", start: 9, duration: 3, x: 0.28, y: 0.2, width: 0.55, height: 0.9, gradient: { kind: "radial", from: "#00d0ffaa", to: "#00d0ff00", radius: 0.9 }, feather: 160 });
    const glowB = fresh();
    call("add_effect", { clip_id: glowB.id, type: "blur", params: { amount: 400 } });
    call("add_media_clip", { asset_id: ids.photo, start: 9, duration: 3 });
    const shot = fresh();
    call("frame_clips", { clip_ids: [shot.id], mode: "fill" });
    call("add_shape", { kind: "rectangle", start: 9, duration: 3, y: -0.47, width: 1, height: 0.06, color: "#1b1b24" });
    const bar = fresh();
    call("create_compound_clip", { clip_ids: [shot.id, bar.id], name: "Window" });
    const win = clips().find((c) => c.type === "compound" && c.id !== ids.win);
    before.add(win.id);
    call("set_param", { clip_ids: [win.id], path: "transform.scale", value: 0.5 });
    call("set_param", { clip_ids: [win.id], path: "transform.x", value: 0.2 });
    call("add_keyframe", { clip_id: win.id, path: "transform.y", at: 9, value: 0.08, ease: "easeOut" });
    call("add_keyframe", { clip_id: win.id, path: "transform.y", at: 10, value: 0.02 });
    call("set_mask", { clip_ids: [win.id], shape: "rectangle", width: 1, height: 1, radius: 0.08 });
    call("set_shadow", { clip_ids: [win.id], blur: 110, y: 44, opacity: 0.75 });
    call("add_text", { text: "Edit at the\nspeed of thought.", start: 9, duration: 3, y: -0.06, style: { font: "Segoe UI", size: 78, weight: 800, align: "left" } });
    const title = fresh();
    call("align_clips", { clip_ids: [title.id], align: "left", margin: 0.06 });
    call("add_text", { text: "OPEN SOURCE  ·  AI BUILT IN", start: 9, duration: 3, y: 0.12, style: { font: "Segoe UI", size: 28, weight: 300, color: "#c9c6ff", align: "left" } });
    const sub = fresh();
    call("align_clips", { clip_ids: [sub.id], align: "left", margin: 0.06 });
    call("animate_text_style", { clip_id: sub.id, keys: [{ at: 9, letter_spacing: 0, ease: "easeOut" }, { at: 10.5, letter_spacing: 5 }] });
  }, ids);
  const sheet = await page.evaluate(async () => {
    const v = window.videoEditor;
    const frames = [272, 290, 315, 350];
    const pics = [];
    for (const f of frames) {
      const still = await v.still(f);
      pics.push(await createImageBitmap(await (await fetch(still.url)).blob()));
      URL.revokeObjectURL(still.url);
    }
    const w = 780, h = 439, gap = 6;
    const c = new OffscreenCanvas(gap + 2 * (w + gap), gap + 2 * (h + gap));
    const g = c.getContext("2d");
    g.fillStyle = "#1e1e1e";
    g.fillRect(0, 0, c.width, c.height);
    pics.forEach((b, i) => g.drawImage(b, gap + (i % 2) * (w + gap), gap + Math.floor(i / 2) * (h + gap), w, h));
    const url = URL.createObjectURL(await c.convertToBlob({ type: "image/png" }));
    const img = document.createElement("img");
    img.id = "soft-light-sheet";
    img.src = url;
    Object.assign(img.style, { position: "fixed", left: "0", top: "0", zIndex: "99999" });
    document.body.append(img);
    await img.decode();
    return { width: c.width, height: c.height };
  });
  await page.screenshot({ path: "__REPO__/scratch/soft-light.png", clip: { x: 0, y: 0, width: sheet.width, height: sheet.height } });
  await page.evaluate(() => document.getElementById("soft-light-sheet")?.remove());

  // The left-aligned subline tracks out from its left edge (rows around
  // y 0.12 of the canvas): the edge holds while the line gets wider.
  const lineEdges = (px, lum, img) => {
    let left = 1920, right = 0;
    for (let y = 640; y < 700; y++)
      for (let x = 0; x < 840; x++) if (img.data[(y * img.width + x) * 4] > 150) [left, right] = [Math.min(left, x), Math.max(right, x)];
    return { left, right };
  };
  const [early, late] = [await measure(271, lineEdges), await measure(330, lineEdges)];
  details.alignedGrowth = { ok: Math.abs(early.left - late.left) <= 3 && late.right - late.left > early.right - early.left + 40, early, late };

  details.noErrors = { ok: !errors.some((e) => /shader|program|WebGL/i.test(e)), errors: errors.slice(0, 5) };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
