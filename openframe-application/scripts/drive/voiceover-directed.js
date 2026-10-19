// A directed voiceover made, heard back, retaken and undone through
// window.videoEditor.mcp, on the real voice model and Whisper: two voices,
// a pause inside a line, a pronunciation, a line pinned with at, a blend;
// review_voiceover's verdicts; retake_voiceover in place with ripple; and
// undo leaving no speech files behind (ADR-083, ADR-084).
async (page) => {
  page.setDefaultTimeout(600000);
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
  const doc = () => page.evaluate(() => window.videoEditor.project());
  const details = {};
  const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

  await page.evaluate(async () => {
    const ve = window.videoEditor;
    const [a] = await ve.import([{ name: "music-30s.mp3", src: `${location.origin}/fixtures/media/music-30s.mp3` }]);
    ve.exec("add_media_clip", { asset_id: a.id, start: 0 });
  });

  // ---- a directed read --------------------------------------------------------------
  const t0 = Date.now();
  const vo = await call("add_voiceover", {
    lines: [
      { text: "Meet OpenFrame. [pause 0.6] The video editor that runs on your own computer." },
      { text: "Every edit is a tool an agent can call over MCP,", voice: "am_michael" },
      { text: "so a whole film can be made by asking.", voice: "am_michael", pause_after: 0.8 },
      { text: "It's free, and it's open source.", at: 16, voice: "af_heart:70,af_bella:30" },
    ],
    pronounce: { MCP: "M C P", OpenFrame: "Open Frame" },
  });
  const seconds = (Date.now() - t0) / 1000;
  const L = vo.lines;
  details.answer = {
    ok: L.length === 4 && L.every((l) => l.voice_clip && l.caption_clip && l.seconds > 0.5) && vo.finish === "natural" && vo.engine.dtype === "fp32",
    lines: L.map((l) => ({ start: l.start, end: l.end, voice: l.voice, speed: l.speed, pauses: l.pauses })),
    engine: vo.engine,
    seconds,
  };
  // No speed given: each line's speed is chosen to land on narration's words a second (ADR-096).
  details.voices = { ok: L[0].voice === "af_heart" && L[1].voice === "am_michael" && L[2].voice === "am_michael" && L[3].voice === "af_heart:70,af_bella:30" && L.every((l) => l.speed_chosen && l.speed >= 0.6 && l.speed <= 1.3), voices: L.map((l) => l.voice), speeds: L.map((l) => [l.speed, l.words_per_second]) };
  // The gaps follow each line's ending: 0.4 after a sentence, 0.1 after a
  // comma; the third line's own pause_after sends nothing past the pinned 16 s.
  details.timing = {
    ok: L[0].start === 0 && near(L[1].start - L[0].end, 0.4) && near(L[2].start - L[1].end, 0.1) && L[3].start === 16,
    gaps: [L[1].start - L[0].end, L[2].start - L[1].end].map((x) => +x.toFixed(3)),
  };
  details.pause = { ok: L[0].pauses?.length === 1 && L[0].pauses[0].seconds === 0.6, pauses: L[0].pauses };
  let p = await doc();
  const clips = p.tracks.flatMap((t) => t.clips);
  const caps = clips.filter((c) => c.type === "text" && c.caption).sort((a, b) => a.start - b.start).map((c) => c.text);
  details.captions = {
    ok: caps[0] === "Meet OpenFrame. The video editor that runs on your own computer." && caps[1] === "Every edit is a tool an agent can call over MCP," && !caps.some((c) => /\[|pause|M C P|Open Frame/.test(c)),
    caps,
  };
  const speechAssets = p.assets.filter((a) => a.speech);
  const voiceClip = clips.find((c) => c.id === L[0].voice_clip);
  details.stored = {
    ok: speechAssets.length === 4 && speechAssets[0].speech.pronounce?.MCP === "M C P" && speechAssets[0].speech.text.includes("[pause 0.6]") && !!voiceClip.compressor && !!voiceClip.reverb,
    speech: speechAssets.map((a) => a.speech),
    clip: { compressor: !!voiceClip.compressor, reverb: voiceClip.reverb },
  };

  // ---- the take's waveform: faded edges, room tone in the stretched pause, no click ------
  details.waveform = await page.evaluate(async (id) => {
    const loaded = performance.getEntriesByType("resource").map((e) => e.name);
    const mod = (path) => import(loaded.find((n) => new URL(n).pathname === path) ?? path);
    const { decodeMono } = await mod("/src/engine/analyze.ts");
    const { speechActivity } = await import("/src/lib/analysis/speech.ts");
    const p = window.videoEditor.project();
    const clip = p.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
    const asset = p.assets.find((a) => a.id === clip.assetId);
    const rate = 24000;
    const x = await decodeMono(asset, 0, asset.duration, rate);
    const pause = speechActivity(x, rate).pauses.sort((a, b) => b.end - b.start - (a.end - a.start))[0];
    const inner = x.subarray(Math.round((pause.start + 0.02) * rate), Math.round((pause.end - 0.02) * rate));
    let e = 0, step = 0, digital = 0, run = 0;
    for (let i = 1; i < inner.length; i++) {
      e += inner[i] * inner[i];
      step = Math.max(step, Math.abs(inner[i] - inner[i - 1]));
      run = Math.abs(inner[i]) < 6e-5 ? run + 1 : 0;
      if (run === Math.round(0.05 * rate)) digital++;
    }
    const floorDb = 10 * Math.log10(e / inner.length + 1e-14), stepDb = 20 * Math.log10(step + 1e-9);
    const edges = [Math.abs(x[0]), Math.abs(x[x.length - 1])];
    return {
      // A room's floor (not digital silence, under -60 dBFS), no step a click would make, edges faded to nothing.
      ok: floorDb > -85 && floorDb < -60 && digital === 0 && stepDb < -40 && edges.every((v) => v < 1e-3),
      pause: +(pause.end - pause.start).toFixed(2),
      floorDb: +floorDb.toFixed(1),
      stepDb: +stepDb.toFixed(1),
      edges,
    };
  }, L[0].voice_clip);

  // ---- listen back ---------------------------------------------------------------------
  const review = await call("review_voiceover", {});
  const R = review.lines;
  details.review = {
    ok: R.length === 4 && R.every((l) => l.match >= 0.85 && l.pace.over_speech.words_per_second > 1.8 && l.pace.over_speech.words_per_second < 4 && l.pitch && l.voice_above_music_lu !== null && Number.isFinite(l.loudness_lufs)),
    lines: R.map((l) => ({ heard: l.heard, match: l.match, differences: l.differences, wps: l.pace.over_speech.words_per_second, lead: l.lead_silence, tail: l.tail_silence, pause: l.longest_pause, lufs: l.loudness_lufs, tp: l.true_peak_dbtp, pitch: l.pitch, over: l.voice_above_music_lu, verdict: l.verdict, fixes: l.fixes })),
    summary: review.summary,
  };
  // The marked pause is heard at its length; the lines sit at one level.
  details.heardPause = { ok: R[0].longest_pause >= 0.5 && R[0].longest_pause <= 0.75, longest: R[0].longest_pause };
  details.level = { ok: review.summary.loudness_spread_lu <= 1.5, spread: review.summary.loudness_spread_lu };
  // Named words read through pronounce are heard as written.
  details.pronounced = { ok: !R[0].differences.some((d) => /open|frame/i.test(d.script ?? "")) && !R[1].differences.some((d) => /mcp/i.test(d.script ?? "")), r0: R[0].differences, r1: R[1].differences };

  // ---- the fix it names, applied, clears the verdict ---------------------------------------
  const duck = R.flatMap((l) => l.fixes ?? []).find((f) => f.tool === "duck_under_speech");
  if (duck) await call(duck.tool, duck.args);
  const again = await call("review_voiceover", {});
  // The measured depth lands each line near 12 LU over the music, not under it nor ducked to nothing.
  details.fixApplied = { ok: !!duck && again.lines.every((l) => l.voice_above_music_lu >= 8 && l.voice_above_music_lu <= 16) && again.summary.to_fix === 0, depth: duck?.args.depth, over: again.lines.map((l) => l.voice_above_music_lu), verdicts: again.lines.map((l) => l.verdict) };

  // ---- a retake in place, rippling ---------------------------------------------------------
  const clipsOf = (q) => q.tracks.flatMap((t) => t.clips);
  p = await doc();
  const before = { assets: p.assets.map((a) => a.id), starts: L.map((l) => clipsOf(p).find((c) => c.id === l.voice_clip).start) };
  const oldId = clipsOf(p).find((c) => c.id === L[1].voice_clip).assetId;
  const retake = await call("retake_voiceover", { clip_id: L[1].voice_clip, text: "Every single edit is a tool that an agent can call over MCP,", ripple: true });
  p = await doc();
  const after = clipsOf(p);
  const cap1 = after.find((c) => c.id === L[1].caption_clip);
  const fps = p.fps.num / p.fps.den;
  const moved = [2, 3].map((i) => (after.find((c) => c.id === L[i].voice_clip).start - before.starts[i]) / fps);
  const newAsset = p.assets.find((a) => a.id === after.find((c) => c.id === L[1].voice_clip).assetId);
  details.retake = {
    ok: retake.voice_clip === L[1].voice_clip && retake.voice === "am_michael" && retake.seconds > L[1].seconds && cap1.text === "Every single edit is a tool that an agent can call over MCP," && moved.every((m) => Math.abs(m - retake.shifted) < 0.05) && retake.shifted > 0,
    retake,
    moved: moved.map((m) => +m.toFixed(3)),
  };
  details.oldTakeGone = { ok: !p.assets.some((a) => a.id === oldId) && p.assets.length === before.assets.length && newAsset?.speech?.pronounce?.MCP === "M C P", assets: p.assets.length };

  // ---- undo leaves nothing behind -------------------------------------------------------------
  await call("undo");
  p = await doc();
  details.undoRetake = { ok: p.assets.map((a) => a.id).join() === before.assets.join() && clipsOf(p).find((c) => c.id === L[1].caption_clip).text === "Every edit is a tool an agent can call over MCP,", assets: p.assets.length };
  if (duck) await call("undo"); // the ducking
  await call("undo");
  p = await doc();
  details.undoVoiceover = { ok: p.assets.length === 1 && !p.assets.some((a) => a.speech) && !p.tracks.some((t) => t.name === "Voiceover") && !clipsOf(p).some((c) => c.type === "text"), assets: p.assets.map((a) => a.name) };
  await call("redo");
  p = await doc();
  details.redo = { ok: p.assets.filter((a) => a.speech).length === 4, assets: p.assets.length };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
