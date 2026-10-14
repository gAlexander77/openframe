// Color drive: proves the grade on real pixels. Puts color bars on the
// timeline, applies each grade part through the commands, and compares the
// viewer with the CPU reference in src/lib (grade.ts, curves.ts, lut.ts):
// identity LUT unchanged, invert LUT inverted, HSL red touching only reds,
// curves and wheels moving the tones they should. Then checks the scopes'
// shapes on the viewer's own pixels, renders the same frame through a second
// compositor at another size the way export does, and screenshots the
// Scopes panel to scripts/drive/shots/color-scopes.png.
//
// Needs the dev server and fixtures (node scripts/make-fixtures.mjs). Run
// through the Playwright MCP tool `browser_run_code_unsafe` with filename
// "scripts/drive/color.js", or any Playwright page (already on the app's
// origin, or it opens :1420). Returns { ok, details }.
async (page) => {
  const origin = /^https?:/.test(page.url()) ? new URL(page.url()).origin : "http://localhost:1420";
  if (!/^https?:/.test(page.url())) await page.goto(origin);
  if (await page.getByText("Create project").isVisible().catch(() => false)) await page.getByText("Create project").click();
  await page.waitForFunction(() => !!window.videoEditor);

  const details = await page.evaluate(async (origin) => {
    const ve = window.videoEditor;
    // Modules the app already loaded resolve to the same instances (Vite may
    // have added ?t= to them); pure ones are fine either way.
    const urlOf = (path) => performance.getEntriesByType("resource").map((e) => e.name).find((n) => n.includes(path)) ?? path;
    const grade = await import("/src/lib/grade.ts");
    const curves = await import("/src/lib/curves.ts");
    const lutLib = await import("/src/lib/lut.ts");
    const scopes = await import("/src/lib/scopes.ts");
    const fixture = (n) => `${origin}/fixtures/media/${n}`;

    const [asset] = await ve.import([{ name: "color-bars.png", src: fixture("color-bars.png") }]);
    ve.exec("add_media_clip", { asset_id: asset.id, start: 0 });
    const clipId = ve.describe().tracks.flatMap((t) => t.clips).find((c) => c.asset === asset.id).id;
    const luts = await ve.importLuts(["identity-33.cube", "invert-17.cube", "sqrt-1d.cube"].map((n) => ({ name: n, src: fixture(n) })));
    const lutData = await Promise.all(luts.map(async (l) => lutLib.parseCube(await (await fetch(l.src)).text())));
    const settle = async () => {
      await new Promise((r) => setTimeout(r, 30));
      await ve.rendered();
    };
    const clip = () => ve.project().tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
    const reset = async () => {
      ve.exec("set_hsl", { clip_id: clipId, band: "all", reset: true });
      for (const ch of ["luma", "r", "g", "b"]) ve.exec("set_curve", { clip_id: clipId, channel: ch });
      for (const w of ["lift", "gamma", "gain", "offset"]) ve.exec("set_color_wheel", { clip_id: clipId, wheel: w, reset: true });
      ve.exec("apply_lut", { clip_id: clipId, lut_id: "none" });
      await settle();
    };

    await settle();
    const base = ve.pixels();
    const { width: W, height: H } = base;
    const at = (px, fx, fy) => {
      const i = (Math.floor(fy * H) * W + Math.floor(fx * W)) * 4;
      return [px.data[i], px.data[i + 1], px.data[i + 2]];
    };
    const BARS = ["white", "yellow", "cyan", "green", "magenta", "red", "blue", "black"];
    const bar = (px, i, row = 0.25) => at(px, (i + 0.5) / 8, row);
    const maxDiff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

    /** Worst channel error of the viewer against the CPU reference. */
    const againstReference = (px, lut, table) => {
      const params = grade.resolveGrade(ve.project(), clip(), 0);
      let worst = 0;
      for (let i = 0; i < px.data.length; i += 4) {
        const src = [base.data[i] / 255, base.data[i + 1] / 255, base.data[i + 2] / 255];
        const want = params ? grade.gradeRgb(src, params, lut, table) : src;
        for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(px.data[i + k] - want[k] * 255));
      }
      return +worst.toFixed(2);
    };

    const checks = [];
    const check = (name, ok, data) => checks.push({ name, ok, ...data });

    // LUTs
    for (const [i, name, tol] of [[0, "identity LUT changes nothing", 1], [1, "invert LUT inverts", 2], [2, "1D LUT follows its curve", 3]]) {
      ve.exec("apply_lut", { clip_id: clipId, lut_id: luts[i].id, intensity: 1 });
      await settle();
      const err = againstReference(ve.pixels(), lutData[i]);
      check(name, err <= tol, { maxError: err, tolerance: tol });
    }
    ve.exec("apply_lut", { clip_id: clipId, lut_id: luts[1].id, intensity: 0.5 });
    await settle();
    {
      const err = againstReference(ve.pixels(), lutData[1]);
      check("LUT intensity mixes", err <= 2, { maxError: err, gray: bar(ve.pixels(), 0) });
    }
    await reset();

    // HSL: only reds
    ve.exec("set_hsl", { clip_id: clipId, band: "red", saturation: -100 });
    await settle();
    {
      const px = ve.pixels();
      const red = bar(px, 5);
      const others = BARS.map((b, i) => [b, maxDiff(bar(px, i), bar(base, i)), maxDiff(bar(px, i, 0.6), bar(base, i, 0.6))]).filter(([b]) => b !== "red");
      const ramp = Math.max(...[0.1, 0.3, 0.5, 0.7, 0.9].map((fx) => maxDiff(at(px, fx, 0.9), at(base, fx, 0.9))));
      const err = againstReference(px);
      check("HSL red affects only reds", Math.abs(red[0] - red[1]) <= 2 && others.every(([, a, b]) => a <= 1 && b <= 1) && ramp <= 1 && err <= 2, {
        redBar: red,
        othersWorst: Math.max(...others.flatMap(([, a, b]) => [a, b])),
        rampWorst: ramp,
        maxError: err,
      });
    }
    await reset();

    // Curves: an S-curve darkens shadows and brightens highlights
    const S = [[0, 0], [0.25, 0.15], [0.75, 0.85], [1, 1]];
    ve.exec("set_curve", { clip_id: clipId, channel: "luma", points: S });
    await settle();
    {
      const px = ve.pixels();
      const lo = [at(base, 0.2, 0.9)[0], at(px, 0.2, 0.9)[0]];
      const hi = [at(base, 0.8, 0.9)[0], at(px, 0.8, 0.9)[0]];
      const err = againstReference(px, undefined, curves.bakeCurves({ luma: S }));
      check("S-curve darkens shadows, brightens highlights", lo[1] < lo[0] - 8 && hi[1] > hi[0] + 8 && err <= 2, { shadow: lo, highlight: hi, maxError: err });
    }
    ve.exec("set_curve", { clip_id: clipId, channel: "luma" });
    ve.exec("set_curve", { clip_id: clipId, channel: "r", points: [[0, 0], [1, 0.5]] });
    await settle();
    {
      const px = ve.pixels();
      const white = bar(px, 0, 0.6);
      check("red curve moves only red", Math.abs(white[0] - 128) <= 2 && white[1] >= 253 && white[2] >= 253, { white100: white });
    }
    await reset();

    // Wheels: lift tints shadows, white stays; gain lifts highlights, black stays
    ve.exec("set_color_wheel", { clip_id: clipId, wheel: "lift", hue: 240, amount: 40 });
    await settle();
    {
      const px = ve.pixels();
      const dark = at(px, 0.05, 0.9);
      const white = bar(px, 0, 0.6);
      const err = againstReference(px);
      check("lift tints shadows blue, leaves white", dark[2] - dark[0] > 25 && maxDiff(white, [255, 255, 255]) <= 1 && err <= 2, { shadow: dark, white100: white, maxError: err });
    }
    await reset();
    ve.exec("set_color_wheel", { clip_id: clipId, wheel: "gain", y: 30 });
    await settle();
    {
      const px = ve.pixels();
      const black = bar(px, 7);
      const gray = bar(px, 0);
      const err = againstReference(px);
      // gain y 30 scales by 1.3: 191 becomes 248
      check("gain brightens highlights, black stays", maxDiff(black, [0, 0, 0]) === 0 && Math.abs(gray[0] - 248) <= 1 && err <= 2, { black, gray75: gray, maxError: err });
    }
    await reset();

    // Scopes of the viewer's own pixels
    {
      const s = scopes.computeScopes(ve.pixels(320), 8, 129);
      const BAR_LUMA = [191, 177, 150, 137, 54, 41, 14, 0];
      // top half of each column: the 75% bar's level must be one of the column's levels
      const levels = BAR_LUMA.map((want, col) => {
        let best = 0;
        let bestLevel = -1;
        for (let l = 0; l < 256; l++) if (Math.abs(l - want) <= 2 && s.luma[l * 8 + col] > best) [best, bestLevel] = [s.luma[l * 8 + col], l];
        return bestLevel;
      });
      const targets = scopes.TARGETS.map((t) => {
        const [x, y] = scopes.vectorPoint(t.rgb.map((v) => v * 0.749), 129);
        let n = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) n += s.vector[(Math.round(y) + dy) * 129 + Math.round(x) + dx];
        return [t.label, n];
      });
      check("waveform shows the 75% staircase, vectorscope hits the 75% targets", levels.every((l) => l >= 0) && targets.every(([, n]) => n > 100), { staircase: levels, targetCounts: Object.fromEntries(targets) });
    }

    // Export path: a second compositor at another size, same plan
    ve.exec("set_hsl", { clip_id: clipId, band: "red", saturation: -100 });
    ve.exec("set_color_wheel", { clip_id: clipId, wheel: "lift", hue: 200, amount: 20 });
    ve.exec("apply_lut", { clip_id: clipId, lut_id: luts[1].id, intensity: 0.3 });
    await settle();
    {
      const P = await import(urlOf("/src/engine/player.ts"));
      const C = await import(urlOf("/src/engine/compositor.ts"));
      const { planFrame } = await import(urlOf("/src/lib/render/plan.ts"));
      const project = ve.project();
      const plan = planFrame(project, 0);
      const pool = new P.CursorPool();
      const resolved = await P.resolveSources(project, plan, pool);
      const comp = new C.Compositor(new OffscreenCanvas(2, 2));
      comp.resize(960, 540);
      comp.render(plan, P.sourceImages(resolved, 960, 540), project.background);
      const out = { width: 960, height: 540, data: comp.readPixels() };
      comp.dispose();
      pool.clear();
      const view = ve.pixels();
      const sample = (px, fx, fy) => {
        const i = (Math.floor(fy * px.height) * px.width + Math.floor(fx * px.width)) * 4;
        return [px.data[i], px.data[i + 1], px.data[i + 2]];
      };
      let worst = 0;
      for (let b = 0; b < 8; b++) for (const fy of [0.25, 0.6]) worst = Math.max(worst, maxDiff(sample(out, (b + 0.5) / 8, fy), sample(view, (b + 0.5) / 8, fy)));
      check("export-size render matches the viewer", worst <= 1, { worstBarDifference: worst });
    }
    await reset(); // plain bars for the scopes screenshot
    return checks;
  }, origin);

  // Scopes panel, for the eye
  const toggle = page.getByRole("button", { name: "Scopes", exact: true });
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  await page.waitForTimeout(500);
  await page.locator(".scopes-panel").screenshot({ path: "scripts/drive/shots/color-scopes.png" });
  const drawn = await page.evaluate(() =>
    [...document.querySelectorAll(".scopes-panel canvas")].map((c) => {
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let lit = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) lit++;
      return lit;
    }),
  );
  details.push({ name: "scopes panel draws all four", ok: drawn.length === 4 && drawn.every((n) => n > 50), litPixels: drawn });
  return { ok: details.every((d) => d.ok), details };
};
