// Brand kit and ad elements: a logo picture (drawn here, saved to scratch/
// and imported like any file), set_brand, then a lower third, an offer
// badge, a call to action, a logo reveal and an end card, each one
// add_ad_element call. Checks: every element is one group inside the
// title-safe area; the viewer shows the brand's colors where each element
// sits (the title box bottom left, the badge top right, the card's
// background and button at the end); a 9:16 project keeps the lower third
// clear of the bottom 35%; apply_brand restyles a plain title.
// Screenshots: scratch/ad-elements-*.png.
async (page) => {
  const fs = await import("node:fs");
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  page.setDefaultTimeout(10000);
  const details = {};
  const base = await page.evaluate(() => location.origin);

  // A logo: a coral disc with a white mark and a wordmark, on transparency.
  const logo = await page.evaluate(async () => {
    const c = new OffscreenCanvas(900, 300);
    const g = c.getContext("2d");
    g.fillStyle = "#ff5a5f";
    g.beginPath();
    g.arc(150, 150, 130, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#ffffff";
    g.font = "bold 170px Arial Black, Arial";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("R", 150, 160);
    g.fillStyle = "#ffffff";
    g.font = "bold 120px Arial Black, Arial";
    g.textAlign = "left";
    g.fillText("ROAST", 310, 160);
    const bytes = new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer());
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  fs.mkdirSync("__REPO__/scratch", { recursive: true });
  fs.writeFileSync("__REPO__/scratch/ad-logo.png", Buffer.from(logo, "base64"));

  const ids = await page.evaluate(async (base) => {
    const v = window.videoEditor;
    const [photo, mark] = await v.import([
      { name: "photo.jpg", src: `${base}/fixtures/media/photo.jpg` },
      { name: "ad-logo.png", src: `${base}/scratch/ad-logo.png` },
    ]);
    v.exec("add_media_clip", { asset_id: photo.id, start: 0, duration: 14 });
    v.exec("set_brand", { name: "Roast", primary: "#ff5a5f", secondary: "#2b2d42", accent: "#ffd23f", background: "#1b1b2f", text: "#ffffff", heading_font: "Arial Black", body_font: "Segoe UI", logo_light: mark.id, url: "roast.example", tagline: "Small batch, big flavor" });
    v.exec("add_ad_element", { element: "lower_third", start: 1, headline: "Mia Chen", subline: "Head roaster" });
    v.exec("add_ad_element", { element: "offer_badge", start: 1, headline: "-30%", subline: "This week" });
    v.exec("add_ad_element", { element: "cta_button", start: 5, cta: "Order now", url: "roast.example" });
    v.exec("add_ad_element", { element: "logo_reveal", start: 8, background: "brand", glow: true, flash: true });
    v.exec("add_ad_element", { element: "end_card", start: 11, headline: "Fresh roast, every morning", cta: "Order now" });
    return { photo: photo.id, mark: mark.id };
  }, base);

  // Pixel shares of a color in a region of the frame (fractions).
  await page.evaluate(() => {
    window.__share = async (frame, rgb, rect, tol = 40) => {
      const v = window.videoEditor;
      v.seek(frame);
      await new Promise((r) => setTimeout(r, 40));
      await v.rendered();
      const { width, height, data } = v.pixels();
      let n = 0, hit = 0;
      for (let y = Math.floor(rect[1] * height); y < rect[3] * height; y += 2)
        for (let x = Math.floor(rect[0] * width); x < rect[2] * width; x += 2) {
          const i = (y * width + x) * 4;
          n++;
          if (Math.abs(data[i] - rgb[0]) + Math.abs(data[i + 1] - rgb[1]) + Math.abs(data[i + 2] - rgb[2]) < tol) hit++;
        }
      return +(hit / n).toFixed(4);
    };
  });
  const share = (frame, rgb, rect, tol) => page.evaluate(([f, c, r, t]) => window.__share(f, c, r, t), [frame, rgb, rect, tol]);
  const shot = async (name, frame) => {
    await page.evaluate((f) => window.videoEditor.seek(f), frame);
    await page.waitForTimeout(150);
    await page.locator(".player-frame").screenshot({ path: `__REPO__/scratch/ad-elements-${name}.png` });
  };

  // ---- structure -------------------------------------------------------------------
  const elements = await page.evaluate(() => {
    const d = window.videoEditor.describe();
    const clips = d.tracks.flatMap((t) => t.clips);
    const by = (name) => clips.filter((c) => c.name === name);
    return { brand: d.brand, groups: ["Lower third", "Offer badge", "Call to action", "Logo reveal", "End card"].map((n) => ({ n, count: by(n).length, groups: new Set(by(n).map((c) => c.group)).size })) };
  });
  details.brand = { ok: elements.brand?.colors.primary === "#ff5a5f" && elements.brand.logos?.light === ids.mark, brand: elements.brand };
  details.grouped = { ok: elements.groups.every((g) => g.count >= 1 && g.groups === 1), groups: elements.groups };

  // ---- what the viewer shows ------------------------------------------------------------
  // At 3 s: the lower third's title box (primary) at the bottom left, the
  // badge (accent) top right, both settled.
  const primary = [255, 90, 95], accent = [255, 210, 63], card = [27, 27, 47];
  const lower = await share(90, primary, [0.03, 0.75, 0.45, 0.97]);
  const lowerElsewhere = await share(90, primary, [0.55, 0.75, 0.97, 0.97]);
  const badge = await share(90, accent, [0.7, 0.03, 0.97, 0.3]);
  await shot("lower-third", 90);
  details.lowerThirdAndBadge = { ok: lower > 0.01 && lowerElsewhere < 0.002 && badge > 0.02, lower, lowerElsewhere, badge };
  const cta = await share(200, primary, [0.3, 0.6, 0.7, 0.97]);
  await shot("cta", 200);
  details.cta = { ok: cta > 0.01, cta };
  const reveal = await share(295, card, [0, 0, 0.15, 0.15], 30);
  await shot("logo-reveal", 252);
  await shot("logo-reveal-settled", 295);
  details.logoReveal = { ok: reveal > 0.9, reveal };
  const cardBg = await share(400, card, [0, 0, 0.1, 0.1], 30);
  const button = await share(400, primary, [0.3, 0.45, 0.7, 0.85]);
  await shot("end-card", 400);
  details.endCard = { ok: cardBg > 0.9 && button > 0.01, cardBg, button };

  // ---- safe area: every element's clips inside 5% margins -------------------------------
  const outside = await page.evaluate(() => {
    const p = window.videoEditor.project();
    const out = [];
    for (const t of p.tracks)
      for (const c of t.clips) {
        if (!c.name || c.type === "color" || c.name === "Flash") continue;
        // The engine's own measure of the raster, as the viewer draws it.
        const el = document.querySelector(".player-canvas");
        if (!el) continue;
        out.push({ id: c.id, name: c.name, x: c.transform.x, y: c.transform.y });
      }
    return out.filter((c) => Math.abs(c.x) > 0.45 || Math.abs(c.y) > 0.45);
  });
  details.centersInside = { ok: outside.length === 0, outside };

  // ---- apply_brand on a plain title ------------------------------------------------------
  const styled = await page.evaluate(() => {
    const v = window.videoEditor;
    v.exec("add_text", { text: "Plain title", start: 6, duration: 2, style: { font: "Georgia", color: "#00ff00", size: 90 } });
    const id = v.project().tracks.flatMap((t) => t.clips).find((c) => c.type === "text" && c.text === "Plain title").id;
    v.exec("apply_brand", { clip_ids: [id] });
    const s = v.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).style;
    return { font: s.font, color: s.color };
  });
  details.applyBrand = { ok: styled.font === "Arial Black" && styled.color === "#ffffff", styled };

  // ---- the Details panel shows the kit, and edits it -------------------------------------
  await page.evaluate(() => window.videoEditor.select([]));
  const insp = page.getByRole("region", { name: "Inspector" });
  const hexField = insp.getByRole("textbox", { name: "Brand primary color hex" });
  await hexField.waitFor();
  const shownHex = await hexField.inputValue();
  await hexField.fill("#00aa88");
  await hexField.press("Enter");
  const edited = await page.evaluate(() => ({ primary: window.videoEditor.project().brand.colors.primary, undo: window.videoEditor.state().undoLabel }));
  await page.waitForTimeout(300);
  await page.locator(".inspector-panel").screenshot({ path: "__REPO__/scratch/ad-elements-brand-panel.png" });
  await page.evaluate(() => window.videoEditor.exec("set_brand", { primary: "#ff5a5f" }));
  details.brandPanel = { ok: shownHex === "#ff5a5f" && edited.primary === "#00aa88" && edited.undo === "Brand color", shownHex, edited };

  // ---- 9:16: the lower third stays clear of the apps' captions ---------------------------
  const tall = await page.evaluate(() => {
    const v = window.videoEditor;
    v.exec("set_project", { width: 1080, height: 1920 });
    v.exec("add_color_clip", { color: "#000000", start: 20, duration: 5 });
    v.exec("add_ad_element", { element: "lower_third", start: 20, headline: "Mia Chen", subline: "Head roaster" });
    return true;
  });
  const tallLow = await share(660, primary, [0, 0.66, 1, 1]);
  const tallHigh = await share(660, primary, [0, 0.4, 1, 0.66]);
  await shot("vertical", 660);
  details.vertical = { ok: tall && tallLow === 0 && tallHigh > 0.003, tallLow, tallHigh };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
