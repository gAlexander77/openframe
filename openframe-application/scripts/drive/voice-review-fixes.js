// review_voiceover's fixes on the real voice model and Whisper, through
// window.videoEditor.mcp. Two lines are read with a word other than their
// script's (the voice says "stool" and "helm"; the script kept with the
// take says "tool" and "home"), as a voice that misreads a word would.
// The larger Whisper hears them the same, so each difference is the
// voice's, and each fix is concrete: "home" respelled as it sounds
// ("hohm"), "tool" (nothing reads differently) a slower read with the
// advice to reword; never a placeholder. An end-card tagline marked pace
// slow and read slowly is not flagged as slow; the same read without the
// mark is. retake_voiceover keeps the pace.
async (page) => {
  page.setDefaultTimeout(900000);
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const call = async (name, args = {}) => {
    const r = await page.evaluate(([name, args]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), [name, args]);
    if (r.error || r.result?.isError) throw new Error(`${name}: ${r.error?.message ?? r.result.content[0].text}`);
    return JSON.parse(r.result.content[0].text);
  };
  const details = {};
  const vo = await call("add_voiceover", {
    lines: [
      { text: "Every edit in this editor is a stool." },
      { text: "Bring all of it, helm." },
      { text: "Free, open source, and yours to keep.", speed: 0.7, pace: "slow" },
      { text: "Free, open source, and yours to keep.", speed: 0.7 },
    ],
    quality: "draft",
  });
  const [tool, home, slow, plain] = vo.lines;
  // The scripts the takes were meant to read.
  await page.evaluate(async (ids) => {
    const loaded = performance.getEntriesByType("resource").map((e) => e.name);
    const { store } = await import(loaded.find((n) => new URL(n).pathname === "/src/state/store.ts"));
    const meant = { [ids[0]]: "Every edit in this editor is a tool.", [ids[1]]: "Bring all of it, home." };
    store.edit("Scripts", (p) => {
      const asset = (id) => p.tracks.flatMap((t) => t.clips).find((c) => c.id === id).assetId;
      const by = Object.fromEntries(Object.entries(meant).map(([id, text]) => [asset(id), text]));
      return { ...p, assets: p.assets.map((a) => (by[a.id] ? { ...a, speech: { ...a.speech, text: by[a.id] } } : a)) };
    });
  }, [tool.voice_clip, home.voice_clip]);
  const t0 = Date.now();
  const review = await call("review_voiceover", { music: false, detail: "full" });
  const R = Object.fromEntries(review.lines.map((l) => [l.voice_clip, l]));
  const diffOf = (l, word) => R[l.voice_clip].differences.find((d) => d.script === word);
  details.secondHearing = {
    ok: diffOf(tool, "tool")?.likely === "voice" && diffOf(home, "home")?.likely === "voice" && review.summary.heard_again_with === "whisper-small.en_timestamped",
    tool: { heard: R[tool.voice_clip].heard, again: R[tool.voice_clip].heard_again, differences: R[tool.voice_clip].differences },
    home: { heard: R[home.voice_clip].heard, again: R[home.voice_clip].heard_again, differences: R[home.voice_clip].differences },
    summary: review.summary,
    seconds: (Date.now() - t0) / 1000,
  };
  const fixOf = (l, word) => (R[l.voice_clip].fixes ?? []).find((f) => f.problem.includes(`"${word}"`));
  const fh = fixOf(home, "home"), ft = fixOf(tool, "tool");
  details.respelling = { ok: fh?.tool === "retake_voiceover" && fh.args.pronounce?.home === "hohm", fix: fh };
  details.slowerRead = { ok: ft?.tool === "retake_voiceover" && typeof ft.args.speed === "number" && /reword/.test(ft.problem), fix: ft };
  const all = review.lines.flatMap((l) => l.fixes ?? []);
  details.noPlaceholder = { ok: all.every((f) => !/[<>]/.test(JSON.stringify(f.args))), fixes: all };
  // The tagline, meant slow, is held to a band half a word a second lower
  // (ADR-096): it passes; the same read without the mark fails when it is
  // over a tenth under narration's 2.3.
  const wps = [R[slow.voice_clip].pace.over_speech.words_per_second, R[plain.voice_clip].pace.over_speech.words_per_second];
  details.paceIntent = {
    ok: !/slow:/.test(R[slow.voice_clip].verdict) && R[slow.voice_clip].pace.meant === "slow" && (wps[1] >= 2.3 * 0.9 || /slow:/.test(R[plain.voice_clip].verdict)),
    wps,
    verdicts: [R[slow.voice_clip].verdict, R[plain.voice_clip].verdict],
  };
  // The applied respelling makes the voice say "home": the retake is heard right.
  await call("retake_voiceover", fh.args);
  const again = await call("review_voiceover", { clip_ids: [home.voice_clip], music: false, detail: "full" });
  details.respellingWorks = { ok: !again.lines[0].differences.some((d) => d.script === "home" && d.likely !== "recognizer"), heard: again.lines[0].heard, differences: again.lines[0].differences };
  // The pace is kept with the script through a retake.
  await call("retake_voiceover", { clip_id: slow.voice_clip, speed: 0.72 });
  const kept = await page.evaluate((id) => {
    const p = window.videoEditor.project();
    const c = p.tracks.flatMap((t) => t.clips).find((x) => x.id === id);
    return p.assets.find((x) => x.id === c.assetId)?.speech?.pace;
  }, slow.voice_clip);
  details.paceKept = { ok: kept === "slow", kept };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
