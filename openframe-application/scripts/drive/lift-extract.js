// Lift and Extract drive (Premiere's ; and '): with In at 1 s and Out at
// 2 s, Extract removes that second from every unlocked track and closes
// it; Lift on an overlay track leaves the gap. The marks clear after.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(async () => {
    const api = window.videoEditor;
    const [fc] = await api.import([{ name: "framecode-30.mp4", src: location.origin + "/fixtures/media/framecode-30.mp4" }]);
    api.exec("add_media_clip", { asset_id: fc.id, start: 0, duration: 4 });
    api.exec("add_track", { kind: "video", name: "Over" });
    const t = api.project().tracks.find((x) => x.name === "Over").id;
    api.exec("add_color_clip", { color: "#a04040", start: 0.5, duration: 3, track_id: t });
  });
  const layout = () =>
    page.evaluate(() => {
      const ts = window.videoEditor.project().tracks;
      const at = (t) => JSON.stringify(t.clips.map((c) => [c.start, c.duration]));
      return { main: at(ts.find((t) => t.main)), over: at(ts.find((t) => t.name === "Over")) };
    });
  const mark = async () => {
    await page.locator(".tl-ruler").click({ position: { x: 900, y: 10 } });
    await page.evaluate(() => window.videoEditor.seek(30));
    await page.keyboard.press("I");
    await page.evaluate(() => window.videoEditor.seek(60));
    await page.keyboard.press("O");
  };
  const details = {};
  await mark();
  await page.keyboard.press("'");
  const ex = await layout();
  details.extract = { ok: ex.main === "[[0,30],[30,60]]" && ex.over === "[[15,15],[30,45]]", ex };
  details.marksCleared = { ok: await page.evaluate(() => window.videoEditor.state().inPoint === null && window.videoEditor.state().outPoint === null) };
  await page.evaluate(() => window.videoEditor.action("undo"));
  await mark();
  await page.keyboard.press(";");
  const lift = await layout();
  // The overlay keeps a gap from 1 s to 2 s; the magnetic main track closes.
  details.lift = { ok: lift.main === "[[0,30],[30,60]]" && lift.over === "[[15,15],[60,45]]", lift };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
