// Timeline UX drive (UX-12 to UX-15 in docs/UX audit 2026-10-14.md), with
// real pointer drags from the library to the timeline:
// - a photo dropped above the tracks becomes an overlay at the drop time;
// - a photo dragged over the middle of a main clip previews at the cut the
//   magnet will use, with an insertion bar and the later clips making room,
//   and lands exactly there;
// - dragging the second shot to the front leaves the music bed at 00:00
//   while the title on the first shot follows it;
// - a title added from the Text tab plays its In animation and is visible
//   in the viewer once added (reduced motion: visible at once).
//
// Needs the dev server and fixtures (node scripts/make-fixtures.mjs). Run
// with any Playwright page; set globalThis.DRIVE_BASE for a server other
// than :1420. Screenshots go to scripts/drive/shots/. Returns { ok, details }.
async (page) => {
  const base = globalThis.DRIVE_BASE ?? "http://localhost:1420";
  const details = {};
  const fail = [];
  const check = (name, pass, info) => {
    details[name] = { pass: !!pass, ...(info === undefined ? {} : { info }) };
    if (!pass) fail.push(name);
  };
  const ve = (fn, arg) => page.evaluate(fn, arg);
  const shot = (name) => page.screenshot({ path: `scripts/drive/shots/timeline-ux-${name}.png` }).catch(() => null);
  const HEADER_W = 112; // Timeline.tsx

  await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "dark" });
  await page.goto(base);
  await page.waitForFunction(() => !!window.videoEditor);
  await page.click(".create-card");
  await page.waitForSelector(".library-panel");
  const ids = await ve(async (base) => {
    const v = window.videoEditor;
    const src = (n) => ({ name: n, src: `${base}/fixtures/media/${n}` });
    const [video, photo, music] = await v.import([src("h264-1080p30.mp4"), src("photo.png"), src("music-30s.mp3")]);
    // Shots of 3 s, 2 s and 2 s (unequal, so the drag below reorders by
    // center unambiguously), music from 00:00 under all of them.
    v.exec("add_media_clip", { asset_id: video.id, start: 0, duration: 3 });
    v.exec("add_media_clip", { asset_id: video.id, start: 3, in: 3, duration: 2 });
    v.exec("add_media_clip", { asset_id: video.id, start: 5, in: 5, duration: 2 });
    v.exec("add_media_clip", { asset_id: music.id, start: 0, duration: 9 });
    v.select([]);
    v.seek(0);
    return { video: video.id, photo: photo.id, music: music.id };
  }, base);
  await page.waitForTimeout(300);

  const zoom = () => ve(() => window.videoEditor.state().zoom);
  const tl = await page.locator(".tl-scroll").boundingBox();
  const xAt = async (f) => tl.x + HEADER_W + f * (await zoom()) - (await page.locator(".tl-scroll").evaluate((el) => el.scrollLeft));
  const tracks = () => ve(() => window.videoEditor.project().tracks.map((t) => ({ name: t.name, main: !!t.main, clips: t.clips.map((c) => ({ id: c.id, type: c.type, start: c.start, duration: c.duration, assetId: c.assetId })) })));
  const mainClips = async () => (await tracks()).find((t) => t.main).clips;

  /** A real pointer drag from a library card to (x, y); `during` runs while
   * the pointer is held over the target. */
  const dragCard = async (card, x, y, during) => {
    const from = await card.boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    const steps = 16;
    for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + (x - from.x) * (i / steps), from.y + (y - from.y) * (i / steps));
    await page.waitForTimeout(250); // the making-room slide
    const seen = during ? await during() : null;
    await page.mouse.up();
    await page.waitForTimeout(200);
    return seen;
  };
  /** What the drop preview shows, in frames and px. */
  const preview = () =>
    page.evaluate((HEADER_W) => {
      const z = window.videoEditor.state().zoom;
      const d = document.querySelector(".tl-drop");
      const bar = document.querySelector(".tl-insert");
      const main = document.querySelector(".tl-row.main");
      const shifted = [...main.querySelectorAll(".clip")].map((c) => new DOMMatrix(getComputedStyle(c).transform).m41);
      return {
        frame: d ? Math.round((parseFloat(d.style.left) - HEADER_W) / z) : null,
        top: d ? parseFloat(d.style.top) : null,
        onMainRow: d ? parseFloat(d.style.top) === parseFloat(main.style.top) : false,
        bar: bar ? Math.round((parseFloat(bar.style.left) + 1 - HEADER_W) / z) : null,
        clipX: shifted,
      };
    }, HEADER_W);

  await page.click('.lib-tab:has-text("Media")');
  const photoCard = page.locator(".media-card", { hasText: "photo.png" });
  const mainRow = await page.locator(".tl-row.main").boundingBox();

  // ---- UX-13: drop on the middle of a main clip -----------------------------------------
  // Frame 70 is inside the first shot (0-90), nearer its end: the magnet
  // inserts at the cut at 90, so the preview must sit there, not at 70.
  const before13 = await mainClips();
  const seen = await dragCard(photoCard, await xAt(70), mainRow.y + mainRow.height / 2, async () => {
    await shot("ux13-insert-preview");
    return preview();
  });
  const after13 = await mainClips();
  const photo13 = after13.find((c) => c.assetId === ids.photo);
  const z = await zoom();
  check(
    "UX-13 the preview snaps to the cut the magnet uses",
    seen.frame === 90 && seen.bar === 90 && seen.onMainRow,
    seen,
  );
  check(
    "UX-13 later shots make room while dragging",
    Math.abs(seen.clipX[1] - (90 + 150) * z) < 2 && Math.abs(seen.clipX[0]) < 1,
    { clipX: seen.clipX, want: [0, (90 + 150) * z] },
  );
  check(
    "UX-13 the photo lands where the preview showed",
    photo13 && photo13.start === 90 && after13.length === before13.length + 1 && after13.map((c) => c.start).join() === "0,90,240,300",
    after13.map((c) => [c.type, c.start, c.duration]),
  );
  await shot("ux13-after-drop");
  await ve(() => window.videoEditor.action("undo"));

  // ---- UX-12: drop above the tracks -------------------------------------------------------
  const ruler = await page.locator(".tl-ruler").boundingBox();
  const seen12 = await dragCard(photoCard, await xAt(60), ruler.y + ruler.height / 2, async () => {
    await shot("ux12-overlay-preview");
    return preview();
  });
  const t12 = await tracks();
  const overlay = t12[0];
  check(
    "UX-12 dropping above the tracks makes an overlay at the drop time",
    !overlay.main && overlay.clips.length === 1 && overlay.clips[0].assetId === ids.photo && overlay.clips[0].start === 60 && t12.find((t) => t.main).clips.length === 3,
    { preview: seen12, tracks: t12.map((t) => [t.name, t.clips.map((c) => `${c.type}@${c.start}`).join(" ")]) },
  );
  await shot("ux12-after-drop");
  await ve(() => window.videoEditor.action("undo"));

  // ---- UX-14: reorder with a music bed and a title ---------------------------------------
  await ve(() => {
    const v = window.videoEditor;
    v.exec("add_text", { text: "On shot one", start: 0.5, duration: 2 });
    v.select([]);
  });
  const title = (await tracks()).flatMap((t) => t.clips).find((c) => c.type === "text");
  const second = (await mainClips())[1];
  const secondEl = page.locator(`.clip[data-clip="${second.id}"]`);
  const sb = await secondEl.boundingBox();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(sb.x + sb.width / 2 - ((sb.x - tl.x - HEADER_W + 40) * i) / 12, sb.y + sb.height / 2);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const all14 = (await tracks()).flatMap((t) => t.clips);
  const main14 = await mainClips();
  check(
    "UX-14 the second shot moved to the front",
    main14[0].id === second.id && main14.map((c) => c.start).join() === "0,60,150",
    main14.map((c) => [c.id, c.start]),
  );
  check("UX-14 the music bed stays at 00:00", all14.find((c) => c.assetId === ids.music)?.start === 0, all14.find((c) => c.assetId === ids.music));
  check("UX-14 the title follows its shot", all14.find((c) => c.id === title.id)?.start === title.start + 60, { was: title.start, now: all14.find((c) => c.id === title.id)?.start });
  await shot("ux14-after-reorder");

  // ---- UX-15: a new title is visible -----------------------------------------------------
  /** Mean luminance of the upper-middle band where a centered title sits. */
  const titleBand = () =>
    ve(async () => {
      const v = window.videoEditor;
      await new Promise((r) => setTimeout(r, 40));
      await v.rendered();
      const { width: w, height: h, data } = v.pixels();
      let white = 0;
      let n = 0;
      for (let y = Math.floor(h * 0.4); y < h * 0.6; y += 2)
        for (let x = Math.floor(w * 0.3); x < w * 0.7; x += 2) {
          const i = (y * w + x) * 4;
          if (data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235) white++;
          n++;
        }
      return white / n;
    });
  // A plain background for the title: a dark color clip over everything.
  await ve(() => {
    const v = window.videoEditor;
    v.exec("add_color_clip", { color: "#202020", start: 7, duration: 6 });
    v.select([]);
    v.seek(8 * 30);
  });
  const plain = await titleBand();
  await page.click('.lib-tab:has-text("Text")');
  await page.locator('.card-add[aria-label="Add Title"]').click({ force: true });
  const motion = await ve(async () => {
    const v = window.videoEditor;
    const s0 = v.state();
    const id = s0.selection[0];
    const c = v.project().tracks.flatMap((t) => t.clips).find((x) => x.id === id);
    const frames = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 3000) {
      const s = v.state();
      frames.push(s.playhead);
      if (!s.playing && performance.now() - t0 > 100) break;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return { start: c.start, animIn: c.animIn?.duration, played: s0.playing || frames.some((f, i) => i && f !== frames[0]), frames: [...new Set(frames)], playhead: v.state().playhead, playing: v.state().playing };
  });
  const shown = await titleBand();
  await shot("ux15-title-after-add");
  check(
    "UX-15 adding an animated title plays its In once and parks where it has settled",
    motion.played && !motion.playing && motion.playhead >= motion.start + motion.animIn && motion.playhead < motion.start + 90,
    motion,
  );
  check("UX-15 the viewer shows the title right after it is added", plain < 0.002 && shown > 0.01, { plain, shown });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await ve(() => {
    window.videoEditor.select([]);
    window.videoEditor.seek(11 * 30);
  });
  const plain2 = await titleBand();
  await page.locator('.card-add[aria-label="Add Title"]').click({ force: true });
  const still = await ve(() => ({ playing: window.videoEditor.state().playing, playhead: window.videoEditor.state().playhead }));
  const shown2 = await titleBand();
  check("UX-15 reduced motion shows the settled title at once", !still.playing && still.playhead > 11 * 30 && plain2 < 0.002 && shown2 > 0.01, { ...still, plain2, shown2 });
  await page.emulateMedia({ reducedMotion: "no-preference" });

  return { ok: fail.length === 0, failed: fail, details };
};
