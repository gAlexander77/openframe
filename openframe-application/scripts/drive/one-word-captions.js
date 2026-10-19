// One word at a time (CapCut's short-form captions): Kokoro speaks a line,
// the Captions tab generates with the toggle on, and every caption holds a
// single word, in spoken order, none overlapping the next. Downloads the
// speech models once (about 170 MB).
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(() => {
    const api = window.videoEditor;
    api.exec("add_text", { text: "Welcome back. Today we cut a video together.", start: 0, duration: 5 });
    api.select([api.describe().tracks.flatMap((t) => t.clips).find((x) => x.type === "text").id]);
  });
  const section = page.locator(".insp-section", { has: page.getByText("Text to speech", { exact: true }) });
  await section.getByRole("button", { name: "Text to speech" }).click().catch(() => section.locator(".insp-section-toggle").click());
  await section.getByRole("button", { name: "Add voice" }).click();
  await page.waitForFunction(() => window.videoEditor.project().tracks.some((t) => t.kind === "audio" && t.clips.length), null, { timeout: 600000 });
  await page.evaluate(() => {
    const api = window.videoEditor;
    const t = api.project().tracks.flatMap((t) => t.clips).find((c) => c.type === "text");
    api.exec("delete_clips", { clip_ids: [t.id] });
  });
  await page.getByRole("tab", { name: "Captions" }).click();
  await page.getByRole("switch", { name: "One word at a time" }).click().catch(() => page.getByLabel("One word at a time").click());
  await page.getByRole("button", { name: "Generate captions" }).click();
  await page.waitForFunction(() => window.videoEditor.project().tracks.some((t) => t.clips.some((c) => c.caption)), null, { timeout: 600000 });
  const caps = await page.evaluate(() =>
    window.videoEditor
      .project()
      .tracks.flatMap((t) => t.clips)
      .filter((c) => c.caption)
      .sort((a, b) => a.start - b.start)
      .map((c) => ({ text: c.text, start: c.start, end: c.start + c.duration })),
  );
  const single = caps.every((c) => !/\s/.test(c.text.trim()));
  const ordered = caps.every((c, i) => i === 0 || c.start >= caps[i - 1].end);
  const words = caps.map((c) => c.text.toLowerCase().replace(/[^a-z]/g, "")).join(" ");
  const details = { captions: { ok: caps.length >= 7 && single && ordered && /today we cut/.test(words), count: caps.length, words, single, ordered } };
  return { ok: details.captions.ok, details };
};
