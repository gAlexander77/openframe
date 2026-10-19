// Several clips at once (Premiere 25's Properties panel): with a picture,
// a video and an audio clip selected, the inspector offers what they
// share. Opacity typed once sets both pictures in one undo step; Volume
// sets the video's sound and the audio clip; a property the clips
// disagree on shows "Mixed" until it is set.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const ids = await page.evaluate(async () => {
    const api = window.videoEditor;
    const o = location.origin + "/fixtures/media/";
    const [pic, vid, voice] = await api.import([
      { name: "photo.jpg", src: o + "photo.jpg" },
      { name: "talk-gaps.mp4", src: o + "talk-gaps.mp4" },
      { name: "voice-8s.wav", src: o + "voice-8s.wav" },
    ]);
    api.exec("add_media_clip", { asset_id: vid.id, start: 0, duration: 3 });
    api.exec("add_media_clip", { asset_id: pic.id, start: 3, duration: 2 });
    api.exec("add_media_clip", { asset_id: voice.id, start: 0, duration: 3 });
    const clips = api.project().tracks.flatMap((t) => t.clips);
    const by = (t) => clips.find((c) => c.type === t).id;
    const ids = { video: by("video"), image: by("image"), audio: by("audio") };
    api.exec("set_param", { clip_ids: [ids.image], path: "transform.scale", value: 0.5 });
    api.select([ids.video, ids.image, ids.audio]);
    return ids;
  });
  const inspector = page.getByRole("region", { name: "Inspector" });
  const details = {};
  const picture = inspector.locator(".insp-section", { hasText: "Picture (2 clips)" });
  const sound = inspector.locator(".insp-section", { hasText: "Sound (2 clips)" });
  details.sections = { ok: (await picture.count()) === 1 && (await sound.count()) === 1 };
  const scale = picture.getByLabel("Scale value");
  details.mixed = { ok: (await scale.inputValue()) === "" && (await scale.getAttribute("placeholder")) === "Mixed" };
  await page.screenshot({ path: "__REPO__/scratch/multi-edit.png" });

  const field = picture.getByLabel("Opacity value");
  await field.fill("50");
  await field.press("Enter");
  const read = (path) => page.evaluate(([ids, path]) => [ids.video, ids.image].map((id) => window.videoEditor.paramAt(id, path, 0 + window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).start)), [ids, path]);
  details.opacity = { ok: JSON.stringify(await read("opacity")) === "[0.5,0.5]", values: await read("opacity"), undo: await page.evaluate(() => window.videoEditor.state().undoLabel) };
  await page.keyboard.press("Control+z");
  details.oneUndo = { ok: JSON.stringify(await read("opacity")) === "[1,1]" };

  const vol = sound.getByLabel("Volume value");
  await vol.fill("-6");
  await vol.press("Enter");
  const vols = await page.evaluate((ids) => {
    const all = window.videoEditor.project().tracks.flatMap((t) => t.clips);
    return [ids.video, ids.audio].map((id) => +(20 * Math.log10(all.find((c) => c.id === id).volume)).toFixed(2));
  }, ids);
  details.volume = { ok: vols.every((v) => Math.abs(v + 6) < 0.01), vols };

  await scale.fill("80");
  await scale.press("Enter");
  details.unmixed = { ok: JSON.stringify(await read("transform.scale")) === "[0.8,0.8]" && (await scale.inputValue()) === "80" };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
