// Playback drive: Loop and Play In to Out on a 2-second timeline.
//   - Play In to Out (Premiere's Ctrl+Shift+Space) plays the range once
//     and stops on its out frame.
//   - With Loop on, playback inside the range goes round it; outside a
//     range, round the whole timeline; it keeps playing past the end.
//   - The loop button shows its state; Loop is per session.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(() => window.videoEditor.exec("add_color_clip", { color: "#408060", start: 0, duration: 2 }));
  const state = () => page.evaluate(() => {
    const s = window.videoEditor.state();
    return { playhead: s.playhead, playing: s.playing, loop: s.loop };
  });
  const details = {};
  // Range 10..20 (frames), played once.
  await page.evaluate(() => {
    window.videoEditor.seek(10);
    window.videoEditor.action("markIn");
    window.videoEditor.seek(20);
    window.videoEditor.action("markOut");
    window.videoEditor.seek(40);
    window.videoEditor.action("playInToOut");
  });
  await page.waitForTimeout(900);
  const once = await state();
  details.inToOut = { ok: !once.playing && once.playhead === 20, ...once };

  // Loop the range: start inside it, it never leaves it.
  await page.getByRole("button", { name: "Loop playback", exact: true }).click();
  const pressed = await page.getByRole("button", { name: "Loop playback", exact: true }).getAttribute("aria-pressed");
  await page.evaluate(() => {
    window.videoEditor.seek(12);
    window.videoEditor.action("playPause");
  });
  const seen = [];
  for (let i = 0; i < 14; i++) {
    await page.waitForTimeout(100);
    seen.push((await state()).playhead);
  }
  const ranged = await state();
  details.loopRange = { ok: pressed === "true" && ranged.playing && seen.every((f) => f >= 10 && f < 20) && seen.some((f, i) => i > 0 && f < seen[i - 1]), seen };
  await page.evaluate(() => window.videoEditor.action("playPause"));

  // Outside the range: round the whole timeline, past its end.
  await page.evaluate(() => {
    window.videoEditor.seek(45);
    window.videoEditor.action("playPause");
  });
  await page.waitForTimeout(1000);
  const whole = await state();
  details.loopWhole = { ok: whole.playing && whole.playhead < 45, ...whole };
  await page.evaluate(() => window.videoEditor.action("playPause"));

  // Off again: playback stops at the end.
  await page.keyboard.press("Control+L");
  await page.evaluate(() => {
    window.videoEditor.seek(50);
    window.videoEditor.action("playPause");
  });
  await page.waitForTimeout(700);
  const off = await state();
  details.loopOff = { ok: !off.loop && !off.playing && off.playhead === 60, ...off };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
