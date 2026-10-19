// Audio scrubbing (ADR-079): dragging the playhead on the ruler while
// paused sounds short snippets of the mix (counted, and heard on the master
// bus's meter); the Preferences switch turns it off; playback is never
// joined by a snippet, and plays without dropped frames after a scrub.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(async () => {
    const api = window.videoEditor;
    const [m] = await api.import([{ name: "music-30s.mp3", src: location.origin + "/fixtures/media/music-30s.mp3" }]);
    api.exec("add_media_clip", { asset_id: m.id, start: 0, duration: 12 });
    // The app's own module instances (see preferences.js).
    const loaded = performance.getEntriesByType("resource").map((e) => e.name);
    const mod = (path) => import(loaded.find((n) => new URL(n).pathname === path) ?? path);
    window.__scrub = await mod("/src/engine/scrub.ts");
    window.__audio = await mod("/src/engine/audio.ts");
  });
  const count = () => page.evaluate(() => window.__scrub.scrubSnippets());
  const ruler = page.locator(".tl-ruler, .timeline-panel canvas").first();
  const box = await page.locator(".timeline-panel").boundingBox();
  // The ruler sits just under the toolbar; drag along it from 1 s to 6 s.
  const rulerY = await page.evaluate(() => {
    const r = document.querySelector(".tl-scroll").getBoundingClientRect();
    return r.top + 12;
  });
  const drag = async (fromX, toX, steps = 25) => {
    let peak = -Infinity;
    await page.mouse.move(fromX, rulerY);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(fromX + ((toX - fromX) * i) / steps, rulerY);
      await page.waitForTimeout(40);
      peak = Math.max(peak, await page.evaluate(() => window.__audio.peakDb(window.__audio.masterBus().left)));
    }
    await page.mouse.up();
    return peak;
  };
  const details = {};
  const x0 = box.x + 136 + 60, x1 = box.x + 136 + 600;

  // On by default: snippets start, and sound reaches the master bus.
  const before = await count();
  const peak = await drag(x0, x1);
  const made = (await count()) - before;
  details.snippets = { ok: made >= 5, made };
  details.heard = { ok: peak > -50, peakDb: Math.round(peak) };
  // One at a time: a 25-step drag over about a second makes no more
  // snippets than fit in it.
  details.oneAtATime = { ok: made <= 25, made };

  // Off in Preferences: silence.
  await page.keyboard.press("Control+,");
  await page.getByRole("switch", { name: "Audio scrubbing" }).click();
  details.switchOff = { ok: (await page.getByRole("switch", { name: "Audio scrubbing" }).getAttribute("aria-checked")) === "false" };
  await page.locator(".prefs-dialog").screenshot({ path: "scratch/audio-scrub-prefs.png" });
  await page.keyboard.press("Escape");
  const off0 = await count();
  await drag(x1, x0);
  details.off = { ok: (await count()) === off0 };
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("ve.prefs") ?? "{}").audioScrub);
  details.kept = { ok: kept === false };

  // Back on; playback: no snippet joins it, and no frames drop.
  await page.keyboard.press("Control+,");
  await page.getByRole("switch", { name: "Audio scrubbing" }).click();
  await page.keyboard.press("Escape");
  await drag(x0, x0 + 200, 8);
  await page.evaluate(() => window.videoEditor.seek(0));
  await page.locator(".play-btn").click();
  await page.waitForTimeout(400);
  const during0 = await count();
  await page.waitForTimeout(1600);
  const stats = await page.evaluate(() => ({ playing: window.videoEditor.state().playing, playhead: window.videoEditor.state().playhead, ...window.videoEditor.playbackStats() }));
  await page.locator(".play-btn").click();
  details.playback = { ok: stats.playing && stats.playhead > 30 && stats.dropped <= 2, stats };
  details.noSnippetWhilePlaying = { ok: (await count()) === during0 };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
