// Borders on pictures (ADR-099), measured in the real engine three ways:
// the still the export path draws (what preview_frame shows), the viewer's
// own pixels (preview), and an exported MP4 decoded with ffmpeg.
// - a blue half-size picture with a rounded mask (corner radius 135 px)
//   gets a 20 px red border outside its edge: red beside each side, the
//   picture inside, the ground past it, and round at the corner (red on the
//   arc, the ground where a square frame's corner would be);
// - a quarter-size picture keeps the same 20 px border (it does not scale);
// - at half opacity the border fades with the picture;
// - a keyed width grows the border (20 px partway through its keys);
// - the shadow is cast by the picture and its border together;
// - a see-through picture (blue at 60%) shows the ground through itself,
//   not the border's red (ADR-108: the border filled it at 40%);
// - the Video tab has a Border section.
// Needs ffmpeg on PATH (it shells out); exports land in scratch/.
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
    // A gray ground under everything, 0-6 s.
    call("add_color_clip", { color: "#808080", start: 0, duration: 6, track_id: main });
    added();
    /** A blue picture (a solid at `scale`) with a rounded mask and a red border. */
    const framed = (start, scale, extra = {}) => {
      call("add_color_clip", { color: "#0000ff", start, duration: 1 });
      const c = added();
      call("set_param", { clip_ids: [c.id], path: "transform.scale", value: scale });
      call("set_mask", { clip_ids: [c.id], shape: "rectangle", width: 1, height: 1, radius: 0.5, feather: 0 });
      call("set_border", { clip_ids: [c.id], color: "#ff0000", width: 20, ...extra });
      return c.id;
    };
    const half = framed(0, 0.5);
    framed(1, 0.25);
    const faded = framed(2, 0.5);
    call("set_param", { clip_ids: [faded], path: "opacity", value: 0.5 });
    const keyed = framed(3, 0.5);
    call("add_keyframe", { clip_id: keyed, path: "border.width", at: 3, value: 0 });
    call("add_keyframe", { clip_id: keyed, path: "border.width", at: 3.9, value: 36 });
    const shadowed = framed(4, 0.5);
    call("set_shadow", { clip_ids: [shadowed], color: "#000000", blur: 0, x: 0, y: 40, opacity: 1 });
    // A see-through picture: its own pixels at 60%, the clip at full opacity.
    call("add_shape", { kind: "rectangle", start: 5, duration: 1, width: 0.5, height: 0.5, color: "#0000ff99" });
    call("set_border", { clip_ids: [added().id], color: "#ff0000", width: 20 });
    return { half, main };
  });

  // The picture: 960 x 540 centered (x 480..1440, y 270..810); its corners
  // round by half the shorter half side, 135 px.
  const probe = (px) => ({
    left: px(470, 540), // in the border, beside the left side
    inLeft: px(490, 540), // the picture
    pastLeft: px(452, 540), // past the border
    top: px(960, 260),
    pastTop: px(960, 244),
    arc: px(512, 302), // on the rounded corner's arc, 145 px from its center
    squareCorner: px(470, 260), // where a square frame's corner would be
  });
  /** Frame `frame` as the export draws it (a still). */
  const still = (frame) =>
    page.evaluate(
      async ({ frame, fn }) => {
        const v = window.videoEditor;
        const s = await v.still(frame);
        const bmp = await createImageBitmap(await (await fetch(s.url)).blob());
        URL.revokeObjectURL(s.url);
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext("2d");
        g.drawImage(bmp, 0, 0);
        const img = g.getImageData(0, 0, bmp.width, bmp.height);
        const px = (x, y) => {
          const i = (Math.round(y) * img.width + Math.round(x)) * 4;
          return [img.data[i], img.data[i + 1], img.data[i + 2]];
        };
        return new Function("px", `return (${fn})(px);`)(px);
      },
      { frame, fn: probe.toString() },
    );
  const near = (c, want, tol = 24) => c.every((v, i) => Math.abs(v - want[i]) <= tol);
  const RED = [255, 0, 0], BLUE = [0, 0, 255], GRAY = [128, 128, 128];
  const framedOk = (p) => near(p.left, RED) && near(p.inLeft, BLUE) && near(p.pastLeft, GRAY) && near(p.top, RED) && near(p.pastTop, GRAY) && near(p.arc, RED) && near(p.squareCorner, GRAY);
  const details = {};

  const a = await still(15);
  details.roundedBorder = { ok: framedOk(a), ...a };

  // A quarter-size picture (x 720..1200, y 405..675): still 20 px of red.
  const q = await page.evaluate(async () => {
    const s = await window.videoEditor.still(45);
    const bmp = await createImageBitmap(await (await fetch(s.url)).blob());
    URL.revokeObjectURL(s.url);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext("2d");
    g.drawImage(bmp, 0, 0);
    const row = g.getImageData(0, 540, bmp.width, 1).data;
    let red = 0;
    for (let x = 600; x < 720; x++) if (row[x * 4] > 200 && row[x * 4 + 1] < 60) red++;
    return { redRun: red };
  });
  details.notScaled = { ok: Math.abs(q.redRun - 20) <= 1, ...q };

  // Half opacity: red at half over gray (192, 64, 64), the picture at half.
  const f = await still(75);
  details.faded = { ok: near(f.left, [192, 64, 64], 16) && near(f.inLeft, [64, 64, 192], 16) && near(f.pastLeft, GRAY), left: f.left, inLeft: f.inLeft };

  // Keyed 0 to 36 px over 3-3.9 s: at 3.5 s, 20 px (frame 105).
  const k = await still(105);
  details.keyedWidth = { ok: near(k.left, RED) && near(k.pastLeft, GRAY), left: k.left, pastLeft: k.pastLeft };

  // The shadow falls 40 px down, hard: black below the border's bottom (y 830..870), not below the picture's (810).
  const s = await page.evaluate(async () => {
    const st = await window.videoEditor.still(135);
    const bmp = await createImageBitmap(await (await fetch(st.url)).blob());
    URL.revokeObjectURL(st.url);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext("2d");
    g.drawImage(bmp, 0, 0);
    const col = g.getImageData(960, 800, 1, 100).data;
    return { y815: [col[15 * 4], col[15 * 4 + 1], col[15 * 4 + 2]], y850: [col[50 * 4], col[50 * 4 + 1], col[50 * 4 + 2]], y880: [col[80 * 4], col[80 * 4 + 1], col[80 * 4 + 2]] };
  });
  details.shadowOfBoth = { ok: near(s.y815, RED) && near(s.y850, [0, 0, 0], 12) && near(s.y880, GRAY), ...s };

  // See-through: blue at 0.6 over gray is (51, 51, 204) inside, red around.
  // The border used to fill it at 40% too: (102, 0, 153), and its first
  // pixel inside the edge too.
  const t = await still(165);
  const { center, edge } = await page.evaluate(async () => {
    const st = await window.videoEditor.still(165);
    const bmp = await createImageBitmap(await (await fetch(st.url)).blob());
    URL.revokeObjectURL(st.url);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext("2d");
    g.drawImage(bmp, 0, 0);
    const at = (x, y) => [...g.getImageData(x, y, 1, 1).data.slice(0, 3)];
    return { center: at(960, 540), edge: at(481, 540) };
  });
  details.seeThrough = { ok: near(t.inLeft, [51, 51, 204], 12) && near(center, [51, 51, 204], 12) && near(edge, [51, 51, 204], 24) && near(t.left, RED) && near(t.pastLeft, GRAY), inLeft: t.inLeft, center, edge, left: t.left };

  // Preview: the viewer's own pixels at 0.5 s, scaled to its size.
  await page.evaluate(() => window.videoEditor.seek(15));
  await page.evaluate(() => window.videoEditor.rendered());
  const view = await page.evaluate((fn) => {
    const { width, height, data } = window.videoEditor.pixels(1920);
    const sx = width / 1920, sy = height / 1080;
    const px = (x, y) => {
      const i = (Math.round(y * sy) * width + Math.round(x * sx)) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };
    return { width, ...new Function("px", `return (${fn})(px);`)(px) };
  }, probe.toString());
  // The viewer may be smaller than 1080p: only the probes well inside each band.
  details.preview = { ok: near(view.left, RED, 40) && near(view.inLeft, BLUE, 40) && near(view.pastLeft, GRAY, 40) && near(view.arc, RED, 40) && near(view.squareCorner, GRAY, 40), ...view };

  // Export: the first second as an MP4, its frame 15 decoded with ffmpeg.
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
  const file = path.join(outDir, "export-borders.mp4");
  fs.writeFileSync(file, Buffer.from(b64, "base64"));
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-vf", "select=eq(n\\,15)", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 28 });
  const epx = (x, y) => {
    const i = (y * 1920 + x) * 3;
    return [raw[i], raw[i + 1], raw[i + 2]];
  };
  const e = probe(epx);
  // H.264 smears color at edges (4:2:0): probes stay a few pixels inside each band.
  details.exported = { ok: near(e.left, RED, 50) && near(e.inLeft, BLUE, 50) && near(e.pastLeft, GRAY, 30) && near(e.arc, RED, 50) && near(e.squareCorner, GRAY, 30), ...e };

  // The inspector: the Video tab has a Border section, on.
  await page.evaluate((id) => window.videoEditor.select([id]), ids.half);
  const section = await page.locator(".insp-section", { hasText: "Border" }).count();
  details.inspector = { ok: section > 0, section };

  details.noErrors = { ok: !errors.some((x) => /shader|program|WebGL/i.test(x)), errors: errors.slice(0, 5) };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
