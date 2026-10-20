// A voiceover captioned a few words at a time (ADR-115), through MCP:
// add_voiceover caption_words 2 cuts each line into chunks of at most two
// words that say the line in order; each line's first chunk starts where
// its voice does (the film test's Whisper put "Station," 0.4 s late); a
// one-word chunk draws in its own color, a two-word chunk lights the word
// being spoken; check_project social_short reads the chunks as their line
// and finds none too fast; a retake captions its new words the same way.
// Downloads the speech model and Whisper once (about 400 MB).
async (page) => {
  await page.waitForFunction(() => !!window.videoEditor);
  page.setDefaultTimeout(900000);
  await page.locator(".create-card").click();
  const call = async (name, args = {}) => {
    const r = await page.evaluate(([name, args]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), [name, args]);
    if (r.result?.isError || r.error) throw new Error(name + ": " + JSON.stringify(r));
    return JSON.parse(r.result.content.find((c) => c.type === "text").text);
  };
  await call("set_project", { width: 1080, height: 1920 });
  await call("add_color_clip", { color: "#000000", start: 0, duration: 14 });
  const lines = [
    { text: "Station, how's the view?", voice: "am_michael", words_per_second: [2.8, 3.4] },
    { text: "Honestly? [pause 0.2] Mostly water.", speed: 0.85 },
    { text: "Every light down there is someone's kitchen." },
  ];
  // Pure red words, a pure green spoken word: countable in the frame.
  const vo = await call("add_voiceover", { lines, caption_words: 2, caption_style: { color: "#ff0000", highlight: "#00ff00", size: 90 }, caption_y: 0 });
  const desc = await call("describe_project", {});
  const caps = desc.tracks.flatMap((t) => t.clips).filter((c) => c.type === "text").sort((a, b) => a.start - b.start);
  const byId = new Map(caps.map((c) => [c.id, c]));
  const review = await call("review_voiceover", { music: false, recheck: false, detail: "full" });
  const details = {};
  // Each line in chunks of one or two words that say it, in order.
  const said = vo.lines.map((l) => (l.caption_clips ?? []).map((id) => byId.get(id)?.text).join(" "));
  details.chunks = {
    ok: vo.lines.every((l) => (l.caption_clips ?? []).length >= 2) && said.join("|") === "Station, how's the view?|Honestly? Mostly water.|Every light down there is someone's kitchen." && caps.every((c) => c.text.split(/\s+/).length <= 2) && /at a time/.test(vo.notes?.join(" ") ?? ""),
    said,
    caps: caps.map((c) => [c.start, c.end, c.text]),
  };
  // A line's first chunk starts on its voice (its first sound, as review measures it).
  const onsets = vo.lines.map((l, i) => {
    const first = byId.get(l.caption_clips[0]);
    const voiceAt = l.start + review.lines[i].lead_silence;
    return { line: l.text, chunk: first.start, voice: +voiceAt.toFixed(3), off: +(first.start - voiceAt).toFixed(3) };
  });
  details.onsets = { ok: onsets.every((o) => Math.abs(o.off) <= 0.07), onsets };
  /** Red and green pixels in the frame at `t` seconds. */
  const colors = (t) =>
    page.evaluate(async (t) => {
      const api = window.videoEditor;
      api.seek(Math.round(t * 30));
      await new Promise((r) => setTimeout(r, 40));
      await api.rendered();
      const px = api.pixels(540);
      let g = 0, r = 0;
      for (let i = 0; i < px.data.length; i += 4) {
        const [R, G, B] = [px.data[i], px.data[i + 1], px.data[i + 2]];
        if (G > 180 && R < 90 && B < 90) g++;
        else if (R > 180 && G < 90 && B < 90) r++;
      }
      return { green: g, red: r };
    }, t);
  const one = caps.find((c) => !/\s/.test(c.text));
  const two = caps.find((c) => /\s/.test(c.text));
  const lone = await colors((one.start + one.end) / 2);
  const pair = await colors(two.start + 0.05);
  details.highlight = { ok: lone.red > 200 && lone.green === 0 && pair.green > 100 && pair.red > 100, lone: { text: one.text, ...lone }, pair: { text: two.text, ...pair } };
  const check = await call("check_project", { kind: "social_short", detail: "full" });
  const fast = check.findings.filter((f) => f.rule === "caption_too_fast");
  details.check = { ok: fast.length === 0, fast };
  // A retake captions its new words a few at a time too; the old chunks go.
  const retake = await call("retake_voiceover", { clip_id: vo.lines[0].voice_clip, text: "Station, how is the view up there?", ripple: true });
  const after = (await call("describe_project", {})).tracks.flatMap((t) => t.clips).filter((c) => c.type === "text").sort((a, b) => a.start - b.start);
  const now = new Map(after.map((c) => [c.id, c]));
  details.retake = {
    ok: (retake.caption_clips ?? []).length >= 3 && retake.caption_clips.map((id) => now.get(id)?.text).join(" ") === "Station, how is the view up there?" && vo.lines[0].caption_clips.every((id) => !now.has(id)) && after.length === caps.length - vo.lines[0].caption_clips.length + retake.caption_clips.length,
    chunks: retake.caption_clips?.map((id) => now.get(id)?.text),
  };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
