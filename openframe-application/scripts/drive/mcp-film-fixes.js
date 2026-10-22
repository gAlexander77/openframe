// The remaining film regressions through real commands, layout and audio.
async (page) => {
  await page.goto("http://localhost:1420");
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  const details = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const call = async (name, args = {}) => {
      const r = await ve.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      if (r.result.isError) throw new Error(r.result.content[0].text);
      return JSON.parse(r.result.content[0].text);
    };
    const details = {};
    const batch = await call("batch", { quiet: true, commands: [
      { command: "add_text", args: { text: "VOICES FROM ORBIT", start: 0.4, duration: 3.2, y: -0.04, style: { size: 100, letterSpacing: 14, weight: 800 } } },
      { command: "add_text", args: { text: "Training for the Moon, underground", role: "subhead", start: 0.4, duration: 3.2, y: 0.08, style: { background: { color: "#111111", padding: 8, radius: 4 } } } },
    ] });
    details.batch = { ok: batch.added_clips.join() === [...batch.added_by_step[1], ...batch.added_by_step[2]].join(), batch };
    await call("add_ad_element", { element: "lower_third", start: 4, duration: 4, headline: "Astronaut", subline: "NASA" });
    const before = ve.project().tracks.length;
    await call("add_text", { text: "Thanks for watching", start: 30, duration: 4 });
    await call("add_text", { text: "Explore further", start: 30, duration: 4 });
    details.titleTracks = { ok: ve.project().tracks.length === before, before, after: ve.project().tracks.length };
    const { versionProject, boxOf } = await import("/src/lib/versions.ts");
    const { checkProject, seenLetters, seenTexts } = await import("/src/lib/designCheck.ts");
    const { titleZone } = await import("/src/lib/align.ts");
    const { textLines } = await import("/src/lib/render/size.ts");
    const master = ve.project(), q = versionProject(master, { ratio: "9:16" });
    const head = q.tracks.flatMap((t) => t.clips).find((c) => c.text === "VOICES FROM ORBIT");
    const sub = q.tracks.flatMap((t) => t.clips).find((c) => c.text === "Training for the Moon, underground");
    const letters = (p, id) => seenLetters(p, seenTexts(p).find((s) => s.c.id === id)).box;
    const a = letters(q, head.id), b = letters(q, sub.id), z = titleZone(q);
    const oldGap = letters(master, sub.id).top - letters(master, head.id).bottom;
    const gap = b.top - a.bottom, wantGap = oldGap * Math.min(q.width, q.height) / Math.min(master.width, master.height);
    const safe = [a, b].every((r) => r.left >= z.left * q.width - 1 && r.right <= (1 - z.right) * q.width + 1 && r.top >= z.top * q.height - 1 && r.bottom <= (1 - z.bottom) * q.height + 1);
    const findings = checkProject(q).findings.filter((f) => f.rule === "text_overlaps_text" && f.clip_ids?.includes(head.id));
    details.wrappedStack = { ok: gap > 0 && Math.abs(gap - wantGap) < 0.1 && safe && !findings.length, a, b, gap, wantGap, safe, lines: textLines(q, head), style: head.style, rasterBoxes: [boxOf(q, head), boxOf(q, sub)], findings };
    await call("set_brand", { name: "Lumen Trails" });
    const card = await call("add_ad_element", { element: "end_card", start: 35, duration: 4, headline: "Explore", cta: "Go" });
    const wordmark = ve.project().tracks.flatMap((t) => t.clips).find((c) => c.type === "text" && c.text === "Lumen Trails");
    details.wordmark = { ok: !!wordmark, card, wordmark: wordmark?.id };
    const { advise, verdict } = await import("/src/lib/voiceReview.ts");
    const line = { clipId: "signoff", start: 0, end: 1.2, text: "Lumen Trails.", volume: 1, compressed: true, pace: "slow", readAs: "ad", speedChosen: true, wps: 1.64, sps: 2.3, lead: 0.06, tail: 0.2, longestPause: 0.3, marks: [], lufs: -16, truePeak: -3, rangeSt: 6, overMusic: null, differences: [] };
    details.signoff = { ok: !verdict(line, -16).length && !advise(line).length };
    const voice = await call("add_voiceover", { lines: [{ text: "Lumen Trails.", pace: "slow" }], read_as: "ad", start: 45, captions: false, quality: "draft" });
    const review = await call("review_voiceover", { clip_ids: [voice.lines[0].voice_clip], music: false, recheck: false, detail: "full" });
    const signoff = review.lines[0];
    details.signoffResponse = { ok: signoff.pace.on_target === null && signoff.pace.target_words_per_second === null && !(signoff.advice ?? []).some((a) => /pace slow|words a second/.test(a.note)), pace: signoff.pace, advice: signoff.advice };
    const [speech, music] = await ve.import(["speech-test.wav", "beat-128.m4a"].map((name) => ({ name, src: location.origin + "/fixtures/media/" + name })));
    await call("add_media_clip", { asset_id: speech.id, start: 10 });
    let t = ve.project().tracks.find((t) => t.clips.some((c) => c.assetId === speech.id));
    const dialog = t.clips.find((c) => c.assetId === speech.id).id;
    await call("update_track", { track_id: t.id, role: "dialog" });
    await call("set_param", { clip_ids: [dialog], path: "volume", value: 0.25 });
    await call("add_media_clip", { asset_id: music.id, start: 10 });
    const bed = ve.project().tracks.flatMap((t) => t.clips).find((c) => c.assetId === music.id).id;
    const duck = await call("duck_under_speech", { clip_id: bed, voice_above_music_lu: 15 });
    details.quietDialog = { ok: /normalize_loudness.*target -16/.test(duck.note ?? "") && duck.note.includes(dialog), duck };
    const normalized = await call("normalize_loudness", { clip_ids: [dialog], target: -16 });
    const n = normalized[0];
    details.response = { ok: n.clip_id === dialog && !("clipId" in n) && "limited_by" in n && n.gain === +n.gain.toFixed(3) && n.gain_db === +n.gain_db.toFixed(1), normalized };
    return details;
  });
  return { ok: Object.values(details).every((x) => x.ok), details };
};
