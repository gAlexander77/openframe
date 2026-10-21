// Callouts, anchors, frame_region moves and set_mask at (ADR-120), in
// real pixels. green-screen.mp4 (1280x720, green with a pink box at x
// 440..840, y 160..560) fills a 1920x1080 frame; frame_region pushes in
// (1-2 s) and pans (2.5-3 s) in one call with moves; a callout rings the
// box's top-left corner (a region whose corner is the box's) and glides to
// its bottom-right corner (2.9-3.3 s). At five moments the ring sits 6 px
// outside the corner in the accent color, the box's corner inside the
// hole is undimmed pink, and the green beyond the ring is dimmed: the
// callout stays on the picture through the push and the pan (it was two
// hand-synced layers placed by hand in canvas fractions, Claude film test
// 3). Then set_mask with at moves a hole across a blue card (it used to
// overwrite the static values silently), the click lands under a callout
// made with sound, and the library's Callout card adds one a person can
// see pinned and unpin in the inspector.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const A = { x: 440 / 1280, y: 160 / 720, w: 0.1, h: 0.1 };
  const B = { x: 840 / 1280 - 0.1, y: 560 / 720 - 0.1, w: 0.1, h: 0.1 };
  const made = await page.evaluate(
    async ({ A, B }) => {
      const v = window.videoEditor;
      v.exec("set_project", { width: 1920, height: 1080 });
      const [asset] = await v.import([{ name: "green-screen.mp4", src: location.origin + "/fixtures/media/green-screen.mp4" }]);
      v.exec("add_media_clip", { asset_id: asset.id, start: 0, duration: 4 });
      const shot = v.project().tracks.flatMap((t) => t.clips).find((c) => c.type === "video").id;
      const whole = { x: 0, y: 0, w: 1, h: 1 }, push = { x: 0.2, y: 0.1, w: 0.5, h: 0.5 }, pan = { x: 0.3, y: 0.3, w: 0.5, h: 0.5 };
      v.exec("frame_region", { clip_id: shot, moves: [{ region: whole, at: 1 }, { region: push, at: 2 }, { region: push, at: 2.5 }, { region: pan, at: 3 }] });
      const answer = v.exec("add_callout", { clip_id: shot, region: A, at: 0.2, duration: 3.75, to: [{ region: B, at: 3.3 }] });
      const clips = v.project().tracks.flatMap((t) => t.clips);
      return { shot, ring: clips.find((c) => c.name === "Callout")?.id, dim: clips.find((c) => c.name === "Callout dim")?.id, keys: v.project().tracks.flatMap((t) => t.clips).find((c) => c.id === shot).keyframes["transform.scale"].length, notes: answer.notes ?? [] };
    },
    { A, B },
  );
  const details = {};
  details.made = { ok: !!made.ring && !!made.dim && made.keys === 4, ...made };

  /** Colors at canvas pixels of the frame at `frame`, and where a source
   * point of the shot is drawn then (from its own keys). */
  const look = (frame, corner) =>
    page.evaluate(
      async ({ frame, corner, shot }) => {
        const v = window.videoEditor;
        const s = v.paramAt(shot, "transform.scale", frame), x = v.paramAt(shot, "transform.x", frame), y = v.paramAt(shot, "transform.y", frame);
        const X = 960 + x * 1920 + (corner.u - 0.5) * 1920 * s, Y = 540 + y * 1080 + (corner.v - 0.5) * 1080 * s;
        // The frame as export draws it, at 1920x1080.
        const still = await v.still(frame);
        const bmp = await createImageBitmap(await (await fetch(still.url)).blob());
        URL.revokeObjectURL(still.url);
        const g = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d");
        g.drawImage(bmp, 0, 0);
        const img = g.getImageData(0, 0, bmp.width, bmp.height);
        const at = (cx, cy) => {
          const i = (Math.round(cy) * img.width + Math.round(cx)) * 4;
          return [img.data[i], img.data[i + 1], img.data[i + 2]];
        };
        // Toward the box (in), the ring 6 px out, the green 30 px out.
        const sx = corner.u < 0.5 ? 1 : -1, sy = corner.v < 0.5 ? 1 : -1, half = 0.05 * 1920 * s;
        return { X: Math.round(X), Y: Math.round(Y), s: +s.toFixed(3), inside: at(X + sx * 15, Y + sy * 15), ring: at(X + sx * half, Y - sy * 6), beyond: at(X + sx * half, Y - sy * 30) };
      },
      { frame, corner, shot: made.shot },
    );
  const near = (c, want, tol = 45) => c.every((x, i) => Math.abs(x - want[i]) <= tol);
  const pink = [255, 59, 107], accent = [250, 204, 21];
  // Green 0x00b140 under a 50% black: its green halves.
  const dimmed = (c) => c[1] > 55 && c[1] < 120 && c[0] < 40;
  const corners = { A: { u: A.x, v: A.y }, B: { u: B.x + B.w, v: B.y + B.h } };
  for (const [name, frame, corner] of [["still", 21, "A"], ["pushing", 45, "A"], ["pushed", 66, "A"], ["panning", 82, "A"], ["glided", 102, "B"]]) {
    const r = await look(frame, corners[corner]);
    details[name] = { ok: near(r.inside, pink) && near(r.ring, accent, 60) && dimmed(r.beyond), ...r };
  }
  await page.evaluate(async () => {
    window.videoEditor.seek(66);
    await window.videoEditor.rendered();
  });
  await page.screenshot({ path: "__REPO__/scratch/callouts-pushed.png" });

  // set_mask with at: a white box masked to a hole at the left, then
  // keyed to the right between 4.5 and 5 s, over a blue card.
  const masked = await page.evaluate(async () => {
    const v = window.videoEditor;
    const main = v.project().tracks.find((t) => t.main).id;
    v.exec("add_color_clip", { color: "#0000ff", start: 4, duration: 2, track_id: main });
    v.exec("add_shape", { kind: "rectangle", start: 4, duration: 2, width: 1, height: 1, color: "#ffffff" });
    const box = v.project().tracks.flatMap((t) => t.clips).find((c) => c.type === "color" && c.shape && c.start === 120).id;
    v.exec("set_mask", { clip_ids: [box], shape: "rectangle", x: -0.25, y: 0, width: 0.2, height: 0.3 });
    v.exec("set_mask", { clip_ids: [box], at: 4.5, x: -0.25 });
    v.exec("set_mask", { clip_ids: [box], at: 5, x: 0.25 });
    const sample = async (frame) => {
      v.seek(frame);
      await new Promise((r) => setTimeout(r, 60));
      await v.rendered();
      const px = v.pixels(640);
      const at = (fx) => {
        const i = (Math.floor(0.5 * px.height) * px.width + Math.floor(fx * px.width)) * 4;
        return [px.data[i], px.data[i + 1], px.data[i + 2]];
      };
      return { left: at(0.25), right: at(0.75) };
    };
    return { before: await sample(130), after: await sample(165), keys: v.project().tracks.flatMap((t) => t.clips).find((c) => c.id === box).keyframes?.["mask.x"]?.length ?? 0 };
  });
  const white = (c) => c.every((x) => x > 220), blue = (c) => c[2] > 200 && c[0] < 40;
  details.maskAt = { ok: masked.keys === 3 && white(masked.before.left) && blue(masked.before.right) && blue(masked.after.left) && white(masked.after.right), ...masked };

  // sound true: the click is made and lands where the ring starts drawing.
  const clicked = await page.evaluate(async (shot) => {
    const v = window.videoEditor;
    await v.exec("add_callout", { clip_id: shot, region: { x: 0.4, y: 0.4, w: 0.1, h: 0.1 }, at: 1.2, duration: 1, shape: "ring", dim: 0, sound: true });
    const p = v.project();
    const clip = p.tracks.flatMap((t) => t.clips).find((c) => c.type === "audio");
    return { start: clip?.start, sound: p.assets.find((a) => a.id === clip?.assetId)?.sound?.id, label: v.state().undoLabel };
  }, made.shot);
  details.click = { ok: clicked.start === 36 && clicked.sound === "click", ...clicked };

  // A person's callout: the library's Callout card at 1.5 s, then the
  // inspector says what the ring is pinned to, and Unpin lets both go.
  await page.evaluate(() => window.videoEditor.seek(45));
  const lib = page.getByRole("region", { name: "Library" });
  await lib.getByRole("tab", { name: "Adjustment", exact: true }).click();
  await lib.getByRole("button", { name: "Add Callout" }).click();
  const added = await page.evaluate(() => {
    const v = window.videoEditor;
    const sel = v.state().selection;
    const ring = v.project().tracks.flatMap((t) => t.clips).find((c) => c.id === sel[0]);
    return { name: ring?.name, anchored: !!ring?.anchor, group: ring?.group, label: v.state().undoLabel };
  });
  const insp = page.getByRole("region", { name: "Inspector" });
  await insp.getByRole("tab", { name: "Animation", exact: true }).click();
  const pinned = await insp.getByText(/Pinned to green-screen\.mp4/).isVisible();
  await insp.getByRole("button", { name: "Unpin" }).click();
  const unpinned = await page.evaluate((group) => window.videoEditor.project().tracks.flatMap((t) => t.clips).filter((c) => c.group === group).map((c) => !!c.anchor), added.group);
  details.ui = { ok: added.name === "Callout" && added.anchored && added.label === "Add callout" && pinned && unpinned.length === 2 && unpinned.every((a) => !a), ...added, pinned, unpinned };

  details.noErrors = { ok: !errors.length, errors: errors.slice(0, 5) };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
