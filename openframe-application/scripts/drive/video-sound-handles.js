// A video's own sound on the timeline (Premiere's audio handles, CapCut's
// volume line): a selected video clip with sound shows the volume line and
// fade knobs on its waveform strip, as audio clips do. Dragging the fade-in
// knob right fades the sound in, and dragging the line down lowers it,
// each one undo step.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const id = await page.evaluate(async () => {
    const api = window.videoEditor;
    const [v] = await api.import([{ name: "talk-gaps.mp4", src: location.origin + "/fixtures/media/talk-gaps.mp4" }]);
    api.exec("add_media_clip", { asset_id: v.id, start: 0, duration: 6 });
    const c = api.project().tracks.flatMap((t) => t.clips).find((x) => x.type === "video");
    api.select([c.id]);
    return c.id;
  });
  const clip = page.locator(`[data-clip="${id}"]`);
  const read = () => page.evaluate((id) => {
    const c = window.videoEditor.project().tracks.flatMap((t) => t.clips).find((x) => x.id === id);
    return { fadeIn: c.fadeIn, volume: c.volume, undo: window.videoEditor.state().undoLabel };
  }, id);
  const details = {};
  const knob = clip.locator(".fade-knob.in");
  details.shown = { ok: (await knob.count()) === 1 && (await clip.locator(".vol-line").count()) === 1 };
  await page.screenshot({ path: "__REPO__/scratch/video-sound-handles.png" });

  const k = await knob.boundingBox();
  await page.mouse.move(k.x + k.width / 2, k.y + k.height / 2);
  await page.mouse.down();
  await page.mouse.move(k.x + k.width / 2 + 60, k.y + k.height / 2, { steps: 5 });
  await page.mouse.up();
  const faded = await read();
  details.fadeIn = { ok: faded.fadeIn > 0 && faded.undo === "Fade in", ...faded };

  const line = await clip.locator(".vol-line").boundingBox();
  await page.mouse.move(line.x + line.width / 2, line.y + line.height / 2);
  await page.mouse.down();
  await page.mouse.move(line.x + line.width / 2, line.y + line.height / 2 + 5, { steps: 5 });
  await page.mouse.up();
  const quieter = await read();
  // 5 px of a 60 px range is 4 of the strip's 48 dB.
  const db = 20 * Math.log10(quieter.volume);
  details.volume = { ok: db < -2 && db > -7 && quieter.undo === "Volume", db, ...quieter };
  // Like an audio clip's, the handles show only on the selected clip.
  details.unselectedHidden = {
    ok: await page.evaluate(() => (window.videoEditor.select([]), true)).then(async () => (await clip.locator(".fade-knob").count()) === 0),
  };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
