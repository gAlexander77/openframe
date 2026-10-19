// Built-in sound effects (CapCut's Audio > Sound effects, made locally):
// the Audio tab lists them; adding Whoosh at 1 s puts a 0.8 s clip on an
// audio track there, and the export's sound is loud while it plays and
// silent before. A second Whoosh reuses the same file, and an agent adds
// one by name.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(() => {
    window.videoEditor.exec("add_color_clip", { color: "#222222", start: 0, duration: 4 });
    window.videoEditor.seek(30);
  });
  const lib = page.getByRole("region", { name: "Library" });
  await lib.getByRole("tab", { name: "Audio", exact: true }).click();
  const details = {};
  details.listed = { ok: (await page.getByRole("button", { name: "Play Whoosh" }).count()) === 1 && (await page.getByRole("button", { name: "Add Boom", exact: true }).count()) === 1 };
  await page.screenshot({ path: "__REPO__/scratch/sound-effects.png" });
  await page.getByRole("button", { name: "Play Whoosh" }).click(); // audition: no edit
  details.auditionNoEdit = { ok: (await page.evaluate(() => window.videoEditor.project().assets.length)) === 0 };

  await page.getByRole("button", { name: "Add Whoosh", exact: true }).click();
  await page.waitForFunction(() => window.videoEditor.project().tracks.some((t) => t.clips.some((c) => c.type === "audio")), null, { timeout: 15000 });
  const clip = await page.evaluate(() => {
    const p = window.videoEditor.project();
    const c = p.tracks.flatMap((t) => t.clips).find((x) => x.type === "audio");
    return { start: c.start, duration: c.duration, asset: p.assets.find((a) => a.id === c.assetId)?.name };
  });
  details.placed = { ok: clip.start === 30 && Math.abs(clip.duration - 24) <= 1 && clip.asset === "Whoosh.wav", ...clip };

  const level = await page.evaluate(async () => {
    const r = await window.videoEditor.render({ video: false, audioFormat: "wav", start: 0, end: 2 });
    const buf = await (await fetch(r.url)).arrayBuffer();
    URL.revokeObjectURL(r.url);
    const v = new DataView(buf), rate = v.getUint32(24, true);
    const rms = (a, b) => {
      let s = 0, n = 0;
      for (let i = Math.floor(a * rate); i < Math.floor(b * rate); i++, n++) s += (v.getInt16(44 + i * 4, true) / 32768) ** 2;
      return Math.sqrt(s / n);
    };
    return { before: rms(0.1, 0.9), during: rms(1.2, 1.6) };
  });
  details.sounds = { ok: level.before < 0.001 && level.during > 0.05, ...level };

  await page.getByRole("button", { name: "Add Whoosh", exact: true }).click();
  await page.waitForFunction(() => window.videoEditor.project().tracks.flatMap((t) => t.clips).filter((c) => c.type === "audio").length === 2, null, { timeout: 15000 });
  details.reused = { ok: (await page.evaluate(() => window.videoEditor.project().assets.filter((a) => a.name === "Whoosh.wav").length)) === 1 };

  const byAgent = await page.evaluate(async () => {
    const r = await window.videoEditor.ai.addSoundEffect("ding", { at: 3 });
    const c = window.videoEditor.project().tracks.flatMap((t) => t.clips).find((x) => x.id === r.clipId);
    return c?.start;
  });
  details.agent = { ok: byAgent === 90, start: byAgent };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
