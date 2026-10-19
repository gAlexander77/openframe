// Gaps drive: right-click an empty stretch of an overlay track for Close
// gap and Close all gaps (ripple), and nudge clips by frames with Premiere's
// Alt+arrows (Shift: five frames), all or nothing.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const ids = await page.evaluate(() => {
    const api = window.videoEditor;
    api.exec("add_color_clip", { color: "#203040", start: 0, duration: 6 });
    api.exec("add_track", { kind: "video", name: "V2" });
    const t = api.project().tracks.find((x) => x.name === "V2").id;
    api.exec("add_color_clip", { color: "#a04040", start: 0.5, duration: 1, track_id: t });
    api.exec("add_color_clip", { color: "#40a040", start: 2, duration: 1, track_id: t });
    api.exec("add_color_clip", { color: "#4040a0", start: 4, duration: 1, track_id: t });
    return { t, clips: api.project().tracks.find((x) => x.id === t).clips.map((c) => c.id) };
  });
  const starts = () => page.evaluate((t) => window.videoEditor.project().tracks.find((x) => x.id === t).clips.map((c) => c.start), ids.t);
  const clipBox = (id) => page.locator(`[data-clip="${id}"]`).boundingBox();
  const details = {};
  const a = await clipBox(ids.clips[0]), b = await clipBox(ids.clips[1]);
  if (!a || !b) return { ok: false, details: { clipsFound: { ok: false } } };
  // Between the first and second clips (1.5 s .. 2 s): close that gap only.
  await page.mouse.click((a.x + a.width + b.x) / 2, a.y + a.height / 2, { button: "right" });
  await page.getByRole("menuitem", { name: "Close gap" }).click();
  details.closeGap = { ok: JSON.stringify(await starts()) === JSON.stringify([15, 45, 105]), starts: await starts() };
  // Close all: packs from 0.
  const c = await clipBox(ids.clips[2]), b2 = await clipBox(ids.clips[1]);
  await page.mouse.click((b2.x + b2.width + c.x) / 2, c.y + c.height / 2, { button: "right" });
  await page.getByRole("menuitem", { name: "Close all gaps on this track" }).click();
  details.closeAll = { ok: JSON.stringify(await starts()) === JSON.stringify([0, 30, 60]), starts: await starts() };
  await page.evaluate(() => window.videoEditor.action("undo"));

  // Nudge the last clip: Alt+Right one frame, Alt+Shift+Left five.
  await page.evaluate((id) => window.videoEditor.select([id]), ids.clips[2]);
  await page.locator(".tl-ruler").click({ position: { x: 900, y: 10 } }); // focus the timeline
  await page.evaluate((id) => window.videoEditor.select([id]), ids.clips[2]);
  await page.keyboard.press("Alt+ArrowRight");
  const r1 = (await starts())[2];
  await page.keyboard.press("Alt+Shift+ArrowLeft");
  const r2 = (await starts())[2];
  details.nudge = { ok: r1 === 106 && r2 === 101, r1, r2 };
  // Into the neighbor: nothing moves.
  await page.evaluate((id) => window.videoEditor.select([id]), ids.clips[0]);
  const before = await starts();
  await page.evaluate((id) => window.videoEditor.exec("nudge_clips", { clip_ids: [id], frames: 40 }), ids.clips[0]);
  details.blocked = { ok: JSON.stringify(await starts()) === JSON.stringify(before) };
  // No gap under the pointer: no Close gap item.
  const a2 = await clipBox(ids.clips[0]);
  await page.mouse.click(a2.x + a2.width / 2, a2.y + a2.height / 2 + 300, { button: "right" });
  details.noItemOffTrack = { ok: (await page.getByRole("menuitem", { name: "Close gap" }).count()) === 0 };
  await page.keyboard.press("Escape");
  return { ok: Object.values(details).every((d) => d.ok), details };
};
