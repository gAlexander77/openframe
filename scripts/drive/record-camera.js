// Record from the camera (CapCut's Record): Media > Record > Record
// camera, about two seconds, Stop. The take (the browser's fake camera and
// microphone, which the runner grants) is imported and placed at the
// playhead it started from, with picture and sound. Discard throws a take
// away and keeps nothing.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const lib = page.getByRole("region", { name: "Library" });
  const details = {};
  const record = async () => {
    await lib.getByRole("button", { name: "Record", exact: true }).click();
    await page.getByRole("menuitem", { name: "Record camera" }).click();
    await lib.getByRole("button", { name: "Stop", exact: true }).waitFor();
  };

  await record();
  await page.waitForTimeout(2200);
  await page.screenshot({ path: "__REPO__/scratch/record-camera.png" });
  await lib.getByRole("button", { name: "Stop", exact: true }).click();
  await page.waitForFunction(() => window.videoEditor.project().tracks.some((t) => t.clips.length), null, { timeout: 30000 });
  const got = await page.evaluate(() => {
    const p = window.videoEditor.project();
    const a = p.assets[0];
    const c = p.tracks.flatMap((t) => t.clips)[0];
    return { name: a.name, kind: a.kind, duration: a.duration, hasVideo: a.hasVideo, hasAudio: a.hasAudio, start: c.start, type: c.type };
  });
  details.kept = { ok: got.kind === "video" && got.hasVideo && got.hasAudio && got.duration > 1.5 && got.duration < 4 && got.start === 0 && /^Camera .*\.(mp4|webm)$/.test(got.name), ...got };

  // It plays: a frame decodes at one second.
  details.decodes = {
    ok: await page.evaluate(async () => {
      window.videoEditor.seek(30);
      await new Promise((r) => setTimeout(r, 500));
      const px = window.videoEditor.pixels(64);
      return px.data.some((v, i) => i % 4 !== 3 && v > 16);
    }),
  };

  await record();
  await page.waitForTimeout(800);
  await lib.getByRole("button", { name: "Discard recording" }).click();
  await page.waitForTimeout(500);
  details.discarded = { ok: (await page.evaluate(() => window.videoEditor.project().assets.length)) === 1 && (await lib.getByRole("button", { name: "Record", exact: true }).count()) === 1 };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
