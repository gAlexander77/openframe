// A voiceover lands on its words a second, through MCP (ADR-096). Four of
// the documentary's narration lines, voiced with no speed: each is read,
// measured over its speech and read again at the speed that lands it on
// narration's 2.3-2.8 words a second (with the old fixed narrator speed
// 0.9 they read 3.7-4.2). review_voiceover then judges pace by that band,
// in two windows (the speech, the clip), and passes them; read_as ad lands
// higher; a speed given is kept; a retake with words_per_second lands a
// line read at a fixed speed; *word* stars (emphasis the voice cannot give)
// are dropped from the voice and the caption, with a note.
async (page) => {
  await page.waitForFunction(() => !!window.videoEditor);
  page.setDefaultTimeout(600000);
  await page.locator(".create-card").click();
  const call = async (name, args = {}) => {
    const r = await page.evaluate(([name, args]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), [name, args]);
    if (r.result?.isError || r.error) throw new Error(name + ": " + JSON.stringify(r));
    return JSON.parse(r.result.content[0].text);
  };
  const lines = [
    "We leave the ground to see how far we can go.",
    "Then the world turns beneath us, and the journey changes.",
    "Morning lifts from the water, while a small boat draws a line across the sea.",
    "The farther we travel, the clearer it becomes. [pause 0.3] This is home.",
  ];
  const narration = await call("add_voiceover", { lines: lines.map((text) => ({ text })), captions: false });
  const inBand = (l, [lo, hi], slack = 0) => l.words_per_second >= lo * (1 - slack) && l.words_per_second <= hi * (1 + slack);
  const review = await call("review_voiceover", { music: false, recheck: false });
  const ad = await call("add_voiceover", { lines: [{ text: "Every edit is a tool an agent can call, so a whole film can be made by asking." }], read_as: "ad", start: 30, captions: false });
  const fixed = await call("add_voiceover", { lines: [{ text: lines[1] }], speed: 0.9, start: 40, captions: false });
  const retake = await call("retake_voiceover", { clip_id: fixed.lines[0].voice_clip, words_per_second: [2.3, 2.8], ripple: false });
  const again = await call("review_voiceover", { clip_ids: [fixed.lines[0].voice_clip], music: false, recheck: false });
  const stressed = await call("add_voiceover", { lines: [{ text: "I never said *she* took it." }], start: 50 });
  const caption = await page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id)?.text, stressed.lines[0].caption_clip);
  const heard = await call("review_voiceover", { clip_ids: [stressed.lines[0].voice_clip], music: false, recheck: false });
  const details = {
    // Every line on narration's band (a line the slowest natural speed cannot bring down may sit a tenth over).
    landed: { ok: narration.lines.every((l) => l.speed_chosen && l.reads <= 3 && l.speed >= 0.6 && l.speed <= 1.3 && inBand(l, [2.3, 2.8], l.speed === 0.6 ? 0.1 : 0)), lines: narration.lines.map((l) => ({ text: l.text, speed: l.speed, words_per_second: l.words_per_second, reads: l.reads })) },
    // The review passes them on words a second, both windows reported.
    review: { ok: review.lines.every((l) => !(l.fixes ?? []).some((f) => /words a second|syllables/.test(f.problem)) && l.pace.over_speech && l.pace.over_clip && l.pace.over_clip.words_per_second <= l.pace.over_speech.words_per_second) && review.summary.pace.lines_words_per_second.max <= 3.1, lines: review.lines.map((l) => ({ verdict: l.verdict, pace: l.pace, advice: l.advice })), summary: review.summary.pace },
    ad: { ok: inBand(ad.lines[0], [2.6, 3.1], ad.lines[0].speed === 0.6 ? 0.1 : 0) && ad.lines[0].target_words_per_second.join() === "2.6,3.1", line: ad.lines[0] },
    // A speed given is kept; a retake asked for a pace lands it.
    kept: { ok: fixed.lines[0].speed === 0.9 && !fixed.lines[0].speed_chosen, line: fixed.lines[0] },
    retake: { ok: retake.speed_chosen === true && inBand(retake, [2.3, 2.8], 0.1) && again.lines[0].pace.on_target !== undefined && !(again.lines[0].fixes ?? []).some((f) => /words a second/.test(f.problem)), retake, again: again.lines[0].pace },
    // Emphasis cannot be voiced: the stars are dropped from voice and caption, and a note says so.
    emphasis: { ok: caption === "I never said she took it." && heard.lines[0].match === 1 && heard.lines[0].script === "I never said she took it." && /not voiced/.test(stressed.notes?.[0] ?? ""), caption, heard: heard.lines[0].heard, notes: stressed.notes },
  };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
