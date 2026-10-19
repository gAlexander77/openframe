// Remove filler words drive: Kokoro (local text to speech) says a line with
// two "um"s; the AI tools card transcribes the clip with Whisper base.en
// (both models download once, about 170 MB) and cuts them as one undo
// step. Checks the clip got shorter, every "um" is gone when the result is
// transcribed again, and the other words remain.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(() => {
    const api = window.videoEditor;
    api.exec("add_text", { text: "So, um, I think we should go there.\nUm, well, it is fine.", start: 0, duration: 6 });
    api.select([api.describe().tracks.flatMap((t) => t.clips).find((x) => x.type === "text").id]);
  });
  const section = page.locator(".insp-section", { has: page.getByText("Text to speech", { exact: true }) });
  await section.getByRole("button", { name: "Text to speech" }).click().catch(() => section.locator(".insp-section-toggle").click());
  await section.getByRole("button", { name: "Add voice" }).click();
  await page.waitForFunction(() => window.videoEditor.project().tracks.some((t) => t.kind === "audio" && t.clips.length), null, { timeout: 600000 });
  // Only the voice: the title would not be heard anyway, but keep it simple.
  const voice = await page.evaluate(() => {
    const api = window.videoEditor;
    const text = api.project().tracks.flatMap((t) => t.clips).find((c) => c.type === "text");
    api.exec("delete_clips", { clip_ids: [text.id] });
    const c = api.project().tracks.filter((t) => t.kind === "audio").flatMap((t) => t.clips)[0];
    api.select([c.id]);
    return { id: c.id, duration: c.duration };
  });
  const heard = () =>
    page.evaluate(async () => {
      const { transcribeTimeline } = await import("/src/engine/transcribe.ts");
      const words = await transcribeTimeline(window.videoEditor.project(), { model: "onnx-community/whisper-base.en_timestamped", language: null }, () => {});
      return words.map((w) => w.text.trim().toLowerCase().replace(/[^a-z]/g, "")).join(" ");
    });
  const details = {};
  const before = await heard();
  details.fixture = { ok: (before.match(/\bum\b/g) ?? []).length >= 2, before };

  await page.getByRole("tab", { name: "AI tools" }).click();
  await page.locator(".ai-fillers .ai-run").click();
  await page.waitForFunction(() => /filler word/.test(document.querySelector(".ai-fillers .ai-status")?.textContent ?? ""), null, { timeout: 600000 });
  const after = await page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).filter((c) => c.type === "audio"), voice.id);
  const total = after.reduce((n, c) => n + c.duration, 0);
  details.shorter = { ok: total < voice.duration - 6 && after.length >= 2, before: voice.duration, after: total, pieces: after.length };
  const status = await page.locator(".ai-fillers .ai-status").textContent();
  details.status = { ok: /Removed 2 filler words/.test(status), status };
  details.undo = { ok: (await page.getByRole("button", { name: "Undo Remove 2 filler words", exact: true }).count()) === 1 };
  const now = await heard();
  const kept = ["so", "i", "think", "we", "should", "go", "there", "well", "it", "is", "fine"].filter((w) => !new RegExp(`\\b${w}\\b`).test(now));
  details.gone = { ok: !/\bum\b/.test(now) && kept.length <= 1, now, missing: kept };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
