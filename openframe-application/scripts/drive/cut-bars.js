// Cut bars out of a song as a person does it (ADR-119), at 1280 x 720 and
// 1920 x 1080: In and Out marked around the bars on a song with a grid,
// the clip menu's Cut bars runs cut_music (the agent's command) on the
// nearest bar lines:
// - the menu names the bars it takes ("Cut 4 bars (In to Out)");
// - the song is cut on its bars, the piece after plays on whole bars later
//   in its file, joined with cut_music's short crossfade, drawn as one;
//   the marks go, the playhead stays at the cut, one undo step brings it back;
// - with no marks, or no grid, it says what to do and changes nothing;
// - a voice line is offered no Cut bars.
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
      const src = (n) => ({ name: n, src: `${location.origin}/fixtures/media/${n}` });
      const [song, other, voice] = await ve.import([src("music-30s.mp3"), src("music-stereo.m4a"), src("voice-8s.wav")]);
      ve.exec("add_track", { kind: "audio", name: "Music", role: "music" });
      ve.exec("add_track", { kind: "audio", name: "Voiceover", role: "dialog" });
      ve.exec("add_track", { kind: "audio", name: "Song 2", role: "music" });
      const mu = ve.project().tracks.find((t) => t.name === "Music").id;
      const mu2 = ve.project().tracks.find((t) => t.name === "Song 2").id;
      const vo = ve.project().tracks.find((t) => t.name === "Voiceover").id;
      ve.exec("add_media_clip", { asset_id: song.id, start: 0, duration: 20, track_id: mu });
      ve.exec("add_media_clip", { asset_id: song.id, in: 20, start: 22, duration: 4, track_id: mu });
      ve.exec("add_media_clip", { asset_id: other.id, start: 0, track_id: mu2 });
      ve.exec("add_media_clip", { asset_id: voice.id, start: 0, track_id: vo });
      const [a, after] = ve.project().tracks.find((t) => t.id === mu).clips.map((c) => c.id);
      const b = ve.project().tracks.find((t) => t.id === mu2).clips[0].id;
      const v = ve.project().tracks.find((t) => t.id === vo).clips[0].id;
      ve.exec("set_music_grid", { clip_id: a, bpm: 120, first_downbeat: 0 });
      return { a, after, b, v, mu };
    });
    const clips = () => page.evaluate((mu) => window.videoEditor.project().tracks.find((t) => t.id === mu).clips, ids.mu);
    const state = () => page.evaluate(() => {
      const s = window.videoEditor.state();
      return { undo: s.undoLabel, inPoint: s.inPoint, outPoint: s.outPoint, playhead: s.playhead };
    });
    const item = () => page.locator(".timeline-panel .menu .menu-item").filter({ has: page.locator(".menu-label", { hasText: /^Cut (bars|\d+ bars?)/ }) });
    const menuOn = async (id) => {
      await page.locator(`[data-clip="${id}"]`).click({ button: "right", position: { x: 30, y: 12 } });
      await page.waitForTimeout(300);
    };
    const toasts = () => page.locator(".toast").allTextContents();

    // No marks: it says so.
    await menuOn(ids.a);
    check(`${w}: a song's menu offers Cut bars`, (await item().count()) === 1 && (await item().locator(".menu-label").textContent()) === "Cut bars");
    await item().click();
    await page.waitForTimeout(250);
    check(`${w}: with no marks it says to mark In and Out`, (await toasts()).some((t) => /Mark In and Out around the bars/.test(t)) && (await clips()).length === 2);

    // In at 4.1 s, Out at 11.9 s: four bars, 4-12 s.
    await page.evaluate(() => {
      const ve = window.videoEditor;
      ve.seek(123);
      ve.action("markIn");
      ve.seek(357);
      ve.action("markOut");
    });
    await menuOn(ids.a);
    check(`${w}: the menu names the bars it takes`, (await item().locator(".menu-label").textContent()) === "Cut 4 bars (In to Out)");
    await page.screenshot({ path: `${dir}cut-bars-${w}-menu.png` });
    await item().click();
    await page.waitForTimeout(300);
    const [p1, p2, rest] = await clips();
    const s1 = await state();
    check(`${w}: the song is cut on its bars and joined with a crossfade`, p1.id === ids.a && p1.in === 0 && p1.duration === 120 && p2.start === 120 && Math.abs(p2.in - 12) < 1e-6 && p1.crossfade === 0.03 && rest.id === ids.after && rest.start === 22 * 30 - 240, { p1, p2, rest });
    check(`${w}: one undo step, the marks gone, the playhead at the cut`, s1.undo === "Cut 4 bars" && s1.inPoint === null && s1.outPoint === null && s1.playhead === 123, s1);
    check(`${w}: the join is drawn as a crossfade`, (await page.locator(".tl-crossfade").count()) === 1);
    await page.screenshot({ path: `${dir}cut-bars-${w}-done.png` });
    await page.evaluate(() => window.videoEditor.action("undo"));
    await page.waitForTimeout(200);
    const back = await clips();
    check(`${w}: undo brings the bars back`, back.length === 2 && back[0].duration === 600);

    // No grid: it says how to give one.
    await page.evaluate(() => {
      const ve = window.videoEditor;
      ve.seek(30);
      ve.action("markIn");
      ve.seek(200);
      ve.action("markOut");
    });
    await menuOn(ids.b);
    await item().click();
    await page.waitForTimeout(250);
    check(`${w}: a song with no grid says how to give one`, (await toasts()).some((t) => /Detect beat grid in the Audio tab/.test(t)) && (await clips()).length === 2);

    // A voice line: none.
    await menuOn(ids.v);
    check(`${w}: a voice line is offered no Cut bars`, (await item().count()) === 0);
    await page.keyboard.press("Escape");
  }
  return { ok: Object.values(details).every((d) => d.ok), details };
};
