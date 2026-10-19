// Timeline UX drive (UX-12 to UX-15 in docs/UX audit 2026-10-14.md), with
// real pointer drags from the library to the timeline. Every drop is
// checked against what its preview showed just before the release: the
// row (or the new track and where it goes in), the frame and the length.
// - a photo dragged over the middle of a main clip previews at the cut the
//   magnet will use, with an insertion bar and the later clips making room,
//   and lands exactly there (UX-13);
// - a photo dropped above the tracks becomes an overlay at the drop time
//   (UX-12); on a busy overlay row it opens a new track just above it;
// - music on a busy audio row, a title over the main track, an effect on
//   empty timeline (with a clip selected) and a transition near a cut all
//   land where their previews show;
// - dragging the second shot to the front leaves the music bed at 00:00
//   while the title on the first shot follows it (UX-14);
// - a title added from the Text tab plays its In animation and is visible
//   in the viewer once added, then restores the playhead; reduced motion skips it
//   (UX-15).
//
// Needs the dev server and fixtures (node scripts/make-fixtures.mjs). Run
// with node scripts/drive/run.mjs (--base for a worktree's server).
// Screenshots go to scripts/drive/shots/. Returns { ok, failed, details }.
async (page) => {
  const base = "http://localhost:1420";
  page.setDefaultTimeout(15000);
  const details = {};
  const failed = [];
  const check = (name, ok, info) => {
    details[name] = { ok: !!ok, ...(info === undefined ? {} : { info }) };
    if (!ok) failed.push(name);
  };
  const ve = (fn, arg) => page.evaluate(fn, arg);
  const shot = (name) => page.screenshot({ path: `scripts/drive/shots/timeline-ux-${name}.png` }).catch(() => null);
  const undo = () => ve(() => window.videoEditor.action("undo"));

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
  // Timeline.tsx's HEADER_W, read from the page so a wider column cannot
  // throw every position off.
  const HEADER_W = await page.locator(".tl-corner").evaluate((el) => el.offsetWidth);

  const zoom = () => ve(() => window.videoEditor.state().zoom);
  const tl = await page.locator(".tl-scroll").boundingBox();
  const xAt = async (f) => tl.x + HEADER_W + f * (await zoom()) - (await page.locator(".tl-scroll").evaluate((el) => el.scrollLeft));
  /** The vertical middle of timeline row `i` (0 = top track). */
  const yOfRow = async (i) => {
    const b = await page.locator(".tl-row").nth(i).boundingBox();
    return b.y + b.height / 2;
  };
  const tracks = () => ve(() => window.videoEditor.project().tracks.map((t) => ({ id: t.id, name: t.name, main: !!t.main, clips: t.clips.map((c) => ({ id: c.id, type: c.type, start: c.start, duration: c.duration, assetId: c.assetId, transitionOut: c.transitionOut, effects: c.effects?.length ?? 0 })) })));
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
  /** What the drop preview shows: the row it lands on (for a new track, the
   * index the track goes in at), the frame and length, in project terms. */
  const preview = () =>
    page.evaluate((HEADER_W) => {
      const z = window.videoEditor.state().zoom;
      const d = document.querySelector(".tl-drop");
      const bar = document.querySelector(".tl-insert");
      const rowTops = [...document.querySelectorAll(".tl-row")].map((r) => parseFloat(r.style.top));
      const main = document.querySelector(".tl-row.main");
      const clipX = [...main.querySelectorAll(".clip")].map((c) => new DOMMatrix(getComputedStyle(c).transform).m41);
      if (!d) return { none: true, clipX };
      const top = parseFloat(d.style.top);
      const newTrack = d.classList.contains("new-track");
      return {
        row: newTrack ? (top < 0 ? 0 : rowTops.filter((t) => t <= top).length) : rowTops.indexOf(top),
        newTrack,
        frame: Math.round((parseFloat(d.style.left) - HEADER_W) / z),
        frames: Math.round(parseFloat(d.style.width) / z),
        insert: d.classList.contains("insert"),
        attach: d.classList.contains("on-clip"),
        onMainRow: !newTrack && top === parseFloat(main.style.top),
        bar: bar ? Math.round((parseFloat(bar.style.left) - HEADER_W) / z) : null,
        clipX,
      };
    }, HEADER_W);
  /** Where the newly added (selected) clip went, in the layout from before
   * the drop, comparable with preview(). */
  const landed = (beforeIds) =>
    ve((beforeIds) => {
      const v = window.videoEditor;
      const p = v.project();
      const id = v.state().selection[0];
      const at = p.tracks.findIndex((t) => t.clips.some((c) => c.id === id));
      if (at < 0) return null;
      const known = new Set(beforeIds);
      const newTrack = !known.has(p.tracks[at].id);
      const c = p.tracks[at].clips.find((x) => x.id === id);
      return { id, type: c.type, row: newTrack ? p.tracks.slice(0, at).filter((t) => known.has(t.id)).length : beforeIds.indexOf(p.tracks[at].id), newTrack, frame: c.start, frames: c.duration };
    }, beforeIds);
  const same = (seen, l) => !!seen && !!l && seen.row === l.row && seen.newTrack === l.newTrack && seen.frame === l.frame && Math.abs(seen.frames - l.frames) <= 1;
  /** Drag `card` to (x, y), and check it landed where the preview showed. */
  const dropAndCompare = async (name, card, x, y) => {
    const beforeIds = (await tracks()).map((t) => t.id);
    const seen = await dragCard(card, x, y, async () => {
      await shot(`${name}-preview`);
      return preview();
    });
    const l = await landed(beforeIds);
    return { seen, landed: l, same: same(seen, l) };
  };

  await page.click('.lib-tab:has-text("Media")');
  const photoCard = page.locator(".media-card", { hasText: "photo.png" });
  const musicCard = page.locator(".media-card", { hasText: "music-30s.mp3" });
  const mainRow = await page.locator(".tl-row.main").boundingBox();

  // ---- UX-13: drop on the middle of a main clip -----------------------------------------
  // Frame 70 is inside the first shot (0-90), nearer its end: the magnet
  // inserts at the cut at 90, so the preview must sit there, not at 70.
  const before13 = await mainClips();
  const r13 = await dropAndCompare("ux13-insert", photoCard, await xAt(70), mainRow.y + mainRow.height / 2);
  const seen = r13.seen;
  const after13 = await mainClips();
  const z = await zoom();
  check("UX-13 the preview snaps to the cut the magnet uses", seen.frame === 90 && seen.bar === 90 && seen.onMainRow && seen.insert, seen);
  check("UX-13 later shots make room while dragging", Math.abs(seen.clipX[1] - (90 + 150) * z) < 2 && Math.abs(seen.clipX[0]) < 1, { clipX: seen.clipX, want: [0, (90 + 150) * z] });
  check(
    "UX-13 the photo lands where the preview showed",
    r13.same && r13.landed.type === "image" && after13.length === before13.length + 1 && after13.map((c) => c.start).join() === "0,90,240,300",
    { ...r13, main: after13.map((c) => [c.type, c.start, c.duration]) },
  );
  await shot("ux13-after-drop");
  await undo();

  // ---- UX-12: drop above the tracks -------------------------------------------------------
  const ruler = await page.locator(".tl-ruler").boundingBox();
  const r12 = await dropAndCompare("ux12-overlay", photoCard, await xAt(60), ruler.y + ruler.height / 2);
  const t12 = await tracks();
  check(
    "UX-12 dropping above the tracks makes an overlay at the drop time",
    r12.same && r12.seen.row === 0 && r12.seen.newTrack && !t12[0].main && t12[0].clips.length === 1 && t12[0].clips[0].assetId === ids.photo && t12[0].clips[0].start === 60 && t12.find((t) => t.main).clips.length === 3,
    { ...r12, tracks: t12.map((t) => [t.name, t.clips.map((c) => `${c.type}@${c.start}`).join(" ")]) },
  );
  await shot("ux12-after-drop");
  await undo();

  // ---- Other kinds land where their previews show ----------------------------------------
  // Music on the busy audio row: a new audio track below it.
  const rAudio = await dropAndCompare("audio-busy", musicCard, await xAt(60), await yOfRow(1));
  check("music on a busy audio row lands on a new track below, as previewed", rAudio.same && rAudio.seen.newTrack && rAudio.seen.row === 2 && rAudio.landed.type === "audio", rAudio);
  await undo();

  // A title dragged over the main track goes above everything showing then.
  await page.click('.lib-tab:has-text("Text")');
  const titleCard = page.locator(".card", { has: page.locator(".card-label", { hasText: /^Title$/ }) }).first();
  const rText = await dropAndCompare("text-over-main", titleCard, await xAt(100), mainRow.y + mainRow.height / 2);
  check("a title over the main track lands on a new top track, as previewed", rText.same && rText.seen.newTrack && rText.seen.row === 0 && rText.landed.type === "text" && rText.landed.frame === 100, rText);
  await undo();

  // An effect dropped on empty timeline is a layer there, even with a clip
  // selected (a drop acts where it lands, never on the selection).
  const first = (await mainClips())[0];
  await ve((id) => window.videoEditor.select([id]), first.id);
  await page.click('.lib-tab:has-text("Effects")');
  const effectCard = page.locator(".card").first();
  const below = (await page.locator(".tl-row").last().boundingBox());
  const rFx = await dropAndCompare("effect-empty", effectCard, await xAt(40), below.y + below.height + 30);
  const firstAfter = (await mainClips()).find((c) => c.id === first.id);
  check(
    "an effect on empty timeline adds a layer where previewed, not to the selection",
    rFx.same && rFx.seen.newTrack && rFx.seen.row === 0 && rFx.landed.type === "adjustment" && rFx.landed.frame === 40 && firstAfter.effects === first.effects,
    { ...rFx, selectedEffects: [first.effects, firstAfter.effects] },
  );
  await undo();
  await ve(() => window.videoEditor.select([]));

  // A transition near a cut previews on that cut and goes on it.
  await page.click('.lib-tab:has-text("Transitions")');
  const transitionCard = page.locator(".card").first();
  const seenTr = await dragCard(transitionCard, await xAt(80), mainRow.y + mainRow.height / 2, async () => {
    await shot("transition-preview");
    return preview();
  });
  const mainTr = await mainClips();
  check(
    "a transition previews on the nearest cut and goes on it",
    seenTr.attach && seenTr.onMainRow && Math.abs(seenTr.frame + seenTr.frames / 2 - 90) <= 1 && !!mainTr[0].transitionOut && !mainTr[1].transitionOut,
    { seen: seenTr, transitions: mainTr.map((c) => c.transitionOut?.type ?? null) },
  );
  await undo();

  // A photo on a busy overlay row between two others: the new track goes in
  // between them, where the preview's band sits.
  await ve(() => {
    const v = window.videoEditor;
    v.exec("add_text", { text: "Lower", start: 1, duration: 3 });
    v.exec("add_text", { text: "Upper", start: 1, duration: 3 });
    v.select([]);
  });
  await page.click('.lib-tab:has-text("Media")');
  const rBand = await dropAndCompare("overlay-busy", photoCard, await xAt(60), await yOfRow(1));
  check("a photo on a busy overlay row opens a track just above it, as previewed", rBand.same && rBand.seen.newTrack && rBand.seen.row === 1 && rBand.landed.type === "image", rBand);
  await undo();
  await undo();
  await undo();

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
  check("UX-14 the second shot moved to the front", main14[0].id === second.id && main14.map((c) => c.start).join() === "0,60,150", main14.map((c) => [c.id, c.start]));
  check("UX-14 the music bed stays at 00:00", all14.find((c) => c.assetId === ids.music)?.start === 0, all14.find((c) => c.assetId === ids.music));
  check("UX-14 the title follows its shot", all14.find((c) => c.id === title.id)?.start === title.start + 60, { was: title.start, now: all14.find((c) => c.id === title.id)?.start });
  await shot("ux14-after-reorder");

  // ---- UX-15: a new title is visible -----------------------------------------------------
  /** Share of near-white pixels in the middle band, where a centered title sits. */
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
  await ve(() => window.videoEditor.seek(8 * 30 + 15));
  const shown = await titleBand();
  await shot("ux15-title-after-add");
  check(
    "UX-15 adding an animated title plays its In once and restores the playhead",
    motion.played && !motion.playing && motion.playhead === motion.start,
    motion,
  );
  check("UX-15 the title renders at its settled frame", plain < 0.002 && shown > 0.01, { plain, shown });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await ve(() => {
    window.videoEditor.select([]);
    window.videoEditor.seek(11 * 30);
  });
  const plain2 = await titleBand();
  await page.locator('.card-add[aria-label="Add Title"]').click({ force: true });
  const still = await ve(() => ({ playing: window.videoEditor.state().playing, playhead: window.videoEditor.state().playhead }));
  const shown2 = await titleBand();
  check("UX-15 reduced motion skips preview and preserves the playhead", !still.playing && still.playhead === 11 * 30 && plain2 < 0.002 && shown2 < 0.002, { ...still, plain2, shown2 });
  await page.emulateMedia({ reducedMotion: "no-preference" });

  return { ok: failed.length === 0, failed, details };
};
