// Real Whisper on the speech fixture, then captions after a middle cut.
async (page) => {
  await page.goto("http://localhost:1420");
  await page.waitForFunction(() => !!window.videoEditor);
  const noProject = await page.evaluate(() => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "auto_captions", arguments: {} } }));
  await page.locator(".create-card").click();
  const details = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const call = async (name, args = {}) => {
      const r = await ve.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      if (r.result.isError) throw new Error(r.result.content[0].text);
      return JSON.parse(r.result.content[0].text);
    };
    const [a] = await ve.import([{ name: "speech-test.wav", src: location.origin + "/fixtures/media/speech-test.wav" }]);
    ve.exec("add_media_clip", { asset_id: a.id, start: 0 });
    const t = ve.project().tracks.find((t) => t.clips.some((c) => c.assetId === a.id)), c = t.clips.find((c) => c.assetId === a.id);
    ve.exec("update_track", { track_id: t.id, role: "dialog" });
    const transcript = await call("get_transcript", { clip_id: c.id });
    const words = transcript.words;
    if (words.length < 12) throw new Error("Speech fixture not heard: " + JSON.stringify(transcript));
    const fps = ve.project().fps.num / ve.project().fps.den;
    const from = Math.round((words[5].end + words[6].start) / 2 * fps) / fps;
    const to = Math.round((words[9].end + words[10].start) / 2 * fps) / fps;
    await call("cut_ranges", { clip_id: c.id, ranges: [{ start: from, end: to }], ripple: true });
    const result = await call("auto_captions", { words_per_caption: 1, look: "pop", detail: "full" });
    const kept = words.filter((w) => (w.start + w.end) / 2 < from || (w.start + w.end) / 2 >= to);
    const bare = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const text = result.captions.map((x) => bare(x.text));
    const pieces = ve.project().tracks.find((x) => x.id === t.id).clips;
    const after = kept.filter((w) => w.start >= to);
    const shifted = after.every((w) => result.captions.some((x) => bare(x.text) === bare(w.text) && Math.abs(x.start - (w.start - (to - from))) < 0.06));
    const contained = result.captions.every((x) => pieces.some((c) => x.start >= c.start / fps - 0.001 && x.end <= (c.start + c.duration) / fps + 0.001));
    const undoLabel = ve.state().undoLabel;
    ve.action("undo");
    return {
      fixture: { ok: /welcome.*video editor/i.test(words.map((w) => w.text).join(" ")), words },
      words: { ok: JSON.stringify(text) === JSON.stringify(kept.map((w) => bare(w.text))), text, expected: kept.map((w) => bare(w.text)) },
      cutTiming: { ok: shifted && contained, from, to, captions: result.captions },
      compact: { ok: result.words === kept.length && result.count === kept.length && result.track_id && result.seconds > 0, result },
      undo: { ok: undoLabel === "Auto captions" && !ve.project().tracks.some((t) => t.clips.some((c) => c.caption)) && ve.project().tracks.find((x) => x.id === t.id).clips.length === pieces.length, undoLabel },
    };
  });
  details.noProject = { ok: noProject.result.isError === true, result: noProject.result };
  return { ok: Object.values(details).every((x) => x.ok), details };
};
