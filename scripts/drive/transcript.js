// Edit by transcript (Premiere's Text-Based Editing): Kokoro speaks three
// sentences; the Captions tab's transcript card hears the clip (Whisper
// base.en, downloaded once) and shows its words. Selecting the middle
// sentence and pressing Delete cuts it as one undo step without deleting
// the clip; the pieces still read as one text, and transcribing the result
// again finds the first and last sentences but not the middle one.
// Clicking a word moves the playhead to it.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(() => {
    const api = window.videoEditor;
    api.exec("add_text", { text: "Welcome back to the show.\nThis whole part goes away.\nThanks for watching.", start: 0, duration: 8 });
    api.select([api.describe().tracks.flatMap((t) => t.clips).find((x) => x.type === "text").id]);
  });
  const section = page.locator(".insp-section", { has: page.getByText("Text to speech", { exact: true }) });
  await section.getByRole("button", { name: "Text to speech" }).click().catch(() => section.locator(".insp-section-toggle").click());
  await section.getByRole("button", { name: "Add voice" }).click();
  await page.waitForFunction(() => window.videoEditor.project().tracks.some((t) => t.kind === "audio" && t.clips.length), null, { timeout: 600000 });
  const voice = await page.evaluate(() => {
    const api = window.videoEditor;
    const text = api.project().tracks.flatMap((t) => t.clips).find((c) => c.type === "text");
    api.exec("delete_clips", { clip_ids: [text.id] });
    const c = api.project().tracks.filter((t) => t.kind === "audio").flatMap((t) => t.clips)[0];
    api.select([c.id]);
    return { id: c.id, duration: c.duration };
  });
  const details = {};
  await page.getByRole("tab", { name: "Captions" }).click();
  await page.getByRole("button", { name: /Transcribe 1 clip/ }).click();
  await page.locator(".transcript [data-i]").first().waitFor({ timeout: 600000 });
  const before = await page.locator(".transcript").innerText();
  details.heard = { ok: /welcome back/i.test(before) && /part goes away/i.test(before) && /thanks for watching/i.test(before), before };

  // Click "Thanks": the playhead goes to it.
  await page.locator(".transcript [data-i]", { hasText: /^Thanks$/ }).click();
  const at = await page.evaluate(() => window.videoEditor.state().playhead);
  details.seek = { ok: at > 30, at };

  // Select "This whole part goes away." and press Delete.
  await page.evaluate(() => {
    const spans = [...document.querySelectorAll(".transcript [data-i]")];
    const a = spans.find((s) => /^this$/i.test(s.textContent));
    const b = spans.find((s) => /^away\.?$/i.test(s.textContent));
    const r = document.createRange();
    r.setStart(a.firstChild, 0);
    r.setEnd(b.firstChild, b.textContent.length);
    document.querySelector(".transcript").focus();
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await page.keyboard.press("Delete");
  const after = await page.evaluate(() => window.videoEditor.project().tracks.filter((t) => t.kind === "audio").flatMap((t) => t.clips));
  const total = after.reduce((n, c) => n + c.duration, 0);
  details.cut = { ok: after.length >= 2 && total < voice.duration - 30, pieces: after.length, before: voice.duration, after: total };
  details.undo = { ok: (await page.getByRole("button", { name: /^Undo Delete \d+ words$/ }).count()) === 1 };
  const shown = await page.locator(".transcript").innerText();
  await page.locator(".transcript-card").screenshot({ path: "scratch/transcript.png" });
  details.reads = { ok: /welcome back/i.test(shown) && /thanks for watching/i.test(shown) && !/part goes away/i.test(shown), shown };
  const again = await page.evaluate(async () => {
    const { transcribeTimeline } = await import("/src/engine/transcribe.ts");
    const words = await transcribeTimeline(window.videoEditor.project(), { model: "onnx-community/whisper-base.en_timestamped", language: null }, () => {});
    return words.map((w) => w.text.trim().toLowerCase().replace(/[^a-z]/g, "")).join(" ");
  });
  details.heardAfter = { ok: /welcome back/.test(again) && /thanks for watching/.test(again) && !/goes away/.test(again), again };
  // Agents: get_transcript's path returns the piece's words in source seconds.
  const agent = await page.evaluate(async (id) => (await window.videoEditor.ai.clipTranscript(id)).words.map((w) => w.text.trim()).join(" "), voice.id);
  details.agent = { ok: /Welcome back to the show/i.test(agent) && !/goes away/i.test(agent), agent };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
