// Stickers, text templates and engine-drawn library previews, end to end:
// stickers add as image clips that show in the viewer, the same sticker
// reuses its asset, drag-to-timeline works, agents can add one, the
// project keeps stickers across a save and reload (web: OPFS), templates
// add their animated layers, word art restyles selected text, and the
// card previews tell the truth (a mono look is grey, a wipe brings the
// next shot in from the side its name says, reduced motion keeps stills).
//
// Needs the dev server and fixtures (node scripts/make-fixtures.mjs). Run
// with any Playwright page, e.g. the MCP tool `browser_run_code_unsafe`
// with filename "scripts/drive/stickers.js". Set globalThis.DRIVE_BASE to
// use a server other than :1420. Returns { ok, details }.
async (page) => {
  const base = globalThis.DRIVE_BASE ?? "http://localhost:1420";
  const details = {};
  const fail = [];
  const check = (name, pass, info) => {
    details[name] = { pass: !!pass, ...(info === undefined ? {} : { info }) };
    if (!pass) fail.push(name);
  };
  const ve = (fn, arg) => page.evaluate(fn, arg);
  const wait = (ms) => page.waitForTimeout(ms);

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(base);
  await page.waitForFunction(() => !!window.videoEditor);
  await page.click(".create-card");
  await page.waitForSelector(".library-panel");
  await ve(async (base) => {
    const v = window.videoEditor;
    const [a] = await v.import([{ name: "h264-1080p30.mp4", src: `${base}/fixtures/media/h264-1080p30.mp4` }]);
    v.exec("add_media_clip", { asset_id: a.id, start: 0 });
    v.select([]);
    v.seek(30);
  }, base);

  // Mean color of the viewer's center square (where a new sticker sits).
  const centerColor = () =>
    ve(async () => {
      const v = window.videoEditor;
      await new Promise((r) => setTimeout(r, 40));
      await v.rendered();
      const { width: w, height: h, data } = v.pixels();
      const s = [0, 0, 0];
      let n = 0;
      for (let y = Math.floor(h * 0.42); y < h * 0.58; y += 2)
        for (let x = Math.floor(w * 0.45); x < w * 0.55; x += 2) {
          const i = (y * w + x) * 4;
          s[0] += data[i];
          s[1] += data[i + 1];
          s[2] += data[i + 2];
          n++;
        }
      return s.map((v) => Math.round(v / n));
    });
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const clips = () => ve(() => window.videoEditor.project().tracks.flatMap((t) => t.clips.map((c) => ({ ...c, track: t.name, main: !!t.main }))));
  const stickerAssets = (id) => ve((id) => window.videoEditor.project().assets.filter((a) => a.sticker === id).length, id);

  // ---- stickers ------------------------------------------------------------------------
  const plain = await centerColor();
  await page.click('.lib-tab:has-text("Stickers")');
  await page.locator('.card-add[aria-label="Add Fire sticker"]').click({ force: true });
  await page.waitForFunction(() => window.videoEditor.project().assets.some((a) => a.sticker === "fire"));
  let all = await clips();
  const fire = all.find((c) => c.type === "image");
  check("sticker adds an image clip above the main track", fire && !fire.main && fire.transform.scale === 0.3 && fire.start === 30, fire && { track: fire.track, scale: fire.transform.scale, start: fire.start });
  // Adding a sticker previews its pop-in, then restores the playhead.
  // Let that run finish before seeking a fixed frame for the pixel check.
  await page.waitForFunction(() => !window.videoEditor.state().playing);
  await ve(() => window.videoEditor.seek(52)); // past the pop-in
  const withSticker = await centerColor();
  check("sticker shows in the viewer", dist(plain, withSticker) > 40, { plain, withSticker });

  await ve(() => window.videoEditor.seek(150));
  await page.locator('.card-add[aria-label="Add Fire sticker"]').click({ force: true });
  await page.waitForFunction(() => window.videoEditor.project().tracks.flatMap((t) => t.clips).filter((c) => c.type === "image").length === 2);
  check("the same sticker reuses its asset", (await stickerAssets("fire")) === 1);

  // Drag a card onto the timeline (pointer events, as the app's drag uses).
  const card = page.locator(".sticker-card", { hasText: "Heart" }).first();
  await card.scrollIntoViewIfNeeded();
  const from = await card.boundingBox();
  const tl = await page.locator(".tl-scroll").boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(from.x + (tl.x + 500 - from.x) * (i / 12), from.y + (tl.y + 40 - from.y) * (i / 12));
  await page.mouse.up();
  await page.waitForFunction(() => window.videoEditor.project().assets.some((a) => a.sticker === "heart-red"), null, { timeout: 5000 }).catch(() => null);
  check("drag to the timeline adds the sticker", (await stickerAssets("heart-red")) === 1);

  const viaAgent = await ve(async () => {
    const v = window.videoEditor;
    await v.exec("add_sticker", { name: "👍", start: 7, motion: "still", y: 0.3 });
    let err = "";
    try {
      await v.exec("add_sticker", { name: "no-such-sticker", start: 0 });
    } catch (e) {
      err = e.message;
    }
    return { thumbs: v.project().assets.filter((a) => a.sticker === "thumbs-up").length, err };
  });
  check("agents add stickers with add_sticker", viaAgent.thumbs === 1 && /no sticker named/.test(viaAgent.err), viaAgent);

  // ---- save and reload keeps stickers (web: the PNG lives in OPFS) --------------------
  await ve(() => window.videoEditor.seek(52));
  const before = await centerColor();
  await ve(async () => {
    window.videoEditor.action("saveProject");
    await new Promise((r) => setTimeout(r, 1500));
  });
  const name = await ve(() => window.videoEditor.project().name);
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".project-card", { hasText: name }).first().click();
  await page.waitForSelector(".library-panel");
  await page.waitForFunction(() => window.videoEditor.project().assets.some((a) => a.sticker === "fire"));
  await ve(() => window.videoEditor.seek(52));
  await wait(500);
  const after = await centerColor();
  all = await clips();
  check("save and reload keep stickers", all.filter((c) => c.type === "image").length === 4 && dist(before, after) < 6, { before, after });

  // ---- text templates ----------------------------------------------------------------
  await ve(() => {
    window.videoEditor.select([]);
    window.videoEditor.seek(200);
  });
  await page.click('.lib-tab:has-text("Text")');
  const n0 = (await clips()).length;
  await page.locator('.card-add[aria-label="Add Name and title"]').click({ force: true });
  all = await clips();
  const added = all.slice(0).filter((c) => c.start >= 200 && (c.type === "text" || c.type === "color"));
  check(
    "a template adds its animated layers",
    all.length === n0 + 4 && added.some((c) => c.text === "Alex Rivera") && added.every((c) => c.animIn && c.animOut),
    added.map((c) => `${c.type}:${c.text ?? c.color}:${c.animIn?.type}`),
  );
  await page.locator('.card-add[aria-label="Add Default text"]').click({ force: true });
  await page.locator('.card-add[aria-label="Add Comic"]').click({ force: true });
  const styled = await ve(() => {
    const v = window.videoEditor;
    const id = v.state().selection[0];
    const c = v.project().tracks.flatMap((t) => t.clips).find((x) => x.id === id);
    return { text: c.text, color: c.style.color, font: c.style.font, size: c.style.size };
  });
  check("word art restyles the selected text", styled.text === "Default text" && styled.color === "#ffe14d" && styled.font === "Impact" && styled.size === 96, styled);

  // ---- previews tell the truth --------------------------------------------------------
  // Decode a card's still (or one cell of its sprite) into pixels.
  const cardPixels = (label, cell) =>
    page.evaluate(
      async ({ label, cell }) => {
        const c = [...document.querySelectorAll(".library-panel .card")].find((x) => x.querySelector(".card-label")?.textContent === label);
        const el = c.querySelector(".eng-preview");
        const url = (cell === undefined ? el.style.backgroundImage : el.style.getPropertyValue("--sprite")).replace(/^url\("?|"?\)$/g, "");
        const bmp = await createImageBitmap(await (await fetch(url)).blob());
        const size = bmp.height;
        const k = new OffscreenCanvas(size, size).getContext("2d");
        k.drawImage(bmp, -(cell ?? 0) * size, 0);
        return { size, frames: Math.round(bmp.width / size), data: [...k.getImageData(0, 0, size, size).data] };
      },
      { label, cell },
    );
  const lum = (p, x0, x1) => {
    let s = 0;
    let n = 0;
    for (let y = 0; y < p.size; y += 3) for (let x = Math.floor(x0 * p.size); x < x1 * p.size; x += 3) {
      const i = (y * p.size + x) * 4;
      s += p.data[i] * 0.2126 + p.data[i + 1] * 0.7152 + p.data[i + 2] * 0.0722;
      n++;
    }
    return s / n;
  };

  await page.click('.lib-tab:has-text("Filters")');
  await page.locator(".card", { hasText: "Mono" }).scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.querySelectorAll(".card")].some((c) => c.textContent === "Mono" && c.querySelector(".eng-preview.ready")), null, { timeout: 8000 });
  const mono = await cardPixels("Mono");
  let chroma = 0;
  for (let i = 0; i < mono.data.length; i += 4) chroma = Math.max(chroma, Math.max(mono.data[i], mono.data[i + 1], mono.data[i + 2]) - Math.min(mono.data[i], mono.data[i + 1], mono.data[i + 2]));
  // Each card renders its own preview: wait for this one too, not only Mono.
  await page.waitForFunction(() => [...document.querySelectorAll(".card")].some((c) => c.textContent === "Vivid" && c.querySelector(".eng-preview.ready")), null, { timeout: 8000 });
  const vivid = await cardPixels("Vivid");
  let vChroma = 0;
  for (let i = 0; i < vivid.data.length; i += 4) vChroma = Math.max(vChroma, Math.max(vivid.data[i], vivid.data[i + 1], vivid.data[i + 2]) - Math.min(vivid.data[i], vivid.data[i + 1], vivid.data[i + 2]));
  check("filter cards show the real look (Mono is grey, Vivid is not)", chroma < 24 && vChroma > 120, { mono: chroma, vivid: vChroma });

  await page.click('.lib-tab:has-text("Transitions")');
  const wipe = page.locator(".card", { hasText: "Wipe left" });
  await wipe.hover();
  await page.waitForFunction(() => [...document.querySelectorAll(".card")].some((c) => c.textContent === "Wipe left" && c.querySelector(".eng-preview.has-motion")), null, { timeout: 8000 });
  // Cell 2 starts the transition, the middle cell is halfway through: the
  // night shot comes in from the right, so the right edge goes dark first.
  const early = await cardPixels("Wipe left", 2);
  const mid = await cardPixels("Wipe left", Math.floor(early.frames / 2));
  check(
    "transition cards animate the real wipe on hover",
    early.frames > 10 && lum(early, 0, 0.15) - lum(early, 0.85, 1) < 25 && lum(mid, 0, 0.15) - lum(mid, 0.85, 1) > 40,
    { frames: early.frames, early: [lum(early, 0, 0.15), lum(early, 0.85, 1)].map(Math.round), mid: [lum(mid, 0, 0.15), lum(mid, 0.85, 1)].map(Math.round) },
  );
  const looping = await wipe.evaluate((c) => getComputedStyle(c.querySelector(".eng-preview"), "::after").animationName);
  check("the hover loop plays", looping === "sprite-play", looping);

  await page.mouse.move(0, 0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const dissolve = page.locator(".card", { hasText: "Cross dissolve" });
  await dissolve.hover();
  await wait(1200);
  const still = await dissolve.evaluate((c) => {
    const el = c.querySelector(".eng-preview");
    return { ready: el.classList.contains("ready"), motion: el.classList.contains("has-motion") };
  });
  check("reduced motion keeps the still", still.ready && !still.motion, still);
  await page.emulateMedia({ reducedMotion: "no-preference" });

  return { ok: fail.length === 0, failed: fail, details };
};
