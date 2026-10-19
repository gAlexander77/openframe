// Motion blur from movement (ADR-058), in real pixels. A white bar (5% of
// the width) crosses 80% of a 1920-wide canvas in half a second: about 100
// px a frame, so a 180-degree shutter smears each edge over ~50 px.
// - Off: the bar's row has hard edges (a pixel or two between black and
//   white). On: tens of pixels of ramp, the same light in total (a blur
//   moves light, it does not add any), in the viewer and through export.
// - Held still (after its last key) it is exactly as sharp as without blur.
// - A push transition between two solids blurs too: the seam becomes a
//   band of mixed color.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  page.setDefaultTimeout(5000);
  const ids = await page.evaluate(() => {
    const v = window.videoEditor;
    v.exec("set_project", { width: 1920, height: 1080 });
    v.exec("add_shape", { kind: "rectangle", start: 0, duration: 2, width: 0.05, height: 0.3, color: "#ffffff" });
    const bar = v.describe().tracks.flatMap((t) => t.clips).find((c) => c.shape).id;
    v.exec("add_keyframe", { clip_id: bar, path: "transform.x", at: 0, value: -0.4 });
    v.exec("add_keyframe", { clip_id: bar, path: "transform.x", at: 0.5, value: 0.4 });
    // Two solids pushing at 3 s, on the main track.
    const main = v.project().tracks.find((t) => t.main).id;
    v.exec("add_color_clip", { color: "#ff0000", start: 2, duration: 1, track_id: main });
    v.exec("add_color_clip", { color: "#0000ff", start: 3, duration: 1, track_id: main });
    const red = v.describe().tracks.flatMap((t) => t.clips).find((c) => c.color === "#ff0000").id;
    const blue = v.describe().tracks.flatMap((t) => t.clips).find((c) => c.color === "#0000ff").id;
    v.exec("set_transition", { clip_id: red, type: "pushLeft", duration: 0.5 });
    return { bar, red, blue };
  });
  /** One row (y 0.5) of the viewer's and export's pictures, as luma or rgb. */
  const row = (frame) =>
    page.evaluate(async (frame) => {
      const v = window.videoEditor;
      v.seek(frame);
      await new Promise((r) => setTimeout(r, 60));
      await v.rendered();
      const px = v.pixels();
      const take = (d, w, h) => {
        const y = Math.floor(h * 0.5), out = [];
        for (let x = 0; x < w; x++) out.push([d[(y * w + x) * 4], d[(y * w + x) * 4 + 1], d[(y * w + x) * 4 + 2]]);
        return out;
      };
      const still = await v.still(frame, "480p");
      const bmp = await createImageBitmap(await (await fetch(still.url)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d");
      c.drawImage(bmp, 0, 0);
      const img = c.getImageData(0, 0, bmp.width, bmp.height);
      URL.revokeObjectURL(still.url);
      return { viewer: take(px.data, px.width, px.height), exported: take(img.data, img.width, img.height) };
    }, frame);
  const ramp = (r) => r.filter((c) => c[0] > 20 && c[0] < 235).length;
  const light = (r) => r.reduce((s, c) => s + c[0], 0) / 255;
  const details = {};
  const set = (on) => page.evaluate(({ on, id }) => window.videoEditor.exec("set_motion_blur", { clip_ids: [id], on }), { on, id: ids.bar });

  const sharp = await row(7);
  await set(true);
  const blurred = await row(7);
  const scale = sharp.viewer.length / 1920;
  details.sharpOff = { ok: ramp(sharp.viewer) <= 4 && ramp(sharp.exported) <= 4, viewer: ramp(sharp.viewer), exported: ramp(sharp.exported) };
  // ~50 canvas px per edge, two edges.
  details.blurredOn = {
    ok: ramp(blurred.viewer) > 60 * scale && ramp(blurred.exported) > 60 * (480 / 1080),
    viewer: ramp(blurred.viewer),
    exported: ramp(blurred.exported),
    wantViewerOver: Math.round(60 * scale),
  };
  const lv = [light(sharp.viewer), light(blurred.viewer)];
  details.sameLight = { ok: Math.abs(lv[1] - lv[0]) / lv[0] < 0.08, sharp: lv[0], blurred: lv[1] };

  // After its last key (0.5 s) the bar holds still: no blur at all.
  const held = await row(30);
  await set(false);
  const heldOff = await row(30);
  const diff = held.viewer.reduce((m, c, i) => Math.max(m, Math.abs(c[0] - heldOff.viewer[i][0])), 0);
  details.stillIsSharp = { ok: diff <= 1 && ramp(held.viewer) <= 4, diff };

  // The push: at 3.0 s it is half way; red meets blue in a hard seam off,
  // a purple band on.
  const purple = (r) => r.filter((c) => c[0] > 40 && c[2] > 40).length;
  const seamOff = await row(90);
  await page.evaluate((id) => window.videoEditor.exec("set_motion_blur", { clip_ids: [id], on: true }), ids.red);
  const seamOn = await row(90);
  details.transition = { ok: purple(seamOff.viewer) <= 3 && purple(seamOn.viewer) > 20 * scale * 2 && purple(seamOn.exported) > 10, off: purple(seamOff.viewer), on: purple(seamOn.viewer), exported: purple(seamOn.exported) };

  const desc = await page.evaluate((id) => window.videoEditor.describe().tracks.flatMap((t) => t.clips).find((c) => c.id === id).motion_blur, ids.red);
  details.described = { ok: desc?.shutter_angle === 180, desc };
  await set(true);
  await page.evaluate(async () => {
    window.videoEditor.seek(7);
    await window.videoEditor.rendered();
  });
  await page.screenshot({ path: "__REPO__/scratch/motion-blur.png" });
  return { ok: Object.values(details).every((d) => d.ok), details };
};
