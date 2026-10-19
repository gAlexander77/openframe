// Sync audio by waveform (CapCut's Sync video and audio): sync-camera.mp4
// and sync-lav.wav are one take heard by two microphones (node
// scripts/make-fixtures.mjs sync-), the lav's recorder started 1.37 s
// before the camera. Both clips go on the timeline out of sync; the clip
// menu's "Sync audio by waveform" must land the lav within one frame of
// the truth, as one undo step named "Sync audio", keeping the camera's
// sound. sync_audio over MCP with mute_camera mutes it. Unrelated speech
// and a video without sound are refused, and nothing moves.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const TRUTH = 1.37;
  const ids = await page.evaluate(async () => {
    const api = window.videoEditor;
    const media = (n) => ({ name: n, src: location.origin + "/fixtures/media/" + n });
    const [cam, lav, other, mute] = await api.import([media("sync-camera.mp4"), media("sync-lav.wav"), media("speech-test.wav"), media("hevc-1080p.mp4")]);
    api.exec("add_media_clip", { asset_id: cam.id, start: 0 });
    api.exec("add_media_clip", { asset_id: lav.id, start: 3 });
    const clips = api.project().tracks.flatMap((t) => t.clips);
    return { v: clips.find((c) => c.assetId === cam.id).id, a: clips.find((c) => c.assetId === lav.id).id, other: other.id, mute: mute.id };
  });
  // Seconds between the two sources where they play together now.
  const offset = () =>
    page.evaluate(({ v, a }) => {
      const p = window.videoEditor.project();
      const sec = (f) => (f * p.fps.den) / p.fps.num;
      const all = p.tracks.flatMap((t) => t.clips);
      const cv = all.find((c) => c.id === v), ca = all.find((c) => c.id === a);
      return { offset: ca.in - sec(ca.start) * ca.speed - (cv.in - sec(cv.start) * cv.speed), start: sec(ca.start), in: ca.in, volume: cv.volume };
    }, ids);
  const frame = 1 / 30;
  const details = {};
  const before = await offset();

  // The clip menu, with exactly the video and the lav selected.
  await page.evaluate(({ v, a }) => window.videoEditor.select([v, a]), ids);
  await page.locator(`[data-clip="${ids.a}"]`).click({ button: "right" });
  const item = page.getByRole("menuitem", { name: "Sync audio by waveform" });
  details.menu = { ok: (await item.count()) === 1 && (await page.getByRole("menuitem", { name: "Sync audio and mute camera sound" }).count()) === 1 };
  const started = Date.now();
  await item.click();
  await page.waitForFunction(({ a }) => window.videoEditor.state().undoLabel === "Sync audio" && window.videoEditor.project().tracks.some((t) => t.clips.some((c) => c.id === a)), ids, { timeout: 60000 });
  const synced = await offset();
  details.synced = {
    ok: Math.abs(synced.offset - TRUTH) < frame && Math.abs(before.offset - TRUTH) > 1,
    errorMs: +((synced.offset - TRUTH) * 1000).toFixed(2),
    seconds: +((Date.now() - started) / 1000).toFixed(2),
    before: before.offset,
    ...synced,
  };
  // The recorder ran before the camera: its head is trimmed to start at 0.
  details.headTrimmed = { ok: synced.start === 0 && Math.abs(synced.in - TRUTH) < frame };
  details.cameraKept = { ok: synced.volume === 1 };
  details.undoLabel = { ok: (await page.getByRole("button", { name: "Undo Sync audio", exact: true }).count()) === 1 };
  details.toast = { ok: (await page.locator(".toast", { hasText: "Synced sync-lav.wav to sync-camera.mp4" }).count()) >= 1 };
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.undo = { ok: Math.abs((await offset()).offset - before.offset) < 1e-9 };

  // MCP, choosing the video under the lav itself, and muting the camera.
  const mcp = await page.evaluate(async ({ a }) => {
    const r = await window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "sync_audio", arguments: { clip_id: a, mute_camera: true } } });
    return r.result;
  }, ids);
  const res = JSON.parse(mcp.content[0].text);
  const muted = await offset();
  details.mcpMuted = { ok: !mcp.isError && res.muted === true && muted.volume === 0 && Math.abs(muted.offset - TRUTH) < frame && res.confidence >= 0.15, res };
  await page.evaluate(() => window.videoEditor.action("undo"));

  // Refusals: another take, and a video with no sound of its own.
  const refused = await page.evaluate(async ({ v, other, mute }) => {
    const api = window.videoEditor;
    api.exec("add_media_clip", { asset_id: other, start: 1 });
    api.exec("add_media_clip", { asset_id: mute, start: 0 });
    const all = api.project().tracks.flatMap((t) => t.clips);
    const speech = all.find((c) => c.assetId === other).id;
    const silent = all.find((c) => c.assetId === mute).id;
    api.select([v, speech]);
    return { speech, silent };
  }, ids);
  const label = await page.evaluate(() => window.videoEditor.state().undoLabel);
  const at = await page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).start, refused.speech);
  await page.locator(`[data-clip="${refused.speech}"]`).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Sync audio by waveform" }).click();
  const toast = page.locator(".toast-error", { hasText: "don't match clearly enough" });
  await toast.first().waitFor({ timeout: 60000 }).catch(() => {});
  const after = await page.evaluate((id) => ({ label: window.videoEditor.state().undoLabel, start: window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).start }), refused.speech);
  details.refusesOtherTake = { ok: (await toast.count()) >= 1 && after.label === label && after.start === at, text: await toast.first().textContent().catch(() => null) };
  const noSound = await page.evaluate(async ({ a, silent }) => {
    try {
      await window.videoEditor.ai.syncAudio(a, { videoId: silent });
      return null;
    } catch (e) {
      return e.message;
    }
  }, { ...ids, ...refused });
  details.refusesSilentVideo = { ok: /has no sound/.test(noSound ?? ""), noSound };
  await page.screenshot({ path: "scratch/audio-sync.png" });
  return { ok: Object.values(details).every((d) => d.ok), details };
};
