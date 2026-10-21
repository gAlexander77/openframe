// Markers that follow a clip, as the Markers tab shows them (ADR-119), at
// 1280 x 720 and 1920 x 1080: a song's Bar markers (set_music_grid) and a
// marker of the timeline's own:
// - a marker on a clip names its clip (and says so to a screen reader);
//   the timeline's own names none;
// - searching the clip's name lists its markers;
// - Detach makes one the timeline's own where it stands (one undo step,
//   update_marker detach, the agent's command): moving the song then moves
//   its other markers and leaves the detached one;
// - the editor of a following marker says a new position detaches it;
// - the tab never scrolls sideways.
// Screenshots go to scripts/drive/shots/.
async (page) => {
  page.setDefaultTimeout(6000);
  const details = {};
  const check = (name, ok, extra = {}) => (details[name] = { ok: !!ok, ...extra });
  const dir = "scripts/drive/shots/";
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
      const ve = window.videoEditor;
      const [song] = await ve.import([{ name: "music-30s.mp3", src: `${location.origin}/fixtures/media/music-30s.mp3` }]);
      ve.exec("add_track", { kind: "audio", name: "Music", role: "music" });
      const mu = ve.project().tracks.find((t) => t.name === "Music").id;
      ve.exec("add_media_clip", { asset_id: song.id, start: 0, duration: 12, track_id: mu });
      const clip = ve.project().tracks.find((t) => t.id === mu).clips[0].id;
      ve.exec("set_music_grid", { clip_id: clip, bpm: 120, first_downbeat: 0, markers: ["bars"] });
      ve.exec("add_marker", { at: 5.5, label: "Title in", color: "#3be0f0" });
      return { clip };
    });
    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.getByRole("menuitem", { name: "Markers", exact: true }).click();
    const panel = page.locator(".markers-tab");
    await panel.waitFor();
    const markers = () => page.evaluate(() => window.videoEditor.project().markers);
    const rows = panel.locator(".marker-row");
    const bars = (await markers()).filter((m) => m.label === "Bar");
    const barRow = rows.filter({ hasText: "Bar" }).nth(1);
    const ownRow = rows.filter({ hasText: "Title in" });
    check(`${w}: a song's markers name their clip; the timeline's own name none`, bars.length === 6 && (await barRow.locator(".marker-follows").textContent()).includes("music-30s.mp3") && (await ownRow.locator(".marker-follows").count()) === 0 && /, on music-30s\.mp3$/.test(await barRow.locator(".marker-jump").getAttribute("aria-label")), { bars: bars.length });
    check(`${w}: only a following marker can be detached`, (await barRow.getByRole("button", { name: /^Detach Bar from music-30s\.mp3$/ }).count()) === 1 && (await ownRow.getByRole("button", { name: /^Detach/ }).count()) === 0);
    await panel.screenshot({ path: `${dir}markers-follow-${w}.png` });

    // Search by the song's name.
    await panel.getByRole("textbox", { name: "Search markers" }).fill("music-30s");
    await page.waitForTimeout(100);
    check(`${w}: the clip's name finds its markers`, (await rows.count()) === 6);
    await panel.getByRole("textbox", { name: "Search markers" }).fill("");

    // Detach the second Bar (2 s), then move the song 1 s later.
    const second = bars[1];
    await barRow.getByRole("button", { name: /^Detach/ }).click();
    await page.waitForTimeout(150);
    const after = (await markers()).find((m) => m.id === second.id);
    check(`${w}: Detach keeps it where it stands, as the timeline's own`, !after.follows && after.frame === second.frame && (await page.evaluate(() => window.videoEditor.state().undoLabel)) === "Detach marker" && (await rows.filter({ hasText: "Bar" }).nth(1).locator(".marker-follows").count()) === 0);
    await page.evaluate((id) => window.videoEditor.exec("move_clip", { clip_id: id, start: 1 }), ids.clip);
    await page.waitForTimeout(150);
    const moved = await markers();
    check(`${w}: the song's other markers move with it, the detached one stays`, moved.find((m) => m.id === second.id).frame === second.frame && moved.find((m) => m.id === bars[2].id).frame === bars[2].frame + 30, { second: moved.find((m) => m.id === second.id), third: moved.find((m) => m.id === bars[2].id) });

    // The editor of a following marker.
    await rows.filter({ hasText: "Bar" }).nth(2).locator(".marker-jump").click();
    await page.waitForTimeout(150);
    check(`${w}: the editor says a new position detaches it`, /It moves with music-30s\.mp3; a new position detaches it\./.test(await panel.locator("#marker-time-hint").textContent()));
    await panel.screenshot({ path: `${dir}markers-follow-${w}-editor.png` });
    check(`${w}: the tab never scrolls sideways`, await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  }
  return { ok: Object.values(details).every((d) => d.ok), details };
};
