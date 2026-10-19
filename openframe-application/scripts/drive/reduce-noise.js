// Reduce noise drive: the AI tools card cleans a selected audio clip
// (it then plays "<name> (noise reduced).wav", same place and length), and
// a video clip (its sound is extracted to an audio clip that plays the
// cleaned copy, the picture's own sound muted). Each is one undo step.
// The gate itself is unit-tested (src/lib/analysis/denoise.test.ts).
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const ids = await page.evaluate(async () => {
    const api = window.videoEditor;
    const [wav, vid] = await api.import([
      { name: "voice-8s.wav", src: location.origin + "/fixtures/media/voice-8s.wav" },
      { name: "talk-gaps.mp4", src: location.origin + "/fixtures/media/talk-gaps.mp4" },
    ]);
    api.exec("add_media_clip", { asset_id: vid.id, start: 0, duration: 4 });
    api.exec("add_media_clip", { asset_id: wav.id, start: 1, in: 1, duration: 3 });
    const clips = api.describe().tracks.flatMap((t) => t.clips);
    return { audio: clips.find((c) => c.type === "audio").id, video: clips.find((c) => c.type === "video").id };
  });
  const clips = () => page.evaluate(() => window.videoEditor.project().tracks.flatMap((t) => t.clips));
  const asset = (id) => page.evaluate((id) => window.videoEditor.project().assets.find((a) => a.id === id), id);
  const details = {};

  await page.evaluate((id) => window.videoEditor.select([id]), ids.audio);
  await page.getByRole("tab", { name: "AI tools" }).click().catch(() => page.evaluate(() => window.videoEditor.state && null));
  const before = (await clips()).find((c) => c.id === ids.audio);
  await page.evaluate((id) => window.videoEditor.ai.reduceNoise(id), ids.audio);
  const after = (await clips()).find((c) => c.id === ids.audio);
  const a = await asset(after.assetId);
  details.audio = { ok: a.name === "voice-8s (noise reduced).wav" && after.start === before.start && after.duration === before.duration && after.in === 0 && Math.abs(a.duration - 3) < 0.05, name: a.name, duration: a.duration };
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.audioUndo = { ok: (await clips()).find((c) => c.id === ids.audio).assetId === before.assetId };

  const n0 = (await clips()).length;
  const r = await page.evaluate((id) => window.videoEditor.ai.reduceNoise(id), ids.video);
  const now = await clips();
  const video = now.find((c) => c.id === ids.video);
  const sound = now.find((c) => c.id === r.clipId);
  details.video = { ok: now.length === n0 + 1 && video.muted && sound.type === "audio" && sound.start === video.start && sound.duration === video.duration && (await asset(sound.assetId)).name === "talk-gaps (noise reduced).wav" };
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.videoUndo = { ok: (await clips()).length === n0 && !(await clips()).find((c) => c.id === ids.video).muted };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
