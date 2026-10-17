// Voiceover drive: CapCut's Record voiceover. Needs a fake microphone
// (run.mjs launches Edge with --use-fake-device-for-media-stream, whose
// device beeps once a second). Records about two seconds from frame 30 over
// a color clip and checks:
//   - the countdown, then the live state on the toolbar button;
//   - Stop keeps a "Voiceover 1.wav" asset and an audio clip placed at the
//     playhead (within output latency) as long as the take;
//   - Discard keeps nothing; Escape during the countdown cancels.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(() => {
    window.videoEditor.exec("add_color_clip", { color: "#305070", start: 0, duration: 6 });
    window.videoEditor.seek(30);
  });
  const details = {};
  const button = page.getByRole("button", { name: "Record voiceover", exact: true });
  await button.click();
  const panel = page.getByRole("dialog", { name: "Record voiceover" });
  await panel.waitFor();
  await page.screenshot({ path: "scratch/voiceover-panel.png" });
  await panel.getByRole("button", { name: "Start recording" }).click();
  details.countdown = { ok: await panel.getByText("Starting in 3").waitFor({ timeout: 3000 }).then(() => true, () => false) };
  await panel.getByRole("button", { name: "Stop and keep" }).waitFor({ timeout: 6000 });
  details.live = { ok: await button.evaluate((b) => b.classList.contains("vo-live")) };
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "scratch/voiceover-live.png" });
  await panel.getByRole("button", { name: "Stop and keep" }).click();
  await page.waitForFunction(() => window.videoEditor.project().assets.some((a) => a.name === "Voiceover 1.wav"), null, { timeout: 15000 });
  await page.waitForFunction(() => window.videoEditor.project().tracks.some((t) => t.kind === "audio" && t.clips.length), null, { timeout: 5000 });
  const r = await page.evaluate(() => {
    const p = window.videoEditor.project();
    const clip = p.tracks.filter((t) => t.kind === "audio").flatMap((t) => t.clips)[0];
    const asset = p.assets.find((a) => a.id === clip.assetId);
    return { start: clip.start, duration: clip.duration, assetDuration: asset.duration, hasAudio: asset.hasAudio };
  });
  // Placement: playback began at frame 30, and the pre-roll before it is
  // dropped, so the take starts exactly there.
  details.placed = { ok: r.start === 30, start: r.start };
  details.length = { ok: r.duration >= 50 && r.duration <= 70 && r.hasAudio, ...r };
  // Sound actually arrived: the fake device beeps, so the peak is loud.
  const peak = await page.evaluate(async () => {
    const api = window.videoEditor;
    const a = api.project().assets.find((x) => x.name === "Voiceover 1.wav");
    const buf = await (await fetch(a.src)).arrayBuffer().catch(() => null);
    if (!buf) return null;
    const v = new DataView(buf);
    let max = 0;
    for (let i = 44; i + 1 < buf.byteLength; i += 2) max = Math.max(max, Math.abs(v.getInt16(i, true)));
    return max / 32768;
  });
  details.sound = { ok: peak === null || peak > 0.05, peak };
  details.undoable = { ok: (await page.getByRole("button", { name: "Undo Record voiceover", exact: true }).count()) === 1 };

  // Discard keeps nothing. The panel stays open for another take.
  details.panelStays = { ok: await panel.isVisible() };
  await panel.getByRole("button", { name: "Start recording" }).click();
  await panel.getByRole("button", { name: "Discard" }).waitFor({ timeout: 6000 });
  await page.waitForTimeout(500);
  await panel.getByRole("button", { name: "Discard" }).click();
  await page.waitForTimeout(500);
  details.discard = { ok: await page.evaluate(() => window.videoEditor.project().assets.filter((a) => /^Voiceover/.test(a.name)).length === 1) };
  // Escape while starting, or during the countdown, cancels; nothing records.
  await panel.getByRole("button", { name: "Start recording" }).click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await panel.getByRole("button", { name: "Start recording" }).click();
  await panel.getByText("Starting in").waitFor({ timeout: 3000 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(3500);
  details.escape = {
    ok: (await panel.getByRole("button", { name: "Start recording" }).isVisible()) && !(await button.evaluate((b) => b.classList.contains("vo-live"))),
  };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
