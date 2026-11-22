// The documentary playbook (help topic documentary), run over MCP the way
// an agent runs it, on two synthesized interviews (interview-a.mp4 and
// interview-b.mp4, a known script each, with a pause before and after the
// talk): hear the talk, cut a sentence on the transcript, L cut into the
// next speaker, cover the join, name the speaker, count a number, duck the
// music, caption, roll the credits, check. What it holds the tools to
// (ADR-147), each found by the first run of this flow:
// - every word that still plays is in the captions (a word Whisper stamps
//   shorter than a frame was dropped, and "12,000" came as "12" and ",000",
//   a caption starting with a comma);
// - a J or L cut's join passes check_project (a butt join of two sounds was
//   a click_at_join warning);
// - captions, loudness and ducking find the talk after its sound has moved
//   to an audio track of its own.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const rpc = (name, args) => page.evaluate(([name, args]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), [name, args]);
  const text = (r) => r.result.content.find((c) => c.type === "text")?.text ?? "";
  /** A tool's answer; a long tool's job is followed to its end. */
  const call = async (name, args = {}) => {
    let r = await rpc(name, args);
    if (r.result.isError) throw new Error(`${name}: ${text(r)}`);
    let answer = JSON.parse(text(r));
    for (let i = 0; answer && answer.state === "running" && answer.job_id && i < 100; i++) {
      await page.waitForTimeout(2000);
      r = await rpc("job_status", { job_id: answer.job_id });
      const s = JSON.parse(text(r));
      if (s.state === "failed") throw new Error(`${name}: ${JSON.stringify(s)}`);
      if (s.state === "done") answer = s.result;
    }
    return answer;
  };
  const details = {};
  const squash = (s) => s.replace(/\s+/g, "");

  // 1-2. The footage, and what is said in it.
  const origin = await page.evaluate(() => location.origin);
  const [ia, ib, photo, song] = await call("import_media", { files: ["interview-a.mp4", "interview-b.mp4", "photo.jpg", "music-30s.mp3"].map((f) => ({ src: `${origin}/fixtures/media/${f}` })) });
  const a = (await call("add_media_clip", { asset_id: ia.id, start: 0 })).added_clips[0].id;
  const b = (await call("add_media_clip", { asset_id: ib.id, start: ia.duration })).added_clips[0].id;
  const ta = await call("get_transcript", { clip_id: a }), tb = await call("get_transcript", { clip_id: b });
  const wa = ta.words, wb = tb.words;
  const said = (ws) => ws.map((w) => w.text).join(" ");
  // Sentences say the same words as the word list, each ending where its last word was said, inside the file.
  const whole = (t) => squash(t.sentences.map((s) => s.text).join(" ")) === squash(said(t.words)) && t.sentences.every((s) => s.end > s.start && s.end <= t.words.at(-1).end + 0.01);
  details.heard = { ok: /studio/i.test(said(wa)) && /everything/i.test(said(wa)) && /bowls/i.test(said(wb)) && /hand/i.test(said(wb)) && whole(ta) && whole(tb), a: said(wa), b: said(wb), sentences: [ta.sentences, tb.sentences] };
  // A number is one word, as it is written.
  details.numbers = { ok: ![...wa, ...wb].some((w) => /^[.,:]\d/.test(w.text.trim())), words: wb.map((w) => w.text) };

  // 3. The radio edit: the middle sentence goes, cut in the breaths around it.
  const g = wa.findIndex((w) => /garage/i.test(w.text)), t = wa.findIndex((w) => /^then/i.test(w.text.trim()));
  await call("cut_ranges", { clip_id: a, ranges: [{ start: wa[g].end + 0.03, end: wa[t].start - 0.05 }] });
  const main = (await call("describe_project", { assets: false })).tracks.find((x) => x.main).clips;
  details.cut = { ok: main.length === 3 && main[2].id === b, clips: main.map((c) => [c.start, c.end]) };

  // 4. An L cut into the second speaker: the first one's room runs on 0.4 s.
  // Her last piece plays to the end of its file, so there is nothing to run
  // on with: the tool says so and names the trim that leaves a handle.
  const none = await call("jl_cut", { clip_id: main[1].id, by: 0.4 });
  details.noHandle = { ok: /^Straight cut/.test(none.notes[0]) && /the source ends there.*trim_clip edge end, ripple true/.test(none.notes[1]), notes: none.notes };
  await call("trim_clip", { clip_id: main[1].id, edge: "end", to: main[1].end - 0.5, ripple: true });
  main[1].end -= 0.5;
  main[2].start -= 0.5;
  main[2].end -= 0.5;
  const l = await call("jl_cut", { clip_id: main[1].id, by: 0.4 });
  const sounds = (await call("describe_project", { assets: false })).tracks.filter((x) => x.kind === "audio").flatMap((x) => x.clips).slice(-2);
  details.lCut = { ok: /^L cut/.test(l.notes[0]) && l.notes.length === 1 && Math.abs(sounds[0].end - (main[1].end + 0.4)) < 0.02 && sounds[0].crossfade === 0.03, notes: l.notes, sounds: sounds.map((c) => [c.start, c.end]) };

  // 5-6. A cutaway over the join inside the first speaker, a name, a number.
  await call("add_track", { kind: "video", name: "B-roll" });
  const broll = (await call("describe_project", { clips: false })).tracks.find((x) => x.name === "B-roll").id;
  await call("add_media_clip", { asset_id: photo.id, start: main[0].end - 0.5, duration: 2, fit: "fill", track_id: broll });
  // A cutaway from footage brings that footage's sound: the tool says so,
  // and volume 0 in the same call places it silent (ADR-149: a blind test's
  // reels played their music under the interview, and were captioned).
  const at = main[2].start + 4.5;
  const loudCut = await call("add_media_clip", { asset_id: ia.id, start: at, in: 0.2, duration: 1, fit: "fill", track_id: broll });
  await call("undo");
  const quietCut = await call("add_media_clip", { asset_id: ia.id, start: at, in: 0.2, duration: 1, fit: "fill", track_id: broll, volume: 0 });
  details.cutawaySound = { ok: (loudCut.notes ?? []).some((n) => /own sound plays/.test(n)) && !(quietCut.notes ?? []).some((n) => /own sound/.test(n)) && quietCut.added_clips[0].volume === 0, loud: loudCut.notes, quiet: quietCut.notes };
  await call("add_ad_element", { element: "lower_third", start: 0.4, headline: "Jordan Lee", subline: "Potter" });
  await call("add_counter", { text: "{n} bowls", from: 0, to: 12000, start: main[2].start + 1, duration: 3, count_seconds: 1.5, y: -0.25, style: { stroke: { color: "#000000", width: 6 } } });

  // 7. Sound: the talk leveled, the music under it.
  const end = main[2].end;
  const music = (await call("add_media_clip", { asset_id: song.id, start: 0, duration: end + 6 })).added_clips[0];
  const leveled = await call("normalize_loudness", { clip_ids: [sounds[0].id, sounds[1].id] });
  const duck = await call("duck_under_speech", { track_id: music.track, voice_above_music_lu: 12 });
  details.sound = { ok: leveled.length === 2 && duck.voices >= 2 && duck.balance.met === true, voices: duck.voices, margin: duck.balance.voice_above_music_lu };

  // 9. Captions: every word that still plays, none starting on a comma.
  const caps = (await call("auto_captions", { detail: "full" })).captions.map((c) => c.text);
  const shown = squash(caps.join(" "));
  const kept = [wa.slice(0, g + 1), wa.slice(t), wb].map((ws) => squash(ws.map((w) => w.text).join("")));
  details.captions = { ok: kept.every((k) => shown.includes(k)) && !caps.some((c) => /^[,.;:]/.test(c.trim())), captions: caps, missing: kept.filter((k) => !shown.includes(k)) };
  const hi = await call("highlight_words", { words: ["studio", "hand"] });
  details.keywords = { ok: /Styled "studio" 1 time, "hand" 1 time\./.test(hi.notes[0]), notes: hi.notes };

  // 9-10. Credits, a bar, and the check.
  const roll = await call("add_credits", { text: "Directed by\nJordan Lee\n\nWith\nSam Rivera", start: end, line_seconds: 4 });
  await call("add_progress_bar", {});
  await call("set_fades", { clip_ids: [music.id], fade_out: 1.5 });
  // A film's end card: a headline, a line under it, and no button (cta "").
  const rollEnd = Math.max(...roll.added_clips.map((c) => c.end));
  const card = await call("add_ad_element", { element: "end_card", start: rollEnd, duration: 4, headline: "Made by hand, one bowl at a time", subline: "A short film", cta: "", logo: "none" });
  const cardTexts = card.added_clips.filter((c) => c.type === "text").map((c) => c.text);
  details.endCard = { ok: cardTexts.includes("A short film") && cardTexts.every((x) => x.trim()) && cardTexts.length === 2, texts: cardTexts };
  const check = await call("check_project", { kind: "documentary" });
  const joins = check.findings.filter((f) => /join/.test(f.rule));
  const onRoll = check.findings.filter((f) => roll.added_clips.some((c) => c.id === f.clip_id || (f.clip_ids ?? []).includes(c.id)));
  details.check = { ok: check.ok === true && joins.length === 0 && onRoll.length === 0 && check.summary.warnings === 0, verdict: check.verdict, rules: check.findings.map((f) => f.rule) };
  const loud = await call("measure_loudness", { spec: "online", loudness: -14 });
  details.loudness = { ok: loud.pass === true, lufs: loud.integrated_lufs, problems: loud.problems };

  return { ok: Object.values(details).every((d) => d.ok), details };
};
