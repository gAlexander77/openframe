// Animation presets preview on pick, as CapCut's do: picking an In plays
// the clip's first frames to where the In settles, once and silently, and
// stops there; an Out plays to the clip's last frame; a loop one cycle.
// And no two tiles draw the same picture.
async (page) => {
  page.setDefaultTimeout(6000);
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(() => {
    const ve = window.videoEditor;
    ve.exec("add_color_clip", { color: "#225588", start: 0, duration: 6 });
    ve.exec("add_text", { text: "Preview", start: 0, duration: 6 });
    ve.select([ve.project().tracks.flatMap((t) => t.clips).find((c) => c.type === "text").id]);
    ve.seek(90);
  });
  const inspector = page.getByRole("region", { name: "Inspector" });
  await inspector.getByRole("tab", { name: "Animation" }).click();
  const state = () => page.evaluate(() => ({ playing: window.videoEditor.state().playing, at: window.videoEditor.state().playhead }));
  /** Pick a preset and watch the transport until it stops. */
  const pick = async (slot, name) => {
    const home = (await state()).at;
    await inspector.getByRole("radio", { name: slot, exact: true }).click();
    // Observe after React handles the click, in the same browser task.
    // Playwright's click can return several frames into a running preview.
    await page.evaluate(() => {
      window.__presetStart = null;
      document.addEventListener("click", () => {
        const s = window.videoEditor.state();
        window.__presetStart = { playing: s.playing, at: s.playhead, ms: performance.now() };
      }, { once: true });
    });
    await inspector.locator(".anim-tile", { hasText: new RegExp(`^${name}$`) }).click();
    const start = await page.evaluate(() => ({ ...window.__presetStart, afterClickMs: Math.round(performance.now() - window.__presetStart.ms) }));
    const seen = [await state()];
    const afterClick = seen[0].at;
    for (let i = 0; i < 40 && seen.at(-1).playing; i++) {
      await page.waitForTimeout(100);
      seen.push(await state());
    }
    // It plays the animation's section, then returns the playhead where it
    // was (as adding a title does): browsing presets never moves the edit.
    return { started: start.playing, first: start.at, afterClick, afterClickMs: start.afterClickMs, stoppedAt: seen.at(-1).at, stopped: !seen.at(-1).playing, home };
  };
  const details = {};
  const rise = await pick("In", "Rise");
  details.inPlays = { ok: rise.started && rise.first <= 3 && rise.stopped && rise.stoppedAt === rise.home, ...rise };
  const fade = await pick("Out", "Fade");
  details.outPlays = { ok: fade.started && fade.first >= 160 && fade.stopped && fade.stoppedAt === fade.home, ...fade };
  const pulse = await pick("Loop", "Pulse");
  details.loopPlays = { ok: pulse.started && pulse.stopped && pulse.stoppedAt === pulse.home, ...pulse };
  details.stillAfter = { ok: await page.evaluate(() => !window.videoEditor.state().playing) };

  // Every tile its own picture, in each slot.
  for (const slot of ["In", "Out", "Loop"]) {
    await inspector.getByRole("radio", { name: slot, exact: true }).click();
    const pictures = await inspector.locator(".anim-tile .anim-demo").evaluateAll((els) => els.map((e) => e.innerHTML));
    details[`distinct${slot}`] = { ok: pictures.length > 5 && new Set(pictures).size === pictures.length, tiles: pictures.length };
  }
  await inspector.getByRole("radio", { name: "In", exact: true }).click();
  await inspector.locator(".anim-grid").scrollIntoViewIfNeeded();
  await inspector.locator(".anim-grid").screenshot({ path: "scratch/animation-presets.png" });
  return { ok: Object.values(details).every((d) => d.ok), details };
};
