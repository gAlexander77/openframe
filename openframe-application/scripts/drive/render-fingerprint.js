// A fingerprint of how a project made only of older features renders: the
// blur effect at 30 and at its old maximum 100 on a photo and a title, an
// animation's blur, the blurred canvas fill, shapes (gradient, outline,
// pill, trim), bold and regular titles with an outline, shadow, glow and
// spacing, and a compound clip in a rounded mask. Each frame is rendered
// as export draws it (1080p) and hashed. Run it before and after a change
// to the renderer and compare the hashes: old projects must look the same
// (ADR-069). Hashes depend on the GPU and driver, so only runs on one
// machine compare. Returns { ok, hashes, details }.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const made = await page.evaluate(async () => {
    const v = window.videoEditor;
    const call = (name, args) => v.exec(name, args);
    call("set_project", { width: 1920, height: 1080, background: "#101018" });
    const [photo] = await v.import([{ name: "photo.jpg", src: location.origin + "/fixtures/media/photo.jpg" }]);
    const clips = () => v.project().tracks.flatMap((t) => t.clips);
    const last = () => clips().reduce((a, b) => (b.id > a.id && !seen.has(b.id) ? b : a));
    const seen = new Set();
    const added = () => {
      const c = clips().find((x) => !seen.has(x.id));
      seen.add(c.id);
      return c;
    };
    void last;
    // 0-1 s: the photo with blur 100 (the old maximum); 1-2 s: blur 30.
    call("add_media_clip", { asset_id: photo.id, start: 0, duration: 1 });
    const p100 = added();
    call("add_effect", { clip_id: p100.id, type: "blur", params: { amount: 100 } });
    call("add_media_clip", { asset_id: photo.id, start: 1, duration: 1 });
    const p30 = added();
    call("add_effect", { clip_id: p30.id, type: "blur", params: { amount: 30 } });
    // 2-3 s: the photo small, on a blurred canvas fill, rising in with blur.
    call("add_media_clip", { asset_id: photo.id, start: 2, duration: 1 });
    const small = added();
    call("set_param", { clip_ids: [small.id], path: "transform.scale", value: 0.6 });
    call("set_canvas_fill", { clip_ids: [small.id], fill: "blur", amount: 60 });
    call("set_animation", { clip_id: small.id, slot: "in", type: "blurIn", duration: 0.8 });
    // 0-3 s: shapes over everything.
    call("add_shape", { kind: "rectangle", start: 0, duration: 3, x: -0.3, y: -0.3, width: 0.3, height: 0.2, gradient: { from: "#ff3366", to: "#3366ff", angle: 30 } });
    added();
    call("add_shape", { kind: "ellipse", start: 0, duration: 3, x: 0.3, y: -0.3, width: 0.15, color: "#ffd23f", stroke_color: "#ffffff", stroke_width: 10 });
    added();
    call("add_shape", { kind: "rounded_rectangle", start: 0, duration: 3, x: 0.3, y: 0.3, width: 0.25, height: 0.1, radius: 1, color: "#22cc88", stroke_color: "#000000", stroke_width: 6, draw: 0.6 });
    added();
    // Titles: bold with outline and shadow; regular, spaced, glowing; one
    // blurred at 100.
    call("add_text", { text: "Bold title", start: 0, duration: 3, y: 0.05, style: { size: 120, bold: true, stroke: { color: "#000000", width: 8 }, shadow: { color: "#000000aa", blur: 12, x: 4, y: 6 } } });
    added();
    call("add_text", { text: "Regular, spaced", start: 0, duration: 3, y: 0.22, style: { size: 72, bold: false, letterSpacing: 12, glow: { color: "#00e5ff", blur: 24 } } });
    added();
    call("add_text", { text: "BLURRED", start: 0, duration: 3, y: -0.12, style: { size: 140, color: "#ffffff" } });
    const blurred = added();
    call("add_effect", { clip_id: blurred.id, type: "blur", params: { amount: 100 } });
    // 3-4 s: a compound window (photo + a bar) in a rounded mask, moved.
    call("add_media_clip", { asset_id: photo.id, start: 3, duration: 1, track_id: v.project().tracks.find((t) => t.main).id });
    const inner = added();
    call("add_shape", { kind: "rectangle", start: 3, duration: 1, y: -0.45, width: 1, height: 0.1, color: "#202028" });
    const bar = added();
    call("create_compound_clip", { clip_ids: [inner.id, bar.id] });
    const comp = clips().find((c) => c.type === "compound");
    call("set_param", { clip_ids: [comp.id], path: "transform.scale", value: 0.6 });
    call("set_param", { clip_ids: [comp.id], path: "transform.x", value: 0.1 });
    call("set_mask", { clip_ids: [comp.id], shape: "rectangle", width: 1, height: 1, radius: 0.15 });
    return { clips: clips().length };
  });
  const frames = [10, 40, 66, 75, 100];
  const hashes = await page.evaluate(async (frames) => {
    const v = window.videoEditor;
    const out = {};
    for (const f of frames) {
      const still = await v.still(f);
      const bmp = await createImageBitmap(await (await fetch(still.url)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext("2d");
      g.drawImage(bmp, 0, 0);
      const data = g.getImageData(0, 0, bmp.width, bmp.height).data;
      const digest = await crypto.subtle.digest("SHA-256", data);
      out[f] = [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
      URL.revokeObjectURL(still.url);
    }
    return out;
  }, frames);
  await page.evaluate(async () => {
    window.videoEditor.seek(10);
    await window.videoEditor.rendered();
  });
  await page.screenshot({ path: "__REPO__/scratch/render-fingerprint.png" });
  const details = {
    built: { ok: made.clips >= 10, ...made },
    noErrors: { ok: !errors.some((e) => /shader|program|WebGL/i.test(e)), errors: errors.slice(0, 5) },
  };
  return { ok: Object.values(details).every((d) => d.ok), hashes, details };
};
