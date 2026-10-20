// A transition dropped on the join of two audio clips makes a crossfade
// (ADR-111), as the clip menu's Crossfade into next clip does (ADR-109):
// a real pointer drag from the Transitions tab onto the cut on a music
// track previews "Crossfade" over the half second before the cut, and
// drops a 0.5 s crossfade (one undo step named Crossfade), the clip
// selected on its Audio tab, no video transition anywhere. Onto a join
// where none fits (the next clip starts at the start of its file) it says
// what to change and adds nothing. At 1280 x 720 and 1920 x 1080.
async (page) => {
  page.setDefaultTimeout(8000);
  const details = {};
  const check = (name, ok, extra = {}) => (details[name] = { ok: !!ok, ...extra });
  for (const [w, h] of [
    [1280, 720],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.reload();
    await page.waitForFunction(() => !!window.videoEditor);
    await page.locator(".create-card").first().click();
    await page.locator(".timeline-panel").waitFor();
    const ids = await page.evaluate(async () => {
      const v = window.videoEditor;
      const [song, song2, video] = await v.import(["music-stereo.m4a", "music-30s.mp3", "h264-1080p30.mp4"].map((n) => ({ name: n, src: `${location.origin}/fixtures/media/${n}` })));
      const main = v.project().tracks.find((t) => t.main).id;
      // Two shots that meet at 5 s too: a drop on the music must not land there.
      v.exec("add_media_clip", { asset_id: video.id, start: 0, duration: 5, track_id: main });
      v.exec("add_media_clip", { asset_id: video.id, start: 5, in: 6, duration: 7, track_id: main });
      v.exec("add_track", { kind: "audio", name: "Music", role: "music" });
      const mu = v.project().tracks.find((t) => t.name === "Music").id;
      v.exec("add_media_clip", { asset_id: song.id, start: 0, duration: 5, track_id: mu });
      v.exec("add_media_clip", { asset_id: song2.id, start: 5, in: 3, duration: 5, track_id: mu });
      v.exec("add_media_clip", { asset_id: song2.id, start: 10, in: 0, duration: 2, track_id: mu });
      const [a, b, c] = v.project().tracks.find((t) => t.id === mu).clips.map((x) => x.id);
      v.select([]);
      v.action("zoomFit");
      return { a, b, c, mu };
    });
    await page.waitForTimeout(300);
    const clips = () => page.evaluate(() => window.videoEditor.project().tracks.flatMap((t) => t.clips));
    const HEADER_W = await page.locator(".tl-corner").evaluate((el) => el.offsetWidth);
    const tl = await page.locator(".tl-scroll").boundingBox();
    const zoom = await page.evaluate(() => window.videoEditor.state().zoom);
    const xAt = async (f) => tl.x + HEADER_W + f * zoom - (await page.locator(".tl-scroll").evaluate((el) => el.scrollLeft));
    const rowIndex = await page.evaluate((mu) => window.videoEditor.project().tracks.findIndex((t) => t.id === mu), ids.mu);
    const row = await page.locator(".tl-row").nth(rowIndex).boundingBox();

    await page.getByRole("tab", { name: "Transitions" }).click();
    const card = page.locator(".card").first();
    await card.waitFor();
    const drag = async (x, during) => {
      const from = await card.boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      for (let i = 1; i <= 16; i++) await page.mouse.move(from.x + (x - from.x) * (i / 16), from.y + (row.y + row.height / 2 - from.y) * (i / 16));
      await page.waitForTimeout(250);
      const seen = during ? await during() : null;
      await page.mouse.up();
      await page.waitForTimeout(300);
      return seen;
    };
    const preview = () =>
      page.evaluate(
        ({ HEADER_W, zoom }) => {
          const d = document.querySelector(".tl-drop");
          if (!d) return null;
          return { label: d.textContent, attach: d.classList.contains("on-clip"), top: parseFloat(d.style.top), frame: Math.round((parseFloat(d.style.left) - HEADER_W) / zoom), frames: Math.round(parseFloat(d.style.width) / zoom) };
        },
        { HEADER_W, zoom },
      );
    const rowTop = await page.locator(".tl-row").nth(rowIndex).evaluate((r) => parseFloat(r.style.top));

    // Onto the join at 5 s, a little before it.
    const seen = await drag(await xAt(140), async () => {
      await page.screenshot({ path: `scripts/drive/shots/crossfade-drop-preview-${w}x${h}.png` });
      return preview();
    });
    check(`${w}: the preview says Crossfade, on the music, over the half second before the cut`, seen?.label === "Crossfade" && seen.attach && seen.top === rowTop && seen.frame === 135 && seen.frames === 15, { seen, rowTop });
    const after = await clips();
    const s = await page.evaluate(() => ({ selection: window.videoEditor.state().selection, undo: window.videoEditor.state().undoLabel }));
    const insp = page.getByRole("region", { name: "Inspector" });
    check(
      `${w}: the drop crossfades the songs, one undo step, on the clip's Audio tab`,
      after.find((c) => c.id === ids.a).crossfade === 0.5 && s.undo === "Crossfade" && s.selection.join() === ids.a && (await insp.getByRole("tab", { selected: true }).textContent()) === "Audio" && (await page.locator(".tl-crossfade").count()) === 1,
      { crossfade: after.find((c) => c.id === ids.a).crossfade, ...s },
    );
    check(`${w}: and puts no video transition anywhere`, after.every((c) => !c.transitionOut), { transitions: after.filter((c) => c.transitionOut).map((c) => c.id) });
    await page.screenshot({ path: `scripts/drive/shots/crossfade-drop-${w}x${h}.png` });

    // Onto the join at 10 s, where the next clip starts at its file's start.
    await drag(await xAt(296));
    const toast = await page.locator(".toast").last().textContent().catch(() => "");
    const later = await clips();
    check(`${w}: where none fits it says what to change and adds nothing`, /trim its start/.test(toast) && !later.find((c) => c.id === ids.b).crossfade && later.every((c) => !c.transitionOut) && (await page.evaluate(() => window.videoEditor.state().undoLabel)) === "Crossfade", { toast });
  }
  return { ok: Object.values(details).every((x) => x.ok), details };
};
