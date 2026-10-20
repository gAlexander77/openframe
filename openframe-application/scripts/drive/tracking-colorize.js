// Tracked titles and colorize (ADR-105), measured in the real engine:
// - a centered NORTHBOUND tracked 34 at 1080p sits on the canvas center
//   (it drew 16 px left: the canvas centered the spacing after the last
//   letter), within 2 px of where the untracked title sits, in the still
//   the export path draws, in the viewer's own pixels and in an exported
//   MP4 decoded with ffmpeg;
// - a white picture colorized #ffb347 turns amber (warming it with
//   temperature 80 leaves it white), a keyed amount is halfway at the half,
//   and an adjustment clip colorizes what is under it;
// - the Adjust tab has a Colorize section whose switch runs set_colorize.
// Needs ffmpeg on PATH (it shells out); the export lands in scratch/.
async (page) => {
  const { execFileSync } = await import("node:child_process");
  const fs = await import("node:fs");
  const path = await import("node:path");
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  const ids = await page.evaluate(() => {
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
    // 0-1 s: the tracked title; 1-2 s: the same untracked.
    call("add_text", { text: "NORTHBOUND", start: 0, duration: 1, style: { size: 120, weight: 900, letterSpacing: 34 } });
    added();
    call("add_text", { text: "NORTHBOUND", start: 1, duration: 1, style: { size: 120, weight: 900, letterSpacing: 0 } });
    added();
    // 2-5 s: a white picture (a solid at half size) over gray.
    call("add_color_clip", { color: "#808080", start: 2, duration: 3, track_id: main });
    added();
    call("add_color_clip", { color: "#ffffff", start: 2, duration: 1 });
    const warmed = added().id;
    call("set_param", { clip_ids: [warmed], path: "transform.scale", value: 0.5 });
    call("set_param", { clip_ids: [warmed], path: "adjust.temperature", value: 80 });
    call("add_color_clip", { color: "#ffffff", start: 3, duration: 1 });
    const tinted = added().id;
    call("set_param", { clip_ids: [tinted], path: "transform.scale", value: 0.5 });
    call("set_colorize", { clip_ids: [tinted], color: "#ffb347" });
    call("add_keyframe", { clip_id: tinted, path: "adjust.colorize.amount", at: 3, value: 0 });
    call("add_keyframe", { clip_id: tinted, path: "adjust.colorize.amount", at: 3.8, value: 1 });
    // 4-5 s: a white picture under an adjustment clip that colorizes cyan.
    call("add_color_clip", { color: "#ffffff", start: 4, duration: 1 });
    const under = added().id;
    call("set_param", { clip_ids: [under], path: "transform.scale", value: 0.5 });
    // On a track of its own above everything (a new video track stacks on top).
    const before = new Set(v.project().tracks.map((t) => t.id));
    call("add_track", { kind: "video" });
    const top = v.project().tracks.find((t) => !before.has(t.id)).id;
    call("add_adjustment_clip", { start: 4, duration: 1, track_id: top });
    const adj = added().id;
    call("set_colorize", { clip_ids: [adj], color: "#00e5ff" });
    // 5-6 s: a fresh white picture for the inspector's switch.
    call("add_color_clip", { color: "#ffffff", start: 5, duration: 1, track_id: main });
    const fresh = added().id;
    return { warmed, tinted, fresh };
  });

  /** Frame `frame` as the export draws it: the ink's columns on row band
   * 480..600 (the title's middle) and the pixels asked for. */
  const still = (frame) =>
    page.evaluate(async (frame) => {
      const s = await window.videoEditor.still(frame);
      const bmp = await createImageBitmap(await (await fetch(s.url)).blob());
      URL.revokeObjectURL(s.url);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext("2d");
      g.drawImage(bmp, 0, 0);
      const img = g.getImageData(0, 0, bmp.width, bmp.height);
      let lo = 1e9, hi = -1;
      for (let y = 480; y < 600; y += 2) for (let x = 0; x < img.width; x++) if (img.data[(y * img.width + x) * 4] > 128) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
      const px = (x, y) => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)];
      return { inkCenter: (lo + hi + 1) / 2, lo, hi, center: px(960, 540), corner: px(100, 100) };
    }, frame);
  const near = (c, want, tol = 6) => c.every((v, i) => Math.abs(v - want[i]) <= tol);
  const details = {};

  const tracked = await still(15), flat = await still(45);
  details.trackedCentered = { ok: Math.abs(tracked.inkCenter - 960) <= 3 && Math.abs(tracked.inkCenter - flat.inkCenter) <= 2, tracked: tracked.inkCenter, untracked: flat.inkCenter, ink: [tracked.lo, tracked.hi] };

  // Warming white leaves it white; colorizing makes it amber (#ffb347 is
  // 255, 179, 71); half the keyed amount (3.4 s) is halfway.
  const warm = await still(75), amber = await still(117), half = await still(102), cyan = await still(135);
  details.warmingWhite = { ok: warm.center[2] > 200, center: warm.center };
  details.colorized = { ok: near(amber.center, [255, 179, 71]) && near(amber.corner, [128, 128, 128]), center: amber.center, corner: amber.corner };
  details.keyedHalf = { ok: near(half.center, [255, 217, 163], 10), center: half.center };
  // The adjustment clip colorizes white to cyan and the gray to half cyan.
  details.adjustmentLayer = { ok: near(cyan.center, [0, 229, 255]) && near(cyan.corner, [0, 115, 128], 10), center: cyan.center, corner: cyan.corner };

  // Preview: the viewer's own pixels at the tracked title.
  await page.evaluate(() => window.videoEditor.seek(15));
  await page.evaluate(() => window.videoEditor.rendered());
  const view = await page.evaluate(() => {
    const { width, height, data } = window.videoEditor.pixels(1920);
    let lo = 1e9, hi = -1;
    for (let y = Math.round(height * 0.44); y < Math.round(height * 0.56); y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4] > 128) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    return { width, inkCenter: (lo + hi + 1) / 2 };
  });
  details.preview = { ok: Math.abs(view.inkCenter - view.width / 2) <= 2, ...view };

  // Export: the first second as an MP4, frame 15 decoded with ffmpeg.
  const outDir = path.join(process.cwd(), "scratch");
  fs.mkdirSync(outDir, { recursive: true });
  const b64 = await page.evaluate(async () => {
    const r = await window.videoEditor.render({ start: 0, end: 1 });
    const buf = new Uint8Array(await (await fetch(r.url)).arrayBuffer());
    URL.revokeObjectURL(r.url);
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const file = path.join(outDir, "export-tracking.mp4");
  fs.writeFileSync(file, Buffer.from(b64, "base64"));
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-vf", "select=eq(n\\,15)", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 28 });
  let lo = 1e9, hi = -1;
  for (let y = 480; y < 600; y += 2) for (let x = 0; x < 1920; x++) if (raw[(y * 1920 + x) * 3] > 128) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
  details.exported = { ok: Math.abs((lo + hi + 1) / 2 - 960) <= 3, inkCenter: (lo + hi + 1) / 2 };

  // The inspector: the Adjust tab's Colorize switch colorizes the clip.
  await page.evaluate((id) => window.videoEditor.select([id]), ids.fresh);
  const inspector = page.locator(".inspector-panel");
  await inspector.getByRole("tab", { name: "Adjust", exact: true }).click();
  const basic = inspector.getByRole("radio", { name: "Basic", exact: true });
  if (await basic.count()) await basic.click();
  const section = inspector.locator(".insp-section", { hasText: "Colorize" });
  await section.getByRole("switch", { name: "Colorize" }).click();
  const set = await page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).adjust.colorize, ids.fresh);
  await page.screenshot({ path: "scratch/drive-shots/tracking-colorize-inspector.png" });
  details.inspector = { ok: !!set && set.color === "#ffb347" && set.amount === 1 && (await section.locator(".color-input").count()) === 1, colorize: set };

  details.noErrors = { ok: !errors.some((x) => /shader|program|WebGL/i.test(x)), errors: errors.slice(0, 5) };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
