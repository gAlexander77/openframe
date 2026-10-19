// Shape layers (ADR-057), checked in real pixels: a red rectangle fills its
// box and nothing past it; a pill rounds its corners away; an ellipse
// leaves its box's corners empty; a left-to-right gradient runs red to
// blue; an outline-only box is hollow; a line drawn halfway stops at its
// middle; an outline drawn a quarter of the way covers the top edge's right
// half only; and shape.draw keyed 0 to 1 draws a line on over time.
// One clip a second; the canvas is 1920x1080 on black.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const made = await page.evaluate(() => {
    const v = window.videoEditor;
    const call = (name, args) => v.exec(name, args);
    call("set_project", { width: 1920, height: 1080 });
    call("add_shape", { kind: "rectangle", start: 0, duration: 1, width: 0.5, height: 0.4, color: "#ff0000" });
    call("add_shape", { kind: "rounded_rectangle", start: 1, duration: 1, width: 0.5, height: 0.2, radius: 1, color: "#00ff00" });
    call("add_shape", { kind: "ellipse", start: 2, duration: 1, width: 0.4, height: 0.4, color: "#ffff00" });
    call("add_shape", { kind: "rectangle", start: 3, duration: 1, width: 0.8, height: 0.3, gradient: { from: "#ff0000", to: "#0000ff", angle: 0 } });
    call("add_shape", { kind: "rectangle", start: 4, duration: 1, width: 0.5, height: 0.5, fill: false, stroke_color: "#ffffff", stroke_width: 24 });
    call("add_shape", { kind: "line", start: 5, duration: 1, width: 0.6, color: "#00ffff", stroke_width: 30, draw: 0.5 });
    call("add_shape", { kind: "rectangle", start: 6, duration: 1, width: 0.5, height: 0.5, fill: false, stroke_color: "#ff00ff", stroke_width: 24, draw: 0.25 });
    call("add_shape", { kind: "line", start: 7, duration: 1, width: 0.6, color: "#ffffff", stroke_width: 30 });
    const clips = v.project().tracks.flatMap((t) => t.clips);
    const line = clips.find((c) => c.start === 210);
    call("add_keyframe", { clip_id: line.id, path: "shape.draw", at: 7, value: 0 });
    call("add_keyframe", { clip_id: line.id, path: "shape.draw", at: 7.9, value: 1 });
    const d = v.describe();
    return { shapes: d.tracks.flatMap((t) => t.clips).filter((c) => c.shape).map((c) => c.shape.kind), count: clips.length };
  });
  /** Colors at canvas fractions [x, y] of the frame at `frame`. */
  const sample = (frame, pts) =>
    page.evaluate(
      async ({ frame, pts }) => {
        const v = window.videoEditor;
        v.seek(frame);
        await new Promise((r) => setTimeout(r, 60));
        await v.rendered();
        const px = v.pixels(640);
        return pts.map(([fx, fy]) => {
          const i = (Math.floor(fy * px.height) * px.width + Math.floor(fx * px.width)) * 4;
          return [px.data[i], px.data[i + 1], px.data[i + 2]];
        });
      },
      { frame, pts },
    );
  const near = (c, want, tol = 40) => c.every((v, i) => Math.abs(v - want[i]) <= tol);
  const dark = (c) => c.every((v) => v < 30);
  const details = {};
  details.described = { ok: made.shapes.join() === "rectangle,rounded_rectangle,ellipse,rectangle,rectangle,line,rectangle,line", ...made };

  // A 0.5 x 0.4 box spans x 0.25..0.75, y 0.3..0.7.
  const [c0, in0, out0, outY] = await sample(15, [[0.5, 0.5], [0.27, 0.32], [0.23, 0.5], [0.5, 0.27]]);
  details.rectangle = { ok: near(c0, [255, 0, 0]) && near(in0, [255, 0, 0]) && dark(out0) && dark(outY), c0, in0, out0, outY };

  // A pill 0.5 x 0.2 (x 0.25..0.75, y 0.4..0.6): its corner is gone, its middle edge is not.
  const [c1, corner1, edge1] = await sample(45, [[0.5, 0.5], [0.255, 0.41], [0.5, 0.41]]);
  details.pill = { ok: near(c1, [0, 255, 0]) && dark(corner1) && near(edge1, [0, 255, 0]), c1, corner1, edge1 };

  // An ellipse 0.4 x 0.4 of the canvas (a wide oval): center filled, box corner empty.
  const [c2, corner2, side2] = await sample(75, [[0.5, 0.5], [0.32, 0.32], [0.32, 0.5]]);
  details.ellipse = { ok: near(c2, [255, 255, 0]) && dark(corner2) && near(side2, [255, 255, 0]), c2, corner2, side2 };

  // Gradient 0 degrees, red to blue across x 0.1..0.9.
  const [l3, m3, r3] = await sample(105, [[0.12, 0.5], [0.5, 0.5], [0.88, 0.5]]);
  details.gradient = { ok: l3[0] > 200 && l3[2] < 60 && r3[2] > 200 && r3[0] < 60 && Math.abs(m3[0] - m3[2]) < 50 && m3[0] > 80, l3, m3, r3 };

  // Outline only: 24 px at 1080 is 2.2% of the height; the edge at y 0.25.
  const [c4, e4] = await sample(135, [[0.5, 0.5], [0.5, 0.25]]);
  details.outline = { ok: dark(c4) && near(e4, [255, 255, 255], 60), c4, e4 };

  // A line 0.6 wide (x 0.2..0.8) drawn halfway reaches x 0.5.
  const [a5, b5] = await sample(165, [[0.3, 0.5], [0.7, 0.5]]);
  details.lineHalf = { ok: near(a5, [0, 255, 255]) && dark(b5), a5, b5 };

  // An outline drawn a quarter of the way from the top center, clockwise:
  // the top edge's right half (and the right edge's top), not its left.
  const [tr6, tl6, br6] = await sample(195, [[0.62, 0.25], [0.38, 0.25], [0.75, 0.7]]);
  details.trimPath = { ok: near(tr6, [255, 0, 255], 60) && dark(tl6) && dark(br6), tr6, tl6, br6 };

  // shape.draw keyed 0 (7 s) to 1 (7.9 s): nothing at the start, all at the end.
  const [s7a, s7b] = await sample(210, [[0.25, 0.5], [0.75, 0.5]]);
  const [e7a, e7b] = await sample(237, [[0.25, 0.5], [0.75, 0.5]]);
  details.drawOn = { ok: dark(s7a) && dark(s7b) && near(e7a, [255, 255, 255], 60) && near(e7b, [255, 255, 255], 60), s7a, s7b, e7a, e7b };

  await page.evaluate(async () => {
    window.videoEditor.seek(195);
    await window.videoEditor.rendered();
  });
  await page.screenshot({ path: "__REPO__/scratch/shapes.png" });
  details.noErrors = { ok: !errors.some((e) => /shader|program|WebGL/i.test(e)), errors: errors.slice(0, 5) };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
